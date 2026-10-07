import { expect } from 'claude-code/testing'
import { test } from './support'
import type { ArchiveRow } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  parentPane,
  projectId,
  promptHistory,
  renderBand,
  runId,
  runModeKeyFor,
  session,
  sessionId,
} from './support'

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
  return consentedStore({
    [lifecycleKey()]: { version: 1, started: true, attachment: ownAttachment, queue: [], ...lifecycle },
  })
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
  const store = consentedStore()
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
  const classic = $.classic
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
  /* The failed call stopped being live, so its marker was judged and went. */
  expect(inflightKeys(store)).toEqual([])
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
  store[runModeKeyFor()] = { version: 1, mode: 'disabled' }
  store[markerKey('crashed-call')] = marker('before-pending')
  const written: string[] = []
  installSupportedTarget(on, { store, archive, afterStoreSet: key => written.push(key) })

  await $.session.start(session)
  await composerPrompt($)

  expect(written.some(key => key.startsWith('prompt-trail:inflight:'))).toBe(false)
  expect(kinds(archive)).toEqual([])
})


test('a clear being recorded leaves a marker only until it is owed on record', async ($, on) => {
  const classic = $.classic
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
  const classic = $.classic
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

/* Issue 26 Q14: stopping and resuming a Run that owes a gap. */

test('a gap owed at disable lands ahead of the stop, and its recovery waits for the resume', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({ overflowed: true })
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await promptHistory($, 'disable')
  expect(kinds(archive)).toEqual(['integrity-gap', 'collection-stopped'])

  await promptHistory($, 'enable')
  expect(kinds(archive)).toEqual([
    'integrity-gap', 'collection-stopped', 'collection-resumed', 'integrity-recovery',
  ])
  expect((store[lifecycleKey()] as { gap?: unknown }).gap).toBeUndefined()
})

test('a gap found while the Run is disabled lands at enable, ahead of the resume', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[runModeKeyFor()] = { version: 1, mode: 'disabled' }
  store[markerKey('crashed-before-disable')] = marker('before-pending')
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)
  expect(kinds(archive)).toEqual([])

  await promptHistory($, 'enable')
  expect(kinds(archive)).toEqual(['integrity-gap', 'collection-resumed', 'integrity-recovery'])
})

/* Issue 26 Q10: clearing takes what a gap would have described. */

function ownRecords(): ArchiveRow[] {
  return [
    { kind: 'run-started', eventId: 'e1', sequence: 1, runId, segmentId: sessionId, branchId: 'b' },
    { kind: 'prompt', eventId: 'e2', sequence: 2, runId, segmentId: sessionId, branchId: 'b', parentEventId: null, text: 'PT-SECRET-OWN' },
  ]
}

test('a Run clear forgets the gap the Run owed, its losses and its stale markers', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive = ownRecords()
  const store = storeWith({ overflowed: true, damaged: true, unobservedClear: true })
  store[markerKey('crashed-call')] = marker('before-pending')
  store[markerKey('other-call', otherRun)] = marker('before-pending')
  installSupportedTarget(on, { store, archive, clearAnswers: ['清除当前 Run'], liveRuns: [otherRun] })

  await $.session.start(session)
  await promptHistory($, 'clear-run')

  const left = store[lifecycleKey()] as Record<string, unknown>
  expect(left.overflowed).toBeUndefined()
  expect(left.damaged).toBeUndefined()
  expect(left.unobservedClear).toBeUndefined()
  expect(left.gap).toBeUndefined()
  /* Another Run's marker is that Run's. */
  expect(inflightKeys(store)).toEqual([markerKey('other-call', otherRun)])

  await composerPrompt($)
  expect(kinds(archive)).not.toContain('integrity-gap')
})

test('a clear-all forgets every gap owed and every marker no live Run holds', async ($, on) => {
  const liveRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const goneRun = 'cccccccc-dddd-4eee-8fff-000000000000'
  const archive = ownRecords()
  const store = storeWith({ overflowed: true })
  store[lifecycleKey(goneRun)] = {
    version: 1, queue: [],
    gap: { eventId: 'g'.repeat(8), runId: goneRun, segmentId: goneRun, branchId: goneRun, occurredAt: 1, generation: null, reasons: ['fail-open'] },
  }
  store[markerKey('crashed-call')] = marker('before-pending')
  store[markerKey('gone-call', goneRun)] = marker('before-pending')
  store[markerKey('live-call', liveRun)] = marker('before-pending')
  installSupportedTarget(on, { store, archive, clearAnswers: ['delete all prompts'], liveRuns: [liveRun] })

  await $.session.start(session)
  await promptHistory($, 'clear-all')

  expect((store[lifecycleKey()] as Record<string, unknown>).overflowed).toBeUndefined()
  expect((store[lifecycleKey(goneRun)] as Record<string, unknown>).gap).toBeUndefined()
  expect(inflightKeys(store)).toEqual([markerKey('live-call', liveRun)])

  await composerPrompt($)
  expect(kinds(archive)).not.toContain('integrity-gap')
})

/* Issue 26 Q11: what status says. */

function statusLine(text: string | undefined, prefix: string): string | undefined {
  return text?.split('\n').find(line => line.startsWith(prefix))
}

test('status says a gap is owed, then that the project’s history holds one', async ($, on) => {
  const archive: ArchiveRow[] = []
  installSupportedTarget(on, { store: storeWith({ overflowed: true }), archive })
  await $.session.start(session)

  const before = await promptHistory($, 'status')
  expect(statusLine(before.text, 'integrity:')).toBe(
    'integrity: gap owed · 恢复队列已溢出，部分 Clear Boundary 或 Run 边界未记录（下一次提交前写入时间线）',
  )
  expect(statusLine(before.text, 'integrity gaps:')).toBe('integrity gaps: 0')

  await composerPrompt($)
  const after = await promptHistory($, 'status')
  expect(statusLine(after.text, 'integrity:')).toBe('integrity: healthy')
  expect(statusLine(after.text, 'integrity gaps:')).toBe(
    'integrity gaps: 1 · 本项目的时间线跨越这些 Integrity gap 的部分不完整',
  )
  /* The losses are reported once, as the gap they became. */
  expect(after.text).not.toContain('恢复队列已溢出')
})

test('status says an unfinished call is still to be judged', async ($, on) => {
  const store = storeWith({})
  store[markerKey('crashed-call')] = marker('before-pending')
  installSupportedTarget(on, { store })
  await $.session.start(session)

  const status = await promptHistory($, 'status')

  expect(statusLine(status.text, 'integrity:')).toBe(
    'integrity: healthy · 1 次提交未正常结束，下一次提交时判定是否形成 Integrity gap',
  )
})

test('status says so when the gap count cannot be read', async ($, on) => {
  installSupportedTarget(on, { store: storeWith({}), statusFails: 'archive-busy' })
  await $.session.start(session)

  const status = await promptHistory($, 'status')

  expect(statusLine(status.text, 'integrity gaps:')).toBe('integrity gaps: unknown')
})

/* Regressions from the Issue 26 mutation check. */

test('a loss found before the owed gap lands is one more reason for the same gap', async ($, on) => {
  const owed = {
    eventId: 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5', runId, segmentId: sessionId,
    branchId: 'b2b2b2b2-c3c3-4d4d-8e5e-f6f6f6f6f6f6', occurredAt: 1_794_000_000_000,
    generation: null, reasons: ['fail-open'],
  }
  const store = storeWith({ gap: owed, overflowed: true })
  installSupportedTarget(on, { store, boundaryFails: 'archive-busy' })

  await $.session.start(session)
  await composerPrompt($)

  expect((store[lifecycleKey()] as { gap?: unknown }).gap).toEqual({
    ...owed, reasons: ['fail-open', 'queue-overflow'],
  })
})

test('a recovery that does not land is retried dated as first formed', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({ overflowed: true })
  let clock: import('claude-code/testing').MockClock | undefined
  const options = {
    store, archive,
    boundaryFailsFor: { kind: 'integrity-recovery' } as { kind: string } | undefined,
    onClock: (mocked: import('claude-code/testing').MockClock) => { clock = mocked },
  }
  installSupportedTarget(on, options)

  await $.session.start(session)
  await composerPrompt($)
  const owed = (store[lifecycleKey()] as { gap?: { landed?: boolean; recoveryAt?: number } }).gap
  expect(owed?.landed).toBe(true)
  expect(kinds(archive)).toEqual(['integrity-gap'])

  await clock?.advance(60_000)
  options.boundaryFailsFor = undefined
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'integrity-recovery', 'prompt'])
  const recovery = archive.find(row => row.kind === 'integrity-recovery')
  expect(recovery?.occurredAt).toBe(owed?.recoveryAt)
})

test('a gap owed to a generation since cleared goes with it and blocks nothing', async ($, on) => {
  const archive: ArchiveRow[] = []
  const store = storeWith({
    overflowed: true,
    gap: {
      eventId: 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5', runId, segmentId: sessionId,
      branchId: 'b2b2b2b2-c3c3-4d4d-8e5e-f6f6f6f6f6f6', occurredAt: 1_794_000_000_000,
      generation: 'gen-0', reasons: ['queue-overflow'],
    },
  })
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  const result = await composerPrompt($)

  expect(result.drop).toBeUndefined()
  expect(kinds(archive)).toEqual(['prompt'])
  const left = store[lifecycleKey()] as Record<string, unknown>
  expect(left.gap).toBeUndefined()
  expect(left.overflowed).toBeUndefined()
})

/* Regressions from the Issue 26 code review. */

test('another Run that is gone with its losses only on record is that Run’s gap', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[lifecycleKey(otherRun)] = { version: 1, started: true, queue: [], overflowed: true }
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  const ordered = [...archive].sort((left, right) => left.sequence - right.sequence)
  expect(ordered.map(row => [row.kind, row.runId])).toEqual([
    ['integrity-gap', otherRun],
    ['integrity-recovery', otherRun],
    ['prompt', runId],
  ])
  expect((store[lifecycleKey(otherRun)] as Record<string, unknown>).overflowed).toBeUndefined()
})

test('another Run’s lifecycle record that cannot be read is that Run’s gap once it is gone', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[lifecycleKey(otherRun)] = 'PT-NOT-A-RECORD'
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  expect([...archive].sort((left, right) => left.sequence - right.sequence)
    .map(row => [row.kind, row.runId])).toEqual([
    ['integrity-gap', otherRun],
    ['integrity-recovery', otherRun],
    ['prompt', runId],
  ])
})

test('a live Run’s losses are left for that Run to record', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[lifecycleKey(otherRun)] = { version: 1, started: true, queue: [], overflowed: true }
  installSupportedTarget(on, { store, archive, liveRuns: [otherRun] })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).not.toContain('integrity-gap')
  expect(store[lifecycleKey(otherRun)]).toMatchObject({ overflowed: true })
})

test('a gone Run whose collection is disabled gets its gap but no recovery', async ($, on) => {
  const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  const archive: ArchiveRow[] = []
  const store = storeWith({})
  store[lifecycleKey(otherRun)] = { version: 1, started: true, queue: [], overflowed: true }
  store[runModeKeyFor(otherRun)] = { version: 1, mode: 'disabled' }
  installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  expect(kinds(archive)).toEqual(['integrity-gap', 'prompt'])
  expect(store[lifecycleKey(otherRun)]).toMatchObject({ gap: { landed: true } })
})

test('a prompt let through by disabling the Run leaves no marker, even if the host then fails it', async ($, on) => {
  const store = storeWith({})
  installSupportedTarget(on, {
    store,
    beginFails: 'archive-busy',
    unavailableAnswers: ['禁用当前 Run 后继续'],
    duringSubmit: async () => {
      throw new Error('host failed: PT-SECRET-HOST')
    },
  })

  await $.session.start(session)
  await composerPrompt($).catch(() => undefined)

  expect(inflightKeys(store)).toEqual([])
})

test('a leaving held at an in-process resume is owed to the generation it happened in', async ($, on) => {
  const classic = $.classic
  const store = storeWith({})
  installSupportedTarget(on, { store, generation: { value: 'gen-7' } })
  on('classic.SessionEnd', () => ({}))
  await $.session.start(session)
  await composerPrompt($)

  await classic.SessionEnd({ reason: 'resume' })

  expect(store[lifecycleKey()]).toMatchObject({ attachment: { leaving: { generation: 'gen-7' } } })
})
