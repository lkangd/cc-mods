# Probe how prompt.fill and ui.copy behave

Type: task
Status: resolved
Blocked by:

## Question

Putting an earlier prompt back into the composer, or copying it, depends on two host calls whose edge behaviour the types do not state. With a probe mod, on 2.1.287 and 2.1.295 in the terminal, and in the Claude app on Desktop, find:

- `$.prompt.fill({ text })`: with an empty composer; with a draft already typed (replaced, appended, refused?); while Claude is working; while the Pane has the focus (does the focus move to the composer?); multi-line text, `/command args` and `!cmd` text; what `prompt.fill` hooks of other mods see.
- `$.ui.copy({ text, surface })`: whether it reaches the system clipboard in the terminal (and through tmux/ssh, if cheap to try), on Desktop, its result (`isCopied`) when it fails, and any size limit.
- Whether either needs the call to come from a person's press (like an asked `ui.open`).

Record the facts and the probe mod's path; nothing to decide here.

## Answer

Measured 2026-10-15 on the terminal with 2.1.287 and 2.1.295 (isolated worlds, not logged in; a running turn against `fake_api.py`), and in the Claude app (Claude Code 2.1.295, macOS) by the user's hand. The two terminal hosts behave identically on every step.

- Probe mods: [`fill-probe`](../assets/02-fill-copy/fill-probe/) (a Pane of fill and copy Buttons that logs each result and the box before and after) and [`fill-watch`](../assets/02-fill-copy/fill-watch/) (another mod's `prompt.fill` and `ui.copy` hooks; `WATCH_REFUSE=1` / `WATCH_REWRITE=1`). Local marketplace for the Desktop install: [`marketplace.json`](../assets/02-fill-copy/.claude-plugin/marketplace.json).
- PTY driver: [`drive.py`](../assets/02-fill-copy/drive.py) (scenarios `basic focus working dialog refuse rewrite nopbcopy boot`; restores the person's clipboard afterwards). Captures per host and scenario under [`runs/`](../assets/02-fill-copy/runs/): `steps.json` (the composer and clipboard per step), both logs, `osc52.txt`; the per-step screens stay local (git-ignored; `drive.py` writes them again). Desktop logs: [`runs/desktop/`](../assets/02-fill-copy/runs/desktop/).

### `$.prompt.fill` on the terminal

- **Modes as typed.** `replace` puts the text over any draft (`DRAFT` → `FILL-R`); `append` adds after it (`DRAFT+FILL-A`); `insert` goes in at the person's cursor (`DRA<I>FT` with the cursor two left of the end). Cursor afterwards: end of the text for `replace`/`append`, past the inserted text for `insert`. `replace` with `''` empties the box and says `isFilled: true`.
- **Empty box, at any time.** Works from a Button press, from a `clock.after` timer with no press behind it, from `command.run`, and from `session.start` itself (0.1 s into the session the box already takes it). **No person's press is needed.**
- **While Claude is working:** the fill lands (`isFilled: true`), the draft is editable, and Enter on it queues it as usual ("Press up to edit queued messages"); it is sent after the turn.
- **Under a dialog** (`/model`'s picker; also a tool permission prompt during a turn): `{ isFilled: false, refusal: 'dialog' }`, the box unchanged, and nothing lands once the dialog closes: the text is dropped, not deferred.
- **The focus.** A fill moves the keyboard to the composer: after Ctrl+X Tab into the Pane and Enter (or a hotkey) on a filling Button, the Pane's ring is gone and the next typed key lands in the draft. A Button that does not fill leaves the keyboard in the Pane. A mouse click presses a Pane Button without moving the keyboard out of the composer.
- **Multi-line text** lands as several lines in the box, code fences intact.
- **`/command args`** lands as plain text with no completion menu (typing `/fillp` shows one); Enter runs it as the command (`/fillprobe log` ran).
- **`!cmd` does not enter bash mode.** The box keeps the `❯` prompt with a literal `!`; Enter sends `!echo hi` to the model as a prompt (the not-logged-in answer), where typing `!` switches the box to bash mode (`! echo typed` ran the shell and printed `typed`). Reusing a `!` prompt by fill would ask the model, not run the command.
- **Invisible code points** are stripped as documented: ZWSP, BEL and ESC go, the rest stays (`a​b\u0007c\u001b[31md` → `abc[31md`).
- **Other mods' hooks** see `{ text, mode, origin: { kind: 'plugin', name: 'fill-probe' } }`, the text as passed (before stripping), `decorations` absent when none. A hook answering `{ isFilled: false }` keeps the draft, and the caller gets `isFilled: false` with **no** `refusal`; a hook rewriting `text` changes what lands and what the caller's result says.
- **The calling mod's own hooks** are skipped when the fill (or copy) comes from a press closure or a timer, but run when it is made inside a hook (`command.run`, `session.start`). The types say only "the other plugins' hooks".

### `$.prompt.fill` on Desktop

- Not refused: Desktop binds the box (no `no_composer`). Every call answered `isFilled: true`, and `$.prompt.read()` then read the text, also during a turn and from `command.run`.
- **But what the person sees is unreliable:** sometimes a Button had to be pressed twice before the text showed in the app's composer, and the timer fill sometimes showed and sometimes did not, while the host answered `isFilled: true` every time. `isFilled` there does not prove the text reached the visible composer.
- `!cmd` does not enter bash mode there either.

### `$.ui.copy`

- **Terminal (macOS):** writes the system clipboard through `pbcopy` (read back with `pbpaste`, CJK, emoji, newline and tab intact) at 32 chars, 100 KB, 2 MB and 16 MB (16 MB in ~135 ms), and **also** writes OSC 52 for texts up to 100 KB (133,338 bytes of base64), none at 2 MB or more.
- **`isCopied` proves nothing on the terminal.** With `pbcopy` off `PATH` the clipboard stays untouched and every size still answers `isCopied: true`, 2 MB included with no OSC 52 written at all; `no-clipboard` was never returned.
- **Desktop:** small texts reach the system clipboard (the user pasted them back); 2 MB and 16 MB answer `{ isCopied: false, reason: 'no-clipboard' }`. 100 KB was not tried there, so the bound lies somewhere under 2 MB.
- `surface` left out is filled with the session's surface (`terminal`, `desktop`). Timer and `command.run` copies work: no press needed. Copies while a turn runs work.
- Not tried: tmux (not installed here) and ssh.
