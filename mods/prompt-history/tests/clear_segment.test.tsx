import { expect } from 'claude-code/testing'
import { test } from './support'
import type { LifecycleState, LifecycleWrite } from '../hooks/lifecycle'
import type { ArchiveRow, TranscriptRow } from './support'
import {
  LIFECYCLE_QUEUE_LIMIT,
  clearTransitionState,
  decideLifecycle,
  dequeueLifecycleWrite,
  emptyLifecycle,
  queueLifecycleWrite,
} from '../hooks/lifecycle'
import {
  SECRET,
  boundaryCalls,
  captureCalls,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  projectId,
  promptHistory,
  reconcileKeyFor,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

const endedSessionId = sessionId
const resumedSessionId = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const clearEventId = 'c'.repeat(64)
const clearBranchId = 'dddddddd-eeee-4fff-8000-111111111111'
/* This process's stretch of the Run, as a Run that has already archived
   something in this process records it: a reload finds it open. */
const ownAttachment = {
  id: 'b0b0b0b0-c1c1-4d2d-8e3e-f4f4f4f4f4f4',
  host: '4242-100-200',
  segmentId: sessionId,
}

function lifecycleKey(forRunId: string = runId): string {
  return `prompt-history:lifecycle:${projectId}:${forRunId}`
}

function clearWrite(overrides: Partial<LifecycleWrite> = {}): LifecycleWrite {
  return {
    kind: 'clear',
    eventId: clearEventId,
    runId,
    segmentId: endedSessionId,
    branchId: clearBranchId,
    occurredAt: 1_794_000_000_000,
    /* Owed while there was no archive yet: replayed into the one that
       stands. */
    generation: null,
    ...overrides,
  }
}

const context = {
  runId,
  end: {
    eventId: clearEventId,
    branchId: clearBranchId,
    occurredAt: 1_795_000_000_000,
  },
}

/* The recorded lifecycle sequences. Classic session events cannot be raised
   through the test engine, so the state machine is replayed directly: it is
   written to be a pure function of the stored state and one event exactly so
   these sequences are the same ones the hooks feed it. */

test('a clear end writes one boundary against the segment it closes', () => {
  const decision = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  )

  expect(decision.note).toBe('clear-boundary')
  /* Its generation is stamped as it is first saved, not by the machine. */
  const { generation: _generation, ...expected } = clearWrite({ occurredAt: 1_795_000_000_000 })
  expect(decision.write).toEqual(expected)
  expect(decision.state.clear).toEqual({
    eventId: clearEventId,
    endedSessionId,
    runId,
  })
})

test('a repeated clear end asks for no second boundary', () => {
  const first = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  )
  const repeat = decideLifecycle(
    first.state,
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  )

  expect(repeat.note).toBe('clear-duplicate')
  expect(repeat.write).toBeUndefined()
  expect(repeat.state).toEqual(first.state)
})

test('a clear start associates the new session without a second boundary', () => {
  const ended = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  )
  const started = decideLifecycle(
    ended.state,
    { event: 'session-start', sessionId: resumedSessionId, source: 'clear' },
    context,
  )
  const replayed = decideLifecycle(
    started.state,
    { event: 'session-start', sessionId: resumedSessionId, source: 'clear' },
    context,
  )

  expect(started.note).toBe('clear-associated')
  expect(started.write).toBeUndefined()
  expect(started.state.clear?.resumedSessionId).toBe(resumedSessionId)
  expect(replayed.note).toBe('clear-already-associated')
  expect(replayed.write).toBeUndefined()
  expect(replayed.state).toEqual(started.state)
})

test('a clear start with no end observed invents no boundary', () => {
  const decision = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-start', sessionId: resumedSessionId, source: 'clear' },
    context,
  )

  expect(decision.note).toBe('clear-unobserved')
  expect(decision.write).toBeUndefined()
  expect(decision.state.clear).toBeUndefined()
  expect(decision.state.unobservedClear).toBe(true)
})

test('compaction, reload and the other sources create no Clear Boundary', () => {
  const sources = ['compact', 'startup', 'resume', 'fork']
  for (const source of sources) {
    const decision = decideLifecycle(
      emptyLifecycle(),
      { event: 'session-start', sessionId: resumedSessionId, source },
      context,
    )
    expect(decision.note, source).toBe('not-clear')
    expect(decision.write, source).toBeUndefined()
    expect(decision.state, source).toEqual(emptyLifecycle())
  }
})

test('a session end that is not a clear creates no Clear Boundary', () => {
  const reasons = ['resume', 'logout', 'prompt_input_exit', 'other']
  for (const reason of reasons) {
    const decision = decideLifecycle(
      emptyLifecycle(),
      { event: 'session-end', sessionId: endedSessionId, reason },
      context,
    )
    /* An exit leaves the Run, not a segment — and a process that never took the
       Run up has no attachment to leave. */
    expect(decision.note, reason).toBe(reason === 'resume' ? 'not-clear' : 'run-not-attached')
    expect(decision.write, reason).toBeUndefined()
    expect(decision.state, reason).toEqual(emptyLifecycle())
  }
})

test('a compact start leaves an in-flight clear transition alone', () => {
  const ended = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  )
  const compacted = decideLifecycle(
    ended.state,
    { event: 'session-start', sessionId: resumedSessionId, source: 'compact' },
    context,
  )

  expect(compacted.state).toEqual(ended.state)
  expect(clearTransitionState(compacted.state, runId)).toBe('open')
})

test('a transition another Run left open reads as unfinished', () => {
  const ended = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  ).state
  const associated = decideLifecycle(
    ended,
    { event: 'session-start', sessionId: resumedSessionId, source: 'clear' },
    context,
  ).state

  expect(clearTransitionState(emptyLifecycle(), runId)).toBe('none')
  /* The same Run between its own two events: ordinary, still in flight. */
  expect(clearTransitionState(ended, runId)).toBe('open')
  /* A later process cannot be the one that started it, so the SessionStart
     never arrived: the boundary stands and the transition did not complete. */
  expect(clearTransitionState(ended, 'a-later-run')).toBe('unfinished')
  expect(clearTransitionState(ended, undefined)).toBe('unfinished')
  expect(clearTransitionState(associated, 'a-later-run')).toBe('complete')
})

test('a second clear over an unfinished one records that it displaced it', () => {
  const ended = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  ).state
  const again = decideLifecycle(
    ended,
    { event: 'session-end', sessionId: resumedSessionId, reason: 'clear' },
    { ...context, end: { ...context.end, eventId: 'e'.repeat(64) } },
  )

  expect(again.note).toBe('clear-boundary')
  expect(again.write?.segmentId).toBe(resumedSessionId)
  expect(again.state.clear?.priorUnfinished).toBe(true)
})

test('a clear start for an already claimed transition is recorded, not rewritten', () => {
  const associated = decideLifecycle(
    decideLifecycle(
      emptyLifecycle(),
      { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
      context,
    ).state,
    { event: 'session-start', sessionId: resumedSessionId, source: 'clear' },
    context,
  ).state
  const stray = decideLifecycle(
    associated,
    { event: 'session-start', sessionId: 'another-session', source: 'clear' },
    context,
  )

  expect(stray.note).toBe('clear-unobserved')
  expect(stray.write).toBeUndefined()
  expect(stray.state.clear).toEqual(associated.clear)
  expect(stray.state.unobservedClear).toBe(true)
})

test('the recovery queue dedupes, empties and refuses to grow without bound', () => {
  const write = clearWrite()
  const queued = queueLifecycleWrite(emptyLifecycle(), write)

  expect(queued.queue).toEqual([write])
  expect(queueLifecycleWrite(queued, write).queue).toEqual([write])
  expect(dequeueLifecycleWrite(queued, write.eventId).queue).toEqual([])

  let full: LifecycleState = emptyLifecycle()
  for (let index = 0; index < LIFECYCLE_QUEUE_LIMIT; index += 1) {
    full = queueLifecycleWrite(full, clearWrite({ eventId: `queued-${index}` }))
  }
  const overflowed = queueLifecycleWrite(full, clearWrite({ eventId: 'one-too-many' }))

  expect(full.queue).toHaveLength(LIFECYCLE_QUEUE_LIMIT)
  expect(full.overflowed).toBeUndefined()
  expect(overflowed.queue).toHaveLength(LIFECYCLE_QUEUE_LIMIT)
  expect(overflowed.overflowed).toBe(true)
})

/* What a queued Clear Boundary does to the next composer submission. */

test('a queued Clear Boundary is written before the next Prompt Entry', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
  }
  const calls = installSupportedTarget(on, { store })

  await $.session.start(session)
  await composerPrompt($)

  const boundaries = boundaryCalls(calls)
  expect(boundaries).toHaveLength(1)
  /* Replayed verbatim: a drifted field would reach the helper as a
     `boundary-conflict` rather than as the same boundary. */
  expect(boundaries[0]?.argv.slice(5)).toEqual([
    endedSessionId,
    clearBranchId,
    'clear',
    clearEventId,
    '1794000000000',
    /* Owed while there was no archive: replayed unchecked. */
    '-',
    expect.any(String),
    '1',
  ])
  expect(boundaries[0]?.stdin).toBeUndefined()
  /* The boundary takes the sequence before the entry that follows it. */
  const confirmed = captureCalls(calls, 'capture-confirm')
  expect(confirmed).toHaveLength(1)
  expect((store[lifecycleKey()] as { queue: unknown[] }).queue).toEqual([])
})

test('a Clear Boundary that will not write blocks the submission', async ($, on) => {
  const fills: string[] = []
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
  }
  const calls = installSupportedTarget(on, { store, boundaryFails: true, fills })

  await $.session.start(session)
  const result = await composerPrompt($)

  expect(result).toMatchObject({
    drop: expect.stringContaining('无法补写中断的 Clear Boundary'),
  })
  expect(fills).toEqual([SECRET])
  /* Nothing was staged behind the boundary that is still owed. */
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect((store[lifecycleKey()] as { queue: unknown[] }).queue).toHaveLength(1)
})

test('an owed Clear Boundary and an unfinished transition are reported', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: {
      version: 1,
      started: true, attachment: ownAttachment,
      queue: [clearWrite()],
      clear: { eventId: clearEventId, endedSessionId, runId: 'a-previous-run' },
    },
  }
  installSupportedTarget(on, { store })

  await $.session.start(session)
  const status = await promptHistory($, 'status')

  expect(status.text).toContain('Run collection mode: disabled · Clear Boundary 待补写')
  expect(status.text).toContain('clear transition: cccccccc · 未完成转换')
  expect(status.text).toContain('1 条 Clear Boundary 待补写')
})

test('a completed transition reports as completed and blocks nothing', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: {
      version: 1,
      started: true, attachment: ownAttachment,
      queue: [],
      clear: {
        eventId: clearEventId,
        endedSessionId,
        runId,
        resumedSessionId,
      },
    },
  }
  installSupportedTarget(on, { store })

  await $.session.start(session)
  const status = await promptHistory($, 'status')

  expect(status.text).toContain('Run collection mode: enabled')
  expect(status.text).toContain('clear transition: cccccccc · 已完成')
})

/* What the new classic session means for the Conversation Branch. */

test('the segment after a clear starts a new root branch', async ($, on) => {
  const classicSession = { id: endedSessionId }
  const store = consentedStore()
  const transcript: TranscriptRow[] = []
  const calls = installSupportedTarget(on, { store, classicSession, transcript })

  await $.session.start(session)
  await composerPrompt($, { text: 'PH-SECRET-BEFORE-CLEAR' })
  await composerPrompt($, { text: 'PH-SECRET-STILL-BEFORE' })
  /* What `/clear` does to the host: a new classic session, the same Run. */
  classicSession.id = resumedSessionId
  transcript.splice(0)
  await composerPrompt($, { text: 'PH-SECRET-AFTER-CLEAR' })

  const staged = captureCalls(calls, 'capture-begin')
  expect(staged).toHaveLength(3)
  const [first, second, third] = staged.map(call => ({
    runId: call.argv[4],
    segmentId: call.argv[5],
    branchId: call.argv[6],
    parentEventId: call.argv[7],
    eventId: call.argv[8],
  }))
  /* Same Run throughout: a `/clear` does not end the interactive process. */
  expect(new Set([first?.runId, second?.runId, third?.runId])).toEqual(new Set([runId]))
  /* Within one segment the lineage chains. */
  expect(first?.parentEventId).toBe('-')
  expect(second?.parentEventId).toBe(first?.eventId)
  expect(second?.branchId).toBe(first?.branchId)
  /* Across the clear it does not: a new segment, a new root branch. */
  expect(third?.segmentId).toBe(resumedSessionId)
  expect(third?.parentEventId).toBe('-')
  expect(third?.branchId).not.toBe(first?.branchId)
})

test('the archive keeps both sides of a clear in their original order', async ($, on) => {
  const classicSession = { id: endedSessionId }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [] },
  }
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, classicSession, archive })

  await $.session.start(session)
  await composerPrompt($, { text: 'PH-SECRET-BEFORE-CLEAR' })
  /* The boundary the SessionEnd wrote, reaching this process as the queue the
     next submission drains. */
  classicSession.id = resumedSessionId
  store[lifecycleKey()] = { version: 1, queue: [clearWrite({ occurredAt: 1_795_000_000_000 })] }
  await composerPrompt($, { text: 'PH-SECRET-AFTER-CLEAR' })

  expect(archive.flatMap(row => row.kind === 'prompt' ? [row.text] : row.kind === 'clear' ? ['clear'] : []))
    .toEqual(['PH-SECRET-BEFORE-CLEAR', 'clear', 'PH-SECRET-AFTER-CLEAR'])
  /* Exactly one boundary. */
  expect(boundaryCalls(calls)).toHaveLength(1)
})

/* Issue 42: the host runs the function hooks' `session.start` before the
   bridge's classic SessionStart publishes the locator, so a process whose
   first act is `/clear` reaches SessionEnd without having read its Run. */
test('a clear before this process has read its locator still writes the boundary', async ($, on) => {
  const classic = $.classic
  const archive: ArchiveRow[] = []
  const classicSession = { id: endedSessionId }
  const locatorPublished = { value: false }
  installSupportedTarget(on, { store: consentedStore(), archive, classicSession, locatorPublished })
  on('classic.SessionEnd', () => ({}))
  on('classic.SessionStart', () => ({}))

  await $.session.start(session)
  locatorPublished.value = true
  await classic.SessionEnd({ reason: 'clear', session_id: endedSessionId })
  classicSession.id = resumedSessionId
  await classic.SessionStart({ source: 'clear', session_id: resumedSessionId })
  await composerPrompt($)

  const ordered = [...archive].sort((left, right) => left.sequence - right.sequence)
  expect(ordered.map(row => row.kind)).toEqual(['run-started', 'clear', 'prompt'])
  const [, clear, entry] = ordered
  expect(clear?.segmentId).toBe(endedSessionId)
  expect(entry?.segmentId).toBe(resumedSessionId)
  expect(entry?.parentEventId ?? null).toBeNull()
})

test('drawing the band again archives nothing', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
  }
  const calls = installSupportedTarget(on, { store })

  await $.session.start(session)
  await composerPrompt($)
  const before = calls.length
  await renderBand($)
  await renderBand($)

  expect(calls).toHaveLength(before)
  expect(boundaryCalls(calls)).toHaveLength(1)
})

test('a control command creates no Prompt Entry of its own', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
  }
  const calls = installSupportedTarget(on, { store })

  await $.session.start(session)
  await promptHistory($, '')
  await promptHistory($, 'status')

  /* `/clear` reaches the engine the same way: as a command, never as a
     composer submission, so nothing is staged and nothing is archived. */
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(boundaryCalls(calls)).toHaveLength(0)
})

test('a boundary replayed after an unsaved drain still draws one row', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
  }
  /* The boundary lands but the record of it landing does not, so the next
     submission replays the very same event id. */
  const calls = installSupportedTarget(on, {
    store,
    storeSetFailsFor: 'prompt-history:lifecycle:',
    fills: [],
  })

  await $.session.start(session)
  const blocked = await composerPrompt($)
  const allowed = await composerPrompt($)

  expect(blocked).toMatchObject({
    drop: expect.stringContaining('无法补写中断的 Clear Boundary'),
  })
  expect(allowed).toMatchObject({ drop: expect.any(String) })
  const boundaries = boundaryCalls(calls)
  expect(boundaries).toHaveLength(2)
  expect(boundaries.map(call => call.argv[8])).toEqual([clearEventId, clearEventId])
})

test('a failed drain names the category the helper refused with', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
  }
  installSupportedTarget(on, { store, boundaryFails: true, fills: [] })

  await $.session.start(session)
  await composerPrompt($)
  const status = await promptHistory($, 'status')

  /* Without this the only record of a lifecycle write that never landed is a
     count, and a queue that will not drain cannot be told apart from any
     other. The mock refuses as the helper does, with a category on stderr. */
  expect(status.text).toContain('1 条 Clear Boundary 待补写 · 上次补写失败：archive-sqlite')
})

test('an unreadable queue entry is dropped and the loss is reported', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: {
      version: 1,
      started: true, attachment: ownAttachment,
      /* A row that would replay into a permanent `boundary-conflict`. */
      queue: [{ ...clearWrite(), occurredAt: 'not a number' }],
    },
  }
  const calls = installSupportedTarget(on, { store })

  await $.session.start(session)
  const status = await promptHistory($, 'status')

  expect(boundaryCalls(calls)).toHaveLength(0)
  /* Reported as the Integrity gap it becomes (Issue 26). */
  expect(status.text).toContain('integrity: gap owed · 恢复队列有无法重放的记录')
  /* The loss blocks nothing: there is no boundary left to owe. */
  expect(status.text).toContain('Run collection mode: enabled')
})

/* Regressions from the Issue 16 code review. */

test('a start from another Run cannot claim an interrupted transition', () => {
  const ended = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    context,
  ).state
  /* Run B's own `/clear` start reaching Run A's record. Claiming it would make
     an interrupted transition read as completed and stop it being reported. */
  const stolen = decideLifecycle(
    ended,
    { event: 'session-start', sessionId: resumedSessionId, source: 'clear' },
    { ...context, runId: 'another-run' },
  )

  expect(stolen.note).toBe('clear-unobserved')
  expect(stolen.state.clear?.resumedSessionId).toBeUndefined()
  expect(clearTransitionState(stolen.state, 'another-run')).toBe('unfinished')
})

test('a clear end with no write fields defers instead of losing the fact', () => {
  const decision = decideLifecycle(
    emptyLifecycle(),
    { event: 'session-end', sessionId: endedSessionId, reason: 'clear' },
    { runId },
  )

  expect(decision.note).toBe('clear-deferred')
  expect(decision.write).toBeUndefined()
  /* Untouched: the caller holds the deferral, so nothing claims a boundary
     that was never formed. */
  expect(decision.state).toEqual(emptyLifecycle())
})

test('a queued boundary replays the Run that owns it, not the Run draining it', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const store: Record<string, unknown> = {
    ...consentedStore(),
    /* A Run that died mid-transition. It cannot come back to pay its own
       debt, so whoever archives next in this project owes its boundary. */
    [lifecycleKey(otherRun)]: {
      version: 1,
      queue: [clearWrite({ runId: otherRun, eventId: 'f'.repeat(64) })],
      clear: {
        eventId: 'f'.repeat(64),
        endedSessionId,
        runId: otherRun,
      },
    },
  }
  const calls = installSupportedTarget(on, { store })

  await $.session.start(session)
  await composerPrompt($)

  const boundaries = boundaryCalls(calls)
  expect(boundaries).toHaveLength(1)
  /* argv[4] is the Run the boundary belongs to. Sending this Run's id would
     either misattribute the boundary or, once the original Run had already
     committed it, be refused as `boundary-conflict` for good. */
  expect(boundaries[0]?.argv[4]).toBe(otherRun)
  expect(boundaries[0]?.argv[8]).toBe('f'.repeat(64))
  expect((store[lifecycleKey(otherRun)] as { queue: unknown[] }).queue).toEqual([])
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
})

test('another Run owing a boundary blocks this Run and is reported', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(otherRun)]: {
      version: 1,
      queue: [clearWrite({ runId: otherRun })],
      clear: { eventId: clearEventId, endedSessionId, runId: otherRun },
    },
  }
  installSupportedTarget(on, { store, boundaryFails: true, fills: [] })

  await $.session.start(session)
  const result = await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(result).toMatchObject({
    drop: expect.stringContaining('无法补写中断的 Clear Boundary'),
  })
  expect(status.text).toContain('Run collection mode: disabled · Clear Boundary 待补写')
  expect(status.text).toContain('其他 Run 遗留 1 条 Clear Boundary 待补写')
  expect(status.text).toContain('其他 Run 有 1 次未完成转换')
})

test('one Run draining does not erase another Run’s queued boundary', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [clearWrite()] },
    [lifecycleKey(otherRun)]: {
      version: 1,
      queue: [clearWrite({ runId: otherRun, eventId: 'f'.repeat(64) })],
    },
  }
  const calls = installSupportedTarget(on, { store })

  await $.session.start(session)
  await composerPrompt($)

  /* Both records are drained and both are emptied: a project-level record
     would have let one whole-value write erase the other's entry. */
  const boundaries = boundaryCalls(calls)
  expect(boundaries).toHaveLength(2)
  expect(new Set(boundaries.map(call => call.argv[4]))).toEqual(new Set([runId, otherRun]))
  expect((store[lifecycleKey()] as { queue: unknown[] }).queue).toEqual([])
  expect((store[lifecycleKey(otherRun)] as { queue: unknown[] }).queue).toEqual([])
})

test('a clear waits for an unsettled pre-clear Pending Capture', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFailsOnce: true,
    messages: [{ role: 'user', text: SECRET }],
    fills: [],
  })

  await $.session.start(session)
  /* The confirmation fails, so this prompt is owed a reconciliation and has
     taken no sequence yet. */
  await composerPrompt($)
  expect(store[reconcileKeyFor()]).toBeDefined()

  const before = boundaryCalls(calls).length
  /* A `/clear` landing here must not take the sequence between them: the
     pending prompt belongs to the segment the boundary closes. */
  await composerPrompt($, { text: 'PH-AFTER' })
  const order = calls
    .filter(call => call.argv[1] === 'capture-confirm'
      || (call.argv[1] === 'boundary-append' && call.argv[7] !== 'run-started'))
    .map(call => call.argv[1])

  expect(before).toBe(0)
  expect(order[0]).toBe('capture-confirm')
})
