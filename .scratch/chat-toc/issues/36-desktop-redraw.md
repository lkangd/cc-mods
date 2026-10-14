# 36: Redraw the desktop from what it can really do

**What to build:** Ticket 35's desktop, seen on a real machine in the Claude app, is far from the option C design image (one grey native button per side, single-line truncation, no rail, a big minimap, hotkey badges, a false "Not following"). Redraw the desktop from the abilities measured on Desktop on 2026-10-14 with a trial plugin (`.scratch/chat-toc/prototypes/desktop-click-probe/`).

**Blocked by:** none

**Status:** done

## Host behaviour measured on a real machine (Claude app, 2026-10-14)

- A `plain` Button on the desktop is drawn as one line of plain text, with no button frame; it changes colour on hover; fast repeated clicks each count. It honours only `dimColor`; `bold`, `color` and line breaks in its children are ignored; when too wide it is truncated with an ellipsis. A non-`plain` Button is a grey native button, and `hotkey` is drawn as a badge.
- A Markdown link with `onLinkPress` hands the click to the plugin, but it is drawn as an accent-coloured link, and the second of two quick clicks is swallowed as a double click.
- Svg is drawn by `width`/`height` (CSS px); with no width it is scaled to the slot width by the mark width. Clicks on the picture do not reach the plugin; an absolutely positioned Button laid over the picture covers only its own small area.
- A Box's `width`/`height` unit is the cell: one column is about 8.2 px and one row about 19 px (at `bodyColumns` 78 the content width is about 642 px, at 48 about 398 px). A box with `borderStyle` always spans the whole row.
- A message's `ui.render` (`UserMessage`) comes only once on the desktop, when it is drawn, and `onScreen` stays `null`; scrolling the conversation does not trigger it again: the desktop cannot get the conversation's visible range, so there is no Current position.
- `prefers-color-scheme` in an Svg follows the app's dark mode.
- `$.ui.scroll` on the transcript is always refused: `deny: transcript not scrollable here` (the official issue anthropics/claude-code#100610 exists; on 2026-10-14 a reproduction on 2.1.295 and chat-toc's use case were added). The desktop cannot jump.
- On hover the host draws a backing frame behind the Button under the pointer, which the plugin cannot turn off.

## Decisions made (2026-10-14, the user)

- Click one, jump to that one, no compromise: each line of an entry is a `plain` Button, the User side in the normal colour and the Agent side dimmed, and a click on any line jumps to that side.
- Time, node, rail, branch and running mark are drawn as one Svg on the left of each entry, its height being the number of lines × 19 px, and adjacent entries stack into one continuous rail; the blank line between groups and the date separator are Svgs as well.
- The top filter uses the design image's segmented control: the base (the slot and the selected item's light block) is an Svg, with three `plain` Buttons laid over it, and the selected one not dimmed; no `hotkey` (the desktop would draw a badge). The Layout dropdown has no "Layout" label.
- The minimap has one vertical bar per turn (grey; Claude colour when running), with one line below it carrying the first turn's date and time, `N turns` and the last turn's time; `N turns` is no longer put alone at the bottom.
- The desktop has no Current position: no highlight and no "Not following".
- The desktop cannot jump (a host limit), and the user chose option 2: show the contents as usual; a press on an entry first requests the scroll as usual, and when the host answers `transcript not scrollable here`, the bottom notes "The Claude app cannot jump to the conversation yet", does not record the side as refused and does not dim it; when the host opens this up later, jumps work with no code change.
- The selected filter item's block shrinks to the size and shape of the host's hover frame (option A), so that it coincides with it on hover.
- Width is worked out as `bodyColumns × 8.2 px`.

## Steps

- [x] Segmented control, Layout dropdown
- [x] Minimap and the label line
- [x] Entries: the Svg rail on the left + one plain Button per line; date separators, blank lines between groups
- [x] The desktop does not pause and does not highlight
- [x] The notice when scrolling is not possible (not recorded as refused)
- [x] The user checks by eye in the Claude app on a real machine (screenshots back and forth, three Layouts)
- [x] Add to the official feature request (a comment and a +1 on #100610)

## Comments

- 2026-10-14 implementation: `desktop.tsx` rewritten, `minimap.ts` gains the label line and `stripLabels`, `jump.ts` gains `isUnscrollable` / `UNSCROLLABLE_TEXT`, and `register.tsx` only shows a notice on a Desktop refusal; the no-longer-used `sideText` is deleted. `claude plugin test` passed 273, and tsc is clean. The user looked at the three Layouts and the notice in the Claude app using a workspace copy (the local directory marketplace `toc-probe-local`). Also restored the line about prompt-history's requirements in the root README that ticket 35 had changed by mistake.
