import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect } from 'claude-code/testing'
import { test } from './support'
import type { BranchState, BranchMatch } from '../hooks/branch'
import { branchStarts, markTranscript, settleBranch, transcriptKept } from '../hooks/branch'
import type { ProcessCall, TranscriptRow } from './support'
import {
  captureCalls,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  parentChoices,
  parentPane,
  pickParent,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

const branchId = 'b1b1b1b1-0000-4000-8000-000000000001'
const freshBranchId = 'b2b2b2b2-0000-4000-8000-000000000002'
const storedParent = 'e1e1e1e1-0000-4000-8000-000000000001'

function stored(parentEventId: string | null, extra: Partial<BranchState> = {}): BranchState {
  return { version: 1, branchId, parentEventId, ...extra }
}

function none(): BranchMatch {
  return { match: 'none', candidates: [], candidateCount: 0 }
}

/* A rewind only ever shortens the transcript. One that no longer reaches any
   archived entry was rewound to its root, unless compaction cleared the rows
   that would have proved the lineage. */

test('a transcript rewound past every archived entry starts a root without asking', () => {
  expect(settleBranch(stored(storedParent), none(), freshBranchId, false)).toEqual({
    kind: 'set',
    state: { version: 1, branchId: freshBranchId, parentEventId: null },
  })
})

test('a compacted transcript that proves nothing still puts the lineage to the person', () => {
  expect(settleBranch(stored(storedParent), none(), freshBranchId, true))
    .toEqual({ kind: 'ask', options: [storedParent] })
})

/* Between two submissions a transcript only grows unless it was rewound. The
   mark left by a capture says which person-side row that prompt lands on; the
   next submission skips the helper while that row still holds it. */

const user = (text: string) => ({ role: 'user' as const, text })
const reply = { role: 'assistant' as const, text: 'reply' }
const toolResult = {
  role: 'user' as const,
  text: '',
  toolResults: [{ tool_use_id: 't', text: 'out', isError: false }],
}

test('a transcript that only grew since the last capture is kept', () => {
  const mark = markTranscript([user('PT-SECRET-A'), reply, toolResult], 'PT-SECRET-B')
  expect(transcriptKept(
    [user('PT-SECRET-A'), reply, toolResult, user('PT-SECRET-B'), reply, user('task notification')],
    mark,
  )).toBe(true)
})

test('a transcript rewound to before the last capture is not kept', () => {
  const mark = markTranscript([user('PT-SECRET-A'), reply], 'PT-SECRET-B')
  expect(transcriptKept([user('PT-SECRET-A'), reply], mark)).toBe(false)
  /* Rewound, then something else landed where that prompt was. */
  expect(transcriptKept([user('PT-SECRET-A'), reply, user('task notification')], mark)).toBe(false)
  expect(transcriptKept([], mark)).toBe(false)
})

test('a transcript settled without a capture is marked where it stood', () => {
  /* An alignment the person answered, or one whose submission went nowhere,
     marks the last person-side row it was settled against. */
  const mark = markTranscript([user('PT-SECRET-A'), reply, user('PT-SECRET-B')])
  expect(transcriptKept([user('PT-SECRET-A'), reply, user('PT-SECRET-B'), user('PT-SECRET-C')], mark))
    .toBe(true)
  expect(transcriptKept([user('PT-SECRET-A'), reply], mark)).toBe(false)
  /* An empty transcript cannot be rewound any further. */
  expect(transcriptKept([user('PT-SECRET-A')], markTranscript([reply]))).toBe(true)
})

test('a transcript at the engine\'s row limit is never taken as kept', () => {
  const full = Array.from({ length: 4096 }, () => user('x'))
  const mark = markTranscript(full.slice(0, 10), 'x')
  expect(transcriptKept(full, mark)).toBe(false)
})

/* The same, carried out by the hooks: every composer submission after the
   first checks whether the transcript was rewound since the last capture. */

function branchKey(): string {
  return `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
}

function matchCalls(calls: readonly ProcessCall[]): ProcessCall[] {
  return captureCalls(calls, 'branch-match')
}

/* The branch, parent and event id of each staged capture, in order. */
function begins(calls: readonly ProcessCall[]) {
  return captureCalls(calls, 'capture-begin').map(call => ({
    branchId: call.argv[6],
    parent: call.argv[7],
    eventId: call.argv[8],
  }))
}

function matched(eventId: string): BranchMatch {
  return {
    match: 'unique',
    eventId,
    candidates: [{ eventId, sequence: 1, runId }],
    candidateCount: 1,
  }
}

/* Three prompts captured one after another on a fresh session. */
async function threePrompts($: Engine, transcript: TranscriptRow[]) {
  for (const text of ['PT-SECRET-A', 'PT-SECRET-B', 'PT-SECRET-C']) {
    await composerPrompt($, { text })
    transcript.push({ role: 'assistant', text: 'reply' })
  }
}

test('a transcript that only grew is checked without asking the archive again', async ($, on) => {
  const transcript: TranscriptRow[] = []
  const calls = installSupportedTarget(on, { store: consentedStore(), transcript })
  await $.session.start(session)

  await threePrompts($, transcript)
  transcript.push({ role: 'user', text: 'task notification' })
  await composerPrompt($, { text: 'PT-SECRET-D' })

  expect(matchCalls(calls)).toHaveLength(1)
  const [a, b, c, d] = begins(calls)
  expect([b?.parent, c?.parent, d?.parent]).toEqual([a?.eventId, b?.eventId, c?.eventId])
  expect(new Set(begins(calls).map(begin => begin.branchId)).size).toBe(1)
})

test('a transcript rewound to an earlier prompt branches from the entry before it', async ($, on) => {
  const transcript: TranscriptRow[] = []
  let answer: BranchMatch = none()
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    transcript,
    branchMatch: () => answer,
  })
  await $.session.start(session)
  await threePrompts($, transcript)
  const [a, b, c] = begins(calls)

  /* Rewound to B: B and everything after it leave the transcript. */
  transcript.splice(2)
  answer = matched(a!.eventId!)
  await composerPrompt($, { text: 'PT-SECRET-B2' })

  const [match] = matchCalls(calls).slice(1)
  /* Matched inside this session's own stretch, the old tip preferred. */
  expect(match?.argv.slice(4, 8)).toEqual([runId, sessionId, 'whole', c!.eventId])
  expect(match?.stdin).toBe('11\nPT-SECRET-A')
  const fresh = begins(calls)[3]
  expect(fresh?.parent).toBe(a!.eventId)
  expect(fresh?.branchId).not.toBe(b!.branchId)
})

test('a transcript rewound to its root starts a root branch without asking', async ($, on) => {
  const transcript: TranscriptRow[] = []
  const pane = parentPane()
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, transcript, parentPane: pane })
  await $.session.start(session)
  await threePrompts($, transcript)
  const [a] = begins(calls)

  transcript.splice(0)
  const result = await composerPrompt($, { text: 'PT-SECRET-A2' })

  expect(result).toMatchObject({ text: 'PT-SECRET-A2' })
  expect(pane.opens).toHaveLength(0)
  const fresh = begins(calls)[3]
  expect(fresh?.parent).toBe('-')
  expect(fresh?.branchId).not.toBe(a!.branchId)
  expect(store[branchKey()]).not.toHaveProperty('explicitRoot')
})

test('a rewind menu closed without restoring leaves the next parent where it was', async ($, on) => {
  const transcript: TranscriptRow[] = []
  const calls = installSupportedTarget(on, { store: consentedStore(), transcript })
  await $.session.start(session)
  await threePrompts($, transcript)
  const [, , c] = begins(calls)

  await composerPrompt($, { text: 'PT-SECRET-D' })

  expect(matchCalls(calls)).toHaveLength(1)
  expect(begins(calls)[3]).toMatchObject({ branchId: c!.branchId, parent: c!.eventId })
})

for (const [name, failure] of [
  ['a rewound transcript the helper cannot match blocks the submission', 'match'],
  ['a transcript that cannot be read after a capture blocks the submission', 'messages'],
] as const) {
  test(name, async ($, on) => {
    const transcript: TranscriptRow[] = []
    const fills: string[] = []
    const options = { store: consentedStore(), transcript, fills, branchMatchFails: false, messagesFail: false }
    const calls = installSupportedTarget(on, options)
    await $.session.start(session)
    await threePrompts($, transcript)

    transcript.splice(2)
    if (failure === 'match') options.branchMatchFails = true
    else options.messagesFail = true
    const result = await composerPrompt($, { text: 'PT-SECRET-B2' })

    expect(result).toMatchObject({ drop: expect.stringContaining('Conversation Branch') })
    expect(fills).toEqual(['PT-SECRET-B2'])
    expect(begins(calls)).toHaveLength(3)
  })
}

/* Compaction clears the rows a lineage was proved by, so the session is
   marked for good, and a transcript that then proves nothing is asked about
   rather than taken for a rewind to the root. */

function compactedKey(): string {
  return `prompt-trail:compacted:${projectId}:${sessionId}`
}

const summary: TranscriptRow = { role: 'user', text: 'summary of the conversation so far' }

/* The engine's own call: the transcript it compacts, and who compacts it. */
function compact(
  $: Engine,
  input: { trigger?: 'manual' | 'auto' | 'plugin' | 'precompute'; agentId?: string } = {},
) {
  return $.session.compact({
    trigger: input.trigger ?? 'manual',
    ...(input.agentId ? { agentId: input.agentId } : {}),
    messages: [{ role: 'user', text: 'PT-SECRET-A', toolUses: [] }],
  })
}

function compactsTo(on: On, transcript: TranscriptRow[]) {
  on('session.compact', () => {
    transcript.splice(0, transcript.length, summary)
    return { messages: [{ ...summary, toolUses: [] }] }
  })
}

test('a compaction seen in this process keeps the branch it was on', async ($, on) => {
  const transcript: TranscriptRow[] = []
  const store = consentedStore()
  const pane = parentPane()
  const calls = installSupportedTarget(on, { store, transcript, parentPane: pane })
  compactsTo(on, transcript)
  await $.session.start(session)
  await threePrompts($, transcript)
  const [, , c] = begins(calls)

  await compact($)
  expect(store[compactedKey()]).toBe(true)
  await composerPrompt($, { text: 'PT-SECRET-D' })

  expect(pane.opens).toHaveLength(0)
  expect(matchCalls(calls)).toHaveLength(1)
  expect(begins(calls)[3]).toMatchObject({ branchId: c!.branchId, parent: c!.eventId })
})

test('a compacted session asks rather than taking a transcript that proves nothing for a rewind', async ($, on) => {
  const transcript: TranscriptRow[] = []
  const store = consentedStore()
  const pane = parentPane()
  const calls = installSupportedTarget(on, { store, transcript, parentPane: pane, fills: [] })
  compactsTo(on, transcript)
  await $.session.start(session)
  await threePrompts($, transcript)
  await compact($)
  await composerPrompt($, { text: 'PT-SECRET-D' })

  /* Rewound to D: all that is left is the summary. */
  transcript.splice(1)
  const result = await composerPrompt($, { text: 'PT-SECRET-D2' })

  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(pane.opens).toHaveLength(1)
  /* Its earliest rows are gone, so a lineage may begin before them. */
  expect(matchCalls(calls).at(-1)?.argv[6]).toBe('truncated')
  expect(begins(calls)).toHaveLength(4)
})

test('a compaction is marked even while the Run collects nothing', async ($, on) => {
  const transcript: TranscriptRow[] = []
  const store = consentedStore()
  installSupportedTarget(on, { store, transcript })
  compactsTo(on, transcript)
  await $.session.start(session)
  await promptHistory($, 'disable')

  await compact($)

  expect(store[compactedKey()]).toBe(true)
})

test('a compaction that did not happen, or not to this conversation, marks nothing', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, { store })
  let skipped = true
  on('session.compact', () => skipped
    ? { skip: 'nothing to compact' }
    : { messages: [{ ...summary, toolUses: [] }] })
  await $.session.start(session)

  await compact($)
  skipped = false
  /* Computed ahead of time, installed only by a compaction to come. */
  await compact($, { trigger: 'precompute' })
  /* A subagent's own transcript, not the session's. */
  await compact($, { agentId: 'agent-1' })

  expect(store).not.toHaveProperty(compactedKey())
})

/* Where the timeline draws a branch starting: an entry of a Run that begins a
   new lineage part-way through it, rather than at a boundary that already
   says why. A rewind that stays inside the Run folds instead. */

const otherRun = 'ffffffff-0000-4000-8000-000000000009'

function entry(eventId: string, sequence: number, parentEventId: string | null, run = runId) {
  return { kind: 'prompt' as const, eventId, sequence, runId: run, parentEventId }
}

function boundary(eventId: string, sequence: number, run = runId) {
  return { kind: 'boundary' as const, eventId, sequence, runId: run }
}

test('an entry rewound to its Run\'s root starts a root branch where it is drawn', () => {
  const starts = branchStarts([
    entry('a', 1, null),
    entry('b', 2, 'a'),
    boundary('x', 3, otherRun),
    entry('a2', 4, null),
    entry('b2', 5, 'a2'),
    entry('b3', 6, 'a'),
  ])
  expect([...starts]).toEqual([['a2', 'root']])
})

test('an entry right after a boundary of its own Run is not marked again', () => {
  const starts = branchStarts([
    entry('a', 1, null),
    boundary('clear', 2),
    entry('c', 3, null),
    boundary('resumed', 4),
    entry('d', 5, null),
  ])
  expect(starts.size).toBe(0)
})

test('a forked Run that rewinds onto its source again starts a branch there', () => {
  const starts = branchStarts([
    entry('s1', 1, null, otherRun),
    entry('s2', 2, 's1', otherRun),
    entry('f1', 3, 's2'),
    entry('f2', 4, 'f1'),
    entry('f3', 5, 's1'),
    /* A parent outside the loaded window proves nothing either way. */
    entry('f4', 6, 'gone'),
  ])
  expect([...starts]).toEqual([['f3', 'cross-run']])
})

test('the timeline shows where a rewind started a root branch, with the old one still in view', async ($, on) => {
  const transcript: TranscriptRow[] = []
  installSupportedTarget(on, { store: consentedStore(), transcript })
  await $.session.start(session)
  await threePrompts($, transcript)

  transcript.splice(0)
  await composerPrompt($, { text: 'PT-SECRET-A2' })
  await promptHistory($)

  const band = JSON.stringify(await renderBand($))
  const order = ['PT-SECRET-A', 'PT-SECRET-C', '—— 新根分支 ——', 'PT-SECRET-A2'].map(text => band.indexOf(text))
  expect(order.every(at => at >= 0)).toBe(true)
  expect([...order].sort((left, right) => left - right)).toEqual(order)
  expect(band.split('—— 新根分支 ——')).toHaveLength(2)
})
