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
