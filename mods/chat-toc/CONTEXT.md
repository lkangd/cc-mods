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

**Layout**:
How the Chat TOC draws each Turn group, chosen by the person and kept across sessions: card (a header line and up to two lines per side), compact (one line per side), or timeline (the time in a left gutter beside a rule). It changes the drawing only, never which entries show.
_Avoid_: Theme, variant, style

**Current position**:
The Turn group the person is looking at in the transcript: the one the topmost row in view belongs to, or the last Turn group once the end of the Transcript is fully in view. Right after a jump it is the jumped-to Turn group, until the transcript view next moves. It follows the transcript view, not the person's selection in the Chat TOC.
_Avoid_: Active item, scroll-spy, selection

**Jump target**:
A temporary association from one side of a Turn group to the transcript row a jump scrolls to. The row need not have been drawn yet; it is good while Claude Code still lists it, and a side whose jump Claude Code refuses has no Jump target until the row is listed again. When that side's own row is shown but cannot be targeted, as with a slash command or `!` shell command, its Jump target is the nearest targetable row after it, or before it when none follows.
_Avoid_: Anchor, link
