# chat-toc 0.2

Status: ready-for-agent

> Summed up from the eleven decision tickets of the [chat-toc 0.2 map](map.md). It builds on the [MVP spec](../chat-toc/spec.md) and changes only what it says it changes; everything else there stands. The grounds and measured numbers for each decision are in its ticket; this file holds the conclusions, and the ticket names in parentheses point to the source. Terms follow [`mods/chat-toc/CONTEXT.md`](../../mods/chat-toc/CONTEXT.md) (new: Search, Preview, Reuse, Compaction, Context use). Words on screen are quoted in English with the Chinese twin after a slash; both go in `mods/chat-toc/hooks/text.ts`.

## Problem Statement

chat-toc 0.1 shows the shape of a long session and jumps back to any turn, but the person still has to know which turn they want by its first two lines and the time. They cannot find a turn by a word or a file it touched; reading a whole prompt or reply means jumping away from where they are (and on Desktop, where jumps are refused, reading it at all is impossible); taking an earlier prompt back to send again means scrolling to it and copying by hand; nothing says where the conversation was compacted or how full the context is; stepping turn by turn needs the mouse or the Pane's focus; and how long a turn took and how much it wrote is buried in the transcript.

## Solution

Seven additions to the same Pane, from the same transcript, keeping every standing principle of the MVP (nothing written to disk, no archive, `$.store` for preferences only, no model calls, no made-up numbers or text):

1. **Search**: a field always drawn under the tab rule narrows the list to the Turn groups whose User input, last text or touched file paths hold every word typed.
2. **Preview**: a press on an entry opens a region at the bottom showing that Turn group whole, with a meta line; it expands into the list's place, and `✕` closes it. Closed until a press.
3. **Reuse and copy**: Buttons in the preview put the User input back into the composer as a draft, copy it, or copy the last text.
4. **Compactions and context use**: a dashed rule on the rail where each compaction fell; "62% used" in the footer and the band.
5. **Previous and next turn keys**: two Buttons `‹ ›` that step the transcript group by group, pressable by keys the person binds to two borrowed actions, opt-in, terminal only.
6. **Files a turn touched**: a match field of search and a line of the preview (not a feature of its own).
7. **Duration and tokens**: in the preview's meta line, only when the transcript states them.

Every addition is specified for the terminal and Desktop; where one does not apply, it says so.

## User Stories

Numbered on from the MVP's 30.

31. As a person in a long session, I want to type a few words or part of a file path and see only the turns that hold them, so that I find a turn without scrolling.
32. As a person searching, I want the search to look only at the sides the View filter shows, so that "User" finds what I said and "Agent" what Claude answered.
33. As a person searching, I want Enter to jump to the match nearest where I am and end the search, so that finding and going there is one motion.
34. As a person searching, I want my query kept when I switch the filter or Layout, a new turn arrives, or I close and reopen the Pane, so that I do not type it again.
35. As a person, I want to read a turn's whole prompt and last reply without jumping, so that I keep my place in the conversation.
36. As a person, I want the preview to open only when I press an entry (or end a search on one), and to stay on that turn until I press another, so that it takes no room until I ask and does not change under me.
37. As a person, I want the preview to say when the turn was, its state, its steps, how long Claude worked and how many tokens it wrote, only when the transcript states them, so that I can trust every figure.
38. As a person, I want the preview to list the files the turn changed and read, so that I see what it touched.
39. As a person reading a long reply, I want to expand the preview over the list and scroll it, then go back, so that I can read it whole in the Pane.
40. As a person done reading, I want a `✕` (or `p`) to close the preview, and the Pane to open without it, so that the list has the rows back.
41. As a person, I want to put an earlier prompt back into the composer as a draft, never sent for me and never overwriting what I am typing, so that I can edit and resend it.
42. As a person, I want to copy an earlier prompt or Claude's last reply of any turn, so that I can keep it elsewhere.
43. As a person, I want to see where the conversation was compacted, manually or automatically, so that I know which turns Claude now holds only as a summary.
44. As a person, I want to see how full the context is, so that I can compact or clear before it fills.
45. As a person typing in the composer, I want keys of my choosing to jump to the previous or next turn, so that I step through the conversation without the mouse.
46. As a person in a forked or resumed session, I want to be told when earlier turns are not in this session's file, so that I do not take the list for the whole conversation.
47. As a person on Desktop, I want to search, preview and copy as on the terminal, so that the Pane is useful where jumps are refused.

## Implementation Decisions

### 1. The Pane's layout (terminal)

Top to bottom (Prototype the Pane's layout with the new parts; revised by the search and preview tickets):

1. The filter row and its tab rule (2 rows), as in the MVP.
2. **The search row** (1 row), always drawn: the `f: Find` / `f: 搜索` Button, the field, and at its right end the match count once there is a query (`4 of 38` / `4 / 38`), the `✕` Button while there is a query, then `‹ ›` (§6). Never hidden for want of rows.
3. The Minimap (3 rows), as in the MVP.
4. The fork line when it applies (§5), then the list (at least 8 rows), its day rules and compaction rules one row each.
5. The notes line when needed, as in the MVP.
6. **The preview** (§3), only while open: its rule row, with the `✕` Button at its right end, and content.
7. The footer (2 rows): `N turns` and the context use on the left (§5), the Layout Button on the right.

**When rows run short**, in order: the Minimap goes (as in the MVP); then an open preview shrinks to 4 rows; when even 4 rows do not fit beside the list's floor, a press opens the preview expanded (§3). The list keeps its 8-row floor and the search row stays. No line stands for a closed preview.

**Hotkeys** (each hangs on a drawn Button, so each works only while the Pane holds the keys and that Button is drawn; none works while the search field has the keys, since a focused field takes every printable key): `1` `2` `3` View filter, `l` Layout (MVP); `f` Find, `p` close the preview (on its `✕`, so only while it is open), `e` expand, `r` Reuse, `c` copy the User input, `a` copy the last text. `/` cannot be a hotkey (one digit or one lowercase letter only). Previous/next turn adds none. (Decide how search works; Decide what the preview shows and how it opens; Decide how an earlier prompt is reused)

**The focus ring** steps over the Minimap's cells (MVP) and the `‹ ›` Buttons; the other new Buttons and the field are stops in the order they are drawn.

### 2. Search

(Decide how search works; Probe an Input in the docked Pane)

- **What it does**: a query narrows the list to the matching Turn groups; nothing is stepped through. The count reads matches of all groups. With no match the list area holds one line, `No turns match` / `没有匹配的轮次`.
- **Fields**: the User input as typed (§4); the Agent reply's last text, whole; the paths of the files the group touched (§4). Not `Glob`/`Grep` roots, intermediate text, thinking or tool output: the Pane shows none of them.
- **The View filter applies**: All searches every field; User only the User input; Agent only the last text and the paths.
- **Rules**: the query splits on spaces and every word must be found (AND) in any field of the group; case-insensitive after NFKC; plain substrings, CJK included (no segmentation); a path matches as a substring of its absolute form. No regex, fuzzy match or quoted phrases.
- **Live**: a new turn that matches joins the list; a running group is matched as it grows.
- **Getting in**: a click on the field, or `f` (a plain Button calling `$.ui.focus` on the field, only while the Pane holds the keys). No `autoFocus` (every Ctrl+X Tab would land in the field and break the hotkeys). Placeholder `words or a file path` / `词或文件路径`. `submitLabel` reads `jump` / `跳转`.
- **While a query is set**: the list keeps in view the match nearest the Current position (the nearest at or before it, else the first after it); the rail's `◉` shows only when the Current position's group is itself a match; pausing and resuming the follow as in the MVP. The Minimap still draws every group and its presses still jump, but the lit cells are the matches (a bucket lit when any of its groups matches) and the Current position is not marked there; with no match every cell is dim. No word in an entry is marked.
- **Keys**: Enter in the field jumps to the nearest match, opens the preview on it (§3) and ends the search (the list back to all, the jumped group lit), going with the host emptying the field on Enter; with no match it only clears the query. ↓/Tab go on to the matches; Enter on an entry jumps, opens the preview on it and keeps the search. Esc gives the keys back to the composer and keeps the query. Clearing: Ctrl+U or Backspace to empty, Enter as above, or the `✕` Button (no hotkey), drawn only while there is a query.
- **Kept**: the query is a `$.state` atom controlling the field's `value`. It survives a Layout or View filter switch, new turns, a back tab and closing and reopening the Pane, until the process ends. Never in `$.store`.
- **The index** (user's decision on the map's performance fog, 2026-10-16): each group's searchable text (its fields, NFKC-normalised and lower-cased, kept per field so the View filter can pick) is built with the groups at regroup, and an incremental read rebuilds only the groups it changed. A keystroke filters these strings; it never reads the file.

### 3. Preview

(Decide what the preview shows and how it opens; Prototype the Pane's layout with the new parts)

- **Opening and which group** (user's decision after the Desktop look, 2026-10-17): closed until a press. A click on an entry, or Enter on it, jumps as before and opens the preview on that entry's group; Enter in the search field opens it on the match it jumps to (§2). Moving the focus ring opens nothing and changes nothing. Once open it holds the group last pressed: the Current position, new turns, a View filter switch or a query that leaves the group out of the list do not change it; another press moves it to that group. A Minimap cell, `‹ ›` and the band open nothing. It closes when its group leaves the transcript (a rewind, `/clear`, another session).
- **Contents, top to bottom**:
  1. The meta line, 1 row, always kept: `Oct 16 14:32 · 12 steps · 3m 20s · 3.5k out` / `10月16日 14:32 · 12 步 · 3 分 20 秒 · 输出 3.5k`. The date always, today too. A state only when not finished, after the time, in the MVP's words (`Running` / `进行中`, `Interrupted` / `已中断`, `Error` / `出错`). Steps as in the MVP (0 left out). Duration and output tokens as in §4. A field that cannot be read is left out, with no placeholder. While a query is set it ends with the fields that matched: `matched: User · Agent · files` / `匹配：用户 · Agent · 文件`.
  2. A dim label row `User` / `用户` (with the reuse Buttons, §7), then the User input as typed (plain text).
  3. A dim label row `Agent` / `Agent` (with its copy Button), then the last text, whole, in a `Markdown`, not dimmed.
  4. The files line, left out when none: `changed register.tsx, pane.tsx +1 · read 5` / `改 register.tsx, pane.tsx +1 · 读 5`. While a query is set, a matching path goes first.
  A group with no Agent reply holds only the meta line and the User input. A running group is redrawn as rows arrive: the steps so far and the latest text written so far as the Agent part (none until there is text); it stays at its top.
- **Size**: the region's height is fixed by the rule, never by the content: 40% of the rows left after the head, the search row and the footer, held between 4 and 14 rows, the rule row included; a short group leaves blank rows. Past the region the content is cut, the files line first, then the Agent text, then the User input; the meta line stays. The last row then reads `↓ 12 more lines · e: expand` / `↓ 还有 12 行 · e: 展开`, a Button.
- **Expanded**: `e` (or a press on the cut line) expands the preview into the rows of the list and the Minimap; the filter row, the search row and the footer stay. Everything is drawn uncut, the files one per line under `Changed` / `改过` and `Read` / `读过`, up to the text cap below. The whole tree is scrolled by the host (wheel, PgUp/PgDn, ↑↓ with no control in reach): the scroll hook lets the person's scrolls through instead of keeping its own offset. It holds that one group: neither the Current position nor new turns change it. `e` again, or the `← Back · e` / `← 返回 · e` Button at its top, returns to the list. Leaving the Pane returns to the region. A press opened expanded for want of rows (§1): `← Back` closes the preview. `✕` closes it from either.
- **Text cap** (user's decision, 2026-10-16): a tree draws only its first 100,000 characters, so the plugin cuts the expanded preview's User input and last text to about 60,000 characters together. Where a part is cut, one line follows it: `… 12,345 more characters not shown · c: Copy` / `… 还有 12,345 字未显示 · c: 复制` (the last text's says `a: Copy`; Desktop drops the key). The region (not expanded) cuts by rows long before this. Copying and Reuse always use the whole text.
- **Closing**: the rule reads `Preview` / `预览` and ends in a `✕` Button (hotkey `p`) that closes it; closed, nothing of it is drawn and the list takes its rows. Not kept: in memory only, closed whenever the Pane opens and when the process starts; `$.store` holds nothing of it.
- **Markdown on 2.1.287**: if the older host draws no `Markdown`, the last text is drawn there as plain `Text` (switched by `$.session.version()`), the rest of the preview unchanged.
- **The Minimap** keeps its bars by steps: no switch to tokens or duration.

### 4. Facts read from the transcript

All held in memory with the groups, rebuilt from the file, never written anywhere. (Read the transcript facts the new features rest on)

- **The User input as typed**: the opener's text with code blocks and pasted content restored (not the folded entry line); a slash command as `/name args`, a `!cmd` as `!cmd`; an image-only input as the MVP's `(image only)`; whether the input also held images is kept for Reuse.
- **Files touched**: changed are `Edit`/`Write` `file_path` and Bash's `toolUseResult.bashEditDiff.changedFiles`; read is `Read` `file_path` only; a file both read and changed counts as changed. All absolute in the file; search matches the absolute form; the preview shows a path relative to the session's working directory when under it, else absolute with `~` for `$HOME`. A Bash command's text is not parsed.
- **Duration**: the sum of the group's `turn_duration` rows' `durationMs` (several where background notifications started more model turns): the model's working time. No such row (every Desktop file, most interrupted turns): no duration, never estimated from timestamps. A running group shows its state, no ticking clock. Format `45s` / `45 秒`, `3m 20s` / `3 分 20 秒`, `1h 5m` / `1 小时 5 分`, `<1s` / `<1 秒`.
- **Output tokens**: the main chain's assistant rows' `usage.output_tokens`, each `message.id` counted once (every row of one id carries the same `usage`). Under 1000 as is, then `3.5k`, `1.2M`; labelled `out` / `输出`. Input-side sums are not shown (mostly cache reads, reading as spent). Subagents' tokens are not counted and not marked.
- **Compaction boundaries**: each `system/compact_boundary` on the chain with its `compactMetadata.trigger` and `timestamp`, placed against the groups as §5 says. A Turn group is never cut by one.
- **The fork line's condition**: the chain starts at a boundary whose `logicalParentUuid` is not in this file, or the file's first boundary comes before any group.

### 5. Compactions and context use

(Decide how compactions and context use show; Find whether a forked session's transcript leads back to its parent)

- **The compaction rule**: one row across the list, like the day's rule but dashed: `╌ Compacted 14:32 ╌╌╌` / `╌ 已压缩 14:32 ╌╌╌`, or `Auto-compacted` / `自动压缩` when the trigger is `auto`. The time is the boundary row's `timestamp`; no token figures. A `Text`, not pressable; the entries above it are not dimmed. It breaks the rail as the day's rule does, in every Layout.
- **Where it goes**: manual, **after** the `/compact` entry; auto at a submit (the boundary inside the new group after its opener), **before** that group; auto mid-turn, **after** the group (a running group gets it below, at the list's end, until the next group comes); auto between turns, between the two groups. Where a day's rule and a compaction rule meet, the day's rule goes first.
- **View filter and search**: compaction rules always show, placed between the groups shown. Several between two shown groups fold into one row with the last one's time and a count: `╌ Compacted ×3 · 14:32 ╌` / `╌ 已压缩 ×3 · 14:32 ╌`. The Minimap carries no mark.
- **A forked or resumed file**: the parent transcript is not read. When §4's condition holds, a dim line goes at the top of the list, above the first rule: `Earlier turns are not in this session's file` / `更早的轮次不在本会话的文件里`. No cause, no "fork".
- **Context use**: `$.session.usage().context.percent` as given, a whole number of the whole window, worded "used".
  - The footer's left, after the count: `38 turns · context 62% used`, narrower `38 turns · 62% used`, narrower still left out. Chinese: `38 轮 · 上下文已用 62%`, narrower `38 轮 · 已用 62%`.
  - The band above the prompt, after its counts: `… · Agent 80 steps · context 62% used` / `… · Agent 80 步 · 上下文已用 62%`.
  - Read at `session.start`, at every `session.measure` (whatever `changed` says) and after a hot reload; shown only when `percent` is there, else the whole part is left out.
  - Hidden at once at `session.compact` and kept hidden until a `session.measure` brings a `percent`; likewise when a transcript read finds a new boundary.
  - Always dim, never coloured, nothing near the threshold.
- No version switch: `usage()`, `session.measure` and `session.compact` behave alike on 2.1.287 and 2.1.295.

### 6. The previous and next Turn group

(Decide the previous and next turn keys; Probe whether a Button's action can serve as a global key)

- **Buttons**: `‹` and `›`, two `plain` Buttons at the search row's right end, after the count and `✕`; no hotkey; not in the focus ring. A click steps as below. Not drawn on Desktop.
- **Keys, opt-in, terminal only**: the Buttons carry the borrowed actions `app:toggleDiffNoiseFilter` (previous) and `app:toggleDiffPreSession` (next), named as constants. chat-toc binds no key; the person binds them. Nothing in the Pane or band tells about the binding.
- **What a step does**: from the **Current position** (not the selection) to the group before or after it, even when the view sits mid-way through the current group; the Current position then locks on the target, so repeated presses walk group by group. It walks only the groups the list shows (the View filter, and during a search only the matches, without ending it). It jumps to the side the View filter shows: the user side's Jump target under All and User, the Agent side's under Agent. At either end, nothing; "next" on the last group does not scroll to the end. A group without a Jump target is skipped for the next one in that direction that has one; when none has one, the click's notice ("This entry is not in the conversation view now; cannot jump to it"), on the notes line while the Pane is on screen, else as a toast.
- **The band** is now drawn whenever the Pane is not on screen: closed, undrawn, or a back tab (`$.ui.panes()`'s `isShown: false`), and carries the same `‹ ›` with the same actions. While the Pane is on screen the band is not drawn. A collapsed band answers nothing. This revises the MVP's "chat-toc does nothing when pushed back" (§2) by drawing the band; it still takes no focus and gives no notice.
- **Measured first, both outcomes written**:
  - Whether `$.ui.scroll` moves the transcript from a press that came by a bound key. If yes, the README documents the binding (below). If refused, only the clickable `‹ ›` stay, the keys leave the README, and the "not promised" list says the keys cannot step.
  - Whether the host redraws the band when the Pane becomes or stops being a back tab. If not, the README says the keys may not answer while the Pane is a back tab.
- **The README's binding section**: a `keybindings.json` snippet, in `Global`: `meta+k` → `app:toggleDiffNoiseFilter`, `meta+j` → `app:toggleDiffPreSession`; why the names do not match; that macOS terminals need Option sent as Meta; modified keys, not chords (an unanswered chord leaks its second key into the composer).

### 7. Reuse and copy

(Decide how an earlier prompt is reused; Probe how prompt.fill and ui.copy behave)

- **Three Buttons on the preview's label rows**, acting on the group the preview shows: `User    r: Reuse · c: Copy` / `用户    r: 填入 · c: 复制`; `Agent    a: Copy` / `Agent    a: 复制`. With the preview closed none of them works; when a short preview cuts the `Agent` label row, `a` goes with it until `e`.
- **Reuse**: `$.prompt.read()` first; empty, fill with `replace`; holding a draft, `append` after a blank line. Never submitted. While Claude works the fill lands and Enter queues it (the host's behaviour). A fill moves the keyboard to the composer; a copy leaves it in the Pane.
- **What text**: the User input as typed (§4); the last text as its Markdown source. A slash command fills as `/name args`. A `!cmd`: no `r: Reuse` (a fill cannot enter bash mode); `c: Copy` copies `!cmd`. Image-only: neither `r` nor `c`. Text with images: only the text, and a toast `Images not included` / `图片未包含`. A running group: no `a: Copy`.
- **Told**: a successful fill, nothing more. A failed fill, a toast: `Couldn't fill the prompt: a dialog is open` / `无法填入：有对话框打开` (`refusal: 'dialog'`; the text is dropped), `Couldn't fill the prompt: another plugin refused` / `无法填入：被其他插件拒绝` (`isFilled: false`, no refusal). A copy: the Button reads `Copied` / `已复制` for about 2 seconds; `isCopied: false` gives a toast with the reason (`Too long to copy here` / `太长，无法在此复制` for Desktop's limit).
- **Nothing kept**: the actions read the transcript at the press.

### 8. Desktop

(each decision ticket's Desktop part; the MVP's §7 "Other surfaces")

- **Search**: a native field under the segmented control, without the `f` Button; a click gives it the keys. Each change filters (IME composition letters too; the commit corrects it). Enter, or the `show` / `预览` button (the `submitLabel`), keeps the text and cannot jump: it opens the preview on the nearest match, the newest match there being no Current position. A `✕` Button after the field, drawn only while there is a query, empties it. The field, `show`, `✕` and the count line up with the head row above in height and width. The Svg strip draws matches in the accent colour and the rest dim.
- **Preview**: as the terminal, same place, contents, order and cutting, the text in a native `Markdown`; closed until an entry is pressed, then holding the last entry pressed, with the terminal's rules for what keeps or closes it. No hotkeys: the `✕` at the rule's right end a Button closing it, the cut line a Button expanding it, `← Back` a Button; the words drop `e:`. It is set apart from the list so that the two do not run together (the user's look, 2026-10-17: they did).
- **Scrolling** (the user's look, 2026-10-17): Desktop did not scroll a tree taller than the pane, and the list's top entries could not be reached. The whole list and the whole preview must be reachable on Desktop; how is measured first (ticket 23).
- **The head row**: the segmented control and the Layout `Select` are the same height and centred on one line.
- **Reuse and copy**: copy only, a `Copy` / `复制` Button on each label row; no Reuse (the host answers `isFilled: true` while the text sometimes never shows). Reuse is switched on by `$.session.version()` once a host shows fills reliably.
- **Compactions**: the rule is an Svg like the day's rules, placed by §5's rules; the fork line as on the terminal.
- **Context use**: on the line under the strip (first group's time, `N turns`, last group's time), only when `usage()` gives a `percent`.
- **Previous/next**: nothing (`action` is the terminal's only, and Desktop refuses the transcript's scroll).
- **Duration**: none, Desktop writes no `turn_duration` rows; the meta line leaves it out.

### 9. Privacy

- `$.store` holds the View filter and the Layout; nothing else. Whether the preview is open and on which group live in memory only. The query lives in `$.state`, in this process only. Search text, file paths, duration and tokens are held in memory with the groups and never written anywhere. A copy or fill sends text to the clipboard or the composer only on the person's press. (Map Notes)

### 10. Performance

New limits on the reference machine, with the MVP's two 20 MiB fixtures (many: 4432 turns; heavy: 111 turns), three runs per version, the p95 (user's decision on the map's performance fog, 2026-10-16):

| Item | Limit |
|---|---|
| A keystroke in the search field to the Pane redrawn, the plugin's own work | ≤ 50 ms |
| The same, waiting on the host included | ≤ 100 ms |
| Whole read and regroup when idle, the search index included | ≤ 1 s (unchanged) |
| Incremental read, each, the index's rebuild included | ≤ 150 ms (unchanged) |
| Pane redraw with the preview open, the plugin's own work | ≤ 16 ms (unchanged) |

The MVP's other limits stand.

### 11. Release and docs

- Releases follow the MVP's §10; this spec does not group features into releases. Each release runs every MUST of the features it contains, old and new, on 2.1.287 and the current version.
- **The root README** changes with each feature it ships: the controls table (search, `f`, `p`, `e`, `r`, `c`, `a`, `‹ ›`), "What it shows" (the preview, compaction rules, the fork line, context use), the binding section (§6), data and privacy (`$.store` unchanged: the preview's open state is not kept), and the known limits below.
- **`mods/chat-toc/README.md`**: the folder layout and the new PTY drivers.

## Testing Decisions

Levels, the gate, the automated layer, PTY acceptance, the verifier and the report are as in the MVP's Testing Decisions. New and changed scenarios (all MUST unless said):

**New**

- `CT-FIND-001`: a query narrows the list to matches, with the count; every word must match (AND), any case, NFKC, CJK substrings, a path's substring; under User only the User input and under Agent only the last text and paths match; no match shows `No turns match`; a new matching turn joins the list.
- `CT-FIND-002`: `f` and a click focus the field; Enter jumps to the nearest match and ends the search; Enter on an entry jumps and keeps it; Esc keeps the query; `✕`, Ctrl+U and Enter with no match clear it; the query survives a filter switch, a Layout switch, a back tab and a close and reopen; the Minimap lights the matches.
- `CT-PREV-001`: no preview until a press; a click or Enter on an entry opens it on that group, Enter in the search field on the match it jumps to; ↑↓, scrolling the transcript, new turns and a filter switch leave it on that group; `✕` and `p` close it, a reopened Pane and a restart start closed; the meta line's fields, with duration and tokens left out on a fixture without `turn_duration` or `usage`; output tokens counted once per `message.id`; the files line's changed/read split and relative paths; cut by the rule with `↓ N more lines · e: expand`; the shortage order at a short height, a press there opening it expanded.
- `CT-PREV-002`: `e` expands over the list, the host scrolls it, `e` and `← Back` return; a 200,000-character pasted input shows the cap line and the footer still draws; a running group is redrawn as it grows.
- `CT-REUSE-001`: `r` fills an empty composer and appends after a draft, never submits; `c` and `a` reach the clipboard and the Button reads `Copied`; a `!cmd` has no `r`, an image-only input no `r` or `c`, a running group no `a`; a fill under a dialog gives its toast.
- `CT-CMPCT-001`: a manual compaction's rule after the `/compact` entry, an auto one at a submit before its group, one mid-turn after its group; rules show under every View filter and query; three in a row fold to `×3`; a file starting at a foreign boundary shows the fork line.
- `CT-CTX-001`: the context use is absent before the first response, appears in the footer and band after it, hides at `/compact` and returns with the next response; the narrower footer forms at 36 columns.
- `CT-STEP-001`: the `‹ ›` Buttons step from the Current position over the shown groups (a View filter and a query applied), skip unjumpable groups, do nothing at the ends; the band draws them while the Pane is closed or a back tab. **Keys**: with `meta+j`/`meta+k` bound, the same from the composer, during a turn too. The key part is a MUST only if the measurement in §6 finds the scroll allowed; otherwise it is dropped and the README says so.
- `CT-PERF-002`: §10's search limits on both fixtures and both versions, the results in the release report's table.

**Changed**

- `CT-SEC-001`: the unique marker also goes into a query, a reused and a copied prompt; it appears nowhere but the Pane, the composer and the clipboard; `$.store` holds only the View filter and the Layout.
- `CT-UI-001`, `CT-UI-002`: the search row and the preview are drawn in all three Layouts at 36, 44 and 56 columns; the preview opened by a press; the query and the preview's group survive the switch.
- `CT-UI-003`: the focus ring steps over `‹ ›` as over the Minimap's cells (§1).
- `CT-COEX-001`: with `cc-plugin-diff`'s Pane in front, chat-toc's band draws with `‹ ›`; chat-toc still takes no focus.
- `CT-LIFE-003`: after `/compact` the rule shows after the `/compact` entry and the context use hides until the next response.
- `CT-LIFE-005`: a `--fork-session` file shows the fork line.
- `CT-PERF-001`: run with the preview open.
- Desktop (element-tree tests, plus the user's look in the Claude app, not a MUST): the search field and its `✕`, the preview closed until a press and its Buttons, copy only, the compaction Svg, the context use on the strip's line; the list and the preview reachable by scrolling; the head and search rows aligned.

**Automated layer gains**: the search matcher (AND, NFKC, CJK, paths, the View filter's fields); the index's incremental rebuild agreeing with a whole build; the facts of §4 (input as typed, files, duration sums, tokens once per `message.id`); compaction placement in all four cases and the `×N` fold; the fork line's condition; the preview's size rule, cut order and text cap; the Reuse text rules; the words in both languages.

## Out of Scope

**Not in 0.2** (the map's scope):

- Bookmarks.
- Reading a forked session's parent transcript.
- A Minimap switch to tokens or duration; a Minimap mark for compactions.
- Input-side token figures and subagents' tokens.
- Marking the matched words inside entries or the preview.
- Default keys for the previous/next turn; anything on Desktop for it.

**Not promised** (added to the README's known limits):

1. No duration on Desktop, nor for most interrupted turns: the transcript does not state it there.
2. The tokens are the main agent's output only; subagents' are not counted.
3. A forked session does not show the parent's turns; a line says earlier turns are not in this file.
4. Context use on Desktop is not promised (not measured there; shown only when the app gives a figure).
5. No Reuse on Desktop, only copy.
6. On the terminal a copy cannot be confirmed: Claude Code reports success whatever the clipboard got.
7. Images in a prompt are not reused or copied, only its text.
8. The previous/next keys rest on two borrowed action names that a later Claude Code may take; nothing answers while the band is collapsed, possibly nothing while the Pane is a back tab (per §6's measurement), and nothing on Desktop. If the scroll from a key is refused, only the `‹ ›` Buttons step and the keys are not offered.
9. A very long prompt or reply is cut in the expanded preview (copy and Reuse take the whole text).

## Further Notes

- **Probes and prototypes**: the probe mods, PTY drivers and measurement scripts are under `.scratch/chat-toc-0.2/assets/`, reusable as acceptance material; the layout prototype is on the branch `prototype/chat-toc-0.2-pane-layout`, the fork research on `research/chat-toc-fork-parent`; neither is merged.
- **Left to the implementation, checked as it goes**: whether the search row fits `f: Find`, the field, the count, `✕` and `‹ ›` in 36 columns, and whether the preview's label rows fit `r: Reuse · c: Copy` with the Chinese words; whether the host scrolls the whole tree when the scroll hook lets the person's scroll through (terminal; on Desktop it did not, §8); whether `Markdown` draws on 2.1.287 (§3).
- **Implementation tickets**: numbered on from the map's decision tickets, in [`issues/`](issues/), 13 onward.
