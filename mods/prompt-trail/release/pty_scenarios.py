"""PTY scenarios: each drives a real Claude Code in its own isolated world and
returns what it saw, in words that carry no prompt text. A failed check raises
ScenarioFailure; the trace keeps a masked screen at each step."""
import contextlib
import hashlib
import json
import pathlib
import re
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import time
from collections.abc import Callable, Iterator

import evidence
from pty_driver import Environment, Host, ScenarioFailure, Terminal, _processes
import helper_protocol  # tests/, put on the path by pty_driver
import timeline_fixture

FIXTURE = pathlib.Path(__file__).resolve().parent / "fixtures" / "downstream"
SCENARIOS: dict = {}


def scenario(id_: str):
    def register(function):
        SCENARIOS[id_] = function
        return function
    return register


def check(condition: bool, what: str) -> None:
    if not condition:
        raise ScenarioFailure(what)


@contextlib.contextmanager
def write_lock(database: pathlib.Path) -> Iterator[None]:
    """Holds the archive's write lock for the block, so a write that waits on
    it fails after its bounded wait."""
    lock = sqlite3.connect(database, timeout=0, isolation_level=None)
    try:
        lock.execute("BEGIN IMMEDIATE")
    except BaseException:
        lock.close()
        raise
    try:
        yield
    finally:
        lock.execute("ROLLBACK")
        lock.close()


def select_option(
    terminal: Terminal, option: str, on_selected: Callable[[], None], *, until_gone: bool = False,
    absent: str | None = None, unreached: str | None = None,
) -> None:
    """Moves the dialog's selection onto the numbered `option` and runs
    `on_selected` there, once; with `until_gone` it runs each time the
    selection stands on it, until the dialog no longer offers it. A dialog
    just drawn may not take keys yet. Without `until_gone`, a dialog that does
    not offer `option` fails with `absent`, and a selection that never gets
    there with `unreached`."""
    pattern = re.compile(rf"^\s*(❯)?\s*\d+\. {re.escape(option)}$")
    time.sleep(1)
    for _ in range(10):
        found = [m for m in map(pattern.match, terminal.rows()) if m]
        if not found and until_gone:
            return
        check(bool(found), absent or f"the dialog does not offer {option}")
        if found[-1].group(1):
            on_selected()
            if not until_gone:
                return
        else:
            terminal.key("down", pause=0.5)
    raise ScenarioFailure(unreached or f"could not choose {option}")


class Context:
    def __init__(self, env: Environment, scanner: evidence.Scanner) -> None:
        self.env = env
        self.scanner = scanner

    def marker(self, scenario_id: str) -> str:
        marker = evidence.new_marker(scenario_id)
        self.scanner.add(marker)
        return marker

    def start(self, terminal: Terminal) -> None:
        terminal.wait_for("Prompt Trail", "the Prompt Trail band", 60)
        terminal.wait_for("❯", "the prompt box", 30)
        self.env.snap(terminal, "started")

    def send(self, terminal: Terminal, text: str) -> None:
        """Types `text` and presses Enter apart from it: an Enter that arrives
        with the text reads as part of a paste and stays in the prompt box."""
        terminal.type(text)
        time.sleep(0.5)
        terminal.key("enter")

    def submit(self, terminal: Terminal, text: str, consent: bool = False) -> None:
        """Types a prompt and sends it; answers the consent question with 启用
        when asked to, then waits for the turn to end."""
        self.send(terminal, text)
        if consent:
            terminal.wait_for("采集同意", "the consent question", 30)
            self.env.snap(terminal, "consent asked")
            self.choose(terminal, "启用")
        terminal.wait_idle()
        self.env.snap(terminal, "submitted")

    def choose(self, terminal: Terminal, option: str) -> None:
        """Moves the dialog's selection onto the numbered `option` and confirms
        it, until the dialog has gone: a dialog just drawn may not take keys yet."""
        select_option(terminal, option, lambda: terminal.key("enter", pause=1), until_gone=True)

    def command(self, terminal: Terminal, text: str, expect: str, timeout: float = 30) -> str:
        """Runs a slash command and returns what the screen shows after its
        echo, once that holds `expect`; earlier answers still on screen do not count."""
        terminal.type(text)
        time.sleep(0.3)
        terminal.key("enter")
        return self.reply(terminal, text, expect, timeout)

    def reply(
        self, terminal: Terminal, command: str, expect: str, timeout: float = 30,
        *, flatten: bool = False, label: str | None = None,
    ) -> str:
        """What the screen shows after the last echo of `command`, once that
        holds `expect`, snapped as `label`; with `flatten` as one line, for
        answers the host wraps. The command is not sent here."""
        def answered(t: Terminal) -> str | None:
            rows = t.rows()
            echoes = [i for i, row in enumerate(rows) if row.strip() == f"❯ {command}"]
            if not echoes:
                return None
            after = "\n".join(rows[echoes[-1] + 1:])
            if flatten:
                after = flat(after)
            return after if expect in after else None

        after = terminal.wait_for(answered, f"{command} to answer", timeout)
        self.env.snap(terminal, label or command)
        return after

    def expand(self, terminal: Terminal, marker: str) -> list[str]:
        """Opens the band and waits until it shows the entry `marker` names.
        A band already open (a Run taken up keeps its own) is folded first, so
        it opens on the latest events."""
        if (band := self.band(terminal)) and band[0].startswith("▾"):
            self.command(terminal, "/prompt-history", "已折叠")
        self.command(terminal, "/prompt-history", "已展开")
        terminal.wait_for(
            lambda t: any(
                marker[: evidence.MARKER_PREFIX] in row for row in self.band(t)
            ) and self.band(t)[0].startswith("▾"),
            "the band to open on the entry", 15,
        )
        self.env.snap(terminal, "band open")
        return self.band(terminal)

    def band(self, terminal: Terminal) -> list[str]:
        """The band's rows: its title row and what stands under it, down to
        the prompt box's top rule."""
        rows = terminal.rows()
        titles = [i for i, row in enumerate(rows) if row.startswith(("▸ Prompt Trail", "▾ Prompt Trail"))]
        if not titles:
            return []
        band = []
        for row in rows[titles[-1]:]:
            if row.startswith("────"):
                break
            band.append(row)
        return band

    def status(self, terminal: Terminal) -> str:
        return self.command(terminal, "/prompt-history status", "Prompt Trail status")

    def identity(self, terminal: Terminal) -> tuple[str, str]:
        """The Run and the Archive generation that status names, read once
        its last line, the Run, is drawn."""
        status = self.command(terminal, "/prompt-history status", "run: ")
        run = re.search(r"\brun: (\S+)", status)
        generation = re.search(r"Archive generation: (\S+)", status)
        check(run is not None and generation is not None, "status names no run or no generation")
        return run.group(1), generation.group(1)

    def relaunch(self, *args: str, **options) -> Terminal:
        """A new host process in the same project, ready for input."""
        terminal = self.env.launch(*args, **options)
        self.start(terminal)
        return terminal

    def exit(self, terminal: Terminal) -> None:
        """Leaves the host the ordinary way and waits for its process to end."""
        self.send(terminal, "/exit")
        terminal.wait_for(lambda t: t.closed, "the host to exit", 30)

    def session(self, marker: str) -> str:
        """The classic session whose transcript holds the marker: what a resume
        names, found as setup rather than asserted on."""
        found = [path.stem for path, text in self.transcripts() if marker in text]
        if len(found) != 1:
            raise ScenarioFailure(f"cannot name the session to resume: {len(found)} transcripts hold the prompt")
        return found[0]

    def focus(self, terminal: Terminal, row: str) -> None:
        """Enters the band and walks the focus ring up to the band row that
        begins as `row` does; entering starts on the latest entry."""
        terminal.key("ctrl-x", "tab", pause=0.5)
        for _ in range(20):
            if any(focused.startswith(row) for focused in terminal.reversed_rows()):
                self.env.snap(terminal, "entry focused")
                return
            terminal.key("up", pause=0.4)
        raise ScenarioFailure("could not move the focus onto the entry")

    def click_row(self, terminal: Terminal, row: str, needle: str) -> None:
        """Clicks the text `needle` names on the one row that holds `row`."""
        found = [i for i, text in enumerate(terminal.rows()) if row in text]
        check(len(found) == 1, f"{len(found)} rows to click")
        terminal.click(terminal.column(found[0], needle), found[0])

    def entries(self) -> list[dict]:
        archive = self.env.archive()
        return archive["entries"] if archive else []

    def pending(self) -> list[dict]:
        archive = self.env.archive()
        return archive["pending"] if archive else []

    def wait_entries(self, count: int, timeout: float = 30) -> list[dict]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            entries = self.entries()
            if len(entries) >= count:
                return entries
            time.sleep(0.2)
        raise ScenarioFailure(f"expected {count} Prompt Entries, found {len(self.entries())}")

    def transcript_rows(self, marker: str) -> int:
        """How many lines of the host's transcripts hold the marker."""
        return sum(
            sum(1 for line in text.splitlines() if marker in line) for _, text in self.transcripts()
        )

    def human_rows(self, marker: str) -> int:
        """How many of the host's human prompt rows hold the marker: user rows
        that are not meta, which is what a prompt that entered leaves once.
        Other rows (titles, queue operations, attachments) may quote it too."""
        count = 0
        for _, text in self.transcripts():
            for line in text.splitlines():
                if marker not in line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("type") == "user" and row.get("isMeta") is not True:
                    count += 1
        return count

    def transcripts(self):
        """Each host transcript in the scenario's world, with its text."""
        for path in (self.env.config / "projects").rglob("*.jsonl"):
            yield path, path.read_text()


def prompt(marker: str) -> str:
    return f"{marker} 这是自动化验收的测试输入，请只回复 ok"


@scenario("PT-COMPAT-001")
def compat_001(ctx: Context) -> str:
    marker = ctx.marker("PT-COMPAT-001")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    check("▸ Prompt Trail" in terminal.text(), "the band did not start collapsed")
    status = ctx.status(terminal)
    check("support: supported" in status, "status does not say supported")
    check("collection consent: not granted" in status, "consent was already granted")
    check("archive: not created" in status, "the probe created an archive")
    check(ctx.env.archive() is None, "an archive exists before consent")
    ctx.submit(terminal, prompt(marker), consent=True)
    entries = ctx.wait_entries(1)
    check(len(entries) == 1, f"{len(entries)} entries after the first prompt")
    return "collapsed band, supported status, no archive before consent, consent asked on the first prompt, 1 entry after it"


@scenario("PT-CAPTURE-001")
def capture_001(ctx: Context) -> str:
    marker = ctx.marker("PT-CAPTURE-001")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    entries = ctx.wait_entries(1)
    check(len(entries) == 1, f"{len(entries)} entries")
    check(entries[0]["promptText"] == prompt(marker), "the archived text is not the final text")
    check(not ctx.pending(), "a Pending Capture was left")
    shown = sum(1 for row in ctx.expand(terminal, marker) if marker[: evidence.MARKER_PREFIX] in row)
    check(shown == 1, f"the band shows the entry {shown} times")
    check(ctx.transcript_rows(marker) >= 1, "the transcript holds no such prompt")
    return f"1 entry at sequence {entries[0]['sequence']}, no pending, shown once in the band, present in the transcript"


@scenario("PT-CAPTURE-002")
def capture_002(ctx: Context) -> str:
    marker = ctx.marker("PT-CAPTURE-002")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.submit(terminal, prompt(marker))
    ctx.submit(terminal, prompt(marker))
    entries = ctx.wait_entries(3)
    check(len(entries) == 3, f"{len(entries)} entries")
    check(all(e["promptText"] == prompt(marker) for e in entries), "an entry holds other text")
    check(len({e["eventId"] for e in entries}) == 3, "event ids repeat")
    sequences = [e["sequence"] for e in entries]
    check(sequences == sorted(set(sequences)), "sequences are not strictly increasing")
    return f"3 distinct entries at sequences {sequences}"


@scenario("PT-CAPTURE-003")
def capture_003(ctx: Context) -> str:
    marker = ctx.marker("PT-CAPTURE-003")
    text = f"{prompt(marker)}\n\n中文宽字符 😀 é 第三行"
    terminal = ctx.env.launch(columns=100)
    ctx.start(terminal)
    terminal.paste(text)
    time.sleep(0.5)
    terminal.key("enter")
    terminal.wait_for("采集同意", "the consent question", 30)
    ctx.choose(terminal, "启用")
    terminal.wait_idle()
    entries = ctx.wait_entries(1)
    check(entries[0]["promptText"] == text, "the archived text is not verbatim")
    rows = [row for row in ctx.expand(terminal, marker) if marker[: evidence.MARKER_PREFIX] in row]
    check(len(rows) == 1, f"the entry takes {len(rows)} rows")
    check("↵" in rows[0], "the newline is not shown as ↵")
    return "multi-line CJK/emoji/combining text archived verbatim; shown on one row with ↵"


@scenario("PT-CAPTURE-004")
def capture_004(ctx: Context) -> str:
    marker = ctx.marker("PT-CAPTURE-004")
    project = ctx.env.project()
    image = project / "pixel.png"
    image.write_bytes(bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
    ))
    terminal = ctx.env.launch()
    ctx.start(terminal)
    terminal.paste(str(image))
    terminal.wait_for("[Image", "the image attachment", 15)
    ctx.send(terminal, f" {prompt(marker)}")
    terminal.wait_for("采集同意", "the consent question", 30)
    ctx.choose(terminal, "启用")
    terminal.wait_idle()
    entry = ctx.wait_entries(1)[0]
    check(entry["attachmentCount"] >= 1, "no attachment counted")
    archived = entry["promptText"] or ""
    check("pixel" not in archived and str(project) not in archived, "the attachment's name or path was archived")
    # An attachment alone: the host sends its own placeholder text, if any.
    terminal.paste(str(image))
    terminal.wait_for("[Image", "the image attachment", 15)
    time.sleep(0.5)
    terminal.key("enter")
    terminal.wait_idle()
    alone = ctx.wait_entries(2)[1]
    text = alone["promptText"] or ""
    check(alone["attachmentCount"] >= 1, "the attachment-only submission counted no attachment")
    check(re.fullmatch(r"(\[Image #\d+\]\s*)*", text) is not None, "the attachment-only entry holds more than the host's placeholder")
    return (
        f"with text: {entry['attachmentCount']} attachment(s) of kinds {entry['attachmentKinds']}; "
        f"alone: an entry with {alone['attachmentCount']} attachment(s) and "
        f"{'no text' if not text else 'only the host placeholder as text'}; no name or path archived"
    )


@scenario("PT-CAPTURE-005")
def capture_005(ctx: Context) -> str:
    marker = ctx.marker("PT-CAPTURE-005")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    ran = ["/cost"]
    # /cost answers in a settings panel of its own, closed with Esc.
    ctx.send(terminal, "/cost")
    terminal.wait_for("Total cost", "the /cost panel", 30)
    ctx.env.snap(terminal, "/cost")
    terminal.key("esc", pause=1)
    check(len(ctx.entries()) == 1, "/cost created a Prompt Entry")
    for command, expect in (
        ("/prompt-history status", "Prompt Trail status"),
        ("/reload-plugins", "eload"),
        ("/compact", "ompact"),
        ("/clear", "❯"),
    ):
        ctx.command(terminal, command, expect, timeout=120)
        terminal.wait_idle()
        ran.append(command)
        check(len(ctx.entries()) == 1, f"{command} created a Prompt Entry")
    ctx.send(terminal, "/rewind")
    time.sleep(2)
    ctx.env.snap(terminal, "/rewind menu")
    terminal.key("esc", "esc")
    ran.append("/rewind")
    time.sleep(1)
    check(len(ctx.entries()) == 1, "a slash command created a Prompt Entry")
    return f"{', '.join(ran)} created no Prompt Entry"


@scenario("PT-CAPTURE-006")
def capture_006(ctx: Context) -> str:
    marker = ctx.marker("PT-CAPTURE-006")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    ctx.command(terminal, "/compact", "ompact", timeout=120)
    terminal.wait_idle()
    for _ in range(2):
        ctx.command(terminal, "/prompt-history", "Prompt Trail")
    ctx.command(terminal, "/reload-plugins", "eload")
    time.sleep(2)
    check(len(ctx.entries()) == 1, "internal traffic created a Prompt Entry")
    return "compaction rows, band redraws and a reload's replay created no Prompt Entry"


@scenario("PT-CAPTURE-007")
def capture_007(ctx: Context) -> str:
    held = ctx.marker("PT-CAPTURE-007")
    dropped = ctx.marker("PT-CAPTURE-007")
    terminal = ctx.env.launch(plugins=[FIXTURE])
    ctx.start(terminal)
    ctx.submit(terminal, prompt(held), consent=True)
    ctx.wait_entries(1)
    # Prompt Trail must stand above the fixture: a held prompt is staged
    # before the fixture lets it on.
    ctx.send(terminal, f"{prompt(held)} PT-FIXTURE-HOLD")
    staged = terminal.wait_for(
        lambda _: any(held in (p["promptText"] or "") for p in ctx.pending()),
        "the held prompt to be staged", 15,
    )
    check(bool(staged), "the held prompt was not staged above the fixture")
    terminal.wait_idle()
    check("hook skipped" not in terminal.text(), "the fixture's hook failed, so nothing was held")
    ctx.wait_entries(2)
    ctx.send(terminal, f"{prompt(dropped)} PT-FIXTURE-DROP")
    terminal.wait_for("dropped by the release fixture", "the fixture's refusal", 15)
    ctx.env.snap(terminal, "dropped")
    time.sleep(1)
    check(not any(dropped in (e["promptText"] or "") for e in ctx.entries()), "the dropped prompt was archived")
    check(not ctx.pending(), "the dropped prompt's Pending Capture was left")
    return "Prompt Trail stages above the fixture; a prompt dropped beneath left no entry and no pending"


@scenario("PT-CAPTURE-008")
def capture_008(ctx: Context) -> str:
    first = ctx.marker("PT-CAPTURE-008")
    held = ctx.marker("PT-CAPTURE-008")
    after = ctx.marker("PT-CAPTURE-008")
    terminal = ctx.env.launch(plugins=[FIXTURE])
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.wait_entries(1)
    database = sorted((ctx.env.config / "plugins" / "data").glob("*/archives/*.sqlite3"))[0]
    ctx.send(terminal, f"{prompt(held)} PT-FIXTURE-HOLD")
    terminal.wait_for(
        lambda _: any(held in (p["promptText"] or "") for p in ctx.pending()),
        "the held prompt to be staged", 15,
    )
    # While the fixture holds the prompt, take the archive's write lock so the
    # confirmation that follows the prompt's entry fails after its bounded wait.
    with write_lock(database):
        terminal.wait_idle(timeout=180)
        time.sleep(12)
        ctx.env.snap(terminal, "confirmation refused")
        check("hook skipped" not in terminal.text(), "the fixture's hook failed, so nothing was held")
        check(any(held in (p["promptText"] or "") for p in ctx.pending()), "the pending did not survive the failed confirmation")
    status = ctx.status(terminal)
    check("Pending Capture 待对账" in status, "status does not report the reconciliation")
    # The next submission settles the pending first: the host stored the held
    # prompt's own composer row inside its submission, which proves it
    # entered, so it is confirmed without asking, and the new prompt comes
    # back as a draft to send again.
    ctx.send(terminal, prompt(after))
    terminal.wait_for("已完成对账", "the reconciliation notice", 60)
    ctx.env.snap(terminal, "reconciled")
    entries = ctx.wait_entries(2)
    check(not ctx.pending(), "a pending was left after reconciliation")
    check(entries[-1]["promptText"] == f"{prompt(held)} PT-FIXTURE-HOLD", "the held prompt was not the one confirmed")
    check(
        after[: evidence.MARKER_PREFIX] in terminal.rows()[_prompt_box(terminal)],
        "the new prompt did not come back as a draft",
    )
    terminal.key("enter")
    terminal.wait_idle()
    ctx.env.snap(terminal, "resubmitted")
    entries = ctx.wait_entries(3)
    texts = [e["promptText"] for e in entries]
    check(texts == [prompt(first), f"{prompt(held)} PT-FIXTURE-HOLD", prompt(after)], "entries are not the three prompts in order")
    return (
        "a refused confirmation kept the pending and status reported it; the next submission "
        "confirmed it from its own stored row and handed its own text back as a draft, which then went through"
    )



def shown(band: list[str], marker: str) -> list[str]:
    """The band's rows for the entry the marker names."""
    return [row for row in band if marker[: evidence.MARKER_PREFIX] in row]


def jumpable(row: str, marker: str) -> bool:
    """An entry row without the × that marks one it cannot jump to."""
    return "×" not in row.split(marker[: evidence.MARKER_PREFIX])[0]


@scenario("PT-LIFE-001")
def life_001(ctx: Context) -> str:
    before = ctx.marker("PT-LIFE-001")
    after = ctx.marker("PT-LIFE-001")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(before), consent=True)
    ctx.wait_entries(1)
    ctx.command(terminal, "/clear", "❯")
    terminal.wait_idle()
    ctx.submit(terminal, prompt(after))
    first, second = ctx.wait_entries(2)
    clears = [b for b in ctx.env.archive()["boundaries"] if b["kind"] == "clear"]
    check(len(clears) == 1, f"{len(clears)} Clear Boundaries")
    check(first["runId"] == second["runId"] == clears[0]["runId"], "the Run changed across /clear")
    check(first["segmentId"] != second["segmentId"], "both prompts are in one segment")
    check(first["sequence"] < clears[0]["sequence"] < second["sequence"], "the boundary does not stand between the prompts")
    check(second["parentEventId"] is None and second["branchId"] != first["branchId"], "the prompt after /clear did not start a root branch")
    band = ctx.expand(terminal, after)
    check(any("/clear：新的 Conversation Segment" in row for row in band), "the band shows no Clear Boundary")

    # A process whose first act is /clear has not read its locator yet: the
    # boundary still lands, in a new Run and in a resumed one (Issue 42).
    session = ctx.session(after)
    ctx.exit(terminal)
    for args, marker, what in (
        ((), ctx.marker("PT-LIFE-001"), "a restart"),
        (("--resume", session), ctx.marker("PT-LIFE-001"), "a --resume"),
    ):
        archived = ctx.entries()
        again = ctx.relaunch(*args)
        ctx.command(again, "/clear", "❯")
        again.wait_idle()
        ctx.submit(again, prompt(marker))
        latest = entry(ctx.wait_entries(len(archived) + 1), marker)
        clears = [b for b in ctx.env.archive()["boundaries"] if b["kind"] == "clear"]
        check(
            clears[-1]["runId"] == latest["runId"] and archived[-1]["sequence"] < clears[-1]["sequence"] < latest["sequence"],
            f"the /clear first thing after {what} left no Clear Boundary before the prompt",
        )
        check(latest["parentEventId"] is None, f"the prompt after {what} and /clear has a parent")
        ctx.exit(again)
    check(latest["runId"] == first["runId"], "--resume did not take the Run up")
    kinds = [b["kind"] for b in ctx.env.archive()["boundaries"]]
    check(kinds.count("clear") == 3, f"{kinds.count('clear')} Clear Boundaries for 3 /clear")
    check("integrity-gap" not in kinds, "a /clear was recorded as an Integrity gap")
    return (
        "1 Clear Boundary between the prompts; same Run, two segments, a new root branch after it; shown in the band; "
        "a /clear first thing after a restart and after --resume is a Clear Boundary too, never an Integrity gap"
    )


@scenario("PT-LIFE-002")
def life_002(ctx: Context) -> str:
    before = ctx.marker("PT-LIFE-002")
    after = ctx.marker("PT-LIFE-002")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(before), consent=True)
    ctx.wait_entries(1)
    ctx.command(terminal, "/compact", "ompact", timeout=120)
    terminal.wait_idle()
    ctx.submit(terminal, prompt(after))
    entries = ctx.wait_entries(2)
    check(len(entries) == 2, f"{len(entries)} entries")
    first, second = entries
    check(second["runId"] == first["runId"], "compaction started a new Run")
    check(second["segmentId"] == first["segmentId"], "compaction started a new segment")
    check(second["branchId"] == first["branchId"], "compaction started a new branch")
    check(second["parentEventId"] == first["eventId"], "the prompt after compaction does not follow the one before")
    kinds = [b["kind"] for b in ctx.env.archive()["boundaries"]]
    check(kinds == ["run-started"], f"boundaries beside the Run's start: {kinds}")
    band = ctx.expand(terminal, after)
    for marker in (before, after):
        rows = shown(band, marker)
        check(len(rows) == 1 and jumpable(rows[0], marker), "an entry is not shown once with a Jump Target")
    return "no Clear Boundary, no new Run, no extra entry; the prompt after /compact continues the branch; both entries jumpable"


@scenario("PT-LIFE-003")
def life_003(ctx: Context) -> str:
    first = ctx.marker("PT-LIFE-003")
    latest = ctx.marker("PT-LIFE-003")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.submit(terminal, prompt(latest))
    ctx.wait_entries(2)
    run, _ = ctx.identity(terminal)
    ctx.expand(terminal, latest)
    # Select the earlier entry, then leave the band for the composer.
    terminal.key("ctrl-x", "tab", pause=0.5)
    terminal.key("up", pause=0.5)
    check(any(first[: evidence.MARKER_PREFIX] in row for row in terminal.reversed_rows()), "the earlier entry could not be selected")
    ctx.env.snap(terminal, "earlier entry selected")
    terminal.key("esc", pause=0.5)
    ctx.command(terminal, "/reload-plugins", "eload")
    band = terminal.wait_for(
        lambda t: (b := ctx.band(t)) and b[0].startswith("▾") and shown(b, latest) and b,
        "the band to come back open", 30,
    )
    ctx.env.snap(terminal, "reloaded")
    for marker in (first, latest):
        rows = shown(band, marker)
        check(len(rows) == 1, f"an entry is shown {len(rows)} times after the reload")
        check(jumpable(rows[0], marker), "an entry lost its Jump Target in the reload")
    check(len(ctx.entries()) == 2, "the reload's replay created a Prompt Entry")
    check(ctx.identity(terminal)[0] == run, "the reload changed the Run")
    # The selection is not kept once focus leaves the band: entering again
    # starts on the latest entry, as it does after Esc.
    terminal.key("ctrl-x", "tab", pause=0.5)
    check(any(latest[: evidence.MARKER_PREFIX] in row for row in terminal.reversed_rows()), "entering the band did not start on the latest entry")
    ctx.env.snap(terminal, "entered after reload")
    return "same Run, still expanded, each entry once and jumpable, no new entry; entering the band starts on the latest entry"


@scenario("PT-LIFE-004")
def life_004(ctx: Context) -> str:
    marker = ctx.marker("PT-LIFE-004")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    entry = ctx.wait_entries(1)[0]
    run, generation = ctx.identity(terminal)
    check(entry["runId"] == run, "the entry does not belong to the Run status names")
    ctx.exit(terminal)
    detached = [b for b in ctx.env.archive()["boundaries"] if b["kind"] == "run-detached"]
    check([b["runId"] for b in detached] == [run], "the exit did not record the Run leaving once")
    restarted = ctx.relaunch()
    new_run, new_generation = ctx.identity(restarted)
    check(new_run != run, "the restart kept the old Run")
    check(new_generation == generation, "the restart changed the Archive generation")
    band = ctx.expand(restarted, marker)
    rows = shown(band, marker)
    check(len(rows) == 1 and not jumpable(rows[0], marker), "the old entry is not shown once without a Jump Target")
    # The new Run's start is written by its first write, so the band shows
    # only the old Run: its start, its entry and its leaving, in that order.
    lines = [row for row in band[1:] if row.startswith("——") or row in rows]
    check(lines == ["—— Run 开始 ——", rows[0], "—— Run 离开 ——"], "the band does not show the old Run start, its entry and its leaving")
    check(len(ctx.entries()) == 1, "the restart created a Prompt Entry")
    return "exit recorded the Run leaving; the restart got a new Run on the same generation; the old Run shows start, × entry, leaving"


@scenario("PT-STORE-001")
def store_001(ctx: Context) -> str:
    first = ctx.marker("PT-STORE-001")
    second = ctx.marker("PT-STORE-001")
    third = ctx.marker("PT-STORE-001")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.wait_entries(1)
    run, generation = ctx.identity(terminal)
    session = ctx.session(first)
    ctx.exit(terminal)
    # An ordinary launch: a new Run on the same timeline, consent kept.
    restarted = ctx.relaunch()
    ctx.submit(restarted, prompt(second))
    check("采集同意" not in restarted.text(), "the restart asked for consent again")
    entries = ctx.wait_entries(2)
    new_run, new_generation = ctx.identity(restarted)
    check("collection consent: granted" in ctx.status(restarted), "status does not say consent is granted")
    check(new_run != run and entries[1]["runId"] == new_run, "the restart did not get a new Run")
    check(new_generation == generation, "the restart changed the Archive generation")
    ctx.exit(restarted)
    # A resume of the first session attaches to the first Run again.
    resumed = ctx.relaunch("--resume", session)
    ctx.submit(resumed, prompt(third))
    entries = ctx.wait_entries(3)
    check(ctx.identity(resumed)[0] == run and entries[2]["runId"] == run, "the resume did not attach to the first Run")
    check([e["promptText"] for e in entries] == [prompt(first), prompt(second), prompt(third)], "earlier entries changed")
    archive = ctx.env.archive()
    attached = [b for b in archive["boundaries"] if b["kind"] == "run-attached"]
    check([b["runId"] for b in attached] == [run], "the resume did not record the Run attaching once")
    # Each Run starts and leaves around its prompt, then the resume attaches.
    sequences = sorted(e["sequence"] for e in archive["entries"] + archive["boundaries"])
    check(sequences == list(range(1, 9)), f"events hold sequences {sequences}, not 1..8")
    return (
        "a restart kept the earlier entry, the generation and consent under a new Run; "
        "a resume attached to the first Run; sequence 1..8 unbroken"
    )


def entry(entries: list[dict], marker: str) -> dict:
    """The one Prompt Entry holding the prompt the marker names."""
    found = [e for e in entries if e["promptText"] == prompt(marker)]
    check(len(found) == 1, f"{len(found)} entries hold one prompt")
    return found[0]


def in_transcript(terminal: Terminal, marker: str) -> bool:
    """Whether the transcript above the band shows the prompt the marker names."""
    rows = terminal.rows()
    titles = [i for i, row in enumerate(rows) if row.startswith(("▸ Prompt Trail", "▾ Prompt Trail"))]
    above = rows[: titles[-1]] if titles else rows
    return any(row.startswith("❯ ") and marker[: evidence.MARKER_PREFIX] in row for row in above)


def collapsed(ctx: Context, terminal: Terminal) -> bool:
    band = ctx.band(terminal)
    return bool(band) and band[0].startswith("▸")


def boundaries(ctx: Context, kind: str) -> list[dict]:
    return [b for b in ctx.env.archive()["boundaries"] if b["kind"] == kind]


def wait_bound(ctx: Context, terminal: Terminal, markers, what: str) -> list[str]:
    """The open band once each entry the markers name is shown once with a
    Jump Target: the alignment that binds them may finish after the band opens."""
    def bound(t: Terminal) -> list[str] | None:
        band = ctx.band(t)
        return band if all(
            len(rows := shown(band, marker)) == 1 and jumpable(rows[0], marker) for marker in markers
        ) else None
    return terminal.wait_for(bound, f"{what} to bind the shared history once", 15)


def check_fold(band: list[str], count: int, before: str, after: str, hidden) -> int:
    """The one fold row of `count` entries stands between the entries `before`
    and `after` name, and the entries it folds are not shown; its row index."""
    folds = [i for i, row in enumerate(band) if row.startswith(f"▸ 另一分支 · {count} 条")]
    check(len(folds) == 1 and not any(shown(band, m) for m in hidden), "the entries that left the active path are not folded into one row")
    at = {m: [i for i, row in enumerate(band) if m[: evidence.MARKER_PREFIX] in row] for m in (before, after)}
    check(len(at[before]) == 1 and len(at[after]) == 1, "the entries around the fold are not shown once")
    check(at[before][0] < folds[0] < at[after][0], "the fold does not stand where the branch left")
    return folds[0]


def check_branched_off(ctx: Context, terminal: Terminal, marker: str, source: str) -> None:
    """The entry the marker names opens a Run that says it branched off `source`."""
    band = terminal.wait_for(lambda t: (b := ctx.band(t)) and shown(b, marker) and b, "the band to show the prompt", 15)
    row = band.index(shown(band, marker)[0])
    check(band[row - 1] == f"—— Run 开始（从 Run {source[:8]} 分出）——", "the new Run does not say which Run it branched off")


@scenario("PT-BRANCH-001")
def branch_001(ctx: Context) -> str:
    a, b, c, d, e, f, g = (ctx.marker("PT-BRANCH-001") for _ in range(7))
    first = ctx.env.launch(lines=60)
    ctx.start(first)
    ctx.submit(first, prompt(a), consent=True)
    ctx.submit(first, prompt(b))
    ctx.wait_entries(2)
    run, _ = ctx.identity(first)
    session = ctx.session(a)
    ctx.exit(first)

    # --continue takes the latest session up again: its shared history binds
    # anew and nothing of it is archived twice.
    continued = ctx.relaunch("--continue", lines=60)
    ctx.expand(continued, b)
    wait_bound(ctx, continued, (a, b), "--continue")
    check(len(ctx.entries()) == 2, "--continue archived the shared history")
    ctx.submit(continued, prompt(c))
    entries = ctx.wait_entries(3)
    check(entry(entries, c)["parentEventId"] == entry(entries, b)["eventId"], "--continue did not go on from the last entry")
    check(entry(entries, c)["runId"] == run and ctx.identity(continued)[0] == run, "--continue did not take the Run up")
    check([x["runId"] for x in boundaries(ctx, "run-attached")] == [run], "--continue did not record the Run attaching once")
    ctx.exit(continued)

    # --resume names the session. After a /clear, an in-process /resume of it
    # comes back to its branch; the prompt after the clear leaves the active
    # path and folds where it branched.
    resumed = ctx.relaunch("--resume", session, lines=60)
    ctx.submit(resumed, prompt(d))
    entries = ctx.wait_entries(4)
    check(entry(entries, d)["parentEventId"] == entry(entries, c)["eventId"], "--resume did not go on from the last entry")
    check(entry(entries, d)["runId"] == run and ctx.identity(resumed)[0] == run, "--resume did not take the Run up")
    check([x["runId"] for x in boundaries(ctx, "run-attached")] == [run, run], "--resume did not record the Run attaching once more")
    ctx.command(resumed, "/clear", "❯")
    resumed.wait_idle()
    ctx.submit(resumed, prompt(e))
    entries = ctx.wait_entries(5)
    check(entry(entries, e)["parentEventId"] is None, "the prompt after /clear has a parent")
    check(len(boundaries(ctx, "clear")) == 1, "the /clear left no single Clear Boundary")
    ctx.send(resumed, f"/resume {session}")
    resumed.wait_for(lambda t: in_transcript(t, d), "the in-process resume to show the session", 30)
    ctx.env.snap(resumed, "resumed in process")
    ctx.submit(resumed, prompt(f))
    entries = ctx.wait_entries(6)
    check(entry(entries, f)["parentEventId"] == entry(entries, d)["eventId"], "/resume did not go on from the session's last entry")
    check(entry(entries, f)["runId"] == run and ctx.identity(resumed)[0] == run, "/resume did not keep the Run")
    ctx.expand(resumed, f)
    # The session's rows, drawn by this process before it left them, are
    # replayed and bound again, and the prompt after them too (Issue 43).
    band = wait_bound(ctx, resumed, (a, b, c, d, f), "the in-process /resume")
    fold = check_fold(band, 1, d, f, hidden=(e,))
    ctx.click_row(resumed, band[fold], "另一分支")
    resumed.wait_for(lambda t: shown(ctx.band(t), e), "the fold to open", 15)
    ctx.env.snap(resumed, "fold opened")

    # A second terminal resuming the session while the first holds its Run
    # branches off in a Run of its own.
    concurrent = ctx.relaunch("--resume", session, lines=60)
    other, _ = ctx.identity(concurrent)
    check(other != run, "a concurrent resume took up the held Run")
    ctx.expand(concurrent, f)
    wait_bound(ctx, concurrent, (a, b, c, d, f), "the concurrent resume")
    check(len(ctx.entries()) == 6, "the concurrent resume archived the shared history")
    ctx.submit(concurrent, prompt(g))
    entries = ctx.wait_entries(7)
    check(len(entries) == 7, f"{len(entries)} entries")
    check(entry(entries, g)["parentEventId"] == entry(entries, f)["eventId"], "the concurrent resume did not go on from the last entry")
    check(entry(entries, g)["runId"] == other, "the concurrent prompt is not in the new Run")
    check_branched_off(ctx, concurrent, g, run)
    return (
        "--continue and a concurrent --resume bind the shared history once and archive none of it; --continue, "
        "--resume and an in-process /resume keep the Run and go on from the session's last entry; an in-process /resume back "
        "into a session this process drew binds its history and the next prompt again; the prompt after "
        "/clear folds where it left; a resume while the Run is held branches off in a new Run"
    )


@scenario("PT-BRANCH-002")
def branch_002(ctx: Context) -> str:
    a, b, g, h = (ctx.marker("PT-BRANCH-002") for _ in range(4))
    source = ctx.env.launch(lines=60)
    ctx.start(source)
    ctx.submit(source, prompt(a), consent=True)
    ctx.submit(source, prompt(b))
    ctx.wait_entries(2)
    run, _ = ctx.identity(source)
    session = ctx.session(a)
    # A background /fork submits its argument in a session of its own.
    ctx.send(source, f"/fork {prompt(g)}")
    entries = ctx.wait_entries(3, timeout=90)
    check(len(entries) == 3, f"{len(entries)} entries after the fork")
    forked = entry(entries, g)
    check(forked["runId"] != run, "the background fork did not start a Run")
    check(forked["parentEventId"] == entry(entries, b)["eventId"], "the fork does not go on from the shared history")
    check(forked["branchId"] != entry(entries, b)["branchId"], "the fork did not start a branch")
    check(forked["runId"] in [x["runId"] for x in boundaries(ctx, "run-started")], "the fork's Run did not start")

    cli = ctx.relaunch("--resume", session, "--fork-session", lines=60)
    ctx.expand(cli, b)
    band = wait_bound(ctx, cli, (a, b), "--fork-session")
    rows = shown(band, g)
    check(len(rows) == 1 and not jumpable(rows[0], g), "the other fork's entry is not shown once without a Jump Target")
    ctx.submit(cli, prompt(h))
    entries = ctx.wait_entries(4)
    check(len(entries) == 4, f"{len(entries)} entries after --fork-session")
    child = entry(entries, h)
    check(child["runId"] not in (run, forked["runId"]) and ctx.identity(cli)[0] == child["runId"], "--fork-session did not start a Run")
    check(child["parentEventId"] == entry(entries, b)["eventId"], "--fork-session does not go on from the shared history")
    check(child["branchId"] not in (entry(entries, b)["branchId"], forked["branchId"]), "--fork-session did not start a branch")
    check_branched_off(ctx, cli, h, run)

    # Compacted, the source hands its forks a transcript that opens on the
    # summary; they still go on from its last entry (Issue 34).
    c, k, m = (ctx.marker("PT-BRANCH-002") for _ in range(3))
    ctx.command(source, "/compact", "ompact", timeout=120)
    source.wait_idle()
    ctx.submit(source, prompt(c))
    entries = ctx.wait_entries(5)
    last = entry(entries, c)
    ctx.send(source, f"/fork {prompt(k)}")
    entries = ctx.wait_entries(6, timeout=90)
    check(len(entries) == 6, f"{len(entries)} entries after the fork of the compacted session")
    compacted_fork = entry(entries, k)
    check(compacted_fork["runId"] not in (run, forked["runId"], child["runId"]), "the fork of the compacted session did not start a Run")
    check(compacted_fork["parentEventId"] == last["eventId"], "the fork of the compacted session does not go on from its last entry")
    compacted_cli = ctx.relaunch("--resume", session, "--fork-session", lines=60)
    ctx.expand(compacted_cli, c)
    wait_bound(ctx, compacted_cli, (c,), "--fork-session of the compacted session")
    ctx.submit(compacted_cli, prompt(m))
    entries = ctx.wait_entries(7)
    check(len(entries) == 7, f"{len(entries)} entries after --fork-session of the compacted session")
    compacted_child = entry(entries, m)
    check(compacted_child["parentEventId"] == last["eventId"], "--fork-session of the compacted session does not go on from its last entry")
    check(compacted_child["runId"] not in (run, compacted_fork["runId"]), "--fork-session of the compacted session did not start a Run")
    check_branched_off(ctx, compacted_cli, m, run)
    return (
        "a background /fork archived its argument once in a new Run and branch after the shared history; "
        "--fork-session bound the shared history, marked the other fork ×, and started a Run of its own "
        "that says which Run it branched off; after /compact both forks still went on from the source's "
        "last entry, and --fork-session bound it before submitting"
    )


def rewind(ctx: Context, terminal: Terminal, target: str, command: bool = True) -> None:
    """Rewinds the conversation to before the prompt `target` names, through
    /rewind or Esc Esc (the same menu), and clears the prompt put back."""
    if command:
        ctx.send(terminal, "/rewind")
    else:
        terminal.key("esc", pause=0.3)
        terminal.key("esc")
    terminal.wait_for("(current)", "the rewind menu", 15)
    for _ in range(10):
        # The menu's selection is indented; the transcript's prompts are not.
        selected = [row for row in terminal.rows() if row.startswith("   ❯ ") and "(current)" not in row]
        if selected and target[: evidence.MARKER_PREFIX] in selected[-1]:
            break
        terminal.key("up", pause=0.5)
    ctx.env.snap(terminal, "rewind target")
    terminal.key("enter")
    terminal.wait_for("Restore conversation", "the restore choice", 15)
    ctx.choose(terminal, "Restore conversation")
    terminal.wait_for(
        lambda t: target[: evidence.MARKER_PREFIX] in t.rows()[_prompt_box(t)], "the rewound prompt in the box", 15,
    )
    ctx.env.snap(terminal, "rewound")
    terminal.key("ctrl-c", pause=0.5)


@scenario("PT-BRANCH-003")
def branch_003(ctx: Context) -> str:
    a, b, c, d, e = (ctx.marker("PT-BRANCH-003") for _ in range(5))
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(a), consent=True)
    ctx.submit(terminal, prompt(b))
    ctx.submit(terminal, prompt(c))
    ctx.wait_entries(3)
    # /rewind to before B, then Esc Esc to before A: the same menu, reached
    # once through the command and once without it.
    for command, target, next_prompt in ((True, b, d), (False, a, e)):
        rewind(ctx, terminal, target, command)
        ctx.submit(terminal, prompt(next_prompt))
        if next_prompt == d:
            entries = ctx.wait_entries(4)
            check(entry(entries, d)["parentEventId"] == entry(entries, a)["eventId"], "the prompt after /rewind does not follow A")
            check(entry(entries, d)["branchId"] != entry(entries, a)["branchId"], "the prompt after /rewind did not start a branch")
            check_fold(ctx.expand(terminal, d), 2, a, d, hidden=(b, c))
    entries = ctx.wait_entries(5)
    check(len(entries) == 5, f"{len(entries)} entries")
    root = entry(entries, e)
    check(root["parentEventId"] is None, "the prompt after Esc Esc has a parent")
    check(root["branchId"] not in {x["branchId"] for x in entries if x is not root}, "the prompt after Esc Esc did not start a branch")
    check([entry(entries, m)["sequence"] for m in (a, b, c, d)] == sorted(x["sequence"] for x in entries)[:4], "an earlier entry changed")
    band = terminal.wait_for(lambda t: (b_ := ctx.band(t)) and shown(b_, e) and b_, "the band to show the prompt", 15)
    row = band.index(shown(band, e)[0])
    check(band[row - 1] == "—— 新根分支 ——", "the band does not mark the new root branch")
    check(all(len(shown(band[:row], m)) == 1 for m in (a, b, c, d)), "the old entries do not stay above the new root")
    return (
        "/rewind to before B: the next prompt follows A on a new branch and B, C fold where it left; "
        "Esc Esc to the start: the next prompt starts a root branch below every old entry, all kept"
    )


@scenario("PT-BRANCH-004")
def branch_004(ctx: Context) -> str:
    a, b, c = (ctx.marker("PT-BRANCH-004") for _ in range(3))
    first = ctx.env.launch(lines=60)
    ctx.start(first)
    ctx.submit(first, prompt(a), consent=True)
    ctx.submit(first, prompt(b))
    ctx.wait_entries(2)
    run, _ = ctx.identity(first)
    session = ctx.session(a)
    ctx.command(first, "/compact", "ompact", timeout=120)
    first.wait_idle()
    ctx.exit(first)
    # The compacted transcript no longer holds A and B, so it cannot prove
    # which entry the next prompt follows.
    resumed = ctx.relaunch("--resume", session, lines=60)
    # The Pane stands beside the transcript and wraps its question; its key
    # hint is one line.
    question = "Esc 取消并放回草稿"

    def asked() -> None:
        ctx.send(resumed, prompt(c))
        resumed.wait_for(question, "the parent Pane", 30)
        time.sleep(1)
        ctx.env.snap(resumed, "parent Pane")
        check(len(ctx.entries()) == 2 and not ctx.pending(), "the blocked submission was archived")
        check(c[: evidence.MARKER_PREFIX] not in resumed.rows()[_prompt_box(resumed)], "the draft stayed in the prompt box")

    asked()
    focused = resumed.reversed_spans()
    check(len(focused) == 1 and focused[0].startswith("#"), "the Pane did not take focus on its first candidate")
    resumed.key("esc", pause=1)
    resumed.wait_for(lambda t: question not in t.text(), "the Pane to close", 10)
    check(c[: evidence.MARKER_PREFIX] in resumed.rows()[_prompt_box(resumed)], "Esc did not put the draft back")
    check(len(ctx.entries()) == 2, "cancelling archived the draft")
    # Submitting again without a choice asks again.
    resumed.key("ctrl-c", pause=0.5)
    asked()
    candidates = [m.group(0) for m in (
        re.search(rf"#\d+ {re.escape(b[: evidence.MARKER_PREFIX])}", row) for row in resumed.rows()
    ) if m]
    check(len(candidates) == 1, "B is not a candidate once")
    ctx.click_row(resumed, candidates[0], candidates[0])
    resumed.wait_for(lambda t: question not in t.text(), "the Pane to close", 10)
    resumed.wait_for(
        lambda t: c[: evidence.MARKER_PREFIX] in t.rows()[_prompt_box(t)], "the draft to come back", 10,
    )
    ctx.env.snap(resumed, "parent chosen")
    time.sleep(5)
    check("esc to interrupt" not in resumed.text() and len(ctx.entries()) == 2, "the draft was submitted by itself")
    resumed.key("enter")
    resumed.wait_idle()
    entries = ctx.wait_entries(3)
    check(entry(entries, c)["parentEventId"] == entry(entries, b)["eventId"], "the prompt does not follow the chosen parent")
    check(entry(entries, c)["runId"] == run, "the resume changed the Run")
    return (
        "a compacted resume dropped the first submission into a focused parent Pane with the box empty; Esc put "
        "the draft back and a resubmission asked again; a click on B closed the Pane and put the draft back "
        "unsent; the next submission followed B"
    )


@scenario("PT-JUMP-001")
def jump_001(ctx: Context) -> str:
    markers = [ctx.marker("PT-JUMP-001") for _ in range(5)]
    terminal = ctx.env.launch(lines=24)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(markers[0]), consent=True)
    for marker in markers[1:]:
        ctx.submit(terminal, prompt(marker))
    ctx.wait_entries(5)
    for how, marker in (("Enter", markers[0]), ("click", markers[1])):
        band = ctx.expand(terminal, markers[-1])
        check(not in_transcript(terminal, marker), "the target is already on screen")
        rows = shown(band, marker)
        check(len(rows) == 1 and jumpable(rows[0], marker), "the target is not shown once with a Jump Target")
        if how == "Enter":
            ctx.focus(terminal, rows[0])
            terminal.key("enter")
        else:
            ctx.click_row(terminal, rows[0], marker[: evidence.MARKER_PREFIX])
        terminal.wait_for(lambda t: collapsed(ctx, t) and in_transcript(t, marker), f"the {how} jump", 15)
        ctx.env.snap(terminal, f"jumped by {how}")
        typed(terminal)
    return "Enter and a click each brought an off-screen entry into view, collapsed the band and gave typing back to the prompt box"


@scenario("PT-JUMP-002")
def jump_002(ctx: Context) -> str:
    marker = ctx.marker("PT-JUMP-002")
    first = ctx.env.launch(lines=60)
    ctx.start(first)
    ctx.submit(first, prompt(marker), consent=True)
    ctx.wait_entries(1)
    ctx.exit(first)
    # The same text again in a new process: guessing by text would land on it.
    restarted = ctx.relaunch(lines=60)
    ctx.submit(restarted, prompt(marker))
    ctx.wait_entries(2)
    band = ctx.expand(restarted, marker)
    rows = shown(band, marker)
    check(len(rows) == 2 and not jumpable(rows[0], marker) and jumpable(rows[1], marker), "the old entry is not × beside a jumpable twin")
    old = rows[0]
    for how in ("Enter", "click"):
        before = restarted.rows()
        title = next(i for i, row in enumerate(before) if row.startswith("▾ Prompt Trail"))
        if how == "Enter":
            ctx.focus(restarted, old)
            restarted.key("enter")
        else:
            ctx.click_row(restarted, old, marker[: evidence.MARKER_PREFIX])
        time.sleep(2)
        ctx.env.snap(restarted, f"× activated by {how}")
        after = restarted.rows()
        check(after[title].startswith("▾ Prompt Trail"), f"{how} on × collapsed the band")
        check(after[:title] == before[:title], f"{how} on × moved the transcript")
        check(shown(ctx.band(restarted), marker) == rows, f"{how} on × changed the entries shown")
        check(len(ctx.entries()) == 2, f"{how} on × archived something")
        if how == "Enter":
            check(any(row.startswith(old) for row in restarted.reversed_rows()), "Enter on × moved the focus")
        restarted.key("esc", pause=0.5)
    return "after a restart the old entry is × beside a jumpable twin of the same text; Enter and a click on it left the band, the transcript and the archive as they were"


FIXTURE_ROW = re.compile(r"PT-FIXTURE (\d+) 继续")
FOCUS_HINT = "ctrl+x tab 键盘选择"
# The host's row under a band taller than it: the rows above and below its window.
MORE = re.compile(r"(?:↑ (\d+) more)?(?: · )?(?:↓ (\d+) more)?")


def seeded(ctx: Context, scenario_id: str, count: int, *, seed: int = 21, **size) -> Terminal:
    """A new process on a project whose archive holds one real, consented
    prompt followed by `count` synthetic events. The events are written
    straight into the archive between processes, as setup: what is under
    test is how the band reads and draws them."""
    first = ctx.env.launch()
    ctx.start(first)
    ctx.submit(first, prompt(ctx.marker(scenario_id)), consent=True)
    ctx.wait_entries(1)
    ctx.exit(first)
    database = sorted((ctx.env.config / "plugins" / "data").glob("*/archives/*.sqlite3"))[0]
    timeline_fixture.build(database, database.stem, count, seed=seed)
    return ctx.relaunch(**size)


def more(band: list[str]) -> tuple[int, int] | None:
    """What the host's count row under the band says, as the rows above and
    below the view; None while the band's tree fits and it draws none."""
    drawn = [row.strip() for row in band[1:] if row.strip()]
    found = MORE.fullmatch(drawn[-1]) if drawn else None
    if found is None or not drawn[-1]:
        return None
    return int(found.group(1) or 0), int(found.group(2) or 0)


def under_title(terminal: Terminal) -> int | None:
    """The row under the open band's title, while the title is drawn."""
    titles = [i for i, text in enumerate(terminal.rows()) if text.startswith("▾ Prompt Trail")]
    return titles[-1] + 1 if titles else None


def wheel_band(ctx: Context, terminal: Terminal, up: bool, ticks: int = 1) -> None:
    """The trackpad over the band's first row under its title, a tick at a
    time, each once the title is drawn: right after a tick the band's tree
    can draw before the window is back on its title."""
    for tick in range(ticks):
        row = terminal.wait_for(under_title, f"the band's title before trackpad tick {tick + 1} of {ticks}", 5)
        terminal.wheel(4, row, up)


def title(ctx: Context, terminal: Terminal) -> str:
    """The band's title row, without the host's own control at its end."""
    band = ctx.band(terminal)
    return re.sub(r"\s*\[-\]$", "", band[0]) if band else ""


def focused(ctx: Context, terminal: Terminal) -> list[str]:
    """The band's rows drawn reversed: the ring's, and the pointer's."""
    band = ctx.band(terminal)
    return [row for row in terminal.reversed_rows() if row in band]


def park(terminal: Terminal) -> None:
    """Moves the pointer off the band, so only the ring draws reversed."""
    terminal.hover(0, 0)
    time.sleep(0.2)


def typed(terminal: Terminal) -> None:
    """Typing reaches the prompt box, and is taken back out."""
    terminal.type("zz")
    terminal.wait_for(lambda t: t.rows()[_prompt_box(t)][1:].strip() == "zz", "typing to reach the prompt box", 5)
    terminal.key("backspace", "backspace")


def click_title(ctx: Context, terminal: Terminal, needle: str) -> None:
    """Clicks `needle` on the band's title row, then moves the pointer away."""
    rows = terminal.rows()
    row = max(i for i, text in enumerate(rows) if text.startswith(("▸ Prompt Trail", "▾ Prompt Trail")))
    terminal.click(terminal.column(row, needle), row)
    park(terminal)


@scenario("PT-UI-001")
def ui_001(ctx: Context) -> str:
    marker = ctx.marker("PT-UI-001")
    terminal = ctx.env.launch()
    ctx.start(terminal)
    check(
        [row for row in ctx.band(terminal) if row.strip()] == [ctx.band(terminal)[0]] and title(ctx, terminal) == "▸ Prompt Trail",
        "the band did not start as one collapsed title row",
    )
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    check(collapsed(ctx, terminal), "a submission opened the band")
    # A click on the title opens the band and says how to take its keyboard.
    click_title(ctx, terminal, "Prompt Trail")
    band = terminal.wait_for(
        lambda t: (b := ctx.band(t)) and b[0].startswith("▾") and shown(b, marker) and b, "the title click to open the band", 15,
    )
    ctx.env.snap(terminal, "opened by a click")
    check(FOCUS_HINT in band[0], "the open band does not say how to take its keyboard")
    row = max(i for i, text in enumerate(terminal.rows()) if text.startswith("▾ Prompt Trail"))
    check(terminal.cell(terminal.column(row, FOCUS_HINT), row).fg == DIM, "the keyboard hint is not dimmed")
    click_title(ctx, terminal, "Prompt Trail")
    terminal.wait_for(lambda t: collapsed(ctx, t), "the title click to fold the band", 15)
    ctx.env.snap(terminal, "folded by a click")
    # The command opens it too, and does not take the keyboard for it.
    band = ctx.expand(terminal, marker)
    check(FOCUS_HINT in band[0], "the band opened by the command does not say how to take its keyboard")
    check(not focused(ctx, terminal), "opening the band took the keyboard")
    typed(terminal)
    # ctrl+x tab gives the band the keyboard, on the latest entry; Esc gives
    # it back to the prompt box and leaves the band open.
    terminal.key("ctrl-x", "tab", pause=0.5)
    check(focused(ctx, terminal) == shown(ctx.band(terminal), marker), "ctrl+x tab did not land on the entry")
    ctx.env.snap(terminal, "band holds the keyboard")
    terminal.key("esc", pause=0.5)
    typed(terminal)
    check(ctx.band(terminal)[0].startswith("▾"), "Esc folded the band")
    ctx.env.snap(terminal, "keyboard given back")
    # The command folds the open band again.
    ctx.command(terminal, "/prompt-history", "已折叠")
    terminal.wait_for(lambda t: collapsed(ctx, t), "the command to fold the band", 15)
    ctx.env.snap(terminal, "folded by the command")
    return (
        "starts as one collapsed title row; a title click opens it with the ctrl+x tab hint and folds it again; "
        "/prompt-history opens it without taking the keyboard; ctrl+x tab lands on the entry; Esc gives typing back and the band stays open; "
        "/prompt-history folds it again"
    )


DIM, WARN = "949494", "ffd700"
# A focus stop on a band row: a Prompt Entry or a fold.
STOP = re.compile(r"^(× )?\d+\. |^[▸▾] 另一(分支| Run) · \d+ 条")
# The archived boundary each band row names, by how the row begins.
BOUNDARY_ROWS = {
    "—— /clear：": "clear",
    "—— Run 开始": "run-started",
    "—— Run 续接": "run-attached",
    "—— Run 离开": "run-detached",
    "—— Integrity gap": "integrity-gap",
    "—— 已恢复可验证采集": "integrity-recovery",
    "—— 采集已停止": "collection-stopped",
    "—— 采集已恢复": "collection-resumed",
}
DRAWN_KINDS = set(BOUNDARY_ROWS.values())


def boundary_kind(row: str) -> str | None:
    return next((kind for start, kind in BOUNDARY_ROWS.items() if row.startswith(start)), None)


def frame(terminal: Terminal) -> list[tuple[int, str, object]]:
    """The band's rows in one frame, title first: each row's index on
    screen, its text, and its first visible cell."""
    styled = terminal.styled_rows()
    titles = [i for i, (text, _) in enumerate(styled) if text.startswith(("▸ Prompt Trail", "▾ Prompt Trail"))]
    if not titles:
        return []
    band = []
    for index in range(titles[-1], len(styled)):
        text, cell = styled[index]
        if text.startswith("────"):
            break
        band.append((index, text, cell))
    return band


def ringed(rows) -> list[tuple[int, str]]:
    return [(index, text) for index, text, cell in rows if cell is not None and cell.reverse]


def walk(ctx: Context, terminal: Terminal, key: str, done, each=None, limit: int = 1500) -> list[float]:
    """Presses `key` until `done(rows)`, one press at a time, with the ring on
    the band and the pointer off it. Each press must move the ring onto the
    next stop the frame before showed that way, if it showed one, and the
    ring and view must then hold still while any batch the move asked for
    arrives. Answers the seconds each press took to move the ring."""
    rows = frame(terminal)
    took = []
    while not done(rows):
        check(len(took) < limit, f"{limit} presses did not finish the walk")
        before = ringed(rows)
        check(len(before) == 1, f"{len(before)} band rows drawn focused")
        at = [index for index, _, _ in rows].index(before[0][0])
        way = rows[:at][::-1] if key == "up" else rows[at + 1:]
        neighbour = next((text for _, text, _ in way if STOP.match(text)), None)
        started = time.monotonic()
        terminal.key(key, pause=0)
        while True:
            rows = frame(terminal)
            after = ringed(rows)
            if len(after) == 1 and after[0][1] != before[0][1]:
                took.append(time.monotonic() - started)
                break
            if time.monotonic() - started > 5:
                ctx.env.snap(terminal, "the ring did not move")
                raise ScenarioFailure(f"a {key} press did not move the ring")
            time.sleep(0.01)
        if neighbour is not None and after[0][1] != neighbour:
            ctx.env.snap(terminal, "the ring skipped a stop")
            raise ScenarioFailure(f"a {key} press did not move the ring onto the next stop")
        time.sleep(0.25)
        rows = frame(terminal)
        if ringed(rows) != after:
            ctx.env.snap(terminal, "the ring moved by itself")
            raise ScenarioFailure("the ring or the view moved after the press had landed")
        if each is not None:
            each(rows)
    return took


def at_top(rows) -> bool:
    """The ring on the title, the first event shown under it, nothing above."""
    count = more([text for _, text, _ in rows])
    return bool(rows) and ringed(rows) == [(rows[0][0], rows[0][1])] and (count is None or count[0] == 0) \
        and len(rows) > 1 and rows[1][1] == "—— Run 开始 ——"


@scenario("PT-UI-002")
def ui_002(ctx: Context) -> str:
    terminal = seeded(ctx, "PT-UI-002", 400, seed=22, columns=100, lines=30)
    archive = ctx.env.archive()
    kinds = {b["sequence"]: b["kind"] for b in archive["boundaries"]}
    ctx.expand(terminal, "PT-FIXTURE")
    terminal.key("ctrl-x", "tab", pause=0.5)
    park(terminal)
    seen: set[str] = set()
    branches = 0

    def each(rows) -> None:
        nonlocal branches
        # On screen, old to new: fixture entries rise, and the boundary rows
        # between two of them name, in order, boundaries archived between.
        last, between = None, []
        for _, text, cell in rows[1:]:
            kind = boundary_kind(text)
            # The ring's row is drawn reversed, in the colours swapped.
            colour = cell.fg if cell is not None and not cell.reverse else None
            if colour is None:
                pass
            elif kind in ("integrity-gap", "integrity-recovery"):
                check(colour == WARN, "an Integrity gap row is not drawn in the warning colour")
            elif text.startswith(("——", "× ")) or STOP.match(text) and text.startswith(("▸", "▾")):
                check(colour == DIM, f"a row is not dimmed: {text[:12]}")
            if kind is not None:
                seen.add(kind)
                between.append(kind)
            if text.startswith(("—— 新分支", "—— 新根分支", "▸ 另一分支", "▾ 另一分支")) or "分出）——" in text:
                branches += 1
            match = FIXTURE_ROW.search(text)
            if match:
                sequence = int(match.group(1))
                if last is not None:
                    check(last < sequence, "entries are not drawn old to new")
                    archived = [kinds[s] for s in range(last + 1, sequence) if kinds.get(s) in DRAWN_KINDS]
                    check(between == archived, "boundary rows do not match the archive between two entries")
                last, between = sequence, []

    each(frame(terminal))
    took = walk(ctx, terminal, "up", at_top, each)
    ctx.env.snap(terminal, "first event")
    missing = sorted(set(BOUNDARY_ROWS.values()) - seen)
    check(not missing, f"never drawn: {missing}")
    check(branches > 0, "no branch was drawn")
    return (
        f"walked {len(took)} stops from the latest event to the first; entries old to new, every boundary row matching the "
        "archive between its entries, each kind drawn (Run start/leave/attach, clear, collection stop/resume, Integrity gap/"
        "recovery) and branches marked; gap rows in the warning colour, other rows dimmed; the ring and view held still while batches loaded"
    )


def away_from_bottom(ctx: Context, terminal: Terminal) -> str:
    """Takes the view up ten rows with the trackpad, and answers the first
    row the view shows."""
    wheel_band(ctx, terminal, True, 10)
    terminal.wait_for(lambda t: (count := more(ctx.band(t))) is not None and count[1] > 0, "the view to leave the bottom", 10)
    time.sleep(1)
    ctx.env.snap(terminal, "away from the bottom")
    return ctx.band(terminal)[1]


def counted(ctx: Context, terminal: Terminal, count: int) -> list[str]:
    """Waits for the title and the row under the view to count `count` new entries."""
    return terminal.wait_for(
        lambda t: (b := ctx.band(t)) and title(ctx, t).startswith(f"▾ Prompt Trail · {count} 条新条目")
        and f"↓ {count} 条新条目" in b and b,
        f"{count} new entries to be counted", 15,
    )


@scenario("PT-UI-003")
def ui_003(ctx: Context) -> str:
    a, b, c = (ctx.marker("PT-UI-003") for _ in range(3))
    terminal = seeded(ctx, "PT-UI-003", 40, columns=100, lines=30)
    ctx.expand(terminal, "PT-FIXTURE")
    # At the bottom a new entry is followed, and nothing is counted.
    ctx.submit(terminal, prompt(a))
    band = terminal.wait_for(lambda t: (x := ctx.band(t)) and shown(x, a) and x, "the new entry to be followed", 15)
    check("条新条目" not in "\n".join(band), "an entry followed at the bottom was counted")
    # Away from it, the view stays and new entries are counted.
    top = away_from_bottom(ctx, terminal)
    for count, marker in ((1, b), (2, c)):
        ctx.submit(terminal, prompt(marker))
        band = counted(ctx, terminal, count)
        check(band[1] == top, "a new entry moved the view")
        check(not shown(band, marker), "a new entry was followed away from the bottom")
    ctx.env.snap(terminal, "counted")
    # The count's row takes the view back to the latest, and clears it.
    ctx.click_row(terminal, "↓ 2 条新条目", "↓ 2 条新条目")
    park(terminal)
    band = terminal.wait_for(
        lambda t: (x := ctx.band(t)) and shown(x, b) and shown(x, c) and x, "the view to return to the latest", 15,
    )
    ctx.env.snap(terminal, "back at the latest")
    check("条新条目" not in "\n".join(band), "the count stayed after returning to the latest")
    return (
        "at the bottom a new entry was followed uncounted; away from it the view held while the title and the row "
        "under it counted 1 then 2; that row took the view back to both entries and cleared the count"
    )


def no_pages(rows) -> None:
    check(not any("页" in text for _, text, _ in rows), "the band shows a page number")


def ring_on(marker: str):
    return lambda rows: any(marker[: evidence.MARKER_PREFIX] in text for _, text in ringed(rows))


@scenario("PT-UI-004")
def ui_004(ctx: Context) -> str:
    a, b, c = (ctx.marker("PT-UI-004") for _ in range(3))
    terminal = seeded(ctx, "PT-UI-004", 400, columns=100, lines=30)
    # A branch of this Run's own, folded where it left: A, B, then back to
    # before B and C.
    ctx.submit(terminal, prompt(a))
    ctx.submit(terminal, prompt(b))
    rewind(ctx, terminal, b)
    ctx.submit(terminal, prompt(c))
    ctx.expand(terminal, c)
    terminal.key("ctrl-x", "tab", pause=0.5)
    park(terminal)
    check(ring_on(c)(frame(terminal)), "the ring did not start on the latest entry")
    # The arrows alone walk the whole timeline, up to its first event and
    # back, with no page to turn.
    no_pages(frame(terminal))
    up = walk(ctx, terminal, "up", at_top, no_pages)
    ctx.env.snap(terminal, "first event")
    down = walk(ctx, terminal, "down", ring_on(c), no_pages)
    ctx.env.snap(terminal, "latest entry")
    # The pointer lights the row under it, beside the ring's.
    row = next(i for i, text, _ in frame(terminal) if a[: evidence.MARKER_PREFIX] in text)
    terminal.hover(terminal.column(row, a[: evidence.MARKER_PREFIX]), row)
    terminal.wait_for(lambda t: any(i == row for i, _ in ringed(frame(t))), "the hovered row to light", 5)
    ctx.env.snap(terminal, "hovered")
    park(terminal)
    # Enter opens the fold the ring is on; a click folds it again.
    walk(ctx, terminal, "up", lambda rows: any(text.startswith("▸ 另一分支 · 1 条") for _, text in ringed(rows)))
    terminal.key("enter")
    terminal.wait_for(lambda t: (x := ctx.band(t)) and shown(x, b) and "▾ 另一分支 · 1 条" in x, "Enter to open the fold", 10)
    ctx.env.snap(terminal, "fold opened by Enter")
    ctx.click_row(terminal, "▾ 另一分支 · 1 条", "另一分支")
    park(terminal)
    terminal.wait_for(lambda t: (x := ctx.band(t)) and not shown(x, b) and "▸ 另一分支 · 1 条" in x, "a click to fold it", 10)
    ctx.env.snap(terminal, "fold closed by a click")
    # Enter on an entry of this Run jumps to it.
    terminal.key("esc", pause=0.5)
    ctx.focus(terminal, shown(ctx.band(terminal), a)[0])
    terminal.key("enter")
    terminal.wait_for(lambda t: collapsed(ctx, t) and in_transcript(t, a), "the Enter jump", 15)
    ctx.env.snap(terminal, "jumped")
    return (
        f"the arrows walked {len(up)} stops up to the first event and {len(down)} back to the latest, with no page "
        "number and the ring held on its row while batches loaded; hover lit a row; Enter opened a fold and a click "
        "closed it; Enter on an entry jumped to it"
    )


@scenario("PT-UI-005")
def ui_005(ctx: Context) -> str:
    terminal = seeded(ctx, "PT-UI-005", 400, columns=100, lines=30)
    latest = ctx.expand(terminal, "PT-FIXTURE")
    # Resting at its bottom the band's tree is still taller than the band, a
    # blank row standing above the title for each row above the view, so the
    # host hands it the trackpad; its count row counts those rows alone, and
    # the title offers nothing of its own.
    count = terminal.wait_for(lambda t: more(ctx.band(t)), "the count row under the band", 10)
    check(count[0] > 0 and count[1] == 0, "the count row at the bottom does not count the rows above alone")
    check(title(ctx, terminal).endswith(f"▾ Prompt Trail  {FOCUS_HINT}"), "the title row holds more than the title and its hint")

    def top(t: Terminal) -> bool:
        band, count = ctx.band(t), more(ctx.band(t))
        return len(band) > 1 and band[1] == "—— Run 开始 ——" and count is not None and count[0] == 0

    def moved(before: tuple[int, int] | None):
        """The view moved off `before`, with the window back on the title."""
        def done(t: Terminal) -> bool:
            band = ctx.band(t)
            count = more(band)
            return bool(band) and band[0].startswith("▾ Prompt Trail") and count is not None and count != before
        return done

    ticks = 0
    while not top(terminal):
        check(ticks < 3000, "3000 trackpad ticks did not reach the first event")
        before = more(ctx.band(terminal))
        wheel_band(ctx, terminal, True)
        ticks += 1
        terminal.wait_for(moved(before), f"trackpad tick {ticks} to move the view from {before} with the title on top", 5)
    count = more(ctx.band(terminal))
    check(count is not None and count[1] > 0, "at the first event the count row does not count the rows below")
    ctx.env.snap(terminal, "first event by the trackpad")
    # Folding and opening again comes back to the latest events.
    click_title(ctx, terminal, "Prompt Trail")
    terminal.wait_for(lambda t: collapsed(ctx, t), "the title to fold the band", 10)
    click_title(ctx, terminal, "Prompt Trail")
    terminal.wait_for(lambda t: ctx.band(t)[1:] == latest[1:], "the band to open on the latest events", 10)
    ctx.env.snap(terminal, "latest by clicks")
    # The arrows leave the bottom too.
    terminal.key("esc", pause=0.5)
    terminal.key("ctrl-x", "tab", pause=0.5)
    park(terminal)
    walk(ctx, terminal, "up", lambda rows: (count := more([text for _, text, _ in rows])) is not None and count[1] > 0)
    ctx.env.snap(terminal, "left the bottom by arrows")
    return (
        f"from the bottom, where the count row counted the rows above alone, {ticks} trackpad ticks reached the "
        "first event; folding and opening came back to the latest; the arrows left the bottom"
    )


def p95(samples: list[float]) -> float:
    """The nearest-rank 95th percentile."""
    ordered = sorted(samples)
    rank = (len(ordered) * 95 + 99) // 100  # ceil(0.95 n) in integers
    return ordered[rank - 1]


def timed(terminal: Terminal, press, done, what: str, timeout: float = 10) -> float:
    """Seconds from `press()` until `done(terminal)`, read every 10 ms."""
    started = time.monotonic()
    press()
    terminal.wait_for(done, what, timeout, interval=0.01)
    return time.monotonic() - started


@scenario("PT-UI-006")
def ui_006(ctx: Context) -> str:
    """One warm-up then ten runs of each, timed from the key to the frame
    that shows it done: the helper's reads, the band's own parsing and
    drawing, and the host's."""
    runs, stretch = 11, 128
    terminal = seeded(ctx, "PT-UI-006", 100_000, columns=100, lines=30)
    # Opening: /prompt-history until the latest events are drawn, folded
    # again by the title between runs.
    opened = []
    for _ in range(runs):
        terminal.type("/prompt-history")
        time.sleep(0.3)
        opened.append(timed(
            terminal, lambda: terminal.key("enter", pause=0),
            lambda t: (b := ctx.band(t)) and b[0].startswith("▾") and FIXTURE_ROW.search("\n".join(b)), "the band to open",
        ))
        click_title(ctx, terminal, "Prompt Trail")
        terminal.wait_for(lambda t: collapsed(ctx, t), "the title to fold the band", 10)
    ctx.expand(terminal, "PT-FIXTURE")
    # A new entry: Enter until the band at its bottom draws it.
    shown_new = []
    for _ in range(runs):
        marker = ctx.marker("PT-UI-006")
        terminal.type(prompt(marker))
        time.sleep(0.5)
        shown_new.append(timed(
            terminal, lambda: terminal.key("enter", pause=0), lambda t: shown(ctx.band(t), marker), "the new entry",
        ))
        terminal.wait_idle()
    # Earlier batches: the arrows walk the ring up from the latest entry, one
    # press as soon as the last has landed. The band fetches a batch ahead
    # once the ring reaches its window's first row, so no press waits for a
    # read by design, and the helper's read is timed by the benchmark; what a
    # person meets is the slowest press in each batch's stretch of events.
    # The first stretch lies in the window the band opened on, and loads none.
    terminal.key("ctrl-x", "tab", pause=0.5)
    park(terminal)
    slowest: dict[int, float] = {}
    newest = None
    while len(slowest) <= runs + 1:
        before = ringed(frame(terminal))
        check(len(before) == 1, f"{len(before)} band rows drawn focused")
        took = timed(
            terminal, lambda: terminal.key("up", pause=0),
            lambda t: (r := ringed(frame(t))) and len(r) == 1 and r != before, "a press to move the ring",
        )
        match = FIXTURE_ROW.search(before[0][1])
        if match:
            newest = newest or int(match.group(1))
            batch = (newest - int(match.group(1))) // stretch
            slowest[batch] = max(slowest.get(batch, 0), took)
    loaded = [slowest[batch] for batch in sorted(slowest)[1:runs + 1]]
    ctx.env.snap(terminal, "walked back")
    results = {"open": opened[1:], "a press across an earlier batch's load": loaded[1:], "show a new entry": shown_new[1:]}
    report = "; ".join(f"{name} p95 {p95(samples) * 1000:.0f} ms" for name, samples in results.items())
    for name, samples in results.items():
        check(p95(samples) <= 1.0, f"{name}: p95 over 1 second ({report})")
    return f"100,000 events; one warm-up then ten runs each, key to frame: {report}"


def cramped(ctx: Context, terminal: Terminal) -> bool:
    """The open band drawn as its title alone, saying space is short."""
    band = [row for row in ctx.band(terminal) if row.strip()]
    # The label is cut to the band's body, so only its start is certain.
    return len(band) == 1 and title(ctx, terminal).startswith("▾ Prompt Trail · 空间")


@scenario("PT-UI-007")
def ui_007(ctx: Context) -> str:
    wide, other = ctx.marker("PT-UI-007"), ctx.marker("PT-UI-007")
    # Wide, combining and multi-line text ahead of the marker, so a narrow
    # row still shows it.
    text = f"中文😀e\u0301 {prompt(wide)}\n\n第二行 宽字符"
    terminal = seeded(ctx, "PT-UI-007", 40, columns=100, lines=40)
    ctx.expand(terminal, "PT-FIXTURE")
    terminal.paste(text)
    time.sleep(0.5)
    terminal.key("enter")
    terminal.wait_idle()
    terminal.wait_for(lambda _: any(e["promptText"] == text for e in ctx.entries()), "the wide entry to be archived", 15)
    away_from_bottom(ctx, terminal)
    ctx.submit(terminal, prompt(other))
    counted(ctx, terminal, 1)
    terminal.key("ctrl-x", "tab", pause=0.5)
    terminal.key("up", pause=0.5)
    park(terminal)
    before, ring = ctx.band(terminal), ringed(frame(terminal))
    check(len(ring) == 1, "the ring is not on one row")
    ctx.env.snap(terminal, "before resizing")
    # Under 28 columns or 22 rows, the open band is its title alone; with
    # room again it is open as it was: the same rows and count, the ring back
    # on its row.
    for small in ((27, 40), (100, 21)):
        terminal.resize(*small)
        terminal.wait_for(lambda t: cramped(ctx, t), f"the band to give way at {small}", 10)
        ctx.env.snap(terminal, f"cramped at {small}")
        terminal.resize(100, 40)
        terminal.wait_for(lambda t: ctx.band(t) == before and ringed(frame(t)) == ring, f"the band as it was after {small}", 10)
        ctx.env.snap(terminal, f"restored after {small}")
    # At 28 columns and at 22 rows it draws its rows.
    for room in ((28, 40), (100, 22)):
        terminal.resize(*room)
        terminal.wait_for(lambda t: not cramped(ctx, t) and len(ctx.band(t)) > 2, f"the band to draw its rows at {room}", 10)
        ctx.env.snap(terminal, f"room at {room}")
    terminal.resize(100, 40)
    # Each entry keeps to one row at 30 to 40 columns.
    terminal.key("esc", pause=0.5)
    ctx.click_row(terminal, "↓ 1 条新条目", "↓ 1 条新条目")
    park(terminal)
    for columns in (30, 34, 40):
        terminal.resize(columns, 40)
        band = terminal.wait_for(lambda t: (x := ctx.band(t)) and shown(x, other) and shown(x, wide) and x, f"the entries at {columns} columns", 10)
        ctx.env.snap(terminal, f"{columns} columns")
        row = band.index(shown(band, wide)[0])
        check("中文😀" in band[row], f"the wide entry's row does not show its wide text at {columns} columns")
        after = band[row + 1]
        check(bool(STOP.match(after)) or after.startswith("——"), f"the wide entry wrapped at {columns} columns")
    # Short of space, the title still folds and opens the band.
    terminal.resize(27, 40)
    terminal.wait_for(lambda t: cramped(ctx, t), "the band to give way", 10)
    click_title(ctx, terminal, "Prompt")
    terminal.wait_for(lambda t: collapsed(ctx, t), "the title to fold the band", 10)
    click_title(ctx, terminal, "Prompt")
    terminal.wait_for(lambda t: cramped(ctx, t), "the title to open the band", 10)
    ctx.env.snap(terminal, "folded and opened while cramped")
    terminal.resize(100, 40)
    return (
        "at 27 columns and at 21 rows the open band drew its title alone, saying space is short; at 28 and 22 its rows "
        "came back; restored, it showed the same rows and count with the ring on the same entry; a wide, combining, "
        "multi-line entry kept to one row at 30, 34 and 40 columns; while cramped the title folded and opened the band"
    )


@scenario("PT-UI-008")
def ui_008(ctx: Context) -> str:
    terminal = seeded(ctx, "PT-UI-008", 40, columns=100, lines=40)
    ctx.expand(terminal, "PT-FIXTURE")
    top = away_from_bottom(ctx, terminal)
    option = re.compile(r"^\s*(❯)?\s*1\. 甲$")
    for count, how in ((1, "answered"), (2, "cancelled")):
        marker = ctx.marker("PT-UI-008")
        ctx.send(terminal, f"{marker} 请调用 AskUserQuestion 工具问我一个问题：选甲还是乙？选项只有「甲」和「乙」。不要做别的事。")
        terminal.wait_for(lambda t: any(map(option.match, t.rows())), "the model's AskUserQuestion dialog", 90)
        time.sleep(1)
        ctx.env.snap(terminal, "dialog up")
        check(not ctx.band(terminal), "the band stayed while the dialog was up")
        if how == "answered":
            ctx.choose(terminal, "甲")
        else:
            terminal.key("esc", pause=1)
        terminal.wait_idle()
        band = counted(ctx, terminal, count)
        ctx.env.snap(terminal, f"dialog {how}")
        check(band[1] == top, f"the band came back elsewhere after the dialog was {how}")
    return (
        "the band gave way while the model's AskUserQuestion dialog was up, and came back open where it was, "
        "counting the prompt that asked, after the dialog was answered and after it was cancelled"
    )


CLEAR_PHRASE = "delete all prompts"
DAMAGE_DIALOG = "档案不可用"
# Every line status draws, and the lines only some states add: a status that
# draws anything else says more than the contract lets it.
STATUS_FIELDS = {
    "support", "reason", "target", "not promised", "detected", "collection consent",
    "Run collection mode", "latest collection boundary", "pending reconciliation",
    "clear transition", "integrity", "integrity gaps", "archive", "Archive generation",
    "Quarantined archives", "disk space", "project", "database root", "helper", "locator", "run",
}
STATUS_STATE_FIELDS = {"choices", "quarantine", "clear", "clear-run"}


def flat(text: str) -> str:
    """Text as one line: the host wraps long answers and dialog lines, and
    continues them indented or under a │ rule."""
    return re.sub(r"\s*\n\s*(?:│\s*)?", "", text)


def archive_file(ctx: Context) -> pathlib.Path:
    found = sorted((ctx.env.config / "plugins" / "data").glob("*/archives/*.sqlite3"))
    check(len(found) == 1, f"expected one active archive, found {len(found)}")
    return found[0]


def archive_bytes(ctx: Context) -> int:
    """What the active archive takes on disk: the file, its WAL and its shared memory."""
    database = archive_file(ctx)
    companions = [database, database.with_name(f"{database.name}-wal"), database.with_name(f"{database.name}-shm")]
    return sum(path.stat().st_size for path in companions if path.exists())


def quarantine_root(ctx: Context) -> pathlib.Path:
    return archive_file(ctx).parent / "quarantine" / archive_file(ctx).stem


def status_fields(ctx: Context, terminal: Terminal) -> dict[str, str]:
    """Status, line by line, as {field: value}; drawn on a terminal wide
    enough that no line wraps."""
    after = ctx.command(terminal, "/prompt-history status", "run: ")
    lines = after.splitlines()
    ends = [i for i, row in enumerate(lines) if row.strip().startswith("run: ")]
    lines = lines[: ends[0] + 1]
    check(not ctx.scanner.find("\n".join(lines).encode()), "status shows prompt text")
    fields = {}
    for row in lines:
        line = re.sub(r"^\s*⎿\s+prompt-trail: ", "", row).strip()
        if not line or line == "Prompt Trail status":
            continue
        if line.startswith("/"):
            continue  # A quarantined archive, under its count.
        name, _, value = line.partition(": ")
        fields[name] = value
        if name == "run":
            break
    extra = set(fields) - STATUS_FIELDS - STATUS_STATE_FIELDS
    check(not extra, f"status draws lines the contract does not name: {sorted(extra)}")
    # With no helper to ask, the archive's generation reads as unknown and
    # its quarantined archives go uncounted.
    wanted = STATUS_FIELDS - ({"Quarantined archives"} if fields.get("Archive generation") == "unknown" else set())
    check(wanted <= set(fields), f"status leaves out {sorted(wanted - set(fields))}")
    return fields


def shown_dialog(terminal: Terminal, header: str) -> str | None:
    """The dialog under `header` as one line, once its choices are drawn."""
    rows = terminal.rows()
    at = [i for i, row in enumerate(rows) if row.strip() == f"☐ {header}"]
    if not at:
        return None
    ends = [i for i in range(at[-1], len(rows)) if rows[i].startswith("Enter to select")]
    return flat("\n".join(rows[at[-1]:ends[0]])) if ends else None


def dialog(ctx: Context, terminal: Terminal, header: str, timeout: float = 30) -> str:
    text = terminal.wait_for(lambda t: shown_dialog(t, header), f"the {header} dialog", timeout)
    ctx.env.snap(terminal, f"{header} dialog")
    check(not ctx.scanner.find(text.encode()), f"the {header} dialog shows prompt text")
    return text


def answer_freely(ctx: Context, terminal: Terminal, text: str) -> None:
    """Moves the dialog's selection onto its free-input item, types `text`
    there and confirms it."""
    def confirm() -> None:
        terminal.type(text)
        time.sleep(0.5)
        ctx.env.snap(terminal, "phrase typed")
        terminal.key("enter", pause=1)

    select_option(
        terminal, "Type something.", confirm,
        absent="the dialog has no free-input item", unreached="could not reach the free-input item",
    )


def replied(ctx: Context, terminal: Terminal, command: str, expect: str) -> str:
    """The answer a command gave after its dialog closed, as one line."""
    return ctx.reply(terminal, command, expect, 60, flatten=True, label=f"{command} answered")


def dismiss(ctx: Context, terminal: Terminal) -> None:
    """Closes a dialog that holds a submission, which keeps it held and puts
    its draft back in the prompt box, then empties the box."""
    draft_back(terminal)
    empty_prompt_box(terminal)
    ctx.env.snap(terminal, "dismissed")


def draft_back(terminal: Terminal) -> None:
    """Closes a dialog that holds a submission and waits for its draft to
    come back. A dialog just drawn may not take keys yet."""
    for _ in range(5):
        time.sleep(1)
        terminal.key("esc", pause=1)
        if "草稿已恢复" in terminal.text():
            break
    terminal.wait_for("草稿已恢复", "the held draft to come back", 15)


def empty_prompt_box(terminal: Terminal) -> None:
    for _ in range(40):
        if not terminal.rows()[_prompt_box(terminal)][1:].strip():
            return
        terminal.key(*["backspace"] * 20, pause=0.01)
        time.sleep(0.3)
    raise ScenarioFailure("could not empty the prompt box")


def break_entries_root(ctx: Context, database: pathlib.Path | None = None) -> tuple[int, bytes]:
    """Damages the archive as a failing disk would: the page at the root of
    the Prompt Entries table overwritten, after the WAL is folded in. Answers
    where the page stands and what it held. No host may have it open."""
    database = database or archive_file(ctx)
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    (page_size,) = connection.execute("PRAGMA page_size").fetchone()
    (root,) = connection.execute("SELECT rootpage FROM sqlite_master WHERE name='prompt_entries'").fetchone()
    connection.close()
    with database.open("r+b") as file:
        file.seek((root - 1) * page_size)
        page = file.read(page_size)
        file.seek((root - 1) * page_size)
        file.write(b"\xa5" * page_size)
    return (root - 1) * page_size, page


def damage(ctx: Context, terminal: Terminal, **size) -> Terminal:
    """Leaves the host, damages the archive, and answers a new process on it."""
    ctx.exit(terminal)
    break_entries_root(ctx)
    return ctx.relaunch(**size)


def let_through_once(ctx: Context, marker: str, before: int) -> None:
    """Checks that a prompt the damage held entered once since `before`
    human prompt rows. A line count says nothing: on 2.1.290 such a prompt
    left 3 lines holding its marker where an ordinary one leaves 1, and the
    host may still be writing them when the entry lands."""
    deadline = time.monotonic() + 15
    while (entered := ctx.human_rows(marker) - before) != 1 and time.monotonic() < deadline:
        time.sleep(0.5)
    check(entered == 1, f"the held prompt was not let through once: {entered} human prompt rows")


def meet_damage(ctx: Context, terminal: Terminal, marker: str) -> str:
    """Submits until the damage holds a submission, and answers its dialog.
    The helper's health check may hold the first try at its pre-write; if the
    damage is not found there, the confirmation touches the damaged page, and
    the pending it leaves meets the damage at the next submission."""
    for _ in range(2):
        ctx.send(terminal, prompt(marker))
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if shown_dialog(terminal, DAMAGE_DIALOG):
                return dialog(ctx, terminal, DAMAGE_DIALOG)
            time.sleep(0.2)
        terminal.wait_idle()
    ctx.env.snap(terminal, "damage never held a submission")
    raise ScenarioFailure("the damaged archive never offered its choices")


def quarantine(ctx: Context, terminal: Terminal, marker: str, **size) -> Terminal:
    """Damages the archive and quarantines it from the dialog the damage
    raises; the held prompt then starts the next generation."""
    terminal = damage(ctx, terminal, **size)
    meet_damage(ctx, terminal, marker)
    ctx.choose(terminal, "隔离并开始新档案")
    terminal.wait_idle()
    ctx.env.snap(terminal, "quarantined")
    check(any(quarantine_root(ctx).iterdir()), "the quarantine holds no archive")
    return terminal


@scenario("PT-CONTROL-001")
def control_001(ctx: Context) -> str:
    wide = {"columns": 250, "lines": 60}
    marker = ctx.marker("PT-CONTROL-001")
    terminal = ctx.env.launch(**wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    database = archive_file(ctx)
    # Healthy.
    healthy = status_fields(ctx, terminal)
    check(healthy["collection consent"] == "granted · policy 1", "status does not say consent is granted")
    check(healthy["Run collection mode"] == "enabled", "status does not say the Run collects")
    check(healthy["integrity"] == "healthy" and healthy["integrity gaps"] == "0", "a healthy archive reads as unhealthy")
    check(healthy["project"] == str(ctx.env.project()), "status names another project path")
    check(healthy["database root"] == str(database.parent), "status names another database root")
    size = archive_bytes(ctx)
    check(healthy["archive"] == f"ready · {database} · {size} bytes", "status does not give the archive's path and size")
    # With Integrity gaps in the history.
    ctx.exit(terminal)
    # Seed 22's 400 events hold Integrity gaps, as PT-UI-002 found.
    timeline_fixture.build(database, database.stem, 400, seed=22)
    gaps = len(boundaries(ctx, "integrity-gap"))
    check(gaps > 0, "the fixture wrote no Integrity gap")
    terminal = ctx.relaunch(**wide)
    gapped = status_fields(ctx, terminal)
    check(
        gapped["integrity gaps"] == f"{gaps} · 本项目的时间线跨越这些 Integrity gap 的部分不完整",
        "status does not count the Integrity gaps in the history",
    )
    # Failed: the archive is damaged, and status still answers.
    terminal = damage(ctx, terminal, **wide)
    meet_damage(ctx, terminal, marker)
    dismiss(ctx, terminal)
    failed = status_fields(ctx, terminal)
    check(failed["archive"].startswith("unavailable · 范围 archive · 类别 archive-integrity"), "status does not say the archive is damaged")
    check(failed.get("choices", "").startswith("重新检查完整性 / 隔离并开始新档案"), "status does not name the damage's choices")
    return (
        f"healthy: consent, Run mode, health, project, database path and {size} bytes; "
        f"{gaps} Integrity gaps counted; damaged: archive-integrity with its choices; "
        "no line beyond the contract's and no prompt text in any"
    )


def refused_confirmation(ctx: Context, terminal: Terminal, marker: str) -> str:
    """Leaves a Pending Capture as PT-CAPTURE-008 does: the release fixture
    holds the prompt after it is staged, and the archive's write lock makes
    its confirmation fail. The prompt entered the session; its text is
    answered. Needs the terminal launched with the fixture."""
    text = f"{prompt(marker)} PT-FIXTURE-HOLD"
    ctx.send(terminal, text)
    terminal.wait_for(
        lambda _: any(p["promptText"] == text for p in ctx.pending()), "the held prompt to be staged", 15,
    )
    staged = ctx.env.archive()
    with write_lock(archive_file(ctx)):
        terminal.wait_idle(timeout=180)
        time.sleep(12)
        ctx.env.snap(terminal, "confirmation refused")
        check("hook skipped" not in terminal.text(), "the fixture's hook failed, so nothing was held")
    # Nothing is removed or written behind the failure once the lock is gone:
    # the pending waits for the next submission to settle it.
    time.sleep(2)
    check(ctx.env.archive() == staged, "the archive changed after the refused confirmation, with no submission to settle it")
    return text


@scenario("PT-CONTROL-002")
def control_002(ctx: Context) -> str:
    first, stopped, held, after = (ctx.marker("PT-CONTROL-002") for _ in range(4))
    terminal = ctx.env.launch(plugins=[FIXTURE], lines=60)
    ctx.start(terminal)
    # The first enable asks for consent before it writes anything.
    ctx.send(terminal, "/prompt-history enable")
    terminal.wait_for("采集同意", "the consent question", 30)
    check(ctx.env.archive() is None, "enable wrote before consent was given")
    ctx.env.snap(terminal, "consent asked")
    ctx.choose(terminal, "启用")
    replied(ctx, terminal, "/prompt-history enable", "已开始采集")
    check(len(boundaries(ctx, "collection-started")) == 1, "enable did not record collection starting")
    ctx.submit(terminal, prompt(first))
    check(shown_dialog(terminal, "采集同意") is None, "a prompt after enable asked for consent again")
    ctx.wait_entries(1)
    # Disabled, the Run archives nothing more and deletes nothing.
    ctx.command(terminal, "/prompt-history disable", "已停用采集")
    ctx.submit(terminal, prompt(stopped))
    time.sleep(2)
    check([e["promptText"] for e in ctx.entries()] == [prompt(first)], "disable deleted entries or archived a prompt")
    check(not ctx.pending(), "a disabled Run staged a Pending Capture")
    fields = ctx.status(terminal)
    check("collection consent: granted" in fields and "Run collection mode: disabled" in fields, "disable changed consent, or did not stop the Run")
    # Collecting again, a confirmation fails and leaves a pending; enabled
    # once more after a disable, the Run settles it before it resumes.
    ctx.command(terminal, "/prompt-history enable", "已恢复采集")
    text = refused_confirmation(ctx, terminal, held)
    ctx.command(terminal, "/prompt-history disable", "已停用采集")
    ctx.command(terminal, "/prompt-history enable", "已恢复采集")
    check(not ctx.pending(), "enable resumed with the pending still owed")
    confirmed = [e for e in ctx.entries() if e["promptText"] == text]
    check(len(confirmed) == 1, "enable did not settle the pending from its stored row")
    resumed = boundaries(ctx, "collection-resumed")[-1]
    check(confirmed[0]["sequence"] < resumed["sequence"], "the pending was settled after the resume was written")
    ctx.submit(terminal, prompt(after))
    entry_after = entry(ctx.wait_entries(3), after)
    check(
        entry_after["parentEventId"] is None and entry_after["branchId"] == resumed["branchId"],
        "the prompt after the resume does not start the new root branch",
    )
    return (
        "enable asked for consent first, then recorded the start; disabled, a prompt was neither archived nor staged "
        "and nothing was deleted; with a pending owed, enable settled it from its stored row, then wrote the resume, "
        "and the next prompt started its new root branch"
    )


# What both clears must say they leave alone: spec's deletion boundary.
DELETE_BOUNDARY = ("transcript/history", "文件系统快照", "第三方备份", "SSD")


def events_of(ctx: Context, run: str) -> list[dict]:
    archive = ctx.env.archive()
    return sorted(
        (e for e in archive["entries"] + archive["boundaries"] if e["runId"] == run),
        key=lambda e: e["eventId"],
    )


@scenario("PT-DELETE-001")
def delete_001(ctx: Context) -> str:
    a1, a2, b1, b2, c = (ctx.marker("PT-DELETE-001") for _ in range(5))
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(a1), consent=True)
    ctx.submit(terminal, prompt(a2))
    ctx.wait_entries(2)
    kept_run, _ = ctx.identity(terminal)
    ctx.exit(terminal)
    terminal = ctx.relaunch(lines=60)
    ctx.submit(terminal, prompt(b1))
    ctx.submit(terminal, prompt(b2))
    ctx.wait_entries(4)
    run, _ = ctx.identity(terminal)
    kept = events_of(ctx, kept_run)
    # Cancelled, nothing goes.
    ctx.send(terminal, "/prompt-history clear-run")
    asked = dialog(ctx, terminal, "清除当前 Run")
    check("2 条 Prompt Entry" in asked, "the confirmation does not count this Run's entries")
    check(run not in asked, "the confirmation shows the Run's identifier")
    ctx.choose(terminal, "取消")
    replied(ctx, terminal, "/prompt-history clear-run", "已取消，未删除任何内容。")
    check(len(ctx.entries()) == 4, "a cancelled clear-run removed entries")
    # Confirmed, only this Run goes.
    ctx.send(terminal, "/prompt-history clear-run")
    dialog(ctx, terminal, "清除当前 Run")
    ctx.choose(terminal, "清除当前 Run")
    replied(ctx, terminal, "/prompt-history clear-run", "已清除当前 Run 的 Prompt Trail 记录：2 条 Prompt Entry")
    check([e["promptText"] for e in ctx.entries()] == [prompt(a1), prompt(a2)], "clear-run did not leave exactly the other Run's entries")
    check(events_of(ctx, kept_run) == kept, "clear-run changed the other Run's records")
    check(not events_of(ctx, run), "clear-run left records of this Run")
    # With a quarantined archive, no Run clear can be complete.
    terminal = quarantine(ctx, terminal, c, lines=60)
    before = ctx.entries()
    ctx.send(terminal, "/prompt-history clear-run")
    refused = replied(ctx, terminal, "/prompt-history clear-run", "本项目有隔离档案")
    check("/prompt-history clear-all" in refused and "未删除任何内容" in refused, "the refusal does not point to clear-all")
    check(ctx.entries() == before, "a refused clear-run removed entries")
    return (
        "the confirmation counted 2 entries of this Run; cancelling removed nothing; confirming removed this Run's "
        "records and left the other Run's as they were; with a quarantined archive clear-run refused and pointed to clear-all"
    )


@scenario("PT-DELETE-002")
def delete_002(ctx: Context) -> str:
    a, b, c, d = (ctx.marker("PT-DELETE-002") for _ in range(4))
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(a), consent=True)
    ctx.submit(terminal, prompt(b))
    ctx.wait_entries(2)
    terminal = quarantine(ctx, terminal, c, lines=60)
    ctx.wait_entries(1)
    database = archive_file(ctx)
    root = database.parent
    _, generation = ctx.identity(terminal)
    # A phrase that is not the phrase removes nothing.
    ctx.send(terminal, "/prompt-history clear-all")
    asked = dialog(ctx, terminal, "清除档案")
    check("隔离档案：" in asked, "the confirmation does not list the quarantined archive")
    answer_freely(ctx, terminal, "delete all")
    replied(ctx, terminal, "/prompt-history clear-all", "确认短语不符，未删除任何内容。")
    check(database.exists() and any(quarantine_root(ctx).iterdir()), "a mistyped phrase removed files")
    # The phrase removes everything the project archived.
    quarantined = quarantine_root(ctx)
    ctx.send(terminal, "/prompt-history clear-all")
    dialog(ctx, terminal, "清除档案")
    answer_freely(ctx, terminal, CLEAR_PHRASE)
    cleared = replied(ctx, terminal, "/prompt-history clear-all", "已清除本项目的 Prompt Trail 档案")
    check("1 个隔离档案" in cleared, "the answer does not count the quarantined archive")
    left = sorted(path.name for path in root.iterdir() if path.name.startswith(database.stem))
    check(left == [f"{database.stem}.health.lock", f"{database.stem}.lock"], f"clear-all left {left}")
    check(not quarantined.exists(), "clear-all left the quarantined archive")
    status = ctx.status(terminal)
    check("collection consent: granted" in status and "Run collection mode: enabled" in status, "clear-all changed consent or the Run mode")
    # The Run goes on collecting in an empty timeline of a new generation.
    ctx.submit(terminal, prompt(d))
    check(shown_dialog(terminal, "采集同意") is None, "the prompt after clear-all asked for consent again")
    check([e["promptText"] for e in ctx.wait_entries(1)] == [prompt(d)], "the timeline after clear-all is not empty but for the new prompt")
    _, new_generation = ctx.identity(terminal)
    check(new_generation not in (generation, "none"), "status shows the timeline after clear-all as the same generation")
    return (
        "the confirmation listed the quarantined archive; a mistyped phrase removed nothing; the phrase removed the active "
        "archive with its WAL/SHM and the quarantine, leaving only the two stable locks; consent and the Run mode stayed; "
        "the next prompt started a new generation with no consent question"
    )


@scenario("PT-DELETE-003")
def delete_003(ctx: Context) -> str:
    a, b = (ctx.marker("PT-DELETE-003") for _ in range(2))
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    # Nothing archived: both clears say so and ask nothing.
    ctx.command(terminal, "/prompt-history clear-run", "当前 Run 没有可清除的 Prompt Trail 记录。")
    ctx.command(terminal, "/prompt-history clear-all", "没有可清除的 Prompt Trail 档案。")
    check(ctx.env.archive() is None, "a clear with nothing archived made an archive")
    # A WAL that cannot be removed: logically cleared, physically not.
    ctx.submit(terminal, prompt(a), consent=True)
    ctx.wait_entries(1)
    database = archive_file(ctx)
    wal = database.with_name(f"{database.name}-wal")
    check(wal.exists(), "the archive has no WAL to hold")
    subprocess.run(["/usr/bin/chflags", "uchg", str(wal)], check=True)
    try:
        ctx.send(terminal, "/prompt-history clear-all")
        dialog(ctx, terminal, "清除档案")
        answer_freely(ctx, terminal, CLEAR_PHRASE)
        stopped = replied(ctx, terminal, "/prompt-history clear-all", "物理清除未完成")
        check("逻辑删除已完成" in stopped, "the answer does not say the logical deletion is done")
        check(f"{wal.name}（" in stopped, "the answer does not list the WAL left behind")
        check(not database.exists(), "the clear left the archive itself")
        status = ctx.status(terminal)
        check("clear: unfinished · 1 residual" in status, "status does not report the unfinished clear")
        check("archive: unavailable" in status, "the archive reads as available with a clear unfinished")
        ctx.send(terminal, prompt(b))
        held = dialog(ctx, terminal, DAMAGE_DIALOG)
        check(wal.name in held, "the held submission's dialog does not list what is left")
        dismiss(ctx, terminal)
        check(not ctx.entries(), "a submission reached the archive while the clear was unfinished")
    finally:
        subprocess.run(["/usr/bin/chflags", "nouchg", str(wal)], check=True)
    # Once the file can go, clear-all finishes the clear without the phrase.
    ctx.send(terminal, "/prompt-history clear-all")
    dialog(ctx, terminal, "继续清除")
    ctx.choose(terminal, "继续清除")
    finished = replied(ctx, terminal, "/prompt-history clear-all", "已清除本项目的 Prompt Trail 档案")
    check("损坏" not in finished, "finishing the clear calls the archive it removed damaged")
    check(not wal.exists(), "the finished clear left the WAL")
    check("clear: unfinished" not in ctx.status(terminal), "status still reports the clear unfinished")
    ctx.submit(terminal, prompt(b))
    check([e["promptText"] for e in ctx.wait_entries(1)] == [prompt(b)], "the archive did not come back after the clear finished")
    return (
        "with nothing archived both clears answered without asking; a WAL made immutable left the clear logically done "
        "and physically unfinished, listed in the answer and in status, holding the next submission; once the WAL "
        "could go, clear-all finished without the phrase and the next prompt was archived"
    )


@scenario("PT-DELETE-004")
def delete_004(ctx: Context) -> str:
    marker = ctx.marker("PT-DELETE-004")
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    for command, header in (("/prompt-history clear-run", "清除当前 Run"), ("/prompt-history clear-all", "清除档案")):
        ctx.send(terminal, command)
        asked = dialog(ctx, terminal, header)
        missing = [words for words in DELETE_BOUNDARY if words not in asked]
        check(not missing, f"the {header} confirmation does not say it leaves {missing} alone")
        ctx.choose(terminal, "取消")
        replied(ctx, terminal, command, "已取消，未删除任何内容。")
    check(len(ctx.entries()) == 1, "reading a confirmation removed entries")
    return "both confirmations say they leave the transcript/history, filesystem snapshots and third-party backups alone and promise no SSD erasure"


@scenario("PT-SEC-001")
def sec_001(ctx: Context) -> str:
    marker = ctx.marker("PT-SEC-001")
    # The scan itself: a marker is found where it may not be, and passed
    # over only in an archive file. Outside the world, removed at once.
    with tempfile.TemporaryDirectory() as scratch:
        base = pathlib.Path(scratch)
        archives = base / "config" / "plugins" / "data" / "prompt-trail-inline" / "archives"
        archives.mkdir(parents=True)
        (base / "config" / "notes.txt").write_text(marker)
        (archives / f"{'0' * 64}.sqlite3").write_text(marker)
        found = evidence.scan_tree(base, ctx.scanner, config="config")
    check([leak["kind"] for leak in found["leaks"]] == ["marker"], "the scan does not find a marker outside the archive")
    check(found["allowedFiles"] == 1, "the scan does not pass over the archive file")
    terminal = ctx.env.launch(columns=250, lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    database = archive_file(ctx)
    archived = b"".join(path.read_bytes() for path in database.parent.glob(f"{database.name}*"))
    check(marker.encode() in archived, "the archive does not hold the prompt")
    # Shown where it may be, and nowhere else the UI speaks.
    ctx.expand(terminal, marker)
    status_fields(ctx, terminal)
    ctx.send(terminal, "/prompt-history clear-run")
    dialog(ctx, terminal, "清除当前 Run")
    ctx.choose(terminal, "取消")
    replied(ctx, terminal, "/prompt-history clear-run", "已取消")
    terminal = damage(ctx, terminal, columns=250, lines=60)
    meet_damage(ctx, terminal, marker)
    dismiss(ctx, terminal)
    found = evidence.scan_tree(ctx.env.base, ctx.scanner, config=str(ctx.env.config.relative_to(ctx.env.base)))
    check(not found["leaks"], f"{len(found['leaks'])} file(s) outside the archive hold the prompt")
    check(found["allowedFiles"] > 0 and found["scannedFiles"] > 0, "the scan read no files")
    check(not ctx.env.argv_leaks, "a process took the prompt in its argv")
    return (
        f"the scan found a planted marker and passed over the archive; the prompt stood in the archive and the band, "
        f"not in status, a clear confirmation or the damage dialog; {found['scannedFiles']} files scanned, "
        f"{found['allowedFiles']} archive or host files passed over, no argv held it"
    )


def plugin_copy(ctx: Context, name: str = "plugin") -> pathlib.Path:
    """What the plugin ships, copied into the world, so a scenario can change
    its helper without touching the plugin under test."""
    copy = ctx.env.base / name
    for part in (".claude-plugin", "hooks", "bin", "artifacts"):
        shutil.copytree(ctx.env.plugin_root / part, copy / part)
    return copy


def helper_calls(ctx: Context) -> pathlib.Path:
    return ctx.env.base / "helper-calls"


def logging_helper(ctx: Context) -> bytes:
    """A helper of another build: it notes each call in the world, subcommand
    only, then hands the call to the real helper. What it noted shows whether
    Prompt Trail ran a helper it had refused to trust."""
    original = ctx.env.plugin_root / "bin" / "prompt-trail-helper"
    calls, helper = shlex.quote(str(helper_calls(ctx))), shlex.quote(str(original))
    return f'#!/bin/sh\necho "$1" >> {calls} || exit 1\nexec {helper} "$@"\n'.encode()


def fault_tour(ctx: Context, scenario_id: str, observe) -> None:
    """The representative failures a real host meets, one after another in
    one world: a busy archive retried, a Run disabled to go on, a refused
    confirmation, damage, a clear that leaves a file, a locator and a helper
    that cannot be trusted. `observe(what, text)` sees what each failure put
    before the person."""
    first, busy, stopped, held, after, damaged, orphaned, blocked = (ctx.marker(scenario_id) for _ in range(8))
    wide = {"columns": 250, "lines": 60}
    terminal = ctx.env.launch(plugins=[FIXTURE], **wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.wait_entries(1)
    # A busy archive holds the submission until a retry finds it free.
    with write_lock(archive_file(ctx)):
        ctx.send(terminal, prompt(busy))
        observe("busy", dialog(ctx, terminal, DAMAGE_DIALOG))
        choose_once(terminal, "重试")
        terminal.wait_for(lambda t: not shown_dialog(t, DAMAGE_DIALOG), "the retry to start", 10)
        observe("busy again", dialog(ctx, terminal, DAMAGE_DIALOG))
    choose_once(terminal, "重试")
    terminal.wait_idle()
    observe("retried", str(len([e for e in ctx.wait_entries(2) if e["promptText"] == prompt(busy)])))
    # Disabled to go on: the prompt passes unarchived, and enable resumes.
    with write_lock(archive_file(ctx)):
        ctx.send(terminal, prompt(stopped))
        dialog(ctx, terminal, DAMAGE_DIALOG)
        choose_once(terminal, "禁用当前 Run 后继续")
        terminal.wait_for(lambda t: in_transcript(t, stopped), "the prompt to go through", 60)
        terminal.wait_idle()
    ctx.command(terminal, "/prompt-history enable", "已恢复采集")
    observe("disabled", "archived" if prompt(stopped) in [e["promptText"] for e in ctx.entries()] else "passed unarchived")
    # A confirmation the archive refused leaves a pending, reported by its
    # event ID, and settled at the next submission.
    refused_confirmation(ctx, terminal, held)
    observe("reconciliation owed", ctx.status(terminal))
    ctx.send(terminal, prompt(after))
    terminal.wait_for("已完成对账", "the reconciliation notice", 60)
    ctx.env.snap(terminal, "reconciled")
    observe("reconciled", terminal.text())
    terminal.key("enter")
    terminal.wait_idle()
    ctx.wait_entries(4)
    # Damage holds the next submission and moves nothing until chosen.
    terminal = damage(ctx, terminal, plugins=[FIXTURE], **wide)
    database = archive_file(ctx)
    observe("damage", meet_damage(ctx, terminal, damaged))
    # What the damage holds, as the person is asked about it; SQLite's
    # shared memory is rebuilt by any reader and is left out.
    before = {
        path.name: path.read_bytes() for path in database.parent.glob(f"{database.name}*")
        if not path.name.endswith("-shm")
    }
    ctx.choose(terminal, "隔离并开始新档案")
    terminal.wait_idle()
    kept = [path.parent for path in quarantine_root(ctx).rglob(database.name)]
    check(len(kept) == 1, "the quarantine does not hold the damaged archive once")
    check(
        {name: (kept[0] / name).read_bytes() for name in before if (kept[0] / name).exists()} == before,
        "the quarantine did not keep the damaged archive unchanged",
    )
    # A clear that cannot remove the WAL.
    wal = database.with_name(f"{database.name}-wal")
    subprocess.run(["/usr/bin/chflags", "uchg", str(wal)], check=True)
    try:
        ctx.send(terminal, "/prompt-history clear-all")
        dialog(ctx, terminal, "清除档案")
        answer_freely(ctx, terminal, CLEAR_PHRASE)
        observe("residue", replied(ctx, terminal, "/prompt-history clear-all", "物理清除未完成"))
        observe("residue status", ctx.status(terminal))
    finally:
        subprocess.run(["/usr/bin/chflags", "nouchg", str(wal)], check=True)
    ctx.send(terminal, "/prompt-history clear-all")
    dialog(ctx, terminal, "继续清除")
    ctx.choose(terminal, "继续清除")
    replied(ctx, terminal, "/prompt-history clear-all", "已清除本项目的 Prompt Trail 档案")
    ctx.submit(terminal, prompt(first))
    ctx.wait_entries(1)
    # A locator widened under the running Run is no proof of this process.
    (locator,) = locator_directory(ctx).glob("*.json")
    locator.chmod(0o644)
    try:
        observe("locator unavailable", ctx.status(terminal))
        ctx.send(terminal, prompt(orphaned))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not shown_dialog(terminal, DAMAGE_DIALOG) and not in_transcript(terminal, orphaned):
            time.sleep(0.2)
        ctx.env.snap(terminal, "submitted with the locator widened")
        observe("locator unavailable, submitted", shown_dialog(terminal, DAMAGE_DIALOG) or "went through")
        if shown_dialog(terminal, DAMAGE_DIALOG):
            dismiss(ctx, terminal)
        else:
            terminal.wait_idle()
    finally:
        locator.chmod(0o600)
    ctx.exit(terminal)
    # A helper that is not the one the plugin was built with.
    copy = plugin_copy(ctx)
    replace_file(copy / "bin" / "prompt-trail-helper", logging_helper(ctx))
    archived = archive_files(ctx)
    terminal = ctx.relaunch(plugin_root=copy, **wide)
    # Asked at once, status may meet a locator the bridge has yet to publish.
    for _ in range(5):
        unavailable = ctx.status(terminal)
        if "locator: unavailable" not in unavailable:
            break
        time.sleep(2)
    observe("helper unavailable", unavailable)
    check("support: helper unavailable" in unavailable, "status does not say the helper is unavailable")
    check("archive: unknown" in unavailable, "status claims to know the archive with no helper to check it")
    ctx.send(terminal, prompt(blocked))
    observe("helper unavailable, held", dialog(ctx, terminal, DAMAGE_DIALOG))
    dismiss(ctx, terminal)
    ctx.command(terminal, "/prompt-history", "已展开")
    time.sleep(2)
    band = ctx.band(terminal)
    ctx.env.snap(terminal, "band without a helper")
    check(not any(m[: evidence.MARKER_PREFIX] in row for m in (first, held, after) for row in band), "the band shows entries with no helper to read them")
    check(
        archive_files(ctx) == archived,
        "the archive changed while the helper was unavailable",
    )


def reported_privately(ctx: Context, what: str, text: str) -> None:
    """What a failure shows holds no prompt text."""
    check(not ctx.scanner.find(text.encode()), f"{what}: the report shows prompt text")


@scenario("PT-SEC-002")
def sec_002(ctx: Context) -> str:
    seen: dict[str, str] = {}

    def observe(what: str, text: str) -> None:
        if what == "reconciled":
            # The screen still shows the conversation; only the notice is the plugin's.
            text = "\n".join(row for row in text.splitlines() if "对账" in row)
        reported_privately(ctx, what, text)
        seen[what] = flat(text)

    fault_tour(ctx, "PT-SEC-002", observe)
    check(re.search(r"pending reconciliation: [0-9a-f]{8} · 待对账", seen["reconciliation owed"]) is not None, "status does not name the pending by its event ID")
    check("类别：archive-integrity" in seen["damage"], "the damage dialog does not name its category")
    check(".sqlite3-wal（" in seen["residue"], "the residue report does not name the file left")
    check("helper: unavailable" in seen["helper unavailable"], "status does not name the helper as unavailable")
    check(not ctx.env.argv_leaks, "a process took prompt text in its argv")
    return (
        "a busy archive, a refused confirmation, damage, a clear that left a file, a widened locator and an untrusted "
        "helper each reported an event ID, a category or a path and no prompt text; no process took prompt text in its argv"
    )


@scenario("PT-FAIL-006")
def fail_006(ctx: Context) -> str:
    seen: dict[str, str] = {}

    def observe(what: str, text: str) -> None:
        seen[what] = flat(text)

    fault_tour(ctx, "PT-FAIL-006", observe)
    expected = {
        "busy": ("类别：archive-busy", "范围：本项目所有 Run", "1. 重试"),
        "busy again": ("类别：archive-busy",),
        "retried": ("1",),
        "disabled": ("passed unarchived",),
        "reconciliation owed": ("· 待对账", "Run collection mode: disabled · 未决 Pending Capture 待对账"),
        "reconciled": ("已完成对账",),
        "damage": ("类别：archive-integrity", "1. 重新检查完整性", "2. 隔离并开始新档案"),
        "residue": ("物理清除未完成", ".sqlite3-wal（"),
        "residue status": ("clear: unfinished · 1 residual",),
        "locator unavailable": ("support: unsupported target", "reason: locator-permissions"),
        "locator unavailable, submitted": ("类别：locator-permissions", "本次提交尚未进入会话"),
        "helper unavailable": ("support: helper unavailable", "archive: unknown"),
        "helper unavailable, held": ("类别：digest-mismatch",),
    }
    missing = {what: [w for w in words if w not in seen.get(what, "")] for what, words in expected.items()}
    missing = {what: words for what, words in missing.items() if words}
    check(not missing, f"failures that did not behave as their scenarios say: {missing}")
    check(not helper_calls(ctx).exists(), "a helper of another build was run")
    return (
        "in one real host: a busy archive held the submission and a retry got it through once; disabling let a prompt "
        "through unarchived; a refused confirmation was reconciled; damage offered its choices; a clear that left a "
        "file reported it; a widened locator and an untrusted helper each held the submission, the helper never run"
    )


def xattrs(root: pathlib.Path) -> str:
    """Every extended attribute of every file the plugin ships, with its value."""
    return subprocess.run(["/usr/bin/xattr", "-lr", str(root)], capture_output=True, text=True, check=True).stdout


@scenario("PT-SEC-004")
def sec_004(ctx: Context) -> str:
    shipped = [ctx.env.plugin_root / part for part in (".claude-plugin", "hooks", "bin", "artifacts")]
    before = {str(part): xattrs(part) for part in shipped}
    ctx.env.watch_side_effects()
    fault_tour(ctx, "PT-SEC-004", lambda what, text: None)
    check(not ctx.env.side_effects, f"side effects: {sorted(ctx.env.side_effects)}")
    check(ctx.env.socket_checks > 0, "no helper or bridge process was ever sampled for sockets")
    check({str(part): xattrs(part) for part in shipped} == before, "the plugin's extended attributes changed")
    check(not helper_calls(ctx).exists(), "a helper of another build was run")
    return (
        "through a busy archive, a disabled Run, a refused confirmation, damage, a clear that left a file, a widened "
        "locator and an untrusted helper: no compiler, "
        f"xattr, spctl, codesign or network client started, no socket in {ctx.env.socket_checks} samples of a "
        "helper or bridge process, the plugin's extended "
        "attributes unchanged, no archive file changed or removed before the person chose, no timeline "
        "drawn without a helper, and the helper of another build never run"
    )


@scenario("PT-SEC-003")
def sec_003(ctx: Context) -> str:
    first, damaged, after, left = (ctx.marker("PT-SEC-003") for _ in range(4))
    ctx.env.watch_modes()
    # An archive as the first helpers left it, private as the helper requires.
    project = ctx.env.project()
    root = ctx.env.config / "plugins" / "data" / "prompt-trail-inline" / "archives"
    for directory in (root.parent.parent, root.parent, root):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    project_id = hashlib.sha256(str(project).encode()).hexdigest()
    legacy = root / f"{project_id}.sqlite3"
    connection = sqlite3.connect(legacy)
    connection.executescript(
        helper_protocol.HelperProtocolTests.SCHEMA_1_DDL
        + f"INSERT INTO metadata VALUES('{project_id}', 1, 0);PRAGMA user_version=1;"
    )
    connection.close()
    legacy.chmod(0o600)
    checked = []

    def private(after_what: str) -> None:
        wrong = ctx.env.private_modes()
        check(not wrong, f"after {after_what}: {wrong}")
        checked.append(after_what)

    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.send(terminal, prompt(first))
    terminal.wait_for("采集同意", "the consent question", 30)
    ctx.env.snap(terminal, "consent asked")
    ctx.choose(terminal, "启用")
    # No health record vouches for an archive the plugin did not create: it
    # is checked in full, by the person's choice, before anything is written.
    asked = dialog(ctx, terminal, DAMAGE_DIALOG)
    check("类别：archive-health-unknown" in asked, "the archive with no health record was not held for a full check")
    ctx.choose(terminal, "初始化并完整复检")
    terminal.wait_idle()
    ctx.env.snap(terminal, "submitted")
    ctx.wait_entries(1)
    with sqlite3.connect(legacy) as migrated:
        (version,) = migrated.execute("PRAGMA user_version").fetchone()
    check(version > 1, "the schema-1 archive was not migrated")
    private("migration")
    terminal = quarantine(ctx, terminal, damaged, lines=60)
    private("quarantine")
    ctx.send(terminal, "/prompt-history clear-all")
    dialog(ctx, terminal, "清除档案")
    answer_freely(ctx, terminal, CLEAR_PHRASE)
    replied(ctx, terminal, "/prompt-history clear-all", "已清除本项目的 Prompt Trail 档案")
    private("clear")
    ctx.submit(terminal, prompt(after))
    ctx.wait_entries(1)
    private("creation")
    wal = legacy.with_name(f"{legacy.name}-wal")
    subprocess.run(["/usr/bin/chflags", "uchg", str(wal)], check=True)
    try:
        ctx.send(terminal, "/prompt-history clear-all")
        dialog(ctx, terminal, "清除档案")
        answer_freely(ctx, terminal, CLEAR_PHRASE)
        replied(ctx, terminal, "/prompt-history clear-all", "物理清除未完成")
    finally:
        subprocess.run(["/usr/bin/chflags", "nouchg", str(wal)], check=True)
    ctx.send(terminal, "/prompt-history clear-all")
    dialog(ctx, terminal, "继续清除")
    ctx.choose(terminal, "继续清除")
    replied(ctx, terminal, "/prompt-history clear-all", "已清除本项目的 Prompt Trail 档案")
    ctx.submit(terminal, prompt(left))
    ctx.wait_entries(1)
    private("recovery from an unfinished clear")
    check(not ctx.env.mode_violations, f"sampled: {sorted(ctx.env.mode_violations)}")
    backup = any(".pre-migration-v" in name for name in ctx.env.names_seen)
    return (
        f"directories 0700 and files 0600 after {', '.join(checked)}, and in every 50 ms sample between; "
        + ("the migration backup was sampled while it stood" if backup else "the migration backup stood too briefly to be sampled; its mode is the helper unit test's")
    )

# The latest Claude Code below the supported minimum.
BELOW_MINIMUM = "2.1.289"
_HOSTS: dict = {}


def other_host(version: str, intel: bool = False) -> Host:
    """A host besides the one the run is for, fetched once per run."""
    if (version, intel) not in _HOSTS:
        _HOSTS[(version, intel)] = Host(version, intel)
    return _HOSTS[(version, intel)]


def locator_directory(ctx: Context) -> pathlib.Path:
    return ctx.env.config / "plugins" / "data" / ".function-hook-locators" / "prompt-trail"


def archives(ctx: Context) -> list[pathlib.Path]:
    return sorted((ctx.env.config / "plugins" / "data").glob("*/archives/*.sqlite3"))


def settled_status(ctx: Context, terminal: Terminal) -> dict[str, str]:
    """Status once the bridge has published this process's locator: asked at
    once after a launch, it may meet a locator yet to be written."""
    for _ in range(5):
        fields = status_fields(ctx, terminal)
        if fields["locator"] != "unavailable":
            return fields
        time.sleep(2)
    return fields


def archive_files(ctx: Context) -> dict[str, bytes]:
    """Every file beside the active archive, by name, with its bytes."""
    return {path.name: path.read_bytes() for path in archive_file(ctx).parent.iterdir() if path.is_file()}


def replace_file(path: pathlib.Path, content: bytes) -> None:
    """Puts `content` at `path` as a new file, executable, as an update would:
    a binary rewritten in place can be killed by the signature cached for it."""
    staged = path.with_name(f".{path.name}.new")
    staged.write_bytes(content)
    staged.chmod(0o755)
    staged.replace(path)


@scenario("PT-COMPAT-002")
def compat_002(ctx: Context) -> str:
    ctx.env.watch_side_effects()
    wide = {"columns": 250, "lines": 60}
    locators = locator_directory(ctx)
    cases = (
        ("Claude Code below the minimum", {"host": other_host(BELOW_MINIMUM)}, "claude-code-version", f"Claude Code {BELOW_MINIMUM}"),
        ("the Intel build under Rosetta", {"host": other_host(ctx.env.host.version, intel=True)}, "architecture", "Darwin x86_64"),
        ("no locator", {}, "claude-code-version-unproven", "Claude Code version unproven"),
    )
    for what, options, reason, detected in cases:
        marker = ctx.marker("PT-COMPAT-002")
        unwritable = what == "no locator"
        if unwritable:
            # A locator directory the bridge cannot write into.
            for directory in (locators.parent.parent, locators.parent, locators):
                directory.mkdir(mode=0o700, exist_ok=True)
            subprocess.run(["/usr/bin/chflags", "uchg", str(locators)], check=True)
        try:
            terminal = ctx.env.launch(**options, **wide)
            ctx.start(terminal)
            time.sleep(3)  # Whatever the bridge could publish, it has.
            fields = status_fields(ctx, terminal)
            check(fields["support"] == "unsupported target", f"{what}: status says {fields['support']}")
            check(fields["reason"] == reason, f"{what}: status gives the reason {fields['reason']}")
            check(detected in fields["detected"], f"{what}: status does not detect {detected}")
            check(fields["helper"].startswith("not checked"), f"{what}: the helper was checked")
            ctx.send(terminal, prompt(marker))
            terminal.wait_idle()
            ctx.env.snap(terminal, f"{what}: submitted")
            check("采集同意" not in terminal.text(), f"{what}: the prompt asked for consent")
            check(in_transcript(terminal, marker), f"{what}: the prompt did not go through")
            check(not archives(ctx), f"{what}: an archive was created")
            ctx.exit(terminal)
        finally:
            if unwritable:
                subprocess.run(["/usr/bin/chflags", "nouchg", str(locators)], check=True)
    # Beside them, the supported host collects.
    marker = ctx.marker("PT-COMPAT-002")
    terminal = ctx.env.launch(project="supported", **wide)
    ctx.start(terminal)
    check(settled_status(ctx, terminal)["support"] == "supported", "the supported host is not supported")
    ctx.submit(terminal, prompt(marker), consent=True)
    ctx.wait_entries(1)
    check(not ctx.env.side_effects, f"side effects: {sorted(ctx.env.side_effects)}")
    return (
        f"Claude Code {BELOW_MINIMUM}, the Intel build under Rosetta and a host whose bridge could publish no locator "
        "each read as unsupported target with its reason and an unchecked helper; none asked for consent or made an "
        "archive, and each prompt went through; the supported host collected; no compiler or network client started "
        f"({ctx.env.socket_checks} samples of a helper or bridge process, none with a socket)"
    )


@scenario("PT-COMPAT-003")
def compat_003(ctx: Context) -> str:
    first, second = (ctx.marker("PT-COMPAT-003") for _ in range(2))
    wide = {"columns": 250, "lines": 60}
    terminal = ctx.env.launch(**wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.submit(terminal, prompt(second))
    ctx.wait_entries(2)
    ctx.exit(terminal)
    archived = archive_files(ctx)
    # Each helper below is another build's: run, it would note the call.
    other = ctx.env.base / "other-helper"
    other.write_bytes(logging_helper(ctx))
    other.chmod(0o755)

    def symlinked(helper: pathlib.Path) -> None:
        helper.unlink()
        helper.symlink_to(other)

    def moded(mode: int):
        def change(helper: pathlib.Path) -> None:
            replace_file(helper, logging_helper(ctx))
            helper.chmod(mode)
        return change

    faults = (
        ("missing", pathlib.Path.unlink, "helper-missing"),
        ("a symlink", symlinked, "helper-not-regular"),
        ("not executable", moded(0o644), "helper-not-executable"),
        ("group-writable", moded(0o775), "helper-untrusted"),
        ("another build", moded(0o755), "digest-mismatch"),
        # Checked before the helper's digest, as a bridge of another build
        # would have published it.
        ("a locator of another protocol", moded(0o755), "protocol-mismatch"),
    )
    for index, (what, fault, category) in enumerate(faults):
        marker = ctx.marker("PT-COMPAT-003")
        copy = plugin_copy(ctx, f"plugin-{index}")
        helper = copy / "bin" / "prompt-trail-helper"
        fault(helper)
        terminal = ctx.relaunch(plugin_root=copy, **wide)
        if category == "protocol-mismatch":
            settled_status(ctx, terminal)
            (locator,) = locator_directory(ctx).glob("*.json")
            published = json.loads(locator.read_text())
            published["helperProtocol"] += 1
            locator.write_text(json.dumps(published))
        fields = settled_status(ctx, terminal)
        check(fields["support"] == "helper unavailable", f"{what}: status says {fields['support']}")
        check(fields["reason"] == category, f"{what}: status gives the reason {fields['reason']}")
        check(str(helper) in fields["helper"], f"{what}: status names another helper: {fields['helper']}")
        check(fields["archive"].startswith("unknown"), f"{what}: status claims to know the archive")
        ctx.send(terminal, prompt(marker))
        held = dialog(ctx, terminal, DAMAGE_DIALOG)
        check(f"类别：{category}" in held, f"{what}: the dialog does not name {category}")
        dismiss(ctx, terminal)
        ctx.command(terminal, "/prompt-history", "已展开")
        time.sleep(2)
        band = ctx.band(terminal)
        ctx.env.snap(terminal, f"{what}: band")
        check(not any(m[: evidence.MARKER_PREFIX] in row for m in (first, second) for row in band), f"{what}: the band shows entries")
        check(archive_files(ctx) == archived, f"{what}: the archive changed")
        check(not helper_calls(ctx).exists(), f"{what}: the untrusted helper was run")
        ctx.exit(terminal)
    return (
        "a helper missing, a symlink, not executable, group-writable or of another build, and a locator of another "
        "protocol each read as helper unavailable with its category and the copy's own helper path; each held the "
        "submission, the band showed no entry, the archive stayed byte for byte and the helper was never run"
    )


@scenario("PT-COMPAT-005")
def compat_005(ctx: Context) -> str:
    first, reloaded, held = (ctx.marker("PT-COMPAT-005") for _ in range(3))
    copy = plugin_copy(ctx)
    helper = copy / "bin" / "prompt-trail-helper"
    built = helper.read_bytes()
    terminal = ctx.env.launch(plugin_root=copy, lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.wait_entries(1)
    run, _ = ctx.identity(terminal)
    # The helper unchanged, a reload goes on in the same Run.
    ctx.command(terminal, "/reload-plugins", "eload")
    terminal.wait_idle()
    ctx.submit(terminal, prompt(reloaded))
    check(entry(ctx.wait_entries(2), reloaded)["runId"] == run, "the prompt after the reload went to another Run")
    # Another helper under the running Run holds its next submission.
    replace_file(helper, logging_helper(ctx))
    archived = archive_files(ctx)
    ctx.send(terminal, prompt(held))
    asked = dialog(ctx, terminal, DAMAGE_DIALOG)
    check("本 Run（其他 Run 不受影响）" in asked, "the changed helper is not this Run's failure")
    check(archive_files(ctx) == archived, "the archive changed under another helper")
    check(not helper_calls(ctx).exists(), "the helper of another build was run")
    # The original back, a retry submits the prompt once.
    replace_file(helper, built)
    ctx.choose(terminal, "重试")
    terminal.wait_idle()
    ctx.env.snap(terminal, "retried")
    entries = ctx.wait_entries(3)
    check(entry(entries, held)["runId"] == run, "the retried prompt went to another Run")
    check(ctx.transcript_rows(held) == ctx.transcript_rows(reloaded), "the retried prompt entered the session more than once")
    check(ctx.identity(terminal)[0] == run, "the Run changed")
    return (
        "a reload with the helper unchanged went on in the same Run; another helper held the next submission as this "
        "Run's failure with the archive unchanged and was never run; with the original back, a retry submitted it once in the same Run"
    )


def choose_once(terminal: Terminal, option: str) -> None:
    """Moves the dialog's selection onto `option` and confirms it once: a
    choice whose dialog comes back with the same options must not be taken
    again. A dialog just drawn may not take keys yet."""
    select_option(terminal, option, lambda: terminal.key("enter", pause=1))


def helpers_of(terminal: Terminal) -> int:
    """How many helper processes the host runs right now. A helper about to
    exit shows only its short name, so the name is matched, not its argv."""
    return sum(
        1 for _, ppid, _, args in _processes() if ppid == terminal.pid and "prompt-trail-hel" in args
    )


def options_of(terminal: Terminal, header: str) -> list[str]:
    """The choices of the dialog under `header`, read row by row, up to the
    host's own free-input item and what follows it."""
    rows = terminal.rows()
    at = [i for i, row in enumerate(rows) if row.strip() == f"☐ {header}"]
    check(bool(at), f"no {header} dialog")
    found = []
    for row in rows[at[-1]:]:
        match = re.match(r"^\s*(?:❯\s*)?\d+\. (.+)$", row)
        if match:
            if match.group(1).strip() == "Type something.":
                break
            found.append(match.group(1).strip())
    return found


@scenario("PT-STORE-002")
def store_002(ctx: Context) -> str:
    a0, b1, a2, b3, a4, b5, b6, a7 = (ctx.marker("PT-STORE-002") for _ in range(8))
    a = ctx.env.launch(lines=60)
    ctx.start(a)
    ctx.submit(a, prompt(a0), consent=True)
    b = ctx.env.launch(lines=60)
    ctx.start(b)
    # Two Runs of one project, submitting in turn.
    for terminal, marker in ((b, b1), (a, a2), (b, b3), (a, a4), (b, b5)):
        ctx.submit(terminal, prompt(marker))
    entries = ctx.wait_entries(6)
    order = [a0, b1, a2, b3, a4, b5]
    check([e["promptText"] for e in sorted(entries, key=lambda e: e["sequence"])] == [prompt(m) for m in order], "sequence does not follow the order of submission")
    archive = ctx.env.archive()
    events = archive["entries"] + archive["boundaries"]
    sequences = [e["sequence"] for e in events]
    check(len(set(sequences)) == len(sequences), "two events share a sequence")
    check(len({e["eventId"] for e in events}) == len(events), "two events share an event ID")
    run_a, run_b = entry(entries, a0)["runId"], entry(entries, b1)["runId"]
    check(run_a != run_b, "the two terminals share a Run")
    by_id = {e["eventId"]: e for e in entries}
    for marker, parent in ((a2, a0), (a4, a2), (b3, b1), (b5, b3)):
        check(entry(entries, marker)["parentEventId"] == entry(entries, parent)["eventId"], "a Run's prompt does not follow its own previous prompt")
    check(
        all(by_id[e["parentEventId"]]["runId"] == e["runId"] for e in entries if e["parentEventId"] in by_id),
        "a Run's Active Branch passes through the other Run",
    )
    # Disabling one Run leaves the other collecting on its own branch.
    ctx.command(b, "/prompt-history disable", "已停用采集")
    ctx.submit(b, prompt(b6))
    ctx.submit(a, prompt(a7))
    entries = ctx.wait_entries(7)
    check(not any(e["promptText"] == prompt(b6) for e in entries), "the disabled Run archived a prompt")
    check(entry(entries, a7)["parentEventId"] == entry(entries, a4)["eventId"], "the other Run's branch changed")
    check("Run collection mode: enabled" in ctx.status(a), "disabling one Run disabled the other")
    return (
        "two Runs submitting in turn: sequence unique and in submission order, event IDs unique, each prompt under its "
        "own Run's previous one; one Run disabled archived nothing more while the other went on along its branch"
    )


@scenario("PT-STORE-003")
def store_003(ctx: Context) -> str:
    first, second, held = (ctx.marker("PT-STORE-003") for _ in range(3))
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.submit(terminal, prompt(second))
    ctx.wait_entries(2)
    with write_lock(archive_file(ctx)):
        ctx.send(terminal, prompt(held))
        sent = time.monotonic()
        waiting = 0
        while not shown_dialog(terminal, DAMAGE_DIALOG):
            check(time.monotonic() - sent < 30, "the busy archive never offered its choices")
            waiting = max(waiting, helpers_of(terminal))
            time.sleep(0.05)
        waited = time.monotonic() - sent
        asked = dialog(ctx, terminal, DAMAGE_DIALOG)
        check("类别：archive-busy" in asked, "the dialog does not name the busy archive")
        check(waited <= 12, f"the busy wait took {waited:.1f} s")
        check(waiting > 0, "no helper was seen waiting on the lock")
        # The choice is the person's: nothing waits on the lock meanwhile.
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            check(not helpers_of(terminal), "a helper ran while the dialog waited on the person")
            time.sleep(0.05)
    ctx.choose(terminal, "重试")
    terminal.wait_idle()
    ctx.env.snap(terminal, "retried")
    entries = ctx.wait_entries(3)
    check(len([e for e in entries if e["promptText"] == prompt(held)]) == 1, "the retried prompt was not archived once")
    check(ctx.transcript_rows(held) == ctx.transcript_rows(second), "the retried prompt entered the session more than once")
    return (
        f"a held write lock ended in archive-busy after {waited:.1f} s, a helper seen waiting meanwhile; for 15 s with "
        "the dialog up no helper ran; released, a retry archived and submitted the prompt once"
    )


@scenario("PT-STORE-006")
def store_006(ctx: Context) -> str:
    first, second, held, other, cleared = (ctx.marker("PT-STORE-006") for _ in range(5))
    size = {"lines": 60}
    terminal = ctx.env.launch(**size)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.submit(terminal, prompt(second))
    ctx.wait_entries(2)
    database = archive_file(ctx)

    def kept() -> dict[str, bytes]:
        # SQLite's shared memory is rebuilt by any reader.
        return {
            path.name: path.read_bytes() for path in database.parent.glob(f"{database.name}*")
            if not path.name.endswith("-shm")
        }

    # A recheck, while the damage stands and once it is undone.
    ctx.exit(terminal)
    offset, page = break_entries_root(ctx)
    terminal = ctx.relaunch(**size)
    asked = meet_damage(ctx, terminal, held)
    offered = options_of(terminal, DAMAGE_DIALOG)
    check(offered == ["重新检查完整性", "隔离并开始新档案", "清除全部档案", "禁用当前 Run 后继续"], f"the damage offers {offered}")
    check("范围：本项目所有 Run" in asked, "the damage does not stop the whole generation")
    damaged = kept()
    # Another Run of the project is held too.
    beside = ctx.relaunch(**size)
    ctx.send(beside, prompt(other))
    check("类别：archive-integrity" in dialog(ctx, beside, DAMAGE_DIALOG), "another Run wrote into the damaged generation")
    dismiss(ctx, beside)
    ctx.exit(beside)
    choose_once(terminal, "重新检查完整性")
    again = terminal.wait_for(
        lambda t: (text := shown_dialog(t, DAMAGE_DIALOG)) and "完整性检查未通过" in text and text,
        "the recheck to report the damage", 30,
    )
    ctx.env.snap(terminal, "recheck failed")
    check(kept() == damaged, "the recheck changed the damaged archive")
    with database.open("r+b") as file:
        file.seek(offset)
        file.write(page)
    # Either the damage stopped the first try at its pre-write, as the helper
    # now checks health there, or that try entered and left a pending and the
    # second was held.
    owed = any(held in (p["promptText"] or "") for p in ctx.pending())
    before = ctx.transcript_rows(held)
    human_before = ctx.human_rows(held)
    choose_once(terminal, "重新检查完整性")
    if owed:
        terminal.wait_for("已完成对账", "the recheck to settle the pending", 30)
        ctx.env.snap(terminal, "recheck passed")
        entries = ctx.wait_entries(3)
        check([e["promptText"] for e in entries].count(prompt(held)) == 1, "the prompt held by the damage was not archived once")
        check(ctx.transcript_rows(held) == before, "the held prompt was sent on the person's behalf")
        check(held[: evidence.MARKER_PREFIX] in terminal.rows()[_prompt_box(terminal)], "the held prompt did not come back as a draft")
        empty_prompt_box(terminal)
    else:
        terminal.wait_idle()
        ctx.env.snap(terminal, "recheck passed")
        entries = ctx.wait_entries(3)
        check([e["promptText"] for e in entries].count(prompt(held)) == 1, "the prompt held by the damage was not archived once")
        let_through_once(ctx, held, human_before)
    settled = (
        "settled the pending the first try left and gave the held prompt back as a draft" if owed
        else "let the prompt the damage held at its pre-write through once and archived it once"
    )
    # A quarantine keeps the damaged generation as it was and starts the next.
    _, generation = ctx.identity(terminal)
    ctx.exit(terminal)
    break_entries_root(ctx)
    terminal = ctx.relaunch(**size)
    quarantined_marker = ctx.marker("PT-STORE-006")
    meet_damage(ctx, terminal, quarantined_marker)
    damaged = kept()
    before = ctx.human_rows(quarantined_marker)
    ctx.choose(terminal, "隔离并开始新档案")
    terminal.wait_idle()
    ctx.env.snap(terminal, "quarantined")
    copies = [path.parent for path in quarantine_root(ctx).rglob(database.name)]
    check(len(copies) == 1, "the quarantine does not hold the damaged archive once")
    check({name: (copies[0] / name).read_bytes() for name in damaged if (copies[0] / name).exists()} == damaged, "the quarantine changed the damaged archive")
    check([e["promptText"] for e in ctx.wait_entries(1)] == [prompt(quarantined_marker)], "the new generation does not hold only the held prompt")
    let_through_once(ctx, quarantined_marker, before)
    _, next_generation = ctx.identity(terminal)
    check(next_generation != generation, "the quarantine kept the generation")
    # A clear takes the strong confirmation, then lets the prompt through once.
    ctx.exit(terminal)
    break_entries_root(ctx)
    terminal = ctx.relaunch(**size)
    meet_damage(ctx, terminal, cleared)
    before = ctx.human_rows(cleared)
    ctx.choose(terminal, "清除全部档案")
    dialog(ctx, terminal, "清除档案")
    answer_freely(ctx, terminal, "delete all")
    dialog(ctx, terminal, DAMAGE_DIALOG)
    check(database.exists() and any(quarantine_root(ctx).iterdir()), "a mistyped phrase removed files")
    ctx.choose(terminal, "清除全部档案")
    dialog(ctx, terminal, "清除档案")
    answer_freely(ctx, terminal, CLEAR_PHRASE)
    terminal.wait_idle()
    ctx.env.snap(terminal, "cleared")
    check(not quarantine_root(ctx).exists(), "the clear left the quarantined archive")
    check([e["promptText"] for e in ctx.wait_entries(1)] == [prompt(cleared)], "the timeline after the clear does not hold only the held prompt")
    let_through_once(ctx, cleared, before)
    return (
        "damage offered its four choices for every Run of the project and held another Run before it wrote anything; "
        "a recheck with the damage standing asked again and changed nothing, and once the page was put back it passed and "
        f"{settled}; a quarantine kept the damaged archive byte for byte and started a new generation with the "
        "prompt; a mistyped phrase removed nothing, and the phrase cleared everything and let the prompt through once"
    )


def type_freely(terminal: Terminal, text: str) -> None:
    """Types `text` into the dialog's free-input item, not yet confirmed."""
    def type_it() -> None:
        terminal.type(text)
        time.sleep(0.5)

    select_option(
        terminal, "Type something.", type_it,
        absent="the dialog has no free-input item", unreached="could not reach the free-input item",
    )


@scenario("PT-STORE-008")
def store_008(ctx: Context) -> str:
    a0, b0, held, a1, b1 = (ctx.marker("PT-STORE-008") for _ in range(5))
    a = ctx.env.launch(plugins=[FIXTURE], lines=60)
    ctx.start(a)
    ctx.submit(a, prompt(a0), consent=True)
    b = ctx.env.launch(plugins=[FIXTURE], lines=60)
    ctx.start(b)
    ctx.submit(b, prompt(b0))
    before = ctx.wait_entries(2)
    _, generation = ctx.identity(a)
    # A third Run has the phrase typed when a capture of the first is in flight.
    c = ctx.env.launch(lines=60)
    ctx.start(c)
    ctx.send(c, "/prompt-history clear-all")
    dialog(ctx, c, "清除档案")
    type_freely(c, CLEAR_PHRASE)
    text = f"{prompt(held)} PT-FIXTURE-HOLD"
    ctx.send(a, text)
    a.wait_for(lambda _: any(p["promptText"] == text for p in ctx.pending()), "the held prompt to be staged", 15)
    staged = [p["eventId"] for p in ctx.pending() if p["promptText"] == text]
    c.key("enter", pause=1)
    replied(ctx, c, "/prompt-history clear-all", "已清除本项目的 Prompt Trail 档案")
    # The host draws a prompt while its hooks run; its transcript takes it after.
    check(ctx.transcript_rows(held) == 0, "the cut came after the held prompt landed")
    cut = time.monotonic()
    a.wait_idle(timeout=180)
    ctx.env.snap(a, "held prompt landed after the cut")
    check(time.monotonic() - cut < 60, "the held prompt did not land")
    ctx.submit(a, prompt(a1))
    ctx.submit(b, prompt(b1))
    entries = ctx.wait_entries(2)
    texts = [e["promptText"] for e in entries]
    old = {e["eventId"] for e in before} | set(staged)
    check(not any(prompt(m) in texts for m in (a0, b0)), "records from before the cut came back")
    check(not any(e["eventId"] in old for e in entries), "an event of the cleared generation came back")
    check(texts.count(text) <= 1, "the prompt in flight was archived more than once")
    check(prompt(a1) in texts and prompt(b1) in texts, "the Runs' prompts after the cut were not archived")
    archive = ctx.env.archive()
    sequences = sorted(e["sequence"] for e in archive["entries"] + archive["boundaries"])
    check(sequences == list(range(1, len(sequences) + 1)), f"the new generation's sequence is {sequences}")
    generations = {ctx.identity(terminal)[1] for terminal in (a, b, c)}
    check(len(generations) == 1 and generation not in generations, "the Runs do not all write the new generation")
    landed = "archived once in the new generation under a new event" if text in texts else "left out of the new generation"
    return (
        f"a clear-all cut while a capture was in flight: nothing from before the cut came back, the capture in flight was "
        f"{landed}, both Runs' next prompts went into the new generation, whose sequence starts at 1"
    )


def project_archive(ctx: Context, name: str) -> pathlib.Path:
    """The archive a project root has, named after the hash of its real path."""
    root = ctx.env.config / "plugins" / "data" / "prompt-trail-inline" / "archives"
    return root / f"{hashlib.sha256(str(ctx.env.projects[name]).encode()).hexdigest()}.sqlite3"


def prompts_in(database: pathlib.Path) -> list[str]:
    import semantic_verifier  # tests/, put on the path by pty_driver
    return [e["promptText"] for e in semantic_verifier.describe(database)["entries"]]


@scenario("PT-STORE-009")
def store_009(ctx: Context) -> str:
    alpha1, beta1, beta2, alpha2, tree1, gamma1, moved1 = (ctx.marker("PT-STORE-009") for _ in range(7))
    wide = {"columns": 250, "lines": 60}
    git = ["/usr/bin/git", "-c", "user.name=PT", "-c", "user.email=pt@example.invalid"]
    alpha = ctx.env.project("alpha")
    subprocess.run(git + ["-C", str(alpha), "init", "-q"], check=True)
    subprocess.run(git + ["-C", str(alpha), "commit", "-q", "--allow-empty", "-m", "init"], check=True)
    ctx.env.project("beta")
    for name, marker in (("alpha", alpha1), ("beta", beta1)):
        terminal = ctx.env.launch(project=name, **wide)
        ctx.start(terminal)
        ctx.submit(terminal, prompt(marker), consent=True)
        terminal.wait_for(lambda _: project_archive(ctx, name).exists(), f"{name}'s archive", 30)
        ctx.exit(terminal)
    check(prompts_in(project_archive(ctx, "alpha")) == [prompt(alpha1)], "alpha's archive holds another project's prompt")
    check(prompts_in(project_archive(ctx, "beta")) == [prompt(beta1)], "beta's archive holds another project's prompt")
    # One project's damage is its own.
    break_entries_root(ctx, project_archive(ctx, "beta"))
    beta = ctx.env.launch(project="beta", **wide)
    ctx.start(beta)
    meet_damage(ctx, beta, beta2)
    dismiss(ctx, beta)
    alpha_terminal = ctx.env.launch(project="alpha", **wide)
    ctx.start(alpha_terminal)
    ctx.submit(alpha_terminal, prompt(alpha2))
    alpha_terminal.wait_for(lambda _: len(prompts_in(project_archive(ctx, "alpha"))) == 2, "alpha to archive", 30)
    fields = status_fields(ctx, alpha_terminal)
    check(fields["archive"].startswith(f"ready · {project_archive(ctx, 'alpha')}"), "alpha's archive is not ready beside beta's damage")
    ctx.exit(alpha_terminal)
    ctx.exit(beta)
    # A worktree of alpha is a project of its own.
    tree = ctx.env.base / "alpha-tree"
    subprocess.run(git + ["-C", str(alpha), "worktree", "add", "-q", str(tree)], check=True)
    ctx.env.projects["alpha-tree"] = tree
    ctx.env._write_config()
    terminal = ctx.env.launch(project="alpha-tree", **wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(tree1), consent=True)
    terminal.wait_for(lambda _: project_archive(ctx, "alpha-tree").exists(), "the worktree's archive", 30)
    check(prompts_in(project_archive(ctx, "alpha-tree")) == [prompt(tree1)], "the worktree shares an archive")
    ctx.exit(terminal)
    # A project moved to another path starts over, and its old archive stays.
    ctx.env.project("gamma")
    terminal = ctx.env.launch(project="gamma", **wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(gamma1), consent=True)
    terminal.wait_for(lambda _: project_archive(ctx, "gamma").exists(), "gamma's archive", 30)
    ctx.exit(terminal)
    kept = project_archive(ctx, "gamma")
    left = {path.name: path.read_bytes() for path in kept.parent.glob(f"{kept.name}*") if not path.name.endswith("-shm")}
    moved = ctx.env.base / "gamma-moved"
    ctx.env.projects["gamma"].rename(moved)
    ctx.env.projects["gamma-moved"] = moved
    ctx.env._write_config()
    terminal = ctx.env.launch(project="gamma-moved", **wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(moved1), consent=True)
    terminal.wait_for(lambda _: project_archive(ctx, "gamma-moved").exists(), "the moved project's archive", 30)
    check(prompts_in(project_archive(ctx, "gamma-moved")) == [prompt(moved1)], "the moved project took up its old archive")
    check(
        {path.name: path.read_bytes() for path in kept.parent.glob(f"{kept.name}*") if not path.name.endswith("-shm")} == left,
        "the moved project changed its old archive",
    )
    return (
        "two project roots kept two archives; beta's damage held beta alone while alpha went on with a ready archive; "
        "a worktree of alpha and a project moved to another path were each asked for consent again and got an archive "
        "of their own, the old one left as it was"
    )


def cancel_held(ctx: Context, terminal: Terminal, marker: str) -> None:
    """Closes the dialog holding a submission and checks its draft came back
    whole, then empties the prompt box."""
    draft_back(terminal)
    ctx.env.snap(terminal, "draft back")
    box = terminal.rows()[_prompt_box(terminal)]
    check(prompt(marker)[: evidence.MARKER_PREFIX] in box and box.rstrip().endswith("请只回复 ok"), "the draft did not come back whole")
    empty_prompt_box(terminal)


@scenario("PT-FAIL-001")
def fail_001(ctx: Context) -> str:
    first, second, dropped, after = (ctx.marker("PT-FAIL-001") for _ in range(4))
    terminal = ctx.env.launch(lines=60)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.submit(terminal, prompt(second))
    ctx.wait_entries(2)
    database = archive_file(ctx)
    held = [database, database.with_name(f"{database.name}-wal")]
    subprocess.run(["/usr/bin/chflags", "uchg", *map(str, held)], check=True)
    try:
        ctx.send(terminal, prompt(dropped))
        asked = dialog(ctx, terminal, DAMAGE_DIALOG)
        check("类别：archive-read-only" in asked, "the dialog does not name the archive as read-only")
        check("范围：本项目所有 Run" in asked, "a read-only archive is not every Run's failure")
        cancel_held(ctx, terminal, dropped)
        check(not ctx.pending(), "the failed pre-write staged a pending")
        check(ctx.transcript_rows(dropped) == 0, "the dropped prompt entered the session")
        check(len(ctx.entries()) == 2, "the failed pre-write archived something")
    finally:
        subprocess.run(["/usr/bin/chflags", "nouchg", *map(str, held)], check=True)
    # The failure is on record until a try proves the archive writable.
    ctx.send(terminal, prompt(after))
    dialog(ctx, terminal, DAMAGE_DIALOG)
    ctx.choose(terminal, "重试")
    terminal.wait_idle()
    check(entry(ctx.wait_entries(3), after)["promptText"] == prompt(after), "the archive did not take the next prompt")
    return (
        "with the archive made immutable the pre-write failed as archive-read-only for every Run of the project; "
        "cancelled, the submission was dropped with its draft back whole, nothing staged, archived or sent; made "
        "writable again, a retry archived the next prompt"
    )


@scenario("PT-FAIL-002")
def fail_002(ctx: Context) -> str:
    first, held, beside, after = (ctx.marker("PT-FAIL-002") for _ in range(4))
    wide = {"columns": 250, "lines": 60}
    terminal = ctx.env.launch(plugins=[FIXTURE], **wide)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.wait_entries(1)
    text = refused_confirmation(ctx, terminal, held)
    (pending,) = [p["eventId"] for p in ctx.pending() if p["promptText"] == text]
    fields = status_fields(ctx, terminal)
    check(fields["pending reconciliation"] == f"{pending[:8]} · 待对账", f"status says {fields['pending reconciliation']}")
    check(fields["Run collection mode"].startswith("disabled · 未决 Pending Capture 待对账"), "status does not say the Run is held")
    # Another Run of the project is not held by this Run's pending.
    other = ctx.env.launch(**wide)
    ctx.start(other)
    ctx.submit(other, prompt(beside))
    check("对账" not in other.text(), "another Run was held by this Run's pending")
    check(len([e for e in ctx.wait_entries(2) if e["promptText"] == prompt(beside)]) == 1, "another Run's prompt was not archived")
    ctx.exit(other)
    # This Run settles the pending before its next submission, and hands that back.
    ctx.send(terminal, prompt(after))
    terminal.wait_for("已完成对账", "the reconciliation notice", 60)
    ctx.env.snap(terminal, "reconciled")
    check(not ctx.scanner.find("\n".join(r for r in terminal.rows() if "对账" in r).encode()), "the notice shows prompt text")
    check(after[: evidence.MARKER_PREFIX] in terminal.rows()[_prompt_box(terminal)], "the next prompt did not come back as a draft")
    entries = ctx.wait_entries(3)
    check([e["promptText"] for e in entries].count(text) == 1, "the pending was not archived once")
    check(not ctx.pending(), "the pending was left")
    terminal.key("enter")
    terminal.wait_idle()
    check(len([e for e in ctx.wait_entries(4) if e["promptText"] == prompt(after)]) == 1, "the next prompt was not archived once")
    return (
        "a refused confirmation kept the pending; status named it by its event ID and the Run as held, with no prompt "
        "text; another Run of the project went on collecting; this Run's next submission settled the pending first, "
        "archived it once and gave the new prompt back as a draft, which then went through"
    )


@scenario("PT-FAIL-003")
def fail_003(ctx: Context) -> str:
    a0, b0, retried, disabled, later, b1 = (ctx.marker("PT-FAIL-003") for _ in range(6))
    a = ctx.env.launch(lines=60)
    ctx.start(a)
    ctx.submit(a, prompt(a0), consent=True)
    b = ctx.env.launch(lines=60)
    ctx.start(b)
    ctx.submit(b, prompt(b0))
    ctx.wait_entries(2)
    run_a, _ = ctx.identity(a)
    database = archive_file(ctx)

    # Retry: asked again while the archive stays busy, submitted once when it is not.
    with write_lock(database):
        ctx.send(a, prompt(retried))
        dialog(ctx, a, DAMAGE_DIALOG)
        offered = options_of(a, DAMAGE_DIALOG)
        check(offered == ["重试", "禁用当前 Run 后继续"], f"the dialog offers {offered}")
        choose_once(a, "重试")
        a.wait_for(lambda t: not shown_dialog(t, DAMAGE_DIALOG), "the retry to start", 10)
        dialog(ctx, a, DAMAGE_DIALOG)
        check(ctx.transcript_rows(retried) == 0, "a retry that failed sent the prompt")
    choose_once(a, "重试")
    a.wait_idle()
    check(len([e for e in ctx.wait_entries(3) if e["promptText"] == prompt(retried)]) == 1, "the retry did not archive the prompt once")
    # Disable: the prompt goes through unarchived, behind one stop boundary.
    with write_lock(database):
        ctx.send(a, prompt(disabled))
        dialog(ctx, a, DAMAGE_DIALOG)
        choose_once(a, "禁用当前 Run 后继续")
        a.wait_for(lambda t: in_transcript(t, disabled), "the prompt to go through", 60)
        a.wait_idle()
    ctx.submit(a, prompt(later))
    ctx.command(a, "/prompt-history enable", "已恢复采集")
    time.sleep(2)
    texts = [e["promptText"] for e in ctx.entries()]
    check(prompt(disabled) not in texts and prompt(later) not in texts, "a prompt of the disabled Run was archived")
    stops = [s for s in boundaries(ctx, "collection-stopped") if s["runId"] == run_a]
    check(len(stops) == 1, f"{len(stops)} stop boundaries for the disabled Run")
    # The other Run went on as it was.
    ctx.submit(b, prompt(b1))
    entries = ctx.wait_entries(4)
    check(entry(entries, b1)["parentEventId"] == entry(entries, b0)["eventId"], "the other Run's branch changed")
    return (
        "the busy archive offered only a retry and disabling the Run; a retry while busy asked again and sent nothing, "
        "once free it archived the prompt once; disabling let the prompt through unarchived behind one stop boundary, "
        "nothing from the disabled time was archived after enable, and the other Run went on along its branch"
    )


def leave_gap(ctx: Context, scenario_id: str, **size) -> tuple[Terminal, str, list[str]]:
    """A host killed while its submission waits on a busy archive, after it
    marked the submission in flight and before anything was staged: the
    prompt may or may not have reached the conversation. The session resumed,
    the Run's next submission records the gap. Answers the resumed terminal,
    the Run and the markers it submitted."""
    first, lost, after = (ctx.marker(scenario_id) for _ in range(3))
    terminal = ctx.env.launch(**size)
    ctx.start(terminal)
    ctx.submit(terminal, prompt(first), consent=True)
    ctx.wait_entries(1)
    run, _ = ctx.identity(terminal)
    session = ctx.session(first)
    with write_lock(archive_file(ctx)):
        ctx.send(terminal, prompt(lost))
        terminal.wait_for(lambda t: helpers_of(t) > 0, "the submission to wait on the archive", 15)
        time.sleep(1)
        ctx.env.snap(terminal, "waiting when killed")
        terminal.kill()
    check(not ctx.pending(), "the killed submission staged a pending")
    terminal = ctx.relaunch("--resume", session, **size)
    ctx.submit(terminal, prompt(after))
    ctx.wait_entries(2)
    return terminal, run, [first, lost, after]


@scenario("PT-FAIL-004")
def fail_004(ctx: Context) -> str:
    wide = {"columns": 250, "lines": 60}
    terminal, run, (first, lost, after) = leave_gap(ctx, "PT-FAIL-004", **wide)
    check(ctx.identity(terminal)[0] == run, "the resume did not take the Run up again")
    archive = ctx.env.archive()
    events = sorted(archive["entries"] + archive["boundaries"], key=lambda e: e["sequence"])
    gaps = [e for e in events if e.get("kind") == "integrity-gap" and e["runId"] == run]
    recoveries = [e for e in events if e.get("kind") == "integrity-recovery" and e["runId"] == run]
    check(len(gaps) == 1 and len(recoveries) == 1, f"{len(gaps)} gaps and {len(recoveries)} recoveries")
    check(gaps[0]["sequence"] < recoveries[0]["sequence"] < entry(archive["entries"], after)["sequence"], "the gap and its recovery do not stand before the next prompt")
    check(prompt(lost) not in [e["promptText"] for e in archive["entries"]], "the prompt the host lost was archived")
    # A lifecycle write the host does not wait for: a /clear while the archive is busy.
    ctx.env.snap(terminal, "before /clear")
    with write_lock(archive_file(ctx)):
        ctx.send(terminal, "/clear")
        time.sleep(15)
        ctx.env.snap(terminal, "cleared while busy")
    check(not [b for b in boundaries(ctx, "clear") if b["runId"] == run], "the clear boundary was written while the archive was busy")
    cleared = ctx.marker("PT-FAIL-004")
    ctx.submit(terminal, prompt(cleared))
    ctx.wait_entries(3)
    clears = [b for b in boundaries(ctx, "clear") if b["runId"] == run]
    check(len(clears) == 1, f"{len(clears)} clear boundaries")
    check(clears[0]["sequence"] < entry(ctx.entries(), cleared)["sequence"], "the clear boundary does not stand before the next prompt")
    check(len([b for b in boundaries(ctx, "integrity-gap") if b["runId"] == run]) == 1, "the recovered clear left a gap")
    return (
        "a host killed while its submission waited on a busy archive left no pending; resumed, the Run wrote one "
        "Integrity gap and its recovery ahead of its next prompt and archived nothing of the lost one; a /clear "
        "while the archive was busy was recorded from the host's store at the next submission, ahead of it, with no gap"
    )


@scenario("PT-FAIL-005")
def fail_005(ctx: Context) -> str:
    wide = {"columns": 250, "lines": 60}
    terminal, run, (first, lost, after) = leave_gap(ctx, "PT-FAIL-005", **wide)
    band = ctx.expand(terminal, after)
    check(any(row.lstrip().startswith("—— Integrity gap") for row in band), "the band does not show the gap")
    check(any(row.lstrip().startswith("—— 已恢复可验证采集") for row in band), "the band does not show the recovery")
    check(status_fields(ctx, terminal)["integrity gaps"].startswith("1 · "), "status does not count the gap")
    session = ctx.session(first)
    ctx.exit(terminal)
    # It stays, across a restart and a clear of another Run.
    other = ctx.relaunch(**wide)
    check(status_fields(ctx, other)["integrity gaps"].startswith("1 · "), "the gap is gone after a restart")
    ctx.submit(other, prompt(ctx.marker("PT-FAIL-005")))
    ctx.send(other, "/prompt-history clear-run")
    dialog(ctx, other, "清除当前 Run")
    ctx.choose(other, "清除当前 Run")
    replied(ctx, other, "/prompt-history clear-run", "已清除当前 Run")
    check(status_fields(ctx, other)["integrity gaps"].startswith("1 · "), "a clear of another Run removed the gap")
    ctx.exit(other)
    # A clear of the Run that holds it removes it.
    terminal = ctx.relaunch("--resume", session, **wide)
    check(ctx.identity(terminal)[0] == run, "the resume did not take the Run up again")
    ctx.send(terminal, "/prompt-history clear-run")
    dialog(ctx, terminal, "清除当前 Run")
    ctx.choose(terminal, "清除当前 Run")
    replied(ctx, terminal, "/prompt-history clear-run", "已清除当前 Run")
    check(status_fields(ctx, terminal)["integrity gaps"] == "0", "the clear of its Run left the gap")
    check(not boundaries(ctx, "integrity-gap"), "the archive still holds the gap")
    return (
        "the gap and its recovery stood on the band and status counted one; it stayed after a restart and a clear of "
        "another Run, and went with a clear of the Run that held it"
    )


def _prompt_box(terminal: Terminal) -> int:
    """The row of the prompt box: the last one that begins with ❯."""
    rows = terminal.rows()
    return max(i for i, row in enumerate(rows) if row.startswith("❯"))
