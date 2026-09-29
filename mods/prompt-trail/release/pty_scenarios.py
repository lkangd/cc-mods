"""PTY scenarios: each drives a real Claude Code in its own isolated world and
returns what it saw, in words that carry no prompt text. A failed check raises
ScenarioFailure; the trace keeps a masked screen at each step."""
import pathlib
import re
import sqlite3
import time

import evidence
from pty_driver import Environment, ScenarioFailure, Terminal

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
        count = 0
        for path in (self.env.config / "projects").rglob("*.jsonl"):
            count += sum(1 for line in path.read_text().splitlines() if marker in line)
        return count


def prompt(marker: str) -> str:
    return f"{marker} 请只回复 ok"


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
    ctx.command(terminal, "/prompt-history", "已展开")
    shown = sum(1 for row in ctx.band(terminal) if marker[: evidence.MARKER_PREFIX] in row)
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
    text = f"{marker} 请只回复 ok\n\n中文宽字符 😀 é 第三行"
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
    ctx.command(terminal, "/prompt-history", "已展开")
    rows = [row for row in ctx.band(terminal) if marker[: evidence.MARKER_PREFIX] in row]
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
    entries = ctx.wait_entries(1)
    entry = entries[0]
    check(entry["attachmentCount"] >= 1, "no attachment counted")
    check("pixel" not in (entry["promptText"] or ""), "the attachment's name was archived")
    check(str(project) not in (entry["promptText"] or ""), "the attachment's path was archived")
    return f"attachments {entry['attachmentCount']} of kinds {entry['attachmentKinds']}; no name or path archived"


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


def _prompt_box(terminal: Terminal) -> int:
    """The row of the prompt box: the last one that begins with ❯."""
    rows = terminal.rows()
    return max(i for i, row in enumerate(rows) if row.startswith("❯"))
