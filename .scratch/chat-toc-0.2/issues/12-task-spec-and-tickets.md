# Sum up the 0.2 spec and implementation tickets

Type: task
Status: resolved
Blocked by: 07, 08, 09, 10, 11

## Question

Once every decision is closed, write `.scratch/chat-toc-0.2/spec.md` (referring to the MVP spec, not copying it) and the implementation tickets, with the acceptance scenarios to add or change and the README's "not promised" items. Confirm with the user before closing the map.

## Answer

Confirmed by the user on 2026-10-16. The spec is [`spec.md`](../spec.md): user stories 31–47, eleven sections of decisions, the new and changed `CT-*` scenarios, what is not in 0.2, and nine new "not promised" items. The map's remaining fog was settled while writing it: the hotkeys are 1/2/3, `l`, `f`, `p`, `e`, `r`, `c`, `a` (spec §1); the search index is built ahead with the groups and a keystroke stays ≤ 50 ms on the 4432-turn fixture (user's choice, spec §2, §10); the expanded preview cuts its text at about 60,000 characters with a line saying so (user's choice, spec §3); Desktop is spec §8; the README and `CT-*` changes are in the Testing Decisions and Out of Scope.

Also decided here and confirmed: where 2.1.287 draws no `Markdown`, the last text is plain `Text` there, the rest of the preview unchanged; tickets are cut by feature, Desktop in one ticket, no release ticket (releases follow the MVP's §10), each feature ticket updating the README and the MUST list itself.

Implementation tickets, all `ready-for-agent`:

- [The preview region on the terminal](13-preview-region.md)
- [Compaction rules and context use on the terminal](14-compaction-and-context-use.md)
- [The expanded preview](15-expanded-preview.md) (blocked by 13)
- [Search on the terminal](16-search.md) (blocked by 13, 14)
- [Reuse and copy on the terminal](17-reuse-and-copy.md) (blocked by 13)
- [The previous and next Turn group](18-previous-next-turn.md) (blocked by 16)
- [The 0.2 additions on Desktop](19-desktop-additions.md) (blocked by 14, 15, 16, 17)
- [Search and preview performance on long sessions](20-search-performance.md) (blocked by 15, 16)
