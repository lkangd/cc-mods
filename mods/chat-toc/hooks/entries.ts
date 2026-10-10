/* Entries: what the pane draws for each side of a Turn group, as lines of
   text already folded to the pane's width. Only the card Layout's User
   input side exists so far. */

import { wrapCells } from './cells'
import type { TurnGroup } from './groups'

export type EntryLine = { text: string; dim: boolean }

export type Entry = {
  /* The entry's key: its first line's Button key; later lines add `.<n>`. */
  key: string
  groupIndex: number
  side: 'user'
  /* The transcript row a press jumps to. */
  jumpUuid: string
  lines: EntryLine[]
}

/* The left gutter every card entry keeps, outside its Buttons. */
export const CARD_GUTTER = 2
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

export function cardUserEntry(group: TurnGroup, groupIndex: number, width: number, nowMs: number): Entry {
  const room = width - CARD_GUTTER
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

export function cardEntries(groups: readonly TurnGroup[], width: number, nowMs: number): Entry[] {
  return groups.map((g, i) => cardUserEntry(g, i, width, nowMs))
}
