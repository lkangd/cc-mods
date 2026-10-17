# 24: Tidy the Desktop pane: head row, search row, preview set apart

**What to build:** The Desktop pane's look, from the user's look in the Claude app (2026-10-17, ticket 19):

- **Head row**: the segmented control (All / User / Agent) is taller than the Layout `Select` (`Card ⌄`). Make the two the same height and centred on one line: the native `Select`, `Button` and `Input` draw about 24 px tall, the well 32 px (ticket 23's measurements).
- **Search row**: the field, the `show` button, the count and a new `✕` line up with the head row, flush with its left and right edges, in one height. The `✕` is a Button drawn only while there is a query; a press empties the query (as the terminal's `✕` does).
- **Preview under the pressed entry, set apart** (user's decision, 2026-10-17): the preview no longer sits at the bottom; it opens right under the pressed Turn group's last entry, like an accordion, on a background of its own (or a border) so it does not read as more entries, its `✕` at its top right. Another press moves it. A group the filter or query leaves out, or one outside the drawn part of the list (ticket 23), shows it at the list's top. Expanded still takes the list's place.
- **Closed until a press**: drawn from ticket 22's state: nothing until an entry is pressed or the search is submitted (Enter or `show`), which opens it on the nearest match.

A throwaway prototype of the head and search rows and of the preview's frame is worth showing the user in the app before the real change (`mattpocock-skills:prototype`).

Spec: [chat-toc 0.2](../spec.md) §8 (Search, Preview, The head row).

**Blocked by:** 22, 23

**Status:** ready-for-agent

- [ ] Segmented control and Layout Select the same height, centred on one line, light and dark
- [ ] Search row aligned with the head row; `✕` while there is a query, empties it
- [ ] Preview opens under the pressed entry, set apart from the list, with `✕`; closed until a press; `show` / Enter opens it on the nearest match
- [ ] Element-tree tests on the `desktop` surface
- [ ] The user looks at it in the app and the findings are recorded here
- [ ] `claude plugin test`, `tsc` on both versions and `claude plugin validate` pass

## Comments
