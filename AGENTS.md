## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the multi-context map in `CONTEXT-MAP.md`. See `docs/agents/domain.md`.

## Handoffs

Handoff documents go in `docs/handoffs/` (git-ignored, local only), never in the OS temp directory. This applies to the `mattpocock-skills:handoff` skill too, which otherwise defaults to the temp directory: override it. Name files `<yyyymmdd>-<topic>.md`. Do not commit them.
