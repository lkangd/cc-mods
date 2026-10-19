# Finalise the compatibility and acceptance contract

Type: grilling
Status: resolved
Blocked by: 04, 05, 11

## Question

What is chat-toc MVP's acceptance contract: the support matrix (how `>=2.1.287` in the terminal's fullscreen layout and "any operating system" are worded, and the measured samples), the MUST scenarios that must pass (opening by itself and closing, the dock threshold and the status line note, the three-state filter and its memory, User input and Agent reply jumps, the Current position highlight and the TOC following, rebuilding after `/clear`, agreement with the transcript file's conversation chain after compaction/rewind/resume, long sessions and chunked reads of transcripts over 4 MiB, the empty state while a new session's transcript file does not exist before the first message), how PTY acceptance works, and also the scenarios measured in "Prototype the docked TOC Pane's look and interaction": switching and remembering the three Layouts, the highlight locked after a jump, local commands (`system/local_command` rows) opening groups and the fallback jump, jumping to rows never drawn in a virtualised transcript, stale on-screen values not misleading the highlight after rows unmount, the map rebuilt after a hot reload, dimming and the bottom note after a refused jump; plus the host limits declared beforehand as not promised (such as the transcript file format being unpublished, and Windows chunked reads being acceptable only on Windows).

## Answer

**Verdict: the release gate is "one support matrix, layered evidence, every MUST scenario present and none skipped". Promise and measurement are kept apart: the promise sets no operating system limit, while the release gate runs only on this macOS machine, on the minimum and the current version.** Confirmed item by item with the user in two rounds on 2026-10-09.

Words on screen are quoted in English below; the PTY gate checks their Chinese twins (ticket 37).

### 1. Levels

- **MUST**: blocks a release. Any scenario that fails, is missing, is skipped or has no traceable evidence stops it.
- **Stated fallback**: the alternative path that must exist when the host does not give a capability. The alternative path is itself a MUST.
- **Not promised**: must be written into the README or the on-screen notes beforehand, never moved there after an acceptance failure.
- Scenarios have stable IDs, `CT-<group>-NNN`.

### 2. Support matrix

- **Promised**: Claude Code `>=2.1.287`, an interactive terminal, the fullscreen layout, any operating system. Both `--plugin-dir` and the marketplace are supported.
- **Release gate**: each release runs once on the minimum version 2.1.287 and once on the current version of the day, on this macOS machine, and every MUST must pass. A marketplace install runs only the smoke (`CT-COMPAT-002`); full scenarios use `--plugin-dir`. The report records the OS and architecture, as a sample only.
- Chunked reads on Linux and Windows (`tail`/`head`, Windows PowerShell 5.1): the automated tests check only the command built and the output parsed against a `$.process.run` stand-in, not accepted on real systems.
- The plugin manifest has no field for the host's minimum version (`plugin.json`'s `version` is not checked). Below 2.1.287 the plugin most likely does not load at all, so there is no runtime version check, only the README's statement.

### 3. Layered evidence

1. **Automated tests**: `claude plugin test` and the `claude-code/testing` test kit fire events, stub host calls and check what is drawn; pure functions use plain `test()` in the same suite. Only the current version must pass. Covered: the opening rules, taking rows along the conversation chain, steps and the last text, the four-step `requestId` → row match, the Current position's run algorithm, the fallback jump's candidate order, chunk edges (including a half row across a 4 MiB chunk), `$.store` memory.
2. **PTY acceptance in the real host**: driven by cmux. Covers opening and closing, the dock threshold and the status line, click and Enter jumps, the highlight lock, `/clear`, compaction, rewind, resume, fork, hot reload.
3. **Visual check**: only how the three Layouts look, and whether the cyan highlight and the inverse cursor tell apart. Signed in the report, **not a MUST**.

Consistency is always judged by an **independent verifier**: it works out the expected Turn group sequence straight from the transcript file's conversation chain and compares it with the entries the Pane lists.

### 4. MUST scenarios

**Compatibility and loading**
- `CT-COMPAT-001`: a cold fullscreen start with `--plugin-dir` on both versions. The Pane docks on the right by itself; validate has 0 errors.
- `CT-COMPAT-002`: a smoke after a marketplace install. The Pane opens by itself, and one click on a user side jumps.
- `CT-COMPAT-003`: outside the fullscreen layout, or with the terminal too narrow to dock, no inline placement appears; the status line keeps saying why and how to meet the condition. Once it is met the Pane appears by itself and the note goes. The threshold is the host's; the test samples only either side of `isPlaced` flipping and hard-codes no column count.

**Data source and fallbacks**
- `CT-DATA-001`: while the file does not exist (a new session, before the first message), the Pane's body is one line, "No conversation in this session yet". Entries appear once the first User input is written.
- `CT-DATA-002`: when the file cannot be read or permission is denied, no entry shows and the bottom keeps the reason; no list pieced together from `$.session.messages()` passes for the whole.
- `CT-DATA-003`: unrecognized lines are skipped and the bottom says "N lines not recognized; the contents may be incomplete", N the real count.
- `CT-DATA-004`: a transcript over 4 MiB read in chunks gives the same result as a whole read, a half row across a chunk edge included; as the session goes on, only new chunks are read.
- `CT-DATA-005`: subagent (sidechain) content stays out of the TOC; one subagent counts 1 step.
- `CT-DATA-006`: two sessions of one project in two terminals each show only their own transcript.

**Turn group content**
- `CT-TURN-001`: a plain prompt, a slash command (both forms, a user row and a `system/local_command` row) and `!cmd` all open groups; notifications, command output, interruptions and injected reminders open none.
- `CT-TURN-002`: at least three identical prompts are each a group.
- `CT-TURN-003`: multi-line, CJK and emoji are cut to 2 lines by terminal cell width with an ellipsis; `<pasted_content>` tags are dropped.
- `CT-TURN-004`: the Agent reply has three forms: "N steps" plus 2 lines of the last text; "Running · N steps", the steps counting up live; "N steps · No text reply". Interrupted or failed turns show as the file has them.
- `CT-TURN-005`: times come from the transcript rows' timestamps; a fixture without timestamps shows no time and invents none.

**Lifecycle and branches** (all judged by the verifier against the transcript's conversation chain)
- `CT-LIFE-001`: the Pane opens by itself; after a click on ✕ it stays closed for the session; `/chat-toc` reopens it; a new process opens it by itself again.
- `CT-LIFE-002`: after `/clear` the contents rebuild with the new session, with no dividing line; the "closed" mark is reset and the Pane opens again.
- `CT-LIFE-003`: after `/compact`, the entries from before the compaction still show.
- `CT-LIFE-004`: within 500 ms of a rewind (Esc Esc included) restoring the conversation, with no further submit, the thrown-away branch's entries (the entry rewound to included) leave the contents, the file unchanged; later submits show by the file's new branch as usual. (Revised 2026-10-12, see ticket 33)
- `CT-LIFE-005`: after `--resume`, `--continue`, `/resume` in a session and `--fork-session`, the contents match that session file's conversation chain.
- `CT-LIFE-006`: after a hot reload (`/reload-plugins`) the map rebuilds once the transcript is read, and jumps and the highlight stay right.
- `CT-LIFE-008`: after a rewind, quitting without a submit and resuming brings the thrown-away branch back into the contents, matching what the host's transcript shows. (Added 2026-10-12, see ticket 33)
- `CT-LIFE-007`: enabling the plugin in a running session without a restart, both ways (enabling it in the `/plugin` screen and closing the menu, which the host reloads by itself; and `claude plugin enable` plus `/reload-plugins`), with no further message submitted, the Pane opens by itself and matches that session file's conversation chain; the same with a project path holding Chinese and spaces and longer than 200 characters. (Added 2026-10-12, see ticket 31)

**Filter, layout and keyboard**
- `CT-UI-001`: the three-state View filter redraws at once on a switch, and the choice is remembered across processes.
- `CT-UI-002`: the three Layouts switch through the real entry (as "Decide the Layout switch's entry and default" says), and the choice is remembered across processes; only the drawing changes, not which entries show.
- `CT-UI-003`: with the Pane focused, ↑↓ select and Enter jumps; ↑↓ do not skip dimmed entries; the selection cursor and the highlight are drawn separately.
- `CT-UI-005`: the refused-jump notice is at the Pane's bottom, starting with `⚠`, in the theme's `warning` colour; as it appears it flashes inverse 3 times (about 150 ms lit, 150 ms unlit), then stays lit and goes after about 5 seconds. An entry judged beforehand as from before a compaction says "This entry was compacted before the session resumed; cannot jump to it", others "This entry is not in the conversation view now; cannot jump to it". (Added 2026-10-12, see ticket 32)
- `CT-UI-004`: the highlight and the dim follow the host's theme: under `dark`, `light`, `dark-ansi` and `light-ansi`, the highlight slots' foreground is that theme's `suggestion` and the dim is its `inactive`; after `/theme` switches, the Pane redraws in the new theme at once. (Added 2026-10-12, see ticket 30)

**Jumps and the Current position**
- `CT-JUMP-001`: a click on the user side jumps to that prompt, on the Agent side to the last text, rows never drawn included (such as jumping to turn 1 after resuming 300 turns).
- `CT-JUMP-002`: local commands, prompt-type commands and `!cmd` use the fallback jump: the nearest drawable row after, then before, with `center`; on a refusal the next candidate, up to 3.
- `CT-JUMP-003`: when every candidate is refused after a press, only that side dims and the bottom says so (styled as in `CT-UI-005`), with no other side effect; it recovers once the host lists the row again.
- `CT-JUMP-005`: in a session this process started with resume, the entries before the conversation chain's last compaction boundary at start are drawn dim (the theme's `inactive`) as soon as they show, and later entries are not; dimmed entries can still be selected and pressed, and a refused press says "This entry was compacted before the session resumed; cannot jump to it" at the bottom. (Added 2026-10-12, see ticket 32)
- `CT-POS-001`: after a jump the highlight locks on the target group and unlocks at the viewport's next change, after which it takes the group of the viewport's top; when the last drawn row is wholly visible, the last group.
- `CT-POS-002`: stale on-screen values left after rows unmount do not mislead the highlight. After 180 notches of continuous wheeling, the highlight matches the group of the screen's first row.
- `CT-POS-003`: the TOC scrolls to follow the Current position; a manual scroll of the TOC or the Pane being focused pauses it, the footer saying it is not following; following resumes at the Current position's next change.

**Performance**
- `CT-PERF-001`: for a 20 MB-class transcript, the first listing, incremental reads and redraws all stay within the limits at p95; a long session scrolls continuously to both ends, no paging. The limits come from "Measure the cost of reading and drawing a long session".

**Privacy**
- `CT-SEC-001`: a run with a synthetic prompt holding a unique marker: the marker appears only in what the Pane draws, never in `$.store`, the plugin's data folder, logs, error texts or the release report. `$.store` holds only the View filter and the Layout.

**Coexistence**
- `CT-COEX-001`: with `cc-plugin-diff`'s Pane open too, it behaves as "Decide how to share the dock with other Panes" concluded.

### 5. Not promised (written into the README)

- Claude Code `<2.1.287`: no check, no notice. Nor Desktop, IDEs, mobile, or an inline placement outside the fullscreen layout.
- Linux and Windows are covered only by tests of the commands built, not accepted on real systems; Windows uses only Windows PowerShell 5.1.
- The transcript file format is unpublished; if the host changes it the TOC may show only in part, as `CT-DATA-003` says.
- When enabled mid-session, the transcript's path is worked out from the host's unpublished project folder naming rule; if the host changes the rule, the contents wait for the next submit.
- Jumps to rows compacted before a resume are not guaranteed.
- The visual check (how the Layouts look, whether the colours tell apart) does not block a release.
- No fixed latency SLA for every machine; the `CT-PERF` limits are release evidence collected on the reference machine only.

### 6. The release report

- Fields: plugin version, Claude Code version, OS, architecture, fixture, scenario ID, expected, actual, result, evidence links.
- Where: `mods/chat-toc/tests/evidence/<plugin version>/`, committed.
- Synthetic prompts only, no real conversation content.
- No shared library pulled out of prompt-history; each writes what it needs.

### Fog raised to tickets

Three patches of fog, "rendering and performance of long sessions", "the Layout switch's entry" and "sharing the dock with other Panes", were each raised to a ticket. This contract only reserves their scenario IDs; their limits and behaviour come from those three tickets' conclusions.

## Later revisions

- 2026-10-10, confirmed with the user while summing up the spec: when the person opens it with `/chat-toc` and the host cannot dock it (such as fullscreen with the terminal under 110 columns), it stays inline as the host placed it. `CT-COMPAT-003` becomes: no inline when **opening by itself**; `/chat-toc` where it cannot dock shows an inline Pane listing the entries; when a docked Pane is made inline by the host as the terminal narrows, the plugin closes it (not marked closed) and shows the status line note, and opens it by itself again once the condition is back. A new not-promised item: layout, following and highlight in the inline form are not accepted. See [the spec](../spec.md).
- 2026-10-12 (ticket 30): the Pane's colours use the host's theme keys, with a new MUST `CT-UI-004`; `CT-UI-003`'s highlight colour criterion changes from cyan to the current theme's `suggestion`.
- 2026-10-12 (ticket 33): `CT-LIFE-004` now removes the thrown-away entries within 500 ms of the restore, with no further submit; a new MUST `CT-LIFE-008` (quit after a rewind, then resume); "not promised" drops the accepted window between a rewind and the next submit, and "jumps not guaranteed" keeps only rows compacted before a resume. The PTY scenarios of `CT-JUMP-003` and `CT-UI-003` no longer use a rewind to make refused or dimmed entries: the former now swaps the plugin in mid-session after a resume and presses an entry from before the compaction, the latter uses entries compacted before the resume.
- 2026-10-12 (ticket 32): new MUSTs `CT-JUMP-005` (entries from before the compaction dimmed in advance after a resume) and `CT-UI-005` (the refusal notice's style and flashing); `CT-JUMP-003` now covers only refusals after a press. Measured: a `--fork-session`'s file starts at the last compaction boundary and holds none of the entries before it, so the advance judgement looks only at resume.
- 2026-10-12 (ticket 31): a new MUST `CT-LIFE-007` (enabled mid-session); a new not-promised item, "enabling mid-session relies on the host's unpublished folder naming rule".
