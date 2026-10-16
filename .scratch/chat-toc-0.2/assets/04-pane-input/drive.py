#!/usr/bin/env python3
"""Drives a real Claude Code (isolated world, not logged in) with input-probe
loaded: focuses the Pane's Input every way there is, types into it, presses
Esc/Enter/arrows/digits, measures onInput and redraws, draws it narrow and
with CJK, and keeps what the probe logged, the composer, the focus ring and
the cursor per step under OUT/<host version>/<scenario>/.

    drive.py <host: path to claude> <out dir> <scenario...>
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

BINDINGS = {"bindings": [{"context": "Global", "bindings": {"ctrl+x .": "pane:next"}}]}

ESC = "\x1b"
UP, DOWN, LEFT, RIGHT = "\x1b[A", "\x1b[B", "\x1b[D", "\x1b[C"
TAB, SHIFT_TAB, BS = "\t", "\x1b[Z", "\x7f"


def host_of(arg: str) -> h.Host:
    host = h.Host.__new__(h.Host)
    host.binary = arg
    host.version = subprocess.run([arg, "--version"], capture_output=True, text=True).stdout.split()[0]
    return host


def composer(rows: list[str]) -> list[str]:
    """The prompt box's rows: between the last two rules that start at column 0."""
    rules = [i for i, r in enumerate(rows) if r.startswith("─" * 20)]
    if len(rules) < 2:
        return ["<no composer>"]
    return [r.rstrip() for r in rows[rules[-2] + 1:rules[-1]]]


class Session:
    def __init__(self, host, out: pathlib.Path, env=None, columns=170, lines=48):
        self.out = out
        out.mkdir(parents=True, exist_ok=True)
        self.world = h.World(token="")
        (self.world.config / "keybindings.json").write_text(json.dumps(BINDINGS, indent=1))
        self.log = out / "input-probe.log"
        self.debug = out / "debug.log"
        for f in (self.log, self.debug):
            f.unlink(missing_ok=True)
        extra = {"PROBE_LOG": str(self.log), **(env or {})}
        argv = self.world.argv(host, [HERE / "input-probe"], ["--debug-file", str(self.debug)])
        self.t = h.PyteTerminal(argv, self.world.environment(extra=extra), self.world.project, columns, lines)
        self.n = 0
        self.record = []
        self.t.wait_for(lambda s: any("? for shortcuts" in r or "─" * 20 in r for r in s.rows()), "the prompt", 40)
        self.t.settle()
        self.t._write("\x1b[<35;6;6M")  # the pointer off the pane

    def lines(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []

    def snap(self, label: str, timeout: float = 20.0) -> list[str]:
        rows = self.t.settle(quiet=0.6, timeout=timeout)
        self.n += 1
        (self.out / f"{self.n:03d}-{label}.txt").write_text("\n".join(rows) + "\n")
        return rows

    def pane(self, rows: list[str]) -> list[str]:
        """The pane's rows from its header down (right of the transcript when docked)."""
        top = next((i for i, r in enumerate(rows) if "input-probe " in r and "w=" in r), None)
        if top is None:
            return []
        col = rows[top].index("input-probe ")
        return [r[col:].rstrip() for r in rows[top:top + 12]]

    def step(self, label: str, send: str | None = None, wait: float = 1.0, timeout: float = 20.0,
             before: int | None = None) -> list[str]:
        """Sends `send` (raw), waits, and records what the probe logged since."""
        before = len(self.lines()) if before is None else before
        if send is not None:
            self.t._write(send)
        time.sleep(wait)
        rows = self.snap(label, timeout)
        new = self.lines()[before:]
        c = self.t.screen.cursor
        self.record.append({"step": label, "sent": send,
                            "events": [l for l in new if not l.split(" ", 1)[1].startswith("render #")],
                            "renders": [l.split(" ", 1)[1] for l in new if " render #" in l],
                            "composer": composer(rows), "pane": self.pane(rows), "ring": self.ring(),
                            "cursor": [c.x, c.y, "hidden" if c.hidden else "shown"]})
        return rows

    def ring(self) -> list[str]:
        """Rows the host draws inverse: the focus ring (the pointer is kept off)."""
        out = []
        for y, row in enumerate(self.t.styles()):
            xs = [x for x, c in enumerate(row) if c[3]]
            if xs:
                out.append(f"{y}:{xs[0]}-{xs[-1]}:" + "".join(row[x][0] for x in xs).replace(" ", "·"))
        return out

    def ctrlx_tab(self, label: str) -> None:
        self.t._write("\x18")
        time.sleep(0.25)
        self.step(label, TAB)

    def keys(self, label: str, *seqs: str, gap: float = 0.15) -> None:
        for seq in seqs[:-1]:
            self.t._write(seq)
            time.sleep(gap)
        self.step(label, seqs[-1])

    def command(self, text: str, label: str) -> None:
        self.t.type(text)
        time.sleep(0.4)
        self.step(label, "\r", wait=1.5)

    def clear(self, n: int = 40) -> None:
        self.t._write(BS * n)
        time.sleep(0.4)

    def click_text(self, needle: str, label: str) -> None:
        rows = self.t.rows()
        before = len(self.lines())
        for y, r in enumerate(rows):
            if needle in r:
                x = width(r[:r.index(needle)])
                self.t.click(x + 2, y)
                time.sleep(0.2)
                self.t._write("\x1b[<35;6;6M")
                self.step(label, None, before=before)
                return
        self.record.append({"step": label, "failure": f"{needle!r} not on screen"})

    def close(self) -> None:
        (self.out / "steps.json").write_text(json.dumps(self.record, ensure_ascii=False, indent=1))
        self.t.close()
        self.world.remove()


def width(text: str) -> int:
    return sum(h.cell_width(ch) for ch in text)


SCENARIOS = {}


def scenario(fn):
    SCENARIOS[fn.__name__] = fn
    return fn


def run(fn):
    def wrapped(host, out):
        s = fn.session(host, out)
        try:
            fn(s)
        except h.ScenarioFailure as failure:
            s.record.append({"failure": str(failure)})
        finally:
            s.close()
    wrapped.__name__ = fn.__name__
    return wrapped


def with_env(**env):
    def deco(fn):
        fn.session = lambda host, out: Session(host, out, env={k: str(v) for k, v in env.items()})
        return scenario(run(fn))
    return deco


@with_env(PROBE_MODE="uncontrolled")
def focus(s):
    """Every way into the Input, and whether typing leaks into the composer."""
    s.step("start")
    s.command("/inputprobe", "open-pane")
    s.t.type("abc")
    s.step("type-abc-pane-open-unfocused")
    s.clear()
    s.command("/inputprobe focus", "ui.focus-q-from-composer")
    s.ctrlx_tab("ctrlx-tab")
    s.step("type-x-after-ctrlx-tab", "x")
    s.step("tab-1", TAB)
    s.step("type-ab-after-tab", "ab")
    s.step("tab-2", TAB)
    s.step("shift-tab-back", SHIFT_TAB)
    s.step("esc-1", ESC, wait=1.2)
    s.step("type-z-after-esc", "z")
    s.step("esc-2-empty-composer?", ESC, wait=1.2)
    s.clear()
    s.ctrlx_tab("ctrlx-tab-again")
    s.step("down-1", DOWN)
    s.step("down-2", DOWN)
    s.step("up-1", UP)
    s.step("up-2", UP)
    s.step("up-3", UP)
    # the 'to find' Button: $.ui.focus from inside the pane
    s.step("esc-3", ESC, wait=1.2)
    s.clear()
    s.ctrlx_tab("ctrlx-tab-3")
    for i in range(8):
        rows = s.t.rows()
        if any("to·find" in r for r in s.ring()):
            break
        s.step(f"seek-tofind-{i}", DOWN)
    s.step("enter-on-tofind", "\r")
    s.step("type-q-after-ui.focus", "q")
    s.step("esc-4", ESC, wait=1.2)
    s.clear()
    # a click on the field, from the composer
    s.click_text("entry one", "click-on-entry-one")
    s.step("type-j-after-click-entry", "j")
    s.clear()
    s.click_text("find:", "click-on-field")
    s.step("type-k-after-click", "k")
    s.step("esc-5", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe openfocus", "openfocus-already-open")
    s.step("type-o-after-openfocus", "o")
    s.step("esc-6", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="uncontrolled", PROBE_AUTOFOCUS="1")
def autofocus(s):
    """autoFocus: does the open with focus, or Ctrl+X Tab, start the ring on the Input?"""
    s.command("/inputprobe openfocus", "openfocus-fresh")
    s.step("type-a-after-openfocus", "a")
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.ctrlx_tab("ctrlx-tab")
    s.step("type-b-after-ctrlx-tab", "b")
    s.step("down", DOWN)
    s.step("esc-2", ESC, wait=1.2)
    s.clear()
    s.ctrlx_tab("ctrlx-tab-2-ring-kept?")
    s.step("type-c", "c")
    s.step("esc-3", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe close", "close")
    s.command("/inputprobe", "open-no-focus")
    s.step("type-d-in-composer", "d")
    s.clear()
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="uncontrolled")
def keys(s):
    """Esc, Enter, arrows, Tab, digit and letter hotkeys while the Input holds the keys."""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("down-to-field", DOWN)
    s.step("type-abc", "abc")
    s.step("digit-1", "1")
    s.step("digit-2", "2")
    s.step("digit-3", "3")
    s.step("letter-l", "l")
    s.step("left", LEFT)
    s.step("left-2", LEFT)
    s.step("backspace", BS)
    s.step("right", RIGHT)
    s.step("ctrl-a", "\x01")
    s.step("ctrl-e", "\x05")
    s.step("ctrl-u", "\x15")
    s.step("type-xyz", "xyz")
    s.step("enter", "\r")
    s.step("enter-again", "\r")
    s.step("down", DOWN)
    s.step("down-2", DOWN)
    s.step("enter-on-entry", "\r")
    s.step("digit-2-on-entry", "2")
    s.step("letter-l-on-entry", "l")
    s.step("up", UP)
    s.step("up-2", UP)
    s.step("up-3", UP)
    s.step("type-after-up-3", "w")
    s.step("tab", TAB)
    s.step("esc", ESC, wait=1.2)
    s.step("type-after-esc", "m")
    s.clear()
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="uncontrolled")
def cleared(s):
    """Uncontrolled: can the mod clear or set the field (value '' / 'foo' drawn once)?"""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("down-to-field", DOWN)
    s.step("type-hello", "hello")
    for i in range(8):
        if any(":clear" in r for r in s.ring()):
            break
        s.step(f"seek-clear-{i}", DOWN)
    s.step("enter-on-clear", "\r")
    s.step("tab-back-to-field?", SHIFT_TAB)
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.ctrlx_tab("ctrlx-tab-2")
    s.step("down-to-field-2", DOWN)
    s.step("type-again", "again")
    s.step("esc-2", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe set foo", "set-foo-by-command")
    s.command("/inputprobe bump", "bump-redraw")
    s.ctrlx_tab("ctrlx-tab-3")
    s.step("down-to-field-3", DOWN)
    s.step("type-bar", "bar")
    s.step("esc-3", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe clear", "clear-by-command")
    s.command("/inputprobe bump", "bump-redraw-2")
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="controlled")
def controlled(s):
    """Controlled: value={query} every draw; clear by Button and by command."""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("down-to-field", DOWN)
    s.step("type-hello", "hello")
    s.step("type-fast", "world")
    s.step("left-left", LEFT + LEFT)
    s.step("type-mid", "M")
    s.step("enter-submit", "\r")
    s.step("type-after-submit", "Q")
    for i in range(8):
        if any(":clear" in r for r in s.ring()):
            break
        s.step(f"seek-clear-{i}", DOWN)
    s.step("enter-on-clear", "\r")
    s.step("shift-tab-back", SHIFT_TAB)
    s.step("type-after-clear", "z")
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe set foo", "set-foo-by-command")
    s.command("/inputprobe clear", "clear-by-command")
    s.command("/inputprobe log", "log")


def rate_body(s):
    """How often onInput fires: one key at a time, a burst in one write, a paste; with 5000 filler rows."""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("tab-to-field", TAB)
    b = len(s.lines())
    for ch in "row 1":
        s.t._write(ch)
        time.sleep(0.12)
    s.step("typed-row-1-at-120ms", None, wait=1.5, before=b)
    s.t._write("\x15")
    time.sleep(0.5)
    b = len(s.lines())
    for ch in "turn 77":
        s.t._write(ch)
        time.sleep(0.02)
    s.step("typed-turn-77-at-20ms", None, wait=1.5, before=b)
    s.t._write("\x15")
    time.sleep(0.5)
    s.step("burst-one-write", "abcdefghij", wait=1.5)
    s.t._write("\x15")
    time.sleep(0.5)
    s.step("bracketed-paste", "\x1b[200~pasted text 20c\x1b[201~", wait=1.5)
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="uncontrolled", PROBE_ROWS="5000")
def rate(s):
    """How often onInput fires: one key at a time, a burst in one write, a paste; 5000 filler rows, 8 drawn."""
    rate_body(s)


@with_env(PROBE_MODE="uncontrolled", PROBE_ROWS="5000", PROBE_DRAW="400")
def rateheavy(s):
    """As rate, with 400 matching rows drawn (more than the pane shows)."""
    rate_body(s)


def narrow_at(s, columns):
    s.command(f"/inputprobe open {columns}", f"open-{columns}-columns")
    s.ctrlx_tab(f"ctrlx-tab-{columns}")
    s.step(f"down-to-field-{columns}", DOWN)
    s.step(f"type-long-{columns}", "a long query that runs past the edge of the pane", wait=1.5)
    s.step(f"home-{columns}", "\x01")
    s.t._write("\x15")
    time.sleep(0.4)
    s.step(f"type-cjk-{columns}", "搜索中文对话的轮次标题和内容", wait=1.5)
    s.step(f"backspace-cjk-{columns}", BS)
    s.step(f"left-cjk-{columns}", LEFT + LEFT)
    s.step(f"type-mixed-{columns}", "ab中", wait=1.0)
    s.step(f"esc-{columns}", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe close", f"close-{columns}")


@with_env(PROBE_MODE="uncontrolled")
def narrow(s):
    """36, 44, 56 columns docked (170 wide), then inline at 100: long text and CJK."""
    for columns in (36, 44, 56):
        narrow_at(s, columns)
    s.t.resize(100, 48)
    time.sleep(1)
    s.command("/inputprobe", "open-inline-100")
    s.ctrlx_tab("ctrlx-tab-inline")
    s.step("down-inline", DOWN)
    s.step("tab-to-field-inline", TAB)
    s.step("type-cjk-inline", "搜索中文", wait=1.2)
    s.step("esc-inline", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="uncontrolled")
def keep(s):
    """Does the typed value survive redraws, a terminal resize, a back tab, Esc, and close/reopen?"""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("down-to-field", DOWN)
    s.step("type-keep", "keep")
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe bump", "bump-redraw")
    s.t.resize(160, 48)
    s.step("resize-160", None, wait=1.5)
    s.command("/inputprobe open2", "open-pane2-front")
    s.t._write("\x18")
    time.sleep(0.25)
    s.step("pane-next-back-to-probe", ".")
    s.command("/inputprobe close2", "close-pane2")
    s.ctrlx_tab("ctrlx-tab-after-tabs")
    s.step("down-to-field-2", DOWN)
    s.step("type-more", "X")
    s.step("esc-2", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe close", "close")
    s.command("/inputprobe", "reopen")
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="uncontrolled")
def draft(s):
    """With a draft in the composer: does the Input still take the keys, and is the draft kept?"""
    s.command("/inputprobe", "open-pane")
    s.t.type("draft")
    time.sleep(0.3)
    s.ctrlx_tab("ctrlx-tab-over-draft")
    s.step("down-to-field", DOWN)
    s.step("type-q", "q")
    s.step("esc", ESC, wait=1.2)
    s.step("type-after-esc", "!")
    s.clear()
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="fixed")
def fixed(s):
    """value='fixed' drawn on every redraw: does each redraw put it back over the typing?"""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("down-to-field", DOWN)
    s.step("type-a", "a")
    s.step("type-b", "b")
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe bump", "bump-redraw")
    s.command("/inputprobe log", "log")


@with_env(PROBE_MODE="controlled")
def tabkey(s):
    """Tab and Shift+Tab with the ring on the field and on a Button; a non-hotkey letter on a Button."""
    s.command("/inputprobe", "open-pane")
    s.ctrlx_tab("ctrlx-tab")
    s.step("tab-from-nothing", TAB)
    s.step("tab-2", TAB)
    s.step("tab-3", TAB)
    s.step("shift-tab", SHIFT_TAB)
    s.step("down-to-field?", DOWN)
    s.step("type-ab", "ab")
    s.step("tab-from-field", TAB)
    s.step("letter-z-on-button", "z")
    s.ctrlx_tab("ctrlx-tab-2")
    s.step("ring-kept?", None)
    s.step("esc", ESC, wait=1.2)
    s.clear()
    s.command("/inputprobe log", "log")


def main() -> None:
    host = host_of(sys.argv[1])
    out = pathlib.Path(sys.argv[2]).resolve() / host.version
    for name in sys.argv[3:]:
        SCENARIOS[name](host, out / name)


if __name__ == "__main__":
    main()
