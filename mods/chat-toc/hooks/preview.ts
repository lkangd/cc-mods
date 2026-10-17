/* The preview: a region at the bottom of the terminal Pane that shows one
   Turn group whole, opened by a press on an entry and closed by its ✕
   (spec §3). This file holds its words (the meta line, the
   files line), its size against the rows the Pane has, and what of the
   group fits in it; pane.tsx draws it.

   The region's height is set by the rows, never by the content, so the
   list above does not move as the group shown changes. Content past it is
   cut: the files line first, then the Agent text, then the User input; the
   meta line stays, and the last row says how many lines were left out. */

import { MIN_LIST_ROWS, BAR_ROWS, MIN_BAR_GROUPS } from './bars'
import { textCells, wrapCells } from './cells'
import { agentStateOf, clockTime, dayLabel } from './entries'
import type { TurnGroup } from './groups'
import { COPY_INPUT_HOTKEY, COPY_TEXT_HOTKEY } from './reuse'
import { text as words } from './text'

/* The rule's ✕ Button closing the preview (hotkey `p`, drawn only while
   it is open) and the cut line's (hotkey `e`). Nothing of the preview is
   kept in `$.store`: it is closed whenever the Pane opens. */
export const PREVIEW_CONTROL = 'preview'
export const MORE_CONTROL = 'preview.more'
export const PREVIEW_HOTKEY = 'p'
export const EXPAND_HOTKEY = 'e'
/* The expanded preview's Back Button, hotkey `e` too. */
export const BACK_CONTROL = 'preview.back'

const MIN_ROWS = 4
const MAX_ROWS = 14
const SHARE = 0.4
/* What a `Markdown` takes at most, and on 2.1.287 a `Text` child too. */
const MARKDOWN_LIMIT = 10_000

/* The region's rows, its rule included, for `rows` rows left after the
   head, the search row and the footer: 40%, held to 4..14. */
export function previewRows(rows: number): number {
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(rows * SHARE)))
}

/* `open`: the region is drawn; `noRoom`: open, but 4 rows do not fit
   beside the list's floor, so it is drawn expanded; `closed`: nothing of
   it is drawn. */
export type PreviewState = 'open' | 'noRoom' | 'closed'

export type PreviewPlan = {
  /* The rows the region takes, its rule included; none unless open. */
  preview: number
  state: PreviewState
  /* Whether the Minimap is drawn. */
  hasBars: boolean
}

/* How `rows` (left after the head, the search row, the footer, the fork
   line and the notes) are shared between the Minimap, the list and the
   preview. The region's height comes from `region`, the rows left after
   the head, the search row and the footer alone, so a note coming and
   going does not move it. When rows run short the Minimap goes first, then
   an open preview shrinks down to 4 rows; when even 4 do not fit beside
   the list's 8 it has no room. Whether it has room is told by `steady`,
   the rows before the notes that come and go (a refusal, a notice), so a
   note does not switch it between the region and the expanded view: while
   one shows, the list may have a row fewer. Closed, it takes no row. */
export function previewPlan({
  rows,
  region = rows,
  steady = rows,
  groups,
  isOpen,
}: {
  rows: number
  region?: number
  steady?: number
  groups: number
  isOpen: boolean
}): PreviewPlan {
  const barsFit = (preview: number) => groups >= MIN_BAR_GROUPS && rows - preview - BAR_ROWS >= MIN_LIST_ROWS
  if (groups === 0 || !isOpen) return { preview: 0, state: 'closed', hasBars: barsFit(0) }
  const wanted = previewRows(region)
  if (barsFit(wanted)) return { preview: wanted, state: 'open', hasBars: true }
  if (steady - MIN_LIST_ROWS < MIN_ROWS) return { preview: 0, state: 'noRoom', hasBars: false }
  return { preview: Math.max(MIN_ROWS, Math.min(wanted, rows - MIN_LIST_ROWS)), state: 'open', hasBars: false }
}

/* A duration in the meta line: `45s`, `3m 20s`, `1h 5m`, `<1s`. */
export function durationText(ms: number): string {
  if (ms < 1000) return words.underASecond
  const s = Math.floor(ms / 1000)
  if (s < 60) return words.seconds(s)
  if (s < 3600) return words.minutes(Math.floor(s / 60), s % 60)
  return words.hours(Math.floor(s / 3600), Math.floor((s % 3600) / 60))
}

/* `n` in units of `unit` as shown: one decimal below ten, whole above. */
function scaled(n: number, unit: number): number {
  const value = n / unit
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
}

/* Output tokens: under 1000 as is, then `3.5k`, `1.2M`; a count whose k
   would round up to 1000 is said in M. */
export function tokensText(n: number): string {
  if (n < 1000) return String(n)
  const k = scaled(n, 1000)
  if (k < 1000) return `${k}k`
  return `${scaled(n, 1_000_000)}M`
}

/* The meta line: the date and time (the date always, today too), a state
   when not finished, the steps (none left out), the duration and the output
   tokens; whatever the file does not state is left out. It is one row: the
   fields that do not fit the width are left out from the end, whole, so no
   figure is ever cut. While a query is set, `matched` (the fields that
   matched, in words) ends it, and the fields before it give way first. */
export function metaLine(group: TurnGroup, isRunning: boolean, nowMs: number, width = Number.POSITIVE_INFINITY, matched?: string): string {
  const day = dayLabel(group.timestamp, nowMs, false)
  const when = [day, clockTime(group.timestamp)].filter(Boolean).join(' ')
  const { durationMs, outputTokens } = group.facts
  const fields = [
    when,
    agentStateOf(group, isRunning),
    group.steps > 0 ? words.steps(group.steps) : '',
    durationMs === undefined ? '' : durationText(durationMs),
    outputTokens === undefined ? '' : words.tokensOut(tokensText(outputTokens)),
  ].filter(Boolean)
  const end = matched === undefined ? [] : [matched]
  const lineOf = () => [...fields, ...end].join(' · ')
  while (fields.length > 1 && textCells(lineOf()) > width) fields.pop()
  if (end.length > 0 && textCells(lineOf()) > width) end.pop()
  return lineOf()
}

/* The User input as the preview draws it: as typed, or for an input of
   only images the words saying so, in the language drawn now. */
export const typedInput = (facts: { input: string; hasImages: boolean }): string =>
  facts.input === '' && facts.hasImages ? words.imageOnly : facts.input

export type PathBase = { cwd: string | undefined; home: string | undefined }

const under = (path: string, dir: string | undefined) =>
  dir !== undefined && dir !== '' && path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)

/* A path as the preview shows it: relative to the session's working
   directory when under it, else absolute with `~` for home. */
export function shownPath(path: string, { cwd, home }: PathBase): string {
  if (cwd !== undefined && under(path, cwd)) return path.slice(cwd.replace(/\/$/, '').length + 1)
  if (home !== undefined && under(path, home)) return `~${path.slice(home.replace(/\/$/, '').length)}`
  return path
}

/* `paths` with those in `first` (a query's matching paths) moved to the
   front, the rest in order. */
const firstOf = (paths: readonly string[], first: readonly string[]) =>
  first.length === 0 ? paths : [...paths.filter(p => first.includes(p)), ...paths.filter(p => !first.includes(p))]

/* The files line: the changed files that fit the width by name, the rest
   counted, then how many were read; undefined when the group touched none.
   While a query is set, the paths in `first` go first: a matching changed
   file leads the names, and a matching read file is named. */
export function filesLine(
  files: { changed: readonly string[]; read: readonly string[] },
  base: PathBase,
  width: number,
  first: readonly string[] = [],
): string | undefined {
  const readFirst = files.read.filter(p => first.includes(p)).map(path => shownPath(path, base))
  const readRest = files.read.length - readFirst.length
  const read =
    files.read.length === 0 ? '' : readFirst.length === 0 ? words.readFiles(files.read.length) : words.readNamed(readFirst.join(', ') + (readRest > 0 ? ` +${readRest}` : ''))
  if (files.changed.length === 0) return read === '' ? undefined : textCells(read) <= width ? read : wrapCells(read, width, 1)[0]
  const names = firstOf(files.changed, first).map(path => shownPath(path, base))
  const lineOf = (n: number) => {
    const rest = names.length - n
    const changed = words.changed(names.slice(0, n).join(', ') + (rest > 0 ? ` +${rest}` : ''))
    return [changed, read].filter(Boolean).join(' · ')
  }
  for (let n = names.length; n > 1; n--) {
    const line = lineOf(n)
    if (textCells(line) <= width) return line
  }
  return wrapCells(lineOf(1), width, 1)[0]
}

/* A source line longer than this is counted by its cells, not folded. */
const FOLD_COUNTED = 2_000

/* How many rows a source line folds to at the width. */
function rowsOf(line: string, width: number): number {
  if (line.length <= FOLD_COUNTED) return wrapCells(line, width, Number.POSITIVE_INFINITY).length
  return Math.max(1, Math.ceil(textCells(line) / Math.max(1, width)))
}

/* The rows text folds to at the width, its own line breaks kept. */
function foldedRows(text: string, width: number): number {
  let rows = 0
  for (const line of text.split('\n')) rows += rowsOf(line, width)
  return rows
}

/* A source line's first `rows` folded rows; a row holds at most `width`
   characters, so only the line's start is folded. */
function headOf(line: string, width: number, rows: number): string[] {
  return wrapCells(line.slice(0, (rows + 1) * width + 1), width, Number.POSITIVE_INFINITY).slice(0, rows)
}

/* The text's first `rows` folded rows. */
function foldedHead(text: string, width: number, rows: number): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (out.length >= rows) break
    for (const row of headOf(line, width, rows - out.length)) out.push(row)
  }
  return out
}

/* The Agent text's first `rows` folded lines, as Markdown source: whole
   source lines while they fit, then the start of the next. The host folds
   Markdown itself, so the rows are a close reckoning; the region clips. */
function agentCut(text: string, width: number, rows: number): string {
  const kept: string[] = []
  let used = 0
  for (const line of text.split('\n')) {
    if (used >= rows) break
    const n = rowsOf(line, width)
    if (used + n <= rows) {
      kept.push(line)
      used += n
    } else {
      kept.push(headOf(line, width, rows - used).join(' '))
      used = rows
    }
  }
  return kept.join('\n').slice(0, MARKDOWN_LIMIT)
}

/* The expanded preview's text cap: a tree draws only its first 100,000
   characters, so the User input and the last text share about 60,000. */
export const TEXT_CAP = 60_000

/* A part of the text as drawn, and how many characters were left out. */
export type Capped = { shown: string; left: number }

/* The characters (code points) in `text`. */
function characters(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0xd800 || c > 0xdbff) n++
  }
  return n
}

/* Where to cut `text` at most `size` UTF-16 units in: `size`, or one unit
   short when that would split a character in two. */
function unitEnd(text: string, size: number): number {
  const c = text.charCodeAt(size - 1)
  return size > 0 && c >= 0xd800 && c <= 0xdbff ? size - 1 : size
}

/* `text` cut to at most `size` UTF-16 units, never inside a character. */
function capped(text: string, size: number): Capped {
  if (text.length <= size) return { shown: text, left: 0 }
  const end = unitEnd(text, size)
  return { shown: text.slice(0, end), left: characters(text.slice(end)) }
}

/* The User input and the last text cut to `cap` together: a short part
   stays whole, the other takes the rest; two long parts take half each. */
export function capTexts(input: string, agent: string | undefined, cap = TEXT_CAP): { input: Capped; agent: Capped | undefined } {
  const agentLength = agent?.length ?? 0
  const inputSize = Math.min(input.length, Math.max(Math.floor(cap / 2), cap - agentLength))
  return {
    input: capped(input, inputSize),
    agent: agent === undefined ? undefined : capped(agent, cap - inputSize),
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/* The fence a code block open at the end of `text` was opened with, its
   whole line; undefined when none is open. */
function openFence(text: string): string | undefined {
  let open: { line: string; mark: string } | undefined
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line)
    if (m === null) continue
    const mark = m[1] ?? ''
    if (open === undefined) open = { line, mark }
    else if (mark[0] === open.mark[0] && mark.length >= open.mark.length && line.trim() === mark) open = undefined
  }
  return open?.line
}

/* Where to end a part of `text` within `size` units: after a blank line,
   else at a line break (the break itself dropped), else at `size`, never
   inside a character. Returns the part's end and where the next begins. */
function partEnd(text: string, size: number): { end: number; next: number } {
  const blank = text.lastIndexOf('\n\n', size - 1)
  if (blank > 0) return { end: blank + 1, next: blank + 2 }
  const line = text.lastIndexOf('\n', size)
  if (line > 0) return { end: line, next: line + 1 }
  const end = unitEnd(text, size)
  return { end, next: end }
}

/* `text` in parts of at most `limit` characters: `cut` takes what is left
   and gives the next part and what follows it. */
function splitParts(text: string, limit: number, cut: (rest: string) => { part: string; rest: string }): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    const next = cut(rest)
    parts.push(next.part)
    rest = next.rest
  }
  parts.push(rest)
  return parts
}

/* The part of `rest` up to `end` and what follows from `next`. */
const partAt = (rest: string, { end, next }: { end: number; next: number }) => ({ part: rest.slice(0, end), rest: rest.slice(next) })

/* Plain text split into parts of at most `limit` characters, one `Text`
   each: at a blank line, else a line break, else anywhere. */
export function textParts(text: string, limit = MARKDOWN_LIMIT): string[] {
  return splitParts(text, limit, rest => partAt(rest, partEnd(rest, limit)))
}

/* Markdown source split into parts of at most `limit` characters, one
   `Markdown` each: at a blank line, else a line break, else anywhere. A
   code block split over two parts is closed in the first and opened again
   in the next, so each draws as code. */
export function markdownParts(text: string, limit = MARKDOWN_LIMIT): string[] {
  return splitParts(text, limit, rest => {
    const at = partEnd(rest, limit)
    const opened = openFence(rest.slice(0, at.end))
    if (opened === undefined) return partAt(rest, at)
    const closing = `\n${FENCE.exec(opened)?.[1] ?? ''}`
    const { end, next } = partEnd(rest, limit - closing.length)
    const fence = openFence(rest.slice(0, end))
    const reopened = fence === undefined ? '' : `${fence}\n${rest.slice(next)}`
    /* Only while it gets shorter: a fence line near the limit is cut. */
    if (fence !== undefined && reopened.length < rest.length) return { part: rest.slice(0, end) + closing, rest: reopened }
    return partAt(rest, { end, next })
  })
}

/* The expanded preview: one group drawn whole in the list's place. */
export type ExpandedBody = {
  meta: string
  /* The User input up to the cap, one `Text` per part, and the line after
     it when it was cut. */
  user: { parts: string[]; cut: string | undefined }
  /* The last text up to the cap, one `Markdown` per part; undefined draws
     no label. */
  agent: { parts: string[]; cut: string | undefined } | undefined
  /* The files, one per line under their headings; none draws no heading. */
  changed: string[]
  read: string[]
  /* The rows it folds to at the width, the Back Button included: a close
     reckoning, as the host folds the Markdown itself. */
  rows: number
}

export function expandedBody(o: {
  meta: string
  input: string
  agent: string | undefined
  files: { changed: readonly string[]; read: readonly string[] }
  base: PathBase
  width: number
  /* False on the desktop, which has no hotkeys: the cut lines name none. */
  hasHotkeys?: boolean
}): ExpandedBody {
  const capped = capTexts(o.input, o.agent || undefined)
  const cutLine = (left: number, key: string) => (left > 0 ? words.notShown(left, o.hasHotkeys === false ? undefined : key) : undefined)
  const user = { parts: textParts(capped.input.shown), cut: cutLine(capped.input.left, COPY_INPUT_HOTKEY) }
  const agent = capped.agent === undefined ? undefined : { parts: markdownParts(capped.agent.shown), cut: cutLine(capped.agent.left, COPY_TEXT_HOTKEY) }
  const changed = o.files.changed.map(path => shownPath(path, o.base))
  const read = o.files.read.map(path => shownPath(path, o.base))
  const listRows = (paths: readonly string[]) => (paths.length === 0 ? 0 : 1 + paths.reduce((n, path) => n + rowsOf(path, o.width), 0))
  const rows =
    2 +
    1 +
    user.parts.reduce((n, part) => n + foldedRows(part, o.width), 0) +
    (user.cut === undefined ? 0 : 1) +
    (agent === undefined ? 0 : 1 + agent.parts.reduce((n, part) => n + foldedRows(part, o.width), 0) + (agent.cut === undefined ? 0 : 1)) +
    listRows(changed) +
    listRows(read)
  return { meta: o.meta, user, agent, changed, read, rows }
}

export type PreviewBody = {
  meta: string
  /* The User input's lines under its label; undefined draws no label. */
  user: string[] | undefined
  /* The Agent text's Markdown source and the rows it is given; undefined
     draws no label. */
  agent: { text: string; rows: number } | undefined
  files: string | undefined
  /* Lines left out; 0 draws no cut line. */
  more: number
  /* Blank rows under the content. */
  blank: number
}

/* What of a group fits a region of `rows` rows (its rule included) and
   `width` cells. Each of the User input and the Agent text takes a label
   row; the Agent part is left out when there is no text. */
export function previewBody(o: { meta: string; input: string; agent: string | undefined; files: string | undefined; rows: number; width: number }): PreviewBody {
  const rest = Math.max(0, o.rows - 2)
  const userRows = foldedRows(o.input, o.width)
  const agentRows = o.agent ? foldedRows(o.agent, o.width) : 0
  const hasAgent = agentRows > 0
  const total = 1 + userRows + (hasAgent ? 1 + agentRows : 0) + (o.files === undefined ? 0 : 1)
  if (total <= rest) {
    return {
      meta: o.meta,
      user: foldedHead(o.input, o.width, userRows),
      agent: hasAgent ? { text: (o.agent ?? '').slice(0, MARKDOWN_LIMIT), rows: agentRows } : undefined,
      files: o.files,
      more: 0,
      blank: rest - total,
    }
  }
  let room = rest - 1
  let user: string[] | undefined
  let agent: { text: string; rows: number } | undefined
  if (room >= 1) {
    user = foldedHead(o.input, o.width, Math.min(userRows, room - 1))
    room -= 1 + user.length
  }
  if (hasAgent && room >= 1) {
    const rows = Math.min(agentRows, room - 1)
    agent = { text: rows === 0 ? '' : agentCut(o.agent ?? '', o.width, rows), rows }
    room -= 1 + rows
  }
  const more = userRows - (user?.length ?? 0) + (agentRows - (agent?.rows ?? 0)) + (o.files === undefined ? 0 : 1)
  return { meta: o.meta, user, agent, files: undefined, more, blank: Math.max(0, room) }
}
