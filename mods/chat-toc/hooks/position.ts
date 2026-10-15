/* Current position: the Turn group the person is looking at in the
   transcript, the group of the row at the top of its view.

   The sites sites.ts hooks report where their rows are: prompts, the
   agent's text, command output, and tool rows, folded into a `ToolGroup`
   or each its own `ToolUse` and `ToolResult` (a file edit's diff). A view
   holding only rows drawn at none of them lights nothing. The fullscreen
   transcript is virtualised and a row it unmounts does not always report
   `null` first, so stale "on screen" records linger where the view used to
   be. Rows truly on screen sit next to each other in conversation order:
   the on-screen rows are cut into runs wherever a drawable row that is not
   on screen lies between two of them, and only the run holding the latest
   report is trusted. Its first row is the top.

   - The last drawn row wholly on screen lights the last group.
   - After a jump the jumped-to group holds (`JumpLock`) until the view
     changes once the jump's own redraws have stopped.
   - A row in no group (before the first prompt) lights nothing.

   Pure: register.tsx keeps the state and writes the result to `$.state`. */

import type { TurnGroup } from './groups'
import { inputKindOf } from './groups'
import { hasText } from './jump'
import type { RowIndex, Sites } from './sites'
import type { TranscriptRow } from './transcript'

export type OnScreenRows = { first: number; last: number; of: number }

/* A row on screen as a site last reported it: its place on the chain, where
   it is in the view, and when it was reported (`seq`, higher is later). */
export type LiveRow = { order: number; onScreen: OnScreenRows; seq: number }

/* Where a jump's redraws are taken as stopped: they come within this of
   each other. */
export const LOCK_QUIET_MS = 300

/* A row the host always draws at a site: a prompt, or the agent's text.
   A command's output is drawn at a site in the session that ran it but not
   after a resume, and a tool row at its group's or at its own, so those
   count once a site is seen drawing them; one counted and never reported
   on screen would cut every run around it. */
function isSiteRow(row: TranscriptRow): boolean {
  if (row.type === 'user') return inputKindOf(row) === 'prompt'
  return row.type === 'assistant' && hasText(row)
}

/* The drawable rows' places on the chain, in order: the rows drawn at a
   site, and every row a site was seen drawing. Rebuilt after a read. */
export function drawableRows(rows: RowIndex, sites: Sites): number[] {
  const out: number[] = []
  rows.chain.forEach((row, i) => {
    if (isSiteRow(row) || sites.idOf.has(row.uuid)) out.push(i)
  })
  return out
}

/* The first index in `sorted` holding a value above `value`. */
function firstAbove(sorted: readonly number[], value: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((sorted[mid] ?? 0) <= value) low = mid + 1
    else high = mid
  }
  return low
}

/* A row drawn for the first time, put in its place. */
export function addDrawable(drawable: number[], order: number): void {
  const at = firstAbove(drawable, order)
  if (drawable[at - 1] !== order) drawable.splice(at, 0, order)
}

/* The chain place of the last row a site drew; undefined before any. */
export function lastDrawnRow(rows: RowIndex, sites: Sites): number | undefined {
  let last: number | undefined
  for (const uuid of sites.idOf.keys()) {
    const at = rows.order.get(uuid)
    if (at !== undefined && (last === undefined || at > last)) last = at
  }
  return last
}

/* Each group's opener's place on the chain, in group order. */
export function openerRows(groups: readonly TurnGroup[], rows: RowIndex): number[] {
  return groups.map(group => rows.order.get(group.openerUuid) ?? -1)
}

/* The group a chain row belongs to: the one opened last at or before it;
   undefined before the first. */
export function groupOfRow(openers: readonly number[], order: number): number | undefined {
  const at = firstAbove(openers, order) - 1
  return at < 0 ? undefined : at
}

/* The rows the sites report on screen, by chain place; reports of rows the
   reads do not know yet are left out. */
export function liveRows(sites: Sites, rows: RowIndex): LiveRow[] {
  const out: LiveRow[] = []
  for (const record of sites.onScreen.values()) {
    const uuid = sites.rowOf.get(record.requestId)
    const order = uuid === undefined ? undefined : rows.order.get(uuid)
    if (order !== undefined) out.push({ order, onScreen: record.onScreen, seq: record.seq })
  }
  return out
}

/* The run of on-screen rows to trust, in chain order: the one holding the
   latest report. */
export function trustedRun(live: readonly LiveRow[], drawable: readonly number[]): LiveRow[] | undefined {
  const sorted = [...live].sort((a, b) => a.order - b.order)
  let run: LiveRow[] = []
  let best: LiveRow[] | undefined
  let latest = -1
  for (const row of sorted) {
    const prev = run[run.length - 1]
    /* Cut when a drawable row lies strictly between the two. */
    if (prev !== undefined && prev.order !== row.order && (drawable[firstAbove(drawable, prev.order)] ?? Infinity) < row.order) run = []
    run.push(row)
    if (row.seq > latest) {
      latest = row.seq
      best = run
    }
  }
  return best
}

export type PositionInput = {
  live: readonly LiveRow[]
  drawable: readonly number[]
  openers: readonly number[]
  /* The last row a site drew. */
  lastDrawn: number | undefined
  groups: number
  /* The group a jump locked the position on. */
  locked: number | undefined
}

/* The Current position: a group index, or undefined to light none. */
export function positionOf(input: PositionInput): number | undefined {
  if (input.locked !== undefined && input.locked < input.groups) return input.locked
  const run = trustedRun(input.live, input.drawable)
  const top = run?.[0]
  if (run === undefined || top === undefined) return undefined
  const lasts = run.filter(row => row.order === input.lastDrawn)
  if (input.groups > 0 && lasts.length > 0 && lasts.every(row => row.onScreen.last === row.onScreen.of - 1)) return input.groups - 1
  return groupOfRow(input.openers, top.order)
}

/* Whether a report moves a row in or out of the view or within it. */
export function isViewChange(was: OnScreenRows | undefined, now: OnScreenRows | null | undefined): boolean {
  if (now === undefined) return false
  if (now === null) return was !== undefined
  return was === undefined || was.first !== now.first || was.last !== now.last || was.of !== now.of
}

/* After a jump: the group it went to, whether its redraws have stopped,
   and how many view changes came so far (the quiet timer of the last one
   marks it quiet). */
export type JumpLock = { group: number; isQuiet: boolean; changes: number }

export function lockOn(group: number): JumpLock {
  return { group, isQuiet: false, changes: 0 }
}

/* A change of the view under a lock: one of the jump's own redraws while
   they keep coming (`held`, with the change's number to time its quiet),
   else the first change after them, which lets go. */
export function viewChanged(lock: JumpLock): { kind: 'held'; change: number } | { kind: 'released' } {
  if (lock.isQuiet) return { kind: 'released' }
  lock.changes += 1
  return { kind: 'held', change: lock.changes }
}

/* The quiet timer of change `change`: the redraws stopped when no change
   came after it. */
export function quietAfter(lock: JumpLock, change: number): void {
  if (lock.changes === change) lock.isQuiet = true
}

/* What one site report does under a jump lock (undefined: none), from
   where the row was to where it says it is now: the lock as it stands
   after it (released on the first change once the jump's redraws
   stopped), the change whose quiet timer to start while they still come,
   and whether the Current position is to be worked out again: after any
   report that says where the row is, a release by a row leaving the view
   included. */
export function siteReport(
  lock: JumpLock | undefined,
  was: OnScreenRows | undefined,
  now: OnScreenRows | null | undefined,
): { lock: JumpLock | undefined; quietAfter: number | undefined; isPlaced: boolean } {
  const isPlaced = now !== undefined
  if (lock === undefined || !isViewChange(was, now)) return { lock, quietAfter: undefined, isPlaced }
  const seen = viewChanged(lock)
  if (seen.kind === 'released') return { lock: undefined, quietAfter: undefined, isPlaced: true }
  return { lock, quietAfter: seen.change, isPlaced }
}
