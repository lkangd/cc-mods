# 14: Compaction rules and context use on the terminal

**What to build:** A dashed rule on the list's rail where each compaction fell (`╌ Compacted 14:32 ╌╌╌`, or `Auto-compacted`), placed by its trigger and position so no Turn group is cut; a dim top line when earlier turns are not in this session's file; and the context use ("62% used") in the footer and the band, hidden from a compaction until the next response.

Spec: [chat-toc 0.2](../spec.md) §4 (compaction boundaries, the fork line's condition), §5.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] The chain's `compact_boundary` rows are kept with trigger and timestamp and placed: manual after the `/compact` entry; auto at a submit before its group; auto mid-turn after its group (a running group's below it at the list's end); auto between turns between the groups (unit tests, one per case, from the transcript facts in ticket 05's assets)
- [ ] The rule is a non-pressable `Text` row, dashed, breaking the rail in every Layout; a day's rule goes before it where both meet; entries above are not dimmed
- [ ] Rules show under every View filter, placed between the groups shown; several between two shown groups fold into `×N` with the last one's time; the Minimap carries no mark
- [ ] The fork line `Earlier turns are not in this session's file` / `更早的轮次不在本会话的文件里`, dim, at the list's top, when the chain starts at a boundary whose `logicalParentUuid` is not in the file or the first boundary precedes every group
- [ ] Context use read at `session.start`, every `session.measure` and after a hot reload; shown only with a `percent`; hidden at `session.compact` and when a read finds a new boundary, until a `measure` brings a `percent`; always dim
- [ ] Footer `38 turns · context 62% used` → `38 turns · 62% used` → left out as the width shrinks to 36 columns, Chinese forms as the spec; the band's counts gain `· context 62% used`
- [ ] Both versions behave alike (no version switch)
- [ ] `CT-CMPCT-001` and `CT-CTX-001` added to the PTY drivers and the release gate's MUST list, passing on both versions; `CT-LIFE-003` and `CT-LIFE-005` updated as the spec says
- [ ] The search ticket (16) keeps the rules during a query; if this lands after it, this ticket covers that instead
- [ ] Root README: "What it shows" (compaction rules, the fork line, context use), known limits 3 and 4 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
