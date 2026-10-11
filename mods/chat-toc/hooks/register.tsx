/* chat-toc: a docked table of contents of the current session's
   conversation. This module wires the host's events to the parts:
     transcript.ts / chain.ts / groups.ts / regroup.ts  the file to Turn groups
     source.ts / reader.ts                              how and when it is read
     entries.ts / cells.ts / window.ts / pane.tsx       what the pane draws
     sites.ts / jump.ts                                 where a press scrolls
   The host's `$` may only be handed to functions declared at the top of
   this file, so every call on `$` is made here or in one of them. */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { cardEntries } from './entries'
import type { Entry } from './entries'
import { REFUSED_MS, REFUSED_TEXT, dimRefused, jumpTargetsOf, relisted, sideKeyOf } from './jump'
import type { Refused } from './jump'
import { EMPTY_TEXT, PANE_COLUMNS, PANE_ID, PANE_TITLE, drawPane, entryHeight } from './pane'
import { LATE_CHECK_MS, TRAILING_MS, gateFinish, gateFired, gateRequest, gateStart, readGate } from './reader'
import { countUnreadable, newReading, readLines } from './regroup'
import type { Reading } from './regroup'
import { WHOLE_READ_LIMIT, chunkBytesFor, chunkCommand, chunkText, failReasonOf, readChunks, readCursor, takeWhole } from './source'
import type { Chunks, FailReason, ReadCursor, SourceRead } from './source'
import { newSites, noteSite, resolveSites, rowIndex, syncRows } from './sites'
import type { OnScreen, RowIndex, SiteComponent, Sites } from './sites'
import { scrolledTop, windowOf } from './window'
import type { TocWindow } from './window'

const transcriptPath = atom({ plugin: 'chat-toc', key: 'transcriptPath' } as const, '')
const rev = atom({ plugin: 'chat-toc', key: 'rev' } as const, 0)

type SourceState = 'unknown' | 'missing' | 'ok' | 'failed'

/* Why nothing is listed, kept at the bottom of the pane while it holds. */
const FAILURES: Record<FailReason, string> = {
  denied: '没有权限读本会话的 transcript，目录无法显示',
  error: '读不到本会话的 transcript，目录无法显示',
}

function unreadableText(lines: number): string {
  return `有 ${lines} 行无法识别，目录可能不完整`
}

/* What the reads so far made of the file. Module state: a hot reload starts
   it over, and `session.start` then reads again. */
let reading: Reading = newReading()
let cursor: ReadCursor = readCursor()
let source: SourceState = 'unknown'
let failure: FailReason = 'error'
/* The file's size at the last read; undefined reads it from the start. */
let lastSize: number | undefined
/* Whether the main agent's turn is under way: from `turn.start` until the
   read after its `turn.complete`, so the last group shows in progress until
   the file's account of the turn is read. A hot reload in mid-turn forgets
   it until the next turn starts. */
let isTurnRunning = false
let isTurnEnding = false
const gate = readGate()
/* The window's top entry while the person has scrolled the pane; undefined
   follows the newest entry. */
let top: number | undefined
let lastWindow: TocWindow = { start: 0, end: 0, maxStart: 0 }
/* The chain rows by what the host draws them under, and what it drew. */
let rows: RowIndex = rowIndex([])
let sites: Sites = newSites()
/* Sides whose every jump target the host refused, drawn dim until it draws
   one of them again. */
let refused: Refused = new Map()
/* The refusal said at the bottom: the entry pressed, and which saying it is
   (its timer clears only its own). */
let refusal: { key: string; n: number } | undefined
let refusals = 0
let isRedrawQueued = false

function startOver(): void {
  reading = newReading()
  cursor = readCursor()
  lastSize = undefined
}

function forget(): void {
  startOver()
  source = 'unknown'
  top = undefined
  rows = rowIndex([])
  sites = newSites()
  refused = new Map()
  refusal = undefined
}

/* Redraws the pane once the drawing under way is done: a render hook may
   not write `$.state` itself. */
function redrawSoon($: EngineInterface): void {
  if (isRedrawQueued) return
  isRedrawQueued = true
  $.clock.after(0, () => {
    isRedrawQueued = false
    void update($, rev, n => n + 1)
  })
}

/* The transcript drew a site: remembered with where it is on screen; a row
   drawn again brings back the sides refused for want of it. */
function sawSite($: EngineInterface, component: SiteComponent, requestId: string, onScreen: OnScreen): void {
  const uuid = noteSite(sites, rows, component, requestId, onScreen)
  if (uuid !== undefined && refused.size > 0 && relisted(refused, uuid, reading.groups, rows, sites)) redrawSoon($)
}

/* One chunk of the file at `offset`, as text. */
async function runChunk($: EngineInterface, path: string, offset: number): Promise<string> {
  const command = chunkCommand(path, offset)
  const ran = await $.process.run(command.argv, command.env === undefined ? undefined : { env: command.env })
  if (ran.exitCode !== 0) throw new Error(ran.stderr)
  return chunkText(path, ran.stdout)
}

/* Reads what is new in the file since the last read, onto `at`: the whole
   file whole when it is read from the start and fits one `$.fs.read`, else
   chunks from the offset. */
async function readSource($: EngineInterface, path: string, at: ReadCursor): Promise<SourceRead> {
  let size: number
  try {
    size = (await $.fs.stat(path)).size
  } catch (error) {
    try {
      return (await $.fs.exists(path)) ? { kind: 'failed', reason: failReasonOf(error) } : { kind: 'missing' }
    } catch {
      return { kind: 'failed', reason: 'error' }
    }
  }
  if (size === lastSize) return { kind: 'unchanged' }
  const isFromStart = lastSize === undefined || size < lastSize || size < at.offset
  if (isFromStart) Object.assign(at, readCursor())
  try {
    let chunks: Chunks | undefined
    if (isFromStart && size <= WHOLE_READ_LIMIT) {
      try {
        chunks = takeWhole(at, await $.fs.read(path))
      } catch {
        /* Grown past what `$.fs.read` takes since the stat, or refused:
           the chunks say which. */
      }
    }
    chunks ??= await readChunks(at, size, chunkBytesFor(path), offset => runChunk($, path, offset))
    return { kind: 'lines', chunks, isFromStart, size }
  } catch (error) {
    return { kind: 'failed', reason: failReasonOf(error) }
  }
}

async function load($: EngineInterface): Promise<void> {
  const path = await read($, transcriptPath)
  if (!path) return
  const at = { ...cursor }
  const got = await readSource($, path, at)
  if (got.kind === 'unchanged') return
  if (got.kind === 'lines') {
    if (got.isFromStart) reading = newReading()
    for (const lines of got.chunks.lines) readLines(reading, lines)
    countUnreadable(reading, got.chunks.overlong)
    resolveSites(sites, rows, syncRows(rows, reading.chain))
    cursor = at
    lastSize = got.size
    source = 'ok'
  } else {
    startOver()
    source = got.kind
    if (got.kind === 'failed') failure = got.reason
  }
  await update($, rev, n => n + 1)
}

function readNow($: EngineInterface): void {
  if (!gateStart(gate)) return
  void load($)
    .catch(() => undefined)
    .finally(() => {
      if (gateFinish(gate)) readNow($)
      else if (isTurnEnding) endTurn($)
    })
}

function endTurn($: EngineInterface): void {
  isTurnRunning = false
  isTurnEnding = false
  void update($, rev, n => n + 1)
}

function requestRead($: EngineInterface): void {
  if (!gateRequest(gate)) return
  $.clock.after(TRAILING_MS, () => {
    gateFired(gate)
    readNow($)
  })
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE_ID, title: PANE_TITLE, columns: PANE_COLUMNS })
}

/* Only ever called from a press: the host moves the transcript only for
   the person's own input. Tries the side's targets in order; when the host
   refuses them all, says so at the bottom for a while and dims the side. */
async function jump($: EngineInterface, entry: Entry): Promise<void> {
  const group = reading.groups[entry.groupIndex]
  if (!group) return
  const key = sideKeyOf(group, entry.side)
  const wasShown = refusal !== undefined || refused.has(key)
  refusal = undefined
  for (const target of jumpTargetsOf(group, entry.side, rows, sites)) {
    const got = await $.ui
      .scroll({ to: { requestId: target.requestId }, block: target.block })
      .catch((error: unknown) => ({ deny: String(error) }))
    if (got.deny === undefined) {
      refused.delete(key)
      if (wasShown) await update($, rev, n => n + 1)
      return
    }
  }
  refused.set(key, { side: entry.side, opener: group.openerUuid, groupIndex: entry.groupIndex })
  const n = ++refusals
  refusal = { key: entry.key, n }
  $.clock.after(REFUSED_MS, () => {
    if (refusal?.n !== n) return
    refusal = undefined
    void update($, rev, x => x + 1)
  })
  await update($, rev, x => x + 1)
}

/* Whether a Button key is one of an entry's lines. */
const isLineOf = (element: string | undefined, key: string) => element === key || (element?.startsWith(`${key}.`) ?? false)

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    const path = e.transcript_path ?? ''
    if (path !== (await read($, transcriptPath))) {
      await update($, transcriptPath, () => path)
      forget()
    }
    readNow($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chat-toc', description: '打开对话目录', immediate: true })
    readNow($)
    const panes = await $.ui.panes()
    if (!panes.some(pane => pane.id === PANE_ID)) void openPane($)
    return next(e)
  })

  on('command.run', { command: 'chat-toc' }, async $ => {
    await openPane($)
    return {}
  })

  /* Rows the main loop keeps; a subagent's go to a file of its own. */
  on('session.append', ($, e, next) => {
    if (e.agentId === undefined) requestRead($)
    return next(e)
  })

  /* The redraw waits for the read the turn's first rows ask for, so the
     group the turn belongs to is listed before it shows in progress. */
  on('turn.start', ($, e, next) => {
    isTurnRunning = true
    isTurnEnding = false
    requestRead($)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnEnding = isTurnRunning
      requestRead($)
      $.clock.after(LATE_CHECK_MS, () => readNow($))
    }
    return next(e)
  })

  on('ui.scroll', { component: 'Pane', requestId: 'chat-toc' }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    top = scrolledTop(lastWindow, e.by)
    await update($, rev, n => n + 1)
    return {}
  })

  /* The pane's selection moving off the entry a refusal is about takes the
     refusal away. */
  on('ui.focus', { component: 'Pane', requestId: 'chat-toc' }, ($, e, next) => {
    if (refusal !== undefined && !isLineOf(e.element, refusal.key)) {
      refusal = undefined
      redrawSoon($)
    }
    return next(e)
  })

  /* The transcript's rows, read and never redrawn: which requestId each is
     drawn under, and where it is on screen. */
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    sawSite($, 'UserMessage', e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    sawSite($, 'AssistantMessage', e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => {
    sawSite($, 'CommandOutput', e.requestId, e.props.onScreen)
    return next(e)
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    sawSite($, 'ToolGroup', e.requestId, e.props.onScreen)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'chat-toc' }, async ($, e) => {
    await read($, rev)
    const isOk = source === 'ok'
    const listed = isOk ? cardEntries(reading.groups, e.props.bodyColumns, await $.clock.now(), isTurnRunning) : []
    const entries = dimRefused(listed, reading.groups, refused)
    const notice = (isOk && entries.length === 0) || source === 'missing' ? EMPTY_TEXT : undefined
    const why = source === 'failed' ? FAILURES[failure] : isOk && reading.unreadable > 0 ? unreadableText(reading.unreadable) : undefined
    const footerLines = [refusal === undefined ? undefined : REFUSED_TEXT, why].filter((s): s is string => s !== undefined)
    const footer = footerLines.length > 0 ? footerLines.join('\n') : undefined
    const heights = entries.map((_, i) => entryHeight(entries, i))
    const lines = (notice === undefined ? 0 : 1) + footerLines.length
    lastWindow = windowOf(heights, e.props.scroll.bodyRows - lines, top)
    return drawPane($.ui.resolve(e), { entries, window: lastWindow, notice, footer, onPress: entry => jump($, entry) })
  })
}
