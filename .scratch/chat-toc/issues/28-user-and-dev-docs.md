# 28: User docs and developer docs

**What to build:** Anyone who wants to install chat-toc can read its requirements, install steps, operation, display rules, privacy, uninstall and known limits in the root README. Developers find local loading, tests, PTY acceptance and the release checklist in the plugin's own README.

For the spec, see [chat-toc MVP](../spec.md) §10.

**Blocked by:** 21 (The conversation chain: compaction, rewind, resume, fork), 23 (Full jumps: the Agent side, fallbacks and refusals), 25 (View filter, three Layouts and the keyboard), 26 (Docking conditions and the status line)

**Status:** resolved

- [x] The root README opens with "each mod is an independent plugin; they do not depend on each other, share no code or data, and can be enabled together"; the overview table gains a chat-toc row (version written as 0.1.0 for now, appearing with the release commit)
- [x] The chat-toc section sits at the same level as prompt-history and opens with how the two differ, then in order: what it does, requirements (including "no function hooks environment variable needed", any OS but tested only on macOS), install, quick start, the operation table, display rules, data and privacy, uninstall (including where the leftover `$.store` file is), known limits (the eight items not promised), development
- [x] Use the words on the screen; no internal terms such as Turn group or Current position
- [x] The plugin README covers development only: links to the root README and CONTEXT, directory layout, local loading, `claude plugin test`, cmux PTY acceptance, the evidence directory convention, the release checklist (ticked step by step)
- [x] The docs match the actual behaviour (checked item by item against the spec and the passed acceptance)
- [x] The root README's chat-toc section and the overview table row are left to go into main with the release commit

## Comments

2026-10-11, branch `chat-toc/28-docs` (based on `chat-toc/mvp` ce384e1).

- **The root README was not changed**. The change to the opening sentence, the overview table row and the full chat-toc section are written as a ready-to-paste draft, `mods/chat-toc/release/root-readme-section.md`. Ticket 29 pastes it into `README.md` in the release commit (the same commit as the marketplace entry and `evidence/0.1.0/`). In the draft, the 0.1.0 pass results in the "Development" subsection are `<…>` placeholders, left for ticket 29 to fill in.
- **`mods/chat-toc/README.md`** is committed normally: links to the root README (anchor `#chat-toc`, valid only after the release commit) and `CONTEXT.md`, directory layout, local loading and hot reload, `claude plugin test`/validate/tsc, unit tests of the acceptance tools, PTY acceptance (the commands of each scenario script, cmux notes, run records), the evidence directory convention, the release checklist (ticked step by step).
- **How it was checked**: all on-screen text is taken from code constants: the four status line sentences (`hooks/lifecycle.ts` `DOCK_STATUS`, ticket 26), the two empty-state sentences (`hooks/pane.tsx` `EMPTY_TEXT`/`NOT_WRITTEN_TEXT`, tickets 17/20), the two read-failure sentences at the bottom and "N lines not recognized; the contents may be incomplete" (`hooks/register.tsx`, ticket 22), the refusal note (`hooks/jump.ts` `REFUSED_TEXT`, ticket 23), the Agent side's state words and the time format (`hooks/entries.ts`), the filter row and "Layout: …" (`hooks/view.ts`, which the host draws as `1: ●All`, ticket 25), the title "Contents". Behaviour was checked item by item against spec §2–§8 and the Comments of tickets 17–26; keyboard focus in and out (Ctrl+X Tab, Esc, Ctrl+X arrow keys to resize) was checked against `~/.claude-code-docs/docs/plugins__mods__interface.md`; the plugin sets no `closeOnEscape`. The docking columns 144/110 are the host thresholds ticket 26 measured on the two versions; the draft says the host decides. It also runs without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`: the PTY driver's isolated environment never sets it. Every command written in the docs was run: `claude plugin test mods/chat-toc` 165 passed, the acceptance unit tests 43 passed, `plugin validate` passed on both versions, `tsc` passed.
- **Two points that could not be verified, handed to ticket 29 to check**:
  - The store file name: with `--plugin-dir` it was measured as `chat-toc_inline-<hash>.json` (ticket 25, `remember-*.txt`); the marketplace install's `chat-toc_cc-mods-<hash>.json` is inferred from prompt-history's `prompt-history_cc-mods-<hash>.json`.
  - Whether `claude plugin uninstall` deletes the store file: no documentation found, so the draft says "may still be left".
- **Sentences that depend on ticket 24 (highlight, following, "paused")**; recheck them one by one once 24 lands (all in the draft's chat-toc section):
  1. The operation table row "scroll the wheel on the contents": "after scrolling to the bottom, go back to following the latest entry" (after 24, what it follows is the highlighted turn, and scrolling pauses following).
  2. The display rules item "three Layouts": the part in brackets in "on a switch, the selected entry (the turn being looked at when nothing is selected) stays within the visible range" (ticket 25 currently anchors on the group at the top of the window, `anchorForSwitch`).
  3. The display rules item "cyan highlight" as a whole: what the turn being looked at is, that it is the last turn when the end of the conversation is fully shown, the highlight marks of the three Layouts (`▌`/`●`/`┃`, drawn by ticket 25, with ticket 24 filling in `litGroup`), that after a jump the highlight stays on the target until the transcript is scrolled again, and that the highlight and the inverse selection are unrelated.
  4. The display rules item "following and 'paused'" as a whole: the contents scroll to the highlight, stay at the latest when the transcript is at the end, pause when the contents are scrolled by hand or focus is in them and show "paused" at the bottom, and resume on the next transcript scroll.
  5. "Following and highlight" in the last item of the known limits, and "whether the cyan highlight and the inverse selection can be told apart" in the manual visual check item (only a statement; if 24 changes the marks, look at the wording again).
  6. The sentence "MUST scenarios without scripts yet" in `mods/chat-toc/README.md` "PTY acceptance" (CT-POS, CT-COEX-001, CT-LIFE-006) and the scenario table: add them to the table once 24 adds scripts.
- **Sentences that depend on ticket 27 (long-session performance)**:
  1. The known limit "no fixed speed is promised on every machine; the performance numbers at release were measured on one reference machine only": if 27 gives a conclusion that can be made public (for example the first-contents time of a 20 MB-class session), add a sentence here or in the "Development" subsection.
  2. CT-PERF-001 in "MUST scenarios without scripts yet" in `mods/chat-toc/README.md`, and the scenario table: add the command once 27's performance driver lands.
  3. In the draft's "Session changes", "can also jump to very early turns that were never shown" was already verified by ticket 23's CT-JUMP-001; change it if 27's jumps to the start and end of a long session reach a different conclusion.
