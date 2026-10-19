# Decide how compactions and context use show

Type: grilling
Status: resolved
Blocked by: 01, 05

## Question

How does a person see what Claude now holds only as a summary, and how full the context is?

- How a compaction shows on the rail (a rule like the day's rule, its words, its time), where it goes when it falls inside a Turn group, and how it reads in each Layout and on the Minimap.
- Whether the context use goes in the footer, its words, when it is absent or stale, and whether it would read as an alarm.
- For a forked session: whether to read the earlier groups from the parent transcript (if the fork ticket finds a way), and how those groups show, given they have no Jump target.
- The words on screen in both languages, and the glossary term.

## Answer

Decided with the user on 2026-10-16. The terms **Compaction** and **Context use** are in [`mods/chat-toc/CONTEXT.md`](../../../mods/chat-toc/CONTEXT.md).

**The compaction rule.** One row across the list, like the day's rule, but dashed so the two are told apart: `╌ Compacted 14:32 ╌╌╌` / `╌ 已压缩 14:32 ╌╌╌`, and `Auto-compacted` / `自动压缩` when `compactMetadata.trigger` is `auto` (under the Agent View filter the `/compact` entry is hidden, so the word carries the trigger). The time is the boundary row's `timestamp`; no `preTokens → postTokens`. A `Text`, not pressable. The entries above it are not dimmed (dim already means a refused jump). It breaks the rail as the day's rule does, in every Layout.

**Where it goes** (a Turn group is never cut by it):
- Manual: **after** the `/compact` entry, although on the chain the boundary comes before the command row; read top-down, "I typed /compact, it compacted, what follows is the new context".
- Auto at a submit (the boundary inside the new group, after its opener): **before** that group; Claude worked on it after the compaction.
- Auto mid-turn: **after** the group, the cautious reading: at least part of it Claude now holds only as the summary. A running group gets it below, at the list's end, until the next group comes.
- Auto between turns: between the two groups, where it falls.
- Where a day's rule and a compaction rule meet, the day's rule goes first.

**View filter and search.** Compaction rules always show, whatever the View filter or query, placed between the groups shown; during a search one says that a match lies before a compaction. Several between two shown groups fold into one row with the last one's time and a count: `╌ Compacted ×3 · 14:32 ╌` / `╌ 已压缩 ×3 · 14:32 ╌`.

**Minimap.** No mark: its time row would collide with one, and a session holds 1 to 5 compactions, which the list's rules show.

**A forked session.** The parent transcript is not read (only unpublished fields lead to it, it may be in another projects folder or deleted, and its groups would have no Jump target). When the chain starts at a boundary whose `logicalParentUuid` is not in this file, a dim line goes at the top of the list, above that first rule: `Earlier turns are not in this session's file` / `更早的轮次不在本会话的文件里`. It states the fact; no cause, no "fork". The same covers the resumed files whose first boundary comes before any group. The README's "not promised" list: a forked session does not show the parent's turns.

**Context use.** `$.session.usage().context.percent` as given (of the whole window, a whole number), never turned into "left until auto-compact". It says "used", because the host's own line, `Context left until auto-compact: 8%`, counts what is left.
- The Pane's footer, left, after the count: `38 turns · context 62% used`, narrower `38 turns · 62% used`, narrower still the context use is left out and `N turns` stays. Chinese: `38 轮 · 上下文已用 62%`, narrower `38 轮 · 已用 62%`.
- The band above the prompt too, after its counts: `… · Agent 80 steps · context 62% used` / `… · Agent 80 步 · 上下文已用 62%`.
- Read at `session.start`, at every `session.measure` (whatever `changed` says) and after a hot reload. Shown only when `percent` is there; absent, the whole part is left out, no placeholder.
- Hidden at once at `session.compact` (no `measure` follows a compaction, and the old figure lingers about 500 ms), and kept hidden until a `measure` brings a `percent` back; likewise when a transcript read finds a new boundary (after a hot reload).
- Always dim, never coloured, nothing near the threshold: the host warns before an auto compaction itself; this only states the figure.

**Desktop.** The compaction rule is an Svg like the day's rules, placed by the same rules. The context use goes on Desktop's line under the strip (first group's time, `N turns`, last group's time), only when `usage()` gives a `percent`. `usage()` on Desktop is not measured: the user checks it in the Claude app; with no figure nothing shows, and the README does not promise it there. The fork line is as on the terminal.

**No version switch**: `$.session.usage()`, `session.measure` and `session.compact` behave alike on 2.1.287 and 2.1.295.

**Left for the spec ticket**: the README's "not promised" lines (a fork's parent turns; context use on Desktop) and the `CT-*` scenarios.
