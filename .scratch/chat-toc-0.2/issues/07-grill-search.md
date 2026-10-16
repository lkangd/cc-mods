# Decide how search works

Type: grilling
Status: resolved
Blocked by: 04, 05, 06

## Question

How does a person find a Turn group by what was said or what was touched?

- Does a query filter the list down to the matching groups, or keep the list and step through matches?
- Which fields match: the whole User input, the Agent reply's whole last text, intermediate text, the file paths the turn touched; case, CJK, several words.
- How it combines with the View filter, and what the Minimap shows for matches, given a cell can only be dimmed or not and the Current position already uses that.
- How the person starts, edits and leaves a search by mouse and keyboard; what the empty result says; what survives a Layout switch, a filter switch, a new turn arriving.
- The words on screen in both languages, and the glossary term.

Settled by the layout ticket (06): the search row is always drawn under the tab rule, and `/` focuses it through a hotkey Button calling `$.ui.focus`. Still to check here: whether the host takes `/` as a `hotkey`, and how that Button draws on the row.

## Answer

Decided with the user on 2026-10-16. The term **Search** (and its result, a match) is in [`mods/chat-toc/CONTEXT.md`](../../../mods/chat-toc/CONTEXT.md).

**What it does.** A query narrows the list to the matching Turn groups; nothing is stepped through. The search row shows the count at its right, `4 of 38` / `4 / 38` (matches of all groups). With no match the list area holds one line, `No turns match` / `没有匹配的轮次`.

**What matches.**
- Fields: the User input as typed (a slash command as `/name args`, a `!cmd` as `!cmd`, code blocks and pasted content kept, not the folded line on screen); the Agent reply's last text, whole; the paths of the files the group touched: `Edit`/`Write`/`Read` `file_path` and Bash's `bashEditDiff.changedFiles` (ticket 05). `Glob`/`Grep` roots, intermediate text, thinking and tool output do not match: the Pane shows none of them, so a match there could not be seen.
- It follows the View filter: All searches every field, User only the User input, Agent only the last text and the file paths.
- Rules: the query splits on spaces and every word must be found (AND), in any of the group's fields; case-insensitive after NFKC; plain substrings, CJK included (no segmentation); a path matches as a substring of its absolute form. No regex, no fuzzy match, no quoted phrases.
- A new turn that matches joins the list; a running group is matched as it grows.

**Getting in.** `/` cannot be a hotkey: the host takes one digit or one lowercase letter and refuses anything else (`ButtonProps.hotkey`), so ticket 06's `/` is dropped. Instead a plain Button `f: Find` / `f: 搜索` on the search row calls `$.ui.focus` on the field (only while the Pane holds the keys); a click on the field works too. No `autoFocus` on the field: it would make every Ctrl+X Tab land in it and break 1/2/3/`l`. Placeholder `words or a file path` / `词或文件路径`.

**While a query is set (terminal).**
- The list keeps in view the match nearest the Current position (the nearest at or before it, else the first after it). The rail's `◉` shows only when the Current position's group is itself a match. Pausing and resuming the follow are as in the MVP.
- The preview shows that same nearest match. Whether it follows the ring as the person steps through matches is the preview ticket's.
- The Minimap still draws every group and its presses still jump; the lit cells are the matches (a bucket is lit when any of its groups matches), the Current position is not marked there; with no match all are dim.
- No word in an entry is marked: an entry line is a Button holding one string. A match hidden by the fold, or only in a file path, is shown by the preview (how it marks it is the preview ticket's).

**Keys and leaving (terminal).**
- Enter in the field jumps to the nearest match and ends the search (the list back to all, the jumped group lit), as a command palette does; this goes with the host emptying the field on Enter. With no match Enter does nothing but clear the query. `submitLabel` cannot be left out (it defaults to `submit`), so it reads `jump` / `跳转` (`⏎ jump`).
- ↓/Tab go on to the matches; Enter on an entry jumps and keeps the search.
- Esc gives the keys back to the composer and keeps the query.
- Clearing: Ctrl+U or Backspace to empty, Enter as above, or a `✕` Button at the row's right end, drawn only while there is a query, with no hotkey.

**Desktop.** A native field without the `f` Button (Desktop's filters carry no hotkeys either); a click gives it the keys. Each change filters, the IME's composition letters included (the commit corrects it). Enter (or the `show` / `预览` button, the `submitLabel`) does not empty the field and cannot jump; it puts the nearest match in the preview (the newest match, there being no Current position). The Svg strip draws matches in the accent colour and the rest dim.

**Kept.** The query lives in a `$.state` atom and controls the field's `value`: it survives a Layout or View filter switch, new turns, a back tab and closing and reopening the Pane, until the process ends. Never in `$.store` (it is conversation text).

**Left for later.** Whether the host's search row draws the `f` Button, the field, the count and `✕` in 36 columns, and the search cost over 4432 turns, are checked by the implementation and the performance budget.
