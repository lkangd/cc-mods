# Decide whether to highlight the current position

Type: grilling
Status: resolved
Blocked by: 07

## Question

Depending on whether 2.1.287 has `props.onScreen`: build the current position highlight (cc-switch's bar on the left) or not; if 2.1.287 lacks it, raise the minimum version, fall back by version capability (no highlight, perceptibly), or drop it; which group the highlight takes (the Turn group of the viewport's top? how close to the bottom forces the last group?), and whether the TOC list scrolls the highlighted item into view.

## Answer

**Build it, on the premise of the results of "Measure how requestId maps to transcript rows".** 2.1.287 already has `props.onScreen` (see "Check the key APIs on Claude Code 2.1.287"), so the branches of raising the minimum version or falling back by version do not arise.

1. **Premise and way out**: build it only if measurements confirm that in fullscreen interactive mode `onScreen` reports reliably while scrolling, its numbers match the screen and `requestId` maps to a Turn group. If any fails, drop the highlight from the MVP with no fallback notice and no status line note: it is not a version gap, the person can do nothing about it, and a missing highlight misleads no one. The TOC's scrolling then falls back to "follow the newest when at the bottom".
2. **Which group**: only one group lights: the Turn group of the viewport's top row. "The top row" is the earliest row in transcript order among the rows on screen (`onScreen` not `null`), counting one with its upper half cut off (`first > 0`). A row in no group (the compaction summary, a hook note, the session's opening notes) counts for the nearest group before it; with no group before it, nothing lights. No range mark for "every group on screen".
3. **The last group at the bottom**: when the transcript's last row is wholly on screen (`last === of - 1`), the last group lights whatever group is at the top. Judged by "the whole row visible", with no threshold of rows from the bottom.
4. **Apart from the selection cursor**: the current position highlight is passive and follows the transcript's viewport; the ↑↓ selection cursor exists only while the Pane has the focus. The two are independent and can sit on different groups. After an Enter or click jump the viewport moves, so the highlight updates to the target group by itself, doubling as feedback that the jump worked. The exact style (bar, background) is the prototype's to settle.
5. **The TOC list's scrolling**: the TOC's scroll position is always set by the highlighted group, replacing the separate `isFollowing`; with the transcript at its bottom the last group lights, so the TOC stays on the newest. After the person scrolls the TOC by hand, or while the Pane has the focus for ↑↓ selection, scrolling by itself pauses; it resumes when the highlighted group next changes because the transcript's viewport changed.

Terms: **Current position** added to `mods/chat-toc/CONTEXT.md`.

## Later revisions

- Measured in "Prototype the docked TOC Pane's look and interaction": after a successful jump the highlight locks on the target group and unlocks at the viewport's first change once the jump's redraws stop; the Current position believes only a contiguous run of on-screen rows holding the latest report, and `ToolUse` takes no part. See [05](05-prototype-toc-pane.md).
