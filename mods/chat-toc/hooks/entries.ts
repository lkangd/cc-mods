/* Entries: what the pane draws for each side of a Turn group, as lines of
   text already folded to the pane's width, in the Layout chosen and under
   the View filter. Every Layout hangs the sides on a rail: the User input's
   first line on a node, the Agent reply's on a branch.
     card      each side up to two lines, the User input's time at the right
               of its first line;
     compact   each side one line, the time in a column left of the rail;
     timeline  each side up to two lines, the time in a column left of the
               rail.
   The Agent reply is one dim run: its state and steps, then its reply.
   The gutter left of the lines (time column, rail) is the pane's to draw;
   an entry carries what it needs, its `time` and whether it runs. */

import { textCells, wrapCells } from './cells'
import type { CompactionRule } from './compactions'
import type { TurnGroup } from './groups'
import type { Layout, ViewFilter } from './view'
import { text as words } from './text'

/* A line of an entry; `aside`, on a card's first User input line, is the
   time the pane draws at the right of it. */
export type EntryLine = { text: string; dim: boolean; aside?: string }

export type Entry = {
  /* The entry's key: its first line's Button key; later lines add `.<n>`. */
  key: string
  groupIndex: number
  side: 'user' | 'agent'
  /* The transcript row a press jumps to. */
  jumpUuid: string
  lines: EntryLine[]
  /* The group's local `HH:MM` for the time column of the compact and
     timeline Layouts, on the group's first side shown; '' elsewhere, and
     when the transcript has no time for it. */
  time: string
  /* An Agent reply side whose turn is under way: the pane marks it ◐. */
  isRunning: boolean
  /* The group's day, as `dayLabel` says it; '' when it has no time. */
  day: string
  /* A side with no Jump target (refused, or compacted away before a
     resume): the pane hangs it on a hollow mark. */
  isOff?: boolean
  /* Whether a blank line follows: one parts each Turn group from the next
     in the card and timeline Layouts. */
  gapAfter: boolean
  /* A compaction's rule drawn above the entry (below its day's rule), and,
     on the list's last entry, one drawn below it (compactions.ts). */
  compactionBefore?: CompactionRule
  compactionAfter?: CompactionRule
}

/* The gutter each Layout keeps left of its Buttons, in cells: the rail and
   two spaces; in compact and timeline after `HH:MM` and a space. */
export const GUTTER: Record<Layout, number> = { card: 3, compact: 9, timeline: 9 }
/* What a running Agent reply side adds to the gutter: `◐ `. */
export const RUNNING_MARK = 2
/* The room a card keeps at the right of its first User input line for the
   time: a space, then `HH:MM`. */
const ASIDE = 6
const BODY_LINES = 2

const pad2 = (n: number) => String(n).padStart(2, '0')

/* A transcript timestamp as a local time; undefined when there is none to
   read. */
function timeOf(timestamp: string | undefined): Date | undefined {
  if (!timestamp) return undefined
  const at = new Date(timestamp)
  return Number.isNaN(at.getTime()) ? undefined : at
}

function dayOf(at: Date | undefined, now: Date, isTodaySaid: boolean): string {
  if (at === undefined) return ''
  const day = words.monthDay(at.getMonth(), at.getDate())
  if (at.getFullYear() !== now.getFullYear()) return words.withYear(day, at.getFullYear())
  return isTodaySaid && at.getMonth() === now.getMonth() && at.getDate() === now.getDate() ? words.today(day) : day
}

const clockOf = (at: Date | undefined) => (at === undefined ? '' : `${pad2(at.getHours())}:${pad2(at.getMinutes())}`)

/* A transcript timestamp's local day for the day's rule: `Oct 9` (`10月9日`),
   today `Today · Oct 9` unless `isTodaySaid` is false, another year's with
   the year; '' when there is none to read. */
export function dayLabel(timestamp: string | undefined, nowMs: number, isTodaySaid = true): string {
  return dayOf(timeOf(timestamp), new Date(nowMs), isTodaySaid)
}

/* A transcript timestamp's local `HH:MM`; '' when there is none to read. */
export function clockTime(timestamp: string | undefined): string {
  return clockOf(timeOf(timestamp))
}

/* The Agent reply's state when it is not finished: in progress,
   interrupted or ended in an error; '' when it finished. */
export function agentStateOf(group: TurnGroup, isRunning: boolean): string {
  return isRunning ? words.running : group.ending === 'interrupted' ? words.interrupted : group.ending === 'error' ? words.error : ''
}

/* The Agent reply's state, as its header says it: in progress, interrupted
   or ended in an error, each with the steps so far; otherwise the steps,
   and a note when there is no reply text. No steps, no count. */
export function agentHeadOf(group: TurnGroup, isRunning: boolean): string {
  const steps = group.steps > 0 ? words.steps(group.steps) : ''
  const state = agentStateOf(group, isRunning)
  if (state) return [state, steps].filter(Boolean).join(' · ')
  if (!group.reply) return [steps, words.noReply].filter(Boolean).join(' · ')
  return steps
}

/* An entry's key, `g3.u` or `g3.a`: group 3's User input or Agent reply
   side. Its later lines' Buttons add `.<n>`. */
export const entryKey = (groupIndex: number, side: 'user' | 'agent'): string => `g${groupIndex}.${side === 'user' ? 'u' : 'a'}`

/* The group an entry's Button key belongs to: `g3.u.1` is group 3's;
   undefined for a key that is no entry's. */
export function groupOfKey(key: string | undefined): number | undefined {
  const m = key === undefined ? null : /^g(\d+)\./.exec(key)
  return m === null ? undefined : Number(m[1])
}

type Side = Omit<Entry, 'time' | 'gapAfter' | 'isRunning' | 'day'>

function sideOf(group: TurnGroup, groupIndex: number, side: 'user' | 'agent', lines: EntryLine[]): Side {
  return {
    key: entryKey(groupIndex, side),
    groupIndex,
    side,
    jumpUuid: side === 'user' ? group.openerUuid : (group.reply?.uuid ?? group.lastAgentUuid ?? group.openerUuid),
    lines,
  }
}

const linesOf = (texts: string[], dim: boolean): EntryLine[] => texts.map(text => ({ text, dim }))

/* The Agent reply as one run of text: its state, then its reply. */
function agentText(group: TurnGroup, isRunning: boolean): string {
  return [agentHeadOf(group, isRunning), group.reply?.text ?? ''].filter(Boolean).join(' · ')
}

function userSide(group: TurnGroup, i: number, layout: Layout, room: number, clock: string): Side {
  const lines = layout === 'compact' ? 1 : BODY_LINES
  const time = layout === 'card' ? clock : ''
  if (!time) return sideOf(group, i, 'user', linesOf(wrapCells(group.userText, room, lines), false))
  const folded = linesOf(wrapCells(group.userText, room, lines, room - ASIDE), false)
  folded[0] = { ...folded[0]!, aside: time }
  return sideOf(group, i, 'user', folded)
}

function agentSide(group: TurnGroup, i: number, layout: Layout, room: number, isRunning: boolean): Side {
  const lines = layout === 'compact' ? 1 : BODY_LINES
  return sideOf(group, i, 'agent', linesOf(wrapCells(agentText(group, isRunning), isRunning ? room - RUNNING_MARK : room, lines), true))
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

/* One group's entries, in order: its User input side, then its Agent reply
   side when it has one, as the filter lets them through; none when it lets
   neither through. The group's last entry has a gap after it in the card
   and timeline Layouts; the list's very last entry drops it. */
export function groupEntries(group: TurnGroup, i: number, isGroupRunning: boolean, options: EntryOptions): Entry[] {
  const { layout, filter, width, nowMs } = options
  const room = width - GUTTER[layout]
  const sides: ('user' | 'agent')[] = []
  if (filter !== 'agent') sides.push('user')
  if (filter !== 'user' && (group.hasAgentReply || isGroupRunning)) sides.push('agent')
  const at = timeOf(group.timestamp)
  const day = dayOf(at, new Date(nowMs), true)
  const clock = clockOf(at)
  return sides.map((side, n) => {
    const drawn = side === 'user' ? userSide(group, i, layout, room, clock) : agentSide(group, i, layout, room, isGroupRunning)
    const time = layout !== 'card' && n === 0 ? clock : ''
    return { ...drawn, time, isRunning: side === 'agent' && isGroupRunning, day, gapAfter: layout !== 'compact' && n === sides.length - 1 }
  })
}

/* The day's rule drawn above entry `i`: its day, when it is the first
   entry of its group and the day is not the one the list was on. A group
   without a time draws none and leaves the list on its day. */
export function dayRuleBefore(entries: readonly Entry[], i: number): string | undefined {
  const entry = entries[i]
  if (entry === undefined || entry.day === '') return undefined
  if (entries[i - 1]?.groupIndex === entry.groupIndex) return undefined
  for (let j = i - 1; j >= 0; j--) {
    const before = entries[j]!.day
    if (before !== '') return before === entry.day ? undefined : entry.day
  }
  return entry.day
}

/* The rows entry `i` takes: its day's rule, its compaction rules, its
   lines, the gap after it. */
export function entryRows(entries: readonly Entry[], i: number): number {
  const entry = entries[i]
  if (entry === undefined) return 0
  const rules = (dayRuleBefore(entries, i) === undefined ? 0 : 1) + (entry.compactionBefore ? 1 : 0) + (entry.compactionAfter ? 1 : 0)
  return rules + entry.lines.length + (entry.gapAfter ? 1 : 0)
}

/* The list's last entry, which has nothing after it to part from. */
export function withoutTrailingGap(entries: Entry[]): Entry[] {
  const last = entries[entries.length - 1]
  if (last?.gapAfter) entries[entries.length - 1] = { ...last, gapAfter: false }
  return entries
}

/* The entries the pane lists, in order: each group's, as `groupEntries`
   gives them. A group with no side the filter lets through is not listed. */
export function entriesOf(groups: readonly TurnGroup[], options: EntryOptions): Entry[] {
  const entries: Entry[] = []
  groups.forEach((group, i) => {
    for (const entry of groupEntries(group, i, options.isRunning && i === groups.length - 1, options)) entries.push(entry)
  })
  return withoutTrailingGap(entries)
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
