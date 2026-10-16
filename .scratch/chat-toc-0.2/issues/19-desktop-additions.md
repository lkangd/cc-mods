# 19: The 0.2 additions on Desktop

**What to build:** Desktop's tree (`hooks/desktop.tsx`) gains a search field, the preview with its Buttons, copy (no Reuse), compaction rules as Svg, the fork line, and the context use on the strip's line.

Spec: [chat-toc 0.2](../spec.md) §8.

**Blocked by:** 14 (Compaction rules and context use on the terminal), 15 (The expanded preview), 16 (Search on the terminal), 17 (Reuse and copy on the terminal)

**Status:** ready-for-agent

- [ ] A native search field under the segmented control, no `f` Button; each change filters; Enter or `show` / `预览` puts the nearest match (the newest, with no Current position) in the preview and keeps the text; the Svg strip draws matches in the accent colour, the rest dim
- [ ] The preview as on the terminal, showing the last entry pressed (the newest group, or newest match, before any press); the rule line, cut line and `← Back` are Buttons, their words without `· p` and `e:`
- [ ] A `Copy` / `复制` Button on each label row; no Reuse, with the switch by `$.session.version()` in place and off for every known version
- [ ] Compaction rules as Svg by the terminal's placement rules; the fork line; the context use on the strip's line only when `usage()` gives a `percent`; no `‹ ›`
- [ ] Element-tree tests for each of these on the `desktop` surface
- [ ] The user looks at it in the Claude app (search, preview incl. whether a tree taller than the pane scrolls, copy, a compaction rule, context use) and the findings are recorded here; not a MUST
- [ ] Root README: Desktop's lines in the controls table and known limits 4 and 5 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
