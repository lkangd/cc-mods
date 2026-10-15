# Probe how prompt.fill and ui.copy behave

Type: task
Status: open
Blocked by:

## Question

Putting an earlier prompt back into the composer, or copying it, depends on two host calls whose edge behaviour the types do not state. With a probe mod, on 2.1.287 and 2.1.295 in the terminal, and in the Claude app on Desktop, find:

- `$.prompt.fill({ text })`: with an empty composer; with a draft already typed (replaced, appended, refused?); while Claude is working; while the Pane has the focus (does the focus move to the composer?); multi-line text, `/command args` and `!cmd` text; what `prompt.fill` hooks of other mods see.
- `$.ui.copy({ text, surface })`: whether it reaches the system clipboard in the terminal (and through tmux/ssh, if cheap to try), on Desktop, its result (`isCopied`) when it fails, and any size limit.
- Whether either needs the call to come from a person's press (like an asked `ui.open`).

Record the facts and the probe mod's path; nothing to decide here.
