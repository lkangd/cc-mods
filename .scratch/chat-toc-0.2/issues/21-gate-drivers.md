# 21: Three release-gate drivers that fail before 0.2 can ship

**What to build:** Make the release gate's MUST list run green on 2.1.287 and the current host. A run of the gate on the current host (`--skip-perf`, after the review fixes at 5e8bdaf) failed three scenarios; each also fails at 913e6ce, so none comes from the review fixes.

- `CT-COMPAT-003` (`ct-compat`): the driver waits for a status line that f1f5494 removed. Assert on what the Pane draws now.
- `CT-LIFE-004` (`chain`): at 44 rows the six groups no longer fit with the preview region drawn. Raise the terminal's rows, as `ct_compaction.py` did.
- `CT-LIFE-007` (`ct-mid-session`): neither way of enabling chat-toc mid-session gets the Pane to list the session. Find whether the driver or the plugin is wrong before changing either.

Spec: [chat-toc 0.2](../spec.md) §11 ("Each release runs every MUST of the features it contains, old and new, on 2.1.287 and the current version").

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `CT-COMPAT-003`, `CT-LIFE-004` and `CT-LIFE-007` pass on 2.1.287 and the current host
- [ ] The whole MUST list, perf included, passes once on both versions; the result recorded in `mods/chat-toc/release/`

## Comments

Ticket 22 (preview closed until a press) frees the preview's rows by default, so `CT-LIFE-004`'s six groups may fit at 44 rows again; check after 22 lands before raising the rows.
