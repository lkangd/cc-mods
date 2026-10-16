/* chat-toc: a docked table of contents of the current session's
   conversation. This module wires the host's events to the parts:
     transcript.ts / chain.ts / groups.ts / regroup.ts  the file to Turn groups
     compactions.ts                                     where each compaction's rule goes
     source.ts / reader.ts / locate.ts                  how, when and where it is read
     rewind.ts                                          what a rewind took, before the file says
     view.ts / entries.ts / cells.ts / window.ts        what the pane draws
     facts.ts / preview.ts                              the preview of one Turn group
     reuse.ts                                           Reuse and copy from the preview
     search.ts                                          which groups a query matches
     pane.tsx / ring.ts                                 how it draws, the keyboard
     sites.ts / jump.ts                                 where a press scrolls
     step.ts                                            the previous and next Turn group
     position.ts                                        what the view is on
   The host's `$` may only be handed to functions declared at the top of
   this file, so every call on `$` is made here or in one of them. */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'
import type { Entry } from './entries'
import { compactionsOf, hasEarlierTurnsElsewhere, layRules } from './compactions'
import type { Compaction, Listed } from './compactions'
import { drawDesktopPane } from './desktop'
import { BAR_ROWS, barKey, barLabels, barOfGroup, barTarget, barsOf } from './bars'
import { stripLabels } from './minimap'
import type { TurnGroup } from './groups'
import {
  FLASHES,
  FLASH_MS,
  REFUSED_MS,
  isUnscrollable,
  compactedSides,
  dimRefused,
  jumpTargetsOf,
  lastBoundary,
  refusalFrame,
  relisted,
  sideKeyOf,
} from './jump'
import type { Refused } from './jump'
import { carriesHistory, hidesPane, isClosedByPerson, reopensOn } from './lifecycle'
import { CLEAR_CONTROL, PANE_COLUMNS, PANE_ID, SEARCH_FIELD, SEARCH_ROWS, drawPane, FOOT_ROWS, HEAD_ROWS } from './pane'
import type { ExpandedView, LabelActions, PreviewView, SearchView } from './pane'
import { PREVIEW_CONTROL, PREVIEW_KEY, expandedBody, filesLine, isPreviewShown, metaLine, previewBody, previewPlan, typedInput } from './preview'
import type { ExpandedBody, PathBase, PreviewBody } from './preview'
import { FILTER_END, LAYOUT_CONTROL, entryAt, pendingShown, ringMove } from './ring'
import { COPIED_MS, fillOf, fillRefusedText, hasReuse, reusableOf } from './reuse'
import type { CopyWhich } from './reuse'
import { indexGroups, matchesOf, nearestMatch, newSearchIndex, queryWords } from './search'
import type { Match } from './search'
import { derivedTranscriptPath } from './locate'
import { listedGroups, stepFrom } from './step'
import type { StepDirection } from './step'
import { languageOf, setLanguage, text as words } from './text'
import type { BandCounts } from './text'
import { drawBand } from './band'
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
import { entryOfGroup, entryTable, narrowedTable, newEntryCache } from './table'
import type { EntryTable } from './table'
import { scrolledTop, topOfDrawing, topRevealing, windowOf } from './window'
import type { SwitchAnchor, TocWindow } from './window'

const transcriptPath = atom({ plugin: 'chat-toc', key: 'transcriptPath' } as const, '')
const rev = atom({ plugin: 'chat-toc', key: 'rev' } as const, 0)
const isClosed = atom({ plugin: 'chat-toc', key: 'isClosed' } as const, false)
const isCarriedOver = atom({ plugin: 'chat-toc', key: 'isCarriedOver' } as const, false)
const isPaneHidden = atom({ plugin: 'chat-toc', key: 'isPaneHidden' } as const, false)
const currentPosition = atom({ plugin: 'chat-toc', key: 'currentPosition' } as const, null as number | null)
const compactedAt = atom({ plugin: 'chat-toc', key: 'compactedAt' } as const, null as string | null)
/* The search field's text: conversation text, so `$.state` only, never
   `$.store`; it lasts the process, across closing the pane. */
const query = atom({ plugin: 'chat-toc', key: 'query' } as const, '')

type SourceState = 'unknown' | 'missing' | 'ok' | 'failed'

/* Why nothing is listed, kept at the bottom of the pane while it holds. */
const failureText = (reason: FailReason): string => (reason === 'denied' ? words.denied : words.readError)

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

/* The person's choices, read from `$.store` at each `session.start`. */
let filter: ViewFilter = 'all'
let layout: Layout = 'card'
let isPreviewOn = true
/* What the preview shows paths against: the session's working directory
   and the home directory, from `session.start`. */
let pathBase: PathBase = { cwd: undefined, home: undefined }
/* The group the expanded preview holds, by its opener's uuid, which a
   regroup keeps: neither the Current position nor new turns change it.
   Undefined draws the list. Closing the pane or the keys leaving it
   returns to the list. */
let expandedOpener: string | undefined
/* The group the ring was last on while it is on one of the preview's own
   Buttons, which then keeps showing it: they act on what it shows. */
let heldSelection: number | undefined
/* On the desktop, which reports no Current position: the group the
   preview shows, by its opener's uuid, the entry pressed last or the match
   a search's submit put there. Undefined shows the newest. */
let pressedOpener: string | undefined
/* The host's release, from `$.session.version()` at `session.start`. */
let hostBase: string | undefined
/* The copy Button reading `Copied`: the group's opener, which Button, and
   which copy, so only its own timer takes it back. */
let copied: { opener: string; which: CopyWhich; n: number } | undefined
let copies = 0

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
/* The first control the last drawing put after the entries, and the last
   one before them. */
let afterList = LAYOUT_CONTROL
let beforeList = FILTER_END
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
/* Whether the band's last drawing was chat-toc's: the host does not draw
   the band again when the pane comes to the front by a switch of tabs, so
   the pane's drawing asks for it. */
let isBandDrawn = false

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

/* The chain's compactions as last read, whether earlier turns are not in
   the file, and the last boundary a read found. */
let compactions: Compaction[] = []
let isEarlierElsewhere = false
let lastCompaction: string | undefined
/* The context use, a whole percent of the window, as the host last gave
   it; undefined from a compaction until a measure brings one. */
let contextPercent: number | undefined

/* The entries kept between drawings (table.ts), and the list with the
   compactions' rules laid on, kept while neither changes. */
let entryCache = newEntryCache()
let ruled: { table: EntryTable; compactions: readonly Compaction[]; listed: Listed } | undefined

/* Each group's searchable text (search.ts), built as reads regroup; the
   matches of the query last drawn; the list narrowed to them; the query
   the last drawing showed. */
const searchIndex = newSearchIndex()
type Searched = { groups: readonly TurnGroup[]; words: string; filter: ViewFilter; isRunning: boolean; matches: Match[]; groupsMatched: number[] }
let searched: Searched | undefined
let narrowed: { table: EntryTable; matches: readonly number[]; narrowed: EntryTable } | undefined
let queryDrawn = ''

function matchesNow(groups: readonly TurnGroup[], words: readonly string[], isRunning: boolean): Searched {
  const key = words.join(' ')
  const was = searched
  if (was !== undefined && was.groups === groups && was.words === key && was.filter === filter && was.isRunning === isRunning) return was
  const matches = matchesOf(searchIndex, groups, words, filter, isRunning)
  searched = { groups, words: key, filter, isRunning, matches, groupsMatched: matches.map(m => m.group) }
  return searched
}

function narrowedTo(table: EntryTable, matches: readonly number[]): EntryTable {
  if (narrowed?.table === table && narrowed.matches === matches) return narrowed.narrowed
  narrowed = { table, matches, narrowed: narrowedTable(table, matches) }
  return narrowed.narrowed
}

function listedWithRules(table: EntryTable): Listed {
  if (ruled?.table === table && ruled.compactions === compactions) return ruled.listed
  ruled = { table, compactions, listed: layRules(table, compactions) }
  return ruled.listed
}

/* What a read found of the chain's compactions. A new boundary no response
   has followed yet hides the context use, as `session.compact` does: the
   host's figure is from before it. */
function noteCompactions(): void {
  compactions = compactionsOf(reading.chain, reading.groups)
  isEarlierElsewhere = hasEarlierTurnsElsewhere(reading.chain, reading.groups)
  const last = compactions[compactions.length - 1]
  if (last !== undefined && last.uuid !== lastCompaction && !last.isAnswered) contextPercent = undefined
  lastCompaction = last?.uuid
}
const NO_ENTRIES: EntryTable = { entries: [], heights: [], keys: [], indexOf: new Map(), firstOfGroup: [] }

/* The long-session timings (perf.ts): on when the host runs with
   CHAT_TOC_PERF set, asked once per module load; the first main-loop row
   appended since the last read; whether the first listing was timed. */
const perf = newPerf()
const loadedAt = perfNow()
let isPerfAsked = false
let isLanguageAsked = false
let appendedAt: number | undefined
let isListedNoted = false
/* The earliest change of the search field no drawing has taken yet. */
let typedAt: number | undefined

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
  compactions = []
  isEarlierElsewhere = false
  ruled = undefined
}

/* The context use the host has now: at the start, and after a hot reload,
   which starts the module over. */
async function readContextUse($: EngineInterface): Promise<void> {
  const usage = await $.session.usage().catch(() => undefined)
  contextPercent = usage?.context.percent
}

/* The host's release, which says whether the desktop offers Reuse
   (reuse.ts); undefined while not known. */
async function askVersion($: EngineInterface): Promise<void> {
  const version = await $.session.version().catch(() => undefined)
  hostBase = version?.base
}

/* The system's language, from the locale variables (text.ts). Asked once a
   load, at the first start event, before any word is drawn or registered. */
async function askLanguage($: EngineInterface): Promise<void> {
  if (isLanguageAsked) return
  isLanguageAsked = true
  const read = (value: Promise<string | undefined>) => value.catch(() => undefined)
  const [LC_ALL, LC_MESSAGES, LANG] = await Promise.all([read($.env.get('LC_ALL')), read($.env.get('LC_MESSAGES')), read($.env.get('LANG'))])
  setLanguage(languageOf({ LC_ALL, LC_MESSAGES, LANG }))
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
    const indexing = perfNow()
    const built = indexGroups(searchIndex, reading.groups)
    if (perf.isOn) timed($, 'index', [perfNow() - indexing, built, reading.groups.length])
    resolveSites(sites, chainRows, syncRows(chainRows, reading.chain))
    noteCompactions()
    cursor = at
    lastSize = got.size
    source = 'ok'
    /* The file grew: it says again what the conversation holds. */
    rewound = undefined
    await markCompacted($)
  } else {
    startOver()
    compactions = []
    isEarlierElsewhere = false
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
  return $.ui.open({ id: PANE_ID, title: words.paneTitle, columns: PANE_COLUMNS, ...(focus === undefined ? {} : { focus }) })
}

/* Opens the pane unasked, unless the person closed it in this session or it
   is open already, as it stays across a hot reload. Where and whether it is
   drawn is the host's call: it is kept however the host places it. While it
   waits undrawn the band above the prompt offers it, as after a close. */
async function openUnasked($: EngineInterface): Promise<void> {
  if (await read($, isClosed)) return
  const pane = (await $.ui.panes()).find(p => p.id === PANE_ID)
  const isPlaced = pane === undefined ? (await openPane($)).isPlaced : pane.isPlaced
  await update($, isPaneHidden, () => !isPlaced)
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
  const opened = await openPane($, true)
  if (opened.isPlaced) await update($, isPaneHidden, () => false)
}

/* The band's counts, once the file is read: the listed turns and the
   agent's steps across them. */
function bandCounts(): BandCounts | undefined {
  if (source !== 'ok') return undefined
  const groups = shownGroups()
  return { turns: groups.length, steps: groups.reduce((sum, g) => sum + g.steps, 0), percent: contextPercent }
}

/* Only ever called from a press: the host moves the transcript only for
   the person's own input. Tries the side's targets in order; when the host
   refuses them all, says so at the bottom for a while (or, pressed while
   the pane is not on screen, as a toast) and dims the side. */
async function jump($: EngineInterface, entry: Pick<Entry, 'groupIndex' | 'side' | 'key'>, isPaneOnScreen = true): Promise<void> {
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
    if (isUnscrollable(got.deny)) return say($, entry.key, words.unscrollable, isPaneOnScreen)
  }
  refused.set(key, { side: entry.side, opener: group.openerUuid, groupIndex: entry.groupIndex, why })
  await say($, entry.key, why === 'compacted' ? words.compacted : words.refused, isPaneOnScreen)
}

/* A refusal said at the bottom of the pane, or as a toast while the pane
   is not on screen to say it. */
async function say($: EngineInterface, key: string, text: string, isPaneOnScreen: boolean): Promise<void> {
  if (isPaneOnScreen) return sayRefusal($, key, text)
  $.ui.toast(text)
  await update($, rev, n => n + 1)
}

/* ‹ or ›, pressed by a click or by a key the person bound to its action:
   the transcript steps from the Current position (not the selection) to
   the Turn group before or after it among those the list shows, the View
   filter's and, during a search, the matches' (step.ts), on the side the
   View filter shows, without ending the search. The jump locks the Current
   position on its group, so presses walk group by group. Nothing at either
   end; groups that way but none with a Jump target say the click's notice.
   The press hands this promise back: the scroll is the person's. */
async function stepTurn($: EngineInterface, direction: StepDirection, isPaneOnScreen: boolean): Promise<void> {
  if (source !== 'ok') return
  const groups = shownGroups()
  const isRunning = isTurnRunning && groups === reading.groups
  const searchWords = queryWords(await read($, query))
  const matches = searchWords.length === 0 ? undefined : matchesNow(groups, searchWords, isRunning).groupsMatched
  const shown = listedGroups(groups, filter, isRunning ? groups.length - 1 : undefined, matches)
  const side = filter === 'agent' ? 'agent' : 'user'
  const hasTarget = (g: number) => {
    const group = groups[g]
    return group !== undefined && !refused.has(sideKeyOf(group, side)) && jumpTargetsOf(group, side, chainRows, sites).length > 0
  }
  const to = stepFrom(shown, placing.position, direction, hasTarget)
  if (to.kind === 'jump') return jump($, { groupIndex: to.group, side, key: `g${to.group}.${side === 'agent' ? 'a' : 'u'}` }, isPaneOnScreen)
  if (to.kind === 'unjumpable') return say($, `step.${direction}`, words.refused, isPaneOnScreen)
}

/* Says below the entries why a press did not jump, flashing, for a while. */
async function sayRefusal($: EngineInterface, key: string, text: string): Promise<void> {
  const n = ++refusals
  refusal = { key, n, text, at: await $.clock.now() }
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

/* The group an entry Button's key belongs to: `g3.u.1` is group 3's. */
function groupOfKey(key: string | undefined): number | undefined {
  const m = key === undefined ? null : /^g(\d+)\./.exec(key)
  return m === null ? undefined : Number(m[1])
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
  isPreviewOn = isPreviewShown(await $.store.get(PREVIEW_KEY).catch(() => undefined))
}

/* `p`: the preview shown or folded to its rule line, kept like the
   Layout. */
async function togglePreview($: EngineInterface): Promise<void> {
  isPreviewOn = !isPreviewOn
  await update($, rev, n => n + 1)
  await $.store.set(PREVIEW_KEY, isPreviewOn ? 'shown' : 'hidden').catch(() => undefined)
}

/* `f`: the keys into the search field. The host does not raise this
   plugin's own move to its `ui.focus` hook, so the ring is noted here. */
async function focusSearch($: EngineInterface): Promise<void> {
  const moved = await $.ui.focus({ requestId: PANE_ID, key: SEARCH_FIELD }).catch((error: unknown) => ({ deny: String(error) }))
  if (moved.deny === undefined) ring = SEARCH_FIELD
}

function setQuery($: EngineInterface, value: string): Promise<void> {
  return update($, query, () => value).then(
    () => undefined,
    () => undefined,
  )
}

/* Enter in the field: the search ends (the host empties the field) and,
   when a group matches, the transcript jumps to the match nearest the
   Current position, on the side the View filter shows. The host moves the
   transcript only within the person's own submit: the Input's handler
   hands this promise back, and the scroll goes before anything else is
   written. */
async function submitSearch($: EngineInterface, value: string): Promise<void> {
  const groups = shownGroups()
  const words = queryWords(value)
  const found = words.length === 0 ? [] : matchesOf(searchIndex, groups, words, filter, isTurnRunning && groups === reading.groups).map(m => m.group)
  const target = nearestMatch(found, (await read($, currentPosition)) ?? undefined)
  if (target !== undefined) {
    const side = filter === 'agent' ? 'agent' : 'user'
    await jump($, { groupIndex: target, side, key: `g${target}.${side === 'agent' ? 'a' : 'u'}` })
  }
  await setQuery($, '')
}

/* A press on an entry on the desktop: the preview shows its group, and
   the press asks to jump as on the terminal (the app refuses it, and the
   pane says so). */
async function pressEntry($: EngineInterface, entry: Entry): Promise<void> {
  pressedOpener = shownGroups()[entry.groupIndex]?.openerUuid
  await update($, rev, n => n + 1)
  await jump($, entry)
}

/* The desktop's submit (Enter, or the field's `show` button): the text
   stays and the match nearest the Current position goes in the preview,
   the newest match, the desktop having no Current position. */
async function showMatch($: EngineInterface, value: string): Promise<void> {
  const groups = shownGroups()
  const words = queryWords(value)
  const found = words.length === 0 ? [] : matchesOf(searchIndex, groups, words, filter, isTurnRunning && groups === reading.groups).map(m => m.group)
  const target = nearestMatch(found, undefined)
  if (target === undefined) return
  pressedOpener = groups[target]?.openerUuid
  await update($, rev, n => n + 1)
}

/* The working directory and home the preview's paths are shown against. */
async function learnPaths($: EngineInterface, cwd: string): Promise<void> {
  const home = await $.env.get('HOME').catch(() => undefined)
  pathBase = { cwd: cwd || undefined, home: home || undefined }
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

/* The preview drawn last, kept while its group and the room are the same:
   a long reply is folded once, not at every redraw. */
let previewMemo:
  | { group: TurnGroup; isRunning: boolean; width: number; rows: number; year: number; base: PathBase; match: Match | undefined; body: PreviewBody }
  | undefined

/* The group the preview shows: the selected entry's while the pane holds
   the keys (on the desktop, the entry pressed last), else the Current
   position's, else the newest. While a query is
   set (`matches`, its groups), the selected match, else the match nearest
   the Current position, else the newest; none with no match. */
function previewGroup(
  groups: readonly TurnGroup[],
  position: number | undefined,
  matches: readonly number[] | undefined,
  pressed: number | undefined,
): number | undefined {
  const onEntry = isPaneFocused ? groupOfKey(ring) : undefined
  if (onEntry !== undefined) heldSelection = onEntry
  const selected = pressed ?? onEntry ?? (isPaneFocused && isPreviewControl(ring) ? heldSelection : undefined)
  if (selected !== undefined && selected < groups.length && (matches === undefined || matches.includes(selected))) return selected
  if (matches !== undefined) return nearestMatch(matches, position)
  if (position !== undefined && position < groups.length) return position
  return groups.length - 1
}

/* The preview's own Buttons: its rule's, the cut line's, the label rows'. */
const isPreviewControl = (key: string | undefined) => key === PREVIEW_CONTROL || (key?.startsWith(`${PREVIEW_CONTROL}.`) ?? false)

/* The group a label-row Button acts on, found at the press among the
   groups listed now by its opener: nothing of it is kept from the drawing. */
function groupAtPress(opener: string): { group: TurnGroup; isRunning: boolean } | undefined {
  const groups = shownGroups()
  let at = groups.length - 1
  while (at >= 0 && groups[at]?.openerUuid !== opener) at--
  const group = groups[at]
  return group === undefined ? undefined : { group, isRunning: isTurnRunning && groups === reading.groups && at === groups.length - 1 }
}

/* `r`: the User input into the composer as a draft, over an empty one,
   else after the draft; never submitted. A fill that lands says nothing
   more (the keyboard moves to the composer); one refused says why. */
async function reuseInput($: EngineInterface, opener: string): Promise<void> {
  const found = groupAtPress(opener)
  const offered = found === undefined ? undefined : reusableOf(found.group, found.isRunning)
  if (offered?.fill === undefined) return
  const box = await $.prompt.read()
  const filled = await $.prompt.fill(fillOf(box.text, offered.fill))
  if (!filled.isFilled) {
    $.ui.toast(fillRefusedText(filled.refusal))
    return
  }
  if (offered.hasImagesLeft) $.ui.toast(words.imagesLeft)
}

/* `c` or `a`: the User input or the last text, whole, on the clipboard.
   The Button reads `Copied` for a while; a copy refused says why. */
async function copyOut($: EngineInterface, opener: string, which: CopyWhich, surface: RenderSurface): Promise<void> {
  const found = groupAtPress(opener)
  const offered = found === undefined ? undefined : reusableOf(found.group, found.isRunning)
  const text = which === 'input' ? offered?.input : offered?.text
  if (offered === undefined || text === undefined) return
  const result = await $.ui.copy({ text, surface })
  if (!result.isCopied) {
    $.ui.toast(words.copyFailed(result.reason))
    return
  }
  const n = ++copies
  copied = { opener, which, n }
  $.clock.after(COPIED_MS, () => {
    if (copied?.n !== n) return
    copied = undefined
    void update($, rev, x => x + 1).catch(() => undefined)
  })
  await update($, rev, x => x + 1)
  if (which === 'input' && offered.hasImagesLeft) $.ui.toast(words.imagesLeft)
}

/* The label rows' Buttons for a group, as it offers them. */
function labelActions($: EngineInterface, group: TurnGroup, isRunning: boolean, surface: RenderSurface): LabelActions {
  const offered = reusableOf(group, isRunning)
  const opener = group.openerUuid
  return {
    canReuse: offered.fill !== undefined && hasReuse(surface, hostBase),
    canCopyInput: offered.input !== undefined,
    canCopyText: offered.text !== undefined,
    copied: copied?.opener === opener ? copied.which : undefined,
    onReuse: () => reuseInput($, opener),
    onCopy: which => copyOut($, opener, which, surface),
  }
}

/* A match's fields as the meta line ends with them. */
const matchedWords = (match: Match) =>
  words.matched([...(match.user ? ['user' as const] : []), ...(match.agent ? ['agent' as const] : []), ...(match.files ? ['files' as const] : [])])

/* Whether two matches of a group end its meta line and order its files
   alike: each keystroke matches anew, and the preview is laid out again
   only when what it shows of the match changed. */
const isSameMatch = (a: Match | undefined, b: Match | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.user === b.user &&
    a.agent === b.agent &&
    a.paths.length === b.paths.length &&
    a.paths.every((path, i) => path === b.paths[i]))

function previewOf(
  groups: readonly TurnGroup[],
  plan: { preview: number; state: 'shown' | 'hidden' | 'noRoom' | 'none' },
  position: number | undefined,
  search: Searched | undefined,
  isRunningNow: boolean,
  width: number,
  nowMs: number,
  onToggle: () => Promise<void>,
  onMore: (opener: string) => Promise<void>,
  actionsOf: (group: TurnGroup, isRunning: boolean) => LabelActions,
  pressed: number | undefined,
): PreviewView {
  const state = plan.state === 'none' ? 'hidden' : plan.state
  const at = previewGroup(groups, position, search?.groupsMatched, pressed)
  const group = at === undefined ? undefined : groups[at]
  const match = at === undefined ? undefined : search?.matches.find(m => m.group === at)
  const isRunning = isRunningNow && at === groups.length - 1
  const year = new Date(nowMs).getFullYear()
  const memo = previewMemo
  const isSame =
    memo !== undefined &&
    memo.group === group &&
    memo.isRunning === isRunning &&
    memo.width === width &&
    memo.rows === plan.preview &&
    memo.year === year &&
    memo.base === pathBase &&
    isSameMatch(memo.match, match)
  const body =
    state !== 'shown' || group === undefined
      ? undefined
      : isSame
        ? memo.body
        : previewBody({
            meta: metaLine(group, isRunning, nowMs, width, match === undefined ? undefined : matchedWords(match)),
            input: typedInput(group.facts),
            agent: isRunning ? group.facts.latestText : group.facts.lastText,
            files: filesLine(group.facts, pathBase, width, match?.paths),
            rows: plan.preview,
            width,
          })
  if (body !== undefined && group !== undefined) previewMemo = { group, isRunning, width, rows: plan.preview, year, base: pathBase, match, body }
  return {
    state,
    rows: plan.preview,
    body,
    actions: body === undefined || group === undefined ? undefined : actionsOf(group, isRunning),
    onToggle,
    onMore: () => (group === undefined ? Promise.resolve() : onMore(group.openerUuid)),
  }
}

/* `e`, or a press on the cut line: the preview expands over the list,
   holding the group it showed; `e` again, or ← Back, returns. */
async function expandPreview($: EngineInterface, opener: string | undefined): Promise<void> {
  expandedOpener = opener
  await update($, rev, n => n + 1)
}

/* The expanded preview drawn last, kept while its group and width are. */
let expandedMemo: { group: TurnGroup; isRunning: boolean; width: number; year: number; base: PathBase; hasHotkeys: boolean; body: ExpandedBody } | undefined

/* The expanded preview of the group it holds; undefined when that group
   is no longer listed (a rewind took it, another file was read). */
function expandedOf(
  groups: readonly TurnGroup[],
  isRunningNow: boolean,
  width: number,
  nowMs: number,
  onBack: () => Promise<void>,
  actionsOf: (group: TurnGroup, isRunning: boolean) => LabelActions,
  hasHotkeys: boolean,
): ExpandedView | undefined {
  let at = groups.length - 1
  while (at >= 0 && groups[at]?.openerUuid !== expandedOpener) at--
  const group = groups[at]
  if (group === undefined) return undefined
  const isRunning = isRunningNow && at === groups.length - 1
  const year = new Date(nowMs).getFullYear()
  const memo = expandedMemo
  const body =
    memo !== undefined &&
    memo.group === group &&
    memo.isRunning === isRunning &&
    memo.width === width &&
    memo.year === year &&
    memo.base === pathBase &&
    memo.hasHotkeys === hasHotkeys
      ? memo.body
      : expandedBody({
          meta: metaLine(group, isRunning, nowMs, width),
          input: typedInput(group.facts),
          agent: isRunning ? group.facts.latestText : group.facts.lastText,
          files: group.facts,
          base: pathBase,
          width,
          hasHotkeys,
        })
  expandedMemo = { group, isRunning, width, year, base: pathBase, hasHotkeys, body }
  return { body, actions: actionsOf(group, isRunning), onBack }
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    await askLanguage($)
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
    await askLanguage($)
    await $.command.register({ name: 'chat-toc', description: words.commandDescription, immediate: true })
    await loadChoices($)
    await learnPaths($, e.cwd)
    await readContextUse($)
    await askVersion($)
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
    }
    if (hidesPane(e)) {
      expandedOpener = undefined
      await update($, isPaneHidden, () => true).catch(() => undefined)
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

  /* The context use as each measure gives it, whatever moved. */
  on('session.measure', async ($, e, next) => {
    contextPercent = e.context.percent
    await update($, rev, n => n + 1).catch(() => undefined)
    return next(e)
  })

  /* A compaction of the main conversation hides the context use at once:
     no measure follows it, and the host's figure is gone until the next
     response. One skipped leaves the figure as it was. */
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    const was = contextPercent
    contextPercent = undefined
    await update($, rev, n => n + 1).catch(() => undefined)
    const result = await next(e)
    if (result.skip !== undefined && contextPercent === undefined) {
      contextPercent = was
      await update($, rev, n => n + 1).catch(() => undefined)
    }
    return result
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
    /* Expanded, the host scrolls the whole tree. */
    if (e.origin.kind !== 'person' || expandedOpener !== undefined) return next(e)
    top = scrolledTop(lastDrawing.window, e.by)
    isPaused = true
    await update($, rev, n => n + 1)
    return {}
  })

  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, ($, e, next) => {
    checkRewindSoon($)
    return next(e)
  })

  /* While the pane is not on screen, closed, waiting undrawn or a tab
     behind another pane, one line above the prompt counts the
     conversation and carries ‹ ›; a press on its open is the person's
     open, which the host seats at any width. A survey holds the band
     first. */
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, rev)
    await read($, isPaneHidden)
    const pane = (await $.ui.panes()).find(p => p.id === PANE_ID)
    isBandDrawn = !e.props.hasSurvey && (pane === undefined || !pane.isPlaced || !pane.isShown)
    if (!isBandDrawn) return next(e)
    return drawBand($.ui.resolve(e), { counts: bandCounts(), onOpen: () => openAsked($), onStep: direction => stepTurn($, direction, false) })
  })

  /* The arrows walk the host's focus ring Button by Button; this keeps it
     on entries' first lines and scrolls the window at its ends (ring.ts). */
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    /* Expanded, no entry is drawn: the ring goes where the host moves it. */
    if (expandedOpener !== undefined) {
      const result = await next(e)
      if (result.deny === undefined) ring = e.element
      return result
    }
    const drawn = lastDrawing
    const move = e.origin.kind === 'person' ? ringMove(drawn.keys, drawn.indexOf, drawn.window, ring, e.element, afterList, beforeList) : { kind: 'accept' as const }
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
      const was = ring
      ring = element
      pendingRing = undefined
      selectionMoved($, element)
      /* The preview follows the selection. */
      if (groupOfKey(element) !== groupOfKey(was)) redrawSoon($)
    }
    return result
  })

  /* The transcript's rows, read and never redrawn: which requestId each is
     drawn under, and where it is on screen. */
  for (const component of SITE_COMPONENTS) {
    /* The matcher wants one component's type; every site's props carry
       `onScreen` alike, so the first stands for all of them. */
    on('ui.render', { component: component as 'UserMessage' }, ($, e, next) => {
      sawSite($, component, e.requestId, e.props.onScreen)
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const began = perfNow()
    /* What the drawing needs of the host first; the rest is its own work. */
    await read($, rev)
    const position = (await read($, currentPosition)) ?? undefined
    const isCarried = await read($, isCarriedOver)
    const searchText = await read($, query)
    /* Drawn: whatever waited is seated. A drawing writes nothing, so after. */
    if (await read($, isPaneHidden)) $.clock.after(0, () => void update($, isPaneHidden, () => false).catch(() => undefined))
    /* On screen: the band goes, also when a switch of tabs brought the pane
       to the front, which draws no band. */
    else if (isBandDrawn) redrawSoon($)
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
    if (wasFocused && !isPaneFocused) expandedOpener = undefined
    if (!isPaneFocused && position !== positionFollowed) {
      positionFollowed = position
      isPaused = false
    }
    const isHeld = isPaused || isPaneFocused
    positionDrawn = position
    const isOk = source === 'ok'
    const width = e.props.bodyColumns
    const wasTable = entryCache.table
    const groups = shownGroups()
    const isRunningNow = isTurnRunning && groups === reading.groups
    const whole = isOk ? entryTable(entryCache, groups, { layout, filter, width, nowMs, isRunning: isRunningNow }) : NO_ENTRIES
    /* A query narrows the list to its matches; the rules go between them. */
    const searchWords = queryWords(searchText)
    const search = isOk && searchWords.length > 0 ? matchesNow(groups, searchWords, isRunningNow) : undefined
    const table = search === undefined ? whole : narrowedTo(whole, search.groupsMatched)
    /* A new query shows the match nearest the Current position, held or
       not: the list it was on is gone. */
    const isQueryNew = searchText !== queryDrawn
    queryDrawn = searchText
    if (isQueryNew) top = undefined
    const listed = listedWithRules(table)
    const entries = dimRefused(listed.entries as Entry[], groups, refused)
    /* A resumed or forked session shows its history in the transcript
       before its own file is written; it is not without a conversation. */
    const missing = isCarried ? words.notWritten : words.empty
    const notice = isUnlocated
      ? words.unlocated
      : source === 'missing'
        ? missing
        : isOk && groups.length === 0
          ? words.empty
          : search !== undefined && search.matches.length === 0
            ? words.noMatch
            : undefined
    const why = source === 'failed' ? failureText(failure) : isOk && reading.unreadable > 0 ? words.unreadable(reading.unreadable) : undefined
    const alert = refusal === undefined ? undefined : { text: refusal.text, isInverse: refusalFrame(nowMs - refusal.at).isInverse }
    const headRows = HEAD_ROWS + SEARCH_ROWS
    const hasForkLine = isOk && isEarlierElsewhere && groups.length > 0
    const listRows =
      e.props.scroll.bodyRows - headRows - FOOT_ROWS - (hasForkLine ? 1 : 0) - (notice === undefined ? 0 : 1) - (alert === undefined ? 0 : 1) - (why === undefined ? 0 : 1)
    /* The Minimap, the list and the preview share the rows (preview.ts). */
    const plan = previewPlan({ rows: listRows, groups: isOk ? groups.length : 0, isShown: isPreviewOn })
    /* The Minimap's cells: a group with no Jump target is one the host
       refused or a compaction took. */
    const isOff = (g: number) => refused.has(sideKeyOf(groups[g] as TurnGroup, 'user'))
    const bars = isOk && plan.hasBars ? barsOf(groups.map(g => g.steps), width, isOff) : []
    const rows = listRows - (bars.length === 0 ? 0 : BAR_ROWS) - plan.preview
    const drawnEntries = { heights: listed.heights, rows, keys: table.keys, indexOf: table.indexOf }
    const kept = anchor
    anchor = undefined
    const anchorIndex = kept === undefined ? undefined : entryOfGroup(table, kept.group)
    /* While a query is set the list follows the match nearest the Current
       position. */
    const followed = search === undefined ? position : nearestMatch(search.groupsMatched, position)
    const lastShown = search === undefined ? groups.length - 1 : search.groupsMatched[search.groupsMatched.length - 1]
    const placed = topOfDrawing(drawnEntries, {
      top,
      follow: isHeld && !isQueryNew ? undefined : { index: followed === undefined ? undefined : entryOfGroup(table, followed), isLast: followed === lastShown },
      anchor: kept === undefined || anchorIndex === undefined ? undefined : { ...kept, index: anchorIndex },
    })
    top = placed.top
    if (placed.refocusKey !== undefined) pendingRing = placed.refocusKey
    const window = windowOf(listed.heights, rows, top)
    lastDrawing = { ...drawnEntries, entries, window }
    afterList = plan.state === 'none' || e.surface !== 'terminal' ? LAYOUT_CONTROL : PREVIEW_CONTROL
    beforeList = e.surface !== 'terminal' ? FILTER_END : searchText === '' ? SEARCH_FIELD : CLEAR_CONTROL
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
    const actionsOf = (group: TurnGroup, isRunning: boolean) => labelActions($, group, isRunning, e.surface)
    /* The desktop reports no Current position: its preview shows the entry
       pressed last. */
    const isTerminal = e.surface === 'terminal'
    let pressed: number | undefined
    if (!isTerminal && pressedOpener !== undefined) {
      const at = groups.findIndex(g => g.openerUuid === pressedOpener)
      if (at !== -1) pressed = at
    }
    const preview =
      plan.state === 'none'
        ? undefined
        : previewOf(groups, plan, isTerminal ? position : undefined, search, isRunningNow, width, nowMs, () => togglePreview($), opener => expandPreview($, opener), actionsOf, pressed)
    const expanded =
      expandedOpener === undefined ? undefined : expandedOf(groups, isRunningNow, width, nowMs, () => expandPreview($, undefined), actionsOf, isTerminal)
    if (expanded === undefined) expandedOpener = undefined
    const searchView: SearchView = {
      query: searchText,
      count: search === undefined ? undefined : { matches: search.matches.length, of: groups.length },
      onFind: () => focusSearch($),
      onInput: value => {
        if (perf.isOn) typedAt ??= perfNow()
        void setQuery($, value)
      },
      onSubmit: value => submitSearch($, value).catch(() => undefined),
      onClear: () => setQuery($, ''),
      onStep: direction => stepTurn($, direction, true),
    }
    /* The Minimap lights the Current position's cell or, while a query is
       set, the cells holding a match. */
    const litBars = new Set<number>()
    for (const g of search === undefined ? (position === undefined ? [] : [position]) : search.groupsMatched) {
      const cell = barOfGroup(bars, g)
      if (cell !== undefined) litBars.add(cell)
    }
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
      contextPercent,
      isEarlierElsewhere: hasForkLine,
      onPress: (entry: Entry) => jump($, entry),
      onFilter: (chosen: ViewFilter) => chooseFilter($, chosen),
    }
    const drawn =
      e.surface === 'terminal'
        ? drawPane($.ui.resolve(e), {
            ...shared,
            bodyRows: e.props.scroll.bodyRows,
            bars,
            litBars,
            barLabels: barLabels(stripLabels(groups[0]?.timestamp, groups[groups.length - 1]?.timestamp, nowMs), width),
            preview,
            expanded,
            search: searchView,
            onBar: (cell: number) => {
              const bar = bars[cell]
              return bar === undefined ? Promise.resolve() : jump($, { groupIndex: barTarget(bar, isOff), side: 'user', key: barKey(cell) })
            },
            onLayout: () => chooseLayout($),
          })
        : drawDesktopPane($.ui.resolve(e), {
            ...shared,
            steps: isOk ? groups.map(g => g.steps) : [],
            search: {
              query: searchText,
              count: searchView.count,
              onInput: searchView.onInput,
              onSubmit: value => showMatch($, value).catch(() => undefined),
            },
            matches: search?.groupsMatched,
            preview,
            expanded,
            onPress: (entry: Entry) => pressEntry($, entry),
            runningGroup: isRunningNow ? groups.length - 1 : undefined,
            stripLabels: stripLabels(groups[0]?.timestamp, groups[groups.length - 1]?.timestamp, nowMs),
            onLayout: to => chooseLayout($, to),
          })
    if (perf.isOn) {
      const ended = perfNow()
      timed($, 'pane', [ended - awaited, ended - began, entries.length, table === wasTable ? 0 : 1])
      if (isQueryNew && typedAt !== undefined) {
        timed($, 'search', [ended - awaited, ended - typedAt, search?.matches.length ?? 0, groups.length])
        typedAt = undefined
      }
      if (!isListedNoted && entries.length > 0) {
        isListedNoted = true
        timed($, 'listed', [ended - loadedAt])
      }
    }
    return drawn
  })
}
