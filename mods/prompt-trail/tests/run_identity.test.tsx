import { expect } from 'claude-code/testing'
import { test } from './support'
import { EXPECTED_HELPER_SHA256 } from '../hooks/artifact'
import type { LifecycleWrite } from '../hooks/lifecycle'
import {
  LIFECYCLE_QUEUE_CAPACITY,
  LIFECYCLE_QUEUE_LIMIT,
  attachRun,
  attachmentOpening,
  decideLifecycle,
  detachAbandoned,
  emptyLifecycle,
  queueLifecycleWrite,
} from '../hooks/lifecycle'
import type { ArchiveRow, ProcessCall } from './support'
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
   Entry and, when the process exited normally, its leaving. */
function earlierRun(closed: boolean): ArchiveRow[] {
  return [
    row('run-started', 1, earlierRunId),
    row('prompt', 2, earlierRunId),
    ...(closed ? [row('run-detached', 3, earlierRunId)] : []),
  ]
}

/* The lifecycle record an earlier process leaves on a Run it took up. */
function heldBy(onHost: string, closed: boolean, forSessionId = earlierSessionId) {
  return {
    version: 1,
    queue: [],
    started: true,
    attachment: {
      id: 'c0c0c0c0-d1d1-4e2e-8f3f-a4a4a4a4a4a4',
      host: onHost,
      segmentId: forSessionId,
      ...(closed ? { closed: true } : {}),
    },
  }
}

/* This process generation, as the locator names it, and another one. */
const host = '4242-100-200'
const laterHost = '5151-300-400'
const attachmentId = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5'
const laterAttachmentId = 'f6f6f6f6-a7a7-4b8b-8c9c-d0d0d0d0d0d0'

function openWrite(overrides: Partial<LifecycleWrite> = {}): Omit<LifecycleWrite, 'kind'> {
  return {
    eventId: 'a'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId,
    occurredAt: hostStartedAt,
    ...overrides,
  }
}

function attached(state = emptyLifecycle(), onHost = host, id = attachmentId) {
  return attachRun(state, openWrite(), { id, host: onHost })
}

const leaveFields = { eventId: 'e'.repeat(64), branchId, occurredAt: 1_795_000_000_000 }
const exitContext = { runId, host, end: leaveFields }

/* The Run lifecycle, replayed against the state machine directly: classic
   session events cannot be raised through the test engine. */

test('a Run\'s first attachment opens it with its one start', () => {
  const owedClear: LifecycleWrite = {
    kind: 'clear',
    eventId: 'c'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
  }
  const owing = queueLifecycleWrite(emptyLifecycle(), owedClear)

  expect(attachmentOpening(owing, host)).toBe('run-started')
  const decision = attached(owing)

  expect(decision.note).toBe('run-started')
  expect(decision.state.started).toBe(true)
  expect(decision.state.attachment).toEqual({ id: attachmentId, host, segmentId: sessionId })
  expect(decision.state.queue.map(write => write.kind)).toEqual(['run-started', 'clear'])
})

test('a later process taking up a started Run attaches rather than starting it again', () => {
  const first = attached().state
  const left = decideLifecycle(
    { ...first, queue: [] },
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    exitContext,
  ).state

  expect(attachmentOpening(left, laterHost)).toBe('run-attached')
  const again = attached({ ...left, queue: [] }, laterHost, laterAttachmentId)

  expect(again.note).toBe('run-attached')
  expect(again.write?.kind).toBe('run-attached')
  expect(again.state.attachment).toEqual({
    id: laterAttachmentId,
    host: laterHost,
    segmentId: sessionId,
  })
})

test('a crashed attachment is not closed for it; the next process simply attaches', () => {
  const crashed = attached().state

  expect(attachmentOpening(crashed, laterHost)).toBe('run-attached')
  const later = attachRun(
    crashed,
    openWrite({ eventId: 'b'.repeat(64) }),
    { id: laterAttachmentId, host: laterHost },
  )
  expect(later.state.queue.map(write => write.kind)).toEqual(['run-started', 'run-attached'])
})

test('a reload inside the same process generation opens nothing', () => {
  const open = attached().state

  expect(attachmentOpening(open, host)).toBeUndefined()
  const again = attached(open)
  expect(again.note).toBe('run-already-attached')
  expect(again.write).toBeUndefined()
  expect(again.state).toEqual(open)
})

test('an exit detaches this process once, against the session it exits from', () => {
  const open = attached().state
  const detached = decideLifecycle(
    open,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    exitContext,
  )
  const repeated = decideLifecycle(
    detached.state,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    exitContext,
  )

  expect(detached.note).toBe('run-detached')
  expect(detached.write).toEqual({
    kind: 'run-detached',
    eventId: 'e'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId,
    occurredAt: 1_795_000_000_000,
  })
  expect(detached.state.attachment?.closed).toBe(true)
  expect(repeated.note).toBe('run-detach-duplicate')
  expect(repeated.write).toBeUndefined()
})

test('an exit of a process that never attached leaves nothing to detach', () => {
  for (const reason of ['prompt_input_exit', 'logout', 'other']) {
    const decision = decideLifecycle(
      emptyLifecycle(),
      { event: 'session-end', sessionId, reason },
      exitContext,
    )
    expect(decision.note, reason).toBe('run-not-attached')
    expect(decision.write, reason).toBeUndefined()
  }
  /* Another process's open attachment is not this one's to close. */
  const elsewhere = attached(emptyLifecycle(), laterHost).state
  expect(decideLifecycle(
    elsewhere,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    exitContext,
  ).note).toBe('run-not-attached')
})

test('an exit whose detach cannot be formed leaves the attachment unclosed', () => {
  const open = attached().state
  const decision = decideLifecycle(
    open,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    { runId, host },
  )

  expect(decision.note).toBe('run-detach-unrecorded')
  expect(decision.write).toBeUndefined()
  expect(decision.state).toEqual(open)
})

test('an in-process resume that stays in the Run leaves nothing behind', () => {
  const open = attached().state
  const leaving = decideLifecycle(
    open,
    { event: 'session-end', sessionId, reason: 'resume' },
    exitContext,
  )

  expect(leaving.note).toBe('run-leaving')
  expect(leaving.write).toBeUndefined()
  expect(attachmentOpening(leaving.state, host)).toBeUndefined()
  const stayed = attached(leaving.state)
  expect(stayed.write).toBeUndefined()
  expect(stayed.state).toEqual(open)
})

test('an in-process resume into another Run detaches this one where it was left', () => {
  const open = attached().state
  const leaving = decideLifecycle(
    open,
    { event: 'session-end', sessionId, reason: 'resume' },
    exitContext,
  ).state

  const abandoned = detachAbandoned(leaving, { runId, host }, { ...leaveFields, eventId: 'f'.repeat(64) })

  expect(abandoned.note).toBe('run-detached')
  /* The detach recorded at the resume, not one made up when it was noticed. */
  expect(abandoned.write).toMatchObject({
    kind: 'run-detached',
    eventId: 'e'.repeat(64),
    segmentId: sessionId,
  })
  expect(abandoned.state.queue.at(-1)?.kind).toBe('run-detached')
  expect(abandoned.state.attachment?.closed).toBe(true)
  /* Coming back later in the same process is a new attachment. */
  expect(attachmentOpening(abandoned.state, host)).toBe('run-attached')
  /* Another process's attachment is never abandoned by this one. */
  expect(detachAbandoned(attached(emptyLifecycle(), laterHost).state, { runId, host }, leaveFields).write)
    .toBeUndefined()
})

test('a full recovery queue still takes an attachment\'s opening and its detach', () => {
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
  const opened = attached(owing)
  const detached = decideLifecycle(
    opened.state,
    { event: 'session-end', sessionId, reason: 'prompt_input_exit' },
    exitContext,
  )
  const queued = queueLifecycleWrite(detached.state, detached.write as LifecycleWrite)

  expect(opened.state.queue[0]?.kind).toBe('run-started')
  expect(queued.queue.at(-1)?.kind).toBe('run-detached')
  expect(queued.queue).toHaveLength(LIFECYCLE_QUEUE_LIMIT + 2)
  expect(queued.overflowed).toBeUndefined()
})

test('a queue at capacity refuses an opening rather than recording a stretch it never owed', () => {
  let owing = attached().state
  for (let index = owing.queue.length; index < LIFECYCLE_QUEUE_CAPACITY; index += 1) {
    owing = queueLifecycleWrite(owing, {
      kind: 'run-detached',
      eventId: index.toString(16).padStart(64, '0'),
      runId,
      segmentId: sessionId,
      branchId,
      occurredAt: 1_794_000_000_000 + index,
    })
  }
  const refused = attachRun(
    owing,
    openWrite({ eventId: 'b'.repeat(64) }),
    { id: laterAttachmentId, host: laterHost },
  )

  expect(owing.queue).toHaveLength(LIFECYCLE_QUEUE_CAPACITY)
  expect(refused.note).toBe('run-attach-refused')
  expect(refused.write).toBeUndefined()
  expect(refused.state.overflowed).toBe(true)
  expect(refused.state.attachment).toEqual(owing.attachment)
  /* Refused again once already overflowed, still not opened. */
  expect(attachRun(
    refused.state,
    openWrite({ eventId: 'c'.repeat(64) }),
    { id: laterAttachmentId, host: laterHost },
  ).note).toBe('run-attach-refused')
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
    [lifecycleKey()]: heldBy(host, false, sessionId),
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
  expect(reloaded).not.toContain('未记录离开')
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

test('bare prompt-history folds an expanded band and opens a folded one, kept per Run', async ($, on) => {
  const store: Record<string, unknown> = consentedStore()
  installSupportedTarget(on, { store })
  await $.session.start(session)
  await promptHistory($)

  const folded = await promptHistory($)
  const foldedBand = JSON.stringify(await renderBand($))
  const foldedState = store[uiKey()]
  const opened = await promptHistory($)

  expect(folded.text).toContain('Prompt Trail 已折叠')
  expect(foldedBand).toContain('▸ Prompt Trail')
  expect(foldedState).toEqual({ version: 1, expanded: false })
  expect(opened.text).toContain('Prompt Trail 已展开')
  expect(store[uiKey()]).toEqual({ version: 1, expanded: true })
})

test('a restart continues the Project Timeline under a new Run', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: heldBy(laterHost, true),
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
    ['run-detached', earlierRunId, 3],
    ['run-started', runId, 4],
    ['prompt', runId, 5],
  ])
  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('Run 离开'),
    band.lastIndexOf('Run 开始'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
  expect(band).not.toContain('未记录离开')
})

test('a Run whose process left no detach reads as unrecorded, never as left', async ($, on) => {
  const archive = earlierRun(false)
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('Run 未记录离开'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
  /* No detach is fabricated for the earlier Run, and the current Run, which
     this process has not left either, is not marked. */
  expect(archive.filter(event => event.kind === 'run-detached')).toEqual([])
  expect(band.split('未记录离开')).toHaveLength(2)
})

test('the read is bounded to the latest fixed batch', async ($, on) => {
  const archive: ArchiveRow[] = Array.from(
    { length: TIMELINE_READ_LIMIT + 5 },
    (_, index) => row('prompt', index + 1, earlierRunId),
  )
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  await promptHistory($)
  /* A band tall enough to show the whole window. */
  const band = JSON.stringify(await renderBand($, { maxRows: 400 }))

  /* The batch and one earlier entry above it; the four before that stay in
     the archive. Each keeps its place among the project's Prompt Entries. */
  /* An earlier Run's entries, none drawn by this transcript: marked ×. */
  expect(band).toContain('"× 5. PT-SECRET-EARLIER-5"')
  expect(band).toContain(`"× ${TIMELINE_READ_LIMIT + 5}. PT-SECRET-EARLIER-${TIMELINE_READ_LIMIT + 5}"`)
  expect(band).not.toContain('PT-SECRET-EARLIER-4"')
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

test('a detach an exiting process could not write is landed by the next Run, ahead of its own start', async ($, on) => {
  const owedEnd: LifecycleWrite = {
    kind: 'run-detached',
    eventId: 'e'.repeat(64),
    runId: earlierRunId,
    segmentId: earlierSessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
    generation: null,
  }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: { ...heldBy(laterHost, true), queue: [owedEnd] },
  }
  const archive = earlierRun(false)
  installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await composerPrompt($)

  expect(archive.map(event => [event.kind, event.runId])).toEqual([
    ['run-started', earlierRunId],
    ['prompt', earlierRunId],
    ['run-detached', earlierRunId],
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

test('a stop that is a new Run\'s first write lands after the detach another Run still owes', async ($, on) => {
  const owedEnd: LifecycleWrite = {
    kind: 'run-detached',
    eventId: 'e'.repeat(64),
    runId: earlierRunId,
    segmentId: earlierSessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
    generation: null,
  }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: { ...heldBy(laterHost, true), queue: [owedEnd] },
  }
  const archive = earlierRun(false)
  installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await promptHistory($, 'disable')

  expect(archive.map(event => [event.kind, event.runId])).toEqual([
    ['run-started', earlierRunId],
    ['prompt', earlierRunId],
    ['run-detached', earlierRunId],
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

/* A Run across processes. */

test('a resume in a new process continues the Run it left', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: heldBy(laterHost, true),
  }
  const archive = earlierRun(true)
  installSupportedTarget(on, { store, archive, run: { runId: earlierRunId } })
  await $.session.start(session)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(archive.map(event => [event.kind, event.runId])).toEqual([
    ['run-started', earlierRunId],
    ['prompt', earlierRunId],
    ['run-detached', earlierRunId],
    ['run-attached', earlierRunId],
    ['prompt', earlierRunId],
  ])
  expect(archive[3]).toMatchObject({ segmentId: sessionId, occurredAt: 1_795_000_000_000 })
  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('Run 离开'),
    band.indexOf('Run 续接'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
  expect(band).not.toContain('未记录离开')
})

test('a resume after a crash continues the Run and marks the stretch left unrecorded', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: heldBy(laterHost, false),
  }
  const archive = earlierRun(false)
  installSupportedTarget(on, { store, archive, run: { runId: earlierRunId } })
  await $.session.start(session)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(archive.map(event => event.kind)).toEqual(['run-started', 'prompt', 'run-attached', 'prompt'])
  const rows = [
    band.indexOf('PT-SECRET-EARLIER-2'),
    band.indexOf('Run 未记录离开'),
    band.indexOf('Run 续接'),
    band.indexOf('PT-SECRET-CONSENT-CAPTURE'),
  ]
  expect(rows.every(index => index >= 0)).toBe(true)
  expect([...rows].sort((left, right) => left - right)).toEqual(rows)
})

test('an in-process resume into another Run leaves the one the process was in', async ($, on) => {
  const store = consentedStore()
  const archive: ArchiveRow[] = []
  const classicSession = { id: sessionId }
  const identity = { runId }
  /* Each session's transcript still ends on the prompt it archived. */
  const branchMatch = (call: ProcessCall) => {
    const own = archive.filter(row => (
      row.kind === 'prompt' && row.runId === call.argv[4] && row.segmentId === call.argv[5]
    )).at(-1)
    return own
      ? {
          match: 'unique',
          eventId: own.eventId,
          candidates: [{ eventId: own.eventId, sequence: own.sequence, runId: own.runId }],
          candidateCount: 1,
        }
      : { match: 'none', candidates: [], candidateCount: 0 }
  }
  installSupportedTarget(on, { store, archive, classicSession, run: identity, branchMatch })
  await $.session.start(session)
  await composerPrompt($)

  /* `/resume` into a session of another Run: the next locator names that Run. */
  classicSession.id = earlierSessionId
  identity.runId = earlierRunId
  await composerPrompt($)

  expect(archive.map(event => [event.kind, event.runId, event.segmentId])).toEqual([
    ['run-started', runId, sessionId],
    ['prompt', runId, sessionId],
    ['run-detached', runId, sessionId],
    ['run-started', earlierRunId, earlierSessionId],
    ['prompt', earlierRunId, earlierSessionId],
  ])
  expect(store[lifecycleKey()]).toMatchObject({ queue: [], attachment: { closed: true } })

  /* And back again: the same process takes its first Run up a second time. */
  classicSession.id = sessionId
  identity.runId = runId
  await composerPrompt($)

  expect(archive.slice(5).map(event => [event.kind, event.runId])).toEqual([
    ['run-detached', earlierRunId],
    ['run-attached', runId],
    ['prompt', runId],
  ])
})

test('a Run begun by a second process in an open session names the Run it split from', async ($, on) => {
  const archive: ArchiveRow[] = [
    row('run-started', 1, earlierRunId, { segmentId: sessionId }),
    row('prompt', 2, earlierRunId, { segmentId: sessionId }),
  ]
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  await composerPrompt($)
  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(band).toContain(`Run 开始（从 Run ${earlierRunId.slice(0, 8)} 分出）`)
  expect(band.split('分出')).toHaveLength(2)
})

test('a Run switched off stays off when a later process resumes it', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: heldBy(laterHost, true),
    [`prompt-trail:run-mode:${projectId}:${earlierRunId}`]: { version: 1, mode: 'disabled' },
  }
  const archive = earlierRun(true)
  const calls = installSupportedTarget(on, { store, archive, run: { runId: earlierRunId } })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(archive).toHaveLength(3)
})

test('an archive written before Runs were lineages reads its ends as leavings', async ($, on) => {
  const archive = [
    row('run-started', 1, earlierRunId),
    row('prompt', 2, earlierRunId),
    row('run-ended', 3, earlierRunId),
  ]
  installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(band).toContain('Run 离开')
  expect(band).not.toContain('未记录离开')
})

test('an in-process resume out of a disabled Run collects in the Run it moved to', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [`prompt-trail:run-mode:${projectId}:${runId}`]: { version: 1, mode: 'disabled' },
  }
  const archive: ArchiveRow[] = []
  const classicSession = { id: sessionId }
  const identity = { runId }
  const calls = installSupportedTarget(on, { store, archive, classicSession, run: identity })
  await $.session.start(session)
  await composerPrompt($)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)

  classicSession.id = earlierSessionId
  identity.runId = earlierRunId
  const moved = await composerPrompt($)

  expect(moved).toMatchObject({ text: SECRET })
  expect(archive.map(event => [event.kind, event.runId])).toEqual([
    ['run-started', earlierRunId],
    ['prompt', earlierRunId],
  ])
})

test('a detach an older build still owed under its old name is recorded as that Run’s gap', async ($, on) => {
  const owedEnd = {
    kind: 'run-ended',
    eventId: 'e'.repeat(64),
    runId: earlierRunId,
    segmentId: earlierSessionId,
    branchId,
    occurredAt: 1_794_000_000_000,
  }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: { version: 1, queue: [owedEnd], started: true },
  }
  const archive = earlierRun(false)
  installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  await composerPrompt($)

  /* It predates boundaries naming their Archive generation, so which history
     it belongs to cannot be recovered (Issue 26): the leaving is not
     replayed, and its loss is recorded against the Run that left. */
  expect(archive[2]).toMatchObject({ kind: 'integrity-gap', runId: earlierRunId })
  expect(archive.some(row => row.eventId === 'e'.repeat(64))).toBe(false)
  expect(store[lifecycleKey(earlierRunId)]).not.toHaveProperty('damaged')
})

test('a Run resumed after a crash shows the stretch left unrecorded before anything is written', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(earlierRunId)]: heldBy(laterHost, false),
  }
  installSupportedTarget(on, { store, archive: earlierRun(false), run: { runId: earlierRunId } })
  await $.session.start(session)

  await promptHistory($)
  const band = JSON.stringify(await renderBand($))

  expect(band).toContain('Run 未记录离开')
})
