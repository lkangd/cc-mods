# Mod host gotchas

Host and test-kit behaviour that the `plugin-authoring` skill does not state, measured on 2.1.287 and 2.1.295 while building chat-toc. Load the skill first for the type declarations; this file is what the declarations don't confess. Add to it when a mod hits a new one.

## Host type declarations

`mods/<mod>/.claude/types/claude-code.d.ts` (and the skill's copy) is ~15,000 lines. Grep it by symbol (`grep -n "export type UiPane" …`) and read ~80 lines around the hit. Line numbers differ between host versions.

## Hooks module

- `$` may only be passed to functions declared at the top of the hooks module file, and only spelled `$.noun.method(...)`. Passing it to an imported helper or a closure makes the module fail to load ("$ is passed to X, which is not a function declared at the top of this file"). So every `$` call lives in `register.tsx`; pure modules take plain values (e.g. `$.ui.resolve(e)`).
- Write matcher values and `$.env.get` names as literals. An imported const still works at runtime but `claude plugin validate` shows `requestId=?`.
- `types/index.d.ts`: write members inline under `interface PluginState { '<mod>': { ... } }` (a type alias is not resolved by validate), and export at least one type (`export {}` is not enough).
- A render hook may not write `$.state`; run side effects through `$.clock.after(0, …)`.
- A plugin's own `$.ui.focus` is not raised to its own `ui.focus` hook, and its own `$.ui.close` does not re-enter its `ui.close` hook (`ui.close skipped: re-entry`). Record the effect yourself.
- `classic.SessionStart` carries `transcript_path`. The file does not exist before the first submit, including after `--fork-session`.
- A plugin enabled in mid-session (`/plugin` then closing the menu, which reloads by itself; or `claude plugin enable` then `/reload-plugins`) hears `session.start` alone (debug log: `session.start: raised for <mod> (loaded later)`), no `classic.SessionStart`, so no `transcript_path` until the next submit's `classic.UserPromptSubmit`. The path can be worked out: `$.session.id()` is the file's name (also after `--resume`), in `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<folder>/`, the folder the cwd with every UTF-16 unit but `[a-zA-Z0-9]` turned into `-`; over 200 units it keeps the first 200 and appends `-` + `Math.abs(javaHash(cwd)).toString(36)` (`h=(h<<5)-h+c|0`). Read from both binaries, not public (chat-toc's `hooks/locate.ts`).
- `claude plugin enable` from outside reaches a running host when its settings watcher fires (debug log `Settings changed from userSettings`), a fraction of a second later; a `/reload-plugins` before that still finds the plugin disabled.
- An unasked `ui.open` of a docked Pane waits below 144 columns; a person-asked open places at any width (inline when too narrow). The debug log names the reason.
- `$.ui.status` shows as `⚠ <mod>: <text>` on the line under the prompt.
- `/reload-plugins` keeps an unchanged hooks module. To hot-reload for real, edit the hooks file of the copy loaded with `--plugin-dir` (append a comment).
- Colour with theme keys, never raw colours: `Text`'s `color`/`backgroundColor` take a key of the host theme (`suggestion`, `inactive`, `claude`, `success`, …) and the host resolves it per theme, custom themes included; `/theme` redraws an open Pane at once (2.1.287 and 2.1.295). `dimColor` already follows the theme. `Button` has no `color` prop: only `dimColor` and `hover`. `Text`'s `inverse` draws as SGR 7 on both hosts.
- A rewind (Esc Esc, restore the conversation) writes nothing to the transcript and raises no hook but `PromptHint`'s `ui.render`; by then `$.session.turns()` and `$.session.messages()` are already cut. `turns()` counts `messages()`' user entries that are not tool results (the compaction summary and `!` input and output count; a local command like `/tui` is in neither). `messages()` starts at the last compaction, with its summary.
- A resumed session's host lists no row before the file's last compaction boundary (`$.ui.scroll` refuses them); a `--fork-session`'s file starts at that boundary, so it has none of them.
- `--debug-file <path>` logs module reloads, `session.start settled`, and `ui.open <mod> … (unasked|asked, N columns): placed|waits …`: model-free evidence of what the plugin did.

## Test kit (`claude plugin test`)

- A plugin's own `$.ui.scroll` and `$.ui.focus` never reach the test's `on(...)`; they reject with "no implementation for ui.scroll". Test the target at a pure seam and confirm in a PTY. Return the promise from `onPress` so `press` awaits it.
- `FoundElement.props` has no `hover` (it is on the element in `await pane.drawn()`). `pane.find({ text })` returns the outermost match, a Box: add `type: 'Text'`.
- Engine-built `command.run` in tests: `$.command.run({ command, args } as never)`.
- 2.1.295's kit stores `session.append` itself; 2.1.287's kit has no bottom for it, so append-driven tests fail there. Run the suite on the current host only.
- `mountPane($)` once per test; a second mount throws "mounted already".
- The engine resolves a non-absolute path (a Windows `C:\…` on macOS) against the plugin dir before `fs.*` hooks see it.

## Minimum host 2.1.287

Install into a scratch dir, never globally: `npm install --prefix <dir> @anthropic-ai/claude-code@2.1.287` (Node 20 warns EBADENGINE; it works). The person's status line shows the current version even under 2.1.287: check `ps`.

## PTY acceptance

- Run worlds **not logged in** (temporary `CLAUDE_CONFIG_DIR`). A submit is still written to the transcript and the host answers `Not logged in · Please run /login`: real rows, no model call, no quota. Resume, clicks, scrolls, local slash commands, rewind and fork all work this way.
- `!cmd` in a resumed session starts a model turn when logged in (one run spent 973k tokens on a big synthetic transcript). It is not a model-free trigger.
- Prefer pyte for whole-pane reads; cmux wheel input makes a pane window jump. cmux specifics (click side effects, sizes, commands) live in the memory `cmux-pty-acceptance`.
- The host draws `dimColor` as the theme's `inactive` foreground, not SGR 2: `999999` under dark (the harness's world), `666666` under light, `white`/`brightblack` under dark-ansi/light-ansi. A hovered entry is drawn inverse: move the pointer off before checking colours.
- Slice pyte rows by cell column, not char index: CJK text shifts character offsets.
- Rewind without a model: Esc Esc on the empty composer, Up to the prompt, Enter, Enter (restore), then backspaces to clear the restored prompt.
- The shell is fish: `$var` with spaces does not word-split. Drive loops from Python.
