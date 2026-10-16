# Chat TOC

Chat TOC is a table of contents of the current session's conversation, docked to the right of the transcript, so people can see the shape of a long session and jump back to any point in it. It draws only what the session's transcript holds and keeps no archive.

## Language

**Transcript**:
The current session's conversation as Claude Code records it for that session, following only the branch the conversation is on now. A rewound-away branch, another session, and a cleared session's earlier conversation are not part of it; text a compaction summarized away still is.
_Avoid_: screen, scrollback, history

**Chat TOC**:
The docked, scrollable table of contents of the Transcript, in Transcript order. It shows nothing the Transcript does not hold.
_Avoid_: Prompt Trail, history, timeline

**Turn group**:
One entry of the Chat TOC: a User input together with what the main agent did from it until the next User input, which is its Agent reply. A User input the agent never acted on, such as a local slash command or a `!` shell command, forms a Turn group with no Agent reply.
_Avoid_: Card, message, round

**User input**:
Anything the person typed into the composer and submitted with Enter that the Transcript records, slash commands and `!` shell commands included. Background notifications, command output, interruptions and injected reminders are not User inputs.
_Avoid_: Prompt entry, user message

**Agent reply**:
The last text the main agent wrote in a Turn group after its last tool call, together with the count of steps: the tool calls the main agent made in that Turn group, a subagent counting as one. Thinking and intermediate text are not steps, and none of them is shown as an entry.
_Avoid_: Assistant message, output

**View filter**:
Which side of each Turn group the Chat TOC shows: all, User inputs only, or Agent replies only.
_Avoid_: Mode, tab

**Search**:
Narrowing the Chat TOC to the Turn groups that match a query the person typed: each of its words found, in any case, somewhere in the User input as typed, the Agent reply's last text, or the paths of the files the Turn group's tool calls read or changed, looking only at the sides the View filter shows. A Turn group it keeps is a match.
_Avoid_: Filter, find

**Preview**:
The region at the bottom of the Chat TOC that shows one Turn group whole without jumping: its User input as typed, the Agent reply's last text, the files its tool calls changed or read, and, when the Transcript states them, its duration and the main agent's output tokens. It shows the selected Turn group while the Chat TOC holds the keys, otherwise the Current position's, or where there is none, the last one pressed. Expanded, it takes the list's place until the person goes back.
_Avoid_: Detail, peek, inspector

**Reuse**:
Putting an earlier User input back into the composer as typed, as a draft the person edits and sends themselves, never sent for them; a draft already there is kept.
_Avoid_: Resend, replay, retry, edit

**Layout**:
How the Chat TOC draws each Turn group, chosen by the person and kept across sessions: card (up to two lines per side, the time at the right of the User input), compact (one line per side, the time in a left column), or timeline (up to two lines per side, the time in a left column). Every Layout hangs the sides on a rail, a day's rule where the day changes. It changes the drawing only, never which entries show.
_Avoid_: Theme, variant, style

**Minimap**:
The row at the top of the Chat TOC on the terminal that draws the whole Transcript at a glance: one cell per Turn group, as tall as the steps its Agent reply took, the Current position's cell the one not dimmed. Pressing a cell jumps to its Turn group as pressing that group's entry does; when a cell stands for several Turn groups, to the first of them that has a Jump target. It always shows every Turn group, whatever the View filter, and is left out when there is too little room or fewer than two Turn groups.
_Avoid_: Chart, sparkline, strip, graph

**Current position**:
The Turn group the person is looking at in the transcript: the one the topmost row in view belongs to, or the last Turn group once the end of the Transcript is fully in view. Right after a jump it is the jumped-to Turn group, until the transcript view next moves. It follows the transcript view, not the person's selection in the Chat TOC.
_Avoid_: Active item, scroll-spy, selection

**Jump target**:
A temporary association from one side of a Turn group to the transcript row a jump scrolls to. The row need not have been drawn yet; it is good while Claude Code still lists it, and a side whose jump Claude Code refuses has no Jump target until the row is listed again. When that side's own row is shown but cannot be targeted, as with a slash command or `!` shell command, its Jump target is the nearest targetable row after it, or before it when none follows. A side known beforehand to have no Jump target, as a turn compacted away before the session was resumed, hangs on a hollow mark like a refused one.
_Avoid_: Anchor, link
