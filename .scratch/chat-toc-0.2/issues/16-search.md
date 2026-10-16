# 16: Search on the terminal

**What to build:** A search row always drawn under the tab rule (`f: Find`, the field, the count, `✕`) that narrows the list to the Turn groups holding every word typed, in the User input as typed, the last text or the touched file paths, on the sides the View filter shows. Enter jumps to the nearest match and ends the search; the query is kept in `$.state`. The preview shows the selected match and says which fields matched.

Spec: [chat-toc 0.2](../spec.md) §1 (the search row, hotkeys), §2, §3 (which group while a query is set; the `matched:` part; a matching path first).

**Blocked by:** 13 (The preview region on the terminal), 14 (Compaction rules and context use on the terminal)

**Status:** resolved

- [x] The index: per group and per field, NFKC + lower-cased, built at regroup, rebuilt only for the groups an incremental read changed; an incremental build agrees with a whole build (unit test)
- [x] The matcher: spaces split words, AND across the group's fields, case-insensitive after NFKC, plain substrings (CJK), paths as substrings of the absolute form; All / User / Agent pick the fields (unit tests)
- [x] The row: `f: Find` / `f: 搜索` calling `$.ui.focus` on the field; placeholder `words or a file path` / `词或文件路径`; `submitLabel` `jump` / `跳转`; the count `4 of 38` / `4 / 38`; `✕` only while there is a query; no `autoFocus`; fits 36 columns in both languages (record what gives way if it does not)
- [x] The list narrows to matches; no match shows `No turns match` / `没有匹配的轮次`; new matching turns join; a running group is matched as it grows; compaction rules stay between the shown groups
- [x] The list keeps the match nearest the Current position in view; `◉` only when that group matches; the Minimap lights the matches and not the Current position, all dim with no match
- [x] Keys: Enter in the field jumps to the nearest match and ends the search (only clears with no match); ↓/Tab reach the matches; Enter on an entry jumps and keeps it; Esc keeps the query; Ctrl+U, Backspace and `✕` clear
- [x] The query in a `$.state` atom controlling `value`: survives filter and Layout switches, new turns, a back tab, a close and reopen; never in `$.store`
- [x] The preview shows the selected match, or the match nearest the Current position; its meta line ends with `matched: User · Agent · files` / `匹配：用户 · Agent · 文件`; a matching path goes first on the files line
- [x] `CT-FIND-001` and `CT-FIND-002` added to the PTY drivers and the release gate's MUST list, passing on both versions; `CT-SEC-001` puts the marker in a query
- [x] Root README: the controls table (the field, `f`, Enter, Esc, `✕`), "What it shows" (search)
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

- Built on branch `chat-toc-0.2/16-search`. The index and matcher are `hooks/search.ts`; the list narrowed to the matches is `narrowedTable` in `hooks/table.ts` (original group indices kept, so jumps, the highlight and `layRules` read as before).
- 36 columns: nothing gives way. `f: 搜索 登录 … 1 / 8 ✕` and `f: Find login … 2 of 8 ✕` hold on one row at 36, 44 and 56 columns (`ct_search.py widths`). A long query is cut with `…` in the field, focused or not.
- The meta line keeps `matched: …` and drops the fields before it first when the row is too narrow. A matching file that was only read is named on the files line (`read needle.ts +1`), since `read 5` alone would hide the match.
- Enter's jump: the host refuses `$.ui.scroll` from an `onSubmit` that does not hand its promise back (`denied, not person-initiated`); the handler returns it and scrolls before clearing the query. Recorded in `docs/agents/mod-host-gotchas.md`.
- PTY on 2.1.287 and 2.1.295: CT-FIND-001 (narrow, filter, live, widths) and CT-FIND-002 (keys, entry, keep, minimap) pass; CT-SEC-001 with the marker in a query passes; CT-CMPCT-001's fixture part now includes the query 合成 (rules between the matches, two folded to ×2) and passes.
- The keystroke cost on the 20 MiB fixtures (spec §10) is ticket 20's.
