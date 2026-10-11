# Parallel implementation with subagents

How an orchestrator runs ticket implementers in worktrees here (e.g. `mattpocock-skills:implement-spec`). Measured on the chat-toc run (tickets 17–29): implementers averaged ~200k input tokens per call and the run hit the usage limit four times.

## Shared notes

- Put the notes dir at `.scratch/<feature>/notes/` in the primary checkout (git-ignored, survives the session), one Markdown file per topic. A session scratchpad is lost when the session ends.
- The brief lists each note with the condition for reading it ("before any PTY run: `pty-harness.md`"). Agents read a note when its condition fires, so one ticket's 30k-char harness guide stays out of every other ticket's context.
- When the feature ships, move host and test-kit facts into `docs/agents/mod-host-gotchas.md` and the mod's README; the notes dir is then disposable.

## Briefs for worktree implementers

- Each Bash call is one plain command run from the worktree root with relative paths. The worktree isolation guard refuses `cd … ;` chains, pipes into git and runtime-computed arguments it cannot read.
- Before reporting done, run `mods/<mod>/scripts/verify-startup.sh`.
- Point at `docs/agents/mod-host-gotchas.md` before mod code is written.

## Pacing

- Run at most two implementers at a time. A third and fourth spend quota faster than they shorten the critical path.
- A decision only the person can make goes in one AskUserQuestion when it comes up, rather than a reminder line in every progress message.
