import { expect, test } from 'claude-code/testing'
import { EXPECTED_HELPER_SHA256 } from '../hooks/artifact'
import type { LifecycleWrite } from '../hooks/lifecycle'
import {
  LIFECYCLE_QUEUE_LIMIT,
  beginRun,
  decideLifecycle,
  emptyLifecycle,
  queueLifecycleWrite,
} from '../hooks/lifecycle'
import type { ArchiveRow } from './support'
import {
  SECRET,
  TIMELINE_READ_LIMIT,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

const consentGranted = { policyVersion: 1, decision: 'enabled' as const }
const earlierRunId = '12121212-3434-4565-8787-909090909090'
const earlierSessionId = '31313131-4242-4353-8464-757575757575'
const branchId = 'dddddddd-eeee-4fff-8000-111111111111'
/* The locator's host process start, 100 s and 200 µs, as the start boundary
   records it: the instant the Run's process began, the same on every replay. */
const hostStartedAt = 100_000

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: consentGranted }
}

function lifecycleKey(forRunId: string = runId): string {
  return `prompt-trail:lifecycle:${projectId}:${forRunId}`
}

function uiKey(forRunId: string = runId): string {
  return `prompt-trail:ui:${forRunId}`
}

function row(
  kind: string,
  sequence: number,
  forRunId: string,
  fields: Partial<ArchiveRow> = {},
): ArchiveRow {
  return {
    kind,
    eventId: `${kind}-${sequence}-${forRunId.slice(0, 4)}`,
    sequence,
    runId: forRunId,
    segmentId: earlierSessionId,
    branchId,
    ...(kind === 'prompt' ? { text: `PT-SECRET-EARLIER-${sequence}`, attachmentCount: 0 } : {}),
    ...fields,
  }
}

/* An earlier process's Run, as the archive keeps it: a start, one Prompt
   Entry and, when it exited normally, an end. */
function earlierRun(closed: boolean): ArchiveRow[] {
  return [
    row('run-started', 1, earlierRunId),
    row('prompt', 2, earlierRunId),
    ...(closed ? [row('run-ended', 3, earlierRunId)] : []),
  ]
}

function startWrite(overrides: Partial<LifecycleWrite> = {}): Omit<LifecycleWrite, 'kind'> {
  return {
    eventId: 'a'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId,
    occurredAt: hostStartedAt,
    ...overrides,
  }
}

const endContext = {
  runId,
  end: { eventId: 'e'.repeat(64), branchId, occurredAt: 1_795_000_000_000 },
}

/* The Run lifecycle, replayed against the state machine directly: classic
   session events cannot be raised through the test engine. */

test('an exit of a Run that never archived anything closes nothing', () => {
  for (const reason of ['prompt_input_exit', 'logout', 'other']) {
    const decision = decideLifecycle(
      emptyLifecycle(),
      { event: 'session-end', sessionId, reason },
      endContext,
    )
    expect(decision.note, reason).toBe('run-not-started')
    expect(decision.write, reason).toBeUndefined()
  }
})

test('a started Run ends once, against the session it exits from', () => {
  const started = beginRun(emptyLifecycle(), startWrite()).state
  const ended = decideLifecycle(
    started,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    endContext,
  )
  const repeated = decideLifecycle(
    ended.state,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    endContext,
  )

  expect(ended.note).toBe('run-ended')
  expect(ended.write).toEqual({
    kind: 'run-ended',
    eventId: 'e'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId,
    occurredAt: 1_795_000_000_000,
  })
  expect(ended.state.ended).toBe(true)
  expect(repeated.note).toBe('run-end-duplicate')
  expect(repeated.write).toBeUndefined()
})

test('an exit whose end cannot be formed leaves the Run unclosed', () => {
  const started = beginRun(emptyLifecycle(), startWrite()).state
  const decision = decideLifecycle(
    started,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    { runId },
  )

  expect(decision.note).toBe('run-end-unrecorded')
  expect(decision.write).toBeUndefined()
  expect(decision.state).toEqual(started)
})

test('an in-process resume ends neither the Run nor a segment', () => {
  const started = beginRun(emptyLifecycle(), startWrite()).state
  const decision = decideLifecycle(
    started,
    { event: 'session-end', sessionId, reason: 'resume' },
    endContext,
  )

  expect(decision.note).toBe('not-clear')
  expect(decision.write).toBeUndefined()
  expect(decision.state).toEqual(started)
})

test('a Run starts once and ahead of anything it already owes', () => {
  const owedClear: LifecycleWrite = {
    kind: 'clear',
    eventId: 'c'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
  }
  const owing = queueLifecycleWrite(emptyLifecycle(), owedClear)
  const started = beginRun(owing, startWrite())
  const again = beginRun(started.state, startWrite({ occurredAt: 1 }))

  expect(started.note).toBe('run-started')
  expect(started.state.started).toBe(true)
  expect(started.state.queue.map(write => write.kind)).toEqual(['run-started', 'clear'])
  expect(again.note).toBe('run-already-started')
  expect(again.state).toEqual(started.state)
})

test('a full recovery queue still takes the Run\'s one start and one end', () => {
  let owing = emptyLifecycle()
  for (let index = 0; index < LIFECYCLE_QUEUE_LIMIT; index += 1) {
    owing = queueLifecycleWrite(owing, {
      kind: 'clear',
      eventId: index.toString(16).padStart(64, '0'),
      runId,
      segmentId: sessionId,
      branchId,
      occurredAt: 1_794_000_000_000 + index,
    })
  }
  const started = beginRun(owing, startWrite())
  const ended = decideLifecycle(
    started.state,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    endContext,
  )
  const queued = queueLifecycleWrite(ended.state, ended.write as LifecycleWrite)

  expect(started.state.queue[0]?.kind).toBe('run-started')
  expect(queued.queue.at(-1)?.kind).toBe('run-ended')
  expect(queued.queue).toHaveLength(LIFECYCLE_QUEUE_LIMIT + 2)
  expect(queued.overflowed).toBeUndefined()
})

/* The hooks. */

test('a Run appears in the archive with one start ahead of its first Prompt Entry', async ($, on) => {
  const store = consentedStore()
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($)

  expect(archive.map(event => event.kind)).toEqual(['run-started', 'prompt', 'prompt'])
  expect(archive[0]).toMatchObject({ runId, segmentId: sessionId, occurredAt: hostStartedAt })
  expect(archive[0]?.eventId).toMatch(/^[0-9a-f]{64}$/)
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(1)
  expect(store[lifecycleKey()]).toMatchObject({ version: 1, queue: [], started: true })
})

test('a Run that only declines consent never appears in the archive', async ($, on) => {
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { ask: '继续但不启用', store: {}, archive })
  await $.session.start(session)

  await composerPrompt($)

  expect(archive).toEqual([])
  expect(calls.some(call => call.argv[1] === 'timeline-read')).toBe(false)
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
})

test('a reload of the same Run keeps its start, its entries and its expanded band', async ($, on) => {
  /* What the previous module instance of this Run left behind: the record of
     its start, its expanded band and, in the archive, its events. */
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey()]: { version: 1, queue: [], started: true },
    [uiKey()]: { version: 1, expanded: true },
  }
  const archive: ArchiveRow[] = [
    row('run-started', 1, runId, { segmentId: sessionId, occurredAt: hostStartedAt }),
    row('prompt', 2, runId, { segmentId: sessionId, text: 'PT-SECRET-BEFORE-RELOAD' }),
  ]
  const calls = installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  const reloaded = JSON.stringify(await renderBand($))
  await composerPrompt($)
  const after = JSON.stringify(await renderBand($))

  expect(reloaded).toContain('▾ Prompt Trail')
  expect(reloaded).toContain('PT-SECRET-BEFORE-RELOAD')
  expect(reloaded).not.toContain('未记录结束')
  expect(archive.map(event => event.kind)).toEqual(['run-started', 'prompt', 'prompt'])
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
  /* One row per event however often the band is drawn, numbered in order. */
  expect(after.split('PT-SECRET-BEFORE-RELOAD')).toHaveLength(2)
  expect(after).toContain('1. PT-SECRET-BEFORE-RELOAD')
  expect(after).toContain('2. PT-SECRET-CONSENT-CAPTURE')
})

test('the band starts collapsed in a new Run and its state is kept per Run', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [uiKey(earlierRunId)]: { version: 1, expanded: true },
  }
  installSupportedTarget(on, { store })
  await $.session.start(session)

  const fresh = JSON.stringify(await renderBand($))
  await promptHistory($)
  const expandedState = store[uiKey()]
  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })

  expect(fresh).toContain('▸ Prompt Trail')
  expect(expandedState).toEqual({ version: 1, expanded: true })
  expect(store[uiKey()]).toEqual({ version: 1, expanded: false })
  expect(store[uiKey(earlierRunId)]).toEqual({ version: 1, expanded: true })
})

test('a restart continues the Project Timeline under a new Run', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: { version: 1, queue: [], started: true, ended: true },
  }
  const archive = earlierRun(true)
  installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(archive.map(event => [event.kind, event.runId, event.sequence])).toEqual([
    ['run-started', earlierRunId, 1],
    ['prompt', earlierRunId, 2],
    ['run-ended', earlierRunId, 3],
    ['run-started', runId, 4],
    ['prompt', runId, 5],
  ])
  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('Run 结束'),
    band.lastIndexOf('Run 开始'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
  expect(band).not.toContain('未记录结束')
})

test('a Run that left no end reads as unclosed, never as ended', async ($, on) => {
  const archive = earlierRun(false)
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('Run 未记录结束'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
  /* No end boundary is fabricated for the earlier Run, and the current Run,
     which has not ended either, is not marked. */
  expect(archive.filter(event => event.kind === 'run-ended')).toEqual([])
  expect(band.split('未记录结束')).toHaveLength(2)
})

test('the read is bounded to the latest fixed batch', async ($, on) => {
  const archive: ArchiveRow[] = Array.from(
    { length: TIMELINE_READ_LIMIT + 5 },
    (_, index) => row('prompt', index + 1, earlierRunId),
  )
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  /* The oldest five fall outside the batch: the list opens on the sixth. */
  expect(band).toContain('"1. PT-SECRET-EARLIER-6"')
  expect(band).toContain(`"${TIMELINE_READ_LIMIT}. PT-SECRET-EARLIER-${TIMELINE_READ_LIMIT + 5}"`)
  expect(band).not.toContain('PT-SECRET-EARLIER-5"')
})

test('a timeline that cannot be read still lets the Run collect', async ($, on) => {
  const archive = earlierRun(true)
  installSupportedTarget(on, { store: consentedStore(), archive, readFails: true })
  await $.session.start(session)

  const result = await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(result).toMatchObject({ text: SECRET })
  expect(band).toContain('PT-SECRET-CONSENT-CAPTURE')
  expect(band).not.toContain('PT-SECRET-EARLIER')
})

test('a helper that changes under a running Run stops it until the original returns', async ($, on) => {
  const helperDigest = { value: EXPECTED_HELPER_SHA256 }
  const archive: ArchiveRow[] = []
  installSupportedTarget(on, { store: consentedStore(), archive, helperDigest })
  await $.session.start(session)
  await composerPrompt($)

  helperDigest.value = 'f'.repeat(64)
  const changed = await composerPrompt($)
  const status = await promptHistory($, 'status')
  helperDigest.value = EXPECTED_HELPER_SHA256
  const restored = await composerPrompt($)

  expect(changed).toMatchObject({ drop: expect.any(String) })
  expect(status.text).toContain('support: helper unavailable')
  expect(status.text).toContain('reason: digest-mismatch')
  expect(restored).toMatchObject({ text: SECRET })
  expect(archive.filter(event => event.kind === 'prompt')).toHaveLength(2)
  expect(archive.filter(event => event.kind === 'run-started')).toHaveLength(1)
})

test('status names the current Run', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore() })
  await $.session.start(session)

  const status = await promptHistory($, 'status')

  expect(status.text).toContain(`run: ${runId}`)
})

test('an end an exiting Run could not write is landed by the next Run, ahead of its own start', async ($, on) => {
  const owedEnd: LifecycleWrite = {
    kind: 'run-ended',
    eventId: 'e'.repeat(64),
    runId: earlierRunId,
    segmentId: earlierSessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
  }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: { version: 1, queue: [owedEnd], started: true, ended: true },
  }
  const archive = earlierRun(false)
  installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await composerPrompt($)

  expect(archive.map(event => [event.kind, event.runId])).toEqual([
    ['run-started', earlierRunId],
    ['prompt', earlierRunId],
    ['run-ended', earlierRunId],
    ['run-started', runId],
    ['prompt', runId],
  ])
  /* Replayed under the Run that owns it, at the instant it was taken. */
  expect(archive[2]).toMatchObject({
    eventId: 'e'.repeat(64),
    segmentId: earlierSessionId,
    occurredAt: 1_794_000_000_000,
  })
  expect((store[lifecycleKey(earlierRunId)] as { queue: unknown[] }).queue).toEqual([])
})

test('a stop that is a new Run\'s first write lands after the end another Run still owes', async ($, on) => {
  const owedEnd: LifecycleWrite = {
    kind: 'run-ended',
    eventId: 'e'.repeat(64),
    runId: earlierRunId,
    segmentId: earlierSessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
  }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: { version: 1, queue: [owedEnd], started: true, ended: true },
  }
  const archive = earlierRun(false)
  installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await promptHistory($, 'disable')

  expect(archive.map(event => [event.kind, event.runId])).toEqual([
    ['run-started', earlierRunId],
    ['prompt', earlierRunId],
    ['run-ended', earlierRunId],
    ['run-started', runId],
    ['collection-stopped', runId],
  ])
})

test('granting consent reads back what the archive already holds', async ($, on) => {
  /* The archive predates a consent that no longer holds, as a new collection
     policy version leaves it: nothing is read until consent is granted again. */
  const archive = earlierRun(true)
  const calls = installSupportedTarget(on, { ask: '启用', store: {}, archive })
  await $.session.start(session)
  expect(calls.some(call => call.argv[1] === 'timeline-read')).toBe(false)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
})
