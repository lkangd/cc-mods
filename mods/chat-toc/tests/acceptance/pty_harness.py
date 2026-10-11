#!/usr/bin/env python3
"""A real Claude Code, in an isolated world, driven like a person would drive it.

World: a throwaway HOME and CLAUDE_CONFIG_DIR (onboarding done, the project
trusted, fullscreen layout on, no plugins but the ones given with
--plugin-dir), a project directory and TMPDIR. Nothing reads or writes the
person's own ~/.claude. Without CHAT_TOC_PTY_TOKEN the host is not logged in:
resumed synthetic transcripts, clicks, scrolls and local slash commands all
work, and no model is called. With CHAT_TOC_PTY_TOKEN (a `claude setup-token`
token) it is passed as CLAUDE_CODE_OAUTH_TOKEN and --model haiku is added, for
the few scenarios that need a real turn.

Two terminals with one interface (type, key, click, wheel, rows, find,
wait_for, snap, close):
  PyteTerminal   a pseudo-terminal read through pyte, any size, headless;
  CmuxTerminal   a split of the person's cmux workspace (opened with
                 --focus false, closed afterwards), read with read-screen.

Run: every launch belongs to a Run, a directory holding run.jsonl (one record
per scenario: scenario id, host, plugin, fixture, expected, actual, result,
evidence) and the screens snapped along the way.

    pty_harness.py smoke --host 2.1.287 --plugin mods/chat-toc [--terminal cmux]
"""
import argparse
import datetime
import fcntl
import json
import os
import pathlib
import pty
import shlex
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
PLUGIN = HERE.parents[1]                          # mods/chat-toc
# CHAT_TOC_PTY_RUNS puts every run of a release gate under one directory
RUNS = pathlib.Path(os.environ.get("CHAT_TOC_PTY_RUNS") or PLUGIN / "build" / "pty-runs")
sys.path.insert(0, str(HERE))
import toc_verifier  # noqa: E402
import transcript_fixture  # noqa: E402

KEYS = {"enter": "\r", "esc": "\x1b", "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
        "tab": "\t", "backspace": "\x7f", "ctrl-c": "\x03", "pgup": "\x1b[5~", "pgdn": "\x1b[6~",
        "home": "\x1b[H", "end": "\x1b[F"}
CMUX_KEYS = {"enter": "enter", "esc": "escape", "up": "up", "down": "down", "left": "left", "right": "right",
             "tab": "tab", "backspace": "backspace", "ctrl-c": "ctrl+c", "pgup": "pageup", "pgdn": "pagedown",
             "home": "home", "end": "end"}


class ScenarioFailure(Exception):
    pass


# ---------- hosts ----------

class Host:
    """One Claude Code version: "current" is the claude on PATH; any other
    version comes from npm through npx's cache, never the global install."""

    def __init__(self, version: str = "current") -> None:
        if version == "current":
            found = shutil.which("claude")
            if not found:
                raise RuntimeError("no claude on PATH")
            self.binary = str(pathlib.Path(found).resolve())
        else:
            out = subprocess.run(["npx", "-y", "-p", f"@anthropic-ai/claude-code@{version}", "sh", "-c", "command -v claude"],
                                 capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
            self.binary = str(pathlib.Path(out).resolve())
        self.version = subprocess.run([self.binary, "--version"], capture_output=True, text=True,
                                      check=True).stdout.split()[0]
        if version != "current" and self.version != version:
            raise RuntimeError(f"npm gave Claude Code {self.version}, not {version}")


# ---------- the isolated world ----------

class World:
    def __init__(self, root: pathlib.Path | None = None, token: str | None = None) -> None:
        self.token = token if token is not None else os.environ.get("CHAT_TOC_PTY_TOKEN") or None
        self.base = pathlib.Path(tempfile.mkdtemp(prefix="ctoc-", dir=root)).resolve()
        self.home = self.base / "home"
        self.config = self.home / ".claude"
        self.tmp = self.base / "tmp"
        self.project = self.base / "project"
        for folder in (self.home, self.config, self.tmp, self.project):
            folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.settings({"tui": "fullscreen"})
        (self.config / ".claude.json").write_text(json.dumps({
            "hasCompletedOnboarding": True, "theme": "dark", "numStartups": 5,
            "projects": {str(self.project): {"hasTrustDialogAccepted": True, "hasCompletedProjectOnboarding": True}},
        }))

    def settings(self, values: dict) -> None:
        path = self.config / "settings.json"
        current = json.loads(path.read_text()) if path.exists() else {}
        current.update(values)
        path.write_text(json.dumps(current))

    def environment(self, fullscreen: bool = True, extra: dict | None = None) -> dict[str, str]:
        env = {
            "HOME": str(self.home), "CLAUDE_CONFIG_DIR": str(self.config), "TMPDIR": f"{self.tmp}/",
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
            "COLORTERM": "truecolor", "DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        }
        if fullscreen:
            env["CLAUDE_CODE_NO_FLICKER"] = "1"
        else:
            env["CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN"] = "1"
        if self.token:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = self.token
        env.update(extra or {})
        return env

    def argv(self, host: Host, plugins=(), args=()) -> list[str]:
        argv = [host.binary]
        for plugin in plugins:
            argv += ["--plugin-dir", str(pathlib.Path(plugin).resolve())]
        if self.token:
            argv += ["--model", "haiku"]
        return argv + list(args)

    def fixture(self, kind: str, session: str = "00000000-0000-4000-8000-000000000001", **options) -> dict:
        return transcript_fixture.generate(kind, self.config, str(self.project), session, **options)

    def transcript(self, session: str) -> pathlib.Path:
        return transcript_fixture.project_dir(self.config, str(self.project)) / f"{session}.jsonl"

    def remove(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)


# ---------- screens ----------

def cell_width(char: str) -> int:
    return toc_verifier.cell_width(char)


class _Screen:
    """Shared reading helpers over rows()."""

    def text(self) -> str:
        return "\n".join(self.rows())

    def find(self, needle: str) -> tuple[int, int] | None:
        """(row, cell column) of the first occurrence, wide characters counted as two cells."""
        for y, row in enumerate(self.rows()):
            x = row.find(needle)
            if x >= 0:
                return y, sum(cell_width(c) for c in row[:x])
        return None

    def wait_for(self, predicate, what: str, timeout: float = 30.0, interval: float = 0.1):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = predicate(self) if callable(predicate) else (predicate in self.text())
            if result:
                return result
            time.sleep(interval)
        self.snap(f"timed out: {what}")
        raise ScenarioFailure(f"timed out waiting for {what}")

    def settle(self, quiet: float = 0.8, timeout: float = 20.0) -> list[str]:
        """Until the screen stops changing for `quiet` seconds."""
        deadline = time.monotonic() + timeout
        last, since = None, time.monotonic()
        while time.monotonic() < deadline:
            rows = self.rows()
            if rows != last:
                last, since = rows, time.monotonic()
            elif time.monotonic() - since >= quiet:
                break
            time.sleep(0.05)
        return last or []

    def command(self, text: str, wait: float = 1.5) -> None:
        """Types a slash command into an empty composer and submits it."""
        self.type(text)
        time.sleep(0.4)
        self.key("enter")
        time.sleep(wait)

    def snap(self, label: str) -> pathlib.Path | None:
        if self.run is None:
            return None
        return self.run.snap(self.rows(), label)


class PyteTerminal(_Screen):
    def __init__(self, argv: list[str], env: dict, cwd: pathlib.Path, columns: int = 170, lines: int = 44,
                 run: "Run | None" = None) -> None:
        import pyte

        class Screen(pyte.Screen):
            def write_process_input(inner, data: str) -> None:  # answers the host's terminal queries
                self._write(data)

        self.run = run
        self.lock = threading.Lock()
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                os.chdir(cwd)
                os.execve(argv[0], argv, env)
            finally:
                os._exit(127)
        self.screen = Screen(columns, lines)
        self.stream = pyte.ByteStream(self.screen)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", lines, columns, 0, 0))
        self.closed = False
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _write(self, data: str) -> None:
        try:
            os.write(self.fd, data.encode())
        except OSError:
            pass

    def _read(self) -> None:
        while True:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                break
            if not data:
                break
            with self.lock:
                self.stream.feed(data)
        self.closed = True

    def type(self, text: str) -> None:
        self._write(text)

    def key(self, *names: str, pause: float = 0.15) -> None:
        for name in names:
            self._write(KEYS[name])
            time.sleep(pause)

    def click(self, column: int, row: int) -> None:
        """A left click on a 0-based cell, after the pointer moves onto it."""
        self._write(f"\x1b[<35;{column + 1};{row + 1}M")
        time.sleep(0.3)
        self._write(f"\x1b[<0;{column + 1};{row + 1}M")
        time.sleep(0.05)
        self._write(f"\x1b[<0;{column + 1};{row + 1}m")

    def wheel(self, column: int, row: int, up: bool, ticks: int = 1, gap: float = 0.05) -> None:
        for _ in range(ticks):
            self._write(f"\x1b[<{64 if up else 65};{column + 1};{row + 1}M")
            time.sleep(gap)

    def resize(self, columns: int, lines: int) -> None:
        with self.lock:
            self.screen.resize(lines, columns)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", lines, columns, 0, 0))
        os.kill(self.pid, signal.SIGWINCH)

    def rows(self) -> list[str]:
        with self.lock:
            return [row.rstrip() for row in self.screen.display]

    def styles(self) -> list[list]:
        """Each row's cells (data, fg, bold, reverse): what read-screen cannot see, such as the cyan highlight."""
        with self.lock:
            return [[(c.data, c.fg, c.bold, c.reverse) for c in (self.screen.buffer[y][x] for x in range(self.screen.columns))]
                    for y in range(self.screen.lines)]

    def close(self) -> None:
        if not self.closed:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                done, _ = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                break
            if done:
                break
            time.sleep(0.1)
        else:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        self.reader.join(timeout=2)
        try:
            os.close(self.fd)
        except OSError:
            pass


def _cmux(*args: str) -> str:
    # only the trailing newline: a screen's first row may start with spaces
    return subprocess.run(["cmux", *args], capture_output=True, text=True, check=True).stdout.rstrip("\n")


def cmux_launch_command(argv: list[str], env: dict, cwd: pathlib.Path) -> str:
    """The shell line a cmux split runs: the isolated environment only, then the host."""
    assignments = " ".join(f"{k}={shlex.quote(v)}" for k, v in sorted(env.items()))
    return f"cd {shlex.quote(str(cwd))} && exec env -i {assignments} {shlex.join(argv)}"


class CmuxTerminal(_Screen):
    """A split of the person's current cmux workspace. Never focused, never
    another surface: only the one it opened, closed again by close()."""

    def __init__(self, argv: list[str], env: dict, cwd: pathlib.Path, direction: str = "down",
                 run: "Run | None" = None) -> None:
        self.run = run
        workspace = os.environ.get("CMUX_WORKSPACE_ID")
        if not workspace:
            raise RuntimeError("not inside cmux (no CMUX_WORKSPACE_ID)")
        out = _cmux("new-split", direction, "--workspace", workspace, "--focus", "false",
                    "--command", cmux_launch_command(argv, env, cwd))
        self.surface = next(word for word in out.split() if word.startswith("surface:"))
        self.workspace = workspace
        self.closed = False

    def type(self, text: str) -> None:
        _cmux("send", "--surface", self.surface, text)

    def key(self, *names: str, pause: float = 0.15) -> None:
        for name in names:
            _cmux("send-key", "--surface", self.surface, CMUX_KEYS[name])
            time.sleep(pause)

    def click(self, column: int, row: int) -> None:
        self.type(f"\x1b[<35;{column + 1};{row + 1}M")
        time.sleep(0.3)
        self.type(f"\x1b[<0;{column + 1};{row + 1}M")
        time.sleep(0.05)
        self.type(f"\x1b[<0;{column + 1};{row + 1}m")

    def wheel(self, column: int, row: int, up: bool, ticks: int = 1, gap: float = 0.05) -> None:
        for _ in range(ticks):
            self.type(f"\x1b[<{64 if up else 65};{column + 1};{row + 1}M")
            time.sleep(gap)

    def rows(self) -> list[str]:
        return [row.rstrip() for row in _cmux("read-screen", "--surface", self.surface).split("\n")]

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            _cmux("close-surface", "--surface", self.surface, "--workspace", self.workspace)
        except subprocess.CalledProcessError:
            pass


# ---------- runs and their log ----------

class Run:
    """One harness run's directory: run.jsonl and the screens it snapped."""

    def __init__(self, out: pathlib.Path | None = None, label: str = "run") -> None:
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.dir = pathlib.Path(out) if out else RUNS / f"{stamp}-{label}"
        (self.dir / "screens").mkdir(parents=True, exist_ok=True)
        self.count = 0
        self.records: list[dict] = []

    def snap(self, rows: list[str], label: str) -> pathlib.Path:
        self.count += 1
        safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in label)[:60]
        path = self.dir / "screens" / f"{self.count:03d}-{safe}.txt"
        path.write_text(f"==== {label} ({len(rows)} rows)\n" + "\n".join(rows) + "\n", encoding="utf-8")
        return path

    def record(self, scenario: str, *, host: str, plugin: str, fixture: str, expected, actual, result: str,
               evidence: list, notes: str = "") -> dict:
        if result not in ("pass", "fail", "skip"):
            raise ValueError(f"result must be pass, fail or skip, not {result!r}")
        entry = {"scenario": scenario, "host": host, "plugin": plugin, "fixture": fixture,
                 "os": f"{os.uname().sysname} {os.uname().release}", "arch": os.uname().machine,
                 "expected": expected, "actual": actual, "result": result,
                 "evidence": [str(pathlib.Path(e).resolve().relative_to(self.dir.resolve())) if pathlib.Path(e).is_absolute()
                              and str(pathlib.Path(e).resolve()).startswith(str(self.dir.resolve())) else str(e) for e in evidence],
                 "at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}
        if notes:
            entry["notes"] = notes
        self.records.append(entry)
        with open(self.dir / "run.jsonl", "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry


def launch(world: World, host: Host, plugins=(), args=(), terminal: str = "pyte", run: Run | None = None,
           columns: int = 170, lines: int = 44, fullscreen: bool = True, direction: str = "down", env: dict | None = None):
    argv = world.argv(host, plugins, args)
    environment = world.environment(fullscreen, env)
    if terminal == "cmux":
        return CmuxTerminal(argv, environment, world.project, direction=direction, run=run)
    return PyteTerminal(argv, environment, world.project, columns, lines, run=run)


# ---------- reading the whole Pane ----------

def transcript_text(rows: list[str], pane_left: int) -> str:
    """The screen left of the Pane border: what the transcript shows."""
    out = []
    for row in rows:
        kept, column = "", 0
        for char in row:
            if column >= pane_left - 1:
                break
            kept += char
            column += cell_width(char)
        out.append(kept.rstrip())
    return "\n".join(out)


def _signature(pane) -> tuple:
    return tuple((e.user_head, e.user_text, e.agent_head) for e in pane.entries) if pane else ()


def _wheel_point(term) -> tuple[int, int]:
    pane = toc_verifier.parse_pane(term.rows())
    if pane is None:
        raise ScenarioFailure("no chat-toc Pane on screen")
    return pane.left + 6, pane.filter_row + 4


def pane_to_top(term, limit: int = 300):
    """Wheels over the Pane until its window stops moving; the top window."""
    column, row = _wheel_point(term)
    previous, still = None, 0
    for _ in range(limit):
        term.wheel(column, row, up=True, ticks=10, gap=0.05)
        pane = toc_verifier.parse_pane(term.settle(quiet=0.4))
        still = still + 1 if _signature(pane) == previous else 0
        if still == 2:                        # a batch can land as no move; two in a row is the top
            return pane
        previous = _signature(pane)
    raise ScenarioFailure("the Pane never reached its top")


def read_whole_pane(term, step: int = 4, limit: int = 1000, snap: bool = True) -> list:
    """Every window of the Pane from its top to its bottom, wheeling over the
    Pane (which pauses its following), each snapped into the run. Feed the
    list to toc_verifier.compare_windows."""
    windows = [pane_to_top(term)]
    column, row = _wheel_point(term)
    if snap:
        term.snap("pane window 1 (top)")
    still = 0
    for _ in range(limit):
        term.wheel(column, row, up=False, ticks=step, gap=0.05)
        pane = toc_verifier.parse_pane(term.settle(quiet=0.4))
        if _signature(pane) == _signature(windows[-1]):
            still += 1
            if still == 2:
                return windows
            continue
        still = 0
        windows.append(pane)
        if snap:
            term.snap(f"pane window {len(windows)}")
    raise ScenarioFailure("the Pane never reached its bottom")


# ---------- the smoke scenario: proves the harness end to end ----------

def smoke(host_version: str, plugin: pathlib.Path, terminal: str, out: pathlib.Path | None, keep: bool,
          fixture_kind: str = "turns", turns: int = 40, whole_list: bool | None = None) -> int:
    """Resume a fixture with the plugin; wait for the Pane; diff the window it
    shows, then every window down its whole list, against the verifier. With
    the `turns` fixture, also click the first entry's user side and check the
    transcript then shows that prompt (it was far above the view). Wheel the
    transcript; close. One run.jsonl record, every screen kept."""
    host = Host(host_version)
    run = Run(out, f"smoke-{host.version}-{terminal}-{fixture_kind}")
    world = World()
    fixture = world.fixture(fixture_kind, turns=turns, version=host.version)
    expected = toc_verifier.expected_toc(pathlib.Path(fixture["path"]))
    term = launch(world, host, [plugin], ["--resume", fixture["session"]], terminal=terminal, run=run)
    evidence, actual, ok = [], {}, False
    try:
        docked = lambda t: (p := toc_verifier.parse_pane(t.rows())) is not None and p.entries  # noqa: E731
        try:
            term.wait_for(docked, "the Pane to open by itself", timeout=20)
        except ScenarioFailure:
            # too narrow to dock unasked (a cmux split): ask for it, which docks from 110 columns
            evidence.append(term.snap("no Pane by itself; asking with /chat-toc"))
            actual["openedWith"] = "/chat-toc"
            term.command("/chat-toc")
            term.wait_for(docked, "the Pane after /chat-toc", timeout=30)
        rows = term.settle()
        expected = toc_verifier.expected_toc(pathlib.Path(fixture["path"]))   # /chat-toc may have added a group
        evidence.append(term.snap("pane after resume"))
        first = toc_verifier.compare_window(expected.groups, toc_verifier.parse_pane(rows))
        actual["firstWindow"] = first["summary"] | {"ok": first["ok"]}

        ok = first["ok"]
        # Reading the whole list wheels the Pane window by window. Under cmux the
        # stand-in's window jumped both ways on cmux-sent wheel ticks, so there it
        # runs only when asked (--whole-list).
        if whole_list if whole_list is not None else terminal == "pyte":
            windows = read_whole_pane(term)
            diffs = [toc_verifier.compare_window(expected.groups, w) for w in windows]
            (run.dir / "whole-list-diff.json").write_text(json.dumps(diffs, ensure_ascii=False, indent=1))
            evidence.append(run.dir / "whole-list-diff.json")
            whole = toc_verifier.compare_windows(expected.groups, windows)
            actual["wholeList"] = {k: whole[k] for k in ("ok", "covered", "missing")} | {"windows": len(windows)}
            ok = ok and whole["ok"]

        if fixture_kind == "turns":
            try:
                top = pane_to_top(term)
            except ScenarioFailure:
                top = toc_verifier.parse_pane(term.rows())
            # a typed prompt: commands and !cmd jump to a neighbouring row instead
            target = next((e for e in top.entries if e.user_lines and e.user_lines[0][:1] not in "/!"), top.entries[0])
            term.click(top.left + 4, target.row + 1)
            rows = term.settle(quiet=1.0)
            evidence.append(term.snap(f"after clicking the user side of {target.user_text[:5]}"))
            jumped = target.user_lines[0][:12] in transcript_text(rows, top.left)
            actual["click"] = {"entry": target.user_text, "transcriptShowsIt": jumped}
            ok = ok and jumped

        pane = toc_verifier.parse_pane(term.rows())
        term.wheel(max(2, pane.left // 2), 10, up=True, ticks=10)
        term.settle()
        evidence.append(term.snap("after 10 wheel ticks up over the transcript"))
        if keep:
            input("press Enter to close the session ")
    except ScenarioFailure as failure:
        ok = False
        actual["failure"] = str(failure)
    finally:
        term.close()
        world.remove()
    run.record("HARNESS-SMOKE", host=host.version, plugin=str(plugin), fixture=fixture_kind,
               expected=f"the Pane lists the {len(expected.groups)} groups of the transcript chain in order"
                        + ("; clicking the first entry's user side shows that prompt" if fixture_kind == "turns" else ""),
               actual=actual, result="pass" if ok else "fail", evidence=evidence)
    print(json.dumps(run.records[-1], ensure_ascii=False, indent=1))
    print(f"run directory: {run.dir}")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("smoke", help="resume a fixture with a plugin and diff the whole Pane against the verifier")
    s.add_argument("--host", default="current", help='"current" or an npm version such as 2.1.287')
    s.add_argument("--plugin", type=pathlib.Path, default=PLUGIN)
    s.add_argument("--terminal", choices=["pyte", "cmux"], default="pyte")
    s.add_argument("--fixture", choices=["turns", "forms"], default="turns")
    s.add_argument("--turns", type=int, default=40)
    s.add_argument("--out", type=pathlib.Path)
    s.add_argument("--keep", action="store_true", help="wait for Enter before closing")
    s.add_argument("--whole-list", action=argparse.BooleanOptionalAction, default=None,
                   help="wheel through and diff every Pane window (default: on for pyte, off for cmux)")
    a = parser.parse_args()
    return smoke(a.host, a.plugin, a.terminal, a.out, a.keep, a.fixture, a.turns, a.whole_list)


if __name__ == "__main__":
    sys.exit(main())


