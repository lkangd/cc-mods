/* chat-toc: a docked table of contents of the current session's
   conversation. This module wires the host's events to the parts:
     transcript.ts / chain.ts / groups.ts / model.ts  the file to Turn groups
     source.ts / reader.ts                            how and when it is read
     entries.ts / cells.ts / window.ts / pane.tsx     what the pane draws
     jump.ts                                          where a press scrolls
   The host's `$` may only be handed to functions declared at the top of
   this file, so every call on `$` is made here or in one of them. */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { cardEntries } from './entries'
import type { Entry } from './entries'
import { jumpTargetOf } from './jump'
import { EMPTY_MODEL, tocModel } from './model'
import type { TocModel } from './model'
import { EMPTY_TEXT, PANE_COLUMNS, PANE_ID, PANE_TITLE, drawPane, entryHeight } from './pane'
import { LATE_CHECK_MS, TRAILING_MS, gateFinish, gateFired, gateRequest, gateStart, readGate } from './reader'
import { WHOLE_READ_LIMIT } from './source'
import type { SourceRead } from './source'
import { scrolledTop, windowOf } from './window'
import type { TocWindow } from './window'

const transcriptPath = atom({ plugin: 'chat-toc', key: 'transcriptPath' } as const, '')
const rev = atom({ plugin: 'chat-toc', key: 'rev' } as const, 0)

type SourceState = 'unknown' | 'missing' | 'ok' | 'too-large' | 'failed'

const NOTICES: Record<Exclude<SourceState, 'ok'>, string | undefined> = {
  unknown: undefined,
  missing: EMPTY_TEXT,
  'too-large': 'transcript 超过 4 MiB，目录暂时读不了',
  failed: '读不到本会话的 transcript',
}

/* What the last read made of the file. Module state: a hot reload starts it
   over, and `session.start` then reads again. */
let model: TocModel = EMPTY_MODEL
let source: SourceState = 'unknown'
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

function forget(): void {
  model = EMPTY_MODEL
  source = 'unknown'
  lastSize = undefined
  top = undefined
}

async function readSource($: EngineInterface, path: string): Promise<SourceRead> {
  let size: number
  try {
    size = (await $.fs.stat(path)).size
  } catch {
    try {
      return (await $.fs.exists(path)) ? { kind: 'failed' } : { kind: 'missing' }
    } catch {
      return { kind: 'failed' }
    }
  }
  if (size === lastSize) return { kind: 'unchanged' }
  if (size > WHOLE_READ_LIMIT) return { kind: 'too-large', size }
  try {
    return { kind: 'text', text: await $.fs.read(path), size }
  } catch {
    return { kind: 'failed' }
  }
}

async function load($: EngineInterface): Promise<void> {
  const path = await read($, transcriptPath)
  if (!path) return
  const got = await readSource($, path)
  if (got.kind === 'unchanged') return
  if (got.kind === 'text') {
    model = tocModel(got.text)
    lastSize = got.size
    source = 'ok'
  } else {
    model = EMPTY_MODEL
    lastSize = undefined
    source = got.kind
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
   the person's own input. */
async function jump($: EngineInterface, entry: Entry): Promise<void> {
  const target = jumpTargetOf(entry)
  await $.ui.scroll({ to: { requestId: target.requestId }, block: target.block }).catch(() => undefined)
}

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

  on('ui.render', { component: 'Pane', requestId: 'chat-toc' }, async ($, e) => {
    await read($, rev)
    const entries = cardEntries(model.groups, e.props.bodyColumns, await $.clock.now(), isTurnRunning)
    const notice = source === 'ok' ? (entries.length === 0 ? EMPTY_TEXT : undefined) : NOTICES[source]
    const heights = entries.map((_, i) => entryHeight(entries, i))
    lastWindow = windowOf(heights, e.props.scroll.bodyRows - (notice === undefined ? 0 : 1), top)
    return drawPane($.ui.resolve(e), { entries, window: lastWindow, notice, onPress: entry => jump($, entry) })
  })
}
