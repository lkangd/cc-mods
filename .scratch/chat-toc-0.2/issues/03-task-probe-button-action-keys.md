# Probe whether a Button's action can serve as a global key

Type: task
Status: open
Blocked by:

## Question

The reference says a Button's `action` names one of Claude Code's keybinding actions, and the person's binding for it, when a chord or modified key, presses the button. Jumping to the previous or next turn while typing in the composer would need this to work with the Pane unfocused. With a probe mod, on 2.1.287 and 2.1.295, find:

- which actions exist (the keybindings doc and the types), and whether any are unbound by default or meant for plugins, so chat-toc does not steal a key the person uses;
- whether the button is pressed when the Pane is not focused, when the Pane is a back tab (its render hook is not called then), when the Pane is closed, and while Claude is working;
- whether a Button in the `AbovePrompt` band (always drawn) can carry the action instead, and what a digit `hotkey` in the band does;
- what the press event says about its origin, and on Desktop whether any of it applies.

Record the facts and the probe mod's path; nothing to decide here.
