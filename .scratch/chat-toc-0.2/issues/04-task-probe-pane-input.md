# Probe an Input in the docked Pane

Type: task
Status: resolved
Blocked by:

## Question

Search needs a text field in the Pane. With a probe mod drawing an `Input` in a docked Pane, on 2.1.287 and 2.1.295 in the terminal, and on Desktop, find:

- how it gets the focus (a press, `autoFocus`, a hotkey on a Button, `$.ui.focus`), and whether typing then ever leaks into the composer;
- how often `onInput` fires while typing (each key, or debounced), and what it costs the Pane to redraw on each;
- what Esc, Enter, ↑↓ and the digit hotkeys 1/2/3 and `l` do while the Input is focused, and how the focus ring moves from it to the entries and back;
- how it draws at 36–56 columns, with CJK input and an IME, and whether it keeps its value across redraws and a Pane tab switch;
- `Input`'s `value` as a controlled field: can the mod clear it.

Record the facts and the probe mod's path; nothing to decide here.

## Answer

Measured 2026-10-15/16 on the terminal with 2.1.287 and 2.1.295 (isolated worlds, not logged in, 170×48, docked and inline at 100 columns), plus the user's hand runs in their own terminal (2.1.295, a real Chinese IME) and in the Claude app (Claude Code 2.1.295, macOS). The two terminal hosts behave identically on every step; they differ only in render counts and where the close mark sits (column 169 vs 168).

- Probe mod: [`input-probe`](../assets/04-pane-input/input-probe/) (a Pane with one `Input` `q`, a `to find` Button that calls `$.ui.focus` on it, entries with hotkeys `1`/`2`/`3`/`l`, a `clear` Button, filler rows filtered by the text; a second pane for tab switching; `PROBE_MODE=uncontrolled|controlled|fixed`, `PROBE_AUTOFOCUS=1`, `PROBE_ROWS`/`PROBE_DRAW`, and `/inputprobe mode …`/`autofocus on|off` where env cannot reach). The two commands were added after the terminal runs; nothing else changed. Local marketplace for Desktop: [`marketplace.json`](../assets/04-pane-input/.claude-plugin/marketplace.json).
- PTY driver: [`drive.py`](../assets/04-pane-input/drive.py), scenarios `focus autofocus keys cleared controlled fixed tabkey rate rateheavy narrow keep draft`. Captures per host and scenario under [`runs/`](../assets/04-pane-input/runs/): `steps.json` (per step: the probe's events, renders, the composer, the inverse cells, the cursor, the pane's top rows) and the probe's log; screens and debug logs stay local. The user's terminal run: [`runs/manual-terminal/input-probe.log`](../assets/04-pane-input/runs/manual-terminal/input-probe.log). Desktop: [`runs/desktop/events.txt`](../assets/04-pane-input/runs/desktop/events.txt) (a copy without render lines; the user's terminal session rewrote the shared log file afterwards).

### Getting the focus (terminal)

- **Ctrl+X Tab** gives the Pane the keys with the ring on nothing. Then **Tab or ↓** lands on the first focusable element, the Input (`ui.focus`, origin `person`). When the Pane's tree is taller than the pane (inline at 100 columns; 400 rows drawn), ↓ scrolls the pane instead and only Tab reaches the Input.
- **A printable key with the ring on nothing, on a Button or on the close mark leaks:** the keys go back to the composer and the character is typed there (`x`, `w`, `z`, `ab` all landed in the draft). Only the Input itself and hotkey Buttons take printable keys.
- **A mouse click on the field** focuses it straight from the composer (the next key reaches the Input). A click on a Button presses it and leaves the keys in the composer.
- **`$.ui.focus({ key: 'q' })`** from a Button inside the focused Pane moves the ring onto the Input (`{}`); from the composer it is `{ deny: "that site does not hold the keyboard" }`.
- **`autoFocus`**: `open({ focus: true })` on an idle, empty composer focuses the Input at once (`ui.focus`, origin `plugin`). With `autoFocus`, every later Ctrl+X Tab lands on the Input again, even after the person moved the ring to a Button (`ui.focus` origin `plugin` each time). With `autoFocus` on, a plain `open` leaves the keys in the composer. Without `autoFocus`, `open({ focus: true })` at best gives the ring-on-nothing state, where the next letter leaks to the composer anyway (seen on a pane already open).
- **A draft in the composer** stays untouched while the Input takes keys; Esc returns the keys with the draft intact.
- **Typing never leaks while the Input holds the keys:** letters, digits, `/inputprobe …` (a slash command typed into the field stays text in it), CJK, a bracketed paste.

### `onInput` and the redraw (terminal)

- **`onInput` fires on every change, not debounced:** one per key at 120 ms and at 20 ms per key; one for a burst written at once (`abcdefghij`) and one for a bracketed paste. Ctrl+U, Backspace and mid-text insertion each fire one with the whole text. Arrow keys, Home/End (Ctrl+A/E) fire nothing.
- **A real IME** (the user's terminal): one change per commit with the committed text (`测试`, `奥赛发送方`); nothing during composition. Enter while composing commits the raw letters (`szso`) as one change; Esc cancels the composition with no event and the keys stay in the Input.
- **The cost:** host `ui.input` settled in 3–7 ms and the Pane's `ui.render` in 2–5 ms per change (worker hop included), with 5000 rows of ~200 chars filtered on each render (the filter itself 1–2 ms). With 400 rows drawn, renders took 3–10 ms. While typing at 20 ms per key, the host coalesces renders (13 changes, 7 renders); one render can show an earlier value with the next one already queued.
- What a search over 4432 real turns costs is the "performance budget" question, not measured here.

### Keys while the Input holds them (terminal)

| Key | In the Input | With the ring on an entry Button |
| --- | --- | --- |
| `1` `2` `3` `l` | typed into the text | press that hotkey's Button (from any entry; the ring does not move) |
| Enter | `ui.input` kind `submit`, then **the field empties itself**, in both uncontrolled and controlled mode, with no `change` raised; Enter again submits `""` | presses the Button |
| ↓ / Tab | ring to the next element (`to find`) | next element; from the last one it wraps to the Input |
| ↑ | ring to the pane's close mark `✕` (Shift+Tab not tried here) | previous element (Shift+Tab too) |
| ← → Ctrl+A/E Backspace Ctrl+U | edit the text, cursor drawn as an inverse cell | ← → nothing visible |
| Esc | keys back to the composer, the Pane keeps the text | keys back to the composer |
| other printable | typed | **leaks into the composer** (see above) |

### Controlled `value`: can the mod clear it

- **Yes.** With `value={query}` every draw (the query held in a `$.state` atom that `onInput` writes), the field follows the typing (mid-text insertion and cursor kept), and a `clear` Button or a `command.run` that writes `''` empties it; `set foo` shows `foo`.
- What the host does: the field takes the drawn `value` **when the drawn value changes from the previous draw**. Drawing the same `value` again leaves the person's typing alone (`fixed` drawn every time, typing gave `fixedab` and kept it across redraws). Changing it, including dropping the prop after drawing one, resets the text (dropping it empties the field). So "uncontrolled with a one-off `value`" loses the person's typing on the next render; the controlled pattern is the reliable one.
- After a submit the field is empty while a controlled `value` still holds the old text. The text stays empty until the mod draws a different value or the person types.

### Drawing (terminal)

- Focused: `find: <text>  ⏎ go`, with `label`, a colon and space, the text, an inverse cell as the cursor, then `⏎` and `submitLabel`. There is no box and no inverse bar over the field; the placeholder is drawn dim with the cursor on its first letter. Unfocused: `find: <text>` (or the dim placeholder), no badge.
- Narrow (pane opened with `columns` 36, 44, 56): **focused, a long text wraps** onto as many rows as it needs, indented under the label, and pushes the elements below down. **Unfocused, it is one row**, `find:` with no space then the text cut with `…`; at 36 and 44 columns a blank row was left under it after Esc. CJK draws two cells wide, the cursor on a CJK character is two inverse cells, and Backspace and ← move by whole characters.
- Inline at 100 columns: the same field inside the bordered pane.
- **The value survives** redraws, a terminal resize, Esc, the Pane becoming a back tab and coming back (`pane:next`), and a second pane opening and closing. **It does not survive closing and reopening the Pane** (empty field, placeholder); a controlled `value` from `$.state` restores it.

### Desktop (the user's hand run, Claude app)

- Drawn as a native text field with a rounded border: `find` as a label to its left, the placeholder inside, `submitLabel` as a separate `go` button to its right (screenshot from the run). Entry Buttons show their hotkeys as key-cap badges.
- **A click into the field** gives it the keys (no `ui.focus` raised); typing does not reach the app's composer. `1` `2` `3` `l` are typed into the text.
- **Enter submits and does not empty the field** (the same `123l` submitted nine times). Esc leaves the field. Tab moves through the elements (`ui.focus` origin `person`); **↑↓ do not**.
- **The IME's composition letters arrive as changes:** `v`, `vs`, `vsw`, `vswf`, then `""`, then the commit `中文` (Xiaohe Shuangpin for zhong wen). Unlike the terminal, a search filtering on each change would run on the pinyin letters first.
- The `clear` Button empties the field in both modes; controlled typing and `set foo` behave as on the terminal.
- **`autoFocus` does not take the keys on Desktop:** `/inputprobe openfocus` with `autoFocus` on left the keys in the app's composer (user's report).
