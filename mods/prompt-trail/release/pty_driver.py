"""A real Claude Code in a pseudo-terminal, read through a terminal emulator.

Each Environment is a throwaway HOME, config directory, project and TMPDIR, so
nothing here reads or writes the person's own Claude Code or Prompt Trail data.
Raw terminal bytes never reach the disk: only emulated screens are kept, and
only after the scanner has masked every marker and secret in them."""
import fcntl
import json
import os
import pathlib
import pty
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

import pyte

import evidence

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
import semantic_verifier  # noqa: E402

KEYS = {
    "enter": "\r",
    "esc": "\x1b",
    "up": "\x1b[A",
    "down": "\x1b[B",
    "right": "\x1b[C",
    "left": "\x1b[D",
    "tab": "\t",
    "backspace": "\x7f",
    "ctrl-c": "\x03",
    "ctrl-x": "\x18",
}


class ScenarioFailure(Exception):
    pass


class Host:
    """One Claude Code version, as npm publishes it."""

    def __init__(self, version: str) -> None:
        self.version = version
        found = subprocess.run(
            ["npx", "-y", "-p", f"@anthropic-ai/claude-code@{version}", "sh", "-c", "command -v claude"],
            capture_output=True, text=True, check=True,
        ).stdout.strip().splitlines()[-1]
        self.binary = str(pathlib.Path(found).resolve())
        reported = subprocess.run(
            [self.binary, "--version"], capture_output=True, text=True, check=True
        ).stdout.split()[0]
        if reported != version:
            raise RuntimeError(f"npx gave Claude Code {reported}, not {version}")


class _Screen(pyte.Screen):
    """Answers the host's terminal queries, as a real terminal would."""

    def __init__(self, columns: int, lines: int, reply) -> None:
        super().__init__(columns, lines)
        self._reply = reply

    def write_process_input(self, data: str) -> None:
        self._reply(data)


class Terminal:
    def __init__(
        self, env: "Environment", argv: list[str], cwd: pathlib.Path, columns: int, lines: int,
    ) -> None:
        self.env = env
        self.lock = threading.Lock()
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                os.chdir(cwd)
                os.execve(argv[0], argv, env.process_environment())
            finally:
                os._exit(127)
        self.screen = _Screen(columns, lines, self._write)
        self.stream = pyte.ByteStream(self.screen)
        self._set_size(columns, lines)
        self.closed = False
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _set_size(self, columns: int, lines: int) -> None:
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", lines, columns, 0, 0))

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

    # Input.
    def type(self, text: str) -> None:
        self._write(text)

    def paste(self, text: str) -> None:
        self._write(f"\x1b[200~{text}\x1b[201~")

    def key(self, *names: str, pause: float = 0.15) -> None:
        for name in names:
            self._write(KEYS[name])
            time.sleep(pause)

    def click(self, column: int, row: int) -> None:
        """A left click on a 0-based cell, in SGR mouse encoding."""
        self._write(f"\x1b[<0;{column + 1};{row + 1}M")
        time.sleep(0.05)
        self._write(f"\x1b[<0;{column + 1};{row + 1}m")

    def resize(self, columns: int, lines: int) -> None:
        with self.lock:
            self.screen.resize(lines, columns)
        self._set_size(columns, lines)
        os.kill(self.pid, signal.SIGWINCH)

    # Output.
    def rows(self) -> list[str]:
        with self.lock:
            return [row.rstrip() for row in self.screen.display]

    def text(self) -> str:
        return "\n".join(self.rows())

    def find(self, needle: str) -> int | None:
        for index, row in enumerate(self.rows()):
            if needle in row:
                return index
        return None

    def cell(self, column: int, row: int):
        with self.lock:
            return self.screen.buffer[row][column]

    def wait_for(self, predicate, what: str, timeout: float = 30.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = predicate(self) if callable(predicate) else (predicate in self.text())
            if result:
                return result
            if self.closed:
                break
            time.sleep(0.1)
        self.env.snap(self, f"timed out: {what}")
        raise ScenarioFailure(f"timed out waiting for {what}")

    def wait_idle(self, timeout: float = 120.0) -> None:
        """Until the turn just asked for has run: first until it shows as
        running (a turn over within ten seconds may never be seen to), then
        until it no longer does. Returning early would queue the next prompt."""
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and "esc to interrupt" not in self.text():
            time.sleep(0.1)
        self.wait_for(lambda t: "esc to interrupt" not in t.text(), "the turn to end", timeout)

    def close(self) -> None:
        if not self.closed:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            finished, _ = os.waitpid(self.pid, os.WNOHANG)
            if finished:
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


class Environment:
    """One scenario's isolated world, scanned for leaks before it is removed."""

    def __init__(self, host: Host, scanner: evidence.Scanner, token: str, plugin_root: pathlib.Path) -> None:
        self.host = host
        self.scanner = scanner
        self.token = token
        self.plugin_root = plugin_root
        self.base = pathlib.Path(tempfile.mkdtemp(prefix="ptr-")).resolve()
        self.home = self.base / "home"
        self.config = self.home / ".claude"
        self.tmp = self.base / "tmp"
        for directory in (self.home, self.config, self.tmp):
            directory.mkdir(mode=0o700)
        self.projects: dict[str, pathlib.Path] = {}
        self.terminals: list[Terminal] = []
        self.trace: list[str] = []
        self.argv_samples = 0
        self.argv_leaks: list[dict] = []
        self._sampling = True
        self._sampler = threading.Thread(target=self._sample_argv, daemon=True)
        self._sampler.start()
        self._write_config()

    def project(self, name: str = "project") -> pathlib.Path:
        if name not in self.projects:
            path = self.base / name
            path.mkdir(mode=0o700)
            self.projects[name] = path
            self._write_config()
        return self.projects[name]

    def _write_config(self) -> None:
        (self.config / ".claude.json").write_text(json.dumps({
            "hasCompletedOnboarding": True,
            "theme": "dark",
            "projects": {
                str(path): {"hasTrustDialogAccepted": True, "hasCompletedProjectOnboarding": True}
                for path in self.projects.values()
            },
        }))

    def process_environment(self) -> dict[str, str]:
        return {
            "HOME": str(self.home),
            "CLAUDE_CONFIG_DIR": str(self.config),
            "TMPDIR": f"{self.tmp}/",
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TERM": "xterm-256color",
            "LANG": "en_US.UTF-8",
            "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
            "CLAUDE_CODE_OAUTH_TOKEN": self.token,
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "DISABLE_AUTOUPDATER": "1",
        }

    def launch(
        self, *args: str, project: str = "project", columns: int = 120, lines: int = 40,
        plugins: list[pathlib.Path] = (),
    ) -> Terminal:
        argv = [self.host.binary, "--model", "haiku", "--plugin-dir", str(self.plugin_root)]
        for extra in plugins:
            argv += ["--plugin-dir", str(extra)]
        terminal = Terminal(self, argv + list(args), self.project(project), columns, lines)
        self.terminals.append(terminal)
        return terminal

    def archive(self, project: str = "project") -> dict | None:
        """The one project archive's events by meaning, or None before it exists."""
        found = sorted((self.config / "plugins" / "data").glob("*/archives/*.sqlite3"))
        if not found:
            return None
        if len(found) > 1 and project == "project":
            raise ScenarioFailure(f"expected one project archive, found {len(found)}")
        return semantic_verifier.describe(found[0])

    def snap(self, terminal: Terminal, label: str) -> None:
        columns = terminal.screen.columns
        rows = self.scanner.redact_rows(
            [row.ljust(columns) for row in terminal.rows()], width=columns
        )
        self.trace.append(
            f"==== {label} ({columns}x{terminal.screen.lines})\n"
            + "\n".join(row.rstrip() for row in rows)
        )

    def _sample_argv(self) -> None:
        """Every process's argv, sampled while the scenario runs: the helper
        must take prompt text on stdin only."""
        mine = str(self.base)
        while self._sampling:
            listing = subprocess.run(
                ["/bin/ps", "-axww", "-o", "args="], capture_output=True, text=True
            ).stdout
            for line in listing.splitlines():
                if "prompt-trail-helper" in line and mine in line:
                    self.argv_samples += 1
                for kind in self.scanner.find(line.encode()):
                    self.argv_leaks.append({"path": "argv sample", "kind": kind})
            time.sleep(0.25)

    def finish(self) -> dict:
        """Stops every terminal, scans the whole world and removes it."""
        for terminal in self.terminals:
            terminal.close()
        self._sampling = False
        self._sampler.join(timeout=5)
        found = evidence.scan_tree(self.base, self.scanner)
        for leak in found["leaks"]:
            leak["path"] = f"<scenario>/{leak['path']}"
        shutil.rmtree(self.base, ignore_errors=True)
        return {
            "scannedFiles": found["scannedFiles"],
            "allowedFiles": found["allowedFiles"],
            "argvSamples": self.argv_samples,
            "leaks": found["leaks"] + self.argv_leaks,
        }
