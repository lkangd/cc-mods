import { expect } from 'claude-code/testing'
import { test } from './support'
import type { Engine, MockClock } from 'claude-code/testing'
import type { BranchState } from '../hooks/branch'
import { alignmentInput, jumpOutcome, jumpTargets, recordRow, vanishedRows } from '../hooks/jump'
import type { DrawnRow } from '../hooks/jump'
import type { ArchiveRow, ProcessCall, TargetOptions, TranscriptRow } from './support'
import {
  BAND_ID,
  captureCalls,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

/* Issue 22: a Prompt Entry the current transcript still draws can be jumped
   back to. The drawn rows are tied to entries by the helper's alignment of
   the lineage, never by looking for the nearest row with the same text. */

test('a drawn row is kept once, where it was first drawn', () => {
  const rows: DrawnRow[] = []
  const seen = new Set<string>()
  expect(recordRow(rows, seen, 'r1', 'PT-SECRET-A')).toBe(true)
  expect(recordRow(rows, seen, 'r2', 'PT-SECRET-A')).toBe(true)
  /* A redraw of the first row, as a resize or a scroll brings. */
  expect(recordRow(rows, seen, 'r1', 'PT-SECRET-A')).toBe(false)
  expect(rows).toEqual([
    { requestId: 'r1', text: 'PT-SECRET-A' },
    { requestId: 'r2', text: 'PT-SECRET-A' },
  ])
})

test('a row the transcript lost is not kept when the engine draws it again', () => {
  const rows: DrawnRow[] = []
  expect(recordRow(rows, new Set(['r1']), 'r1', 'PT-SECRET-A')).toBe(false)
  expect(rows).toEqual([])
})

test('rows a rewind removed are the drawn rows past the last one the transcript holds', () => {
  const rows = [
    { requestId: 'r1', text: 'PT-SECRET-A' },
    { requestId: 'r2', text: 'PT-SECRET-A' },
    { requestId: 'r3', text: 'PT-SECRET-B' },
  ]
  expect(vanishedRows(rows, ['PT-SECRET-A', 'task notification', 'PT-SECRET-A'])).toEqual(['r3'])
  expect(vanishedRows(rows, ['PT-SECRET-A', 'PT-SECRET-A', 'PT-SECRET-B', 'PT-SECRET-C'])).toEqual([])
  /* A clear leaves the transcript empty. */
  expect(vanishedRows(rows, [])).toEqual(['r1', 'r2', 'r3'])
})

test('a row whose drawing differs from the transcript is not taken for removed while later rows are held', () => {
  const rows = [
    { requestId: 'r1', text: 'PT-SECRET-A' },
    { requestId: 'r2', text: '[Pasted text #1]' },
    { requestId: 'r3', text: 'PT-SECRET-B' },
  ]
  expect(vanishedRows(rows, ['PT-SECRET-A', 'PT-SECRET-PASTED', 'PT-SECRET-B'])).toEqual([])
})

test('the drawn rows go to the helper oldest first, each with its byte length', () => {
  const input = alignmentInput([
    { requestId: 'r1', text: 'PT-SECRET-A' },
    { requestId: 'r2', text: '多行\nPT' },
  ])
  expect(input).toEqual({
    stdin: '11\nPT-SECRET-A9\n多行\nPT',
    truncated: false,
    indices: [0, 1],
  })
})

test('past the helper\'s row limit only the newest rows go, marked truncated', () => {
  const rows = Array.from({ length: 4100 }, (_, index) => ({ requestId: `r${index}`, text: 'x' }))
  const input = alignmentInput(rows)
  expect(input.truncated).toBe(true)
  expect(input.indices.length).toBe(4096)
  expect(input.indices[0]).toBe(4)
  expect(input.indices.at(-1)).toBe(4099)
})

test('a row too long to have been archived is left out and never tied', () => {
  const long = 'x'.repeat(1024 * 1024)
  const input = alignmentInput([
    { requestId: 'r1', text: 'PT-SECRET-A' },
    { requestId: 'r2', text: long },
    { requestId: 'r3', text: 'PT-SECRET-B' },
  ])
  expect(input.stdin).toBe('11\nPT-SECRET-A11\nPT-SECRET-B')
  expect(input.indices).toEqual([0, 2])
  expect(input.truncated).toBe(false)
})

test('the helper\'s rows name drawn rows by where they went on stdin', () => {
  const rows = [
    { requestId: 'r1', text: 'PT-SECRET-A' },
    { requestId: 'r2', text: 'x'.repeat(1024 * 1024) },
    { requestId: 'r3', text: 'PT-SECRET-B' },
  ]
  const { indices } = alignmentInput(rows)
  const targets = jumpTargets(rows, indices, [
    { row: 0, eventId: 'e-a' },
    { row: 1, eventId: 'e-b' },
  ])
  expect([...targets]).toEqual([['e-a', 'r1'], ['e-b', 'r3']])
})

test('a row the engine refused to scroll to is never a target again', () => {
  const rows = [{ requestId: 'r1', text: 'PT-SECRET-A' }]
  const targets = jumpTargets(rows, [0], [{ row: 0, eventId: 'e-a' }], new Set(['r1']))
  expect(targets.size).toBe(0)
})

test('a jump the engine made collapses, one it refused goes stale, a failure changes nothing', () => {
  expect(jumpOutcome({})).toBe('collapse')
  expect(jumpOutcome({ deny: 'no such row' })).toBe('stale')
  expect(jumpOutcome(undefined)).toBe('keep')
})

/* The same, carried out by the hooks. */

const branchId = 'dddddddd-eeee-4fff-8000-222222222222'
const first = 'f1111111-0000-4000-8000-000000000000'
const second = 'f2222222-0000-4000-8000-000000000000'
const third = 'f3333333-0000-4000-8000-000000000000'

function entry(eventId: string, sequence: number, text: string, parentEventId: string | null): ArchiveRow {
  return { kind: 'prompt', eventId, sequence, runId, segmentId: sessionId, branchId, parentEventId, text }
}

/* Three entries of this session, one lineage; the transcript draws them. */
function lineage(): ArchiveRow[] {
  return [
    entry(first, 1, 'PT-SECRET-ONE', null),
    entry(second, 2, 'PT-SECRET-TWO', first),
    entry(third, 3, 'PT-SECRET-TWO', second),
  ]
}

function storeOn(tip: string | null): Record<string, unknown> {
  const branch: BranchState = { version: 1, branchId, parentEventId: tip }
  return {
    [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' },
    [`prompt-trail:branch:${projectId}:${runId}:${sessionId}`]: branch,
  }
}

/* The transcript holding the person's rows. */
function holding(...texts: string[]): TranscriptRow[] {
  return texts.map(text => ({ role: 'user', text }))
}

/* What `branch-match --rows` answers: the lineage ending at `tip`, and the
   rows the entries took. */
function aligned(tip: string, rows: { row: number; eventId: string }[]) {
  return { match: 'unique', eventId: tip, candidates: [], candidateCount: 1, rows }
}

function install(on: Parameters<typeof installSupportedTarget>[0], options: TargetOptions) {
  let clock: MockClock | undefined
  /* The options stay live: a test may change them part-way through. */
  options.onClock = mocked => { clock = mocked }
  const calls = installSupportedTarget(on, options)
  /* The engine's own drawing of a transcript row, beneath the plugin. */
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  return { calls, settle: () => clock!.settle(), advance: (ms: number) => clock!.advance(ms) }
}

/* The transcript drawing one of the person's rows. */
function drawRow($: Engine, requestId: string, text: string, origin: { kind: string } = { kind: 'composer' }) {
  return $.ui.render({
    component: 'UserMessage',
    surface: 'terminal',
    requestId,
    viewport: { columns: 80, rows: 24 },
    props: { text, origin: origin as { kind: 'composer' }, isExpanded: false },
  })
}

/* Each Prompt Entry's label in the band, in order. */
function entryLabels(tree: unknown): string[] {
  const labels: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown }
    if (typeof props?.key === 'string' && props.key.startsWith('prompt-trail:prompt:')) {
      labels.push(String(props.label))
    }
    walk(children)
  }
  walk(tree)
  return labels
}

function alignCalls(calls: readonly ProcessCall[]): ProcessCall[] {
  return captureCalls(calls, 'branch-match').filter(call => call.argv.includes('--rows'))
}

test('replayed rows the helper places become jump targets; the rest are marked ×', async ($, on) => {
  const { calls, settle } = install(on, {
    store: storeOn(third),
    archive: lineage(),
    messages: holding('PT-SECRET-ONE', 'PT-SECRET-TWO', 'PT-SECRET-TWO'),
    branchMatch: aligned(third, [{ row: 0, eventId: first }, { row: 2, eventId: third }]),
  })
  /* A reload replays the transcript before the session starts. */
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await drawRow($, 'row-3', 'PT-SECRET-TWO')
  await $.session.start(session)
  await settle()
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
    '3. PT-SECRET-TWO',
  ])
  const [call] = alignCalls(calls)
  expect(call?.stdin).toBe('13\nPT-SECRET-ONE13\nPT-SECRET-TWO13\nPT-SECRET-TWO')
  /* Matched the way the session's own branch is: inside its stretch of the
     Run, preferring the entry it is on. */
  expect(call?.argv.slice(4, 8)).toEqual([runId, sessionId, 'whole', third])
})

test('a fork of a compacted session ties its shared history before it submits anything', async ($, on) => {
  const store: Record<string, unknown> = {
    [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' },
  }
  const { calls, settle } = install(on, {
    store,
    archive: lineage(),
    messages: holding(
      'This session is being continued from a previous conversation that ran out of context. PT-SECRET-SUMMARY',
      'PT-SECRET-TWO',
    ),
    branchMatch: aligned(third, [{ row: 0, eventId: third }]),
  })
  await drawRow($, 'row-3', 'PT-SECRET-TWO')
  await $.session.start(session)
  await settle()
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '× 1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
    '3. PT-SECRET-TWO',
  ])
  /* Its earliest rows went with the compaction, so the lineage it shows may
     begin before them. */
  expect(alignCalls(calls)[0]?.argv[6]).toBe('truncated')
  expect(store[`prompt-trail:compacted:${projectId}:${sessionId}`]).toBe(true)
})

test('previews, notifications and rows drawn twice never reach the alignment', async ($, on) => {
  const { calls, settle } = install(on, {
    store: storeOn(first),
    archive: lineage().slice(0, 1),
    messages: holding('PT-SECRET-ONE', 'PT-SECRET-ONE'),
    branchMatch: aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'placeholder', 'PT-SECRET-ONE')
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-n', 'PT-SECRET-ONE', { kind: 'task-notification' })
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()

  expect(alignCalls(calls).map(call => call.stdin)).toEqual(['13\nPT-SECRET-ONE'])
})

test('a new session that draws none of the archived rows marks every entry ×', async ($, on) => {
  const { calls, settle } = install(on, {
    store: storeOn(null),
    archive: lineage(),
    branchMatch: aligned(third, [{ row: 0, eventId: third }]),
  })
  await $.session.start(session)
  await settle()
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '× 1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
    '× 3. PT-SECRET-TWO',
  ])
  expect(alignCalls(calls)).toHaveLength(0)
})

/* A stand-in for the helper's alignment over this session's archived
   entries, enough for a lineage without gaps: each row takes the next entry
   whose text it holds. */
function alignArchive(archive: readonly ArchiveRow[]) {
  return (call: ProcessCall) => {
    const texts: string[] = []
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const bytes = encoder.encode(call.stdin ?? '')
    let at = 0
    while (at < bytes.length) {
      const newline = bytes.indexOf(10, at)
      const length = Number(decoder.decode(bytes.slice(at, newline)))
      texts.push(decoder.decode(bytes.slice(newline + 1, newline + 1 + length)))
      at = newline + 1 + length
    }
    const entries = archive.filter(row => row.kind === 'prompt')
    const rows: { row: number; eventId: string }[] = []
    let next = 0
    texts.forEach((text, row) => {
      if (entries[next]?.text === text) rows.push({ row, eventId: entries[next++]!.eventId })
    })
    const tip = rows.at(-1)?.eventId
    return tip
      ? aligned(tip, rows)
      : { match: 'none', candidates: [], candidateCount: 0, rows: [] }
  }
}

test('a prompt drawn before its capture lands is tied once the capture lands', async ($, on) => {
  const archive: ArchiveRow[] = []
  let settleNow: (() => Promise<void>) | undefined
  const { settle } = install(on, {
    store: storeOn(null),
    archive,
    /* The engine stores the row before it draws it. */
    messages: holding('PT-SECRET-LIVE'),
    branchMatch: call => call.argv.includes('--rows')
      ? alignArchive(archive)(call)
      : { match: 'none', candidates: [], candidateCount: 0 },
    /* The engine draws the submitted row while the capture is still being
       confirmed, and the alignment runs before the archive holds it. */
    duringSubmit: async () => {
      await drawRow($, 'row-1', 'PT-SECRET-LIVE')
      await settleNow!()
    },
  })
  settleNow = settle
  await $.session.start(session)
  await promptHistory($)
  await $.prompt.submit({ text: 'PT-SECRET-LIVE', wait: false, origin: { kind: 'composer' } })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PT-SECRET-LIVE'])
})

test('an alignment that fails keeps the targets already proven', async ($, on) => {
  const options: TargetOptions = {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    messages: holding('PT-SECRET-ONE', 'PT-SECRET-TWO', 'PT-SECRET-OTHER'),
    branchMatch: aligned(second, [{ row: 0, eventId: first }, { row: 1, eventId: second }]),
  }
  const { settle } = install(on, options)
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await settle()
  options.branchMatchFails = true
  await drawRow($, 'row-3', 'PT-SECRET-OTHER')
  await settle()
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '2. PT-SECRET-TWO',
  ])
})

test('activating an entry marked × does nothing, and the band stays open', async ($, on) => {
  const { settle } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    messages: holding('PT-SECRET-ONE', 'PT-SECRET-TWO'),
    branchMatch: aligned(second, [{ row: 1, eventId: second }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await settle()
  await promptHistory($)
  await renderBand($, { maxRows: 40 })

  await $.ui.press({ plugin: 'prompt-trail', key: `prompt-trail:prompt:${first}`, requestId: BAND_ID })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '× 1. PT-SECRET-ONE',
    '2. PT-SECRET-TWO',
  ])
})

test('a jump the engine could not carry out keeps the entry and the band as they were', async ($, on) => {
  const { settle } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    messages: holding('PT-SECRET-ONE', 'PT-SECRET-TWO'),
    branchMatch: aligned(second, [{ row: 1, eventId: second }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await settle()
  await promptHistory($)
  await renderBand($, { maxRows: 40 })

  /* The test engine has no transcript to scroll: the call fails rather than
     being refused, which proves nothing about the row. Where a jump lands,
     and the fold after it, is the terminal acceptance's. */
  await $.ui.press({ plugin: 'prompt-trail', key: `prompt-trail:prompt:${second}`, requestId: BAND_ID })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '× 1. PT-SECRET-ONE',
    '2. PT-SECRET-TWO',
  ])
})

test('rows a rewind removed are marked × as soon as the band opens', async ($, on) => {
  const transcript = holding('PT-SECRET-ONE', 'PT-SECRET-TWO')
  const { calls, settle } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    transcript,
    branchMatch: call => call.stdin?.includes('PT-SECRET-TWO')
      ? aligned(second, [{ row: 0, eventId: first }, { row: 1, eventId: second }])
      : aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await settle()

  /* Rewound to the first prompt; the engine says nothing of it. */
  transcript.splice(1)
  await promptHistory($)
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
  ])
  expect(alignCalls(calls).at(-1)?.stdin).toBe('13\nPT-SECRET-ONE')
})

test('a row the engine draws again after a clear is never tied', async ($, on) => {
  const transcript = holding('PT-SECRET-ONE')
  const { settle } = install(on, {
    store: storeOn(first),
    archive: lineage().slice(0, 1),
    transcript,
    branchMatch: aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()

  /* The clear empties the transcript, and the engine draws the old row once
     more on its way out. */
  transcript.splice(0)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await promptHistory($)
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['× 1. PT-SECRET-ONE'])
})

test('rows a rewind removed while the band is open are marked × on its next drawing', async ($, on) => {
  const transcript = holding('PT-SECRET-ONE', 'PT-SECRET-TWO')
  const { settle, advance } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    transcript,
    branchMatch: call => call.stdin?.includes('PT-SECRET-TWO')
      ? aligned(second, [{ row: 0, eventId: first }, { row: 1, eventId: second }])
      : aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await promptHistory($)
  await settle()
  await renderBand($, { maxRows: 40 })

  /* Rewound with the band open; the engine only draws the band again. */
  transcript.splice(1)
  await renderBand($, { maxRows: 40 })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
  ])
})

test('a rewind with the band open is found when the engine puts the old prompt back in the prompt box', async ($, on) => {
  const transcript = holding('PT-SECRET-ONE', 'PT-SECRET-TWO')
  const { settle, advance } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    transcript,
    branchMatch: call => call.stdin?.includes('PT-SECRET-TWO')
      ? aligned(second, [{ row: 0, eventId: first }, { row: 1, eventId: second }])
      : aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await promptHistory($)
  await settle()
  await renderBand($, { maxRows: 40 })
  await advance(500)

  /* A rewind draws nothing but the hint line under the refilled prompt. */
  transcript.splice(1)
  await $.ui.render({
    component: 'PromptHint',
    surface: 'terminal',
    requestId: 'prompt-hint',
    viewport: { columns: 80, rows: 24 },
    props: { isDraft: true, isWorking: false, hint: '' },
  })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
  ])
})

test('a transcript cut short just after the drawing that asked is found by the follow-up', async ($, on) => {
  const transcript = holding('PT-SECRET-ONE', 'PT-SECRET-TWO')
  const { settle, advance } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    transcript,
    branchMatch: call => call.stdin?.includes('PT-SECRET-TWO')
      ? aligned(second, [{ row: 0, eventId: first }, { row: 1, eventId: second }])
      : aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await promptHistory($)
  await settle()
  await renderBand($, { maxRows: 40 })
  await advance(500)

  /* The band is drawn while the transcript still holds both rows, and loses
     one a moment later with nothing drawn after. */
  await renderBand($, { maxRows: 40 })
  await settle()
  transcript.splice(1)
  await advance(500)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '× 2. PT-SECRET-TWO',
  ])
})

test('an explicitly rooted session ties rows among its own entries first', async ($, on) => {
  const branch: BranchState = { version: 1, branchId, parentEventId: null, explicitRoot: true }
  const { calls, settle } = install(on, {
    store: { ...storeOn(null), [`prompt-trail:branch:${projectId}:${runId}:${sessionId}`]: branch },
    archive: lineage().slice(0, 1),
    messages: holding('PT-SECRET-ONE'),
    branchMatch: aligned(first, [{ row: 0, eventId: first }]),
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()

  expect(alignCalls(calls)[0]?.argv.slice(4, 8)).toEqual([runId, sessionId, 'whole', '-'])
})

test('a branch the transcript rebuilds is aligned again even when the submission goes nowhere', async ($, on) => {
  const { calls, settle } = install(on, {
    store: storeOn(first),
    archive: lineage(),
    messages: holding('PT-SECRET-ONE', 'PT-SECRET-TWO', 'PT-SECRET-TWO'),
    branchMatch: call => call.argv.includes('--rows')
      ? aligned(third, [{ row: 2, eventId: third }])
      : { match: 'unique', eventId: third, candidates: [], candidateCount: 1 },
    dropBeneath: 'PT-SECRET-DROPPED',
  })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()
  expect(alignCalls(calls).at(-1)?.argv[7]).toBe(first)

  /* The first submission settles the branch on the transcript's tip; the
     engine beneath drops it, so nothing is captured. */
  await $.prompt.submit({ text: 'PT-SECRET-NEXT', wait: false, origin: { kind: 'composer' } })
  await settle()

  expect(alignCalls(calls).at(-1)?.argv[7]).toBe(third)
})

/* Issue 43: an in-process `/resume` back into a session this process already
   drew replays its rows under the requestIds they had. Drawn once the new
   session has started, they are its transcript again, not the old one drawn
   on its way out, and go to the helper with the rows after them: it ties an
   entry only where some row holds each of its ancestors. */
test('rows replayed by an in-process resume back into a drawn session are tied again', async ($, on) => {
  const classic = $.classic
  const elsewhere = '66666666-7777-4888-8999-aaaaaaaaaaaa'
  const classicSession = { id: sessionId }
  const transcript = holding('PT-SECRET-ONE')
  const { calls, settle } = install(on, {
    store: storeOn(second),
    archive: lineage().slice(0, 2),
    classicSession,
    transcript,
    /* As the helper answers: an entry whose parent no row holds breaks the
       chain, so a lineage is only placed from its root. */
    branchMatch: alignArchive(lineage().slice(0, 2)),
  })
  on('classic.SessionEnd', () => ({}))
  on('classic.SessionStart', () => ({}))
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()

  /* Out to another session and back, in the same process; each time the
     engine draws the transcript it leaves once more on the way out. */
  await classic.SessionEnd({ reason: 'resume', session_id: sessionId })
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  classicSession.id = elsewhere
  transcript.splice(0)
  await classic.SessionStart({ source: 'resume', session_id: elsewhere })
  await classic.SessionEnd({ reason: 'resume', session_id: elsewhere })
  classicSession.id = sessionId
  transcript.push(...holding('PT-SECRET-ONE'))
  await classic.SessionStart({ source: 'resume', session_id: sessionId })
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  transcript.push(...holding('PT-SECRET-TWO'))
  await drawRow($, 'row-2', 'PT-SECRET-TWO')
  await settle()
  await promptHistory($)
  await settle()

  expect(alignCalls(calls).at(-1)?.stdin).toBe('13\nPT-SECRET-ONE13\nPT-SECRET-TWO')
  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PT-SECRET-ONE',
    '2. PT-SECRET-TWO',
  ])
})

test('rows drawn on the way out of a clear are never tied, even once the next session starts', async ($, on) => {
  const classic = $.classic
  const cleared = '66666666-7777-4888-8999-aaaaaaaaaaaa'
  const classicSession = { id: sessionId }
  const transcript = holding('PT-SECRET-ONE')
  const { settle } = install(on, {
    store: storeOn(first),
    archive: lineage().slice(0, 1),
    classicSession,
    transcript,
    /* Whatever the rows around it, a row of the entry's text is placed. */
    branchMatch: call => {
      const rows = (call.stdin ?? '').split(/\d+\n/).filter(Boolean)
      const at = rows.indexOf('PT-SECRET-ONE')
      return at < 0
        ? { match: 'none', candidates: [], candidateCount: 0, rows: [] }
        : aligned(first, [{ row: at, eventId: first }])
    },
  })
  on('classic.SessionEnd', () => ({}))
  on('classic.SessionStart', () => ({}))
  await $.session.start(session)
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await settle()

  /* The clear's SessionEnd comes while the transcript still holds the row,
     and the engine draws it once more before the next session starts, with
     another of its rows this module instance never drew. */
  await classic.SessionEnd({ reason: 'clear', session_id: sessionId })
  await drawRow($, 'row-1', 'PT-SECRET-ONE')
  await drawRow($, 'row-0', 'PT-SECRET-ONE')
  classicSession.id = cleared
  await classic.SessionStart({ source: 'clear', session_id: cleared })
  /* A row held after them would keep them among the rows the helper is asked. */
  transcript.splice(0, 1, ...holding('PT-SECRET-NEW'))
  await drawRow($, 'row-2', 'PT-SECRET-NEW')
  await promptHistory($)
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['× 1. PT-SECRET-ONE'])
})
