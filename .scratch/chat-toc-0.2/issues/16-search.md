# 16: Search on the terminal

**What to build:** A search row always drawn under the tab rule (`f: Find`, the field, the count, `✕`) that narrows the list to the Turn groups holding every word typed, in the User input as typed, the last text or the touched file paths, on the sides the View filter shows. Enter jumps to the nearest match and ends the search; the query is kept in `$.state`. The preview shows the selected match and says which fields matched.

Spec: [chat-toc 0.2](../spec.md) §1 (the search row, hotkeys), §2, §3 (which group while a query is set; the `matched:` part; a matching path first).

**Blocked by:** 13 (The preview region on the terminal), 14 (Compaction rules and context use on the terminal)

**Status:** ready-for-agent

- [ ] The index: per group and per field, NFKC + lower-cased, built at regroup, rebuilt only for the groups an incremental read changed; an incremental build agrees with a whole build (unit test)
- [ ] The matcher: spaces split words, AND across the group's fields, case-insensitive after NFKC, plain substrings (CJK), paths as substrings of the absolute form; All / User / Agent pick the fields (unit tests)
- [ ] The row: `f: Find` / `f: 搜索` calling `$.ui.focus` on the field; placeholder `words or a file path` / `词或文件路径`; `submitLabel` `jump` / `跳转`; the count `4 of 38` / `4 / 38`; `✕` only while there is a query; no `autoFocus`; fits 36 columns in both languages (record what gives way if it does not)
- [ ] The list narrows to matches; no match shows `No turns match` / `没有匹配的轮次`; new matching turns join; a running group is matched as it grows; compaction rules stay between the shown groups
- [ ] The list keeps the match nearest the Current position in view; `◉` only when that group matches; the Minimap lights the matches and not the Current position, all dim with no match
- [ ] Keys: Enter in the field jumps to the nearest match and ends the search (only clears with no match); ↓/Tab reach the matches; Enter on an entry jumps and keeps it; Esc keeps the query; Ctrl+U, Backspace and `✕` clear
- [ ] The query in a `$.state` atom controlling `value`: survives filter and Layout switches, new turns, a back tab, a close and reopen; never in `$.store`
- [ ] The preview shows the selected match, or the match nearest the Current position; its meta line ends with `matched: User · Agent · files` / `匹配：用户 · Agent · 文件`; a matching path goes first on the files line
- [ ] `CT-FIND-001` and `CT-FIND-002` added to the PTY drivers and the release gate's MUST list, passing on both versions; `CT-SEC-001` puts the marker in a query
- [ ] Root README: the controls table (the field, `f`, Enter, Esc, `✕`), "What it shows" (search)
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
