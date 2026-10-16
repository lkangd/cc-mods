# Decide what the preview shows and how it opens

Type: grilling
Status: resolved
Blocked by: 05, 06

## Question

How does a person read a whole Turn group without jumping (and on Desktop, where jumping is refused, at all)?

- What opens it (pressing an entry still jumps on the terminal; so a key, a second press, a separate control?), and what closes it.
- What it holds: the full User input, the Agent reply's last text as Markdown, the state, steps, the files the turn touched, duration and tokens; what is left out when a field cannot be read.
- How long text scrolls inside it, and how it follows when the selected group changes or a running turn grows.
- Whether the Minimap can switch its bar height from steps to tokens (or duration), and where that switch lives.
- The words on screen in both languages, and the glossary term.

Settled by the layout ticket (06): the preview is a bottom region above the footer that follows the Current position (on Desktop, the last entry clicked), `p` shows or hides it, and it shrinks to 4 rows and then leaves when rows run short. Still open here: what it holds and what goes first inside it at 4–5 rows, how it scrolls, and whether its size rule (40%, 4–14 rows in the prototype) stands.

Settled by the search ticket (07): while a query is set, the preview shows the match nearest the Current position (on Desktop, the match put there by Enter, at first the newest). Still open here: whether it follows the ring as the person steps through matches, how it marks the match (a hidden fold, a file path), and how its file line reads "read" against "changed".

## Answer

Decided with the user on 2026-10-16. The term **Preview** is in [`mods/chat-toc/CONTEXT.md`](../../../mods/chat-toc/CONTEXT.md).

**Which group it shows (revises ticket 06).** Following only the Current position would preview only the group already in view, which is a jump. So: while the Pane holds the keys and the focus ring is on an entry, the preview shows the **selected** group (↑↓ move it, Enter still jumps); when the keys go back to the composer, the Current position's group. While a query is set, the selected match, or the match nearest the Current position when no entry is selected; so it follows the ring through the matches. Desktop: the last entry pressed, the newest group before any press (the newest match while a query is set).

**What it holds, top to bottom.**
1. The meta line (1 row, always kept): `Oct 16 14:32 · 12 steps · 3m 20s · 3.5k out` / `10月16日 14:32 · 12 步 · 3 分 20 秒 · 输出 3.5k`. The date always, today too (no day rule beside it). A state only when not finished, after the time, in the MVP's words (`Running`/`进行中`, `Interrupted`/`已中断`, `Error`/`出错`). A field that cannot be read is left out, with no placeholder.
2. A dim label row `User` / `用户`, then the User input as typed (plain text; code blocks and pasted content restored; a slash command as `/name args`, a `!cmd` as `!cmd`, an image as the MVP's `(image only)`).
3. A dim label row `Agent` / `Agent`, then the Agent reply's last text, whole, in a `Markdown`. The text is not dimmed.
4. The files line (left out when none): `changed register.tsx, pane.tsx +1 · read 5` / `改 register.tsx, pane.tsx +1 · 读 5`. Changed: `Edit`/`Write` `file_path` and Bash's `bashEditDiff.changedFiles`; read: `Read` only; a file both read and changed counts as changed. Paths relative to the session's cwd when under it, else absolute with `~` for `$HOME`.

A group with no Agent reply (a `!cmd`, a local slash command) holds only the meta line and the User input.

**Duration.** The sum of the group's `turn_duration` rows (several where background notifications started more model turns): the model's working time. No such row (all of Desktop's files, most interrupted turns): no duration, never one estimated from timestamps (the span holds idle waits and answers to questions). A running group shows its state, no ticking clock. Format `45s`/`45 秒`, `3m 20s`/`3 分 20 秒`, `1h 5m`/`1 小时 5 分`, `<1s`/`<1 秒`.

**Tokens.** The main agent's **output** tokens only, each `message.id` counted once, labelled `out` / `输出`; under 1000 as is, then `3.5k`, `1.2M`. Input-side sums are left out (mostly cache reads, up to 92M a turn: they read as spent). Subagents' tokens are not counted and not marked; the README's "not promised" list says so.

**Size and cutting.** The height is fixed by the rule from ticket 06 (40% of the rows left after the head, search row and footer, 4–14 rows), never by the content, so the list does not jump as the selection moves; a short group leaves blank rows. Content past the region is cut, the files line first, then the Agent text, then the User input; the meta line stays. The last row then reads `↓ 12 more lines · e: expand` / `↓ 还有 12 行 · e: 展开`.

**Expanded.** `e` (or a press on the cut line) expands the preview into the rows of the list and the Minimap; the filter row, search row and footer stay. The whole tree is then scrolled by the host (wheel, PgUp/PgDn, ↑↓ with no control in reach): the scroll hook lets the person's scrolls through instead of keeping its own offset. Whether the host scrolls the tree so is checked by the implementation. Expanded shows everything uncut, the files one per line under `Changed` / `改过` and `Read` / `读过`. It holds that one group: neither the Current position nor new turns change it. `e` again, or the `← Back · e` / `← 返回 · e` Button at its top, returns to the list. Not kept: closing the Pane or leaving returns to the region.

**Showing and hiding.** Shown by default. `p` toggles it, and the choice goes to `$.store` like the Layout (a preference), kept across sessions. Hidden, it folds to one rule line `p: Preview` / `p: 预览`, a Button, so `p` keeps a drawn Button to hang on; with no room, ticket 06's `p: Preview (no room)` / `p: 预览（空间不足）`. Shown, the rule reads `Preview · p` / `预览 · p`.

**A running group.** It is redrawn as rows arrive: the steps so far, and the latest text written so far as the Agent part (none until there is text). It stays at its top; it does not scroll to the end. When the turn ends, the text becomes the Agent reply's last text.

**Search.** No word is marked in the text (a `Markdown` cannot carry it; marks inside the User input need styled runs not yet checked). While a query is set the meta line ends with the fields that matched, `matched: User · Agent · files` / `匹配：用户 · Agent · 文件`, and a matching path goes first on the files line.

**Desktop.** As the terminal: the same place, contents, order and cutting, the text in a native `Markdown`. No hotkeys, so the rule line is a Button showing or hiding it, the cut line a Button expanding it, and `← Back` a Button; the words drop `· p` and `e:`. Whether Desktop scrolls a tree taller than the pane is checked by the user in the Claude app.

**Minimap.** No switch to tokens or duration: the bars stay by steps (duration is missing on Desktop and for interrupted turns; output tokens follow the steps closely; a switch would cost another key and more words).

**Left for later.** Whether the host scrolls the whole tree when the scroll hook lets the person's scroll through (terminal and Desktop), the README's "not promised" lines (no duration on Desktop or for most interrupted turns, subagents' tokens not counted), and the `CT-*` scenarios: the spec ticket.
