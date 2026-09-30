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
import re
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
# A host daemon's socket directory, as lsof names a file under it.
_DAEMON_DIRECTORY = re.compile(rf"^n((?:/private)?/tmp/cc-daemon-{os.getuid()}/[^/]+)/")
sys.path.insert(0, str(ROOT / "tests"))
import semantic_verifier  # noqa: E402

# What Prompt Trail must never start: a compiler, a change to extended
# attributes or to the system's security policy, or a network client.
FORBIDDEN_PROGRAMS = {
    "cc", "clang", "gcc", "ld", "xcrun", "make", "swiftc",
    "xattr", "spctl", "codesign", "csrutil", "curl", "wget", "nc",
}

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


def _processes() -> list[tuple[int, int, str, str]]:
    """Every process: PID, parent PID, start time and argv."""
    listing = subprocess.run(
        ["/bin/ps", "-axww", "-o", "pid=,ppid=,lstart=,args="], capture_output=True, text=True
    ).stdout
    found = []
    for line in listing.splitlines():
        fields = line.split(None, 7) + [""]
        found.append((int(fields[0]), int(fields[1]), " ".join(fields[2:7]), fields[7]))
    return found


class ScenarioFailure(Exception):
    pass


class Host:
    """One Claude Code version, as npm publishes it: the native arm64 build,
    or the x86_64 build run under Rosetta, as on a Mac that took the Intel one."""

    def __init__(self, version: str, intel: bool = False) -> None:
        self.version = version
        if intel:
            self.binary = str(_intel_build(version))
            self.command = ["/usr/bin/arch", "-x86_64", self.binary]
        else:
            found = subprocess.run(
                ["npx", "-y", "-p", f"@anthropic-ai/claude-code@{version}", "sh", "-c", "command -v claude"],
                capture_output=True, text=True, check=True,
            ).stdout.strip().splitlines()[-1]
            self.binary = str(pathlib.Path(found).resolve())
            self.command = [self.binary]
        reported = subprocess.run(
            self.command + ["--version"], capture_output=True, text=True, check=True
        ).stdout.split()[0]
        if reported != version:
            raise RuntimeError(f"npm gave Claude Code {reported}, not {version}")


def _intel_build(version: str) -> pathlib.Path:
    """The darwin-x64 package's binary, unpacked once into the release cache."""
    home = pathlib.Path.home() / ".cache" / "prompt-trail-release" / "hosts" / f"darwin-x64-{version}"
    binary = home / "package" / "claude"
    if not binary.exists():
        home.mkdir(parents=True, exist_ok=True)
        packed = subprocess.run(
            ["npm", "pack", f"@anthropic-ai/claude-code-darwin-x64@{version}", "--pack-destination", str(home)],
            capture_output=True, text=True, check=True,
        ).stdout.strip().splitlines()[-1]
        subprocess.run(["/usr/bin/tar", "-xzf", str(home / packed), "-C", str(home)], check=True)
    return binary


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

    def hover(self, column: int, row: int) -> None:
        """The pointer moving onto a 0-based cell, with no button held."""
        self._write(f"\x1b[<35;{column + 1};{row + 1}M")

    def click(self, column: int, row: int) -> None:
        """A left click on a 0-based cell, in SGR mouse encoding, after the
        pointer moves onto it: the host hit-tests a press against what the
        pointer last hovered, as a real terminal's motion reports let it."""
        self.hover(column, row)
        time.sleep(0.3)
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

    def reversed_rows(self) -> list[str]:
        """The rows whose first visible cell is drawn reversed, as a focused
        Button is, read from one frame."""
        with self.lock:
            found = []
            for y, text in enumerate(self.screen.display):
                line = self.screen.buffer[y]
                first = next((x for x in range(self.screen.columns) if line[x].data.strip()), None)
                if first is not None and line[first].reverse:
                    found.append(text.rstrip())
            return found

    def styled_rows(self) -> list[tuple[str, "pyte.screens.Char | None"]]:
        """Each row with its first visible cell, read from one frame: whether
        a row is drawn reversed, and in which colour."""
        with self.lock:
            found = []
            for y, text in enumerate(self.screen.display):
                line = self.screen.buffer[y]
                first = next((x for x in range(self.screen.columns) if line[x].data.strip()), None)
                found.append((text.rstrip(), None if first is None else line[first]))
            return found

    def reversed_spans(self) -> list[str]:
        """Each run of cells drawn reversed, as text, read from one frame: a
        focused Button in a Pane beside the transcript."""
        with self.lock:
            spans = []
            for y in range(self.screen.lines):
                line = self.screen.buffer[y]
                span = ""
                for x in range(self.screen.columns + 1):
                    if x < self.screen.columns and line[x].reverse:
                        span += line[x].data
                    elif span.strip():
                        spans.append(span.strip())
                        span = ""
                    else:
                        span = ""
            return spans

    def column(self, row: int, needle: str) -> int:
        """The 0-based cell where `needle` starts on a row, a wide character
        counted as the two cells it takes."""
        with self.lock:
            line = self.screen.buffer[row]
            text, columns = "", []
            for x in range(self.screen.columns):
                data = line[x].data
                text += data
                columns += [x] * len(data)
        return columns[text.index(needle)]

    def cell(self, column: int, row: int):
        with self.lock:
            return self.screen.buffer[row][column]

    def wait_for(self, predicate, what: str, timeout: float = 30.0, interval: float = 0.1):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = predicate(self) if callable(predicate) else (predicate in self.text())
            if result:
                return result
            if self.closed:
                break
            time.sleep(interval)
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

    def kill(self) -> None:
        """The host dies at once, as a crash would, and is reaped as its
        terminal would reap it: a process left a zombie still reads as running."""
        os.kill(self.pid, signal.SIGKILL)
        os.waitpid(self.pid, 0)
        self.reaped = True
        self.reader.join(timeout=2)

    def close(self) -> None:
        if getattr(self, "reaped", False):
            try:
                os.close(self.fd)
            except OSError:
                pass
            return
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
        self._watchers: list[threading.Thread] = []
        self.mode_violations: set[str] = set()
        self.names_seen: set[str] = set()
        self.side_effects: set[str] = set()
        self.socket_checks = 0
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
        plugins: list[pathlib.Path] = (), plugin_root: pathlib.Path | None = None,
        host: Host | None = None,
    ) -> Terminal:
        root = plugin_root or self.plugin_root
        argv = [*(host or self.host).command, "--model", "haiku", "--plugin-dir", str(root)]
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

    def private_modes(self) -> list[str]:
        """Prompt Trail's directories that are not 0700 and its files that are
        not 0600, each as its path under the config directory and its mode:
        its data, archives, quarantine, session index and process locators."""
        data = self.config / "plugins" / "data"
        found = []
        for top in (data / "prompt-trail-inline", data / ".function-hook-locators" / "prompt-trail"):
            if not top.exists():
                continue
            for path in [top, *top.rglob("*")]:
                try:
                    status = path.lstat()
                except FileNotFoundError:
                    continue  # Gone between the listing and the look.
                mode = status.st_mode & 0o777
                wanted = 0o700 if path.is_dir() and not path.is_symlink() else 0o600
                if mode != wanted:
                    found.append(f"{path.relative_to(self.config)} {mode:04o}")
        return found

    def watch_modes(self, interval: float = 0.05) -> None:
        """Samples Prompt Trail's modes until the world finishes, so a file
        that stands only a moment is looked at too; every name seen is kept."""
        def sample() -> None:
            while self._sampling:
                self.mode_violations.update(self.private_modes())
                inline = self.config / "plugins" / "data" / "prompt-trail-inline"
                if inline.exists():
                    self.names_seen.update(path.name for path in inline.rglob("*"))
                time.sleep(interval)
        self._watch(sample)

    def watch_side_effects(self, interval: float = 0.1) -> None:
        """Samples the world's processes until it finishes: any forbidden
        program, and any network socket a Prompt Trail process holds."""
        def sample() -> None:
            while self._sampling:
                # The hosts themselves, whose argv does not name the world.
                hosts = frozenset(t.pid for t in self.terminals if not t.closed)
                processes = self._world_processes(hosts)
                for pid, (_, args) in processes.items():
                    program = pathlib.Path(args.split(" ", 1)[0]).name
                    if program in FORBIDDEN_PROGRAMS:
                        self.side_effects.add(f"started {program}")
                    if "prompt-trail-helper" in args or "prompt-trail-bridge" in args:
                        # Every open file by type; a process gone before it
                        # was looked at is no check at all.
                        listing = subprocess.run(
                            ["/usr/sbin/lsof", "-p", str(pid), "-F", "t"], capture_output=True, text=True,
                        ).stdout.splitlines()
                        if f"p{pid}" not in listing:
                            continue
                        self.socket_checks += 1
                        if any(line in ("tIPv4", "tIPv6") for line in listing):
                            self.side_effects.add(f"{program} opened a network socket")
                time.sleep(interval)
        self._watch(sample)

    def _watch(self, sample) -> None:
        watcher = threading.Thread(target=sample, daemon=True)
        watcher.start()
        self._watchers.append(watcher)

    def snap(self, terminal: Terminal, label: str) -> None:
        columns = terminal.screen.columns
        rows = self.scanner.redact_rows(
            [row.ljust(columns) for row in terminal.rows()], width=columns
        )
        self.trace.append(
            f"==== {label} ({columns}x{terminal.screen.lines})\n"
            + "\n".join(row.rstrip() for row in rows)
        )

    def _stop_background(self) -> list[dict]:
        """A background `/fork` starts a host daemon that outlives the terminal
        that asked for it, with sockets under /tmp/cc-daemon-<uid>/, outside the
        world. Its processes are stopped and its directories scanned and removed;
        whatever cannot be is a leak."""
        processes = self._world_processes()
        directories = set()
        leaks = []
        for pid, (_, args) in processes.items():
            listing = subprocess.run(
                ["/usr/sbin/lsof", "-a", "-p", str(pid), "-F", "n"], capture_output=True, text=True
            ).stdout
            found = {pathlib.Path(m.group(1)) for m in map(_DAEMON_DIRECTORY.match, listing.splitlines()) if m}
            if " daemon run " in f" {args} " and not found:
                # A daemon whose directory cannot be named cannot be scanned.
                leaks.append({"path": "<daemon>", "kind": "not inventoried"})
            directories |= found
        for sig in (signal.SIGTERM, signal.SIGKILL):
            # Only a process still the one listed: a PID freed by the first
            # signal may already name another process.
            for pid in self._still_running(processes):
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and self._still_running(processes):
                time.sleep(0.1)
        if self._still_running(processes):
            leaks.append({"path": "<daemon process>", "kind": "not stopped"})
        for directory in sorted(directories):
            if not directory.exists():
                continue  # The daemon removed it on the way out.
            found = evidence.scan_tree(directory, self.scanner, config="<none>")
            leaks += [dict(leak, path=f"<daemon>/{leak['path']}") for leak in found["leaks"]]
            shutil.rmtree(directory, ignore_errors=True)
            if directory.exists():
                leaks.append({"path": "<daemon>", "kind": "not removed"})
        return leaks

    def _world_processes(self, roots: frozenset[int] = frozenset()) -> dict[int, tuple[str, str]]:
        """Processes that name the world in their argv (a daemon names the
        directory that spawned it), and the `roots` given, with everything
        they started: each PID with its start time and argv."""
        rows = {}
        for pid, ppid, started, args in _processes():
            rows[pid] = (ppid, started, args)
        found = {pid for pid, (_, _, args) in rows.items() if str(self.base) in args and pid != os.getpid()}
        found |= roots & rows.keys()
        while True:
            children = {pid for pid, (ppid, _, _) in rows.items() if ppid in found} - found
            if not children:
                return {pid: rows[pid][1:] for pid in sorted(found)}
            found |= children

    @staticmethod
    def _still_running(processes: dict[int, tuple[str, str]]) -> list[int]:
        """The listed processes that still run, each still the process it was:
        the same PID started at the same time."""
        now = {pid: started for pid, _, started, _ in _processes()}
        return [pid for pid, (started, _) in processes.items() if now.get(pid) == started]

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
        """Stops every terminal and every process the world left running, scans
        the whole world and the daemon directories outside it, and removes them."""
        for terminal in self.terminals:
            terminal.close()
        self._sampling = False
        self._sampler.join(timeout=5)
        for watcher in self._watchers:
            watcher.join(timeout=5)
        daemon_leaks = self._stop_background()
        # A file a scenario made immutable to hold it in place would keep
        # the world from being removed.
        subprocess.run(["/usr/bin/chflags", "-R", "nouchg", str(self.base)], capture_output=True)
        found = evidence.scan_tree(
            self.base, self.scanner, config=str(self.config.relative_to(self.base))
        )
        for leak in found["leaks"]:
            leak["path"] = f"<scenario>/{leak['path']}"
        found["leaks"] += daemon_leaks
        shutil.rmtree(self.base, ignore_errors=True)
        if self.base.exists():
            # A world that outlives its scenario keeps prompt text on disk.
            found["leaks"].append({"path": "<scenario>", "kind": "not removed"})
        return {
            "scannedFiles": found["scannedFiles"],
            "allowedFiles": found["allowedFiles"],
            "argvSamples": self.argv_samples,
            "leaks": found["leaks"] + self.argv_leaks,
        }
