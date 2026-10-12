/* A rewind (Esc Esc, restore the conversation) writes nothing to the
   transcript file and raises no event: the host drops the turn rewound to
   and everything after it from its own messages, and the file's chain
   changes branch only with the next row written. Until then, the groups the
   host no longer holds are found by lining its messages up with the file:
   the user messages it counts as turns (`$.session.turns()`: not tool
   results) against the file's user rows, whitespace aside, skipping the
   file's rows it leaves out (local commands, meta rows). The messages start
   at the last compaction (with its summary). Complete, they line up from
   there, which tells repeated prompts apart; cut to the newest 4096, from
   their end, the latest place that fits. register.tsx asks `$`. */

import type { TurnGroup } from './groups'
import type { TranscriptRow } from './transcript'

/* As much of a `$.session.messages()` entry as the lining up reads. */
export type HostMessage = { role: string; text: string; toolResults?: readonly unknown[] }

/* Every group held; the first one not held; or messages that do not line
   up with the file (a compaction not written yet), which say nothing. */
export type Rewound = { kind: 'all' } | { kind: 'from'; group: number } | { kind: 'unknown' }

/* `$.session.messages()` gives the newest this many. */
export const MESSAGES_LIMIT = 4096
/* Cut messages line up on this many of their last turns. */
const TAIL_TURNS = 16

const squash = (text: string) => text.replace(/\s+/g, '')

type Block = { type?: unknown; text?: unknown }

/* A user row's text as the host counts it a turn; undefined for a row that
   is not one (a tool result, an assistant or system row). */
function turnText(row: TranscriptRow): string | undefined {
  if (row.type !== 'user') return undefined
  const content = row.message?.content
  if (typeof content === 'string') return squash(content)
  if (!Array.isArray(content)) return undefined
  const blocks = content as Block[]
  if (blocks.some(b => b?.type === 'tool_result')) return undefined
  return squash(blocks.map(b => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join(''))
}

export function rewoundFrom(groups: readonly TurnGroup[], chain: readonly TranscriptRow[], messages: readonly HostMessage[]): Rewound {
  const turns = messages.filter(m => m.role === 'user' && !(m.toolResults !== undefined && m.toolResults.length > 0)).map(m => squash(m.text))
  const rows: { at: number; text: string }[] = []
  chain.forEach((row, at) => {
    const text = turnText(row)
    if (text !== undefined) rows.push({ at, text })
  })
  /* The chain row of the last turn the host holds; -1 for none. */
  let last: number | undefined
  if (messages.length < MESSAGES_LIMIT) {
    let start = 0
    for (let i = chain.length - 1; i >= 0; i--) {
      const row = chain[i]
      if (row?.type === 'system' && row.subtype === 'compact_boundary') {
        start = i + 1
        break
      }
    }
    last = start - 1
    let next = 0
    for (const row of rows) {
      if (next === turns.length) break
      if (row.at >= start && row.text === turns[next]) {
        next++
        last = row.at
      }
    }
    if (next < turns.length) return { kind: 'unknown' }
  } else {
    const stop = turns.length - Math.min(turns.length, TAIL_TURNS)
    for (let j = rows.length - 1; j >= 0 && last === undefined; j--) {
      if (rows[j]!.text !== turns[turns.length - 1]) continue
      let need = turns.length - 2
      for (let m = j - 1; m >= 0 && need >= stop; m--) if (rows[m]!.text === turns[need]) need--
      if (need < stop) last = rows[j]!.at
    }
    if (last === undefined) return { kind: 'unknown' }
  }
  const order = new Map<string, number>()
  chain.forEach((row, at) => order.set(row.uuid, at))
  const held = last
  const first = groups.findIndex(g => (order.get(g.openerUuid) ?? -1) > held)
  return first === -1 ? { kind: 'all' } : { kind: 'from', group: first }
}
