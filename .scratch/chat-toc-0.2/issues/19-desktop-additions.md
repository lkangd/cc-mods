# 19: The 0.2 additions on Desktop

**What to build:** Desktop's tree (`hooks/desktop.tsx`) gains a search field, the preview with its Buttons, copy (no Reuse), compaction rules as Svg, the fork line, and the context use on the strip's line.

Spec: [chat-toc 0.2](../spec.md) §8.

**Blocked by:** 14 (Compaction rules and context use on the terminal), 15 (The expanded preview), 16 (Search on the terminal), 17 (Reuse and copy on the terminal)

**Status:** ready-for-human

- [x] A native search field under the segmented control, no `f` Button; each change filters; Enter or `show` / `预览` puts the nearest match (the newest, with no Current position) in the preview and keeps the text; the Svg strip draws matches in the accent colour, the rest dim
- [x] The preview as on the terminal, showing the last entry pressed (the newest group, or newest match, before any press); the rule line, cut line and `← Back` are Buttons, their words without `· p` and `e:`
- [x] A `Copy` / `复制` Button on each label row; no Reuse, with the switch by `$.session.version()` in place and off for every known version
- [x] Compaction rules as Svg by the terminal's placement rules; the fork line; the context use on the strip's line only when `usage()` gives a `percent`; no `‹ ›`
- [x] Element-tree tests for each of these on the `desktop` surface
- [ ] The user looks at it in the Claude app (search, preview incl. whether a tree taller than the pane scrolls, copy, a compaction rule, context use) and the findings are recorded here; not a MUST
- [x] Root README: Desktop's lines in the controls table and known limits 4 and 5 of the spec
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

Built on `chat-toc-0.2/19-desktop`; tests in `mods/chat-toc/tests/desktop.test.ts`. What is left is the user's look in the Claude app (not a MUST). Load the branch with `--plugin-dir mods/chat-toc` in Claude Code Desktop, in a session with a few turns, a `/compact` and a turn that edits files, and record here what you see:

- [ ] Search: the field sits under the segmented control and takes a click; each letter narrows the list (Chinese IME too, corrected at the commit); the count shows at its right; the strip's matching bars are orange and the rest dim; Enter and the `预览` / `show` button keep the text and put the newest match in the preview.
- [ ] Preview: below the list, the meta line, `用户` / `Agent` labels, the reply drawn as Markdown, the files line; a click on an entry shows that turn; the `预览` rule Button hides and shows it (kept after a restart).
- [ ] The cut line `↓ 还有 N 行 · 展开` expands the turn in the list's place, `← 返回` returns; whether Desktop scrolls a tree taller than the pane (the expanded view of a long turn), and whether the preview sits at the pane's bottom or right under a short list.
- [ ] Copy: `复制` on each label row reaches the clipboard and reads `已复制` for about 2 seconds; no `填入` anywhere.
- [ ] A compaction rule: a dashed line with `已压缩 HH:MM` after the `/compact` entry, in all three Layouts, light and dark.
- [ ] Context use: whether `上下文已用 N%` follows the count on the strip's line after a response (the app may give no figure: then nothing shows, which is allowed), and whether it fits beside the first and last times.


The user's look in the Claude app (2026-10-17), five findings, filed as tickets 22–24; the spec's §1, §2, §3, §8 and §9 are revised to match:

1. The list does not scroll: its real height is taller than what shows, and the top entries cannot be reached. So Desktop does **not** scroll a tree taller than the pane, as chat-toc draws it now. Ticket 23.
2. The preview does not scroll either, and runs on from the list: the `Preview` rule, the meta line, the `User`/`Agent` parts and `↓ 27 more lines · expand` read as more entries. Tickets 23 (scroll) and 24 (set apart).
3. The head and search rows are untidy: the segmented control is taller than the `Card ⌄` Select; the field and `show` do not line up with the row above, and `show` is not the field's height. Ticket 24.
4. Search needs a one-press clear on both surfaces. The terminal's `✕` (drawn while there is a query) stays as it is; Desktop gains one. Ticket 24.
5. The preview should not show by default: a press on an entry opens it, a `✕` at its top right closes it, on both surfaces. Decided with the user: a click or Enter opens it (and still jumps on the terminal); it stays on the pressed turn; not kept across Pane opens or restarts (`$.store` loses the flag); Enter in the search field (Desktop: `show`) opens it on the match; short rows open it expanded; a turn left out by the filter or the query stays shown. Tickets 22 and 24.

Not looked at yet: copy, a compaction rule, context use. They go with ticket 24's look.
