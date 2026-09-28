import { expect, test } from 'claude-code/testing'
import type { ArchiveRow } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  parentPane,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

const consentGranted = { policyVersion: 1, decision: 'enabled' as const }
/* This process's stretch of the Run, as a Run that has already archived
   something in this process records it: a reload finds it open. */
const ownAttachment = {
  id: 'b0b0b0b0-c1c1-4d2d-8e3e-f4f4f4f4f4f4',
  host: '4242-100-200',
  segmentId: sessionId,
}

function lifecycleKey(forRunId: string = runId): string {
  return `prompt-trail:lifecycle:${projectId}:${forRunId}`
}

function storeWith(lifecycle: Record<string, unknown>): Record<string, unknown> {
  return {
    [`prompt-trail:consent:${projectId}`]: consentGranted,
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [], ...lifecycle },
  }
}

function kinds(archive: readonly ArchiveRow[]): string[] {
  return [...archive].sort((left, right) => left.sequence - right.sequence).map(row => row.kind)
}

test('an overflowed recovery queue leaves a gap and its recovery ahead of the next Prompt Entry', async ($, on) => {
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  const store = storeWith({ overflowed: true })
  installSupportedTarget(on, { store, archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  const [gap, recovery] = [...archive].sort((left, right) => left.sequence - right.sequence)
  expect(gap?.runId).toBe(runId)
  expect(recovery?.runId).toBe(runId)
  expect(pane.toasts.some(text => text.includes('Integrity gap') && text.includes('恢复队列已溢出'))).toBe(true)
  /* Recorded, the loss is no longer owed. */
  const left = store[lifecycleKey()] as Record<string, unknown>
  expect(left.overflowed).toBeUndefined()
  expect(left.gap).toBeUndefined()
})

test('a gap already owed is written once however often the drain is retried', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({ overflowed: true })
  const calls = installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt', 'prompt'])
  expect(captureCalls(calls, 'boundary-append')
    .filter(call => call.argv[7] === 'integrity-gap')).toHaveLength(1)
})

test('a lifecycle record that cannot be read at all is a loss, not an empty queue', async ($, on) => {
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  const store = storeWith({})
  store[lifecycleKey()] = 'PT-NOT-A-RECORD'
  installSupportedTarget(on, { store, archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toContain('integrity-gap')
  expect(kinds(archive).slice(-3)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  expect(pane.toasts.some(text => text.includes('恢复队列有无法重放的记录'))).toBe(true)
})

test('a clear start with no end observed leaves a gap', async ($, on) => {
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  installSupportedTarget(on, { store: storeWith({ unobservedClear: true }), archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  expect(pane.toasts.some(text => text.includes('观察到无对应 SessionEnd 的 /clear'))).toBe(true)
})

test('a gap the archive will not take holds the submission and stays owed', async ($, on) => {
  const archive: ArchiveRow[] = []
  const fills: string[] = []
  const store = storeWith({ overflowed: true })
  const calls = installSupportedTarget(on, { store, archive, fills, boundaryFails: 'archive-busy' })

  await $.session.start(session)
  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.stringContaining('archive-busy') })
  expect(fills).toEqual([SECRET])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  const owed = (store[lifecycleKey()] as { gap?: { eventId: string; reasons: string[] } }).gap
  expect(owed?.reasons).toEqual(['queue-overflow'])
})

test('a gap and its recovery are drawn in a warning colour, even inside another Run’s fold', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const own = { runId, segmentId: sessionId, branchId: 'b1b1b1b1-c2c2-4d3d-8e4e-f5f5f5f5f5f5' }
  const other = { runId: otherRun, segmentId: otherRun, branchId: otherRun }
  const archive: ArchiveRow[] = [
    { kind: 'run-started', eventId: 'e1', sequence: 1, ...own },
    { kind: 'prompt', eventId: 'e2', sequence: 2, ...own, parentEventId: null, text: 'PT-SECRET-OWN' },
    { kind: 'run-started', eventId: 'e3', sequence: 3, ...other },
    { kind: 'prompt', eventId: 'e4', sequence: 4, ...other, parentEventId: null, text: 'PT-SECRET-OTHER' },
    { kind: 'integrity-gap', eventId: 'e5', sequence: 5, ...other },
    { kind: 'integrity-recovery', eventId: 'e6', sequence: 6, ...other },
  ]
  const store = storeWith({})
  store[`prompt-trail:branch:${projectId}:${runId}:${sessionId}`] = {
    version: 1, branchId: own.branchId, parentEventId: 'e2',
  }
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await promptHistory($, '')
  const band = await renderBand($)
  const drawn = JSON.stringify(band)

  expect(drawn).toContain('另一 Run')
  expect(drawn).not.toContain('PT-SECRET-OTHER')
  for (const line of ['Integrity gap：此前的记录无法证明与对话一致', '已恢复可验证采集']) {
    const node = textNodes(band).find(candidate => candidate.text.includes(line))
    expect(node?.props.color).toBe('yellow')
    expect(node?.props.dimColor).toBeUndefined()
  }
})

type TextNode = { text: string; props: Record<string, unknown> }

function textNodes(tree: unknown): TextNode[] {
  if (Array.isArray(tree)) return tree.flatMap(textNodes)
  if (!tree || typeof tree !== 'object') return []
  const node = tree as { type?: string; props?: Record<string, unknown>; children?: unknown }
  const own = node.type === 'Text' && node.props
    ? [{ text: JSON.stringify(node.children ?? node.props.children ?? ''), props: node.props }]
    : []
  return [...own, ...textNodes(node.children ?? node.props?.children)]
}

/* Issue 26 Q3: a write whose Archive generation cannot be recovered. */

function owedClear(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'clear',
    eventId: 'c'.repeat(64),
    runId,
    segmentId: sessionId,
    branchId: 'dddddddd-eeee-4fff-8000-111111111111',
    occurredAt: 1_794_000_000_000,
    ...overrides,
  }
}

test('an owed boundary that names no generation is dropped and recorded as a gap', async ($, on) => {
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  /* Queued by a build from before boundaries named their generation. */
  const store = storeWith({ queue: [owedClear()] })
  installSupportedTarget(on, { store, archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  expect(pane.toasts.some(text => text.includes('无法确定所属的档案'))).toBe(true)
  expect((store[lifecycleKey()] as { queue: unknown[] }).queue).toEqual([])
})

test('an owed boundary from when there was no archive is still replayed', async ($, on) => {
  const archive: ArchiveRow[] = []
  installSupportedTarget(on, { store: storeWith({ queue: [owedClear({ generation: null })] }), archive })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['clear', 'prompt'])
})

test('a fact stamped while the archive could not say its generation is recorded as unknown', async ($, on) => {
  const archive: ArchiveRow[] = []
  /* A new Run's start is stamped as it is formed, and this archive cannot
     answer then. */
  const store = {
    [`prompt-trail:consent:${projectId}`]: consentGranted,
  }
  installSupportedTarget(on, { store, archive, statusFails: 'archive-busy' })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
})

test('another Run’s unknown-generation boundary becomes that Run’s gap', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[lifecycleKey(otherRun)] = {
    version: 1,
    started: true,
    queue: [owedClear({ runId: otherRun, segmentId: otherRun, branchId: otherRun })],
  }
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  const ordered = [...archive].sort((left, right) => left.sequence - right.sequence)
  expect(ordered.map(row => [row.kind, row.runId])).toEqual([
    ['integrity-gap', otherRun],
    /* That Run is gone, so nothing else will ever say its collection is
       provable again. */
    ['integrity-recovery', otherRun],
    ['prompt', runId],
  ])
  expect(store[lifecycleKey(otherRun)]).toMatchObject({ queue: [] })
  expect((store[lifecycleKey(otherRun)] as { gap?: unknown }).gap).toBeUndefined()
})

test('a live Run’s gap is written for it but its recovery is left to that Run', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[lifecycleKey(otherRun)] = {
    version: 1,
    started: true,
    queue: [owedClear({ runId: otherRun, segmentId: otherRun, branchId: otherRun })],
  }
  installSupportedTarget(on, { store, archive, liveRuns: [otherRun] })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'prompt'])
  expect(store[lifecycleKey(otherRun)]).toMatchObject({ gap: { landed: true } })
})

test('a clear held in memory is owed to the generation it was seen in', async ($, on) => {
  /* The 2.1.273 test kit cannot raise a classic hook event; the gate's
     current version covers this. */
  const classic = ($ as unknown as {
    classic?: { SessionEnd: (e: { reason: string }) => Promise<unknown> }
  }).classic
  if (!classic) return
  const archive: ArchiveRow[] = []
  const generation = { value: 'gen-1' }
  const options = {
    store: storeWith({}), archive, generation,
    storeSetFailsFor: 'prompt-trail:lifecycle:' as string | undefined,
  }
  installSupportedTarget(on, options)
  on('classic.SessionEnd', () => ({}))
  await $.session.start(session)
  /* A `/clear` whose boundary cannot even be queued is held in memory. */
  await classic.SessionEnd({ reason: 'clear' })

  /* Another Run clears the project meanwhile. */
  generation.value = 'gen-2'
  archive.splice(0)
  options.storeSetFailsFor = undefined
  await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(kinds(archive)).not.toContain('clear')
})

/* Issue 26 Q4–Q7, Q12, Q13, Q16: a submission the host let through when the
   hook failed, found by the in-flight marker it left. */

const otherHost = '5151-100-200'

function markerKey(call: string, forRunId: string = runId): string {
  return `prompt-trail:inflight:${projectId}:${forRunId}:${call}`
}

function marker(stage: 'before-pending' | 'pending' | 'clear-observed', host = otherHost) {
  return {
    version: 1,
    host,
    stage,
    segmentId: sessionId,
    branchId: 'b2b2b2b2-c3c3-4d4d-8e5e-f6f6f6f6f6f6',
    at: 1_794_500_000_000,
  }
}

function inflightKeys(store: Record<string, unknown>): string[] {
  return Object.keys(store).filter(key => key.startsWith('prompt-trail:inflight:'))
}

test('a submission that settles leaves no in-flight marker behind', async ($, on) => {
  const store = storeWith({})
  const written: string[] = []
  installSupportedTarget(on, { store, afterStoreSet: key => written.push(key) })

  await $.session.start(session)
  await composerPrompt($)

  /* One was written while it was in flight. */
  expect(written.some(key => key.startsWith(`prompt-trail:inflight:${projectId}:${runId}:`))).toBe(true)
  expect(inflightKeys(store)).toEqual([])
})

test('a marker left before a pending was staged is a prompt the host let through: a gap', async ($, on) => {
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  const store = storeWith({})
  store[markerKey('crashed-call')] = marker('before-pending')
  installSupportedTarget(on, { store, archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  expect(pane.toasts.some(text => text.includes('上次提交时 Prompt Trail 出错'))).toBe(true)
  expect(inflightKeys(store)).toEqual([])
})

test('a marker a reload left in this very process is stale too', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[markerKey('before-reload')] = marker('before-pending', '4242-100-200')
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
})

test('a marker left after a pending was staged is settled by reconciliation, not a gap', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  const pendingList = [{ eventId: 'f'.repeat(36), runId, branchId: 'b2b2b2b2-c3c3-4d4d-8e5e-f6f6f6f6f6f6', parentEventId: null, attachmentCount: 0 }]
  const options = { store, archive, reconcileAnswer: '未进入' as const, pendingList: [] as Record<string, unknown>[] }
  const calls = installSupportedTarget(on, options)

  await $.session.start(session)
  /* This module has already found nothing owed. */
  await composerPrompt($)
  const listed = captureCalls(calls, 'capture-list').length
  /* Then a call of this module dies after staging. */
  store[markerKey('died-after-staging')] = marker('pending', '4242-100-200')
  options.pendingList = pendingList
  await composerPrompt($)

  expect(captureCalls(calls, 'capture-list').length).toBeGreaterThan(listed)
  expect(kinds(archive)).not.toContain('integrity-gap')
  expect(inflightKeys(store)).toEqual([])
})

test('a hook that fails after staging keeps its marker, and the next submission lists the pending again', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  let fail = true
  const calls = installSupportedTarget(on, {
    store,
    archive,
    duringSubmit: async () => {
      if (fail) throw new Error('host failed: PT-SECRET-HOST')
    },
  })

  await $.session.start(session)
  await composerPrompt($).catch(() => undefined)
  expect(inflightKeys(store)).toHaveLength(1)
  expect(Object.values(store).some(value => (value as { stage?: string }).stage === 'pending')).toBe(true)

  fail = false
  const listed = captureCalls(calls, 'capture-list').length
  await composerPrompt($)

  expect(captureCalls(calls, 'capture-list').length).toBeGreaterThan(listed)
  expect(kinds(archive)).not.toContain('integrity-gap')
})

test('a marker that cannot be written holds the submission', async ($, on) => {
  const fills: string[] = []
  const store = storeWith({})
  const calls = installSupportedTarget(on, { store, fills, storeSetFailsFor: 'prompt-trail:inflight:' })

  await $.session.start(session)
  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.stringContaining('inflight-unrecorded') })
  expect(fills).toEqual([SECRET])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
})

test('a marker another Run left is that Run’s gap once that Run is gone', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  const store = storeWith({})
  store[markerKey('other-crashed', otherRun)] = { ...marker('before-pending'), segmentId: otherRun }
  installSupportedTarget(on, { store, archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  const ordered = [...archive].sort((left, right) => left.sequence - right.sequence)
  expect(ordered.map(row => [row.kind, row.runId])).toEqual([
    ['integrity-gap', otherRun],
    ['integrity-recovery', otherRun],
    ['prompt', runId],
  ])
  /* Another Run's loss is not announced to this one. */
  expect(pane.toasts.some(text => text.includes('Integrity gap'))).toBe(false)
  expect(inflightKeys(store)).toEqual([])
})

test('a marker of a Run still live elsewhere is left alone', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[markerKey('in-flight-elsewhere', otherRun)] = marker('before-pending')
  installSupportedTarget(on, { store, archive, liveRuns: [otherRun] })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).not.toContain('integrity-gap')
  expect(inflightKeys(store)).toEqual([markerKey('in-flight-elsewhere', otherRun)])
})

test('a clear the process went with before recording it is a gap', async ($, on) => {
  const archive: ArchiveRow[] = []
  const pane = parentPane()
  const store = storeWith({})
  store[markerKey('clear-seen')] = marker('clear-observed')
  installSupportedTarget(on, { store, archive, parentPane: pane })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  expect(pane.toasts.some(text => text.includes('/clear 未能记录'))).toBe(true)
})

test('a disabled Run writes no marker and records no gap', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[`prompt-trail:run-mode:${projectId}:${runId}`] = { version: 1, mode: 'disabled' }
  store[markerKey('crashed-call')] = marker('before-pending')
  const written: string[] = []
  installSupportedTarget(on, { store, archive, afterStoreSet: key => written.push(key) })

  await $.session.start(session)
  await composerPrompt($)

  expect(written.some(key => key.startsWith('prompt-trail:inflight:'))).toBe(false)
  expect(kinds(archive)).toEqual([])
})

function classicOf($: unknown) {
  /* The 2.1.273 test kit cannot raise a classic hook event; the gate's
     current version covers these. */
  return ($ as { classic?: { SessionEnd: (e: { reason: string }) => Promise<unknown> } }).classic
}

test('a clear being recorded leaves a marker only until it is owed on record', async ($, on) => {
  const classic = classicOf($)
  if (!classic) return
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  const written: string[] = []
  installSupportedTarget(on, { store, archive, afterStoreSet: key => written.push(key) })
  on('classic.SessionEnd', () => ({}))
  await $.session.start(session)

  await classic.SessionEnd({ reason: 'clear' })

  expect(written.some(key => key.startsWith(`prompt-trail:inflight:${projectId}:${runId}:`))).toBe(true)
  expect(inflightKeys(store)).toEqual([])
  expect(kinds(archive)).toContain('clear')
})

test('a clear held in memory keeps its marker until the drain records it, and is no gap', async ($, on) => {
  const classic = classicOf($)
  if (!classic) return
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  const options = {
    store, archive,
    storeSetFailsFor: 'prompt-trail:lifecycle:' as string | undefined,
  }
  installSupportedTarget(on, options)
  on('classic.SessionEnd', () => ({}))
  await $.session.start(session)

  await classic.SessionEnd({ reason: 'clear' })
  expect(inflightKeys(store)).toHaveLength(1)

  options.storeSetFailsFor = undefined
  await composerPrompt($)

  expect(kinds(archive)).toContain('clear')
  expect(kinds(archive)).not.toContain('integrity-gap')
  expect(inflightKeys(store)).toEqual([])
})
