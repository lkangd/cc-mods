---
id: band-trackpad-at-bottom-host-limit
status: open
severity: minor
found: 2026-09-24
source: Issue 21 PTY acceptance
target: Prompt Trail band (`AbovePrompt`), Claude Code 2.1.281
---

# At its bottom the band gets no trackpad scrolling

## Problem

The host hands the band's scrolling to the plugin (`ui.scroll`) only while the band's tree is
taller than `maxRows`. While it is, the host always draws a dim `n more` row under the window,
counting how many rows the tree has beyond the window wherever the window rests. The plugin can
neither hide that row nor change its text.

The band therefore draws one blank row for each row below its view, so `n more` counts real rows.
At the bottom there is nothing below, so the tree fits: no `n more`, but no `ui.scroll` either. A
trackpad swipe up from the bottom, where the band opens, does nothing, and the arrows fall back to
the host's own ring walk, which wraps at both ends. The band covers this with a dim "↑ 点此向上浏览 ·
底部不响应触控板" press on the title row, and takes the host's ring moves that would leave the rows
shown (`ui.focus` in `mods/prompt-trail/hooks/register.tsx`).

The person rejected the alternatives: a fixed `2 more` that counts padding (misleading), and
letting the engine scroll the whole tree (the title scrolls away and the count stays anyway).

## Why deferred

Host limitation. Checked in 2.1.281: `AbovePrompt` props and the render result have no option for
the `n more` row. `Box` has no `position: absolute` to paint over it. A `Client` gets pointer
down/move/up/enter/leave but no wheel. Moving the padding above the title with the window pinned
to its end (probe, PTY) still drew `2 more`.

## Suggested fix approach

Ask the host (function hooks are early access) for either of:
- an `AbovePrompt` option to hide or relabel `n more`, or
- `ui.scroll` for wheel, trackpad and scroll keys over a band whose tree fits.

With either, draw the blank rows at the bottom too (or stop drawing them). Then drop the
`fits` state, the title-row press (`EARLIER_HINT_KEY`), and the `ui.focus` interceptions that
exist only for the fitting tree.

## Recommended tools

- `grep -n "fits\|EARLIER_HINT_KEY\|below" mods/prompt-trail/hooks/register.tsx`
- Regenerate `mods/prompt-trail/.claude/types/claude-code.d.ts` with `/plugin-types` on a new
  build and read `AbovePrompt.maxRows`, `SiteScroll` and `UiScrollInput`.
- `tests/long_timeline.test.tsx`: the "at the bottom" tests describe today's workaround.
