# Decide the previous and next turn keys

Type: grilling
Status: resolved
Blocked by: 03

## Question

How does a person jump to the previous or next Turn group without leaving the composer?

- Which keys, by default bound or left for the person to bind, and how they are told about them.
- What "previous" and "next" step from (the Current position), whether they follow the View filter, and what happens at either end, on an unjumpable group, while the Pane is closed or a back tab.
- The host can press a Pane Button with the Pane unfocused, but only through an existing action the person binds (a borrowed, unrelated name), and only while the Button is mounted: whether that is worth shipping, where the action Buttons live (the Pane, the band, both) given a back-tab Pane and a collapsed band drop the press and leak the chord's second key into the composer, and whether a fallback (a band control, a command) or dropping the feature is better.

## Answer

Decided with the user on 2026-10-16. No new term: the spec says "the previous / next Turn group" (not "step", which counts tool calls).

**Shipped, opt-in, terminal only.** chat-toc ships no default key (it cannot: no action is set aside for plugins, and an unbound action has no key). The person binds two borrowed actions, which the spec names as constants:

- previous Turn group: `app:toggleDiffNoiseFilter`;
- next Turn group: `app:toggleDiffPreSession`.

Both were pressed in the probe (ticket 03), unbound by default, with no engine handler mounted in a normal session. The others were passed over: `pane:next` is taken by the engine with two panes open; `footer:dismiss`, `diff:back` and `permission:toggleDebug` belong to other contexts and are likelier to gain a handler. Desktop: nothing (it refuses the transcript's scroll; `action` is the terminal's only).

**What the README recommends.** A new section with a `keybindings.json` snippet: in `Global`, `meta+k` → `app:toggleDiffNoiseFilter`, `meta+j` → `app:toggleDiffPreSession`, saying why the names do not match, and that macOS terminals need Option sent as Meta. Modified keys, not chords: a chord nothing answers leaks its second key into the composer, a modified key is swallowed. `meta+j` was measured; `meta+k` is checked in acceptance. Nothing in the Pane or the band tells about the binding: no hint, no toast; the drawn `‹ ›` are the visible entry.

**What a press does.**
- It steps from the **Current position**, not the Pane's selection: to the Turn group before or after it, even when the view sits mid-way through the current group. After the jump the Current position is locked on the target, so repeated presses walk group by group.
- It walks only the groups the list shows: the View filter applies (under Agent, groups with only a user side are skipped), and during a search only the matches, like `n` / `N`, without ending the search.
- It jumps to the side the View filter shows: the user side's Jump target under All and User, the Agent side's under Agent; as a click on that side jumps (spec §5).
- At either end: nothing, no toast. On the last group, "next" does not scroll to the end (`to: 'end'` redraws without end before 2.1.290).
- A group without a Jump target is skipped for the next one in that direction that has one. When none in that direction has one, the notice a click gives ("This entry is not in the conversation view now; cannot jump to it"): on the Pane's notes line while the Pane is on screen, else as a toast with the same words.

**Where the action Buttons are drawn** (a press needs the Button mounted):
- **The Pane**: `‹ ›` at the search row's right end, after the match count (`f: Find [……] 4 of 38 ‹ ›`), the only always-drawn row with room (the footer does not fit them at 36 columns). Two `plain` Buttons carrying the two actions; a click on them jumps too. No hotkey (a hotkey is a digit or a lowercase letter, and ↑↓ with Enter already serve a focused Pane); not in the focus ring (`ring.ts` steps over them as over the Minimap's cells). Not drawn on Desktop.
- **The band**: drawn whenever the Pane is not on screen, closed, undrawn or a back tab (`$.ui.panes()`'s `isShown: false`), not only when closed or undrawn as now; it draws the same `‹ ›` with the same actions. While the Pane is on screen the band is not drawn, so the Pane's Buttons answer.
- A collapsed band answers nothing; the README says so.

**Not yet measured, for the implementation.**
- Whether `$.ui.scroll` moves a transcript row from a press that came by a chord (the types allow it only "while this call answers the person's own input"; ticket 03 measured the press, not a scroll from it). The implementation measures it first. If refused, only the clickable `‹ ›` stay, the keys leave the README, and its "not promised" list says so. The spec writes both outcomes; no task ticket.
- Whether the host redraws the band when the Pane becomes or stops being a back tab. If not, the README says the keys may not answer while the Pane is a back tab.

**Hotkeys.** None added.

**Left for later** (the spec ticket): the README's "not promised" lines (a borrowed action may stop working on a later host; nothing while the band is collapsed; possibly nothing while the Pane is a back tab; nothing on Desktop) and the `CT-*` scenarios, `meta+k` included.
