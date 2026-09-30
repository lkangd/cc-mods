"""PTY scenarios: each drives a real Claude Code in its own isolated world and
returns what it saw, in words that carry no prompt text. A failed check raises
ScenarioFailure; the trace keeps a masked screen at each step."""
import pathlib
import re
import sqlite3
import time

import evidence
from pty_driver import Environment, ScenarioFailure, Terminal
import timeline_fixture  # tests/, put on the path by pty_driver

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
        pattern = re.compile(rf"^\s*(❯)?\s*\d+\. {re.escape(option)}$")
        time.sleep(1)
        for _ in range(10):
            found = [m for m in map(pattern.match, terminal.rows()) if m]
            if not found:
                return
            if found[-1].group(1):
                terminal.key("enter", pause=1)
            else:
                terminal.key("down", pause=0.5)
        raise ScenarioFailure(f"could not choose {option}")

    def command(self, terminal: Terminal, text: str, expect: str, timeout: float = 30) -> str:
        """Runs a slash command and returns what the screen shows after its
        echo, once that holds `expect`; earlier answers still on screen do not count."""
        terminal.type(text)
        time.sleep(0.3)
        terminal.key("enter")

        def answered(t: Terminal) -> str | None:
            rows = t.rows()
            echoes = [i for i, row in enumerate(rows) if row.strip() == f"❯ {text}"]
            if not echoes:
                return None
            after = "\n".join(rows[echoes[-1] + 1:])
            return after if expect in after else None

        after = terminal.wait_for(answered, f"{text} to answer", timeout)
        self.env.snap(terminal, text)
        return after

    def expand(self, terminal: Terminal, marker: str) -> list[str]:
        """Opens the band and waits until it shows the entry `marker` names."""
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
    lock = sqlite3.connect(database, timeout=0, isolation_level=None)
    lock.execute("BEGIN IMMEDIATE")
    try:
        terminal.wait_idle(timeout=180)
        time.sleep(12)
        ctx.env.snap(terminal, "confirmation refused")
        check("hook skipped" not in terminal.text(), "the fixture's hook failed, so nothing was held")
        check(any(held in (p["promptText"] or "") for p in ctx.pending()), "the pending did not survive the failed confirmation")
    finally:
        lock.execute("ROLLBACK")
        lock.close()
    status = ctx.status(terminal)
    check("Pending Capture 待对账" in status, "status does not report the reconciliation")
    # The next submission settles the pending first: the transcript proves the
    # held prompt entered, so it is confirmed, and the new prompt comes back as
    # a draft to send again.
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
        "confirmed it from the transcript and handed its own text back as a draft, which then went through"
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


def check_bound(band: list[str], markers, what: str) -> None:
    """Each entry the markers name is shown once, with a Jump Target."""
    for marker in markers:
        rows = shown(band, marker)
        check(len(rows) == 1 and jumpable(rows[0], marker), f"{what} did not bind the shared history once")


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
    check_bound(ctx.expand(continued, b), (a, b), "--continue")
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
    band = ctx.expand(resumed, f)
    # The session's rows, drawn by this process before it left them, are
    # replayed and bound again, and the prompt after them too (Issue 43).
    check_bound(band, (a, b, c, d, f), "the in-process /resume")
    fold = check_fold(band, 1, d, f, hidden=(e,))
    ctx.click_row(resumed, band[fold], "另一分支")
    resumed.wait_for(lambda t: shown(ctx.band(t), e), "the fold to open", 15)
    ctx.env.snap(resumed, "fold opened")

    # A second terminal resuming the session while the first holds its Run
    # branches off in a Run of its own.
    concurrent = ctx.relaunch("--resume", session, lines=60)
    other, _ = ctx.identity(concurrent)
    check(other != run, "a concurrent resume took up the held Run")
    check_bound(ctx.expand(concurrent, f), (a, b, c, d, f), "the concurrent resume")
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
    band = ctx.expand(cli, b)
    check_bound(band, (a, b), "--fork-session")
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
    return (
        "a background /fork archived its argument once in a new Run and branch after the shared history; "
        "--fork-session bound the shared history, marked the other fork ×, and started a Run of its own "
        "that says which Run it branched off"
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
        terminal.type("zz")
        terminal.wait_for(lambda t: t.rows()[_prompt_box(t)][1:].strip() == "zz", "typing to reach the prompt box", 5)
        terminal.key("backspace", "backspace")
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
UP = "↑ 点此向上浏览"


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


def typed(ctx: Context, terminal: Terminal) -> None:
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
    click_title(ctx, terminal, "Prompt Trail")
    terminal.wait_for(lambda t: collapsed(ctx, t), "the title click to fold the band", 15)
    ctx.env.snap(terminal, "folded by a click")
    # The command opens it too, and does not take the keyboard for it. It
    # does not fold it yet (Issue 44), so the title folds it above.
    band = ctx.expand(terminal, marker)
    check(FOCUS_HINT in band[0], "the band opened by the command does not say how to take its keyboard")
    check(not focused(ctx, terminal), "opening the band took the keyboard")
    typed(ctx, terminal)
    # ctrl+x tab gives the band the keyboard, on the latest entry; Esc gives
    # it back to the prompt box and leaves the band open.
    terminal.key("ctrl-x", "tab", pause=0.5)
    check(focused(ctx, terminal) == shown(ctx.band(terminal), marker), "ctrl+x tab did not land on the entry")
    ctx.env.snap(terminal, "band holds the keyboard")
    terminal.key("esc", pause=0.5)
    typed(ctx, terminal)
    check(ctx.band(terminal)[0].startswith("▾"), "Esc folded the band")
    ctx.env.snap(terminal, "keyboard given back")
    return (
        "starts as one collapsed title row; a title click opens it with the ctrl+x tab hint and folds it again; "
        "/prompt-history opens it without taking the keyboard; ctrl+x tab lands on the entry; Esc gives typing back and the band stays open"
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
    return bool(rows) and ringed(rows) == [(rows[0][0], rows[0][1])] and UP not in rows[0][1] \
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
                    archived = iter([kinds[s] for s in range(last + 1, sequence) if s in kinds])
                    check(all(kind in archived for kind in between), "boundary rows do not match the archive between two entries")
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
    """Takes the view up a page with the title's click, gives the keyboard
    back to the prompt box, and answers the first row the view shows."""
    click_title(ctx, terminal, UP)
    terminal.wait_for(lambda t: UP in title(ctx, t) and "底部" not in title(ctx, t), "the view to leave the bottom", 10)
    terminal.key("esc", pause=0.5)
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
    # Resting at its bottom the band's tree fits, so the host sends it no
    # scrolling at all; the title says so and offers a click instead.
    check(title(ctx, terminal).endswith(f"{UP} · 底部不响应触控板  {FOCUS_HINT}"), "the title does not offer the way up from the bottom")
    clicks = 0
    while UP in title(ctx, terminal):
        check(clicks < 200, "200 clicks did not reach the first event")
        first = ctx.band(terminal)[1]
        click_title(ctx, terminal, UP)
        terminal.wait_for(lambda t: ctx.band(t)[1] != first, "a click to take the view up", 5)
        clicks += 1
    band = ctx.band(terminal)
    check(band[1] == "—— Run 开始 ——", "the clicks did not reach the first event")
    ctx.env.snap(terminal, "first event by clicks")
    # Folding and opening again comes back to the latest events.
    click_title(ctx, terminal, "Prompt Trail")
    terminal.wait_for(lambda t: collapsed(ctx, t), "the title to fold the band", 10)
    click_title(ctx, terminal, "Prompt Trail")
    terminal.wait_for(lambda t: ctx.band(t)[1:] == latest[1:], "the band to open on the latest events", 10)
    ctx.env.snap(terminal, "latest by clicks")
    # The arrows leave the bottom too, though no scrolling reaches the band there.
    terminal.key("esc", pause=0.5)
    terminal.key("ctrl-x", "tab", pause=0.5)
    park(terminal)
    walk(ctx, terminal, "up", lambda rows: "底部" not in rows[0][1])
    ctx.env.snap(terminal, "left the bottom by arrows")
    return (
        f"with no scrolling sent, {clicks} clicks on the title's way up reached the first event; folding and opening "
        "came back to the latest; the arrows left the bottom"
    )


def p95(samples: list[float]) -> float:
    ordered = sorted(samples)
    return ordered[-(-len(ordered) * 95 // 100) - 1]


def timed(terminal: Terminal, press, done, what: str, timeout: float = 10) -> float:
    """Seconds from `press()` until `done(terminal)`, read every 10 ms."""
    started = time.monotonic()
    press()
    while not done(terminal):
        if time.monotonic() - started > timeout:
            terminal.env.snap(terminal, f"timed out: {what}")
            raise ScenarioFailure(f"timed out waiting for {what}")
        time.sleep(0.01)
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
    return len(band) == 1 and title(ctx, terminal).startswith("▾ Prompt Trail · 空间不")


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


def _prompt_box(terminal: Terminal) -> int:
    """The row of the prompt box: the last one that begins with ❯."""
    rows = terminal.rows()
    return max(i for i, row in enumerate(rows) if row.startswith("❯"))
