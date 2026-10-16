# cc-mods

A collection of Claude Code mods. Each mod is its own plugin under `mods/<mod name>/`: none depends on another or shares code or data, they can be enabled together, and each has its own install and usage notes.

## Mods

| Mod | Version | What it does |
| --- | --- | --- |
| [chat-toc](#chat-toc) | 0.1.3 | Docks the current session's contents beside the conversation; a click jumps back to any turn |

For a new mod, add a row to the table above and a section at the same level as chat-toc's below.

---

## chat-toc

In Claude Code's fullscreen terminal, chat-toc docks the current session's contents to the right of the transcript: one entry per turn of the conversation, and a click jumps back to that turn.

### Requirements

- Claude Code `>= 2.1.287` (see `claude --version`)
- An interactive terminal. In Claude Code Desktop (and VS Code and mobile) the contents show, but a click cannot jump: the Claude app does not let plugins scroll the conversation yet (see [Known limits](#known-limits)). JetBrains is not supported
- The fullscreen layout: run `/tui fullscreen` to switch
- A wide enough terminal: whether the pane can dock is Claude Code's call. Measured on 2.1.287 and 2.1.295: it docks by itself from 144 columns, and when opened with `/chat-toc` from 110 columns
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is **not** needed
- Any operating system, but tested on macOS only (see [Known limits](#known-limits))

When a requirement is not met, the contents never show in the wrong place; the status line says why and what to do (see [Getting started](#getting-started)).

### Install

Pick one of the two, never both:

Marketplace (recommended):

```sh
claude plugin marketplace add lkangd/cc-mods
claude plugin install chat-toc@cc-mods
```

After installing, `claude plugin list` shows `chat-toc@cc-mods` as enabled.

Local load (for development):

```sh
claude --plugin-dir /path/to/cc-mods/mods/chat-toc
```

### Getting started

1. Start Claude Code in the fullscreen layout. The contents dock on the right by themselves, titled "Contents" (2.1.287 draws no title row).
2. If the contents do not show, read the status line under the prompt:

   | Status line | What it means and what to do |
   | --- | --- |
   | `⚠ chat-toc: The contents dock on the right only in the fullscreen layout; run /tui fullscreen to switch` | The layout is not fullscreen. Run `/tui fullscreen` |
   | `⚠ chat-toc: The terminal is too narrow to dock the contents; widen it and they appear` | The terminal is not wide enough. Widen it and the contents dock by themselves; the line goes away |
   | `⚠ chat-toc: The terminal is too narrow, so the contents sit above the prompt; widen it to dock them on the right` | You opened the contents with `/chat-toc` in a narrow terminal, so they sit above the prompt. Widen the terminal and they dock |
   | `⚠ chat-toc: Outside the fullscreen layout the contents sit above the prompt; run /tui fullscreen to dock them on the right` | You opened the contents with `/chat-toc` outside the fullscreen layout |

3. Click any entry to jump back to that turn in the conversation. After closing the pane with ✕, `/chat-toc` opens it again at any time, with the focus in it.

### Controls

| Control | What it does |
| --- | --- |
| Click your input in an entry (from the `●` line) | Jumps to that input, at the top of the screen. A slash command or `!` command jumps to the row right after it and keeps the input row in sight |
| Click the Agent's reply in an entry (from the `├╴` line) | Jumps to the turn's last text reply; without one, to the last thing the turn drew |
| Click a block in the row of blocks under the filters | Jumps to that turn, as clicking its entry does. One block per turn, as tall as the steps the Agent took; with more turns than the pane is wide, a block stands for several and jumps to the first of them. The block of the turn you are on is the bright one. Hidden with fewer than two turns or in a very short pane |
| Wheel over the contents | Scrolls the contents by entries and pauses following |
| `Ctrl+X` then `Tab`; or `/chat-toc` with an empty prompt | Moves the focus into the contents |
| `↑` `↓` (focus in the contents) | Moves the selection one at a time (your input and the Agent's reply count one each); the selected line is inverse, and the preview at the bottom shows the selected turn. Entries that cannot be jumped to can be selected too |
| `Enter` (focus in the contents) | Same as clicking the selected side |
| `1` `2` `3`, or click `1: All` `2: User` `3: Agent` at the top | Shows all / only your input / only the Agent's replies. A thick line in the highlight colour marks the chosen one. Remembered across sessions |
| `l`, or click the "Layout: Card" button at the footer's right end | Cycles the layout Card → Compact → Timeline; the button names the one in use. Remembered across sessions |
| `p`, or click `p: Preview` on the preview's top line | Shows the preview or folds it to that one line. Remembered across sessions |
| `e`, or click `e: expand` on the preview's last line | Expands the preview over the list and the row of blocks: the turn whole, scrolled with the wheel, `PgUp` `PgDn` or `↑` `↓`. `e` again, or `e: ← Back` at its top, returns to the list; so do `Esc` and closing the contents |
| `Esc` (focus in the contents) | Moves the focus back to the prompt; the contents stay open |
| `Ctrl+X` then `←` / `→` | Widens / narrows the contents (a Claude Code feature). A width you set wins |
| Click ✕ | Closes the contents; they do not open by themselves again this session. A new session (including after `/clear` or `/resume`) opens them again |
| `/chat-toc` | Opens the contents when closed, brings them to the front when open (also when another pane pushed them back); either way moves the focus into them (with an empty prompt). It never closes them |

The hotkeys `1` `2` `3` `l` `p` `e` work only with the focus in the contents; `e` only while the preview is cut or expanded.

### What it shows

- **Entries**: each entry is one turn of the conversation: one input of yours, plus what the Agent did from that input to your next one. In conversation order. A slash command and a `!` command are each an entry of their own; the same prompt submitted several times is several entries; a prompt queued while the Agent worked is an entry of its own too. Background task notifications and work started by `/loop` join the entry before them. Nothing from inside a subagent shows.
- **Time rail**: entries hang on a vertical line on the left. Your input starts at a node `●`, the Agent's reply at a branch `├╴`; the lines after them and the gaps between groups on the same day sit against the line `│`.
- **Your input**: its first 2 lines, with `…` at the end when it does not fit. A slash command shows as `/command args`, a `!` command as `!command`; code blocks, Markdown marks and paste markers are left out, and an input of only images shows "(image only)". When a line folds, commas and full stops never start a line, and English words and file paths up to 14 characters move down whole.
- **The Agent's reply**: dim text, first the state and the steps, then the last text reply, at most 2 lines:
  - `N steps · reply…`: the steps are how many tools the main Agent called this turn; parallel calls count one each, a subagent counts 1, thinking and text in between do not count. With 0 steps there is no count, only the reply.
  - `N steps · No text reply`: the turn ended without a text reply.
  - `Interrupted · N steps`: you interrupted the turn.
  - `Error · N steps · error message`: the turn ended in an API error. A single failed tool call is not an error.
  - `Running · N steps`: the Agent is still working on the last turn; an orange `◐` sits by the branch and the steps count up live.
  - A local slash command, or a `!` command that set no Agent work going, has only your input. Under "Agent" those entries are hidden.
- **Time and day**: times come from the transcript, in this machine's time zone. The card layout writes the time at the right end of your input's first line (`HH:MM`); Compact and Timeline write it in a column left of the line, on each turn's first row. Where the day changes (including at the top of the list) there is a line `─ Oct 9 ───`; today reads `Today · Oct 13`, and another year's day carries the year. A turn whose time cannot be read gets no time and no day line; nothing is guessed.
- **Compactions**: where the conversation was compacted, a dashed line crosses the list, `╌ Compacted 14:32 ╌╌╌` for `/compact` and `╌ Auto-compacted 14:32 ╌╌╌` for an automatic compaction, with the time it happened (no token figures). It never cuts a turn: after `/compact` it goes below the `/compact` entry; an automatic compaction goes before the turn it happened at the submit of, and after the turn it happened in the middle of (below a running turn, at the end of the list, until the next turn comes) or between two turns. It breaks the time rail as the day line does, in every layout, and shows under every view choice, between the turns shown; several between two turns shown fold into one line with a count and the last one's time, `╌ Compacted ×3 · 14:32 ╌`. Where a day line meets it, the day line comes first. Entries above it are not dimmed.
- **Earlier turns elsewhere**: when this session's file starts at a compaction whose earlier turns it does not hold (a session forked with `--fork-session`, or a resumed file compacted before any turn of its own), a dim line at the top of the list says "Earlier turns are not in this session's file". The earlier turns are not read from anywhere else.
- **Three layouts**: Card (the default) draws up to 2 lines a side, the time at the right end; Compact draws one line a side, the time in the left column; Timeline draws up to 2 lines a side, the time in the left column. The layout changes only how entries are drawn, not which show. On a switch, the selected entry (or, with no selection, the turn being viewed) stays in view.
- **Highlight**: marks the turn you are viewing in the transcript (the turn holding the top line of the screen; the last turn when the conversation's end shows whole): the node becomes `◉`, the branch `┣╸`, the turn's line thickens to `┃`, all in the highlight colour along with the time. The highlight and the dim text follow Claude Code's theme (`/theme`); the highlight is the colour of a selected item in Claude Code's menus, and the contents follow a theme change at once. After a click jump, the highlight stays on the turn jumped to until you scroll the transcript again. A `!` command's turn (and, in a session opened with `--resume`, a local slash command's turn) has no row in the transcript to locate: when only such a row shows at the top of the screen, the highlight falls on the next turn. The highlight and the `↑` `↓` selection (inverse) are independent and can sit on different entries. With the pointer over an entry, that side's text turns the highlight colour and the line right under the pointer is inverse.
- **Top and footer**: the top holds the three view choices, a line under them marking the chosen one, then a blank line before the list. The footer sits at the bottom of the contents, under the preview: a thin line, under it on the left the number of turns ("12 turns", the same under every view choice) and on the right the layout button.
- **Context use**: how full the context window was at the last response, as Claude Code reports it, follows the turn count in the footer: "38 turns · context 62% used"; when the contents are narrow it shortens to "38 turns · 62% used" and then leaves it out. The line above the prompt that stands in for closed contents adds "· context 62% used" after its counts. It is read when the session starts and after every response, always dim, never coloured, with nothing said near the limit (Claude Code warns before compacting by itself). Until the first response, and from a compaction until the next response, Claude Code has no figure, so none shows.
- **Preview**: a region at the bottom, above the footer, shows one turn whole without jumping: the turn selected with `↑` `↓` while the focus is in the contents, otherwise the turn you are viewing (the highlighted one), or the newest. Its top line reads `p: Preview`; under it:
  - a dim line of what the transcript states about the turn: `Oct 16 14:32 · 12 steps · 3m 20s · 3.5k out`. The date always shows, today too; a state (`Running`, `Interrupted`, `Error`) only when the turn did not finish. The duration is how long the model worked (`45s`, `3m 20s`, `1h 5m`, `<1s`), summed over the turn's model turns, and shows only when the transcript records it; the tokens are what the main Agent wrote (`out`), each response counted once, and show only when the transcript records them. Nothing is estimated: a figure the transcript does not state is left out. When the line is too wide for the contents, its last figures are left out whole;
  - `User`, then your input as you typed it: code blocks and pasted text kept, a slash command as `/command args`, a `!` command as `!command`;
  - `Agent`, then the Agent's last text reply drawn as Markdown; a running turn shows the latest text written so far;
  - the files the turn touched: `changed register.tsx, pane.tsx +1 · read 5`. Changed are files edited or written by the Agent and files a shell command changed as Claude Code recorded it; read are files the Agent read; a file both read and changed counts as changed. Paths are relative to the session's folder when inside it, else full with `~` for your home folder.
  The preview's height depends on the contents' height, not on the turn (about 40% of the rows below the top, 4 to 14 rows), so the list does not jump as the selection moves. What does not fit is cut, the files line first, then the Agent's reply, then your input; the last line then reads `↓ 12 more lines · e: expand`. When rows run short, the row of blocks goes first, then the preview shrinks to 4 rows, then it folds to `p: Preview (no room)`; the list keeps at least 8 rows.
  Expanded (`e`), the preview takes the place of the list and the row of blocks, under the view choices and above the footer, and draws the turn uncut: the files one per line under `Changed` and `Read`. It keeps that turn while you scroll the transcript or new turns arrive, and a running turn still grows in it. A very long input or reply is cut there, about 60,000 characters for the two together, with a line after the cut part: `… 12,345 more characters not shown · c: Copy` (`a: Copy` after the reply).
- **Following and pausing**: the contents scroll to the highlighted turn by themselves; with the transcript at its end, they stay on the newest entry. Scrolling the contents by hand, or the focus being in them, pauses following; following resumes the next time the highlight moves to another turn (you scroll the transcript to another turn, or click to jump). If the highlight changed while another pane pushed the contents back, they catch up as soon as they are in front again.
- **Entries that cannot be jumped to**: in a session opened with `--resume` (or `/resume` in a session), the turns compacted away before the resume hang on hollow marks from the start (your input on `○` with dim text, the Agent's reply on `├┄`). They can still be selected and clicked; when a jump cannot go through, a yellow line (the theme's warning colour) starting with ⚠ shows under the list, flashing inverse 3 times first: for a compacted turn "This entry was compacted before the session resumed; cannot jump to it", otherwise "This entry is not in the conversation view now; cannot jump to it". The line goes at the next jump, a move of the selection or after about 5 seconds; the side that could not be jumped to then hangs on a hollow mark until Claude Code shows that row again.
- **Notes under the list**:
  - "N lines not recognized; the contents may be incomplete": N lines of the transcript could not be read (for instance Claude Code changed its format); the rest of the contents still show.
  - "No permission to read this session's transcript; nothing to show" or "Cannot read this session's transcript; nothing to show": the contents then show no entries at all rather than a patchy list.
- **Empty contents**: a new session shows "No conversation in this session yet" before the first message; a session opened with `--fork-session` or `--resume` whose file is not written yet shows "This session has no transcript file yet; the contents appear after the first message".
- **When the session changes**:
  - `/clear`: the contents empty and rebuild with the new session (its first entry is the `/clear` itself), with no dividing line.
  - Compaction: earlier entries still show, with a compaction line where it happened; the context use leaves the footer until the next response.
  - Rewind (including Esc Esc): once the conversation is restored, the part thrown away (including the entry rewound to, whose text went back to the prompt) leaves the contents at once, without waiting for the next submit. Quit without submitting after a rewind and resume, and that part comes back with the conversation.
  - `--resume`, `--continue`, `/resume` in a session, `--fork-session`: the contents rebuild from that session and can jump to turns long ago that never showed.
  - Several terminals each show only their own session.
  - Enabling chat-toc in a running session (enable it in `/plugin`, or `claude plugin enable` then `/reload-plugins`): no restart needed; the contents list the conversation so far at once. If this session's transcript cannot be found, they show "The contents appear after the next message".
- **With other docked panes** (such as `/diff`): they share the dock by Claude Code's tab rules. A newly opened pane always comes to the front; when chat-toc is pushed back or brought forward it does nothing and takes no focus.
- **A narrowing terminal**: when the terminal gets so narrow that Claude Code would move the docked contents above the prompt, chat-toc closes them and the status line says "The terminal is too narrow to dock the contents; widen it and they appear"; widen it and they dock again. This does not count as you closing them.
- **Language**: the words follow the system language: Chinese when the first set of `LC_ALL`, `LC_MESSAGES` and `LANG` starts with `zh`, English otherwise. This README quotes the English words.

### Data and privacy

- Reads only the current session's transcript file (the one Claude Code writes itself), taking the rows along the current branch. Past 4 MiB it runs a read-only local `sh` (`dd` with `head`; Windows PowerShell on Windows) to read it in chunks by offset.
- Writes no files, keeps no archive, never goes online, and has no consent flow.
- The plugin's store keeps three preferences only: the view (all / User / Agent), the layout and whether the preview is shown. Prompt text, file paths, durations and token counts are held in memory only and appear only in what the contents draw, never in the store, logs or error messages.

### Uninstall

1. Run `claude plugin uninstall chat-toc@cc-mods` (for a local load, drop `--plugin-dir`).
2. After uninstalling, the three preferences may remain in `~/.claude/plugins/store/chat-toc_*.json` (a marketplace install is `chat-toc_cc-mods-*.json`, a local load `chat-toc_inline-*.json`; with `CLAUDE_CONFIG_DIR` set, under its `plugins/store/`). Delete them by hand if you like; they hold no prompt text either way.

### Known limits

- Below Claude Code `2.1.287` the plugin neither checks nor says anything. Outside the fullscreen layout the contents do not open by themselves.
- In Claude Code Desktop the contents can be read but not jumped from: the Claude app answers every scroll from a plugin with `transcript not scrollable here` and does not tell plugins where the conversation is scrolled, so the current position is not highlighted; a click on an entry says "The Claude app cannot jump to the conversation yet" at the bottom. Followed up in [anthropics/claude-code#100610](https://github.com/anthropics/claude-code/issues/100610). How Desktop looks was checked by eye in the Claude app; VS Code and mobile are covered by element-tree tests only; JetBrains is not supported.
- Accepted for real on macOS only. On Linux and Windows only the commands generated for reading large files were checked, not run on real machines; Windows uses only the built-in Windows PowerShell 5.1.
- The transcript file format is not public. If Claude Code changes it, the contents may show only in part, and the bottom says how many lines could not be read.
- When enabled mid-session, the transcript's location is worked out from Claude Code's unpublished folder naming rule; if the rule changes, the contents wait for your next submit.
- Jumping to rows compacted away before a `--resume` is not guaranteed (with `--resume` they hang on hollow marks from the start); when a jump cannot go through, a note under the list says so and that side hangs on a hollow mark.
- The preview shows no duration in Claude Code Desktop, nor for most interrupted turns: the transcript does not record it there.
- The preview's tokens are the main Agent's output only; what subagents wrote is not counted.
- A very long prompt or reply is cut in the expanded preview (copying takes the whole text).
- A forked session does not show the parent session's turns: a line at the top of the list says earlier turns are not in this session's file.
- Context use in Claude Code Desktop is not promised: it was not measured there, and shows only when the Claude app gives a figure.
- How the three layouts look, and whether the highlight and the inverse selection tell apart, is checked by a person and does not block a release.
- No fixed speed is promised on every machine; the release's performance numbers come from one reference machine (an Apple M1 Pro Mac: on a 20 MB-class long session, the contents show within about 0.7 s after Claude Code shows the last turn, and scrolling and jumping do not stutter).
- Contents opened with `/chat-toc` where they cannot dock, sitting above the prompt: their layouts, following and highlight are not accepted.
- The PTY acceptance runs check the Chinese words; the English words are covered by unit tests only.

### Development

- Local load (without the marketplace): `claude --plugin-dir /path/to/cc-mods/mods/chat-toc`
- Development, tests, PTY acceptance and the release checklist are in [`mods/chat-toc/README.md`](mods/chat-toc/README.md).
- Release evidence: `mods/chat-toc/tests/evidence/0.1.3/` (commit under test 28eefdf). All 37 MUST scenarios ran under `--plugin-dir` on Claude Code 2.1.287 and 2.1.295: 37/37 on both, with no failures, nothing missing and nothing skipped; the local folder marketplace smoke passed on both versions, and the GitHub install-level check after the release is in `marketplace.md`. The visual check of how the three layouts look and whether the colours tell apart awaits sign-off (it does not block a release).
