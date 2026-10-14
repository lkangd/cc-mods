# 32: Entries that cannot be jumped to grey out in advance, with a clearer notice

**What to build:** Entries that can be known in advance to be unjumpable are drawn dimmed as soon as they appear, so the person need not click them one by one; when a press is refused, the notice is eye-catching and flashes briefly when it appears.

**Blocked by:** none

**Status:** done

## Problem

The user reported: some entries cannot be jumped to, but they are white until clicked; only after a click does "This entry is not in the conversation view now; cannot jump to it" appear at the bottom; this notice is small `dimColor` text and not noticeable enough.

## Decisions made (grilling, 2026-10-12)

- **Deciding in advance** applies only to "rows compacted away before a resume", by the file's rules: when this process's session started with `resume` (`fork` to be measured at implementation; if it behaves the same, include it), entries before the last compaction boundary on the conversation chain at the moment of startup are all drawn dimmed (the same style as the existing dimming on refusal, that is, the theme's `inactive`).
- When the plugin is enabled mid-session in a session that came from a resume, the start source is not available, so no advance decision is made, and "grey out once a press is refused" stays.
- A grey entry can still be clicked and chosen with the keyboard (`CT-UI-003` already requires ↑↓ not to skip dimmed entries); a press still tries `$.ui.scroll`, and the notice appears only when it is refused; when the host lists the row again, it returns to the normal colour (the existing logic).
- **Notice style**: the position stays at the bottom of the pane; `⚠` goes before the text, coloured with the theme key `warning`; when it appears it flashes in inverse 3 times (about 150 ms bright, 150 ms dark, about 1 second in all), then stays on; the total time is still 5 seconds, and it is cleared when a jump succeeds or the selection moves away (the existing logic). It does not move below the entry.
- **The notice text depends on the reason**:
  - An entry decided in advance to be before a compaction: "⚠ This entry was compacted before the session resumed; cannot jump to it"
  - Any other case where the host refuses: "⚠ This entry is not in the conversation view now; cannot jump to it"
- No standing note line on the pane.

## Steps

- [x] Measure whether `fork` refuses rows before a compaction boundary just as `resume` does
- [x] Test first: the pure function for the advance decision (resume/non-resume, no compaction, several compactions, rows compacted after startup are not affected)
- [x] Test first: drawing the notice (`warning` colour, `⚠`, the frame sequence of the flash, the two texts)
- [x] Implement
- [x] Acceptance contract: add `CT-JUMP-005` (after a resume, entries before the compaction are grey as soon as they appear, and a press shows the matching text) and `CT-UI-005` (the notice has the `warning` colour and `⚠`, flashes in inverse 3 times when it appears and then stays on, and disappears after 5 seconds; pyte samples frames at time points); `CT-JUMP-003` has its wording checked to match
- [x] Add one sentence to the Jump target in `CONTEXT.md`: an entry that can be decided in advance to be unjumpable is drawn dimmed
- [x] PTY acceptance on the host's two versions

## Comments

- 2026-10-12 spike (the two versions agree): in an ordinary session, prompts, slash commands, `!` commands, interrupted turns and replies that have only tool calls can all be jumped to; the ones refused are only the rows compacted before a resume (all refused before the boundary, all jumpable after it) and the rows a rewind threw away (handled by ticket 33). With a live `/compact` and no resume, rows before the compaction can still be jumped to. There is no way to probe whether a row is listed without moving the view (a scroll not initiated by the person is first refused as `not person-initiated`). The host theme has `warning` and `error`; `TextProps` has `bold` and `inverse` (not verified at runtime on 2.1.287).
- 2026-10-12 implementation (branch `chat-toc/32-unjumpable-dim-and-notice`): fork measured (both versions): the file of `--fork-session` starts at the last compaction boundary and holds no entries before the boundary, so the advance decision looks only at `resume`. When the source of `classic.SessionStart` is `resume`, `compactedAt` in `$.state` is set to pending; the next time rows are read, the last compaction boundary on the chain is recorded; a side before the boundary, whose jump candidates are all before the boundary, is put into the refused table with `why: 'compacted'` (the same dimming and recovery logic as a refusal on press), kept in `$.state` so it survives a hot reload. The notice is a line of its own: `⚠` + the `warning` colour, with `inverse` flashing 3 times in steps of 150 ms. PTY: `jump_scenarios.py 005` passes on both versions (`CT-JUMP-005`, `CT-UI-005`), and `inverse` takes effect on 2.1.287; after the change, `CT-JUMP-003` was rerun on the current version and passes.
