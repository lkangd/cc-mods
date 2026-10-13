/* Jump targets: which transcript rows a press on an entry scrolls to, in
   the order tried. `$.ui.scroll` reaches any row the host lists, drawn or
   not, and refuses one it does not list (rows compacted away before a
   resume, a rewound-away branch); then the next row is tried, up to three.

   - A prompt: its own row, its top at the top of the view.
   - An Agent reply: the row its last text starts on; without one, the
     group's last rows the agent drew (text or tool calls), latest first.
   - A local command, a prompt-type command or a `!` shell command: the
     host draws its row with no site to scroll to, so the nearest drawable
     rows after it, then before it, centred, which keeps the row typed in
     view above the one jumped to.

   A side refused is drawn dim. In a session this process resumed, the host
   lists none of the rows before the last compaction the file had then, so
   the sides whose every target lies there are dim before anyone presses
   them (a fork's file starts at that compaction: it has no such rows).

   The scroll itself is `jump` in register.tsx, which may hold the host's
   `$`. */

import type { UiScrollBlock } from 'claude-code'
import type { Entry, EntryLine } from './entries'
import type { TurnGroup } from './groups'
import { inputKindOf } from './groups'
import { hostIdOf, isDrawn } from './sites'
import type { RowIndex, Sites } from './sites'
import type { TranscriptRow } from './transcript'

export type JumpTarget = { uuid: string; requestId: string; block: UiScrollBlock }

export const MAX_TRIES = 3

/* Said at the bottom of the pane when every row of a side was refused,
   after a ⚠ in the theme's warning colour. */
export const REFUSED_TEXT = '这一条当前没有显示在对话里，无法跳转'
/* Said instead for a side known refused as compacted before a resume. */
export const COMPACTED_TEXT = '这一条在压缩之前，恢复会话后无法跳转'
/* How long it stays, unless a jump or a move of the selection clears it. */
export const REFUSED_MS = 5000
/* As it appears it flashes inverse this many times, lit and unlit this
   long each, then stays lit. */
export const FLASH_MS = 150
export const FLASHES = 3

export function refusalFrame(elapsedMs: number): { isInverse: boolean } {
  return { isInverse: elapsedMs < FLASH_MS * FLASHES * 2 && Math.floor(elapsedMs / FLASH_MS) % 2 === 0 }
}

type Block = { type?: unknown; text?: unknown }

const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : [])
export const hasText = (row: TranscriptRow) => blocksOf(row.message?.content).some(b => b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
const hasCall = (row: TranscriptRow) => blocksOf(row.message?.content).some(b => b?.type === 'tool_use')

/* A local command's output with something in it, as a system row or the
   user row older hosts wrote. */
function isCommandOutput(row: TranscriptRow): boolean {
  const content = row.type === 'system' ? row.content : row.type === 'user' ? row.message?.content : undefined
  if (typeof content !== 'string') return false
  return /<local-command-stdout>[\s\S]*?\S[\s\S]*?<\/local-command-stdout>/.test(content)
}

/* A row the agent drew: an `AssistantMessage` with text, or a tool row. */
const isAgentRow = (row: TranscriptRow) => row.type === 'assistant' && (hasText(row) || hasCall(row))

/* A row the host draws at a site it can scroll to: a prompt, a row the
   agent drew, a command's output, or any row a site was seen drawing. */
function isDrawable(row: TranscriptRow, sites: Sites): boolean {
  if (isDrawn(sites, row.uuid)) return true
  if (row.type === 'user') return inputKindOf(row) === 'prompt' || isCommandOutput(row)
  if (row.type === 'system') return isCommandOutput(row)
  return isAgentRow(row)
}

function target(rows: RowIndex, sites: Sites, uuid: string, block: UiScrollBlock): JumpTarget {
  return { uuid, requestId: hostIdOf(sites, rows, uuid), block }
}

/* The nearest drawable rows after the group's opener, then before it. */
function neighbours(group: TurnGroup, rows: RowIndex, sites: Sites): JumpTarget[] {
  const at = rows.order.get(group.openerUuid)
  if (at === undefined) return []
  const found: JumpTarget[] = []
  const take = (i: number) => {
    const row = rows.chain[i]
    if (row && isDrawable(row, sites)) found.push(target(rows, sites, row.uuid, 'center'))
    return found.length < MAX_TRIES
  }
  for (let i = at + 1; i < rows.chain.length; i++) if (!take(i)) return found
  for (let i = at - 1; i >= 0; i--) if (!take(i)) return found
  return found
}

/* The group's last rows the agent drew, latest first. */
function lastAgentRows(group: TurnGroup, rows: RowIndex, sites: Sites): JumpTarget[] {
  const found: JumpTarget[] = []
  for (let i = group.rowUuids.length - 1; i >= 0 && found.length < MAX_TRIES; i--) {
    const uuid = group.rowUuids[i]
    const row = uuid === undefined ? undefined : rows.chain[rows.order.get(uuid) ?? -1]
    if (row && row.type === 'assistant' && (isAgentRow(row) || isDrawn(sites, row.uuid))) found.push(target(rows, sites, row.uuid, 'start'))
  }
  return found
}

/* The rows a press on one side of a group tries, in order; none when
   there is nowhere to jump. */
export function jumpTargetsOf(group: TurnGroup, side: 'user' | 'agent', rows: RowIndex, sites: Sites): JumpTarget[] {
  if (side === 'agent') {
    if (group.reply) return [target(rows, sites, group.reply.uuid, 'start')]
    return lastAgentRows(group, rows, sites)
  }
  if (group.kind === 'prompt') return [target(rows, sites, group.openerUuid, 'start')]
  return neighbours(group, rows, sites)
}

/* The sides refused, by side key, each with the group's place then (a
   hint: regrouping may move it) and whether the host refused a press or
   the side was known compacted before a resume. */
export type RefusedSide = { side: 'user' | 'agent'; opener: string; groupIndex: number; why: 'refused' | 'compacted' }
export type Refused = Map<string, RefusedSide>

/* The last compaction's boundary row on the chain. */
export function lastBoundary(chain: readonly TranscriptRow[]): string | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const row = chain[i]
    if (row?.type === 'system' && row.subtype === 'compact_boundary') return row.uuid
  }
  return undefined
}

/* The sides whose every jump target lies before `boundary` on the chain:
   in a session resumed with that boundary last, refused for sure. */
export function compactedSides(groups: readonly TurnGroup[], rows: RowIndex, sites: Sites, boundary: string | undefined): Refused {
  const known: Refused = new Map()
  const end = boundary === undefined ? undefined : rows.order.get(boundary)
  if (end === undefined) return known
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!
    if ((rows.order.get(group.openerUuid) ?? end) >= end) break
    for (const side of ['user', 'agent'] as const) {
      const targets = jumpTargetsOf(group, side, rows, sites)
      if (targets.length > 0 && targets.every(t => (rows.order.get(t.uuid) ?? end) < end)) {
        known.set(sideKeyOf(group, side), { side, opener: group.openerUuid, groupIndex, why: 'compacted' })
      }
    }
  }
  return known
}

function groupOf(groups: readonly TurnGroup[], opener: string, hint: number): TurnGroup | undefined {
  const at = groups[hint]
  if (at?.openerUuid === opener) return at
  return groups.find(g => g.openerUuid === opener)
}

/* A row the host drew again: every refused side it is a target of comes
   back. True when one did. */
export function relisted(refused: Refused, uuid: string, groups: readonly TurnGroup[], rows: RowIndex, sites: Sites): boolean {
  let isBack = false
  for (const [key, was] of refused) {
    const group = groupOf(groups, was.opener, was.groupIndex)
    if (!group || jumpTargetsOf(group, was.side, rows, sites).some(t => t.uuid === uuid)) {
      refused.delete(key)
      isBack = true
    }
  }
  return isBack
}

/* Which side of which group: an entry's identity across regrouping. */
export const sideKeyOf = (group: TurnGroup, side: 'user' | 'agent') => `${group.openerUuid}.${side}`

/* Entries with the sides refused drawn dim, every line, and marked off. */
export function dimRefused(entries: readonly Entry[], groups: readonly TurnGroup[], refused: Refused): Entry[] {
  if (refused.size === 0) return entries as Entry[]
  return entries.map(entry => {
    const group = groups[entry.groupIndex]
    if (!group || !refused.has(sideKeyOf(group, entry.side))) return entry
    return { ...entry, isOff: true, lines: entry.lines.map((line): EntryLine => ({ ...line, dim: true })) }
  })
}
