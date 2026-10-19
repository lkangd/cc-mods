#!/usr/bin/env python3
"""Drives a real Claude Code (isolated world, not logged in, or against
fake_api.py for a running turn) with action-probe loaded and the world's
keybindings.json binding the probe's actions, presses each chord, and keeps
what the probe logged for it, the composer, and the screen, under
OUT/<host version>/<scenario>/.

    drive.py <host: current|path to claude> <out dir> <scenario...>
"""
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "mods/chat-toc/tests/acceptance"))
import pty_harness as h  # noqa: E402
import fake_api  # noqa: E402

FAKE_KEY = "sk-ant-api03-fake-chat-toc-gate-000000000000"

BINDINGS = {
    "bindings": [{
        "context": "Global",
        "bindings": {
            "ctrl+x p": "app:toggleDiffNoiseFilter",
            "meta+j": "app:toggleDiffPreSession",
            "ctrl+x g": "app:toggleReplTab",
            "ctrl+x .": "pane:next",
            "ctrl+x r": "app:redraw",
            "ctrl+x d": "footer:dismiss",
            "ctrl+x q": "diff:back",
            "f6": "confirm:previousField",
            "ctrl+x b": "permission:toggleDebug",
        },
    }],
}

# What each chord is sent as, and the probe Button it should press.
CHORDS = {
    "noise": ("\x18p", "ctrl+x p"),
    "presession": ("\x1bj", "meta+j"),
    "repl": ("\x18g", "ctrl+x g"),
    "panenext": ("\x18.", "ctrl+x ."),
    "redraw": ("\x18r", "ctrl+x r"),
    "todos": ("\x14", "ctrl+t"),
    "footer": ("\x18d", "ctrl+x d"),
    "diffback": ("\x18q", "ctrl+x q"),
    "prevfield": ("\x1b[17~", "f6"),
    "banddebug": ("\x18b", "ctrl+x b"),
}


def host_of(arg: str) -> h.Host:
    host = h.Host("current")
    if arg != "current":
        host.binary = arg
        host.version = subprocess.run([arg, "--version"], capture_output=True, text=True).stdout.split()[0]
    return host


def composer(rows: list[str]) -> list[str]:
    """The prompt box's rows: between the last two full-width rules."""
    rules = [i for i, r in enumerate(rows) if r.startswith("─" * 40)]
    if len(rules) < 2:
        return ["<no composer>"]
    return [r.rstrip() for r in rows[rules[-2] + 1:rules[-1]]]


class Session:
    def __init__(self, host, out: pathlib.Path, env=None, fake=None, columns=170, lines=48):
        self.out = out
        out.mkdir(parents=True, exist_ok=True)
        self.world = h.World(token="")
        (self.world.config / "keybindings.json").write_text(json.dumps(BINDINGS, indent=1))
        if fake:
            cfg = json.loads((self.world.config / ".claude.json").read_text())
            cfg["customApiKeyResponses"] = {"approved": [FAKE_KEY[-20:]], "rejected": []}
            (self.world.config / ".claude.json").write_text(json.dumps(cfg))
        self.log = out / "action-probe.log"
        self.debug = out / "debug.log"
        for f in (self.log, self.debug):
            f.unlink(missing_ok=True)
        extra = {"PROBE_LOG": str(self.log), **(env or {})}
        if fake:
            extra |= {"ANTHROPIC_BASE_URL": fake.url, "ANTHROPIC_API_KEY": FAKE_KEY}
        argv = self.world.argv(host, [HERE / "action-probe"], ["--debug-file", str(self.debug)])
        self.t = h.PyteTerminal(argv, self.world.environment(extra=extra), self.world.project, columns, lines)
        self.n = 0
        self.record = []
        self.t.wait_for(lambda s: any("? for shortcuts" in r or "─" * 20 in r for r in s.rows()), "the prompt", 40)
        self.t.settle()
        self.t._write("\x1b[<35;6;6M")  # the pointer off the band and the pane

    def lines(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []

    def snap(self, label: str, timeout: float = 20.0) -> list[str]:
        rows = self.t.settle(quiet=0.6, timeout=timeout)
        self.n += 1
        (self.out / f"{self.n:03d}-{label}.txt").write_text("\n".join(rows) + "\n")
        return rows

    def step(self, label: str, send: str | None = None, wait: float = 1.2, timeout: float = 20.0) -> list[str]:
        """Sends `send` (raw), waits, and records what the probe logged since."""
        before = len(self.lines())
        if send is not None:
            self.t._write(send)
        time.sleep(wait)
        rows = self.snap(label, timeout)
        new = self.lines()[before:]
        self.record.append({"step": label, "presses": [l for l in new if "PRESS" in l],
                            "log": [l for l in new if "PRESS" not in l and "ui.press hook" not in l],
                            "press_event": [l for l in new if "ui.press hook" in l][:1],
                            "composer": composer(rows), "ring": self.ring()})
        return rows

    def ring(self) -> list[str]:
        """Rows the host draws inverse: the focus ring (the pointer is kept off)."""
        out = []
        for y, row in enumerate(self.t.styles()):
            inv = "".join(c[0] for c in row if c[3]).strip()
            if inv:
                out.append(f"{y}:{inv}")
        return out

    def ctrlx_tab(self, label: str) -> None:
        self.t._write("\x18")
        time.sleep(0.25)
        self.step(label, "\t")

    def chords(self, prefix: str, names=None, timeout: float = 20.0) -> None:
        for name in names or CHORDS:
            seq, spelled = CHORDS[name]
            self.step(f"{prefix}-{name} ({spelled})", seq, timeout=timeout)

    def command(self, text: str, label: str) -> None:
        self.t.type(text)
        time.sleep(0.4)
        self.step(label, "\r", wait=1.5)

    def clear(self, n: int = 40) -> None:
        self.t._write("\x7f" * n)
        time.sleep(0.4)

    def close(self) -> None:
        (self.out / "steps.json").write_text(json.dumps(self.record, ensure_ascii=False, indent=1))
        self.t.close()
        self.world.remove()


SCENARIOS = {}


def scenario(fn):
    SCENARIOS[fn.__name__] = fn
    return fn


@scenario
def idle(host, out):
    """No turn running: pane closed, open and unfocused, focused, a back tab, closed again; a dialog; a draft."""
    s = Session(host, out)
    try:
        s.step("start")
        s.chords("closed", ["noise", "presession", "banddebug"])
        s.step("digit-7-empty-composer", "7", wait=2.0)
        s.clear()
        s.t.type("x")
        s.step("digit-7-after-draft-x", "7", wait=2.0)
        s.clear()
        s.command("/actionprobe", "open-pane")
        s.chords("open")
        s.clear()
        s.t.type("abc")
        time.sleep(0.3)
        s.chords("draft-abc", ["noise", "presession"])
        s.clear()
        # ctrl+x tab: the band first, then the pane
        s.ctrlx_tab("ctrlx-tab-1")
        s.chords("band-focused", ["noise", "banddebug"])
        s.step("band-focused-digit-7", "7")
        s.ctrlx_tab("ctrlx-tab-2")
        s.chords("pane-focused", ["noise", "presession", "banddebug"])
        s.step("pane-focused-digit-8", "8")
        s.step("pane-focused-digit-7", "7")
        s.step("esc-leave", "\x1b")
        s.clear()
        s.command("/actionprobe open2", "open-pane2")
        s.chords("pane2-front", ["noise", "presession", "panenext"])
        s.step("after-panenext")
        s.chords("after-panenext", ["noise", "presession"])
        s.command("/actionprobe close2", "close-pane2")
        s.command("/actionprobe close", "close-pane")
        s.chords("closed-again", ["noise", "presession", "banddebug"])
        s.command("/actionprobe", "reopen-pane")
        s.command("/model", "model-dialog")
        s.chords("under-dialog", ["noise", "presession", "banddebug"])
        s.step("dialog-esc", "\x1b")
        s.chords("dialog-closed", ["noise"])
        s.command("/actionprobe log", "log")
    except h.ScenarioFailure as failure:
        s.record.append({"failure": str(failure)})
    finally:
        s.close()


@scenario
def refused(host, out):
    """An unknown action and a reserved one: what the person and the debug log see."""
    s = Session(host, out)
    try:
        s.command("/actionprobe bad", "open-bad")
        s.command("/actionprobe reserved", "open-reserved")
    except h.ScenarioFailure as failure:
        s.record.append({"failure": str(failure)})
    finally:
        s.close()
        refusals = [l for l in s.debug.read_text().splitlines() if "does not validate" in l or "refused:" in l]
        (out / "refusals.txt").write_text("\n".join(refusals) + "\n")


@scenario
def working(host, out):
    """While Claude is working (a running turn against fake_api)."""
    with fake_api.FakeApi("ACTIONPROBE-TURN", "/etc/hosts", steps=3, delay=8.0, reply="done") as api:
        s = Session(host, out, fake=api)
        try:
            (s.world.project / "notes.txt").write_text("action-probe notes\n")
            api.read_path = str(s.world.project / "notes.txt")
            s.command("/actionprobe", "open-pane")
            s.t.type("ACTIONPROBE-TURN go")
            time.sleep(0.4)
            s.step("submit", "\r", wait=2.5, timeout=1)
            s.chords("running", ["noise", "presession", "banddebug"], timeout=1)
            s.t.type("queued draft")
            s.chords("running-draft", ["noise"], timeout=1)
            time.sleep(25)
            s.step("after-turn")
        except h.ScenarioFailure as failure:
            s.record.append({"failure": str(failure)})
        finally:
            s.close()


@scenario
def permission(host, out):
    """Under a tool permission prompt (fake_api reads a file outside the project)."""
    with fake_api.FakeApi("ACTIONPROBE-TURN", "/etc/hosts", steps=1, delay=1.0, reply="done") as api:
        s = Session(host, out, fake=api)
        try:
            s.command("/actionprobe", "open-pane")
            s.t.type("ACTIONPROBE-TURN go")
            time.sleep(0.4)
            s.step("submit", "\r", wait=6.0, timeout=2)
            s.chords("permission-prompt", ["noise", "presession", "banddebug"], timeout=2)
            s.step("digit-7-under-prompt-esc", "\x1b", wait=2.0, timeout=2)
        except h.ScenarioFailure as failure:
            s.record.append({"failure": str(failure)})
        finally:
            s.close()


@scenario
def edge(host, out):
    """The pane focused by $.ui.focus; the band collapsed; the pane inline at 100 columns."""
    s = Session(host, out)
    try:
        s.command("/actionprobe", "open-pane")
        s.command("/actionprobe focus", "focus-pane")
        s.chords("pane-focused", ["noise", "presession", "banddebug"])
        s.step("pane-focused-digit-8", "8")
        s.step("pane-focused-digit-7", "7")
        s.step("esc", "\x1b")
        s.clear()
        s.command("/actionprobe close", "close-pane")
        s.t._write("\x18")
        time.sleep(0.25)
        s.step("band-collapsed", "\x01")
        s.chords("band-collapsed", ["noise", "banddebug"])
        s.step("band-collapsed-digit-7", "7", wait=2.0)
        s.clear()
        s.t._write("\x18")
        time.sleep(0.25)
        s.step("band-expanded", "\x01")
        s.t.resize(100, 48)
        s.command("/actionprobe", "open-pane-at-100-columns")
        s.chords("inline", ["noise", "presession", "banddebug"])
    except h.ScenarioFailure as failure:
        s.record.append({"failure": str(failure)})
    finally:
        s.close()


@scenario
def noband(host, out):
    """The band draws nothing: a chord with no Button mounted; Ctrl+X Tab straight into the pane."""
    s = Session(host, out, env={"PROBE_BAND": "0"})
    try:
        s.chords("nothing-mounted", ["noise", "presession"])
        s.clear()
        s.command("/actionprobe", "open-pane")
        s.ctrlx_tab("ctrlx-tab")
        s.step("down", "\x1b[B")
        s.chords("pane-focused", ["noise", "presession"])
        s.step("pane-focused-digit-8", "8")
        s.step("esc", "\x1b")
    except h.ScenarioFailure as failure:
        s.record.append({"failure": str(failure)})
    finally:
        s.close()


def main() -> None:
    host = host_of(sys.argv[1])
    out = pathlib.Path(sys.argv[2]).resolve() / host.version
    for name in sys.argv[3:]:
        SCENARIOS[name](host, out / name)


if __name__ == "__main__":
    main()
