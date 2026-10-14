# 30: Pane colours follow Claude Code's theme; release 0.1.1

**What to build:** chat-toc stops hard-coding colours and uses the host's theme keys, so the Pane matches the current theme; then release it as 0.1.1.

**Blocked by:** none

**Status:** resolved

## Decisions made (grilling, 2026-10-12)

- How to take colours: write the theme key straight into `Text`'s `color`, and the host resolves it under the current theme; do not read the theme name, and keep no palette in the plugin. The host types say "Colors are a theme key or a raw color" from 2.1.271.
- The slot for the current group's highlight (`▌` / `●` / `┃`, with the time in timeline): `cyan` → `suggestion`.
- ~~The old `dimColor` → `color="inactive"`~~: the spike found that `dimColor` was already drawn as the theme's `inactive`, and `Button` has no `color`; the user agreed to leave `dimColor` unchanged (Q6').
- The hover `inverse` stays; the `●` of the button's selected item gets no colour.
- Change chat-toc only; add one item "use theme keys for colours" to `docs/agents/mod-host-gotchas.md`.
- The manual visual check for 0.1.0 is no longer signed; it merges into 0.1.1's sign-off (noted in ticket 29).

## Steps

- [x] Spike: on 2.1.287 and 2.1.295, measure that a theme key in the plugin Pane is resolved; whether the Pane redraws at once after `/config` changes the theme. Add a `config.set` (`key: "theme"`) listener to redraw proactively only if it does not redraw
- [x] Test first: a pure-function colour test for `drawPane`, then change the implementation
- [x] PTY acceptance: two versions × `dark`, `light`, `dark-ansi`, `light-ansi`; read the SGR and assert that the foreground colours of the highlight and the dim elements equal the theme's resolved values, with no more cyan or `999999`; `daltonized` and `auto` only take screenshots
- [x] Add one item to `mod-host-gotchas.md`
- [x] Release 0.1.1 by the README's release checklist (gate, marketplace smoke, GitHub install check), with the manual visual check sign-off merged into 0.1.1

## Comments

- 2026-10-12 spike (pyte, `--plugin-dir` with a copy that changes the highlight to `color="suggestion"`, turns fixture of 12 turns, not logged in). The results on 2.1.287 and 2.1.295 were identical:

  | Theme | Highlight `▌` (`suggestion`) | `dimColor` (the slot and the `you ·` / `↳` lines) |
  | --- | --- | --- |
  | dark | `b1b9f9` | `999999` |
  | light | `5769f7` | `666666` |
  | dark-ansi | `brightblue` | `white` |
  | light-ansi | `blue` | `brightblack` |

  - The theme key resolves in the plugin Pane on both versions.
  - `dimColor` already followed the theme's `inactive` (the table above is each theme's `inactive`); the line in `mod-host-gotchas.md` saying "dimColor is drawn as 999999" holds only under dark. Also, `Button` has no `color` property, so an entry's dim lines can only use `dimColor`.
  - After `/theme` switches from Dark to Light, the Pane redraws at once under the new theme (on both versions), so listening to `config.set` is not needed.
  - `/theme` also has "New custom theme…": a custom theme resolves through theme keys the same way.
- 2026-10-12 implementation: in `hooks/pane.tsx` the highlight `color="cyan"` → `"suggestion"`; `follow_position.test.ts` was first changed to expect `suggestion` (6 failures), then the implementation was changed (210 passed). The acceptance contract gains the MUST `CT-UI-004` (`ui-004` in `gate_scenarios.py`: one check for each of the four themes, one for the live redraw on `/theme` Dark→Light, one that only records daltonized (two) and auto); the colour criterion of `CT-UI-003` changes from "looks cyan" to "equals dark's `suggestion`"; the MUST table and the sign-off notes of `release_gate.py` are updated to match. `ui-003` and `ui-004` pass on both 2.1.287 and 2.1.295 (daltonized: dark `99ccff` / light `3366ff`; under pyte, auto is drawn as dark). Docs: the root README's "cyan highlight" becomes a highlight that follows the theme, and `mod-host-gotchas.md` corrects `dimColor` and adds "use theme keys for colours".
- 2026-10-12, first round of the 0.1.1 gate (commit under test `3777ac2`, two versions run in parallel): everything passed except the items below (validate, test 210, unit 43, tsc on both versions, ct-compat, ct-marketplace local, ct-life, chain, jump, position, the gate on 2.1.295, screenshots). Not passed: data-004 and both perf runs on 2.1.287 crashed inside pyte (`render` in `screens.py` raised `IndexError: string index out of range`, a driver problem); CT-PERF-001 many/heavy on 2.1.295 went over the threshold (two versions in parallel, high machine load: `tailReadMs` p95 up to 1338 ms, one `hostReadyS` of 11 s). This change touched only one colour string and not the reading and drawing paths. The run directories of the first round were moved to `gate-attempt1/` in the scratchpad; rerun the whole gate_scenarios on 2.1.287 and perf on both versions one after another when the machine is idle.
- 2026-10-12, second round (rerun in series): gate_scenarios on 2.1.287 passed 21 and failed 1: in CT-DATA-004, one of the reads after 4 commits had `chunks: 0` (no new bytes when it read), while the criterion wants 1 chunk every time; the whole list and the cross-chunk boundary were both right. CT-PERF-001: heavy passed on both versions, many failed on both, both stuck on "incremental read, one read ≤ 150 ms" (p95 192–405 ms; it was 104–111 ms at 0.1.0, already close to the threshold, mainly the first `$.process.run` after a hot reload). The machine's load average was 25–35 then (Chrome, WindowServer and others), not an idle machine. The plugin's read path is the same as 0.1.0.
- 2026-10-12, third round (rerun in series after the user closed other programs, load average 6–9): the run directories that failed in the second round were moved to `gate-attempt2/` in the scratchpad, and the whole gate_scenarios on 2.1.287 and perf many on both versions were rerun. All passed: gate_scenarios on 2.1.287 22/22 (the reads after two commits in CT-DATA-004 are both 1 chunk); CT-PERF-001 many incremental read maximum 100–108 ms on 2.1.287 and 94–102 ms on 2.1.295, back at the 0.1.0 level. This confirms the second round's failures came from machine load. The `codes.json` of both versions was overwritten by the `--only-perf` run to hold only the two perf items; it was rebuilt from each log header's exit and this round's results.
- 2026-10-12 sidebar background: the user reported the Pane's background did not match the terminal. The cause is that the host's docked sidebar hard-codes `backgroundColor: "composerSidebarBackground"` (`rgb(38,38,38)` under dark), and the user's custom theme cc-themes:dracula does not override this key; the plugin cannot cover the border column and the ✕ row the host draws, so it is not changed in chat-toc. In the user's cc-themes repository, the 5 keys for Dracula were added and a new Catppuccin Mocha theme (the user's terminal uses Mocha), commit `c6f515a` (not pushed). Measured by PTY on both versions (`--plugin-dir` loading cc-themes, `theme: custom:cc-themes:<slug>`): the Pane, the border column and the ✕ row are all that theme's `composerSidebarBackground` (Dracula `282a36`, Mocha `181825`), the highlight is `bd93f9` / `cba6f7`, and the dimmed text is `6272a4` / `7f849c`.
- 2026-10-12 release: `release_gate.py report --screens` generated `tests/evidence/0.1.1/` (33 MUSTs × 2 versions, 104 records all passed, leaks 0); merged into main with `--no-ff` (`5327d7a`), release commit `0caa821`, pushed with the user's consent. The default branch of `lkangd/cc-mods` is `main`; the install-level check from GitHub passed on both versions (`b80d1ab`, `marketplace.md`). cc-themes `c6f515a` was also pushed (SSH was cut, so pushed over HTTPS). The manual visual check sign-off is left to the user, in `tests/evidence/0.1.1/report.md`.
