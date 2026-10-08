import { expect } from 'claude-code/testing'
import { test } from './support'
import type { Engine, MockClock } from 'claude-code/testing'
import { TITLE_KEY, arrowStep } from '../hooks/band'
import { branchStarts, foldTimeline, forkSources } from '../hooks/branch'
import type { ArchiveRow, ProcessCall } from './support'
import { EXPECTED_HELPER_SHA256 } from '../hooks/artifact'
import {
  BAND_ID,
  composerPrompt,
  consentedStore,
  helperPath,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

/* Issue 21: the band is a bounded window over the Project Timeline. Arrowing
   onto the row at either end of it loads the batch beyond, new entries follow
   the bottom, and nothing is numbered by where the window happens to start. */

const otherRunId = '12121212-3434-4565-8787-909090909090'
const otherSessionId = '31313131-4242-4353-8464-757575757575'
const branchId = 'dddddddd-eeee-4fff-8000-111111111111'
/* Two batches and the overscan row. */
const WINDOW_LIMIT = 257

function entry(sequence: number, fields: Partial<ArchiveRow> = {}): ArchiveRow {
  return {
    kind: 'prompt',
    eventId: `e${String(sequence).padStart(7, '0')}-0000-4000-8000-000000000000`,
    sequence,
    runId: otherRunId,
    segmentId: otherSessionId,
    branchId,
    text: `PH-SECRET-OLD-${sequence}`,
    attachmentCount: 0,
    ...fields,
  }
}

/* One lineage of `count` entries, one row each in the band. */
function archiveOf(count: number): ArchiveRow[] {
  return Array.from({ length: count }, (_, index) =>
    entry(index + 1, index === 0 ? { parentEventId: null } : { parentEventId: entry(index).eventId }))
}

type Band = {
  keys: string[]
  prompts: string[]
  labels: string[]
  rows: number
  above: number
  below: number
  text: string
}

/* The keyed rows the band drew, in order; Prompt Entries by their labels.
   A Text keeps no key in the drawn tree, so `rows` counts every row and
   `text` holds what they say. `above` and `below` count the blank rows
   before the title and after the last row: every row of the band here is a
   Button, so they are the leading and trailing Texts. The archived entries
   here are none of this transcript's rows, so each is marked ×; a label
   leaves the mark out, which is Issue 22's to test. */
function band(tree: unknown): Band {
  const keys: string[] = []
  const labels: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown }
    if (typeof props?.key === 'string') {
      keys.push(props.key)
      if (typeof props.label === 'string') {
        labels.push(props.label.replace(/^× /, ''))
      }
    }
    walk(children)
  }
  walk(tree)
  const root = tree as { children?: unknown[] } | undefined
  const kids = (root?.children ?? []) as { type?: string }[]
  const blank = (kid: { type?: string }) => kid.type === 'Text'
  const firstDrawn = kids.findIndex(kid => !blank(kid))
  const lastDrawn = kids.findLastIndex(kid => !blank(kid))
  return {
    keys,
    prompts: keys.filter(key => key.startsWith('prompt-history:prompt:')),
    labels,
    rows: kids.length,
    above: firstDrawn < 0 ? 0 : firstDrawn,
    below: lastDrawn < 0 ? 0 : kids.length - 1 - lastDrawn,
    text: JSON.stringify(tree),
  }
}

function reads(calls: readonly ProcessCall[]): string[][] {
  return calls
    .filter(call => call.argv[1] === 'timeline-read')
    .map(call => call.argv.slice(6))
}

/* The person's arrows moving the band's focus ring onto one element. */
function focusRow($: Engine, key: string) {
  return $.ui.focus({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    element: key,
    origin: { kind: 'person' },
  })
}

/* The person's wheel or trackpad over the band, or with `keys` the engine's
   scroll keys, an arrow being a step of one. The engine sends these only
   while the band's tree is taller than it, blank rows standing for the rows
   above and below the view; where its window lands is the terminal
   acceptance's (the test engine lays nothing out). */
function scrollBand($: Engine, by: number, input: 'wheel' | 'keys' = 'wheel') {
  return $.ui.scroll({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    offset: 0,
    by,
    bodyRows: 11,
    contentRows: 13,
    origin: { kind: 'person' },
    ...(input === 'wheel' ? { pointer: { column: 4, row: 2 } } : {}),
  })
}

/* A band tall enough to show the whole window at once. */
const WHOLE = { maxRows: 400 }

test('the band opens on the latest batch and one earlier entry, numbered in the project', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)

  await promptHistory($)
  const whole = band(await renderBand($, WHOLE))

  expect(whole.prompts).toHaveLength(129)
  expect(whole.labels).toContain('472. PH-SECRET-OLD-472')
  expect(whole.labels).toContain('600. PH-SECRET-OLD-600')
  expect(reads(calls).every(argv => !argv.includes('before') && !argv.includes('after'))).toBe(true)
})

test('at the bottom a blank row stands above the title for each row above the view', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)

  const drawn = band(await renderBand($, { maxRows: 12 }))

  /* The engine's `↑ n more` row takes the last of its `maxRows`: the title
     and ten rows show, and the 119 rows from 472 to 590 are what it counts.
     The tree is taller than the band, so the trackpad reaches it here too. */
  expect(drawn.keys[0]).toBe('prompt-history:toggle')
  expect(drawn.prompts).toHaveLength(10)
  expect(drawn.labels.at(-1)).toBe('600. PH-SECRET-OLD-600')
  expect(drawn.above).toBe(119)
  expect(drawn.below).toBe(0)
  expect(drawn.rows).toBe(119 + 1 + 10)
})

test('away from the bottom blank rows stand for the rows above and below the view', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  await scrollBand($, -20)
  const drawn = band(await renderBand($, { maxRows: 12 }))

  /* `↑ 99 more · ↓ 20 more`: 472 to 570 above, 581 to 600 below. */
  expect(drawn.keys[0]).toBe('prompt-history:toggle')
  expect(drawn.prompts).toHaveLength(10)
  expect(drawn.labels.at(-1)).toBe('580. PH-SECRET-OLD-580')
  expect(drawn.above).toBe(99)
  expect(drawn.below).toBe(20)
  expect(drawn.rows).toBe(99 + 1 + 10 + 20)
})

test('at the bottom the trackpad moves the view up a row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  await scrollBand($, -1)
  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.labels.at(-1)).toBe('599. PH-SECRET-OLD-599')
  expect(drawn.above).toBe(118)
  expect(drawn.below).toBe(1)
})

/* PH-UI-002/004/006 on 2.1.290: the engine places the band's seat of its
   window against the layout the terminal last reported, so right after the
   band opens from its folded row the seat lands nowhere, answers `{}` and
   nothing draws again. Here every drawing is handed the window at the top
   (offset 0) while the view rests 119 rows down, as a seat that never lands;
   the host draws the band again only when asked to. */
test('a seat that leaves the window off the view draws the band again, a bounded number of times', async ($, on) => {
  const invalidations: string[] = []
  on('ui.invalidate', (_$, e, next) => {
    invalidations.push(e.event)
    return next(e)
  })
  let clock: MockClock | undefined
  installSupportedTarget(on, {
    store: consentedStore(),
    archive: archiveOf(600),
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  await promptHistory($)
  invalidations.length = 0

  await renderBand($, { maxRows: 12 })
  const counts: number[] = []
  for (let round = 0; round < 10; round++) {
    const before = invalidations.length
    await clock!.advance(1000)
    counts.push(invalidations.length)
    if (invalidations.length > before) await renderBand($, { maxRows: 12 })
  }

  expect(invalidations.every(event => event === 'ui.render')).toBe(true)
  expect(counts[0]).toBe(1)
  expect(counts.at(-1)).toBeGreaterThan(1)
  expect(counts.at(-1)).toBeLessThan(10)
  expect(counts.at(-1)).toBe(counts.at(-2))

  /* Folded and opened again, the band seats its window afresh. */
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await promptHistory($)
  invalidations.length = 0
  await renderBand($, { maxRows: 12 })
  await clock!.advance(1000)
  expect(invalidations).toEqual(['ui.render'])
})

test('a drawing with the window on the view ends the seat\'s redraws', async ($, on) => {
  const invalidations: string[] = []
  on('ui.invalidate', (_$, e, next) => {
    invalidations.push(e.event)
    return next(e)
  })
  let clock: MockClock | undefined
  installSupportedTarget(on, {
    store: consentedStore(),
    archive: archiveOf(600),
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  await promptHistory($)
  invalidations.length = 0

  await renderBand($, { maxRows: 12 })
  await clock!.advance(1000)
  expect(invalidations).toEqual(['ui.render'])

  /* The second seat landed: the window now starts on the view's 119 blank
     rows, the title on its first row. */
  await renderBand($, { maxRows: 12, offset: 119 })
  await clock!.advance(5000)
  expect(invalidations).toEqual(['ui.render'])
})

test('a band whose rows all fit draws no blank rows', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(5) })
  await $.session.start(session)
  await promptHistory($)

  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.rows).toBeLessThanOrEqual(12)
  expect(drawn.rows).toBe(drawn.keys.length)
})

test('a window one row longer than a scrolling view shows whole, with nothing hidden or counted', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(11) })
  await $.session.start(session)
  await promptHistory($)

  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.rows).toBe(12)
  expect(drawn.prompts).toHaveLength(11)
  expect(drawn.above + drawn.below).toBe(0)
})

test('scrolling to the top of the window loads the batch before it without moving the view', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  await scrollBand($, -100)
  expect(reads(calls).at(-1)).not.toContain('before')
  await scrollBand($, -100)
  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(reads(calls).at(-1)?.slice(0, 2)).toEqual(['before', '472'])
  /* The view still starts on the window's former first row. */
  expect(drawn.labels[1]).toBe('472. PH-SECRET-OLD-472')
  expect(band(await renderBand($, WHOLE)).labels).toContain('343. PH-SECRET-OLD-343')
})

test('scrolling to the top of the window runs no helper that changed since the band opened', async ($, on) => {
  const helperDigest = { value: EXPECTED_HELPER_SHA256 }
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600), helperDigest })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  helperDigest.value = 'f'.repeat(64)
  const ranBefore = calls.length
  await scrollBand($, -100)
  await scrollBand($, -100)

  expect(calls.slice(ranBefore).filter(call => call.argv[0] === helperPath)).toStrictEqual([])
})

test('scrolling alone walks to the first event and back to the latest, never holding more than the window', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(1_000) })
  await $.session.start(session)
  await promptHistory($)

  let drawn = band(await renderBand($, { maxRows: 12 }))
  for (let step = 0; step < 40 && drawn.labels[1] !== '1. PH-SECRET-OLD-1'; step += 1) {
    await scrollBand($, -200)
    drawn = band(await renderBand($, { maxRows: 12 }))
  }
  expect(drawn.labels[1]).toBe('1. PH-SECRET-OLD-1')
  expect(band(await renderBand($, WHOLE)).prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  await renderBand($, { maxRows: 12 })
  const readsAtStart = reads(calls).length
  await scrollBand($, -1)
  expect(reads(calls)).toHaveLength(readsAtStart)

  for (let step = 0; step < 40 && drawn.labels.at(-1) !== '1000. PH-SECRET-OLD-1000'; step += 1) {
    await scrollBand($, 200)
    drawn = band(await renderBand($, { maxRows: 12 }))
  }
  expect(drawn.labels.at(-1)).toBe('1000. PH-SECRET-OLD-1000')
  expect(band(await renderBand($, WHOLE)).prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  expect(reads(calls).some(argv => argv[0] === 'after')).toBe(true)
  expect(JSON.stringify(drawn)).not.toMatch(/第 \d+ 页|page/i)
})

test('walking this Run\'s path both ways, each read walks it from an entry next to the batch', async ($, on) => {
  const archive = archiveOf(1_000).map(row => ({ ...row, runId }))
  const bySequence = new Map(archive.map(row => [row.eventId, row.sequence]))
  const calls = installSupportedTarget(on, {
    store: {
      ...consentedStore(),
      [`prompt-history:branch:${projectId}:${runId}:${sessionId}`]: {
        version: 1,
        branchId,
        parentEventId: archive.at(-1)!.eventId,
      },
    },
    archive,
    transcript: [],
  })
  await $.session.start(session)
  await promptHistory($)

  let drawn = band(await renderBand($, { maxRows: 12 }))
  for (let step = 0; step < 40 && drawn.labels[1] !== '1. PH-SECRET-OLD-1'; step += 1) {
    await scrollBand($, -200)
    drawn = band(await renderBand($, { maxRows: 12 }))
  }
  for (let step = 0; step < 40 && drawn.labels.at(-1) !== '1000. PH-SECRET-OLD-1000'; step += 1) {
    await scrollBand($, 200)
    drawn = band(await renderBand($, { maxRows: 12 }))
  }

  expect(drawn.labels.at(-1)).toBe('1000. PH-SECRET-OLD-1000')
  const cursors = reads(calls).filter(argv => argv[0] === 'before' || argv[0] === 'after')
  expect(cursors.filter(argv => argv[0] === 'after').length).toBeGreaterThan(2)
  for (const argv of cursors) {
    const [direction, cursor, , , start, from] = argv
    expect(start).toBe('1')
    /* Below the window for an earlier batch, above it for a later one; the
       first entry's batch has nothing of the path below it. */
    if (direction === 'before') expect(from === 'none' || bySequence.get(from!)! < Number(cursor)).toBe(true)
    else expect(bySequence.get(from!)!).toBeGreaterThan(Number(cursor))
  }
})

test('the engine\'s scroll keys move the view the same way', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  await scrollBand($, -11, 'keys')
  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.labels.at(-1)).toBe('589. PH-SECRET-OLD-589')
})

test('an arrow off the first row shown moves the view up one row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.labels[1]).toBe('586. PH-SECRET-OLD-586')
  await focusRow($, drawn.prompts[0]!)

  await scrollBand($, -1, 'keys')
  const moved = band(await renderBand($, { maxRows: 12 }))

  expect(moved.labels[1]).toBe('585. PH-SECRET-OLD-585')
})

/* While every row shows the tree fits, so the engine walks the ring itself
   and wraps it at both ends; the band refuses the wraps. */

test('a band showing every row refuses the engine wrapping the ring from the title to the last row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(5) })
  await $.session.start(session)
  await promptHistory($)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  await focusRow($, 'prompt-history:toggle')

  expect((await focusRow($, drawn.prompts.at(-1)!)).deny).toBeDefined()
})

test('a band showing every row refuses the engine wrapping the ring from the last row to the title', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(5) })
  await $.session.start(session)
  await promptHistory($)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  await focusRow($, drawn.prompts.at(-1)!)

  expect((await focusRow($, 'prompt-history:toggle')).deny).toBeDefined()
  expect(band(await renderBand($, { maxRows: 12 })).labels.at(-1)).toBe('5. PH-SECRET-OLD-5')
})

test('an arrow off the last row shown moves the view down one row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.labels.at(-1)).toBe('595. PH-SECRET-OLD-595')
  await focusRow($, drawn.prompts.at(-1)!)

  await scrollBand($, 1, 'keys')
  const moved = band(await renderBand($, { maxRows: 12 }))

  expect(moved.labels.at(-1)).toBe('596. PH-SECRET-OLD-596')
})

test('an arrow up from the title shows the rows still above it', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(30) })
  await $.session.start(session)
  await promptHistory($)
  const first = band(await renderBand($, WHOLE)).keys[1]
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -100)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, 1)
  expect(band(await renderBand($, { maxRows: 12 })).keys[1]).not.toBe(first)
  await focusRow($, 'prompt-history:toggle')

  await scrollBand($, -1, 'keys')

  expect(band(await renderBand($, { maxRows: 12 })).keys[1]).toBe(first)
})

/* PH-UI-002/004 on 2.1.290: the walk up reached the first entry with the
   view following it there, one row down, the Run's start above it unseen;
   the arrow onto the title left the view where it was, so the next arrow,
   on the title, only moved the view up and the ring stood still. The title
   row drew a way up while rows lay above the view, so before its blank rows
   that press changed the ring's row and passed for a move. */
test('an arrow from the first entry onto the title shows the rows above that entry', async ($, on) => {
  const started: ArchiveRow = {
    kind: 'run-started',
    eventId: 'a0000000-0000-4000-8000-00000000beef',
    sequence: 1,
    runId: otherRunId,
    segmentId: otherSessionId,
    branchId,
  }
  const entries = archiveOf(30).map(row => ({ ...row, sequence: row.sequence + 1 }))
  installSupportedTarget(on, { store: consentedStore(), archive: [started, ...entries] })
  await $.session.start(session)
  await promptHistory($)
  const first = band(await renderBand($, WHOLE))
  expect(first.text).toContain('Run 开始')
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -100)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, 1)
  const below = band(await renderBand($, { maxRows: 12 }))
  expect(below.above).toBe(1)
  expect(below.prompts[0]).toBe(first.prompts[0])
  await focusRow($, below.prompts[0]!)

  await scrollBand($, -1, 'keys')
  const top = band(await renderBand($, { maxRows: 12 }))

  expect(top.above).toBe(0)
  expect(top.keys.slice(0, 2)).toEqual(first.keys.slice(0, 2))
  expect(top.text).toContain('Run 开始')
})

test('an arrow down from the last entry shows the rows still below it and follows again', async ($, on) => {
  /* A Run started after the last entry and never left: its start and the
     mark saying so are the two rows below the last entry. */
  const started: ArchiveRow = {
    kind: 'run-started',
    eventId: 'a0000000-0000-4000-8000-00000000beef',
    sequence: 31,
    runId: '77777777-0000-4000-8000-000000000000',
    segmentId: otherSessionId,
    branchId,
  }
  installSupportedTarget(on, { store: consentedStore(), archive: [...archiveOf(30), started] })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -1)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.text).not.toContain('Run 未记录离开')
  await focusRow($, drawn.prompts.at(-1)!)

  await scrollBand($, 1, 'keys')
  expect(band(await renderBand($, { maxRows: 12 })).text).toContain('Run 未记录离开')

  await composerPrompt($, { text: 'PH-SECRET-NEW' })
  const latest = band(await renderBand($, { maxRows: 12 }))
  expect(latest.keys).not.toContain('prompt-history:latest')
  expect(latest.labels.at(-1)).toBe('31. PH-SECRET-NEW')
})

test('each arrow walks on from the row the view followed to, even while the engine refuses the ring there', async ($, on) => {
  /* The row an arrow heads for above the view is focused once the drawing
     shows it. The engine can refuse that focus while its new frame is not
     yet in (the test engine refuses every focus the plugin asks for), and
     keeps the ring by position meanwhile; the next arrow still walks on. */
  let clock: MockClock | undefined
  installSupportedTarget(on, {
    store: consentedStore(),
    archive: archiveOf(600),
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.prompts[0]).toBe(`prompt-history:prompt:${entry(586).eventId}`)
  await focusRow($, drawn.prompts[0]!)

  const tops: string[] = []
  for (let press = 0; press < 3; press++) {
    await scrollBand($, -1, 'keys')
    tops.push(band(await renderBand($, { maxRows: 12 })).prompts[0]!)
    await clock!.settle()
  }

  expect(tops).toEqual([585, 584, 583].map(sequence => `prompt-history:prompt:${entry(sequence).eventId}`))
})

/* PH-UI-004 on 2.1.290: walking down, the view followed the ring onto an
   entry below it with three boundary rows between, and the ring was drawn
   nowhere. The engine keeps its ring by position: the new drawing showed
   fewer stops than the ring's position, so the engine dropped it, and could
   drop it again after the drawing's own send had landed. A later drawing
   sends it again; the test engine refuses every focus the plugin asks for,
   so what shows here is the band asking to be drawn again, once. */
test('a ring the view followed is sent again from a later drawing, once', async ($, on) => {
  const invalidations: string[] = []
  on('ui.invalidate', (_$, e, next) => {
    invalidations.push(e.event)
    return next(e)
  })
  let clock: MockClock | undefined
  installSupportedTarget(on, {
    store: consentedStore(),
    archive: archiveOf(600),
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12, offset: 114 }))
  expect(drawn.labels.at(-1)).toBe('595. PH-SECRET-OLD-595')
  await focusRow($, drawn.prompts.at(-1)!)
  await scrollBand($, 1, 'keys')
  await clock!.settle()
  invalidations.length = 0

  /* The window already on the view's top: no seat draws the band again. */
  const followed = band(await renderBand($, { maxRows: 12, offset: 115 }))
  expect(followed.labels.at(-1)).toBe('596. PH-SECRET-OLD-596')
  await clock!.advance(1000)
  expect(invalidations).toEqual(['ui.render'])

  await renderBand($, { maxRows: 12, offset: 115 })
  await clock!.advance(1000)
  expect(invalidations).toEqual(['ui.render'])
})

test('arrows pressed faster than the band draws each walk a row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  await focusRow($, drawn.prompts[0]!)

  await scrollBand($, -1, 'keys')
  await scrollBand($, -1, 'keys')

  expect(band(await renderBand($, { maxRows: 12 })).prompts[0]).toBe(`prompt-history:prompt:${entry(584).eventId}`)
})

test('the ring reaching the window\'s first row fetches the batch before it', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const whole = band(await renderBand($, WHOLE))

  await focusRow($, whole.prompts[0]!)

  expect(reads(calls).at(-1)?.slice(0, 2)).toEqual(['before', '472'])
  expect(band(await renderBand($, WHOLE)).labels).toContain('343. PH-SECRET-OLD-343')
})

test('a focus the engine moves on its own loads nothing', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const first = band(await renderBand($, WHOLE)).prompts[0]!
  const before = reads(calls).length

  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    element: first,
    origin: { kind: 'plugin', name: 'another' },
  })

  expect(reads(calls)).toHaveLength(before)
})

test('at the bottom a new entry is followed and nothing is counted', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)

  await composerPrompt($, { text: 'PH-SECRET-NEW' })
  const drawn = band(await renderBand($))

  expect(drawn.labels.at(-1)).toBe('41. PH-SECRET-NEW')
  expect(drawn.labels[0]).toBe('▾ prompt-history')
  expect(drawn.keys).not.toContain('prompt-history:latest')
})

test('away from the bottom a new entry keeps the view and is counted until the band returns', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  const before = band(await renderBand($))

  await composerPrompt($, { text: 'PH-SECRET-NEW-1' })
  await composerPrompt($, { text: 'PH-SECRET-NEW-2' })
  let drawn = band(await renderBand($))

  expect(drawn.labels[0]).toBe('▾ prompt-history · 2 条新条目')
  expect(drawn.labels.at(-1)).toBe('↓ 2 条新条目')
  /* The same rows as before, the new-entry row taking the last line. */
  expect(drawn.prompts[0]).toBe(before.prompts[0])
  expect(drawn.labels).not.toContain('42. PH-SECRET-NEW-2')

  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:latest' })
  drawn = band(await renderBand($))

  expect(drawn.labels[0]).toBe('▾ prompt-history')
  expect(drawn.labels.at(-1)).toBe('42. PH-SECRET-NEW-2')
  expect(drawn.keys).not.toContain('prompt-history:latest')
})

test('away from the bottom a new entry never pushes the row the view starts on out of a full window', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(WINDOW_LIMIT) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  /* Up to the project's first entry: the window then holds every event. */
  for (let step = 0; step < 4; step += 1) {
    await scrollBand($, -200)
    await renderBand($)
  }
  expect(band(await renderBand($)).labels[1]).toBe('1. PH-SECRET-OLD-1')

  await composerPrompt($, { text: 'PH-SECRET-NEW' })
  const drawn = band(await renderBand($))

  expect(drawn.labels[1]).toBe('1. PH-SECRET-OLD-1')
  expect(drawn.labels[0]).toBe('▾ prompt-history · 1 条新条目')
})

test('a failed read back to the latest batch keeps the count', async ($, on) => {
  const target = { store: consentedStore(), archive: archiveOf(1_000), readFails: false }
  installSupportedTarget(on, target)
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  for (let step = 0; step < 4; step += 1) {
    await scrollBand($, -200)
    await renderBand($)
  }
  await composerPrompt($, { text: 'PH-SECRET-NEW' })
  expect(band(await renderBand($)).labels).toContain('↓ 1 条新条目')

  target.readFails = true
  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:latest' })

  expect(band(await renderBand($)).labels).toContain('↓ 1 条新条目')
})

test('scrolling back to the bottom clears the count', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  await renderBand($)
  await composerPrompt($, { text: 'PH-SECRET-NEW' })
  expect(band(await renderBand($)).labels).toContain('↓ 1 条新条目')

  await scrollBand($, 100)
  const drawn = band(await renderBand($))

  expect(drawn.keys).not.toContain('prompt-history:latest')
  expect(drawn.labels[0]).toBe('▾ prompt-history')
  expect(drawn.labels.at(-1)).toBe('41. PH-SECRET-NEW')
})

test('opening the band again returns it to the latest batch', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(1_000) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  for (let step = 0; step < 4; step += 1) {
    await scrollBand($, -200)
    await renderBand($)
  }
  expect(band(await renderBand($, WHOLE)).labels).not.toContain('1000. PH-SECRET-OLD-1000')

  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:toggle' })
  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:toggle' })
  const drawn = band(await renderBand($))

  expect(drawn.labels.at(-1)).toBe('1000. PH-SECRET-OLD-1000')
  expect(reads(calls).at(-1)?.[0]).not.toBe('before')
})

test('an entry another Run wrote in between is read back, never skipped over', async ($, on) => {
  let clock: MockClock | undefined
  const archive = archiveOf(3)
  installSupportedTarget(on, {
    store: consentedStore(),
    archive,
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)

  /* A concurrent Run of the same project archives first. */
  archive.push(entry(4, { text: 'PH-SECRET-CONCURRENT' }))
  await composerPrompt($, { text: 'PH-SECRET-MINE' })
  await clock!.settle()
  const drawn = band(await renderBand($))

  expect(drawn.labels).toEqual(expect.arrayContaining([
    '4. PH-SECRET-CONCURRENT',
    '5. PH-SECRET-MINE',
  ]))
})

test('opening the band again reads what another Run archived while it was closed', async ($, on) => {
  const archive = archiveOf(3)
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  const toggle = () => $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:toggle' })

  /* No signal crosses processes: the band learns of it only by reading,
     whichever way it is opened. */
  await toggle()
  archive.push(entry(4, { text: 'PH-SECRET-CONCURRENT', parentEventId: null }))
  await toggle()
  const pressed = band(await renderBand($))
  await toggle()
  archive.push(entry(5, { text: 'PH-SECRET-LATER', parentEventId: null }))
  await promptHistory($)
  const commanded = band(await renderBand($))

  expect(pressed.labels).toContain('4. PH-SECRET-CONCURRENT')
  expect(commanded.labels).toContain('5. PH-SECRET-LATER')
})

test('away from the bottom, a gap leaves the window and counts the entry', async ($, on) => {
  const archive = archiveOf(40)
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  await renderBand($)

  archive.push(entry(41, { text: 'PH-SECRET-CONCURRENT' }))
  await composerPrompt($, { text: 'PH-SECRET-MINE' })
  const drawn = band(await renderBand($, WHOLE))

  expect(drawn.labels).toContain('↓ 1 条新条目')
  expect(drawn.labels).not.toContain('42. PH-SECRET-MINE')

  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:latest' })
  const latest = band(await renderBand($))
  expect(latest.labels).toEqual(expect.arrayContaining([
    '41. PH-SECRET-CONCURRENT',
    '42. PH-SECRET-MINE',
  ]))
})

test('the first read of a session already on a branch places that branch', async ($, on) => {
  const archive = archiveOf(600)
  const tip = archive[9]!
  const calls = installSupportedTarget(on, {
    store: {
      ...consentedStore(),
      [`prompt-history:branch:${projectId}:${runId}:${sessionId}`]: {
        version: 1,
        branchId,
        parentEventId: tip.eventId,
      },
    },
    archive,
  })

  await $.session.start(session)

  expect(reads(calls)[0]?.slice(-2)).toEqual([runId, tip.eventId])
})

test('100,000 events are browsed through a window that never holds or draws more than two batches', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(100_000) })
  await $.session.start(session)
  await promptHistory($)

  let drawn = band(await renderBand($, { maxRows: 12 }))
  for (let step = 0; step < 6; step += 1) {
    expect(band(await renderBand($, WHOLE)).prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
    await renderBand($, { maxRows: 12 })
    await scrollBand($, -200)
    drawn = band(await renderBand($, { maxRows: 12 }))
    expect(drawn.rows).toBeLessThanOrEqual(WINDOW_LIMIT + 2)
  }

  expect(drawn.labels.at(-1)).not.toBe('100000. PH-SECRET-OLD-100000')
  expect(reads(calls).length).toBeLessThanOrEqual(8)
})

test('a Run start names the Run that held its session before the window', async ($, on) => {
  const holder = entry(1, { runId: otherRunId, segmentId: sessionId })
  const filler = Array.from({ length: 200 }, (_, index) =>
    entry(index + 2, { segmentId: `f${String(index).padStart(7, '0')}-0000-4000-8000-000000000000` }))
  const split: ArchiveRow = {
    kind: 'run-started',
    eventId: 'a0000000-0000-4000-8000-00000000cafe',
    sequence: 202,
    runId: '77777777-0000-4000-8000-000000000000',
    segmentId: sessionId,
    branchId,
  }
  installSupportedTarget(on, { store: consentedStore(), archive: [holder, ...filler, split] })
  await $.session.start(session)

  await promptHistory($)
  const text = JSON.stringify(await renderBand($, WHOLE))

  expect(text).toContain(`从 Run ${otherRunId.slice(0, 8)} 分出`)
})

/* The view's derivations take what the archive says about rows outside the
   window. */

test('an entry whose parent in another Run lies outside the window still begins a new branch', () => {
  const rows = [
    { kind: 'prompt' as const, eventId: 'a1', sequence: 300, runId: 'run-a', parentEventId: 'a0' },
    { kind: 'prompt' as const, eventId: 'a2', sequence: 301, runId: 'run-a', parentEventId: 'x9' },
  ]
  expect([...branchStarts(rows, new Map([['x9', 'run-x']]))]).toEqual([['a2', 'cross-run']])
  expect([...branchStarts(rows)]).toEqual([])
  expect([...forkSources(rows, new Map([['a0', 'run-x']]))]).toEqual([['run-a', 'run-x']])
})

test('an entry at the window\'s top whose Run wrote an entry just before it still begins a new branch', () => {
  const rows = [
    { kind: 'prompt' as const, eventId: 'a5', sequence: 300, runId: 'run-a', parentEventId: 'x9' },
  ]
  const parents = new Map([['x9', 'run-x']])

  expect([...branchStarts(rows, parents, new Map([['run-a', 'prompt' as const]]))]).toEqual([['a5', 'cross-run']])
  /* Right after a boundary of its own Run, or with nothing of its Run before
     it, the boundary or the Run's start already says why it begins there. */
  expect([...branchStarts(rows, parents, new Map([['run-a', 'boundary' as const]]))]).toEqual([])
  expect([...branchStarts(rows, parents)]).toEqual([])
})

test('a branch the archive folded across the whole Run keeps its name and count in any window', () => {
  const rows = [
    { kind: 'prompt' as const, eventId: 'p1', sequence: 500, runId: 'run-a', parentEventId: 'p0' },
    { kind: 'prompt' as const, eventId: 'q7', sequence: 501, runId: 'run-a', parentEventId: 'q6' },
    { kind: 'prompt' as const, eventId: 'p2', sequence: 502, runId: 'run-a', parentEventId: 'p1' },
  ]

  const folds = foldTimeline(rows, 'run-a', 'tip-beyond', {
    eventIds: new Set(['p1', 'p2']),
    start: 12,
    branches: new Map([['q7', { fold: 'q1', count: 140 }]]),
  })

  expect([...folds.folded]).toEqual([['q7', 'q1']])
  expect([...folds.counts]).toEqual([['q1', 140]])
})

test('a branch crossing the window\'s edge is counted whole and stays one fold as the window moves', async ($, on) => {
  const mine = (sequence: number, parent: number | null) =>
    entry(sequence, { runId, parentEventId: parent === null ? null : entry(parent).eventId })
  /* A root, a stretch of 300 left behind by a rewind to it, then the path. */
  const archive = [
    mine(1, null),
    ...Array.from({ length: 300 }, (_, index) => mine(index + 2, index === 0 ? 1 : index + 1)),
    mine(302, 1),
    ...Array.from({ length: 98 }, (_, index) => mine(index + 303, index + 302)),
  ]
  const tip = archive.at(-1)!
  const fold = `prompt-history:fold:${entry(2).eventId}`
  const calls = installSupportedTarget(on, {
    store: {
      ...consentedStore(),
      [`prompt-history:branch:${projectId}:${runId}:${sessionId}`]: {
        version: 1,
        branchId,
        parentEventId: tip.eventId,
      },
    },
    archive,
    transcript: [],
  })
  await $.session.start(session)
  await promptHistory($)

  const latest = band(await renderBand($, WHOLE))
  expect(latest.text).toContain('另一分支 · 300 条')
  expect(latest.keys).toContain(fold)
  await $.ui.press({ plugin: 'prompt-history', key: fold, requestId: BAND_ID })
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -400)
  const earlier = band(await renderBand($, WHOLE))

  /* The batch before is in, read with where the path began and its entry
   below the window to walk from; the fold the same one and still open. */
  expect(reads(calls).find(argv => argv[0] === 'before')?.slice(-2)).toEqual(['1', entry(1).eventId])
  expect(earlier.keys.filter(key => key === fold)).toEqual([fold])
  expect(earlier.text).toContain('▾ 另一分支 · 300 条')
  expect(earlier.labels).toContain('150. PH-SECRET-OLD-150')
})

test('a path that begins and ends outside the window still folds what left it', () => {
  const rows = [
    { kind: 'prompt' as const, eventId: 'p1', sequence: 500, runId: 'run-a', parentEventId: 'p0' },
    { kind: 'prompt' as const, eventId: 'q1', sequence: 501, runId: 'run-a', parentEventId: 'p0' },
    { kind: 'prompt' as const, eventId: 'p2', sequence: 502, runId: 'run-a', parentEventId: 'p1' },
  ]
  /* The tip is newer than the window; only the archive knows p1 and p2 are on
     the path, and that the path began in this Run long before. */
  const folds = foldTimeline(rows, 'run-a', 'tip-beyond', {
    eventIds: new Set(['p1', 'p2']),
    start: 12,
  })

  expect([...folds.folded]).toEqual([['q1', 'q1']])
  expect([...folds.counts]).toEqual([['q1', 1]])
  expect(foldTimeline(rows, 'run-a', 'tip-beyond').counts.size).toBe(0)
})
