# 17: The minimal docked contents

**What to build:** When a fullscreen session starts, chat-toc's Pane docks to the right of the transcript by itself and lists every plain prompt in the current session (Card layout, drawing only the user side, "you · time" plus at most 2 lines of the original), and a click jumps back to that prompt in the conversation. As the session goes on, the contents grow with it. This is the first complete path through "read the transcript → build Turn groups → draw the Pane → jump", and the later tickets all extend it.

For the spec see [chat-toc MVP](../spec.md) §1, §2, §3, §5, §7.

**Blocked by:** None (can start at once)

**Status:** resolved

- [x] The plugin root, `plugin.json` (`chat-toc`, `0.1.0`) and the `/chat-toc` command registration are all in place, and `claude plugin validate` gives 0 errors on 2.1.287 and on the current version
- [x] When a fullscreen session starts (`session.start`), the docked Pane opens by itself; it does not open again when `$.ui.panes()` already has it
- [x] `transcript_path` comes from the classic event; a file of ≤4 MiB is read with `$.fs.read`, and the current branch is taken along `parentUuid`
- [x] Each user row with `origin.kind: "human"` opens its own group; identical prompts each form their own group
- [x] Card layout user side: a dim header line "you · Oct 9 HH:MM" (a month-day date, in Chinese `你 · M月D日 HH:MM`; just "you" when the time cannot be read) plus at most 2 lines of the original, each line a `plain` Button, one shared jump per side, and a hover scope lighting the whole side together
- [x] A click on the user side jumps to that prompt with `block: start` (`requestId` an exact match on the uuid), and `"placeholder"` is always ignored
- [x] While the file does not exist, the body is one line, "No conversation in this session yet", and entries appear once the first User input is written
- [x] `session.append` (no `agentId`) and `turn.complete` trigger a reread: a trailing 300 ms, merged while reading, skipped if the `fs.stat` size is unchanged, and checked once more at +1.5 s after `turn.complete`
- [x] The `claude plugin test` suite is set up and covers opening groups and drawing; a manual smoke on both versions once (the seed of CT-COMPAT-001)

## Comments

**2026-10-10 Implementation notes (branch `chat-toc/17-tracer`)**

- Module layers (`mods/chat-toc/hooks/`): `transcript.ts` parses rows → `chain.ts` the current branch → `groups.ts` the opening rules and the user side's text → `model.ts` ties them together; `source.ts`/`reader.ts` are the read result and the throttle gate; `entries.ts`/`cells.ts`/`window.ts`/`pane.tsx` draw; `jump.ts` is the Jump target. The host's `$` can only be handed to functions declared at the top level of `register.tsx` (the engine checks this statically at load), so every `$` call stays in `register.tsx` and the other files are pure functions. The later tickets extend these files: 19 changes `groups.ts`/`entries.ts`, 21 changes `chain.ts`, 22 changes `source.ts` and `register.tsx`'s `readSource`, 23/24 change `jump.ts` and add the transcript-site hook, 25 changes `entries.ts`/`pane.tsx`.
- Tests: `claude plugin test mods/chat-toc` passes all 33 items (2.1.295). The 2.1.287 test kit has no underlying implementation of `session.append`, so the 5 cases that depend on it cannot run on 2.1.287; by the spec only the current version must pass. `tsc` gives 0 errors against both the 2.1.287 and the 2.1.295 declarations; `claude plugin validate` passes on both versions.
- Jump tests can only sit on the seam of pure functions: the test kit does not hand a test's hook a `$.ui.scroll` aimed at a transcript row, so the real jump is confirmed by the PTY smoke.
- "`placeholder` is always ignored": this ticket hooks no transcript site's render hook, so the plugin consumes no `requestId` the host gives, and a jump uses the opening row's uuid directly; hooking the sites, mapping `requestId` and ignoring `placeholder` land with 23.
- What this ticket does not include: opening by itself only when `viewport.isFullscreen` is true and the status line note for `isPlaced:false` (26); the closed mark and `/chat-toc` focusing (20); for files over 4 MiB it shows only a line, "The transcript is over 4 MiB; the contents cannot be read yet", with chunked reads in 22. The Pane manages its own window, follows the latest entry by default, and the wheel scrolls by entry; following the highlight is in 24.
- PTY smoke (cmux, its own workspace, the other local plugins turned off, a synthetic transcript with `--resume`, deleted afterwards):
  - 2.1.295: docked by itself; all 30 synthetic prompts listed (the two prompts submitted twice each form their own group, times in the local time zone); a click on the body line and on the header line both jump to the matching prompt; the wheel up scrolls to the first entry; after submitting one synthetic prompt the contents grow; a new session shows "No conversation in this session yet".
  - 2.1.287: docked by itself (✕ drawn at the right of the first line, no clash with the short header line); click jumps; a new session first shows "No conversation in this session yet", and an entry appears after one synthetic prompt is submitted.
  - The docked width is actually 80 columns: the host kept the width tuned in the earlier prototype (a width the person has tuned takes priority over `columns: 44`), as declared.
  - Haiku was called 2 times in all (one synthetic prompt each).
