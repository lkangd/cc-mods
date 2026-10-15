# chat-toc MVP

Status: ready-for-agent

> Summed up from the 16 decision tickets of the [chat-toc map](map.md). The grounds and measured numbers for each decision are in its ticket; this file holds only the conclusions, and the ticket names in parentheses point to the source. Terms follow [`mods/chat-toc/CONTEXT.md`](../../mods/chat-toc/CONTEXT.md). Words on screen are quoted in English; each has a Chinese twin in `mods/chat-toc/hooks/text.ts` (§7, Language).

## Problem Statement

In a long session in Claude Code's terminal, the person cannot see the shape of the whole conversation: what they said, how much the Agent did each turn and what it answered last are all buried in an ever-growing transcript. Getting back to a prompt or a reply dozens of turns ago means wheeling slowly to find it. `/clear`, compaction, rewind and resume make "which turn am I looking at" harder still.

Claude Code has no conversation contents. The public mods API does not give them directly either: a transcript row has a jumpable identity only while it is drawn, there are no timestamps, the fullscreen transcript is virtualised, a rewind raises no event, and 2.1.287's `Button` takes only `label`. The contents must be accurate within those limits: no invented times or entries, no click that silently does nothing, no misleading highlight.

## Solution

chat-toc is a plugin of its own, its root at `mods/chat-toc/`, depending on no other plugin.

In the interactive terminal's fullscreen layout it docks a Pane to the right of the transcript (`placement: 'dock'`). The Pane is the **current session's** conversation contents: each entry is a Turn group (one User input of the person plus the Agent reply), in Transcript order. A click on the user side jumps back to that prompt; a click on the Agent side jumps to the turn's last text reply. A cyan highlight follows the Current position, and the list scrolls with it.

The data source is the current session's transcript file (`transcript_path`, format unpublished; the one relaxation of "public API only"), its rows taken along the current branch's conversation chain. The plugin writes nothing to disk, keeps no archive and never goes online; `$.store` holds only two preferences, the View filter and the Layout.

Support matrix: Claude Code `>=2.1.287`, an interactive terminal, the fullscreen layout, any OS, loaded by `--plugin-dir` or from the marketplace. It opens by itself at every start, whatever the layout or width, and is kept however the host places it (docked, inline, or waiting undrawn below the host's floor); chat-toc checks no width or layout of its own. (Changed by the user, 2026-10-14)

## User Stories

1. As a person in a fullscreen terminal, I want the contents to dock on the right by themselves at each session start, so that I see them without remembering a command.
2. As a person who does not want the contents, I want a click on ✕ to keep them from opening again this session, so that they do not keep bothering me.
3. As a person who closed the contents, I want `/chat-toc` to reopen and focus them at any time, so that I can get them back when needed.
4. As a person starting a new session, I want the next session (including after `/clear` and `/resume`) to open the contents by itself again, so that "close" applies only to the current session.
5. (Dropped 2026-10-14: chat-toc no longer explains placement on the status line.)
6. As a person in a long session, I want each entry to show "you · time" and the first 2 lines of my input, so that I recognise the turn at a glance.
7. As a person, I want each turn's Agent side to show "N steps" and the first 2 lines of the last text reply, so that I know how much the turn did and what it concluded.
8. As a person watching the contents while the Agent works, I want the last turn to show "in progress · N steps" with the steps counting up live, so that I know it is still running.
9. As a person, I want an interrupted or failed turn to say "Interrupted" or "Error", and a turn without a text reply to say "No text reply", so that I do not take them for normal completions.
10. As a person using slash commands and `!cmd`, I want each to be an entry too, so that the contents reflect everything I typed in the prompt.
11. As a person submitting the same prompt several times, I want each submission to be its own entry, so that the contents do not swallow repeats.
12. As a person, I want times taken from the transcript itself and not shown when they cannot be read, so that the time I see is always true.
13. As a person who wants to see only what I said (or only what the Agent answered), I want a three-state filter "All / User / Agent", remembered across sessions.
14. As a person with a preference for layout, I want to switch between the Card, Compact and Timeline Layouts, remembered across sessions, so that the contents fit how I read.
15. As a person, I want a click on any entry's user side to jump back to that prompt, so that I get back to that place in the conversation quickly.
16. As a person, I want a click on the Agent side to jump to that turn's last text reply, so that I see the conclusion directly.
17. As a person who prefers the keyboard, I want ↑↓ to select and Enter to jump with the focus in the contents, 1/2/3 to switch the filter and `l` to switch the Layout.
18. As a person scrolling the transcript, I want the contents to highlight the turn I am viewing and scroll to it by themselves, so that I always know where I am.
19. As a person who just jumped, I want the highlight to stay on the turn I jumped to until I scroll again, so that the jump has clear feedback.
20. As a person paging through the contents by hand, I want following to pause while I scroll them, and resume the next time I scroll the transcript, so that I am not dragged back while browsing.
21. As a person who clicked an entry that cannot be jumped to, I want a line saying so, and that side dimmed afterwards, so that I know I did not misclick.
22. As a person who compacted, I want entries from before the compaction still shown, so that the contents do not lose history to compaction.
23. As a person who rewound, I want the branch thrown away to leave the contents after the next submit, so that the contents reflect only the current branch.
24. As a person resuming a long session, I want the contents to match that session and to jump to early turns never drawn.
25. As a person with several sessions open, I want each terminal to show only its own session, so that they do not mix.
26. As a person also using `/diff` or another docked Pane, I want chat-toc to share the dock by the host's tab rules and not take the focus, so that it does not interrupt the Pane I am using.
27. As a person with a very long session (a 20 MB-class transcript), I want the contents to appear within seconds, scroll and jump without stutter and reach both ends, so that long sessions work too.
28. As a privacy-minded person, I want the plugin to keep my prompt text nowhere, so that it is only a read-only view.
29. As a person after the transcript format changes, I want the contents to tell me "N lines not recognized", so that I know they may be incomplete.
30. As a person deciding whether to install, I want the root README to state the requirements, install, controls and limits clearly, so that I can judge whether it suits me.

## Implementation Decisions

### 1. Plugin form and support matrix

- Plugin root `mods/chat-toc/`, `name` in `plugin.json` is `chat-toc`, first version `0.1.0`. (Finalise the compatibility and acceptance contract; Decide the first release's form and docs)
- Public mods API only; the one exception is reading the current session's transcript file. Host API facts follow the type declarations the `plugin-authoring` skill writes and `~/.claude-code-docs/docs/plugins__mods__*.md`. (Map Notes)
- Promises Claude Code `>=2.1.287`. Every primitive used is on 2.1.287 with the same fields as 2.1.295; 2.1.295's new `ui.notify`, `ui.selection`, `ui.fault`, `prompt.*` and `AssistantMessage.isSummary` are not used. The plugin manifest has no field for the host's minimum version, so there is no runtime version check, only the README's statement. (Check the key APIs on Claude Code 2.1.287; Finalise the compatibility and acceptance contract)
- Note for the implementation: the `command.run` matcher is `{ command: 'chat-toc' }`, not `{ name }`; do not name a local variable `h` (it shadows JSX's `h`). (Check the key APIs on 2.1.287; Draw the three Layouts with label-only Buttons)

### 2. Pane lifecycle

- **Opening by itself** happens at `session.start` (start, hot reload) and at `classic.SessionStart` with `source` `clear` or `resume` (`session.start` does not fire on `/clear`). It opens only when all three hold: `viewport.isFullscreen` is true; the person has not closed it this session; `$.ui.panes()` does not hold the Pane yet (after a hot reload the Pane stays open and `session.start` fires again). (Check the docked Pane's lifecycle and placement rules; Decide how to share the dock with other Panes)
- **Opening by itself checks nothing**: at every start the Pane is opened unless the person closed it in this session or it is open already; no wait for the layout, no status line note. The host still places an unasked Pane only from 144 columns (110 once asked); below that it waits undrawn until the terminal widens or the person runs `/chat-toc`. Whatever placement the host gives, `dock` or `inline`, is kept: chat-toc never closes its own Pane. This replaces the earlier dock-only rules and CT-COMPAT-003's withdraw behaviour. (Changed by the user, 2026-10-14)
- **Closing**: no `closeOnEscape`. Only a `ui.close` with `e.id` this Pane and `origin.kind === 'person'` marks "closed for this session" in `$.state`; however other Panes close, the mark is left alone. The host resets `$.state` on `/clear` and `/resume`, so it opens by itself again afterwards, which the user accepted. (Check the docked Pane's lifecycle and placement rules; Prototype the docked TOC Pane's look and interaction; Decide how to share the dock with other Panes)
- **`/chat-toc`**: no arguments, registered with `immediate: true`. A closed Pane opens; an open one (in a front or back tab) comes to the front with `focus: true`. It never closes the Pane; ✕ is the only way to close. Opening an id already open without a tab switch falls back to focusing only. `focus` works only with an empty prompt. (Decide the Layout switch's entry and default; Check the docked Pane's lifecycle and placement rules)
- **Width**: asks for `columns: 44` (from the prototype; confirmed by the user, 2026-10-10); a width the person set wins. 36–56 columns must all read well. (Prototype the docked TOC Pane's look and interaction)
- **Sharing the dock with other Panes**: fully by the host's tab rules: a newly opened Pane is always in front, chat-toc's own opening included; when another Pane pushes chat-toc back, or brings it forward on closing, chat-toc does nothing, takes nothing back with `focus` and gives no notice. A back tab's Pane render hook is not called, while the data layer updates as usual; if the Current position changed while chat-toc was not in front (`isShown === false` in `$.ui.panes()`), the follow pause is cancelled and the first frame back in front follows. (Decide how to share the dock with other Panes, for CT-COEX-001)

### 3. Reading the transcript

- **Path**: from the classic events' `transcript_path`. A new session's file does not exist before the first message; that is a normal state, not a read failure. (Check the key APIs on 2.1.287)
- **How it reads**: the first read of a file up to 4 MiB uses `$.fs.read`. Otherwise `$.process.run` reads 4,000,000 B chunks from a byte offset:
  - macOS/Linux: `sh -c '{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$3"; } < "$2"'` (`tail -c +N` is too slow on macOS);
  - Windows: the built-in Windows PowerShell 5.1, reading by offset with `[IO.File]` and printing base64; chunks of 3,000,000 B instead, since base64 makes the output 4/3 as long and 4,000,000 B encoded would pass `$.process.run`'s 4 MiB stdout limit and be cut (found while implementing ticket 22; confirmed by the user, 2026-10-11).
  - Each chunk is cut at its last newline and the offset moves by the kept part's UTF-8 bytes; a file that got smaller is read again whole. A single row longer than a chunk (no newline in the chunk) is counted as an unrecognized line and skipped.
  (Measure the cost of reading and drawing a long session; Define the Turn group's split and edges)
- **Triggers and throttling**: `session.append` (the main loop only, rows without `agentId`) and `turn.complete` trigger it; one read 300 ms trailing, reads merged while one runs; skipped when `fs.stat`'s size is unchanged; one more check 1.5 s after `turn.complete` to catch the file being written late. No periodic polling. (Measure the cost of reading and drawing a long session)
- **Conversation chain**: from the newest leaf row back along `parentUuid`; at a compaction boundary (`system/compact_boundary`, `parentUuid: null`) along `logicalParentUuid` instead. A branch thrown away by a rewind is not on the chain. Subagents write separate files, which are not read. (Define the Turn group's split and edges)
- **Incremental regrouping**: walking back from the new leaf, reaching the old chain's last row means the file only grew on the current branch, so the old chain is kept and regrouping starts from the last group's opening row; not reaching it (a rewind's new branch, `/clear`) means regrouping the whole file. (Measure the cost of reading and drawing a long session)
- **Failure**: when the file cannot be read or permission is denied, no entry shows and the bottom keeps the reason; no list pieced together from `$.session.messages()` passes for the whole. Unrecognized lines are skipped and the bottom says "N lines not recognized; the contents may be incomplete", N the real count. While the file does not exist, the body is one line, "No conversation in this session yet". (Finalise the compatibility and acceptance contract, CT-DATA-001–003)

### 4. Turn group

- Rows that **open a new group**: `type:user`, not `isMeta`, `isCompactSummary` or a tool_result, and one of:
  - text or images with `origin.kind: "human"` (`promptSource` `typed`, `queued` or `suggestion_accepted`);
  - a slash command row (with `<command-name>`; a prompt-type command carries `origin: human`, a local command's origin is null);
  - `<bash-input>` (`!cmd`).
  Also, a `type: system, subtype: local_command` row with `<command-name>` opens a group, and its output rows join it. (Define the Turn group's split and edges; Prototype the docked TOC Pane's look and interaction)
- **Joining the current group, opening none**: task-notification, `<local-command-stdout|caveat>`, `<bash-stdout>`, `[Request interrupted by user…]`, the compaction summary, hooks and reminders (isMeta). So a queued submission is a group of its own, while background task notifications and agent work started by `/loop` join the group before them.
- **User input text**: a slash command reads back as `/name args`; a `!` row shows `!cmd`; plain text loses code blocks, images, Markdown marks and `<pasted_content>` tags, with whitespace collapsed; an input of only images says "(image only)".
- **Time**: the User input row's `timestamp` (UTC ISO, shown in local time). Beside an entry only `HH:MM` (Card: at the right end of the user side's first line; Compact and Timeline: in the left column); the day goes in the day's rule: "Oct 9", today "Today · Oct 9", another year's with the year. When it cannot be read, nothing shows and no day's rule is set off; nothing is invented. (Ticket 35's redesign)
- **Steps**: the number of `tool_use` blocks in the group's main-loop assistant rows. Parallel calls count one each, one subagent call counts 1, thinking and text in between do not count, 0 shows nothing.
- **Last text**: the text blocks after the group's last `tool_use`; several blocks of one `message.id` join into one.
- **The Agent side's state**:
  - normal: "N steps" plus the last text's first 2 lines;
  - no last text: "N steps · No text reply";
  - interrupted (an `[Request interrupted by user` row in the group): "Interrupted · N steps";
  - error (the group's last assistant row carries `isApiErrorMessage`): "Error · N steps"; a single failed tool is not marked;
  - in progress: the last group only, judged from the host's `turn.start` to `turn.complete`, showing "Running · N steps" with the steps counting up live.
- **Groups with only a user side**: a local slash command and a `!cmd` that set no agent work going show only the user side; under the "Agent" View filter the whole group is hidden.
- **Lifecycle**: groups before a compaction still show; after `/clear` the host writes a new file, and the contents empty and rebuild with no dividing line; after a rewind the next submit removes the thrown-away branch's groups (a rewind raises no event, so old entries may remain until that submit, which the user accepted); after resume or fork the contents rebuild along the conversation chain.

### 5. Jump target and jumping

- **Identity**: the `e.requestId` of `ui.render`'s `UserMessage`, `AssistantMessage` and `CommandOutput` sites is the transcript row's `uuid` (unchanged after resume). `ToolGroup` is hooked too (reading only `requestId` and `onScreen`, drawing unchanged). A `requestId` of `"placeholder"` is always ignored. A render hook only draws and may not write `$.state`. (Measure how requestId maps to transcript rows)
- **Matching a `requestId` to a row**, in order: the exact uuid; the uuid without a `collapsed-` prefix; the tool_use id (through `ToolUse` when not collapsed); the first 24 characters (a `ToolGroup` id is sometimes `collapsed-<the uuid's first 24>000000000000`). A jump uses the id the host gave, not the uuid. After a hot reload the host redraws the on-screen rows before the transcript is read, so the map is rebuilt after every transcript read; an incremental read only adds new rows to the prefix table and retries ids not yet resolved. (Prototype the docked TOC Pane's look and interaction; Measure the cost of reading and drawing a long session)
- **Jump targets**: the user side's is the group's opening row; the Agent side's is the row holding the last text. When the Agent side has no last text ("No text reply", in progress with no text yet, interrupted), it jumps to the group's last drawable row (`AssistantMessage` or `ToolGroup`), with candidates and refusals as in the fallback jump; a group with no drawable row at all is treated as refused (confirmed by the user, 2026-10-10). Only the person starts a jump (a click or Enter). `$.ui.scroll({ to: { requestId } })` can reach any row in the host's message list, rows never drawn included; a direct jump uses `block: 'start'`. (Check the transcript row enumeration and jump primitives; Prototype the docked TOC Pane's look and interaction)
- **Fallback jump**: a local command's echo row, a prompt-type command's input row and a `!cmd`'s rows show on screen but have no site to hook. These user sides jump to the nearest drawable row **after** them on the conversation chain (a user prompt, an assistant row with text, a non-empty local command output, a row drawn before), or before them when there is none after, with `block: 'center'` so the original input row stays in sight above the target; on a refusal the next candidate is tried, up to 3. This counts as jumping to that prompt, and the entry looks no different. (Decide how entry sides without a Jump target show and click, revised by the prototype)
- **Refused**: when every candidate is refused (rows compacted before a resume, rows left by a rewind), the Pane's bottom shows one line, "This entry is not in the conversation view now; cannot jump to it", gone at the next jump, a move of the selection or after about 5 seconds (`$.clock`); the side then dims (every line `dimColor`) until the host lists that row again. Nothing dims in advance: with virtualisation and hot reloads, "drawn before or not" does not tell whether a jump works. It states the fact and guesses no cause. (Prototype the docked TOC Pane's look and interaction, revising "Decide how entry sides without a Jump target show and click")

### 6. Current position and following

- **Definition**: the Turn group of the viewport's top row; the last group when the last drawn row is wholly visible (`last === of - 1`); locked on the target group after a successful jump. A row in no group (the compaction summary, a hook note) counts for the nearest group before it; with no group before it, nothing is highlighted. (Decide whether to highlight the current position, revised by the prototype)
- **Computing it**: only the on-screen reports of `UserMessage`, `AssistantMessage`, `CommandOutput`, `ToolGroup`, `ToolUse` and `ToolResult`. A tool call not folded into a group (a file edit's diff, a Write) draws at `ToolUse` and `ToolResult` alone, so without them a view holding only such rows lit nothing (revised 2026-10-14). The fullscreen transcript is virtualised, and an unmounted row does not always report `onScreen: null` again, so:
  - an on-screen record reporting `null` is dropped;
  - drawable rows (site rows and rows drawn before) are kept in conversation order in a sorted array, rebuilt only after a transcript read and when a new row is drawn;
  - the on-screen rows are cut into runs in conversation order: any drawable row not on screen between two rows cuts them apart. Only the run holding the latest report is believed, and its first row taken; whether a row lies between is found by binary search.
  (Prototype the docked TOC Pane's look and interaction; Measure the cost of reading and drawing a long session)
- **Locked after a jump**: redraws caused by a jump come less than 300 ms apart, and the lock holds through them; once the redraws stop, the first change of the viewport unlocks it, and it goes back to the viewport's top. (Prototype the docked TOC Pane's look and interaction)
- **Redrawing the Pane**: the transcript render hook compares the old and new Current position, and only on a real change writes a `$.state` atom with `$.clock.after(0, () => update($, atom, …))`, then `return next(e)` as usual; the Pane's render hook reads the atom. Do not write it in the render hook directly, nor from `Promise.then` (now and then refused), nor `invalidate` unconditionally (it loops on itself). The atom is a value derived in this process and not persisted. (Measure how the Pane redraws with the Current position)
- **The TOC following**: the TOC's scroll position always follows the highlighted group (with the transcript at its bottom, it stays on the newest). Scrolling the TOC by hand, or the Pane being focused, pauses following, silently (the "⏸ Not following" footer note was dropped 2026-10-14: it read as an error and asked nothing of the person); it resumes at the Current position's next change. The plugin scrolls on its own: its `ui.scroll` hook returns `{}` and keeps the offset itself; no `$.ui.scroll({ to: 'end' })` (before 2.1.290 it redraws without end). (Decide whether to highlight the current position; Check the docked Pane's lifecycle and placement rules)
- The highlight and the ↑↓ selection cursor are independent and can sit on different groups.

### 7. Pane look and interaction

- **Structure**, top to bottom (ticket 35's redesign, option C's body with option A's top and footer): the filter row (three View filter Buttons, leaving about 3 columns at the right for the ✕ 2.1.287 draws on the body's first row); the tab rule (`━` under the chosen Button, `suggestion`; `─` elsewhere, `subtle`); the entry list right under it (the blank row there was dropped 2026-10-14); notes under the list when needed (a refused jump, the data source); the footer pinned to the panel's bottom: a `─` row (`subtle`), and under it on the left the number of Turn groups, "N turns" (dim, unchanged by the View filter, paused or not), and on the right the Layout Button. 2.1.287's docked Pane has no title row, so row 0 is the body; on 2.1.295 row 0 is the title row; check the layout on both.
- **View filter**: three `plain` Buttons, the label only the name, `All`, `User`, `Agent`, drawn by the host as `1: All`; the chosen one at full strength, the others `dimColor`, the chosen one marked by the tab rule; hotkeys 1/2/3; "All" by default; redrawn at once on a switch; the choice written to `$.store` and remembered globally across sessions, a value not known reading as "All".
- **Layout**: Card by default. The one entry is a `plain` Button at the footer's right end reading "Layout: Card", "Layout: Compact", "Layout: Timeline" (the one in use, not the next); a click on it, or `l` with the Pane focused, cycles Card → Compact → Timeline → Card. The choice is written to `$.store` at once, and a failed write still switches this time; a value not known reads as Card. A switch anchors on the selected group (with a selection cursor) or the Current position's group, the anchored group stays in the visible window afterwards, and following or pausing stays as it was. No command argument, no `v`. The focus ring's order is the filter Buttons, the entries, the Layout Button.
- **Time rail**: all three Layouts hang entries on a rail. The user side's first line is a node `●` (`inactive`), the Agent side's first line a branch `├╴`, continuation lines and the gaps between groups on one day `│` (all `subtle`); the Current position's group becomes `◉`, `┣╸`, `┃`, in `suggestion` along with the time. An Agent side in progress adds `◐` (`claude`) after the branch. A side without a Jump target hangs on a hollow mark: `○` for the user side, `├┄` for the Agent side (`subtle`), the user side's text dim. Where the day changes (the list's first group included) a row `─ <day> ───` goes before the group, and the gap after the group before it draws no rail.
- **How the three Layouts draw**: each entry is a column `Box`: the day's rule (if any); a row with the time column on the left (Compact and Timeline, 6 columns `HH:MM `) and the rail column (one `Text` per line, 3 columns), 2 more columns `◐ ` when running, and a column of Buttons on the right; the gap between groups. **Every line** of an entry's side is a `plain` Button holding that line's string, all lines of a side sharing one `onPress`; keys `<entry key>` and `<entry key>.<line>`; `hover: { scope: 'e-<entry key>', color: 'suggestion' }`, so the whole side changes colour on hover (the line right under the pointer is still drawn inverse by the host).
  - **Card**: no time column; the user side up to 2 lines, `HH:MM` at the first line's right end (a dim `Text`, 6 columns kept on the first line); the Agent side one run "state · last text", all `dimColor`, up to 2 lines. No head line.
  - **Compact**: one line a side, the time in the time column of the group's first side shown.
  - **Timeline**: up to 2 lines a side, the time as in Compact.
  - The plugin folds and truncates on its own: by terminal cell width (full-width characters take 2), closing punctuation never starts a line (the previous line's last character comes down with it), English words and paths up to 14 characters move down whole, and a fold at a space drops that space; the 2nd line (Compact: the 1st) ends with `…`. Button does not fold for you.
- **Other surfaces**: when `e.surface` is not `terminal` (Desktop, VS Code, mobile), another tree is drawn (ticket 36, from Desktop measurements): a segmented control at the top, whose well and the chosen item's block are an Svg (the block the size of the host's hover box), with the three filters as plain Buttons over it, without hotkeys; the Layout in a `Select` without a label (a plain Button cycling it where there is no Select); where there is `Svg`, a strip over the list, one bar per Turn group, as tall as its steps, the running group coloured, and a line under it with the first group's day and time, `N turns` and the last group's time; past 120 groups a bar stands for several. Entries fold as on the terminal, each line a plain Button (the user side normal, the Agent side dim), and the time, node, branch, rail and running mark on the left are one Svg, its height the lines × 19 px; the gaps between groups and the day's rules are Svgs too. A Box's width and height count cells on Desktop (a column about 8.2 px, a row about 19 px). Desktop refuses the plugin's scrolls of the transcript (`transcript not scrollable here`) and does not report `onScreen`: no highlight, no pause; a press on an entry says "The Claude app cannot jump to the conversation yet" and does not mark that side refused; if the host allows scrolling later, jumps work as usual.
- **Keyboard**: with the Pane focused, ↑↓ move along the host's focus ring, the focus landing on an entry's first-line Button (its key the entry key); Enter is the same as a click; ↑↓ do not skip entries without a Jump target. 1/2/3 switch the View filter and `l` the Layout (hotkeys in a Pane can only hang on a drawn Button, so they work only while focused). The selection cursor is the host's inverse, plainly told apart from the `suggestion` highlight. A plugin cannot bind Tab or the arrow keys. (Decide the Layout switch's entry and default; Draw the three Layouts with label-only Buttons)
- **Long sessions**: continuous scrolling, rendering on demand, no paging. Entries are cached per group (keyed by width, running, steps, state and last text), and the entry table is rebuilt only when the data, width, View filter or Layout change; the highlight and the cursor are laid over at draw time; only the visible window is drawn (a tree draws at most 100,000 characters); a table, not `findIndex`, finds a group's entries. (Measure the cost of reading and drawing a long session)
- **Language** (ticket 37): every word drawn or said follows the system language: Chinese when the first set of `LC_ALL`, `LC_MESSAGES` and `LANG` starts with `zh`, English otherwise. The host has no locale API, so the plugin reads those variables once a load, at the first start event. Both word tables are in `hooks/text.ts`.

### 8. Privacy

- Nothing written to disk, no archive, never online, no consent flow. `$.store` holds only the View filter and the Layout. Prompt text appears only in what the Pane draws, never in `$.store`, the plugin's data folder, logs, error texts or release reports. (Finalise the compatibility and acceptance contract, CT-SEC-001)

### 9. Performance (CT-PERF-001 limits)

On the reference machine (this macOS machine), with two 20 MiB fixtures, many (4432 turns) and heavy (111 turns, large tool results), three runs per version, the p95 (with 3 runs, the largest):

| Item | Limit |
|---|---|
| First listing: the TOC after the host shows the last turn | ≤ 4 s |
| Whole read and regroup when idle | ≤ 1 s |
| Incremental read, each | ≤ 150 ms |
| An appended row to the TOC model update | ≤ 1 s |
| Pane redraw, the plugin's own work | ≤ 16 ms |
| Pane redraw, waiting on the host included | ≤ 100 ms |
| Current position, each computation | ≤ 2 ms; ≤ 5 ms under 3000 stale on-screen records |
| Long session: continuous scrolling, jumps to the first and last groups | must reach, no paging |

These are release evidence, not an SLA for every machine. (Measure the cost of reading and drawing a long session)

### 10. Release and docs

- **Version and evidence**: first version `0.1.0`, written both in `plugin.json` and in the marketplace entry. Evidence goes in `mods/chat-toc/tests/evidence/<version>/`, one folder per version; every version bump reruns the full MUST gate in a new folder, and old folders are not changed; the report records the hash of the commit under test. The folder holds `report.md` (with the visual check's sign-off), `report.json` and `marketplace.md`; both Claude Code versions go in one report, a column each. No CHANGELOG. (Decide the first release's form and docs)
- **Marketplace entry**:

  ```json
  {
    "name": "chat-toc",
    "source": "./mods/chat-toc",
    "description": "A docked table of contents of the current Claude Code session; jump to any turn.",
    "version": "0.1.0",
    "author": { "name": "chat-toc contributors" }
  }
  ```

  No `category`/`tags`.
- **Releasing**: the plugin code may go into main first, but the marketplace entry, the root README table's row and the chat-toc section, and `evidence/0.1.0/` go into **one release commit**, committed last once every MUST passes. No git tag. Before the release, run the CT-COMPAT-002 smoke from a local folder marketplace (both versions); after pushing, run an install-level check from `lkangd/cc-mods` (add, install, version, enabled, the Pane opening) and add the result to `marketplace.md`; withdraw the release commit on failure.
- **Root README**: opens with "each mod is its own plugin; none depends on another or shares code or data, and they can be enabled together"; the table gains `chat-toc | 0.1.0 | Docks the current session's contents beside the conversation; a click jumps back to any turn`; a new chat-toc section, in order: what it does, requirements (`>=2.1.287`, an interactive terminal, fullscreen, a wide enough terminal, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` **not** needed, any OS but tested on macOS only), install (one of two, never both), getting started, controls (a table), what it shows, data and privacy, uninstall (with where the leftover `$.store` file is), known limits (the eight "not promised" items under Out of Scope below, rewritten for users), development (links and the 0.1.0 passing results). In the words on screen, not internal terms like Turn group or Current position.
- **`mods/chat-toc/README.md`**: developer content only: links to the root README and `CONTEXT.md`; the folder layout; loading it locally; how to run `claude plugin test`; cmux PTY acceptance; the evidence folder's conventions; the release checklist (every MUST on both versions → local folder marketplace smoke → visual check sign-off → release commit → GitHub install-level check → withdraw on failure).

## Testing Decisions

1. **Levels and the gate** (Finalise the compatibility and acceptance contract)
   - MUST blocks a release: any scenario that fails, is missing, is skipped or has no traceable evidence stops it. A "stated fallback"'s alternative path is itself a MUST. "Not promised" must be written into the README or the on-screen notes beforehand.
   - Each release runs every MUST on this macOS machine, once on 2.1.287 and once on the current version of the day; full scenarios under `--plugin-dir`, the marketplace only for the CT-COMPAT-002 smoke. The report records the OS and architecture, as a sample only.
   - Scenario IDs are `CT-<group>-NNN`; the full list (COMPAT 001–003, DATA 001–006, TURN 001–005, LIFE 001–006, UI 001–003, JUMP 001–003, POS 001–003, PERF 001, SEC 001, COEX 001) follows "Finalise the compatibility and acceptance contract" §4 and is not repeated here.

2. **Layer one: automated tests (`claude plugin test`)**
   - `claude plugin test` and the `claude-code/testing` test kit fire events, stub host calls and check what is drawn; pure functions use plain `test()` in the same suite. Only the current version must pass.
   - Covered: the group-opening rules (including `system/local_command`, `!cmd` and the rows that open none); taking rows along the conversation chain (compaction boundaries, rewind branches); steps and the last text; the four-step `requestId` → row match; the Current position's run algorithm and binary search; the fallback jump's candidate order; chunk edges (including a half row across a 4 MiB chunk and a row longer than a chunk); incremental and whole regrouping agreeing group by group; `$.store` memory and the fallback for a value not known; truncation and cell widths; the words in both languages.
   - Chunked reads on Linux and Windows: only the command built and the output parsed, checked against a `$.process.run` stand-in.

3. **Layer two: PTY acceptance in the real host (driven by cmux)**
   - Covers opening and closing, the dock threshold and the status line, click and Enter jumps, the highlight lock, `/clear`, compaction, rewind, resume, fork, hot reload, sharing the dock with `/diff`, and performance on 20 MiB fixtures.
   - Synthetic transcripts are opened with `--resume`, calling a model as little as possible; synthetic prompts only, no real conversation content. The fixture generators and pyte drivers in the tickets' `assets/` can be reused.

4. **The consistency oracle: an independent verifier**
   - Works out the expected Turn group sequence straight from the transcript file's conversation chain and compares it with the entries the Pane lists. Lifecycle and branch scenarios are all judged by it, sharing no code with the plugin.

5. **Layer three: a visual check**
   - Only how the three Layouts look, and whether the cyan highlight and the inverse cursor tell apart. Signed in `report.md`; not a MUST.

6. **The release report**
   - Fields: plugin version, Claude Code version, OS, architecture, fixture, scenario ID, expected, actual, result, evidence links; plus the hash of the commit under test. Where it goes and its files: Implementation Decisions §10.

## Out of Scope

**Not in this MVP** (the map's Out of scope):

- A persistent archive, cross-session history, consent to collect.
- An inline placement (above the prompt) as a fallback for opening by itself (except when the person opens it with `/chat-toc` and the host places it inline).
- Desktop, VS Code, JetBrains, mobile and other non-terminal surfaces.
- Subagent (sidechain) content in the TOC.
- cc-switch's search, export and "changes" view at the top.

**Not promised** (written into the README's known limits; Finalise the compatibility and acceptance contract §5 and its later revisions):

1. Claude Code `<2.1.287`: no check, no notice; nor an inline placement outside the fullscreen layout. On Desktop no jumps and no Current position (a host limit, see anthropics/claude-code#100610), how it looks checked by the user in the Claude app; VS Code and mobile drawing covered by element-tree tests only; JetBrains not supported.
2. Linux and Windows are covered only by tests of the commands built, not accepted on real systems; Windows uses only Windows PowerShell 5.1.
3. The transcript file format is unpublished; if the host changes it the contents may show only in part, as CT-DATA-003 says.
4. Jumps into a branch thrown away by a rewind, or to rows compacted before a resume, are not guaranteed.
5. After a rewind and before the next submit, the contents may still show the thrown-away entries.
6. The visual check (how the Layouts look, whether the colours tell apart) does not block a release.
7. No fixed latency SLA for every machine; the CT-PERF limits are release evidence on the reference machine only.
8. The inline form `/chat-toc` opens where it cannot dock: layout, following and highlight not accepted.

## Further Notes

- **Reference implementation**: the official built-in mod `cc-plugin-diff` (anthropics/claude-code@e47cc82 `mods/diff/`) opens by itself, remembers a close, opens by itself only when docked and scrolls on its own, almost the same shape as chat-toc. The interaction follows cc-switch's "conversation contents", but not its hidden slash commands, mixed step counts or silent clicks under a filter.
- **Prototypes and probes**: the tickets' prototype mods, driver scripts and fixture generators are under `.scratch/chat-toc/assets/`, reusable as PTY acceptance material; the prototype branch `prototype/chat-toc-pane` and the `research/chat-toc-*` branches are not merged.
- **CT-COMPAT-003's revision**: no inline when opening by itself; `/chat-toc` where it cannot dock shows an inline Pane listing the entries; when a docked Pane is made inline by narrowing, the plugin closes it, the status line says why, and it opens by itself again once the condition is back. See the later revisions of "Finalise the compatibility and acceptance contract".
