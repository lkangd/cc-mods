# Prototype the Pane's layout with the new parts

Type: prototype
Status: resolved
Blocked by:

## Question

Rows are the Pane's tightest budget. A 44-column docked Pane already holds the filter row, the tab rule, the Minimap (3 rows), the entry list and the footer. Where do a search field, a preview of one Turn group's full text, compaction rules on the rail and the context use in the footer fit, at 36–56 columns and at short heights, without the list falling below its 8-row floor?

Make rough, clickable variants to react to (for example: the search field always shown vs. opened by a key; the preview as a bottom region, as an entry expanded in place, or as a view that replaces the list until closed), drawn on the terminal and, roughly, on Desktop. Decide which layout the search and preview tickets build on, and what is hidden first when rows run short.

## Answer

Variant A, "always there", for the search field, the preview and what gives way, chosen by the user on 2026-10-16. Prototype: branch `prototype/chat-toc-0.2-pane-layout` (`.scratch/chat-toc-0.2/prototypes/pane-layout/index.html`, open it in a browser; `?variant=A|B|C&cols=&rows=&surface=desktop&lang=zh&q=&open=1`). It draws the pane cell by cell (CJK two cells) with made-up data; Desktop is a rough sketch.

**The Pane, top to bottom** (rows in brackets):

1. The filter row and its tab rule (2), as in the MVP.
2. **The search row (1), always drawn**, right under the tab rule: the field, and the match count at its right once there is a query (`4 of 38`). It is never hidden for want of rows.
3. The Minimap (3), as in the MVP.
4. The list, at least 8 rows. Compaction rules take one row each, like the day's rule.
5. **The preview region**: a rule (`preview · p`) and the full text of one Turn group under it. It **follows the Current position** (the lit group) on the terminal; on Desktop, which has no Current position, it shows the last entry clicked (a click there cannot jump anyway). `p` hides or shows it. Prototype size: 40% of the rows left after the head, search row and footer, held between 4 and 14; the preview ticket may tune it.
6. The footer (2): the count and the context use on the left, the Layout Button on the right.

**`/` focuses the search field.** The Pane's hotkeys hang only on drawn Buttons, so this is a Button on the search row with `hotkey="/"` whose press calls `$.ui.focus` on the field, which ticket 04 found works from inside a Pane that holds the keys. It does not work from the composer: there `/` starts a slash command, and `$.ui.focus` cannot take the keys from the composer. Not yet measured: whether the host takes `/` as a `hotkey` string, and how a plain Button with a hotkey draws on that row (`/: …`). The search ticket checks both.

**When rows run short, in order:** the Minimap goes first. Then the preview shrinks to 4 rows. Then the preview goes, leaving one line, `p: preview (no room)`. The list keeps its 8-row floor; the search row stays.

**Seen in the prototype, for the tickets after this one:**
- At 36 columns × 18 rows the preview's 5 rows hold the meta line, `You` and "↓ 10 more": almost no text. A short pane gets little from it; the preview ticket decides what goes first inside it.
- With the context use in the footer, English at 36 columns does not fit `38 turns · context 62%` beside `l: Layout: Card`; the prototype falls back to `ctx 62%`. Chinese fits. The compaction ticket picks the words.
- A search narrows the list to matches (the prototype's stand-in, not a decision); the Current position then snaps to the nearest match, so the preview has something to show.

Rejected: B (search summoned in the filter row's place, preview expanded in place inside the list) and C (search on the footer's status row, preview replacing the list with `[` `]` to step).
