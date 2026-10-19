#!/usr/bin/env python3
"""The independent verifier: what the chat-toc Pane should list, and how it differs.

It walks the transcript file's conversation chain by itself (MVP spec §3: from the
newest leaf along `parentUuid`, along `logicalParentUuid` across a compact
boundary) and applies the Turn group rules (MVP spec §4) by itself. It shares no
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
    day: str | None = None  # 「M月D日」, 「今天 · M月D日」 or with the year, for the day's rule

    @property
    def clock(self) -> str:
        """The local 「HH:MM」 the Pane shows beside the group, '' without a time."""
        return self.time.split(" ")[-1] if self.time else ""

    @property
    def agent_head(self) -> str:
        """The agent side's state and steps, before its reply, without the in-progress state."""
        steps = f"{self.steps} 步" if self.steps else ""
        if self.status == "interrupted":
            return "已中断" + (f" · {steps}" if steps else "")
        if self.status == "error":
            return "出错" + (f" · {steps}" if steps else "")
        if not self.last_text:
            return f"{steps} · 无文字回复" if steps else "无文字回复"
        return steps

    def public(self) -> dict:
        return {"key": self.key, "kind": self.kind, "day": self.day, "time": self.clock, "userText": self.user_text,
                "agentHead": self.agent_head if self.has_agent else None,
                "lastText": self.last_text, "steps": self.steps, "status": self.status}


@dataclasses.dataclass
class Compaction:
    uuid: str
    trigger: str            # manual | auto
    clock: str              # the boundary row's local 「HH:MM」, '' without a time
    before: int             # the group its rule goes before; len(groups) when after the last

    def public(self) -> dict:
        return {"uuid": self.uuid, "trigger": self.trigger, "time": self.clock, "before": self.before}


@dataclasses.dataclass
class Toc:
    exists: bool
    groups: list[Group]
    unreadable: int
    chain: list[str]
    compactions: list[Compaction] = dataclasses.field(default_factory=list)
    earlier_elsewhere: bool = False     # the fork line: the chain's first boundary precedes its first group


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
    """Spec §4 User input text: no code blocks, images, Markdown marks or pasted_content tags; one space between words.
    As ticket 19 reads it, `[Image #n]` placeholders are images too, and a prompt
    that is only code blocks shows the code. (Which single * or _ count as marks
    does not matter here: the diff ignores them.)"""
    def tidy(value: str) -> str:
        value = re.sub(r"!\[[^\]]*\]\([^)]*\)|\[Image #\d+\]", " ", value)
        value = re.sub(r"</?pasted_content[^>]*>", " ", value)
        value = re.sub(r"[#*_`>]+", "", value)
        return re.sub(r"\s+", " ", value).strip()

    cleaned = tidy(re.sub(r"```[\s\S]*?```", " ", text))
    if cleaned:
        return cleaned
    return tidy(" ".join(re.findall(r"```[^\n]*\n?([\s\S]*?)```", text)))


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


def format_day(stamp, tz, now: datetime.datetime) -> str | None:
    """The day's rule for a timestamp: 「M月D日」, today 「今天 · M月D日」, another year's with the year."""
    if not isinstance(stamp, str):
        return None
    try:
        moment = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    local, today = moment.astimezone(tz), now.astimezone(tz)
    text = f"{local.month}月{local.day}日"
    if local.year != today.year:
        return f"{local.year}年{text}"
    return f"今天 · {text}" if local.date() == today.date() else text


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
                          time=format_time(row.get("timestamp"), tz, now), day=format_day(row.get("timestamp"), tz, now),
                          steps=0, last_text=None,
                          status="done", has_agent=False)   # an assistant row or an interruption gives it one
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
        # 出错 (error) means the group's last assistant row is an API error; its text
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


def _is_boundary(row: dict) -> bool:
    return row.get("type") == "system" and row.get("subtype") == "compact_boundary"


def _is_compact_command(group: "Group | None") -> bool:
    return group is not None and group.kind == "command" and re.match(r"^/compact(\s|$)", group.user_text) is not None


def compactions(chain: list[dict], groups: list[Group], tz=None) -> list[Compaction]:
    """Each boundary on the chain and where its rule goes (spec 0.2 §5): a
    manual one after the `/compact` entry; an auto one before its group when
    no agent row of that group came before it (at a submit), else after it
    (mid-turn, between turns). A group is never cut."""
    tz = tz or datetime.datetime.now().astimezone().tzinfo
    where = {row["uuid"]: i for i, row in enumerate(chain)}
    starts = [where[g.key] for g in groups]
    out = []
    for i, row in enumerate(chain):
        if not _is_boundary(row):
            continue
        inside = sum(1 for at in starts if at < i) - 1            # the group the boundary falls in; -1 before any
        trigger = "auto" if (row.get("compactMetadata") or {}).get("trigger") == "auto" else "manual"
        if trigger == "manual":
            own = groups[inside] if inside >= 0 else None
            following = groups[inside + 1] if inside + 1 < len(groups) else None
            before = inside + 2 if not _is_compact_command(own) and _is_compact_command(following) else inside + 1
        else:
            first = starts[inside] if inside >= 0 else 0
            answered = inside >= 0 and any(chain[j].get("type") == "assistant" for j in range(first, i))
            before = inside + 1 if answered else max(inside, 0)
        stamp = row.get("timestamp")
        clock = ""
        if isinstance(stamp, str):
            try:
                local = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(tz)
                clock = f"{local.hour:02d}:{local.minute:02d}"
            except ValueError:
                clock = ""
        out.append(Compaction(uuid=row["uuid"], trigger=trigger, clock=clock, before=before))
    return out


def expected_toc(path: pathlib.Path, tz=None, now: datetime.datetime | None = None) -> Toc:
    path = pathlib.Path(path)
    if not path.exists():
        return Toc(exists=False, groups=[], unreadable=0, chain=[])
    rows, unreadable = read_rows(path)
    chain = conversation_chain(rows)
    groups = turn_groups(chain, tz, now)
    first_group = next((i for i, row in enumerate(chain) if groups and row["uuid"] == groups[0].key), len(chain))
    first_boundary = next((i for i, row in enumerate(chain) if _is_boundary(row)), None)
    return Toc(exists=True, groups=groups, unreadable=unreadable, chain=[row["uuid"] for row in chain],
               compactions=compactions(chain, groups, tz),
               earlier_elsewhere=first_boundary is not None and first_boundary < first_group)


def rule_label(trigger: str, count: int, clock: str) -> str:
    words = "自动压缩" if trigger == "auto" else "已压缩"
    if count > 1:
        return f"{words} ×{count}" + (f" · {clock}" if clock else "")
    return f"{words} {clock}".strip()


def expected_rules(toc: Toc, chosen: str = "all", among: list[int] | None = None) -> list[dict]:
    """The compaction rules the list draws under a View filter: each before
    the first listed group at or after its place, else after the last listed
    one; several in one place as one rule with a count and the last one's
    time. `before` is the listed group's index among those listed. `among`,
    a query's matches (group indices), narrows the groups listed."""
    kept = listed(toc.groups, chosen)
    shown = [i for i, g in enumerate(toc.groups) if any(g is k for k in kept) and (among is None or i in among)]
    if not shown:
        return []
    folded: dict[int, list[Compaction]] = {}
    for c in toc.compactions:
        at = next((n for n, g in enumerate(shown) if g >= c.before), len(shown))
        folded.setdefault(at, []).append(c)
    return [{"before": at, "text": rule_label(cs[-1].trigger, len(cs), cs[-1].clock)} for at, cs in sorted(folded.items())]


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


_FILTERS = (("1: 全部", "all"), ("2: 用户", "user"), ("3: Agent", "agent"))


_EMPTY = "本会话还没有对话"

# The rail the entries hang on: a User input's first line on a node, an
# Agent reply's on a branch, the lines after beside the rail; lit, heavy.
_NODES, _BRANCHES, _RAILS = "●◉○", ("├╴", "┣╸", "├┄"), "│┃"
# A side with no Jump target hangs on a hollow mark.
_OFF = ("○", "├┄")
_LIT = "◉┣┃"
_TIME_COLUMN = re.compile(r"^(\d\d:\d\d| {5}) (?=[●◉○├┣│┃])")
_DAY_RULE = re.compile(r"^─ (.+?) ─+$")
_COMPACTION_RULE = re.compile(r"^╌ (.+?) ╌*$")
_FORK_LINE = "更早的轮次不在本会话的文件里"
_FOOTER_RULE = re.compile(r"^─{10,}$")
# The preview's rule over the footer while it is open (0.2, ticket 22):
# `─ 预览 ─── p: ✕`, its ✕ closing it (the trailing ✕ may have been read
# off as 2.1.287's close mark).
_PREVIEW_RULE = re.compile(r"^─ 预览 ─+ p:( ✕)?$")
# The search row under the tab rule (0.2): `f: 搜索`, the field (the query
# or the dim placeholder; `⏎ 跳转` after it while it holds the keys), then
# with a query the count `4 / 38` and the clear mark `✕`, then `‹ ›` (ticket 18).
_SEARCH_ROW = re.compile(r"^f: (?:搜索|Find)(?: (?P<rest>.*))?$")
_SEARCH_COUNT = re.compile(r"\s*(\d+ (?:/|of) \d+)$")
_SEARCH_SUBMIT = re.compile(r"\s*⏎ (?:跳转|jump)\s*")
SEARCH_PLACEHOLDERS = ("词或文件路径", "words or a file path")
# The selected entry's row of Buttons on the terminal while the preview is
# closed (0.2, ticket 24): `p: 预览 · r: 填入 · c: 复制` beside the rail,
# `r` and `c` drawn only when they can act, `c` reading `已复制` a moment.
_ACTION_ROW = re.compile(r"^p: (?:预览|Preview)(?: · r: (?:填入|Reuse))?(?: · c: (?:复制|已复制|Copy|Copied))?$")
_ASIDE = re.compile(r"^(.*?)\s+(\d\d:\d\d)$")
_AGENT_HEAD = re.compile(r"^(?:(?:进行中|已中断|出错)(?: · \d+ 步)?|\d+ 步(?: · 无文字回复)?|无文字回复)")


def _is_filter_row(text: str | None) -> bool:
    return bool(text) and all(label in text for label, _ in _FILTERS)


def _is_entry_line(text: str | None) -> bool:
    if not text:
        return False
    rest = text[6:] if _TIME_COLUMN.match(text) else text
    return rest[:1] in _NODES or rest[:2] in _BRANCHES


def find_pane(rows: list[str]) -> tuple[int, int] | None:
    """(first content cell column, row just above the entries) of the chat-toc
    Pane: the docked column whose border `│` runs down the screen and whose
    content holds the View filter row, an entry or the empty-state line. The
    row above the entries is the filter row when there is one, else the row
    above the Pane's first row. None when no such Pane is drawn."""
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
        if any(_is_entry_line(t) or (t and _EMPTY in t) for t in texts):
            first = next(y for y, t in enumerate(texts) if t is not None)
            return border + 1, first - 1
    return None


@dataclasses.dataclass
class PaneEntry:
    row: int                   # the entry's first line
    user_row: int | None = None
    agent_row: int | None = None
    time: str | None = None    # 「HH:MM」 beside it, '' when none shows
    day: str | None = None     # the day's rule above it
    user_lines: list[str] = dataclasses.field(default_factory=list)
    agent_head: str | None = None   # its state and steps, '' when none; None: no agent side
    agent_lines: list[str] = dataclasses.field(default_factory=list)
    running: bool = False
    user_off: bool = False     # the user side hangs on a hollow mark: no Jump target
    agent_off: bool = False
    highlighted: bool = False
    clipped: bool = False      # may continue below the window
    selected: str | None = None     # 'user' or 'agent': the side whose row of Buttons shows under it
    actions: list[str] = dataclasses.field(default_factory=list)   # that row's Buttons, `p: 预览` first
    action_row: int | None = None

    @property
    def has_user(self) -> bool:
        return self.user_row is not None

    @property
    def user_text(self) -> str:
        return " ".join(self.user_lines)

    def public(self) -> dict:
        return {"row": self.row, "day": self.day, "time": self.time, "userLines": self.user_lines,
                "agentHead": self.agent_head, "agentLines": self.agent_lines, "running": self.running,
                "userOff": self.user_off, "agentOff": self.agent_off,
                "highlighted": self.highlighted, **({"selected": self.selected} if self.selected else {})}


@dataclasses.dataclass
class Pane:
    left: int
    filter_row: int
    filter: str
    entries: list[PaneEntry]
    notes: list[str]
    partial_top: bool
    layout: str | None = None   # 卡片 / 紧凑 / 时间轴, as the footer says it
    footer: str | None = None   # the footer's left: 「N 轮」 or 「⏸ 暂停跟随」
    preview: list[str] | None = None   # the preview's rows, its rule first; None when not drawn
    rules: list[dict] = dataclasses.field(default_factory=list)   # compaction rules: text, before (entry index)
    fork_line: bool = False     # 「更早的轮次不在本会话的文件里」 above the list
    search: dict | None = None  # the search row: text (the query, '' for the placeholder), count, clear, focused


def _chosen_filter(rows: list[str], filter_row: int, left: int) -> str:
    """The filter the tab rule under the filter row marks heavy."""
    head = _right_of(rows[filter_row], left) if filter_row >= 0 else None
    rule = _right_of(rows[filter_row + 1], left) if 0 <= filter_row + 1 < len(rows) else None
    if not head or not rule or "━" not in rule:
        return "all"
    start = next(x for x, c in _cells(rule) if c == "━")
    for label, name in _FILTERS:
        at = head.find(label)
        if at >= 0 and sum(cell_width(c) for c in head[:at]) == start:
            return name
    return "all"


def _split_agent(text: str) -> tuple[str, str]:
    """An Agent reply's first line: its state and steps, then the start of its reply."""
    head = (m.group(0) if (m := _AGENT_HEAD.match(text)) else "")
    rest = text[len(head):]
    if rest.startswith(" · "):
        rest = rest[3:]
    elif rest.strip() == "·":
        rest = ""
    elif head and rest and not rest.startswith(" "):
        head, rest = "", text           # a reply that merely starts like a state
    return head, rest.strip()


def parse_pane(rows: list[str]) -> Pane | None:
    """The entries a Pane window shows, top to bottom, in any Layout. An entry
    cut off at the top is dropped (partial_top); the last one may be cut off
    below (clipped). Lines that are not part of an entry are kept as notes."""
    found = find_pane(rows)
    if found is None:
        return None
    left, filter_row = found
    chosen = _chosen_filter(rows, filter_row, left)
    entries: list[PaneEntry] = []
    notes: list[str] = []
    rules: list[dict] = []
    fork_line = False
    partial_top = False
    layout = footer = None
    current: PaneEntry | None = None
    side = None
    day = None
    preview: list[str] | None = None
    search: dict | None = None
    for y in range(filter_row + 1, len(rows)):
        text = _right_of(rows[y], left)
        if text is None:
            # the border is off its column: a character whose width the
            # terminal and the host disagree on; the row cannot be read
            if "│" not in rows[y]:
                break
            notes.append("<row off the border column: " + rows[y].rsplit("│", 1)[-1].strip() + ">")
            current, side = None, None
            continue
        if search is None and not entries and (found_search := parse_search_row(text)) is not None:
            search = found_search
            continue
        # 2.1.287 draws the Pane's ✕ at the right end of its first content row
        text = re.sub(r"\s+✕$", "", text)
        stripped = text.strip()
        if not stripped or (set(stripped) <= set("━─") and "━" in stripped):
            if preview is not None:
                preview.append("")
            current, side = None, None
            continue
        if preview is not None and not _FOOTER_RULE.match(stripped):
            preview.append(text.rstrip())
            continue
        if _PREVIEW_RULE.match(stripped):
            preview, current, side = [stripped], None, None
            continue
        if _FOOTER_RULE.match(stripped):
            current, side = None, None
            below = _right_of(rows[y + 1], left) if y + 1 < len(rows) else None
            if below and (m := re.search(r"l: 布局 (\S+)$", below.strip())):
                layout = m.group(1)
                footer = below.strip()[: m.start()].strip() or None
            break
        if m := _DAY_RULE.match(stripped):
            day, current, side = m.group(1), None, None
            continue
        if m := _COMPACTION_RULE.match(stripped):
            rules.append({"text": m.group(1), "before": len(entries)})
            current, side = None, None
            continue
        if stripped == _FORK_LINE:
            fork_line = True
            continue
        time = None
        rest = text
        if m := _TIME_COLUMN.match(text):
            time, rest = m.group(1).strip(), text[6:]
        lit = rest[:1] in _LIT
        if rest[:1] in _NODES:
            body = rest[3:].rstrip()
            if time is None:                         # the card: the time at the right
                aside = _ASIDE.match(body)
                body, time = (aside.group(1), aside.group(2)) if aside else (body, "")
            current = PaneEntry(row=y, user_row=y, time=time, day=day, user_lines=[body.strip()], highlighted=lit,
                                user_off=rest[:1] == "○")
            entries.append(current)
            side, day = "user", None
        elif rest[:2] in _BRANCHES:
            body = rest[3:].rstrip()
            running = body.startswith("◐ ")
            if running:
                body = body[2:]
            head, start = _split_agent(body.strip())
            if current is not None and side == "user" and current.agent_head is None:
                current.agent_row, current.agent_head, current.running = y, head, running
                current.agent_off = rest[:2] == "├┄"
                current.highlighted = current.highlighted or lit
                if time:
                    current.time = current.time or time
            elif chosen == "agent" or entries:
                current = PaneEntry(row=y, agent_row=y, time=time or "", day=day, agent_head=head, running=running,
                                    highlighted=lit, agent_off=rest[:2] == "├┄")
                entries.append(current)
                day = None
            else:
                partial_top, current, side = True, None, None
                continue
            if start:
                current.agent_lines.append(start)
            side = "agent"
        elif rest[:1] in _RAILS and rest[1:3] == "  " and _ACTION_ROW.match(rest[3:].strip()):
            if current is not None and side is not None:
                current.selected, current.action_row = side, y
                current.actions = rest[3:].strip().split(" · ")
        elif rest[:1] in _RAILS and rest[1:3] == "  " and rest[3:].strip():
            body = rest[3:].strip()
            if current is None:
                if entries:
                    notes.append(stripped)
                else:
                    partial_top = True
            elif side == "user" and len(current.user_lines) < 2:
                current.user_lines.append(body)
            elif side == "agent" and len(current.agent_lines) < 2 + (0 if current.agent_lines else 1):
                current.agent_lines.append(body)
            else:
                notes.append(stripped)
        elif rest.strip() in _RAILS:
            current, side = None, None             # the gap between two groups of a day
        else:
            current, side = None, None
            notes.append(stripped)
    if entries:
        # the window may end inside it, blank filler below or not
        entries[-1].clipped = True
    return Pane(left=left, filter_row=filter_row, filter=chosen, entries=entries, notes=notes, partial_top=partial_top,
                layout=layout, footer=footer, rules=rules, fork_line=fork_line, preview=preview, search=search)


def parse_search_row(text: str) -> dict | None:
    """The search row's parts, or None when the row is not it."""
    m = _SEARCH_ROW.match(text.strip())
    if m is None:
        return None
    rest = (m.group("rest") or "").rstrip()
    step = rest.endswith("‹ ›")
    if step:
        rest = rest[:-3].rstrip()
    clear = rest.endswith("✕")
    if clear:
        rest = rest[:-1].rstrip()
    count = None
    if c := _SEARCH_COUNT.search(rest):
        count, rest = c.group(1), rest[: c.start()]
    focused = _SEARCH_SUBMIT.search(rest) is not None
    rest = _SEARCH_SUBMIT.sub(" ", rest).strip()
    return {"text": "" if rest in SEARCH_PLACEHOLDERS else rest, "count": count, "clear": clear, "focused": focused, "step": step}


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
    if entry.day is not None and entry.day != group.day:
        problems.append(f"day: expected {group.day!r}, got {entry.day!r}")
    if entry.time and entry.time != group.clock:
        problems.append(f"time: expected {group.clock!r}, got {entry.time!r}")
    if chosen != "agent":
        if not entry.has_user:
            problems.append("userText: expected a user side, got none")
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
        if entry.agent_head != group.agent_head and not (entry.agent_lines and entry.agent_lines[-1].endswith("…")
                                                          and group.agent_head.startswith(entry.agent_head)):
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


def compare_rules(toc: Toc, pane: "Pane | None", chosen: str | None = None, among: list[int] | None = None) -> dict:
    """The compaction rules a window shows against those expected for the
    listed groups it holds: each in place, with its words. `among`, a
    query's matches (group indices), narrows the groups listed."""
    if pane is None:
        return {"ok": False, "expected": [], "actual": [], "error": "no chat-toc Pane on screen"}
    chosen = chosen or pane.filter
    groups = toc.groups if among is None else [g for i, g in enumerate(toc.groups) if i in among]
    window = compare_window(groups, pane, chosen)
    start, count = window["start"] or 0, len(pane.entries)
    last = len(listed(groups, chosen))
    expected = [{"before": r["before"] - start, "text": r["text"]} for r in expected_rules(toc, chosen, among)
                if start <= r["before"] < start + count or (r["before"] == last and start + count == last)]
    return {"ok": window["ok"] and expected == pane.rules, "expected": expected, "actual": pane.rules,
            "windowStart": start}


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
