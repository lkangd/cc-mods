# Probe whether a Button's action can serve as a global key

Type: task
Status: resolved
Blocked by:

## Question

The reference says a Button's `action` names one of Claude Code's keybinding actions, and the person's binding for it, when a chord or modified key, presses the button. Jumping to the previous or next turn while typing in the composer would need this to work with the Pane unfocused. With a probe mod, on 2.1.287 and 2.1.295, find:

- which actions exist (the keybindings doc and the types), and whether any are unbound by default or meant for plugins, so chat-toc does not steal a key the person uses;
- whether the button is pressed when the Pane is not focused, when the Pane is a back tab (its render hook is not called then), when the Pane is closed, and while Claude is working;
- whether a Button in the `AbovePrompt` band (always drawn) can carry the action instead, and what a digit `hotkey` in the band does;
- what the press event says about its origin, and on Desktop whether any of it applies.

Record the facts and the probe mod's path; nothing to decide here.

## Answer

Measured 2026-10-15 on the terminal with 2.1.287 and 2.1.295 (isolated worlds, not logged in; a running turn and a permission prompt against `fake_api.py`), 170×48 docked and 100 columns inline. The two hosts behave identically on every step. Desktop was not measured (see the last section).

- Probe mod: [`action-probe`](../assets/03-action-keys/action-probe/) (a Pane of Buttons, each naming one action; a second Pane naming one of the same; a band row with two action Buttons and the digit hotkey `7`; two Panes whose trees are refused). PTY driver: [`drive.py`](../assets/03-action-keys/drive.py), which writes the world's `keybindings.json` (all in `Global`: `ctrl+x p`, `meta+j`, `ctrl+x g`, `ctrl+x .`, `ctrl+x r`, `ctrl+x d`, `ctrl+x q`, `ctrl+x b`, `f6`). Captures per host and scenario (`idle refused working permission edge noband`) under [`runs/`](../assets/03-action-keys/runs/): `steps.json` (per step: the presses the probe logged, the composer, the focus ring), the probe's log, `refusals.txt` (the refusal lines of the debug log); the per-step screens and the debug logs stay local (git-ignored; `drive.py` writes them again).

### Which actions exist, and which are free

- The 2.1.295 binary holds 148 action names (the keybindings doc's list plus a few undocumented: `app:help`, `app:openArtifact`, `app:toggleBrief`, `app:toggleTerminal`, `chat:attentionUp/Down`, `chat:cycleProactivity`, `chat:workflowKeywordToggle`, …). **No namespace is set aside for plugins**, and a mod cannot add an action.
- A Button naming an unknown action (`chattoc:previousTurn`) or one of the two reserved ones (`app:interrupt`, `app:exit`: "the engine's alone: its key cannot be rebound") fails validation as a whole tree: the engine draws its own (an empty Pane), the debug log has a `WARN … does not validate`, and the transcript a dim `hooks: ui.render (Pane) refused: …` line.
- The press needs **the person's own binding**: the Button is pressed by whatever chord the person bound to that action. An action unbound by default has no key at all until the person writes one into `keybindings.json`, so chat-toc can steal no key by default, and cannot ship one either.
- Pressed (bound as above, the Button mounted): `app:toggleDiffNoiseFilter`, `app:toggleDiffPreSession`, `app:toggleReplTab`, `pane:next` (one pane open), `footer:dismiss` and `diff:back` (both bound in `Global` though the doc files them under other contexts), `permission:toggleDebug`. All unbound by default; none has an engine handler mounted in a normal session.
- **Not pressed**, the engine keeps them: `app:redraw` (`ctrl+x r`) and `app:toggleTodos` (`ctrl+t`, its default), whose handlers are always mounted; `pane:next` while two panes are open (the engine switches the tab instead). A **bare key** (`f6` → `confirm:previousField`) never presses; a chord (`ctrl+x p`) and a modified key (`meta+j`) do.
- Every free action is a borrowed name that means something else (`app:toggleDiffNoiseFilter` for "previous turn"), and the person must bind that name. If a later host mounts a handler for it, the Button silently stops being pressed.

### When the press happens

| State | Pane's action Button | Band's action Button |
| --- | --- | --- |
| Pane open, unfocused, empty composer | pressed | pressed (for an action the Pane does not draw) |
| A draft in the composer (`abc`) | pressed, draft untouched | – |
| Keyboard in the band (Ctrl+X Tab) or in the Pane | pressed | pressed |
| Claude working (a running turn), with or without a draft | pressed, draft untouched | pressed |
| Pane inline (100 columns) | pressed | pressed |
| Pane a back tab (another pane in front) | **not pressed**: not mounted; a front pane drawing the same action takes it | – |
| Pane closed | – (not mounted) | pressed |
| Band collapsed (Ctrl+X Ctrl+A) | – | **not pressed**: not mounted |
| `/model` picker up | **pressed** (the types say "no dialog up"; this picker does not count) | not pressed: the band is not drawn under it |
| Tool permission prompt up | not pressed | not pressed |

- Precedence as documented: with both the Pane and the band drawing `app:toggleDiffNoiseFilter`, the Pane's is pressed; with the Pane closed, the band's.
- **A chord nothing answers leaks its second key**: with no Button mounted for `ctrl+x p`, a `p` lands in the composer (a `meta+j` with nothing mounted is swallowed). A collapsed band or a closed Pane therefore turns the person's chord into a typed letter.
- The press is not focus-dependent and never moves the keyboard: the composer keeps it, and the focus ring stays where it was.

### Digit hotkeys

- A band Button's digit `hotkey` (`7`) is pressed by typing `7` into an **empty** composer and pausing; after a draft (`x`), `7` is typed into it. It is pressed again while the band holds the keyboard. A collapsed band does not answer it.
- A Pane's hotkey (`8`) answers only while the Pane holds the keyboard; from the composer it types `8`.
- `$.ui.focus` cannot hand the keyboard to a Pane the person has not focused: `{ deny: "that site does not hold the keyboard" }`. Ctrl+X Tab goes to the band first when it draws a focusable control; a second Ctrl+X Tab from there moved the ring inside the band, not to the Pane (with an empty band it goes straight to the Pane).

### What the press says about its origin

`ui.press` carries `{ plugin, element, component, requestId, surface }` and nothing else, for a chord press as for a click, a hotkey or Enter. A mod cannot tell a chord from a click.

### Desktop

Not measured. The types limit `action` to "the terminal while mounted", and Desktop already refuses `$.ui.scroll` to any transcript row (MVP probe), so a previous/next-turn jump has nothing to do there whatever the key path.
