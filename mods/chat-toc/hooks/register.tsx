/* chat-toc: a docked table of contents of the current session's
   conversation. This module wires the host's events to the parts:
     transcript.ts / chain.ts / groups.ts / regroup.ts  the file to Turn groups
     source.ts / reader.ts                              how and when it is read
     view.ts / entries.ts / cells.ts / window.ts        what the pane draws
     pane.tsx / ring.ts                                 how it draws, the keyboard
     sites.ts / jump.ts                                 where a press scrolls
   The host's `$` may only be handed to functions declared at the top of
   this file, so every call on `$` is made here or in one of them. */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { entriesOf, firstEntryFrom } from './entries'
import type { Entry } from './entries'
import { REFUSED_MS, REFUSED_TEXT, dimRefused, jumpTargetsOf, relisted, sideKeyOf } from './jump'
import type { Refused } from './jump'
import { DOCK_STATUS, carriesHistory, isClosedByPerson, isPaneOpen, placementFate, reopensOn } from './lifecycle'
import { EMPTY_TEXT, NOT_WRITTEN_TEXT, PANE_COLUMNS, PANE_ID, PANE_TITLE, drawPane, entryHeight, filterRows } from './pane'
import { entryAt, ringMove } from './ring'
import { FILTER_KEY, LAYOUT_KEY, filterOf, layoutOf, nextLayout } from './view'
import type { Layout, ViewFilter } from './view'
import { LATE_CHECK_MS, TRAILING_MS, gateFinish, gateFired, gateRequest, gateStart, readGate } from './reader'
import { countUnreadable, newReading, readLines } from './regroup'
import type { Reading } from './regroup'
import { WHOLE_READ_LIMIT, chunkBytesFor, chunkCommand, chunkText, failReasonOf, readChunks, readCursor, takeWhole } from './source'
import type { Chunks, FailReason, ReadCursor, SourceRead } from './source'
import { newSites, noteSite, resolveSites, rowIndex, syncRows } from './sites'
import type { OnScreen, RowIndex, SiteComponent, Sites } from './sites'
import { scrolledTop, topRevealing, windowOf } from './window'
import type { TocWindow } from './window'

const transcriptPath = atom({ plugin: 'chat-toc', key: 'transcriptPath' } as const, '')
const rev = atom({ plugin: 'chat-toc', key: 'rev' } as const, 0)
const isClosed = atom({ plugin: 'chat-toc', key: 'isClosed' } as const, false)
const isCarriedOver = atom({ plugin: 'chat-toc', key: 'isCarriedOver' } as const, false)
const isInlineAsked = atom({ plugin: 'chat-toc', key: 'isInlineAsked' } as const, false)

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
   inline is not withdrawn and reopened without end. */
let withdrawals = 0
let isWithdrawing = false

/* The person's choices, read from `$.store` at each `session.start`. */
let filter: ViewFilter = 'all'
let layout: Layout = 'card'

/* What the pane drew last, for the keyboard and the next switch: the
   entries, their keys and the table back, their heights, the rows the
   window had. */
let lastEntries: readonly Entry[] = []
let lastKeys: readonly string[] = []
let lastIndexOf: ReadonlyMap<string, number> = new Map()
let lastHeights: readonly number[] = []
let lastRows = 1
/* The Button the host's focus ring is on while the pane has the keyboard. */
let ring: string | undefined
let isPaneFocused = false
/* The group a switch of filter or Layout keeps in view, resolved by the
   next drawing, and whether the window followed the newest before it. */
let anchor: { group: number; wasFollowing: boolean; ring: string | undefined } | undefined
/* How long after a switch's redraw the ring is put back on its entry. */
const REFOCUS_MS = 60

/* The chain rows by what the host draws them under, and what it drew. */
let chainRows: RowIndex = rowIndex([])
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
  anchor = undefined
  chainRows = rowIndex([])
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
  const uuid = noteSite(sites, chainRows, component, requestId, onScreen)
  if (uuid !== undefined && refused.size > 0 && relisted(refused, uuid, reading.groups, chainRows, sites)) redrawSoon($)
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
    resolveSites(sites, chainRows, syncRows(chainRows, reading.chain))
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
   another, and asks for the keyboard. It never closes it. */
async function openAsked($: EngineInterface): Promise<void> {
  await update($, isClosed, () => false)
  await update($, isInlineAsked, () => true)
  const isOpen = isPaneOpen(await $.ui.panes())
  await openPane($, isOpen ? true : undefined)
}

/* Docked: nothing to explain, and a later inline is the terminal narrowing. */
async function settleDocked($: EngineInterface): Promise<void> {
  withdrawals = 0
  showStatus($, undefined)
  if (await read($, isInlineAsked)) await update($, isInlineAsked, () => false)
}

/* The host turned the docked pane inline: closed (not the person's close,
   so not kept closed) and opened again unasked, to wait undrawn for the
   room to dock, the status line saying so meanwhile. */
async function withdraw($: EngineInterface): Promise<void> {
  if (isWithdrawing) return
  isWithdrawing = true
  try {
    withdrawals += 1
    await $.ui.close({ id: PANE_ID }).catch(() => undefined)
    if (withdrawals > 1) return showStatus($, DOCK_STATUS.narrow)
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
  refusal = undefined
  for (const target of jumpTargetsOf(group, entry.side, chainRows, sites)) {
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
   has the keyboard, else the window's top one while the person has
   scrolled it; none while it follows the newest, which it goes on doing. */
function anchorForSwitch(): void {
  const at = isPaneFocused ? entryAt(ring, lastIndexOf) : undefined
  const entry = at !== undefined ? lastEntries[at.index] : top !== undefined ? lastEntries[lastWindow.start] : undefined
  anchor = entry === undefined ? undefined : { group: entry.groupIndex, wasFollowing: top === undefined, ring: at === undefined ? undefined : ring }
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

async function chooseLayout($: EngineInterface): Promise<void> {
  anchorForSwitch()
  layout = nextLayout(layout)
  await update($, rev, n => n + 1)
  await $.store.set(LAYOUT_KEY, layout).catch(() => undefined)
}

/* Lands the focus ring on a Button the next drawing brings. The host does
   not raise this plugin's own move to its `ui.focus` hook, so the ring is
   noted here. */
async function focusKey($: EngineInterface, key: string): Promise<void> {
  const moved = await $.ui.focus({ requestId: PANE_ID, key }).catch(() => ({ deny: 'failed' }))
  if (moved.deny === undefined) ring = key
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    const path = e.transcript_path ?? ''
    if (path !== (await read($, transcriptPath))) {
      await update($, transcriptPath, () => path)
      await update($, isCarriedOver, () => carriesHistory(e.source))
      forget()
    }
    readNow($)
    /* /clear and /resume start another conversation; the host resets
       `$.state` with it, and the pane opens for it as at a start. */
    if (reopensOn(e.source)) {
      await update($, isClosed, () => false)
      void autoOpen($)
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chat-toc', description: '打开对话目录', immediate: true })
    await loadChoices($)
    readNow($)
    void autoOpen($)
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

  /* The hint line is drawn from the start and again after every change of
     width: where chat-toc learns the layout, which the start events lack. */
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, ($, e, next) => {
    const said = e.viewport?.isFullscreen
    if (said !== undefined && said !== isFullscreen) {
      isFullscreen = said
      if (isOpenWanted) $.clock.after(0, () => void autoOpen($))
    }
    return next(e)
  })

  /* The arrows walk the host's focus ring Button by Button; this keeps it
     on entries' first lines and scrolls the window at its ends (ring.ts). */
  on('ui.focus', { component: 'Pane', requestId: 'chat-toc' }, async ($, e, next) => {
    const move = e.origin.kind === 'person' ? ringMove(lastKeys, lastIndexOf, lastWindow, ring, e.element) : { kind: 'accept' as const }
    if (move.kind === 'reveal') {
      const key = lastKeys[move.index]
      if (key === undefined) return next(e)
      top = topRevealing(lastHeights, lastRows, lastWindow, move.index)
      selectionMoved($, key)
      await update($, rev, n => n + 1)
      $.clock.after(0, () => void focusKey($, key))
      return { deny: 'chat-toc moves its window to the next entry first' }
    }
    const element = move.kind === 'land' ? move.key : e.element
    const result = await next(move.kind === 'land' ? { ...e, element: move.key } : e)
    if (result.deny === undefined) ring = element
    if (result.deny === undefined) selectionMoved($, element)
    return result
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
    isPaneFocused = e.props.isFocused
    if (!isPaneFocused) ring = undefined
    /* A drawing writes nothing, so what its placement asks is done after. */
    const isAsked = await read($, isInlineAsked)
    const fate = placementFate(e.props.placement, isAsked)
    if (fate === 'docked' && (statusShown !== undefined || isAsked || withdrawals > 0)) $.clock.after(0, () => void settleDocked($))
    if (fate === 'withdraw' && !isWithdrawing) $.clock.after(0, () => void withdraw($))
    if (fate === 'asked-inline') {
      const text = e.viewport?.isFullscreen === false ? DOCK_STATUS.askedMainScreen : DOCK_STATUS.askedNarrow
      if (text !== statusShown) $.clock.after(0, () => showStatus($, text))
    }
    const isOk = source === 'ok'
    const width = e.props.bodyColumns
    const listed = isOk ? entriesOf(reading.groups, { layout, filter, width, nowMs: await $.clock.now(), isRunning: isTurnRunning }) : []
    const entries = dimRefused(listed, reading.groups, refused)
    /* A resumed or forked session shows its history in the transcript
       before its own file is written; it is not without a conversation. */
    const missing = (await read($, isCarriedOver)) ? NOT_WRITTEN_TEXT : EMPTY_TEXT
    const notice = source === 'missing' ? missing : isOk && entries.length === 0 ? EMPTY_TEXT : undefined
    const why = source === 'failed' ? FAILURES[failure] : isOk && reading.unreadable > 0 ? unreadableText(reading.unreadable) : undefined
    const footerLines = [refusal === undefined ? undefined : REFUSED_TEXT, why].filter((s): s is string => s !== undefined)
    const footer = footerLines.length > 0 ? footerLines.join('\n') : undefined
    const heights = entries.map((_, i) => entryHeight(entries, i))
    const headRows = filterRows(width, filter, layout)
    const rows = e.props.scroll.bodyRows - headRows - (notice === undefined ? 0 : 1) - footerLines.length
    if (anchor !== undefined) {
      const kept = anchor
      anchor = undefined
      const index = firstEntryFrom(entries, kept.group)
      if (index !== undefined) {
        const following = windowOf(heights, rows, undefined)
        if (!kept.wasFollowing || index < following.start || index >= following.end) top = index
        /* The host keeps the ring on the same place in its order across
           the redraw, a body line now; put it back on the selected entry
           once the new drawing is laid out. */
        const key = kept.ring !== undefined && entries.some(entry => entry.key === kept.ring) ? kept.ring : entries[index]?.key
        if (kept.ring !== undefined && key !== undefined) $.clock.after(REFOCUS_MS, () => void focusKey($, key))
      }
    }
    lastWindow = windowOf(heights, rows, top)
    lastEntries = entries
    lastKeys = entries.map(entry => entry.key)
    lastIndexOf = new Map(lastKeys.map((key, i) => [key, i]))
    lastHeights = heights
    lastRows = rows
    return drawPane($.ui.resolve(e), {
      entries,
      window: lastWindow,
      layout,
      filter,
      litGroup: undefined,
      headRows,
      notice,
      footer,
      onPress: entry => jump($, entry),
      onFilter: chosen => chooseFilter($, chosen),
      onLayout: () => chooseLayout($),
    })
  })
}
