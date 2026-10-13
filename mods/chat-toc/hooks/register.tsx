/* chat-toc: a docked table of contents of the current session's
   conversation. This module wires the host's events to the parts:
     transcript.ts / chain.ts / groups.ts / regroup.ts  the file to Turn groups
     source.ts / reader.ts / locate.ts                  how, when and where it is read
     rewind.ts                                          what a rewind took, before the file says
     view.ts / entries.ts / cells.ts / window.ts        what the pane draws
     pane.tsx / ring.ts                                 how it draws, the keyboard
     sites.ts / jump.ts                                 where a press scrolls
     position.ts                                        what the view is on
   The host's `$` may only be handed to functions declared at the top of
   this file, so every call on `$` is made here or in one of them. */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderViewport } from 'claude-code'
import type { Entry } from './entries'
import { sideText } from './entries'
import { drawDesktopPane } from './desktop'
import type { TurnGroup } from './groups'
import {
  COMPACTED_TEXT,
  FLASHES,
  FLASH_MS,
  REFUSED_MS,
  REFUSED_TEXT,
  compactedSides,
  dimRefused,
  jumpTargetsOf,
  lastBoundary,
  refusalFrame,
  relisted,
  sideKeyOf,
} from './jump'
import type { Refused } from './jump'
import { DOCK_STATUS, carriesHistory, isClosedByPerson, placementFate, reopensOn } from './lifecycle'
import { EMPTY_TEXT, NOT_WRITTEN_TEXT, PANE_COLUMNS, PANE_ID, PANE_TITLE, drawPane, FOOT_ROWS, HEAD_ROWS } from './pane'
import { entryAt, pendingShown, ringMove } from './ring'
import { UNLOCATED_TEXT, derivedTranscriptPath } from './locate'
import { rewoundFrom } from './rewind'
import { FILTER_KEY, LAYOUT_KEY, filterOf, layoutOf, nextLayout } from './view'
import type { Layout, ViewFilter } from './view'
import { PERF_FLUSH_MS, newPerf, note, perfNow, takeLines } from './perf'
import type { PerfMetric } from './perf'
import { LATE_CHECK_MS, TRAILING_MS, gateFinish, gateFired, gateRequest, gateStart, readGate } from './reader'
import { countUnreadable, newReading, readLines } from './regroup'
import type { Reading } from './regroup'
import { WHOLE_READ_LIMIT, chunkBytesFor, chunkCommand, chunkText, failReasonOf, readChunks, readCursor, takeWhole } from './source'
import type { Chunks, FailReason, ReadCursor, SourceRead } from './source'
import { SITE_COMPONENTS, newSites, noteSite, resolveSites, rowIndex, syncRows } from './sites'
import type { OnScreen, RowIndex, SiteComponent, Sites } from './sites'
import {
  LOCK_QUIET_MS,
  addDrawable,
  drawableRows,
  lastDrawnRow,
  liveRows,
  lockOn,
  openerRows,
  positionOf,
  quietAfter,
  siteReport,
} from './position'
import type { JumpLock } from './position'
import { entryOfGroup, entryTable, newEntryCache } from './table'
import type { EntryTable } from './table'
import { scrolledTop, topOfDrawing, topRevealing, windowOf } from './window'
import type { SwitchAnchor, TocWindow } from './window'

const transcriptPath = atom({ plugin: 'chat-toc', key: 'transcriptPath' } as const, '')
const rev = atom({ plugin: 'chat-toc', key: 'rev' } as const, 0)
const isClosed = atom({ plugin: 'chat-toc', key: 'isClosed' } as const, false)
const isCarriedOver = atom({ plugin: 'chat-toc', key: 'isCarriedOver' } as const, false)
const isInlineAsked = atom({ plugin: 'chat-toc', key: 'isInlineAsked' } as const, false)
const currentPosition = atom({ plugin: 'chat-toc', key: 'currentPosition' } as const, null as number | null)
const compactedAt = atom({ plugin: 'chat-toc', key: 'compactedAt' } as const, null as string | null)

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
/* No path is known and none could be worked out: the pane says the next
   submit brings one. */
let isUnlocated = false
/* The file's size at the last read; undefined reads it from the start. */
let lastSize: number | undefined
/* Whether the main agent's turn is under way: from `turn.start` until the
   read after its `turn.complete`, so the last group shows in progress until
   the file's account of the turn is read. A hot reload in mid-turn forgets
   it until the next turn starts. */
let isTurnRunning = false
let isTurnEnding = false
const gate = readGate()
/* The window's top entry; undefined shows the newest. While following it
   is wherever keeps the lit group in view. */
let top: number | undefined
/* Following stops while the person scrolls the pane or it has the
   keyboard, and starts again when the Current position next moves. */
let isPaused = false
/* The Current position the window last followed, and the one drawn last. */
let positionFollowed: number | undefined
let positionDrawn: number | undefined
/* The opens chat-toc makes on its own, one after another, so two start
   events at once (a process started with --resume raises both) find the
   first one's pane and open one. */
let opening: Promise<void> = Promise.resolve()
/* The terminal's layout, as its drawings say it (fixed for the process);
   undefined until one is drawn, and an unasked open waits for it. */
let isFullscreen: boolean | undefined
let isOpenWanted = false
/* The status line as last set; null after a load, when what the host shows
   is not known. */
let statusShown: string | undefined | null = null
/* Withdrawals since the pane last docked, so a pane the host keeps seating
   inline is not withdrawn and reopened without end: the second one leaves
   it closed until the terminal's width changes (`parkedAt`, the width it
   was left at), when it opens again unasked. */
let withdrawals = 0
let isWithdrawing = false
let parkedAt: number | undefined
/* The terminal's width, as its drawings last said it. */
let columns: number | undefined

/* The person's choices, read from `$.store` at each `session.start`. */
let filter: ViewFilter = 'all'
let layout: Layout = 'card'

/* What the pane drew last, for the keyboard and the next switch: the
   entries, their keys and the table back, their heights, the rows the
   window had, and the window. */
type Drawing = {
  entries: readonly Entry[]
  keys: readonly string[]
  indexOf: ReadonlyMap<string, number>
  heights: readonly number[]
  rows: number
  window: TocWindow
}
let lastDrawing: Drawing = { entries: [], keys: [], indexOf: new Map(), heights: [], rows: 1, window: { start: 0, end: 0, maxStart: 0 } }
/* The Button the host's focus ring is on while the pane has the keyboard,
   as its moves and chat-toc's own sends left it. */
let ring: string | undefined
let isPaneFocused = false
/* An entry the ring goes to once a drawing shows it: after a switch, or
   after the window moved to bring the next entry in. That drawing sends
   it, and sends it again a few times while the host refuses it (its new
   frame not yet in), unless the ring moved on meanwhile. */
let pendingRing: string | undefined
const RING_RETRIES = 3
const RING_RETRY_MS = 50
/* A sent move is sent once more from a later drawing: across a redraw
   that changes its Buttons the host puts the ring back on the same place
   in its order once the new frame is in, at times after the send landed
   (2.1.287, a switch to the timeline Layout). With no drawing within this
   long, the pane asks for one. */
let ringOwed: string | undefined
const RING_CONFIRM_MS = 150
/* The group a switch of filter or Layout keeps in view, resolved by the
   next drawing. */
let anchor: SwitchAnchor | undefined
/* Said at the bottom while the window does not follow the Current position. */

/* The chain rows by what the host draws them under, and what it drew. */
let chainRows: RowIndex = rowIndex([])
let sites: Sites = newSites()
/* Sides whose every jump target the host refused, or known compacted
   before a resume, drawn dim until it draws one of them again. */
let refused: Refused = new Map()
/* Whether the compacted sides are in `refused` for what was read. */
let isCompactedMarked = false
/* The refusal said at the bottom: the entry pressed, which saying it is
   (its timers act only on their own), what it says, and when it began. */
let refusal: { key: string; n: number; text: string; at: number } | undefined
let refusals = 0
let isRedrawQueued = false

/* For the Current position (position.ts): the drawable rows' and the group
   openers' places on the chain, the last row drawn, the group a jump
   locked it on, and the position as last worked out. */
type Positioning = {
  drawable: number[]
  openers: number[]
  lastDrawn: number | undefined
  lock: JumpLock | undefined
  position: number | undefined
}
const newPositioning = (): Positioning => ({ drawable: [], openers: [], lastDrawn: undefined, lock: undefined, position: undefined })
let placing: Positioning = newPositioning()
let isPositionQueued = false

/* A rewind's turns, gone from the host's messages but still in the file
   until it grows (rewind.ts): the opener of the first group not listed.
   The turn count as last read, which only a rewind (or a compaction)
   makes smaller. */
let rewound: string | undefined
let lastTurns: number | undefined
let isRewindCheckQueued = false
let isRewindRecheckQueued = false
/* A rewind's check runs as the hint line is drawn and again this long
   after, should the host's messages not be cut yet. */
const REWIND_RECHECK_MS = 300
let shownMemo: { groups: readonly TurnGroup[]; opener: string; shown: readonly TurnGroup[] } | undefined

/* The groups the pane lists: the file's, short of a rewind's. */
function shownGroups(): readonly TurnGroup[] {
  if (rewound === undefined) return reading.groups
  if (shownMemo?.groups === reading.groups && shownMemo.opener === rewound) return shownMemo.shown
  const at = reading.groups.findIndex(g => g.openerUuid === rewound)
  const shown = at === -1 ? reading.groups : reading.groups.slice(0, at)
  shownMemo = { groups: reading.groups, opener: rewound, shown }
  return shown
}

/* The entries kept between drawings (table.ts). */
let entryCache = newEntryCache()
const NO_ENTRIES: EntryTable = { entries: [], heights: [], keys: [], indexOf: new Map(), firstOfGroup: [] }

/* The long-session timings (perf.ts): on when the host runs with
   CHAT_TOC_PERF set, asked once per module load; the first main-loop row
   appended since the last read; whether the first listing was timed. */
const perf = newPerf()
const loadedAt = perfNow()
let isPerfAsked = false
let appendedAt: number | undefined
let isListedNoted = false

function startOver(): void {
  reading = newReading()
  cursor = readCursor()
  lastSize = undefined
}

function forget(): void {
  startOver()
  source = 'unknown'
  top = undefined
  anchor = undefined
  chainRows = rowIndex([])
  sites = newSites()
  refused = new Map()
  rewound = undefined
  isCompactedMarked = false
  refusal = undefined
  placing = newPositioning()
  entryCache = newEntryCache()
}

async function askPerf($: EngineInterface): Promise<void> {
  if (isPerfAsked) return
  isPerfAsked = true
  perf.isOn = Boolean(await $.env.get('CHAT_TOC_PERF').catch(() => undefined))
}

/* Keeps a timing sample; a second later debug log lines take all the
   samples gathered meanwhile. */
function timed($: EngineInterface, metric: PerfMetric, values: readonly number[]): void {
  if (!note(perf, metric, values) || perf.isFlushQueued) return
  perf.isFlushQueued = true
  $.clock.after(PERF_FLUSH_MS, () => {
    perf.isFlushQueued = false
    for (const line of takeLines(perf)) $.ui.log(line, { to: 'debug' })
  })
}

/* Redraws the pane once the drawing under way is done: a render hook may
   not write `$.state` itself. */
function redrawSoon($: EngineInterface): void {
  if (isRedrawQueued) return
  isRedrawQueued = true
  $.clock.after(0, () => {
    isRedrawQueued = false
    void update($, rev, n => n + 1).catch(() => undefined)
  })
}

/* Works the Current position out again; when it moved, the pane hears of
   it once the drawing under way is done (a render hook may not write
   `$.state`). */
function place($: EngineInterface): void {
  const began = perf.isOn ? perfNow() : 0
  const position = positionOf({
    live: liveRows(sites, chainRows),
    drawable: placing.drawable,
    openers: placing.openers,
    lastDrawn: placing.lastDrawn,
    groups: shownGroups().length,
    locked: placing.lock?.group,
  })
  if (perf.isOn) timed($, 'position', [perfNow() - began, sites.onScreen.size, placing.drawable.length])
  if (position === placing.position) return
  placing.position = position
  if (isPositionQueued) return
  isPositionQueued = true
  $.clock.after(0, () => {
    isPositionQueued = false
    void showPosition($).catch(() => undefined)
  })
}

/* The pane reads the position from `$.state`. A tab behind another pane is
   not drawn: a move while it is there ends the pause, so the first frame
   back follows. */
async function showPosition($: EngineInterface): Promise<void> {
  const value = placing.position ?? null
  if (value === (await read($, currentPosition))) return
  await update($, currentPosition, () => value)
  if (!isPaused) return
  const pane = (await $.ui.panes()).find(p => p.id === PANE_ID)
  if (pane !== undefined && !pane.isShown) isPaused = false
}

/* A jump landed: the position holds its group until the view changes
   after the jump's own redraws. */
function lockAfterJump($: EngineInterface, group: number): void {
  const held = lockOn(group)
  placing.lock = held
  $.clock.after(LOCK_QUIET_MS, () => quietAfter(held, 0))
  place($)
}

/* The transcript drew a site: remembered with where it is on screen; a row
   drawn again brings back the sides refused for want of it; where the view
   is is worked out again. */
function sawSite($: EngineInterface, component: SiteComponent, requestId: string, onScreen: OnScreen): void {
  const was = sites.onScreen.get(`${component}|${requestId}`)?.onScreen
  const drawnBefore = sites.idOf.size
  const uuid = noteSite(sites, chainRows, component, requestId, onScreen)
  if (uuid !== undefined && refused.size > 0 && relisted(refused, uuid, reading.groups, chainRows, sites)) redrawSoon($)
  const order = uuid === undefined ? undefined : chainRows.order.get(uuid)
  if (order !== undefined && sites.idOf.size !== drawnBefore) {
    addDrawable(placing.drawable, order)
    if (placing.lastDrawn === undefined || order > placing.lastDrawn) placing.lastDrawn = order
  }
  const held = placing.lock
  const report = siteReport(held, was, onScreen)
  placing.lock = report.lock
  const change = report.quietAfter
  if (held !== undefined && change !== undefined) $.clock.after(LOCK_QUIET_MS, () => quietAfter(held, change))
  if (report.isPlaced) place($)
}

/* The terminal's layout, as a drawing on it says; the first word of it
   lets an open that waited for it go ahead. */
function sawViewport($: EngineInterface, viewport: RenderViewport | undefined): void {
  if (viewport === undefined) return
  columns = viewport.columns
  const said = viewport.isFullscreen
  if (said !== undefined && said !== isFullscreen) {
    isFullscreen = said
    if (isOpenWanted) $.clock.after(0, () => void autoOpen($))
  }
  /* A pane left closed after a second withdrawal: the width changed, so it
     opens again by the auto-open rule, as the status line promised. */
  if (parkedAt !== undefined && viewport.columns !== parkedAt) {
    parkedAt = undefined
    $.clock.after(0, () => void autoOpen($))
  }
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
  const began = perfNow()
  const asked = appendedAt
  appendedAt = undefined
  const at = { ...cursor }
  const got = await readSource($, path, at)
  /* A classic event moved the session to another file meanwhile: what was
     read is not its, and the read it asked for runs after this one. */
  if (path !== (await read($, transcriptPath))) return
  const sourced = perfNow()
  if (got.kind === 'unchanged') {
    appendedAt ??= asked
    if (await markCompacted($)) await update($, rev, n => n + 1)
    return
  }
  if (got.kind === 'lines') {
    if (got.isFromStart) {
      reading = newReading()
      isCompactedMarked = false
    }
    for (const lines of got.chunks.lines) readLines(reading, lines)
    countUnreadable(reading, got.chunks.overlong)
    resolveSites(sites, chainRows, syncRows(chainRows, reading.chain))
    cursor = at
    lastSize = got.size
    source = 'ok'
    /* The file grew: it says again what the conversation holds. */
    rewound = undefined
    await markCompacted($)
  } else {
    startOver()
    source = got.kind
    if (got.kind === 'failed') failure = got.reason
  }
  /* The rows a read brings, and a hot reload's sites drawn before it, only
     place the view once the rows are known. */
  placing.openers = openerRows(reading.groups, chainRows)
  placing.drawable = drawableRows(chainRows, sites)
  placing.lastDrawn = lastDrawnRow(chainRows, sites)
  place($)
  if (perf.isOn && got.kind === 'lines') {
    const ended = perfNow()
    const full = reading.lastRegroup === 'full' ? 1 : 0
    timed($, got.isFromStart ? 'read.whole' : 'read.tail', [ended - began, sourced - began, got.chunks.lines.length, reading.groups.length, reading.chain.length, got.size, full])
    if (asked !== undefined) timed($, 'append.model', [ended - asked])
  }
  await update($, rev, n => n + 1)
}

/* In a session this process resumed, the sides the host refuses for sure
   are dimmed: the first read after the resume keeps the last compaction the
   file had, and every read of the file from the start marks its sides
   again. Whether it marked them now. */
async function markCompacted($: EngineInterface): Promise<boolean> {
  if (source !== 'ok') return false
  let boundary = await read($, compactedAt)
  if (boundary === '') {
    const found = lastBoundary(reading.chain) ?? null
    boundary = found
    await update($, compactedAt, () => found)
    isCompactedMarked = false
  }
  if (boundary === null || isCompactedMarked) return false
  isCompactedMarked = true
  for (const [key, side] of compactedSides(reading.groups, chainRows, sites, boundary)) if (!refused.has(key)) refused.set(key, side)
  return true
}

/* The turn count dropped: the host's messages say which groups a rewind
   took; messages that do not line up with the file leave the list be. */
async function checkRewind($: EngineInterface): Promise<void> {
  const turns = await $.session.turns()
  const was = lastTurns
  lastTurns = turns
  if (was === undefined || turns >= was || source !== 'ok') return
  const found = rewoundFrom(reading.groups, reading.chain, await $.session.messages())
  if (found.kind === 'unknown') return
  const opener = found.kind === 'all' ? undefined : reading.groups[found.group]?.openerUuid
  if (opener === rewound) return
  rewound = opener
  place($)
  await update($, rev, n => n + 1)
}

/* Asked by every drawing of the hint line, which a rewind's restore makes;
   a drawing may not write `$.state`, so it runs after. */
function checkRewindSoon($: EngineInterface): void {
  if (!isRewindCheckQueued) {
    isRewindCheckQueued = true
    $.clock.after(0, () => {
      isRewindCheckQueued = false
      void checkRewind($).catch(() => undefined)
    })
  }
  if (!isRewindRecheckQueued) {
    isRewindRecheckQueued = true
    $.clock.after(REWIND_RECHECK_MS, () => {
      isRewindRecheckQueued = false
      void checkRewind($).catch(() => undefined)
    })
  }
}

function readNow($: EngineInterface): void {
  if (!gateStart(gate)) return
  void load($)
    .catch(() => undefined)
    .finally(() => {
      if (gateFinish(gate)) readNow($)
      else if (isTurnEnding) endTurn($)
    })
    /* Nothing of a failure is said here: its text may quote the file. */
    .catch(() => undefined)
}

function endTurn($: EngineInterface): void {
  isTurnRunning = false
  isTurnEnding = false
  void update($, rev, n => n + 1).catch(() => undefined)
}

function requestRead($: EngineInterface): void {
  if (!gateRequest(gate)) return
  $.clock.after(TRAILING_MS, () => {
    gateFired(gate)
    readNow($)
  })
}

/* A classic event's `transcript_path`: one unlike the path in use (worked
   out, or another conversation's) replaces it and the file is read again
   from the start. Whether it did. */
async function adoptPath($: EngineInterface, path: string | undefined): Promise<boolean> {
  if (!path || path === (await read($, transcriptPath))) return false
  await update($, transcriptPath, () => path)
  isUnlocated = false
  forget()
  return true
}

/* `session.start` with no path known, as when the plugin is enabled in
   mid-session: the path is worked out (locate.ts). A classic event's path
   that came meanwhile is kept. */
async function locate($: EngineInterface, cwd: string): Promise<void> {
  if (await read($, transcriptPath)) return
  const sessionId = await $.session.id().catch(() => '')
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  const home = await $.env.get('HOME').catch(() => undefined)
  const userProfile = await $.env.get('USERPROFILE').catch(() => undefined)
  const path = derivedTranscriptPath({ sessionId, cwd, configDir, home, userProfile })
  if (path !== undefined) {
    await update($, transcriptPath, known => known || path)
    return
  }
  if (await read($, transcriptPath)) return
  isUnlocated = true
  await update($, rev, n => n + 1)
}

function openPane($: EngineInterface, focus?: true) {
  return $.ui.open({ id: PANE_ID, title: PANE_TITLE, columns: PANE_COLUMNS, ...(focus === undefined ? {} : { focus }) })
}

function showStatus($: EngineInterface, text: string | undefined): void {
  if (text === statusShown) return
  statusShown = text
  $.ui.status(text)
}

/* Opens the pane unasked, in the fullscreen layout only, unless the person
   closed it in this session or it is open already, as it stays across a hot
   reload. While it cannot dock the status line says why. */
async function openUnasked($: EngineInterface): Promise<void> {
  if (isFullscreen === undefined) {
    isOpenWanted = true
    return
  }
  isOpenWanted = false
  if (await read($, isClosed)) return
  if (!isFullscreen) return showStatus($, DOCK_STATUS.mainScreen)
  const pane = (await $.ui.panes()).find(p => p.id === PANE_ID)
  const isPlaced = pane === undefined ? (await openPane($)).isPlaced : pane.isPlaced
  if (!isPlaced) showStatus($, DOCK_STATUS.narrow)
}

function autoOpen($: EngineInterface): Promise<void> {
  opening = opening.then(() => openUnasked($)).catch(() => undefined)
  return opening
}

/* /chat-toc: opens the pane, or raises the open one, shown or a tab behind
   another, and asks for the keyboard either way: the person asked for it,
   unlike an open of chat-toc's own. It never closes it. */
async function openAsked($: EngineInterface): Promise<void> {
  await update($, isClosed, () => false)
  await update($, isInlineAsked, () => true)
  await openPane($, true)
}

/* Docked: nothing to explain, and a later inline is the terminal narrowing. */
async function settleDocked($: EngineInterface): Promise<void> {
  withdrawals = 0
  parkedAt = undefined
  showStatus($, undefined)
  if (await read($, isInlineAsked)) await update($, isInlineAsked, () => false)
}

/* The host turned the docked pane inline: closed (not the person's close,
   so not kept closed) and opened again unasked, to wait undrawn for the
   room to dock, the status line saying so meanwhile. Seated inline again
   before it docked, it stays closed until the width next changes. */
async function withdraw($: EngineInterface): Promise<void> {
  if (isWithdrawing) return
  isWithdrawing = true
  try {
    withdrawals += 1
    await $.ui.close({ id: PANE_ID }).catch(() => undefined)
    if (withdrawals > 1) {
      parkedAt = columns ?? -1
      return showStatus($, DOCK_STATUS.narrow)
    }
    await autoOpen($)
  } finally {
    isWithdrawing = false
  }
}

/* Only ever called from a press: the host moves the transcript only for
   the person's own input. Tries the side's targets in order; when the host
   refuses them all, says so at the bottom for a while and dims the side. */
async function jump($: EngineInterface, entry: Entry): Promise<void> {
  const group = reading.groups[entry.groupIndex]
  if (!group) return
  const key = sideKeyOf(group, entry.side)
  const wasShown = refusal !== undefined || refused.has(key)
  const why = refused.get(key)?.why ?? 'refused'
  refusal = undefined
  for (const target of jumpTargetsOf(group, entry.side, chainRows, sites)) {
    const got = await $.ui
      .scroll({ to: { requestId: target.requestId }, block: target.block })
      .catch((error: unknown) => ({ deny: String(error) }))
    if (got.deny === undefined) {
      refused.delete(key)
      lockAfterJump($, entry.groupIndex)
      if (wasShown) await update($, rev, n => n + 1)
      return
    }
  }
  refused.set(key, { side: entry.side, opener: group.openerUuid, groupIndex: entry.groupIndex, why })
  const n = ++refusals
  refusal = { key: entry.key, n, text: why === 'compacted' ? COMPACTED_TEXT : REFUSED_TEXT, at: await $.clock.now() }
  /* Each step of the flash is drawn. */
  for (let step = 1; step <= FLASHES * 2; step++) {
    $.clock.after(step * FLASH_MS, () => {
      if (refusal?.n === n) void update($, rev, x => x + 1).catch(() => undefined)
    })
  }
  $.clock.after(REFUSED_MS, () => {
    if (refusal?.n !== n) return
    refusal = undefined
    void update($, rev, x => x + 1).catch(() => undefined)
  })
  await update($, rev, x => x + 1)
}

/* Whether a Button key is one of an entry's lines. */
const isLineOf = (element: string | undefined, key: string) => element === key || (element?.startsWith(`${key}.`) ?? false)

/* The selection moving off the entry a refusal is about takes the refusal
   away. */
function selectionMoved($: EngineInterface, element: string | undefined): void {
  if (refusal === undefined || isLineOf(element, refusal.key)) return
  refusal = undefined
  redrawSoon($)
}

/* The filter and Layout the person chose last; a store that cannot be
   read, or a value not known, reads as the default. */
async function loadChoices($: EngineInterface): Promise<void> {
  filter = filterOf(await $.store.get(FILTER_KEY).catch(() => undefined))
  layout = layoutOf(await $.store.get(LAYOUT_KEY).catch(() => undefined))
}

/* The group a switch keeps in view: the selected entry's while the pane
   has the keyboard, else the lit one, else the window's top one while the
   person has scrolled it. None while following, which keeps the lit group
   in view itself, or follows the newest. */
function anchorForSwitch(): void {
  const wasFollowing = top === undefined
  const selectedAt = isPaneFocused ? entryAt(ring, lastDrawing.indexOf) : undefined
  const selected = selectedAt === undefined ? undefined : lastDrawing.entries[selectedAt.index]
  if (selected !== undefined && ring !== undefined) anchor = { by: 'ring', ring, group: selected.groupIndex, wasFollowing }
  else if (!isPaused && !isPaneFocused) anchor = undefined
  else if (positionDrawn !== undefined) anchor = { by: 'lit', group: positionDrawn, wasFollowing }
  else {
    const entry = top !== undefined ? lastDrawing.entries[lastDrawing.window.start] : undefined
    anchor = entry === undefined ? undefined : { by: 'top', group: entry.groupIndex, wasFollowing }
  }
}

/* The choice applies at once; a store that refuses it only means it is
   not remembered. */
async function chooseFilter($: EngineInterface, chosen: ViewFilter): Promise<void> {
  if (chosen === filter) return
  anchorForSwitch()
  filter = chosen
  await update($, rev, n => n + 1)
  await $.store.set(FILTER_KEY, chosen).catch(() => undefined)
}

/* The Layout after this one or, from the desktop's select, the one picked. */
async function chooseLayout($: EngineInterface, to?: Layout): Promise<void> {
  if (to === layout) return
  anchorForSwitch()
  layout = to ?? nextLayout(layout)
  await update($, rev, n => n + 1)
  await $.store.set(LAYOUT_KEY, layout).catch(() => undefined)
}

/* Moves the focus ring onto an entry a drawing now shows (the drawing
   noted it in `ring` already: the host does not raise this plugin's own
   move to its `ui.focus` hook). Refused while the new frame is not in, it
   is sent again a few times, as long as the ring is still headed there. */
function sendRing($: EngineInterface, key: string, left = RING_RETRIES): void {
  if (ring !== key) return
  const again = () => {
    if (left > 0) $.clock.after(RING_RETRY_MS, () => sendRing($, key, left - 1))
  }
  void $.ui.focus({ requestId: PANE_ID, key }).then(
    moved => {
      if (moved.deny !== undefined) again()
    },
    () => again(),
  )
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    /* A worked-out path may have come first: a resume onto the same file
       still carries history. */
    if ((await adoptPath($, e.transcript_path)) || carriesHistory(e.source)) await update($, isCarriedOver, () => carriesHistory(e.source))
    await askPerf($)
    readNow($)
    /* /clear and /resume start another conversation; the host resets
       `$.state` with it, and the pane opens for it as at a start. */
    /* A resumed session's turns before its last compaction are not listed
       by the host: the next read finds that compaction. */
    if (e.source === 'resume') await update($, compactedAt, () => '')
    if (reopensOn(e.source)) {
      await update($, isClosed, () => false)
      void autoOpen($)
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chat-toc', description: '打开对话目录', immediate: true })
    await loadChoices($)
    await askPerf($)
    await locate($, e.cwd)
    readNow($)
    void autoOpen($)
    return next(e)
  })

  /* A submit's classic event says where the transcript is: what a plugin
     enabled in mid-session waits for when no path could be worked out, or
     the correction when the worked-out one was wrong. */
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (await adoptPath($, e.transcript_path)) readNow($)
    return next(e)
  })

  on('command.run', { command: 'chat-toc' }, async $ => {
    await openAsked($)
    return {}
  })

  /* Every pane's close passes here, other plugins' too; only the person's
     close of this one is kept, once no hook beneath refused it. */
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (isClosedByPerson(e)) {
      await update($, isClosed, () => true).catch(() => undefined)
      showStatus($, undefined)
    }
    return closed
  })

  /* Rows the main loop keeps; a subagent's go to a file of its own. */
  on('session.append', ($, e, next) => {
    if (e.agentId === undefined) {
      if (perf.isOn) appendedAt ??= perfNow()
      requestRead($)
    }
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

  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    top = scrolledTop(lastDrawing.window, e.by)
    isPaused = true
    await update($, rev, n => n + 1)
    return {}
  })

  /* The hint line is drawn from the start and again after every change of
     width: where chat-toc learns the layout, which the start events lack. */
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, ($, e, next) => {
    sawViewport($, e.viewport)
    checkRewindSoon($)
    return next(e)
  })

  /* The arrows walk the host's focus ring Button by Button; this keeps it
     on entries' first lines and scrolls the window at its ends (ring.ts). */
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const drawn = lastDrawing
    const move = e.origin.kind === 'person' ? ringMove(drawn.keys, drawn.indexOf, drawn.window, ring, e.element) : { kind: 'accept' as const }
    if (move.kind === 'reveal') {
      const key = drawn.keys[move.index]
      if (key === undefined) return next(e)
      top = topRevealing(drawn.heights, drawn.rows, drawn.window, move.index)
      pendingRing = key
      selectionMoved($, key)
      await update($, rev, n => n + 1)
      return { deny: 'chat-toc moves its window to the next entry first' }
    }
    const element = move.kind === 'land' ? move.key : e.element
    const result = await next(move.kind === 'land' ? { ...e, element: move.key } : e)
    if (result.deny === undefined) {
      ring = element
      pendingRing = undefined
      selectionMoved($, element)
    }
    return result
  })

  /* The transcript's rows, read and never redrawn: which requestId each is
     drawn under, and where it is on screen. The terminal's say its layout
     too, should they come before the hint line. */
  for (const component of SITE_COMPONENTS) {
    /* The matcher wants one component's type; every site's props carry
       `onScreen` alike, so the first stands for all four. */
    on('ui.render', { component: component as 'UserMessage' }, ($, e, next) => {
      if (e.surface === 'terminal') sawViewport($, e.viewport)
      sawSite($, component, e.requestId, e.props.onScreen)
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const began = perfNow()
    /* What the drawing needs of the host first; the rest is its own work. */
    await read($, rev)
    const position = (await read($, currentPosition)) ?? undefined
    const isAsked = await read($, isInlineAsked)
    const isCarried = await read($, isCarriedOver)
    const nowMs = await $.clock.now()
    const awaited = perfNow()
    const wasFocused = isPaneFocused
    isPaneFocused = e.props.isFocused
    if (!isPaneFocused) {
      ring = undefined
      pendingRing = undefined
    }
    /* The keyboard pauses following; once it is given back, a position
       that moved meanwhile, or moves next, is followed again. */
    if (isPaneFocused && !wasFocused) isPaused = true
    if (!isPaneFocused && position !== positionFollowed) {
      positionFollowed = position
      isPaused = false
    }
    const isHeld = isPaused || isPaneFocused
    positionDrawn = position
    /* A drawing writes nothing, so what its placement asks is done after. */
    const fate = placementFate(e.props.placement, isAsked)
    if (fate === 'docked' && (statusShown !== undefined || isAsked || withdrawals > 0)) $.clock.after(0, () => void settleDocked($).catch(() => undefined))
    if (fate === 'withdraw' && !isWithdrawing) $.clock.after(0, () => void withdraw($).catch(() => undefined))
    if (fate === 'asked-inline') {
      const text = e.viewport?.isFullscreen === false ? DOCK_STATUS.askedMainScreen : DOCK_STATUS.askedNarrow
      if (text !== statusShown) $.clock.after(0, () => showStatus($, text))
    }
    const isOk = source === 'ok'
    const width = e.props.bodyColumns
    const wasTable = entryCache.table
    const groups = shownGroups()
    const table = isOk ? entryTable(entryCache, groups, { layout, filter, width, nowMs, isRunning: isTurnRunning && groups === reading.groups }) : NO_ENTRIES
    const entries = dimRefused(table.entries, groups, refused)
    /* A resumed or forked session shows its history in the transcript
       before its own file is written; it is not without a conversation. */
    const missing = isCarried ? NOT_WRITTEN_TEXT : EMPTY_TEXT
    const notice = isUnlocated ? UNLOCATED_TEXT : source === 'missing' ? missing : isOk && entries.length === 0 ? EMPTY_TEXT : undefined
    const why = source === 'failed' ? FAILURES[failure] : isOk && reading.unreadable > 0 ? unreadableText(reading.unreadable) : undefined
    const alert = refusal === undefined ? undefined : { text: refusal.text, isInverse: refusalFrame(nowMs - refusal.at).isInverse }
    const headRows = HEAD_ROWS
    const rows = e.props.scroll.bodyRows - headRows - FOOT_ROWS - (notice === undefined ? 0 : 1) - (alert === undefined ? 0 : 1) - (why === undefined ? 0 : 1)
    const drawnEntries = { heights: table.heights, rows, keys: table.keys, indexOf: table.indexOf }
    const kept = anchor
    anchor = undefined
    const anchorIndex = kept === undefined ? undefined : entryOfGroup(table, kept.group)
    const placed = topOfDrawing(drawnEntries, {
      top,
      follow: isHeld ? undefined : { index: position === undefined ? undefined : entryOfGroup(table, position), isLast: position === groups.length - 1 },
      anchor: kept === undefined || anchorIndex === undefined ? undefined : { ...kept, index: anchorIndex },
    })
    top = placed.top
    if (placed.refocusKey !== undefined) pendingRing = placed.refocusKey
    const window = windowOf(table.heights, rows, top)
    lastDrawing = { ...drawnEntries, entries, window }
    /* The ring move owed to an entry goes once this drawing shows it, and
       once more from the drawing after, which the confirm timer asks for. */
    const ringTo = pendingShown(pendingRing, table.indexOf, window)
    const owed = ringOwed
    ringOwed = undefined
    if (ringTo !== undefined) {
      pendingRing = undefined
      ring = ringTo
      ringOwed = ringTo
      $.clock.after(0, () => sendRing($, ringTo))
      $.clock.after(RING_CONFIRM_MS, () => {
        if (ringOwed === ringTo && ring === ringTo && isPaneFocused) redrawSoon($)
      })
    } else if (owed !== undefined && owed === ring && table.indexOf.has(owed)) {
      $.clock.after(0, () => sendRing($, owed))
    }
    const isRunningNow = isTurnRunning && groups === reading.groups
    const shared = {
      entries,
      window,
      layout,
      filter,
      litGroup: position,
      bodyColumns: width,
      notice,
      alert,
      why,
      count: isOk && groups.length > 0 ? groups.length : undefined,
      isPaused: isHeld,
      onPress: (entry: Entry) => jump($, entry),
      onFilter: (chosen: ViewFilter) => chooseFilter($, chosen),
    }
    const drawn =
      e.surface === 'terminal'
        ? drawPane($.ui.resolve(e), { ...shared, bodyRows: e.props.scroll.bodyRows, onLayout: () => chooseLayout($) })
        : drawDesktopPane($.ui.resolve(e), {
            ...shared,
            textOf: entry => {
              const group = groups[entry.groupIndex]
              return group === undefined ? '' : sideText(group, entry.side, entry.isRunning)
            },
            steps: isOk ? groups.map(g => g.steps) : [],
            runningGroup: isRunningNow ? groups.length - 1 : undefined,
            onLayout: to => chooseLayout($, to),
          })
    if (perf.isOn) {
      const ended = perfNow()
      timed($, 'pane', [ended - awaited, ended - began, entries.length, table === wasTable ? 0 : 1])
      if (!isListedNoted && entries.length > 0) {
        isListedNoted = true
        timed($, 'listed', [ended - loadedAt])
      }
    }
    return drawn
  })
}
