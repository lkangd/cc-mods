/* The preview: a region at the bottom of the terminal Pane that shows one
   Turn group whole (spec §3). This file holds its words (the meta line, the
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
import { text as words } from './text'

/* Where the preview's choice is kept in `$.store`, and its two values; a
   value not known reads as shown. */
export const PREVIEW_KEY = 'preview'
export const isPreviewShown = (value: unknown): boolean => value !== 'hidden'

/* The rule's Button (hotkey `p`) and the cut line's (hotkey `e`). */
export const PREVIEW_CONTROL = 'preview'
export const MORE_CONTROL = 'preview.more'
export const PREVIEW_HOTKEY = 'p'
export const EXPAND_HOTKEY = 'e'

const MIN_ROWS = 4
const MAX_ROWS = 14
const SHARE = 0.4
/* What a `Markdown` takes at most. */
const MARKDOWN_LIMIT = 10_000

/* The region's rows, its rule included, for `rows` rows left after the
   head, the search row and the footer: 40%, held to 4..14. */
export function previewRows(rows: number): number {
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(rows * SHARE)))
}

export type PreviewState = 'shown' | 'hidden' | 'noRoom' | 'none'

export type PreviewPlan = {
  /* The rows the region takes: its rule and content, one line when hidden
     or without room, none when there is no group to show. */
  preview: number
  state: PreviewState
  /* Whether the Minimap is drawn. */
  hasBars: boolean
}

/* How `rows` (left after the head, the footer and the notes) are shared
   between the Minimap, the list and the preview. When they run short the
   Minimap goes first, then the preview shrinks down to 4 rows, then it
   leaves one line; the list keeps its 8. */
export function previewPlan({ rows, groups, isShown }: { rows: number; groups: number; isShown: boolean }): PreviewPlan {
  const barsFit = (preview: number) => groups >= MIN_BAR_GROUPS && rows - preview - BAR_ROWS >= MIN_LIST_ROWS
  if (groups === 0) return { preview: 0, state: 'none', hasBars: false }
  if (!isShown) return { preview: 1, state: 'hidden', hasBars: barsFit(1) }
  const wanted = previewRows(rows)
  if (barsFit(wanted)) return { preview: wanted, state: 'shown', hasBars: true }
  const preview = Math.min(wanted, rows - MIN_LIST_ROWS)
  if (preview >= MIN_ROWS) return { preview, state: 'shown', hasBars: false }
  return { preview: 1, state: 'noRoom', hasBars: false }
}

/* A duration in the meta line: `45s`, `3m 20s`, `1h 5m`, `<1s`. */
export function durationText(ms: number): string {
  if (ms < 1000) return words.underASecond
  const s = Math.floor(ms / 1000)
  if (s < 60) return words.seconds(s)
  if (s < 3600) return words.minutes(Math.floor(s / 60), s % 60)
  return words.hours(Math.floor(s / 3600), Math.floor((s % 3600) / 60))
}

/* One decimal below ten units, whole above: `3.5k`, `12k`, `1.2M`. */
function scaled(n: number, unit: number, mark: string): string {
  const value = n / unit
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${shown}${mark}`
}

/* Output tokens: under 1000 as is, then `3.5k`, `1.2M`. */
export function tokensText(n: number): string {
  if (n < 1000) return String(n)
  if (Math.round(n / 100) < 10_000) return scaled(n, 1000, 'k')
  return scaled(n, 1_000_000, 'M')
}

/* The meta line: the date and time (the date always, today too), a state
   when not finished, the steps (none left out), the duration and the output
   tokens; whatever the file does not state is left out. It is one row: the
   fields that do not fit the width are left out from the end, whole, so no
   figure is ever cut. */
export function metaLine(group: TurnGroup, isRunning: boolean, nowMs: number, width = Number.POSITIVE_INFINITY): string {
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
  while (fields.length > 1 && textCells(fields.join(' · ')) > width) fields.pop()
  return fields.join(' · ')
}

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

/* The files line: the changed files that fit the width by name, the rest
   counted, then how many were read; undefined when the group touched none. */
export function filesLine(files: { changed: readonly string[]; read: readonly string[] }, base: PathBase, width: number): string | undefined {
  const read = files.read.length > 0 ? words.readFiles(files.read.length) : ''
  if (files.changed.length === 0) return read || undefined
  const names = files.changed.map(path => shownPath(path, base))
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

/* `text` cut to at most `size` UTF-16 units, never inside a character. */
function capped(text: string, size: number): Capped {
  if (text.length <= size) return { shown: text, left: 0 }
  const c = text.charCodeAt(size - 1)
  const end = size > 0 && c >= 0xd800 && c <= 0xdbff ? size - 1 : size
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
  const c = text.charCodeAt(size - 1)
  const end = c >= 0xd800 && c <= 0xdbff ? size - 1 : size
  return { end, next: end }
}

/* Markdown source split into parts of at most `limit` characters, one
   `Markdown` each: at a blank line, else a line break, else anywhere. A
   code block split over two parts is closed in the first and opened again
   in the next, so each draws as code. */
export function markdownParts(text: string, limit = MARKDOWN_LIMIT): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    let { end, next } = partEnd(rest, limit)
    const opened = openFence(rest.slice(0, end))
    if (opened !== undefined) {
      const closing = `\n${FENCE.exec(opened)?.[1] ?? ''}`
      ;({ end, next } = partEnd(rest, limit - closing.length))
      const fence = openFence(rest.slice(0, end))
      const reopened = fence === undefined ? '' : `${fence}\n${rest.slice(next)}`
      /* Only while it gets shorter: a fence line near the limit is cut. */
      if (fence !== undefined && reopened.length < rest.length) {
        parts.push(rest.slice(0, end) + closing)
        rest = reopened
        continue
      }
    }
    parts.push(rest.slice(0, end))
    rest = rest.slice(next)
  }
  parts.push(rest)
  return parts
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
