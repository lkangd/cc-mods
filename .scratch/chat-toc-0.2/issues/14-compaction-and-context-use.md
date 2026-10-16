# 14: Compaction rules and context use on the terminal

**What to build:** A dashed rule on the list's rail where each compaction fell (`╌ Compacted 14:32 ╌╌╌`, or `Auto-compacted`), placed by its trigger and position so no Turn group is cut; a dim top line when earlier turns are not in this session's file; and the context use ("62% used") in the footer and the band, hidden from a compaction until the next response.

Spec: [chat-toc 0.2](../spec.md) §4 (compaction boundaries, the fork line's condition), §5.

**Blocked by:** none

**Status:** resolved

- [x] The chain's `compact_boundary` rows are kept with trigger and timestamp and placed: manual after the `/compact` entry; auto at a submit before its group; auto mid-turn after its group (a running group's below it at the list's end); auto between turns between the groups (unit tests, one per case, from the transcript facts in ticket 05's assets)
- [x] The rule is a non-pressable `Text` row, dashed, breaking the rail in every Layout; a day's rule goes before it where both meet; entries above are not dimmed
- [x] Rules show under every View filter, placed between the groups shown; several between two shown groups fold into `×N` with the last one's time; the Minimap carries no mark
- [x] The fork line `Earlier turns are not in this session's file` / `更早的轮次不在本会话的文件里`, dim, at the list's top, when the chain starts at a boundary whose `logicalParentUuid` is not in the file or the first boundary precedes every group
- [x] Context use read at `session.start`, every `session.measure` and after a hot reload; shown only with a `percent`; hidden at `session.compact` and when a read finds a new boundary, until a `measure` brings a `percent`; always dim
- [x] Footer `38 turns · context 62% used` → `38 turns · 62% used` → left out as the width shrinks to 36 columns, Chinese forms as the spec; the band's counts gain `· context 62% used`
- [x] Both versions behave alike (no version switch)
- [x] `CT-CMPCT-001` and `CT-CTX-001` added to the PTY drivers and the release gate's MUST list, passing on both versions; `CT-LIFE-003` and `CT-LIFE-005` updated as the spec says
- [ ] The search ticket (16) keeps the rules during a query; if this lands after it, this ticket covers that instead
- [x] Root README: "What it shows" (compaction rules, the fork line, context use), known limits 3 and 4 of the spec
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

- Done on `chat-toc-0.2/14-compaction`. Placement, the fold and the fork line's condition are pure (`hooks/compactions.ts`: `compactionsOf`, `rulesAmong`, `layRules`, `hasEarlierTurnsElsewhere`); unit tests in `tests/compactions.test.ts`, element-tree tests in `tests/compaction_rules.test.ts` and `tests/context_use.test.ts`.
- The search item stays open for ticket 16, which lands after this one: `rulesAmong(compactions, shown)` takes the group indices shown, whatever left them, so the list under a query places its rules by the same function. `CT-CMPCT-001`'s query part is added with search.
- PTY (`tests/acceptance/ct_compaction.py`, both 2.1.287 and 2.1.295 pass): `fixture` (manual, at a submit, mid-turn, `×3`; card/compact/timeline; All/User/Agent; checked by the verifier's own placement), `fork` (the fork line above the first rule), `live` (CT-CTX-001 against `fake_api.py` stating `usage`; also records CT-LIFE-003's `/compact` change). CT-LIFE-005's fork case in `chain_scenarios.py` now requires the fork line; CT-LIFE-003 there still passes with rules on the list.
- The footer's long, short and no context form are chosen by fit beside the Layout Button (2-cell gap), not by a fixed width: at 36 columns the Chinese card Layout still fits `N 轮 · 上下文已用 47%`; the timeline Layout shows `N 轮 · 已用 47%` (the PTY check).
- Found on the way: the band's open Button had a `Text` child, which 2.1.287 refuses ("JSX element <Button> needs a label"), so the band never drew on 2.1.287. It now carries a string label with a `hover` colour.
