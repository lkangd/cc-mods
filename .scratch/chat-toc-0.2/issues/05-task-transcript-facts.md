# Read the transcript facts the new features rest on

Type: task
Status: open
Blocked by:

## Question

From real local transcripts (read only, nothing quoted in tracked files but field names and counts) and the host, on 2.1.287 and 2.1.295, find:

- **Compactions**: how a compaction boundary row looks (auto and `/compact`), where it falls relative to Turn groups (inside one, between two), the summary row after it, and how many a long session holds.
- **Tokens**: where `usage` sits on assistant rows; how a streamed reply repeats one `message.id` over several rows, and how to count each request once; whether subagent usage reaches the main file; what a turn's total would honestly be (input, output, cache read, cache write).
- **Duration**: whether a Turn group's first and last row timestamps give a duration that matches `turn.complete`'s `durationMs`, and what breaks it (interruption, a turn spanning a compaction, queued prompts).
- **Files**: which tools carry a file path in their input (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Read`, others), how it is spelled (absolute, relative), and whether Bash commands should count.
- **Context use**: what `$.session.usage()` returns on 2.1.287 and 2.1.295 (`context.percent`, when it is absent), and when it changes (`session.measure`).

Record the facts and any measuring script's path; nothing to decide here.
