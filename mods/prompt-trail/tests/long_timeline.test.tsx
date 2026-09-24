import { expect, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import { TITLE_KEY, arrowStep } from '../hooks/band'
import { branchStarts, foldTimeline, forkSources } from '../hooks/branch'
import type { ArchiveRow, ProcessCall } from './support'
import {
  BAND_ID,
  composerPrompt,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
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
/* The engine clamps an offset past the end: the window at the band's bottom. */
const BOTTOM = 10_000

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' } }
}

function entry(sequence: number, fields: Partial<ArchiveRow> = {}): ArchiveRow {
  return {
    kind: 'prompt',
    eventId: `e${String(sequence).padStart(7, '0')}-0000-4000-8000-000000000000`,
    sequence,
    runId: otherRunId,
    segmentId: otherSessionId,
    branchId,
    text: `PT-SECRET-OLD-${sequence}`,
    attachmentCount: 0,
    ...fields,
  }
}

function archiveOf(count: number): ArchiveRow[] {
  return Array.from({ length: count }, (_, index) => entry(index + 1))
}

type Band = { keys: string[]; prompts: string[]; labels: string[] }

/* The keyed rows the band drew, in order; Prompt Entries by their labels. */
function band(tree: unknown): Band {
  const keys: string[] = []
  const labels: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown }
    if (typeof props?.key === 'string') {
      keys.push(props.key)
      if (typeof props.label === 'string') labels.push(props.label)
    }
    walk(children)
  }
  walk(tree)
  return {
    keys,
    prompts: keys.filter(key => key.startsWith('prompt-trail:prompt:')),
    labels,
  }
}

function reads(calls: readonly ProcessCall[]): string[][] {
  return calls
    .filter(call => call.argv[1] === 'timeline-read')
    .map(call => call.argv.slice(6))
}

/* The person's arrow keys landing the band's focus ring on one row. */
function focusRow($: Engine, key: string) {
  return $.ui.focus({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    element: key,
    origin: { kind: 'person' },
  })
}

test('the band opens on the latest batch and one earlier entry, numbered in the project', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)

  await promptHistory($)
  const drawn = band(await renderBand($))

  expect(drawn.prompts).toHaveLength(129)
  expect(drawn.labels).toContain('472. PT-SECRET-OLD-472')
  expect(drawn.labels).toContain('600. PT-SECRET-OLD-600')
  expect(reads(calls).every(argv => !argv.includes('before') && !argv.includes('after'))).toBe(true)
})

test('arrowing onto the earliest row loads the batch before it and keeps that row', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const first = band(await renderBand($)).prompts[0]!

  await focusRow($, first)
  const drawn = band(await renderBand($))

  expect(reads(calls).at(-1)?.slice(0, 2)).toEqual(['before', '472'])
  expect(drawn.prompts).toContain(first)
  expect(drawn.labels).toContain('343. PT-SECRET-OLD-343')
  expect(drawn.prompts.indexOf(first)).toBe(129)
})

test('arrowing alone walks to the first event and back to the latest, never holding more than the window', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(1_000) })
  await $.session.start(session)
  await promptHistory($)

  let drawn = band(await renderBand($))
  for (let step = 0; step < 20 && !drawn.labels.includes('1. PT-SECRET-OLD-1'); step += 1) {
    await focusRow($, drawn.prompts[0]!)
    drawn = band(await renderBand($))
    expect(drawn.prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  }
  expect(drawn.labels).toContain('1. PT-SECRET-OLD-1')
  const readsAtStart = reads(calls).length
  /* The first event: nothing earlier to read. */
  await focusRow($, drawn.prompts[0]!)
  expect(reads(calls)).toHaveLength(readsAtStart)

  for (let step = 0; step < 20 && !drawn.labels.includes('1000. PT-SECRET-OLD-1000'); step += 1) {
    await focusRow($, drawn.prompts.at(-1)!)
    drawn = band(await renderBand($))
    expect(drawn.prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  }
  expect(drawn.labels).toContain('1000. PT-SECRET-OLD-1000')
  expect(reads(calls).some(argv => argv[0] === 'after')).toBe(true)
  /* No page is ever named. */
  expect(JSON.stringify(drawn)).not.toMatch(/第 \d+ 页|page/i)
})

/* The person's arrows, wheel or trackpad moving the band's window by `by`
   rows, as the engine clamps it to the tree. */
function scrollBand(
  $: Engine,
  by: number,
  at: { offset: number; contentRows: number },
  input: 'wheel' | 'keys' = 'wheel',
) {
  const bodyRows = 11
  return $.ui.scroll({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    offset: Math.min(Math.max(at.offset + by, 0), Math.max(at.contentRows - bodyRows, 0)),
    by,
    bodyRows,
    contentRows: at.contentRows,
    origin: { kind: 'person' },
    /* The wheel and the trackpad say where the pointer was; the keys do not. */
    ...(input === 'wheel' ? { pointer: { column: 4, row: 2 } } : {}),
  })
}

test('scrolling past the top of the window loads the batch before it', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { offset: BOTTOM })

  await scrollBand($, -3, { offset: 5, contentRows: 131 })
  expect(reads(calls).at(-1)).not.toContain('before')
  await scrollBand($, -1, { offset: 0, contentRows: 131 })
  const drawn = band(await renderBand($, { offset: 0 }))

  expect(reads(calls).at(-1)?.slice(0, 2)).toEqual(['before', '472'])
  expect(drawn.labels).toContain('343. PT-SECRET-OLD-343')
})

test('scrolling alone walks to the first event and back to the latest, never holding more than the window', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(1_000) })
  await $.session.start(session)
  await promptHistory($)

  let drawn = band(await renderBand($, { offset: BOTTOM }))
  for (let step = 0; step < 20 && !drawn.labels.includes('1. PT-SECRET-OLD-1'); step += 1) {
    await scrollBand($, -1, { offset: 0, contentRows: drawn.keys.length })
    drawn = band(await renderBand($, { offset: 0 }))
    expect(drawn.prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  }
  expect(drawn.labels).toContain('1. PT-SECRET-OLD-1')
  const readsAtStart = reads(calls).length
  await scrollBand($, -1, { offset: 0, contentRows: drawn.keys.length })
  expect(reads(calls)).toHaveLength(readsAtStart)

  for (let step = 0; step < 20 && !drawn.labels.includes('1000. PT-SECRET-OLD-1000'); step += 1) {
    const contentRows = drawn.keys.length
    await scrollBand($, 1, { offset: contentRows, contentRows })
    drawn = band(await renderBand($, { offset: BOTTOM }))
    expect(drawn.prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  }
  expect(drawn.labels).toContain('1000. PT-SECRET-OLD-1000')
  expect(reads(calls).some(argv => argv[0] === 'after')).toBe(true)
})

/* On the terminal the arrow keys scroll a band taller than its rows. Over
   the band's entries they walk the focus instead, one entry at a time. */

test('an arrow walks the focus to the neighbouring entry', () => {
  const stops = ['a', 'b', 'c']
  expect(arrowStep(stops, 'b', -1, true)).toBe('a')
  expect(arrowStep(stops, 'b', 1, true)).toBe('c')
})

test('an arrow at an end of the window waits for the batch beyond it', () => {
  expect(arrowStep(['a', 'b'], 'a', -1, true)).toBeUndefined()
  expect(arrowStep(['a', 'b'], 'b', 1, false)).toBeUndefined()
})

test('an arrow from the first event of the project leaves the entries for the title', () => {
  expect(arrowStep(['a', 'b'], 'a', -1, false)).toBe(TITLE_KEY)
})

test('an arrow down from the title comes back to the first entry', () => {
  expect(arrowStep(['a', 'b'], TITLE_KEY, 1, false)).toBe('a')
  expect(arrowStep(['a', 'b'], TITLE_KEY, -1, false)).toBeUndefined()
})

test('a ring off the band\'s rows is not the band\'s to walk', () => {
  expect(arrowStep(['a', 'b'], 'prompt-trail:latest', -1, false)).toBeUndefined()
  expect(arrowStep(['a', 'b'], undefined, -1, false)).toBeUndefined()
})

test('the wheel moves the window and leaves the focus where it was', async ($, on) => {
  const focuses: { element?: string; origin: { kind: string } }[] = []
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40), focuses })
  await $.session.start(session)
  await promptHistory($)
  const drawn = band(await renderBand($, { offset: BOTTOM }))
  await focusRow($, drawn.prompts.at(-1)!)
  focuses.length = 0

  await scrollBand($, -1, { offset: 30, contentRows: 41 }, 'wheel')

  expect(focuses).toEqual([])
})

test('a focus the engine moves on its own loads nothing', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const first = band(await renderBand($)).prompts[0]!
  const before = reads(calls).length

  await $.ui.focus({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    element: first,
    origin: { kind: 'plugin', name: 'another' },
  })

  expect(reads(calls)).toHaveLength(before)
})

test('at the bottom a new entry is drawn and nothing is counted', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { offset: BOTTOM })

  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  const drawn = band(await renderBand($, { offset: BOTTOM }))

  expect(drawn.labels).toContain('41. PT-SECRET-NEW')
  expect(drawn.labels).toContain('▾ Prompt Trail')
  expect(drawn.keys).not.toContain('prompt-trail:latest')
})

test('away from the bottom a new entry keeps the view and is counted until the band returns', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { offset: BOTTOM })
  /* The person scrolls the window up to the top of the band. */
  await renderBand($, { offset: 0 })

  await composerPrompt($, { text: 'PT-SECRET-NEW-1' })
  await composerPrompt($, { text: 'PT-SECRET-NEW-2' })
  let drawn = band(await renderBand($, { offset: 0 }))

  expect(drawn.labels).toContain('▾ Prompt Trail · 2 条新条目')
  expect(drawn.labels).toContain('↓ 2 条新条目')
  expect(drawn.labels).toContain('42. PT-SECRET-NEW-2')
  /* Drawn below what the window shows, so the view does not move. */
  expect(drawn.prompts.indexOf(drawn.prompts.find(key => key.includes('0000040'))!))
    .toBeLessThan(drawn.prompts.length - 1)

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:latest' })
  drawn = band(await renderBand($, { offset: 0 }))

  expect(drawn.labels).toContain('▾ Prompt Trail')
  expect(drawn.keys).not.toContain('prompt-trail:latest')
})

test('scrolling back to the bottom clears the count', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { offset: BOTTOM })
  await renderBand($, { offset: 0 })
  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  expect(band(await renderBand($, { offset: 0 })).labels).toContain('↓ 1 条新条目')

  await renderBand($, { offset: BOTTOM })
  const drawn = band(await renderBand($, { offset: BOTTOM }))

  expect(drawn.keys).not.toContain('prompt-trail:latest')
  expect(drawn.labels).toContain('▾ Prompt Trail')
})

test('opening the band again returns it to the latest batch', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(1_000) })
  await $.session.start(session)
  await promptHistory($)
  let drawn = band(await renderBand($))
  for (let step = 0; step < 3; step += 1) {
    await focusRow($, drawn.prompts[0]!)
    drawn = band(await renderBand($))
  }
  expect(drawn.labels).not.toContain('1000. PT-SECRET-OLD-1000')

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })
  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })
  drawn = band(await renderBand($))

  expect(drawn.labels).toContain('1000. PT-SECRET-OLD-1000')
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
  archive.push(entry(4, { text: 'PT-SECRET-CONCURRENT' }))
  await composerPrompt($, { text: 'PT-SECRET-MINE' })
  await clock!.settle()
  const drawn = band(await renderBand($))

  expect(drawn.labels).toEqual(expect.arrayContaining([
    '4. PT-SECRET-CONCURRENT',
    '5. PT-SECRET-MINE',
  ]))
})

test('away from the bottom, a gap leaves the window and counts the entry', async ($, on) => {
  const archive = archiveOf(40)
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { offset: BOTTOM })
  await renderBand($, { offset: 0 })

  archive.push(entry(41, { text: 'PT-SECRET-CONCURRENT' }))
  await composerPrompt($, { text: 'PT-SECRET-MINE' })
  const drawn = band(await renderBand($, { offset: 0 }))

  expect(drawn.labels).toContain('↓ 1 条新条目')
  expect(drawn.labels).not.toContain('42. PT-SECRET-MINE')

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:latest' })
  const latest = band(await renderBand($, { offset: BOTTOM }))
  expect(latest.labels).toEqual(expect.arrayContaining([
    '41. PT-SECRET-CONCURRENT',
    '42. PT-SECRET-MINE',
  ]))
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
  const text = JSON.stringify(await renderBand($))

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
