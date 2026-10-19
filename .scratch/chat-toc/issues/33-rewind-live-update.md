# 33: After a rewind the contents drop the thrown-away entries at once

**What to build:** After Esc Esc picks an earlier prompt and restores the conversation, the contents drop the entries of the discarded branch (including the one rewound to) within 500 ms, without waiting for the next submit.

**Blocked by:** none

**Status:** done

## Problem

The user reported: after a rewind the right-hand contents do not update, and only update after a while. This is a window accepted in the 0.1.0 contract (ticket `06`, "not promised" item 5: the host has no rewind event, and the file has not changed yet), and the user now asks to remove it.

## Decisions made (grilling, 2026-10-12)

- Trigger: on every `ui.render` of `PromptHint`, read `$.session.turns()` (cheap).
- Only when it is less than the number of prompts the contents know, call `$.session.messages()`, align by count and text against the file's conversation chain, work out the rewind point, and hide the groups after it (including the User input rewound to, whose text has returned to the input box). Whether `turns()` counts slash commands and so on is to be measured at implementation, and the comparison basis set then.
- This detection only "subtracts", never "adds"; it only hides and does not change the file reading state. The next time the file has new lines, read as usual and let the file decide (the conversation chain will have switched branch by then).
- A rewind is not written to disk: if you quit without submitting after a rewind and then resume, the discarded branch comes back, and the contents show it, in agreement with the host.
- `messages()` gives only the latest 4096 entries and has no uuid: the alignment is done from the tail by text.
- In the contract's "not promised", the item accepting the window is deleted; "no guarantee of jumping to the branch a rewind discarded" is changed to speak only of rows compacted before a resume.

## Steps

- [x] Measure how `turns()` counts (slash commands, `!` commands, after a compaction, after a resume)
- [x] Test first: the pure function for alignment (an ordinary rewind, a rewind to the first one, with a local command group, a rewind after a compaction, `messages()` cut at 4096 entries)
- [x] Test first: when `turns()` has not decreased, `messages()` is not called; the latest group is not deleted by mistake during streaming output
- [x] Implement
- [x] Acceptance contract: revise `CT-LIFE-004` (within 500 ms of a restore the discarded entries vanish from the contents, with no further submit needed); add `CT-LIFE-008` (after a rewind, quit without submitting and resume: the discarded branch returns to the contents, matching what the host shows); delete the accepted window from "not promised"; sync the README
- [x] PTY acceptance on the host's two versions

## Comments

- 2026-10-12 spike (the two versions agree): the `.jsonl` bytes are the same before and after a restore; no hook fires other than the `ui.render` of `PromptHint` (twice); at the first poll about 300 ms later, `$.session.messages()` and `turns()` already hold the truncated values. The current Pane does not change during 20 seconds idle, clearing the input box, Esc, or the terminal losing and regaining focus; it updates about 300 ms after the next main-loop `session.append` (the next submit, or a local command that records a row, such as `/reload-plugins`). When logged in, the "updates by itself after a while" is most likely the `system/away_summary` row the host appends after the terminal has lost focus for about 180 seconds, not proven. "Restore code only" does not change the conversation (the dialog's own words: The conversation will be unchanged).
- 2026-10-12 measured (the two versions agree, probe plugin, not logged in): `turns()` = the number of user entries in `messages()` that are not tool results; the compaction summary and the input and output of `!` all count, and local commands such as `/tui` are in neither; `messages()` starts from the last compaction summary; after a restore, both are already truncated in that very `PromptHint` draw.
- 2026-10-12 implementation (branch `chat-toc/33-rewind-live-update`): `hooks/rewind.ts`. When `messages()` is complete (< 4096), align in order from the last compaction boundary (this can tell duplicate prompts apart); when truncated, find the latest match from the tail; if nothing matches (for example the file has not yet written the new compaction), change nothing. All groups after the last user row still held are hidden, and local command groups sandwiched after it are hidden with them. The next time the file has new lines, the hiding is cleared and the file decides. It checks once on each `PromptHint` draw and again 300 ms later. PTY: `CT-LIFE-004` removes the discarded entries about 12 ms after a restore on both versions (control: `main`'s code does not remove them), and `CT-LIFE-008` passes on both versions. The `CT-JUMP-003` and `CT-UI-003` scenarios that used a rewind to make refused/dimmed entries were rewritten and pass on both versions.
