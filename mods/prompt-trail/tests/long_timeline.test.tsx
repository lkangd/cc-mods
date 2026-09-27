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

/* One lineage of `count` entries, one row each in the band. */
function archiveOf(count: number): ArchiveRow[] {
  return Array.from({ length: count }, (_, index) =>
    entry(index + 1, index === 0 ? { parentEventId: null } : { parentEventId: entry(index).eventId }))
}

type Band = { keys: string[]; prompts: string[]; labels: string[]; rows: number; text: string }

/* The keyed rows the band drew, in order; Prompt Entries by their labels,
   the title row's way up left out of them.
   A Text keeps no key in the drawn tree, so `rows` counts every row and
   `text` holds what they say. The archived entries here are none of this
   transcript's rows, so each is marked ×; a label leaves the mark out, which
   is Issue 22's to test. */
function band(tree: unknown): Band {
  const keys: string[] = []
  const labels: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown }
    if (typeof props?.key === 'string') {
      keys.push(props.key)
      if (typeof props.label === 'string' && props.key !== EARLIER_HINT) {
        labels.push(props.label.replace(/^× /, ''))
      }
    }
    walk(children)
  }
  walk(tree)
  const root = tree as { children?: unknown[] } | undefined
  return {
    keys,
    prompts: keys.filter(key => key.startsWith('prompt-trail:prompt:')),
    labels,
    rows: root?.children?.length ?? 0,
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
   while the band's tree is taller than it, a blank row standing for each row
   below the view; its window never leaves offset 0. */
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
/* The title row's button that takes the band up from its bottom, where the
   engine sends it no scrolling. */
const EARLIER_HINT = 'prompt-trail:earlier-hint'

test('the band opens on the latest batch and one earlier entry, numbered in the project', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)

  await promptHistory($)
  const whole = band(await renderBand($, WHOLE))

  expect(whole.prompts).toHaveLength(129)
  expect(whole.labels).toContain('472. PT-SECRET-OLD-472')
  expect(whole.labels).toContain('600. PT-SECRET-OLD-600')
  expect(reads(calls).every(argv => !argv.includes('before') && !argv.includes('after'))).toBe(true)
})

test('at the bottom the band fits whole under its title, with nothing counted below', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)

  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.keys[0]).toBe('prompt-trail:toggle')
  expect(drawn.rows).toBe(12)
  expect(drawn.prompts).toHaveLength(11)
  expect(drawn.labels.at(-1)).toBe('600. PT-SECRET-OLD-600')
})

test('away from the bottom a blank row stands for each row below the view', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  await scrollBand($, -20)
  const drawn = band(await renderBand($, { maxRows: 12 }))

  /* The engine's `n more` row takes the last of its `maxRows`: the title and
     ten rows show, and the 21 rows from 580 to 600 are what it counts. */
  expect(drawn.keys[0]).toBe('prompt-trail:toggle')
  expect(drawn.prompts).toHaveLength(10)
  expect(drawn.labels.at(-1)).toBe('579. PT-SECRET-OLD-579')
  expect(drawn.rows).toBe(1 + 10 + 21)
})

test('at the bottom with rows above, the title row says the trackpad needs the band moved first', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  expect(band(await renderBand($, { maxRows: 12 })).keys).toContain(EARLIER_HINT)

  await $.ui.press({ plugin: 'prompt-trail', key: EARLIER_HINT })
  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.rows).toBeGreaterThan(12)
  expect(drawn.labels.at(-1)).not.toBe('600. PT-SECRET-OLD-600')
  /* Away from the bottom the trackpad reaches the band, and the title row
     no longer says it does not. */
  expect(drawn.text).not.toContain('底部不响应触控板')
})

test('a band whose rows all fit draws no blank rows', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(5) })
  await $.session.start(session)
  await promptHistory($)

  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.rows).toBeLessThanOrEqual(12)
  expect(drawn.rows).toBe(drawn.keys.length)
  expect(drawn.keys).not.toContain(EARLIER_HINT)
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
  expect(drawn.labels[1]).toBe('472. PT-SECRET-OLD-472')
  expect(band(await renderBand($, WHOLE)).labels).toContain('343. PT-SECRET-OLD-343')
})

test('scrolling alone walks to the first event and back to the latest, never holding more than the window', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(1_000) })
  await $.session.start(session)
  await promptHistory($)

  let drawn = band(await renderBand($, { maxRows: 12 }))
  for (let step = 0; step < 40 && drawn.labels[1] !== '1. PT-SECRET-OLD-1'; step += 1) {
    await scrollBand($, -200)
    drawn = band(await renderBand($, { maxRows: 12 }))
  }
  expect(drawn.labels[1]).toBe('1. PT-SECRET-OLD-1')
  expect(band(await renderBand($, WHOLE)).prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  await renderBand($, { maxRows: 12 })
  const readsAtStart = reads(calls).length
  await scrollBand($, -1)
  expect(reads(calls)).toHaveLength(readsAtStart)

  for (let step = 0; step < 40 && drawn.labels.at(-1) !== '1000. PT-SECRET-OLD-1000'; step += 1) {
    await scrollBand($, 200)
    drawn = band(await renderBand($, { maxRows: 12 }))
  }
  expect(drawn.labels.at(-1)).toBe('1000. PT-SECRET-OLD-1000')
  expect(band(await renderBand($, WHOLE)).prompts.length).toBeLessThanOrEqual(WINDOW_LIMIT)
  expect(reads(calls).some(argv => argv[0] === 'after')).toBe(true)
  expect(JSON.stringify(drawn)).not.toMatch(/第 \d+ 页|page/i)
})

test('the engine\'s scroll keys move the view the same way', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })

  await scrollBand($, -11, 'keys')
  const drawn = band(await renderBand($, { maxRows: 12 }))

  expect(drawn.labels.at(-1)).toBe('588. PT-SECRET-OLD-588')
})

test('an arrow off the first row shown moves the view up one row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.labels[1]).toBe('585. PT-SECRET-OLD-585')
  await focusRow($, drawn.prompts[0]!)

  await scrollBand($, -1, 'keys')
  const moved = band(await renderBand($, { maxRows: 12 }))

  expect(moved.labels[1]).toBe('584. PT-SECRET-OLD-584')
})

/* At the bottom the tree fits, so the engine walks the ring itself and
   wraps it at both ends; the band takes the moves that leave the rows shown. */

test('at the bottom, the engine moving the ring off the first row onto the title moves the view up', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.labels[1]).toBe('590. PT-SECRET-OLD-590')
  await focusRow($, drawn.prompts[0]!)

  expect((await focusRow($, 'prompt-trail:toggle')).deny).toBeUndefined()
  const moved = band(await renderBand($, { maxRows: 12 }))

  expect(moved.labels[1]).toBe('589. PT-SECRET-OLD-589')
  expect(moved.rows).toBe(1 + 10 + 2)
})

test('at the bottom, the engine wrapping the ring from the title to the last row moves the view up', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  await focusRow($, 'prompt-trail:toggle')

  await focusRow($, drawn.prompts.at(-1)!)
  const moved = band(await renderBand($, { maxRows: 12 }))

  expect(moved.labels[1]).toBe('589. PT-SECRET-OLD-589')
})

test('at the bottom, the engine wrapping the ring from the last row to the title is refused', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  await focusRow($, drawn.prompts.at(-1)!)

  expect((await focusRow($, 'prompt-trail:toggle')).deny).toBeDefined()
  expect(band(await renderBand($, { maxRows: 12 })).labels.at(-1)).toBe('600. PT-SECRET-OLD-600')
})

test('an arrow off the last row shown moves the view down one row', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { maxRows: 12 })
  await scrollBand($, -5)
  const drawn = band(await renderBand($, { maxRows: 12 }))
  expect(drawn.labels.at(-1)).toBe('594. PT-SECRET-OLD-594')
  await focusRow($, drawn.prompts.at(-1)!)

  await scrollBand($, 1, 'keys')
  const moved = band(await renderBand($, { maxRows: 12 }))

  expect(moved.labels.at(-1)).toBe('595. PT-SECRET-OLD-595')
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
  await focusRow($, 'prompt-trail:toggle')

  await scrollBand($, -1, 'keys')

  expect(band(await renderBand($, { maxRows: 12 })).keys[1]).toBe(first)
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

  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  const latest = band(await renderBand($, { maxRows: 12 }))
  expect(latest.keys).not.toContain('prompt-trail:latest')
  expect(latest.labels.at(-1)).toBe('31. PT-SECRET-NEW')
})

test('the ring reaching the window\'s first row fetches the batch before it', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(600) })
  await $.session.start(session)
  await promptHistory($)
  const whole = band(await renderBand($, WHOLE))

  await focusRow($, whole.prompts[0]!)

  expect(reads(calls).at(-1)?.slice(0, 2)).toEqual(['before', '472'])
  expect(band(await renderBand($, WHOLE)).labels).toContain('343. PT-SECRET-OLD-343')
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

  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  const drawn = band(await renderBand($))

  expect(drawn.labels.at(-1)).toBe('41. PT-SECRET-NEW')
  expect(drawn.labels[0]).toBe('▾ Prompt Trail')
  expect(drawn.keys).not.toContain('prompt-trail:latest')
})

test('away from the bottom a new entry keeps the view and is counted until the band returns', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  const before = band(await renderBand($))

  await composerPrompt($, { text: 'PT-SECRET-NEW-1' })
  await composerPrompt($, { text: 'PT-SECRET-NEW-2' })
  let drawn = band(await renderBand($))

  expect(drawn.labels[0]).toBe('▾ Prompt Trail · 2 条新条目')
  expect(drawn.labels.at(-1)).toBe('↓ 2 条新条目')
  /* The same rows as before, the new-entry row taking the last line. */
  expect(drawn.prompts[0]).toBe(before.prompts[0])
  expect(drawn.labels).not.toContain('42. PT-SECRET-NEW-2')

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:latest' })
  drawn = band(await renderBand($))

  expect(drawn.labels[0]).toBe('▾ Prompt Trail')
  expect(drawn.labels.at(-1)).toBe('42. PT-SECRET-NEW-2')
  expect(drawn.keys).not.toContain('prompt-trail:latest')
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
  expect(band(await renderBand($)).labels[1]).toBe('1. PT-SECRET-OLD-1')

  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  const drawn = band(await renderBand($))

  expect(drawn.labels[1]).toBe('1. PT-SECRET-OLD-1')
  expect(drawn.labels[0]).toBe('▾ Prompt Trail · 1 条新条目')
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
  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  expect(band(await renderBand($)).labels).toContain('↓ 1 条新条目')

  target.readFails = true
  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:latest' })

  expect(band(await renderBand($)).labels).toContain('↓ 1 条新条目')
})

test('scrolling back to the bottom clears the count', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  await renderBand($)
  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  expect(band(await renderBand($)).labels).toContain('↓ 1 条新条目')

  await scrollBand($, 100)
  const drawn = band(await renderBand($))

  expect(drawn.keys).not.toContain('prompt-trail:latest')
  expect(drawn.labels[0]).toBe('▾ Prompt Trail')
  expect(drawn.labels.at(-1)).toBe('41. PT-SECRET-NEW')
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
  expect(band(await renderBand($, WHOLE)).labels).not.toContain('1000. PT-SECRET-OLD-1000')

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })
  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })
  const drawn = band(await renderBand($))

  expect(drawn.labels.at(-1)).toBe('1000. PT-SECRET-OLD-1000')
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
  await renderBand($)
  await scrollBand($, -10)
  await renderBand($)

  archive.push(entry(41, { text: 'PT-SECRET-CONCURRENT' }))
  await composerPrompt($, { text: 'PT-SECRET-MINE' })
  const drawn = band(await renderBand($, WHOLE))

  expect(drawn.labels).toContain('↓ 1 条新条目')
  expect(drawn.labels).not.toContain('42. PT-SECRET-MINE')

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:latest' })
  const latest = band(await renderBand($))
  expect(latest.labels).toEqual(expect.arrayContaining([
    '41. PT-SECRET-CONCURRENT',
    '42. PT-SECRET-MINE',
  ]))
})

test('the first read of a session already on a branch places that branch', async ($, on) => {
  const archive = archiveOf(600)
  const tip = archive[9]!
  const calls = installSupportedTarget(on, {
    store: {
      ...consentedStore(),
      [`prompt-trail:branch:${projectId}:${runId}:${sessionId}`]: {
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

  expect(drawn.labels.at(-1)).not.toBe('100000. PT-SECRET-OLD-100000')
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
