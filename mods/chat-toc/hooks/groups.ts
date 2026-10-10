/* Turn groups: a User input and what the main agent did from it until the
   next User input. This file holds the rule for which chain rows open a
   group and what the group shows of its User input. */

import type { TranscriptRow } from './transcript'

export type TurnGroup = {
  /* The uuid of the row that opened the group: the User input's row. */
  openerUuid: string
  /* The User input's text as the TOC shows it. */
  userText: string
  /* The User input row's timestamp (UTC ISO), when the row has one. */
  timestamp: string | undefined
  /* Every chain row in the group, opener first. */
  rowUuids: string[]
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
}

function hasToolResult(content: unknown): boolean {
  return Array.isArray(content) && content.some(b => typeof b === 'object' && b !== null && b.type === 'tool_result')
}

/* Whether a chain row is a User input that opens a Turn group. */
export function opensGroup(row: TranscriptRow): boolean {
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return false
  if (hasToolResult(row.message?.content)) return false
  return row.origin?.kind === 'human'
}

/* The User input as the TOC lists it: its text with whitespace collapsed. */
export function userTextOf(row: TranscriptRow): string {
  return textOf(row.message?.content).replace(/\s+/g, ' ').trim()
}

export function groupTurns(chain: readonly TranscriptRow[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let current: TurnGroup | undefined
  for (const row of chain) {
    if (opensGroup(row)) {
      current = { openerUuid: row.uuid, userText: userTextOf(row), timestamp: row.timestamp, rowUuids: [] }
      groups.push(current)
    }
    current?.rowUuids.push(row.uuid)
  }
  return groups
}
