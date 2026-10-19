#!/usr/bin/env python3
"""Drives a real Claude Code (isolated world, not logged in, or against
fake_api.py for a running turn) with fill-probe and fill-watch loaded, and
writes each step's screen, the probes' logs and the raw OSC 52 writes to
OUT/<host>/. Restores the person's clipboard afterwards.

    drive.py <host: current|path to claude> <out dir> <scenario...>
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "mods/chat-toc/tests/acceptance"))
import pty_harness as h  # noqa: E402
import fake_api  # noqa: E402

FAKE_KEY = "sk-ant-api03-fake-chat-toc-gate-000000000000"


class Tee(h.PyteTerminal):
    """A PyteTerminal that also keeps every OSC 52 the host writes."""
    raw = bytearray()

    @classmethod
    def osc(cls) -> list[str]:
        return [m.group(1)[:60].decode(errors="replace") + f"... ({len(m.group(1))} bytes)"
                for m in re.finditer(rb"\x1b\]52;([^\x07\x1b]*)", bytes(cls.raw))]

    def _read(self) -> None:
        while True:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                break
            if not data:
                break
            self.raw.extend(data)
            with self.lock:
                self.stream.feed(data)
        self.closed = True


def host_of(arg: str) -> h.Host:
    host = h.Host("current")
    if arg != "current":
        host.binary = arg
        host.version = subprocess.run([arg, "--version"], capture_output=True, text=True).stdout.split()[0]
    return host


def pbpaste() -> str:
    return subprocess.run(["pbpaste"], capture_output=True).stdout.decode(errors="replace")


class Session:
    def __init__(self, host, out: pathlib.Path, env=None, fake=None, columns=170, lines=48):
        self.out = out
        out.mkdir(parents=True, exist_ok=True)
        self.world = h.World(token="")
        if fake:
            cfg = json.loads((self.world.config / ".claude.json").read_text())
            cfg["customApiKeyResponses"] = {"approved": [FAKE_KEY[-20:]], "rejected": []}
            (self.world.config / ".claude.json").write_text(json.dumps(cfg))
        self.probe_log = out / "fill-probe.log"
        self.watch_log = out / "fill-watch.log"
        for f in (self.probe_log, self.watch_log):
            f.unlink(missing_ok=True)
        extra = {"PROBE_LOG": str(self.probe_log), "WATCH_LOG": str(self.watch_log),
                 "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1", **(env or {})}
        if fake:
            extra |= {"ANTHROPIC_BASE_URL": fake.url, "ANTHROPIC_API_KEY": FAKE_KEY}
        argv = self.world.argv(host, [HERE / "fill-probe", HERE / "fill-watch"])
        self.t = Tee(argv, self.world.environment(extra=extra), self.world.project, columns, lines)
        self.n = 0
        self.t.wait_for(lambda s: any("? for shortcuts" in r or "─" * 20 in r for r in s.rows()), "the prompt", 40)
        self.t.settle()

    def snap(self, label: str, timeout: float = 20.0) -> list[str]:
        rows = self.t.settle(quiet=0.6, timeout=timeout)
        self.n += 1
        (self.out / f"{self.n:03d}-{label}.txt").write_text("\n".join(rows) + "\n")
        return rows

    def find(self, needle: str):
        return self.t.find(needle)

    def click(self, needle: str) -> None:
        at = self.t.find(needle)
        if at is None:
            self.snap(f"missing-{needle.replace(' ', '_')}")
            raise h.ScenarioFailure(f"no {needle!r} on screen")
        self.t.click(at[1] + 1, at[0])
        time.sleep(0.8)

    def clear(self, n: int = 80) -> None:
        self.t._write("\x7f" * n)
        time.sleep(0.5)

    def close(self) -> None:
        self.t.close()
        self.world.remove()


def main() -> None:
    host = host_of(sys.argv[1])
    out = pathlib.Path(sys.argv[2]) / host.version
    saved = pbpaste()
    try:
        for name in sys.argv[3:]:
            SCENARIOS[name](host, out / name)
    finally:
        subprocess.run(["pbcopy"], input=saved.encode())


SCENARIOS = {}


def scenario(fn):
    SCENARIOS[fn.__name__] = fn
    return fn


@scenario
def look(host, out):
    s = Session(host, out)
    try:
        s.snap("start")
        s.t.command("/fillprobe")
        s.snap("opened")
    finally:
        s.close()


def composer(rows: list[str]) -> list[str]:
    """The prompt box's rows: between the last two full-width rules."""
    rules = [i for i, r in enumerate(rows) if r.startswith("─" * 40)]
    if len(rules) < 2:
        return ["<no composer>"]
    return [r.rstrip() for r in rows[rules[-2] + 1:rules[-1]]]


class Steps:
    """Runs steps on a Session and keeps (label, composer, clipboard) per step."""

    def __init__(self, s: Session):
        self.s, self.record = s, []

    def to_composer(self) -> None:
        rows = self.s.t.rows()
        rules = [i for i, r in enumerate(rows) if r.startswith("─" * 40)]
        self.s.t.click(160, rules[-1] - 1)
        time.sleep(0.5)

    def focus(self) -> str:
        """Which pane line the host draws inverse (the focus ring), if any."""
        for y, row in enumerate(self.s.t.styles()):
            cells = [c for c in row[122:] if c[3] and c[0].strip()]
            if cells:
                return f"row {y}: " + "".join(c[0] for c in row[122:] if c[3])
        return "none"

    def keep(self, label: str, clip: bool = False, timeout: float = 20.0) -> None:
        rows = self.s.snap(label, timeout)
        entry = {"step": label, "composer": composer(rows)}
        if clip:
            c = pbpaste()
            entry["clipboard"] = {"chars": len(c), "head": c[:40]}
        self.record.append(entry)

    def fresh(self, draft: str = "") -> None:
        self.to_composer()
        self.s.clear()
        if draft:
            self.s.t.type(draft)
            time.sleep(0.4)

    def dump(self) -> None:
        out = self.s.out
        (out / "steps.json").write_text(json.dumps(self.record, ensure_ascii=False, indent=1))
        (out / "osc52.txt").write_text("\n".join(Tee.osc()) + "\n")
        Tee.raw.clear()


def run(host, out, body, env=None, fake=None, open_pane=True):
    s = Session(host, out, env=env, fake=fake)
    st = Steps(s)
    try:
        if open_pane:
            s.t.command("/fillprobe")
            s.snap("opened")
        body(s, st)
    except h.ScenarioFailure as failure:
        st.record.append({"failure": str(failure)})
    finally:
        st.dump()
        s.close()


@scenario
def basic(host, out):
    def body(s, st):
        st.fresh()
        s.click("r: fill replace")
        st.keep("empty-replace")
        s.t.type("Q")
        time.sleep(0.5)
        st.keep("typed-Q-after-click")
        for label, button, draft, keys in [
            ("draft-replace", "r: fill replace", "DRAFT", ()),
            ("draft-append", "a: fill append", "DRAFT", ()),
            ("draft-insert-cursor-left2", "i: fill insert", "DRAFT", ("left", "left")),
            ("empty-insert", "i: fill insert", "", ()),
            ("multiline", "m: fill multi-line", "", ()),
            ("slash", "s: fill /command", "", ()),
            ("bang", "x: fill !cmd", "", ()),
            ("invisible", "z: fill invisible", "", ()),
            ("draft-fill-empty-text", "e: fill empty", "DRAFT", ()),
        ]:
            st.fresh(draft)
            if keys:
                s.t.key(*keys)
            s.click(button)
            st.keep(label)
        # keyboard: focus the pane by clicking its title, then the hotkey
        st.fresh()
        s.click("fill-probe on terminal")
        st.keep("pane-focused-by-title-click")
        st.record.append({"step": "focus ring after title click", "focus": st.focus()})
        s.t.type("Q")
        time.sleep(0.5)
        st.keep("typed-Q-pane-focused-no-fill")
        s.t.type("r")
        time.sleep(0.8)
        st.keep("hotkey-r")
        st.record.append({"step": "focus ring after hotkey fill", "focus": st.focus()})
        s.t.type("Q")
        time.sleep(0.5)
        st.keep("typed-Q-after-hotkey")
        # submit what a fill put in: a slash command, a !cmd
        st.fresh("/fillp")
        st.keep("typed-slash-for-compare")
        st.fresh()
        s.t.command("/fillprobe fill /fillprobe log")
        st.keep("filled-slash-command")
        st.to_composer()
        s.t.key("enter")
        time.sleep(2)
        st.keep("submitted-filled-slash")
        st.fresh()
        s.click("x: fill !cmd")
        st.to_composer()
        s.t.key("enter")
        time.sleep(3)
        st.keep("submitted-filled-bang")
        # from a command, not a press
        st.fresh()
        s.t.command("/fillprobe fill CMD TEXT")
        st.keep("command-fill")
        # timer: press d, wait 7 s, no press when it fires
        st.fresh("DRAFT")
        s.click("d: fill in 6s")
        st.to_composer()
        time.sleep(7)
        st.keep("delayed-fill")
        # copies
        for label, button in [("copy-small", "c: copy small"), ("copy-no-surface", "n: copy no surface"),
                              ("copy-100k", "k: copy 100 KB"), ("copy-2m", "g: copy 2 MB"), ("copy-16m", "j: copy 16 MB")]:
            subprocess.run(["pbcopy"], input=b"BEFORE")
            s.click(button)
            time.sleep(1.5)
            st.keep(label, clip=True)
        subprocess.run(["pbcopy"], input=b"BEFORE")
        s.click("l: copy in 6s")
        time.sleep(7)
        st.keep("copy-delayed", clip=True)
        subprocess.run(["pbcopy"], input=b"BEFORE")
        st.fresh()
        s.t.command("/fillprobe copy CMD COPY")
        st.keep("command-copy", clip=True)
    run(host, out, body)


@scenario
def focus(host, out):
    """Where the keyboard is after each kind of press. Ctrl+X Tab moves it
    into the Pane, with no ring until an arrow; then a hotkey that does not
    fill, an arrow and Enter on a fill, and typing after it."""
    def ring():
        out = []
        for y, row in enumerate(s.t.styles()):
            inv = "".join(c[0] for c in row if c[3]).strip()
            if inv:
                out.append(f"{y}:{inv}")
        return out

    def pointer_off():
        s.t._write("\x1b[<35;6;6M")
        time.sleep(0.5)

    def mark(step):
        st.record.append({"step": step, "composer": composer(s.t.rows()), "ring": ring()})

    def body(s_, st_):
        pointer_off()
        s.t._write("\x18")
        time.sleep(0.25)
        s.t._write("\t")
        s.t.settle(quiet=0.6)
        mark("after ctrl+x tab")
        s.t.type("p")
        time.sleep(0.8)
        mark("hotkey p (read, no fill)")
        s.t.key("down")
        time.sleep(0.5)
        mark("down")
        s.t.key("enter")
        time.sleep(0.8)
        mark("enter on r: fill replace")
        s.t.type("Q")
        time.sleep(0.5)
        mark("typed Q after the fill")
        st.fresh()
        s.click("p: read box")
        pointer_off()
        s.t.type("r")
        time.sleep(0.8)
        mark("click p, then typed r")
        st.fresh()
        s.click("e: fill empty")
        pointer_off()
        s.t.type("p")
        time.sleep(0.8)
        mark("click e (fill), then typed p")
        st.fresh("!")
        time.sleep(0.3)
        s.t.type("echo typed")
        time.sleep(0.3)
        st.keep("typed-bang")
        s.t.key("enter")
        time.sleep(3)
        st.keep("submitted-typed-bang")

    s = Session(host, out)
    st = Steps(s)
    try:
        s.t.command("/fillprobe")
        s.snap("opened")
        body(s, st)
    except h.ScenarioFailure as failure:
        st.record.append({"failure": str(failure)})
    finally:
        st.dump()
        s.close()


@scenario
def working(host, out):
    with fake_api.FakeApi("FILLPROBE-TURN", "/etc/hosts", steps=3, delay=8.0, reply="done") as api:
        def body(s, st):
            (s.world.project / "notes.txt").write_text("fill-probe notes\n")
            api.read_path = str(s.world.project / "notes.txt")
            st.fresh()
            s.t.type("FILLPROBE-TURN go")
            time.sleep(0.4)
            s.t.key("enter")
            time.sleep(2.5)
            st.keep("turn-running", timeout=1)
            s.click("r: fill replace")
            st.keep("fill-while-running", timeout=1)
            subprocess.run(["pbcopy"], input=b"BEFORE")
            s.click("c: copy small")
            time.sleep(1)
            st.keep("copy-while-running", clip=True, timeout=1)
            st.fresh("QUEUED")
            s.click("a: fill append")
            st.keep("append-to-draft-while-running", timeout=1)
            st.to_composer()
            s.t.key("enter")
            time.sleep(1)
            st.keep("queued-enter", timeout=1)
            time.sleep(25)
            st.keep("after-turn")
        run(host, out, body, fake=api)
        (out / "api.json").write_text(json.dumps(api.requests, indent=1))


@scenario
def dialog(host, out):
    def body(s, st):
        st.fresh()
        s.click("d: fill in 6s")
        st.to_composer()
        s.t.command("/model", wait=1.0)
        st.keep("dialog-open")
        time.sleep(7)
        st.keep("delayed-fill-under-dialog")
        s.t.key("esc")
        time.sleep(1)
        st.keep("dialog-closed")
    run(host, out, body)


@scenario
def refuse(host, out):
    def body(s, st):
        st.fresh("DRAFT")
        s.click("r: fill replace")
        st.keep("refused-by-watch")
    run(host, out, body, env={"WATCH_REFUSE": "1"})


@scenario
def rewrite(host, out):
    def body(s, st):
        st.fresh()
        s.click("m: fill multi-line")
        st.keep("rewritten-by-watch")
    run(host, out, body, env={"WATCH_REWRITE": "1"})


@scenario
def nopbcopy(host, out):
    """PATH without /usr/bin, where pbcopy lives: what the copy falls back to."""
    def body(s, st):
        for label, button in [("copy-small", "c: copy small"), ("copy-100k", "k: copy 100 KB"), ("copy-2m", "g: copy 2 MB")]:
            subprocess.run(["pbcopy"], input=b"BEFORE")
            s.click(button)
            time.sleep(1.5)
            st.keep(label, clip=True)
    run(host, out, body, env={"PATH": "/bin:/usr/sbin:/sbin"})


@scenario
def boot(host, out):
    def body(s, st):
        time.sleep(4)
        st.keep("after-boot")
    run(host, out, body, env={"PROBE_BOOT": "1"}, open_pane=False)


if __name__ == "__main__":
    main()
