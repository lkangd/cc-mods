/* Entries: what the pane draws for each side of a Turn group, as lines of
   text already folded to the pane's width. Only the card Layout exists so
   far: each side a dim header line, then up to two lines of text. */

import { wrapCells } from './cells'
import type { TurnGroup } from './groups'

export type EntryLine = { text: string; dim: boolean }

export type Entry = {
  /* The entry's key: its first line's Button key; later lines add `.<n>`. */
  key: string
  groupIndex: number
  side: 'user' | 'agent'
  /* The transcript row a press jumps to. */
  jumpUuid: string
  lines: EntryLine[]
}

/* The left gutter every card entry keeps, outside its Buttons. */
export const CARD_GUTTER = 2
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

function cardUserEntry(group: TurnGroup, groupIndex: number, room: number, nowMs: number): Entry {
  const time = formatTime(group.timestamp, nowMs)
  const head = wrapCells(time ? `你 · ${time}` : '你', room, 1)
  const body = group.userText ? wrapCells(group.userText, room, BODY_LINES) : []
  return {
    key: `g${groupIndex}.u`,
    groupIndex,
    side: 'user',
    jumpUuid: group.openerUuid,
    lines: [...head.map(text => ({ text, dim: true })), ...body.map(text => ({ text, dim: false }))],
  }
}

function cardAgentEntry(group: TurnGroup, groupIndex: number, room: number, isRunning: boolean): Entry {
  const state = agentHeadOf(group, isRunning)
  const head = wrapCells(state ? `↳ ${state}` : '↳', room, 1)
  const body = group.reply ? wrapCells(group.reply.text, room - REPLY_INDENT.length, BODY_LINES).map(line => REPLY_INDENT + line) : []
  return {
    key: `g${groupIndex}.a`,
    groupIndex,
    side: 'agent',
    jumpUuid: group.reply?.uuid ?? group.lastAgentUuid ?? group.openerUuid,
    lines: [...head.map(text => ({ text, dim: true })), ...body.map(text => ({ text, dim: false }))],
  }
}

/* Every group's entries in order: its User input side, then its Agent reply
   side when it has one. `isRunning` says a turn of the main agent is under
   way, which is the last group's. */
export function cardEntries(groups: readonly TurnGroup[], width: number, nowMs: number, isRunning: boolean): Entry[] {
  const room = width - CARD_GUTTER
  const entries: Entry[] = []
  groups.forEach((group, i) => {
    entries.push(cardUserEntry(group, i, room, nowMs))
    const isGroupRunning = isRunning && i === groups.length - 1
    if (group.hasAgentReply || isGroupRunning) entries.push(cardAgentEntry(group, i, room, isGroupRunning))
  })
  return entries
}
