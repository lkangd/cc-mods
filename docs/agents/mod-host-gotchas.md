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
- A tool call the transcript does not fold into a `ToolGroup` (`Edit`/`Write` with their diffs, and others) is drawn at `ToolUse` plus `ToolResult` only, under the tool_use id. A view showing nothing but such rows reports no `onScreen` at `UserMessage`, `AssistantMessage` or `ToolGroup`: hook `ToolUse` and `ToolResult` too to know where the view is (2.1.295).
- One-column `plain` Buttons in a row (the Minimap's cells) draw side by side with no gap, each takes its own click and its own hover box, on 2.1.287 and 2.1.295. A Button with no `hover` drawn under the pointer shows inverse; the rest stay `dimColor` (`999999` under dark).
- A docked Pane is drawn one row taller than its close-mark row plus `scroll.bodyRows`: the last row, beside the transcript's status line, stays blank (2.1.287 and 2.1.295). A footer pinned with a spacer to `bodyRows` sits one row above the pane's bottom; drawing more than `bodyRows` makes the host scroll the tree and show `n more`.
- A docked Pane sits in a host Box filled with the theme key `composerSidebarBackground` (2.1.295: `rgb(38,38,38)` under dark, `rgb(245,245,245)` under light); an inline Pane has no fill, so it shows the terminal's own background. A theme value must be a concrete colour (rgb, hex, `ansi256(n)`, `ansi:<name>`), never "the terminal's default", and the close-mark row and the blank last row are the host's, so a mod cannot make the dock match the transcript: only a theme whose `composerSidebarBackground` equals the terminal's background does.
- A Button's `hover` may restyle the label (`{ scope, color: 'suggestion' }`) instead of inverting it, but the line right under the pointer is still drawn inverse by the host.
- `$.ui.mount({ surface: 'desktop', component: 'Pane', ... })` mounts a Pane on the desktop table in the test kit (Svg, Select, Button `variant`); `ui.select({ key, value })` drives a Select. 2.1.287's kit types `Mounted` without `select`: cast in the test, run the suite on the current host.
- `$.prompt.fill` (2.1.287 and 2.1.295): needs no press (a timer, `command.run`, even `session.start` fill the box); lands while a turn runs (Enter then queues it); under a dialog answers `refusal: 'dialog'` and drops the text for good. It moves the keyboard from a focused Pane to the composer. A filled `!cmd` stays a prompt (no bash mode; Enter sends it to the model); a filled `/command args` runs on Enter. A hook's own refusal reaches the caller with no `refusal`.
- A plugin's own `prompt.fill` and `ui.copy` hooks are skipped when its call comes from a press closure or a timer, but run when the call is made inside one of its hooks (`command.run`, `session.start`).
- `$.ui.copy` on the terminal answers `isCopied: true` whether or not anything was copied: with no `pbcopy` on `PATH`, a 2 MB text writes no OSC 52 and still reads true. With `pbcopy` it copies 16 MB; OSC 52 is written too, up to about 100 KB.
- A Button's `action` (2.1.287 and 2.1.295): there is no plugin namespace; it works only through an existing action the person binds to a chord or modified key (never a bare key), whose engine handler is not mounted (`app:redraw`, `app:toggleTodos`, and `pane:next` with two panes open stay the engine's). An unknown or reserved name (`app:interrupt`, `app:exit`) refuses the whole tree. Pressed from the composer, during a turn and under `/model`, not under a permission prompt; never on a back-tab Pane or a collapsed band (not mounted), and then the chord's second key (`ctrl+x p` → `p`) lands in the composer. `ui.press` does not say a chord pressed it.
- `$.ui.focus` cannot move the keyboard into a site the person has not focused (`{ deny: "that site does not hold the keyboard" }`). Ctrl+X Tab goes to the band first when it draws a control; from there a second one moved the ring inside the band, not to the Pane.
- A mouse click presses a Pane Button without moving the keyboard out of the composer; only Ctrl+X Tab (or `open({ focus })`) gives the Pane the keys.
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
- `settle()` never goes quiet while the spinner turns: snap a running turn with a short timeout. A `fake_api.py` turn that reads a file outside the project raises a permission dialog: point `read_path` inside it.
- The shell is fish: `$var` with spaces does not word-split. Drive loops from Python.

## Claude Code Desktop

Measured in the Claude app (Claude Code 2.1.295, macOS, 2026-10-14) with a probe mod (`.scratch/chat-toc/prototypes/desktop-click-probe/`). The types do not say any of this.

- `$.ui.scroll({ to: { requestId } })` to a transcript row answers `{ deny: "transcript not scrollable here" }`, every row, every time (anthropics/claude-code#100610). A mod cannot jump the transcript on Desktop.
- `UserMessage`'s `ui.render` comes once per message as it is drawn, with `onScreen: null`, and not again on scroll: no viewport position, so no Current position.
- A `plain` Button draws as one line of bare text: no chrome, a hover box under the pointer (the host's, cannot be turned off), repeated clicks each count. It honours `dimColor` only; `bold`, `color` and line breaks in `Text` children are dropped; overflow truncates with `…`. A non-plain Button is a grey native button and draws its `hotkey` as a badge.
- A `Markdown` with `onLinkPress` hands link clicks to the plugin, drawn as accent-coloured links; a quick second click is swallowed as a double-click.
- A Box's `width`/`height` count cells, as on the terminal: one column ≈ 8.2 px, one row ≈ 19 px. A Box with `borderStyle` always spans the row.
- `$.prompt.fill` answers `isFilled: true` and `$.prompt.read()` reads the text, yet the app's composer sometimes does not show it (a second press, or nothing, for a timer's fill). `$.ui.copy` reaches the clipboard for small texts and answers `no-clipboard` at 2 MB (2026-10-15, `.scratch/chat-toc-0.2/assets/02-fill-copy/`).
- `Svg` draws at its `width`/`height` in CSS px; without a width it is scaled down to the slot. Clicks on it never reach the plugin, and an absolutely placed Button over it covers only its own label. `prefers-color-scheme` inside it follows the app's dark mode.
