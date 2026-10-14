# Prototype the docked TOC Pane's look and interaction

Type: prototype
Status: resolved
Blocked by: 01, 02, 03, 04, 08, 09, 10, 11

## Question

Build a rough chat-toc Pane in a real terminal and check: whether the Turn group card's layout ("you · time", 2-line truncation, "N steps" and the state) reads well at common dock widths; the three-state View filter's style and its click and keyboard use; whether click and Enter jumps land on the right row; whether the Current position highlight and the ↑↓ selection cursor tell apart at a glance, and how the TOC following the highlight and pausing on a manual scroll feel; opening by itself, staying closed after a close, reopening with `/chat-toc`, the status line note when too narrow; whether a session of a few hundred turns scrolls smoothly. Produce an interactive prototype and observation notes. Also confirm: the host resets the "closed for this session" mark on `/clear` and `/resume`, so the contents open by themselves again; is that acceptable? Also measure (from "Decide how entry sides without a Jump target show and click"): with a fallback jump at `block: 'center'`, does the original input row stay on screen; does a `ToolGroup`'s `collapsed-<prefix>` match a uuid uniquely, does a non-collapsed display go through `ToolUse` instead, and how much more does the transcript hook run once it is hooked too; is the fullscreen transcript virtualised (are rows off screen all drawn), which decides whether entries never drawn can dim in advance; how readable the dim style and the note line at the Pane's bottom are.

## Answer

**Verdict: the docked TOC Pane's look and interaction work; the user tried each item and all passed. All three layouts are kept, made switchable. Measurements changed three earlier decisions: "dim in advance" is dropped; the Current position believes only contiguous on-screen rows and locks on the target group after a jump; a local command opens a group by its `system/local_command` row.** The prototype is the mod `chat-toc-proto`, tried hot-reloaded in this session on the local Claude Code 2.1.295; a 300-turn synthetic transcript also ran in a fullscreen cmux workspace.

- Prototype (not merged): `prototypes/chat-toc/05-toc-pane/` on the local branch `prototype/chat-toc-pane` (e6f96a1). The same content is in [assets/05-prototype/](../assets/05-prototype/): the mod's source, the [observation notes](../assets/05-prototype/notes.md), the cmux driver script, the synthetic transcript generator and the per-run logs.

### Look and interaction the user confirmed

1. **Layouts**: Card ("you · time" + 2 lines of the original, "↳ N steps" + 2 lines of the reply, `▌` on the left marking the highlight), Compact (one line a side, `●` marking the highlight) and Timeline (time on the left + `│`, turning to a cyan `┃` when highlighted) are all kept, switched by the person and remembered across sessions in `$.store`. The prototype switched with `‹ ›` in the footer, the hotkey `v` with the Pane focused, and `/chat-toc a|b|c`; the real entry is left to the spec. Readable at 56, 44 and 36 columns.
2. **View filter**: `●All ○User ○Agent` at the top, also 1/2/3 with the Pane focused; redrawn at once on a switch.
3. **Highlight and selection cursor**: the selection cursor is the host's inverse, the highlight a cyan bar or dot, plainly told apart.
4. **Following and pausing**: a manual scroll of the TOC pauses following (the footer says "paused"), and following resumes at the Current position's next change; it feels right.
5. **Lifecycle**: opens by itself at the session's start; closed with ✕ it stays closed for the session; `/chat-toc` reopens it; after `/clear` and `/resume` the host resets the "closed" mark and the contents open by themselves again, **which the user accepts**. When the terminal is not wide enough, `isPlaced:false`: the Pane keeps waiting and the status line says why.
6. **The highlight locked after a jump** (revising "Decide whether to highlight the current position"): after a successful jump the highlight lands straight on the target group. Redraws caused by the jump come less than 300 ms apart, and the lock holds through them; once they stop, the first change of the viewport unlocks it and it goes back to the viewport's top. The reason: a fallback jump uses `center`, so the viewport's top is the group above. The user's verdict: "feels right now".

### Host facts measured (2.1.295)

- **A local slash command** (such as `/chat-toc`) is a `type:system, subtype:local_command` row in the transcript, its `content` holding `<command-name>`, on the conversation chain; its output is a system row of the same kind. `/clear` itself is still a user row. "Define the Turn group's split and edges"' opening rules missed this row.
- **`ToolGroup`'s `requestId`** is sometimes `collapsed-<the whole uuid>`, sometimes `collapsed-<the uuid's first 24>000000000000`; matching on the first 24 characters is unique. A non-collapsed display goes through `ToolUse`, its `requestId` the tool_use id. The `requestId` of `UserMessage`, `AssistantMessage` and `CommandOutput` always equals the uuid.
- **The fullscreen transcript is virtualised**: after resuming 300 turns only the last 20–25 or so are drawn, and rows are drawn around wherever a scroll or jump goes. An unmounted row does **not always** report `onScreen: null` again, and the stale "on screen" values pin the Current position to an old place. The earlier "jumped to B but A lit" in this session had the same cause, nothing to do with the pinned prompt bar.
- **`$.ui.scroll({ requestId })`** can jump to any row in the host's message list, rows never drawn included (`drawn:false` still returns `{}`). Only rows not in the list are refused, such as rows compacted before a resume and rows left by a rewind.
- **After a hot reload** the host redraws only the rows on screen then, before the transcript is read; the `requestId` map must be rebuilt after every transcript read.
- **A fallback jump with `center`** leaves the echo row (`❯ /tui`) in sight right above the target row.
- **The pinned prompt bar**: no "a single visible line does not count" rule is needed. Without it, both direct jumps and notch-by-notch scrolling light the group of the screen's first line.

### Decisions revised as a result

- **"Dim in advance" for class B is dropped** (revising item 3 of "Decide how entry sides without a Jump target show and click"): with virtualisation and hot reloads, "drawn before or not" does not tell whether a jump works. Every entry shows as usual and is always tried first; only once refused does the side dim, with a note at the Pane's bottom. The note's wording and when it goes follow the original item 4.
- **Fallback jump** (revising the original item 1): the user sides of local commands, prompt-type commands and `!cmd` all jump to the nearest drawable row **after** them on the conversation chain (a user prompt, an assistant row with text, a non-empty local command output, a row drawn before), or before them when there is none after, with `center`. On a refusal the next candidate is tried (up to 3 in the prototype).
- **Computing the Current position** (revising the implementation of items 2 and 3 of "Decide whether to highlight the current position"):
  - Only the on-screen reports of `UserMessage`, `AssistantMessage`, `CommandOutput` and `ToolGroup`; `ToolUse` takes no part.
  - The on-screen rows are cut into runs in conversation order: any drawable row not on screen between two rows cuts them apart; only the run holding the latest report is believed, and its first row taken.
  - When the last drawn row is wholly on screen, the last group; the lock after a jump is item 6 above.
- **`requestId` → row**: first the exact uuid, then without the `collapsed-` prefix, then the tool_use id, last the first 24 characters. A jump uses the id the host gave, not the uuid.
- **Opening rules** (adding to "Define the Turn group's split and edges"): a `system/local_command` row with `<command-name>` opens a group; its output rows join it. Pasted content's `<pasted_content>` tags are dropped from what shows.

### Performance sample (synthetic, 300 turns, 1.5 MB)

- Whole read and parse: 376 ms cold, 9–49 ms each after. This session's real transcript, about 1.6 MB, takes 13–20 ms each.
- The Pane draws only the visible window, about 7.5 ms a redraw (139 redraws, 1040 ms in all, during continuous wheeling). After 180 notches of continuous wheeling the highlight matches the screen's top row.
- First parse and incremental reads of 20 MB-class files were not measured; left to "rendering and performance of long sessions".

### Other

- One mistake during testing: `/exit` did not take, and the restart command was submitted as a prompt, setting off one Haiku call (no tools called). The synthetic transcript and the test workspace are deleted.
- Terms: `mods/chat-toc/CONTEXT.md` revises Current position and Jump target, and adds Layout.
