## Language

Everything tracked in git is written in English: READMEs, docs, tickets and specs under `.scratch/`, the mods' user-facing text, code comments and commit messages. The exceptions are records of what happened, which stay as captured: release evidence under `mods/*/tests/evidence/` and probe captures under `.scratch/*/assets/`. A mod's user-facing text follows the system language, English by default, and its Chinese strings are part of the code. Talk to the user in Chinese. Handoffs in `docs/handoffs/` are local and stay in Chinese.

## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the multi-context map in `CONTEXT-MAP.md`. See `docs/agents/domain.md`.

## Mods

Before writing or debugging mod code or running PTY acceptance, read `docs/agents/mod-host-gotchas.md`. Before dispatching implementer subagents, read `docs/agents/parallel-implementation.md`.

## Handoffs

Handoff documents go in `docs/handoffs/` (git-ignored, local only), never in the OS temp directory. This applies to the `mattpocock-skills:handoff` skill too, which otherwise defaults to the temp directory: override it. Name files `<yyyymmdd>-<topic>.md`. Do not commit them.
