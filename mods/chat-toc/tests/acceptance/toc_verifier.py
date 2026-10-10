#!/usr/bin/env python3
"""The independent verifier: what the chat-toc Pane should list, and how it differs.

It walks the transcript file's conversation chain by itself (spec §3: from the
newest leaf along `parentUuid`, along `logicalParentUuid` across a compact
boundary) and applies the Turn group rules (spec §4) by itself. It shares no
code with the plugin; when the two disagree, one of them is wrong, and the
diff says where.

    toc_verifier.py expected <transcript.jsonl>             # the expected entries, as JSON
    toc_verifier.py screen <transcript.jsonl> <screen.txt>  # parse a Pane window and diff it
"""
import argparse
import dataclasses
import datetime
import json
import pathlib
import re
import sys
import unicodedata

INTERRUPTED = "[Request interrupted by user"
_NOT_OPENING = re.compile(r"^\s*<(local-command-stdout|local-command-caveat|bash-stdout|bash-stderr|task-notification)\b")


@dataclasses.dataclass
class Group:
    key: str                # uuid of the row that opened the group
    kind: str               # prompt | command | bang
    user_text: str          # the user side, cleaned, untruncated
    time: str | None        # 「M月D日 HH:MM」 local, or None when the row has no timestamp
    steps: int
    last_text: str | None
    status: str             # done | interrupted | error
    has_agent: bool
    rows: list[str] = dataclasses.field(default_factory=list)

    @property
    def agent_head(self) -> str:
        """The agent side's header text after 「↳ 」, without the in-progress state."""
        steps = f"{self.steps} 步" if self.steps else ""
        if self.status == "interrupted":
            return "已中断" + (f" · {steps}" if steps else "")
        if self.status == "error":
            return "出错" + (f" · {steps}" if steps else "")
        if not self.last_text:
            return f"{steps} · 无文字回复" if steps else "无文字回复"
        return steps

    @property
    def user_head(self) -> str:
        return "你" + (f" · {self.time}" if self.time else "")

    def public(self) -> dict:
        return {"key": self.key, "kind": self.kind, "userHead": self.user_head, "userText": self.user_text,
                "agentHead": self.agent_head if self.has_agent else None,
                "lastText": self.last_text, "steps": self.steps, "status": self.status}


@dataclasses.dataclass
class Toc:
    exists: bool
    groups: list[Group]
    unreadable: int
    chain: list[str]


# ---------- reading the file ----------

def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _has_image(content) -> bool:
    return isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "image" for b in content)


def _has_tool_result(content) -> bool:
    return isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def read_rows(path: pathlib.Path) -> tuple[list[dict], int]:
    """Every JSON object row, in file order, and how many lines were not one."""
    rows, unreadable = [], 0
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except ValueError:
                unreadable += 1
                continue
            if not isinstance(row, dict):
                unreadable += 1
                continue
            rows.append(row)
    return rows, unreadable


def conversation_chain(rows: list[dict]) -> list[dict]:
    """The current branch, oldest first: back from the newest main-loop row."""
    by_id = {}
    leaf = None
    for row in rows:
        uuid = row.get("uuid")
        if not isinstance(uuid, str) or row.get("isSidechain"):
            continue
        by_id[uuid] = row
        leaf = uuid
    chain, seen, current = [], set(), leaf
    while current in by_id and current not in seen:
        seen.add(current)
        row = by_id[current]
        chain.append(row)
        parent = row.get("parentUuid")
        if parent is None and row.get("type") == "system" and row.get("subtype") == "compact_boundary":
            parent = row.get("logicalParentUuid")
        current = parent
    chain.reverse()
    return chain


# ---------- the Turn group rules ----------

def opener(row: dict) -> str | None:
    """prompt | command | bang when the row opens a Turn group, else None."""
    kind = row.get("type")
    if kind == "system":
        if row.get("subtype") == "local_command" and "<command-name>" in str(row.get("content") or ""):
            return "command"
        return None
    if kind != "user" or row.get("isMeta") or row.get("isCompactSummary"):
        return None
    content = (row.get("message") or {}).get("content")
    if _has_tool_result(content):
        return None
    text = _text_of(content)
    if _NOT_OPENING.match(text) or text.lstrip().startswith(INTERRUPTED):
        return None
    if "<command-name>" in text:
        return "command"
    if text.lstrip().startswith("<bash-input>"):
        return "bang"
    origin = row.get("origin")
    if isinstance(origin, dict) and origin.get("kind") == "human" and (text.strip() or _has_image(content)):
        return "prompt"
    return None


def _tag(text: str, name: str) -> str:
    found = re.search(rf"<{name}>([\s\S]*?)</{name}>", text)
    return found.group(1).strip() if found else ""


def clean_prompt(text: str) -> str:
    """Spec §4 用户侧文字: no code blocks, images, Markdown marks or pasted_content tags; one space between words."""
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"</?pasted_content[^>]*>", " ", text)
    text = re.sub(r"[#*_`>]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def user_text(kind: str, row: dict) -> str:
    if row.get("type") == "system":
        raw, content = str(row.get("content") or ""), None
    else:
        content = (row.get("message") or {}).get("content")
        raw = _text_of(content)
    if kind == "command":
        name = _tag(raw, "command-name")
        args = _tag(raw, "command-args")
        name = name if name.startswith("/") else "/" + name
        return f"{name} {args}" if args else name
    if kind == "bang":
        return "!" + _tag(raw, "bash-input")
    cleaned = clean_prompt(raw)
    if cleaned:
        return cleaned
    return "（只有图片）" if _has_image(content) else ""


def format_time(stamp, tz, now: datetime.datetime) -> str | None:
    if not isinstance(stamp, str):
        return None
    try:
        moment = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    local = moment.astimezone(tz)
    text = f"{local.month}月{local.day}日 {local.hour:02d}:{local.minute:02d}"
    return text if local.year == now.astimezone(tz).year else f"{local.year}年{text}"


def turn_groups(chain: list[dict], tz=None, now: datetime.datetime | None = None) -> list[Group]:
    now = now or datetime.datetime.now().astimezone()
    tz = tz or now.astimezone().tzinfo
    groups: list[Group] = []
    group: Group | None = None
    tail: list[tuple[str, str]] = []   # (message id, text) after the last tool_use

    def close() -> None:
        if group is not None and tail:
            last_id = tail[-1][0]
            group.last_text = " ".join(text for mid, text in tail if mid == last_id)

    for row in chain:
        kind = opener(row)
        if kind:
            close()
            tail = []
            group = Group(key=row["uuid"], kind=kind, user_text=user_text(kind, row),
                          time=format_time(row.get("timestamp"), tz, now), steps=0, last_text=None,
                          status="done", has_agent=kind == "prompt")
            groups.append(group)
        if group is None:
            continue
        group.rows.append(row["uuid"])
        if row.get("type") == "user" and _text_of((row.get("message") or {}).get("content")).lstrip().startswith(INTERRUPTED):
            group.status = "interrupted"
            group.has_agent = True
        if row.get("type") != "assistant":
            continue
        group.has_agent = True
        # 出错 means the group's last assistant row is an API error; its text
        # still counts as text after the last tool_use.
        if row.get("isApiErrorMessage"):
            if group.status != "interrupted":
                group.status = "error"
        elif group.status == "error":
            group.status = "done"
        message = row.get("message") or {}
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                group.steps += 1
                tail = []
            elif block.get("type") == "text" and str(block.get("text", "")).strip():
                tail.append((message.get("id") or row["uuid"], str(block["text"]).strip()))
    close()
    return groups


def expected_toc(path: pathlib.Path, tz=None, now: datetime.datetime | None = None) -> Toc:
    path = pathlib.Path(path)
    if not path.exists():
        return Toc(exists=False, groups=[], unreadable=0, chain=[])
    rows, unreadable = read_rows(path)
    chain = conversation_chain(rows)
    return Toc(exists=True, groups=turn_groups(chain, tz, now), unreadable=unreadable,
               chain=[row["uuid"] for row in chain])


# ---------- what the Pane lists (card layout, read from a screen) ----------

def cell_width(char: str) -> int:
    if unicodedata.combining(char):
        return 0
    return 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1


def _cells(row: str) -> list[tuple[int, str]]:
    """Each character of a screen row with the cell column it starts at."""
    out, column = [], 0
    for char in row:
        out.append((column, char))
        column += cell_width(char)
    return out


def _right_of(row: str, column: int) -> str | None:
    """The row's text from cell `column` on, when the cell before it is the Pane border."""
    cells = _cells(row)
    for index, (x, char) in enumerate(cells):
        if x == column - 1:
            return "".join(c for _, c in cells[index + 1:]).rstrip() if char == "│" else None
    return None


_FILTERS = {"●全部": "all", "●用户": "user", "●Agent": "agent"}


_EMPTY = "本会话还没有对话"


def _is_filter_row(text: str | None) -> bool:
    return bool(text) and any(mark in text for mark in _FILTERS) and "用户" in text and "Agent" in text


def _is_entry_head(text: str | None) -> bool:
    body = (text or "")[2:]
    return (text or "")[:2] in ("  ", "▌ ") and (body == "你" or body.startswith("你 · ") or body.startswith("↳"))


def find_pane(rows: list[str]) -> tuple[int, int] | None:
    """(first content cell column, row just above the entries) of the chat-toc
    Pane: the docked column whose border `│` runs down the screen and whose
    content holds the View filter row, an entry header or the empty-state
    line. The row above the entries is the filter row when there is one, else
    the row above the Pane's first row. None when no such Pane is drawn."""
    counts: dict[int, int] = {}
    for row in rows:
        for x, char in _cells(row):
            if char == "│":
                counts[x] = counts.get(x, 0) + 1
    for border in sorted(counts, key=lambda x: -counts[x]):
        if counts[border] < 5:
            break
        texts = [_right_of(row, border + 1) for row in rows]
        for y, text in enumerate(texts):
            if _is_filter_row(text):
                return border + 1, y
        if any(_is_entry_head(t) or (t and _EMPTY in t) for t in texts):
            first = next(y for y, t in enumerate(texts) if t is not None)
            return border + 1, first - 1
    return None


@dataclasses.dataclass
class PaneEntry:
    row: int
    user_head: str | None = None
    user_lines: list[str] = dataclasses.field(default_factory=list)
    agent_head: str | None = None
    agent_lines: list[str] = dataclasses.field(default_factory=list)
    highlighted: bool = False
    clipped: bool = False      # may continue below the window

    @property
    def user_text(self) -> str:
        return " ".join(self.user_lines)

    def public(self) -> dict:
        return {"row": self.row, "userHead": self.user_head, "userLines": self.user_lines,
                "agentHead": self.agent_head, "agentLines": self.agent_lines, "highlighted": self.highlighted}


@dataclasses.dataclass
class Pane:
    left: int
    filter_row: int
    filter: str
    entries: list[PaneEntry]
    notes: list[str]
    partial_top: bool


def parse_pane(rows: list[str]) -> Pane | None:
    """The entries a card-layout Pane window shows, top to bottom. An entry cut
    off at the top is dropped (partial_top); the last one may be cut off below
    (clipped). Lines that are not part of an entry are kept as notes."""
    found = find_pane(rows)
    if found is None:
        return None
    left, filter_row = found
    head = (_right_of(rows[filter_row], left) or "") if filter_row >= 0 else ""
    chosen = next((name for mark, name in _FILTERS.items() if mark in head), "all")
    entries: list[PaneEntry] = []
    notes: list[str] = []
    partial_top = False
    current: PaneEntry | None = None
    side = None
    skipping = False                      # inside an entry cut off at the top
    for y in range(filter_row + 1, len(rows)):
        text = _right_of(rows[y], left)
        if text is None:
            # the border is off its column: a character whose width the
            # terminal and the host disagree on; the row cannot be read
            if "│" not in rows[y]:
                break
            notes.append("<row off the border column: " + rows[y].rsplit("│", 1)[-1].strip() + ">")
            current, side, skipping = None, None, False
            continue
        if not text.strip():
            current, side, skipping = None, None, False
            continue
        if not (len(text) >= 2 and text[0] in "▌ " and text[1] == " "):
            current, side, skipping = None, None, False
            notes.append(text.strip())
            continue
        mark, body = text[0] == "▌", text[2:]
        if body == "你" or body.startswith("你 · "):
            current = PaneEntry(row=y, user_head=body.strip(), highlighted=mark)
            entries.append(current)
            side, skipping = "user", False
        elif body.startswith("↳"):
            agent_head = body[1:].strip()
            if current is not None and current.agent_head is None and side == "user":
                current.agent_head, side = agent_head, "agent"
            elif chosen == "agent":
                current = PaneEntry(row=y, agent_head=agent_head, highlighted=mark)
                entries.append(current)
                side = "agent"
            else:
                partial_top, skipping, current, side = True, True, None, None
        elif skipping or current is None:
            if entries:
                notes.append(text.strip())
            else:
                partial_top = True
        elif side == "user" and len(current.user_lines) < 2:
            current.user_lines.append(body.strip())
        elif side == "agent" and len(current.agent_lines) < 2 and body.startswith("  "):
            current.agent_lines.append(body[2:].strip())
        else:
            notes.append(text.strip())
            current, side = None, None
    if entries:
        # the window may end inside it, blank filler below or not
        entries[-1].clipped = True
    return Pane(left=left, filter_row=filter_row, filter=chosen, entries=entries, notes=notes, partial_top=partial_top)


# ---------- the diff ----------

def _norm(text: str) -> str:
    return re.sub(r"[\s#*_`>…]", "", text)


def _text_problem(field: str, expected: str | None, lines: list[str], clipped: bool) -> str | None:
    shown = "".join(lines)
    if expected is None:
        return f"{field}: expected none, got {shown!r}" if shown else None
    if not shown:
        return None if clipped else f"{field}: expected {expected!r}, got nothing"
    if shown.endswith("…") or clipped:
        if _norm(expected).startswith(_norm(shown)):
            return None
    elif _norm(expected) == _norm(shown):
        return None
    return f"{field}: expected {expected!r}, got {shown!r}"


_IN_PROGRESS = re.compile(r"^进行中( · \d+ 步)?$")


def entry_problems(group: Group, entry: PaneEntry, chosen: str = "all", in_progress: bool = False) -> list[str]:
    problems = []
    if chosen != "agent":
        if entry.user_head != group.user_head:
            problems.append(f"userHead: expected {group.user_head!r}, got {entry.user_head!r}")
        problem = _text_problem("userText", group.user_text, entry.user_lines, entry.clipped)
        if problem:
            problems.append(problem)
    if chosen == "user":
        if entry.agent_head is not None:
            problems.append(f"agentHead: the 用户 filter shows no agent side, got {entry.agent_head!r}")
        return problems
    running = in_progress and entry.agent_head is not None and _IN_PROGRESS.match(entry.agent_head)
    if entry.agent_head is None:
        if group.has_agent and not entry.clipped:
            problems.append(f"agentHead: expected {group.agent_head!r}, got no agent side")
    elif not group.has_agent and not running:
        problems.append(f"agentHead: expected no agent side, got {entry.agent_head!r}")
    elif not running:
        if entry.agent_head != group.agent_head:
            problems.append(f"agentHead: expected {group.agent_head!r}, got {entry.agent_head!r}")
        problem = _text_problem("agentText", group.last_text, entry.agent_lines, entry.clipped)
        if problem:
            problems.append(problem)
    return problems


def listed(groups: list[Group], chosen: str) -> list[Group]:
    """The groups a View filter lists: 「Agent」 hides groups with only a user side."""
    return [g for g in groups if g.has_agent] if chosen == "agent" else list(groups)


def compare_window(groups: list[Group], pane: Pane | None, chosen: str | None = None,
                   in_progress_last: bool = False) -> dict:
    """Aligns a Pane window with the expected entries and names every
    difference: the window must be a run of consecutive expected entries."""
    if pane is None:
        return {"ok": False, "start": None, "entries": [], "summary": {"error": "no chat-toc Pane on screen"}}
    chosen = chosen or pane.filter
    expected = listed(groups, chosen)
    shown = pane.entries
    best = None
    for start in range(0, max(1, len(expected) - len(shown) + 1)):
        rows = []
        for i, entry in enumerate(shown):
            index = start + i
            if index >= len(expected):
                rows.append({"index": index, "key": None, "expected": None, "actual": entry.public(),
                             "problems": ["extra entry: nothing left to expect"]})
                continue
            group = expected[index]
            last = in_progress_last and group is groups[-1]
            rows.append({"index": index, "key": group.key, "expected": group.public(), "actual": entry.public(),
                         "problems": entry_problems(group, entry, chosen, last)})
        count = sum(len(r["problems"]) for r in rows)
        if best is None or count < best[0]:
            best = (count, start, rows)
        if count == 0:
            break
    count, start, rows = best
    ok = count == 0 and (bool(shown) or not expected)
    return {"ok": ok, "start": start, "entries": rows,
            "summary": {"filter": chosen, "expectedTotal": len(expected), "windowEntries": len(shown),
                        "start": start, "problems": count, "partialTop": pane.partial_top, "notes": pane.notes}}


def compare_windows(groups: list[Group], panes: list[Pane], chosen: str | None = None) -> dict:
    """Windows read while scrolling the Pane from top to bottom: each must match,
    in order, and together they must list every expected entry."""
    covered: set[int] = set()
    windows, ok, last_start, total = [], True, -1, 0
    for pane in panes:
        diff = compare_window(groups, pane, chosen)
        total = diff["summary"].get("expectedTotal", total)
        windows.append(diff["summary"])
        if not diff["ok"] or diff["start"] < last_start:
            ok = False
        else:
            last_start = diff["start"]
            covered |= {r["index"] for r in diff["entries"]}
    missing = sorted(set(range(total)) - covered)
    return {"ok": ok and not missing, "covered": len(covered), "missing": missing, "windows": windows}


# ---------- command line ----------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("expected", help="the entries the Pane should list, as JSON")
    e.add_argument("transcript", type=pathlib.Path)
    s = sub.add_parser("screen", help="diff a Pane window read from a screen against the transcript")
    s.add_argument("transcript", type=pathlib.Path)
    s.add_argument("screen", type=pathlib.Path)
    s.add_argument("--filter", choices=["all", "user", "agent"])
    s.add_argument("--in-progress", action="store_true", help="the last group may show 进行中")
    a = parser.parse_args()
    toc = expected_toc(a.transcript)
    if a.cmd == "expected":
        print(json.dumps({"exists": toc.exists, "unreadable": toc.unreadable,
                          "groups": [g.public() for g in toc.groups]}, ensure_ascii=False, indent=1))
        return 0
    lines = a.screen.read_text(encoding="utf-8").rstrip("\n").split("\n")
    if lines and lines[0].startswith("==== "):          # a screen snapped by the harness
        lines = lines[1:]
    diff = compare_window(toc.groups, parse_pane(lines), a.filter, a.in_progress)
    print(json.dumps(diff, ensure_ascii=False, indent=1))
    return 0 if diff["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
