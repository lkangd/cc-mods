/* Entries: what the pane draws for each side of a Turn group, as lines of
   text already folded to the pane's width, in the Layout chosen and under
   the View filter:
     card      each side a dim header line, then up to two lines of text;
     compact   each side one line, the prompt with its time at the right;
     timeline  each side up to two lines beside a rail of times.
   The gutter left of the lines (highlight mark, time rail) is the pane's to
   draw; an entry carries what it needs, its `time`. */

import { textCells, wrapCells } from './cells'
import type { TurnGroup } from './groups'
import type { Layout, ViewFilter } from './view'

export type EntryLine = { text: string; dim: boolean }

export type Entry = {
  /* The entry's key: its first line's Button key; later lines add `.<n>`. */
  key: string
  groupIndex: number
  side: 'user' | 'agent'
  /* The transcript row a press jumps to. */
  jumpUuid: string
  lines: EntryLine[]
  /* The User input's local `HH:MM` for the timeline's rail; '' elsewhere,
     and when the transcript has no time for it. */
  time: string
  /* Whether a blank line follows: one parts each Turn group from the next
     in the card and timeline Layouts. */
  gapAfter: boolean
}

/* The gutter each Layout keeps left of its Buttons, in cells: a highlight
   mark and a space, or in the timeline `HH:MM`, a space, the rail, a space. */
export const GUTTER: Record<Layout, number> = { card: 2, compact: 2, timeline: 8 }
/* The card's Agent reply text sits this far in, inside its Buttons. */
const REPLY_INDENT = '  '
const BODY_LINES = 2

const pad2 = (n: number) => String(n).padStart(2, '0')

/* A transcript timestamp in the local clock, `M月D日 HH:MM`, with the year
   when it is not this year's; '' when there is none to read. */
export function formatTime(timestamp: string | undefined, nowMs: number): string {
  if (!timestamp) return ''
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return ''
  const day = `${at.getMonth() + 1}月${at.getDate()}日 ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  return at.getFullYear() === new Date(nowMs).getFullYear() ? day : `${at.getFullYear()}年${day}`
}

/* A transcript timestamp's local `HH:MM`; '' when there is none to read. */
export function clockTime(timestamp: string | undefined): string {
  if (!timestamp) return ''
  const at = new Date(timestamp)
  return Number.isNaN(at.getTime()) ? '' : `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}

/* The Agent reply's state, as its header says it: in progress, interrupted
   or ended in an error, each with the steps so far; otherwise the steps,
   and a note when there is no reply text. No steps, no count. */
export function agentHeadOf(group: TurnGroup, isRunning: boolean): string {
  const steps = group.steps > 0 ? `${group.steps} 步` : ''
  const state = isRunning ? '进行中' : group.ending === 'interrupted' ? '已中断' : group.ending === 'error' ? '出错' : ''
  if (state) return [state, steps].filter(Boolean).join(' · ')
  if (!group.reply) return [steps, '无文字回复'].filter(Boolean).join(' · ')
  return steps
}

type Side = Omit<Entry, 'time' | 'gapAfter'>

function sideOf(group: TurnGroup, groupIndex: number, side: 'user' | 'agent', lines: EntryLine[]): Side {
  return {
    key: `g${groupIndex}.${side === 'user' ? 'u' : 'a'}`,
    groupIndex,
    side,
    jumpUuid: side === 'user' ? group.openerUuid : (group.reply?.uuid ?? group.lastAgentUuid ?? group.openerUuid),
    lines,
  }
}

const linesOf = (texts: string[], dim: boolean): EntryLine[] => texts.map(text => ({ text, dim }))

/* The Agent reply as one run of text: the arrow, its state, its reply. */
function agentText(group: TurnGroup, isRunning: boolean): string {
  const said = [agentHeadOf(group, isRunning), group.reply?.text ?? ''].filter(Boolean).join(' · ')
  return said ? `↳ ${said}` : '↳'
}

function cardSide(group: TurnGroup, i: number, side: 'user' | 'agent', room: number, nowMs: number, isRunning: boolean): Side {
  if (side === 'user') {
    const time = formatTime(group.timestamp, nowMs)
    const head = wrapCells(time ? `你 · ${time}` : '你', room, 1)
    const body = group.userText ? wrapCells(group.userText, room, BODY_LINES) : []
    return sideOf(group, i, side, [...linesOf(head, true), ...linesOf(body, false)])
  }
  const state = agentHeadOf(group, isRunning)
  const head = wrapCells(state ? `↳ ${state}` : '↳', room, 1)
  const body = group.reply ? wrapCells(group.reply.text, room - REPLY_INDENT.length, BODY_LINES).map(line => REPLY_INDENT + line) : []
  return sideOf(group, i, side, [...linesOf(head, true), ...linesOf(body, false)])
}

function compactSide(group: TurnGroup, i: number, side: 'user' | 'agent', room: number, isRunning: boolean): Side {
  if (side === 'agent') return sideOf(group, i, side, linesOf(wrapCells(agentText(group, isRunning), room, 1), true))
  const time = clockTime(group.timestamp)
  if (!time) return sideOf(group, i, side, linesOf(wrapCells(group.userText, room, 1), false))
  const textRoom = room - time.length - 1
  const line = wrapCells(group.userText, textRoom, 1)[0] ?? ''
  return sideOf(group, i, side, [{ text: line + ' '.repeat(Math.max(0, textRoom - textCells(line)) + 1) + time, dim: false }])
}

function timelineSide(group: TurnGroup, i: number, side: 'user' | 'agent', room: number, isRunning: boolean): Side {
  if (side === 'agent') return sideOf(group, i, side, linesOf(wrapCells(agentText(group, isRunning), room, BODY_LINES), true))
  return sideOf(group, i, side, linesOf(wrapCells(group.userText, room, BODY_LINES), false))
}

export type EntryOptions = {
  layout: Layout
  filter: ViewFilter
  /* The pane's body width in cells. */
  width: number
  nowMs: number
  /* Whether a turn of the main agent is under way: the last group's. */
  isRunning: boolean
}

/* The entries the pane lists, in order: each group's User input side, then
   its Agent reply side when it has one, as the filter lets them through. A
   group with no side the filter lets through is not listed. */
export function entriesOf(groups: readonly TurnGroup[], options: EntryOptions): Entry[] {
  const { layout, filter, width, nowMs, isRunning } = options
  const room = width - GUTTER[layout]
  const entries: Entry[] = []
  groups.forEach((group, i) => {
    const isGroupRunning = isRunning && i === groups.length - 1
    const sides: ('user' | 'agent')[] = []
    if (filter !== 'agent') sides.push('user')
    if (filter !== 'user' && (group.hasAgentReply || isGroupRunning)) sides.push('agent')
    for (const side of sides) {
      const drawn =
        layout === 'card'
          ? cardSide(group, i, side, room, nowMs, isGroupRunning)
          : layout === 'compact'
            ? compactSide(group, i, side, room, isGroupRunning)
            : timelineSide(group, i, side, room, isGroupRunning)
      entries.push({ ...drawn, time: layout === 'timeline' && side === 'user' ? clockTime(group.timestamp) : '', gapAfter: false })
    }
  })
  if (layout !== 'compact') {
    entries.forEach((entry, i) => {
      const next = entries[i + 1]
      entry.gapAfter = next !== undefined && next.groupIndex !== entry.groupIndex
    })
  }
  return entries
}

/* The first entry of group `group` or, when it shows none, of the first
   group after it that does; else the last entry. Entries are in group
   order, so this halves its way there. */
export function firstEntryFrom(entries: readonly Entry[], group: number): number | undefined {
  if (entries.length === 0) return undefined
  let low = 0
  let high = entries.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((entries[mid]?.groupIndex ?? 0) < group) low = mid + 1
    else high = mid
  }
  return Math.min(low, entries.length - 1)
}

/* Every side in the card Layout. */
export function cardEntries(groups: readonly TurnGroup[], width: number, nowMs: number, isRunning: boolean): Entry[] {
  return entriesOf(groups, { layout: 'card', filter: 'all', width, nowMs, isRunning })
}
