# chat-toc 0.2

## Destination

Every decision on seven additions to chat-toc is settled, enough to sum up into a 0.2 spec (`.scratch/chat-toc-0.2/spec.md`) and a set of implementation tickets an implementer can take (planning only, no implementation). The seven: search the entries; preview a Turn group's full text without jumping; put an earlier prompt back into the composer or copy it; mark compactions on the rail and show context use; jump to the previous or next turn by a key without focusing the Pane; find the turns that touched a file; show a turn's duration and tokens.

## Notes

- Talk to the user in Chinese; everything tracked in git is in English (`CLAUDE.md`).
- Builds on the MVP: [`../chat-toc/spec.md`](../chat-toc/spec.md) and the closed [chat-toc map](../chat-toc/map.md). The 0.2 spec refers to the MVP spec and does not copy it. Terms go in [`mods/chat-toc/CONTEXT.md`](../../mods/chat-toc/CONTEXT.md).
- Read [`docs/agents/mod-host-gotchas.md`](../../docs/agents/mod-host-gotchas.md) before any probe or PTY run; host API facts follow the `plugin-authoring` types and `~/.claude-code-docs/docs/plugins__mods__*.md`.
- Every feature is specified for both surfaces, the terminal and Desktop; where one does not apply, say so. Acceptance as now: PTY on the terminal, element-tree tests plus the user's look in the Claude app on Desktop.
- Minimum Claude Code stays `>=2.1.287`. A feature that needs a newer API is switched by `$.session.version()` and hidden on older hosts, and the README's "not promised" list says so.
- Standing principles, for all seven: nothing written to disk, no archive; `$.store` holds preferences only, never conversation text or ids; no model calls; no made-up numbers or text; the data comes only from the transcript. Duration and tokens come from the transcript's timestamps and `usage`, shown only when read. Bookmarks are not in this effort.
- Coming back with `--continue`/`--resume` loses nothing: the contents rebuild from the same transcript file. Only `--fork-session` starts a file at the last compaction boundary (see the fork ticket).
- "Find the turns that touched a file" is a match field of search plus a line in the preview, not a feature of its own; "duration and tokens" live in the preview, and whether the Minimap can switch to tokens is decided there.
- The map does not decide release grouping; releases follow the MVP spec §10.

## Decisions so far

<!-- one line per closed ticket -->

- [Find whether a forked session's transcript leads back to its parent](issues/01-research-fork-parent-transcript.md): only through unpublished fields: `/branch` writes `forkedFrom`, `--fork-session` leaves only the undocumented row `session_id` and the boundary's `logicalParentUuid`; the parent may be in another projects folder or deleted; no mods API names it, and parent-only rows have no Jump target.
- [Probe how prompt.fill and ui.copy behave](issues/02-task-probe-fill-and-copy.md): fill works anywhere but under a dialog (dropped, not deferred), needs no press, moves the keyboard to the composer, and never enters bash mode for `!cmd`; on Desktop it answers `isFilled: true` yet sometimes does not show. Copy reaches the clipboard (terminal to 16 MB, Desktop refuses 2 MB); `isCopied: true` proves nothing on the terminal.
- [Probe whether a Button's action can serve as a global key](issues/03-task-probe-button-action-keys.md): yes on the terminal, but only through an action the person binds themselves (a borrowed, unrelated name such as `app:toggleDiffNoiseFilter`; no plugin namespace, no default key, bare keys never), pressed with the composer focused, during a turn and under `/model`, not under a permission prompt; only while the Button is mounted (not a back-tab Pane, not a collapsed band, where the chord's second key leaks into the composer); the press does not say it came from a chord. Desktop not measured.

## Not yet specified

- How hotkeys are shared out: 1/2/3 and `l` exist; search, copy and previous/next turn may add more, and a Pane's hotkeys hang only on drawn Buttons.
- The performance budget for search over a 4432-turn session, and whether its index is built ahead or on demand.
- What each feature looks like on Desktop, where Svg takes no clicks and the transcript cannot be scrolled.
- Which README "not promised" items and `CT-*` acceptance scenarios change or are added.

## Out of scope

<!-- work ruled beyond the destination -->
