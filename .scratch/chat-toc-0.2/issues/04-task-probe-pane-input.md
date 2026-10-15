# Probe an Input in the docked Pane

Type: task
Status: open
Blocked by:

## Question

Search needs a text field in the Pane. With a probe mod drawing an `Input` in a docked Pane, on 2.1.287 and 2.1.295 in the terminal, and on Desktop, find:

- how it gets the focus (a press, `autoFocus`, a hotkey on a Button, `$.ui.focus`), and whether typing then ever leaks into the composer;
- how often `onInput` fires while typing (each key, or debounced), and what it costs the Pane to redraw on each;
- what Esc, Enter, ↑↓ and the digit hotkeys 1/2/3 and `l` do while the Input is focused, and how the focus ring moves from it to the entries and back;
- how it draws at 36–56 columns, with CJK input and an IME, and whether it keeps its value across redraws and a Pane tab switch;
- `Input`'s `value` as a controlled field: can the mod clear it.

Record the facts and the probe mod's path; nothing to decide here.
