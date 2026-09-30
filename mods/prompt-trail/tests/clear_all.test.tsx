import { expect, test } from 'claude-code/testing'
import type { LifecycleWrite } from '../hooks/lifecycle'
import {
  boundaryCalls,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  projectRoot,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'
import type { ArchiveRow } from './support'

const PHRASE = 'delete all prompts'
const branchKey = `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
const runModeKey = `prompt-trail:run-mode:${projectId}:${runId}`
const reconcileKey = `prompt-trail:reconcile:${projectId}`

/* Issue 30: clearing a Project Timeline. Everything archived before the cut
   goes, and nothing a writer of the cleared generation still owes may reach
   the next one. */

const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' } }
}

function lifecycleKey(forRunId: string = runId): string {
  return `prompt-trail:lifecycle:${projectId}:${forRunId}`
}

function owedClear(generation?: string): LifecycleWrite {
  return {
    kind: 'clear',
    eventId: 'c'.repeat(64),
    runId: otherRun,
    segmentId: sessionId,
    branchId: 'dddddddd-eeee-4fff-8000-111111111111',
    occurredAt: 1_794_000_000_000,
    ...(generation ? { generation } : {}),
  }
}

test('an owed boundary is replayed into the generation it was owed to', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(otherRun)]: { version: 1, queue: [owedClear('gen-1')] },
  }
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  expect(boundaryCalls(calls).map(call => call.argv[10])).toEqual(['gen-1'])
  expect(archive.map(row => row.kind)).toContain('clear')
})

test('a boundary owed to a cleared generation is dropped, not carried into the next', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(otherRun)]: { version: 1, queue: [owedClear('gen-0')] },
  }
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  const result = await composerPrompt($)

  expect(result.drop).toBeUndefined()
  expect(archive.map(row => row.kind)).not.toContain('clear')
  expect((store[lifecycleKey(otherRun)] as { queue: unknown[] }).queue).toEqual([])
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
})

test('a lifecycle fact is owed to the generation in place when it happens', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, generation: { value: 'gen-7' } })

  await $.session.start(session)
  await composerPrompt($)

  const started = captureCalls(calls, 'boundary-append').filter(call => call.argv[7] === 'run-started')
  expect(started.map(call => call.argv[10])).toEqual(['gen-7'])
})

/* An archive this Run and another have written to. */
function archivedBefore(): ArchiveRow[] {
  return [1, 2].map(sequence => ({
    kind: 'prompt',
    eventId: `eeeeeeee-0000-4000-8000-00000000000${sequence}`,
    sequence,
    runId: sequence === 1 ? runId : otherRun,
    segmentId: sessionId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    parentEventId: null,
    text: `PT-SECRET-BEFORE-${sequence}`,
  }))
}

function collectingStore(): Record<string, unknown> {
  return {
    ...consentedStore(),
    [branchKey]: {
      version: 1,
      branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
      parentEventId: 'eeeeeeee-0000-4000-8000-000000000002',
      generation: 'gen-1',
    },
    [`prompt-trail:branch:${projectId}:${otherRun}:${otherRun}`]: {
      version: 1, branchId: 'bbbbbbbb-0000-4000-8000-000000000002', parentEventId: null,
    },
    [runModeKey]: { version: 1, mode: 'enabled' },
  }
}

test('clear-all with nothing archived asks nothing and removes nothing', async ($, on) => {
  const clearAsked: string[] = []
  const calls = installSupportedTarget(on, { store: consentedStore(), clearAsked })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-all')

  expect(answer.text).toBe('没有可清除的 Prompt Trail 档案。')
  expect(clearAsked).toEqual([])
  expect(captureCalls(calls, 'clear-all')).toEqual([])
})

test('clear-all shows what it removes and clears only on the exact phrase', async ($, on) => {
  const store = collectingStore()
  const archive = archivedBefore()
  const clearAsked: string[] = []
  const clearOffered: string[][] = []
  const quarantined = [{ name: '20260928T000000Z-1', path: '/q/20260928T000000Z-1', bytes: 4096 }]
  const calls = installSupportedTarget(on, {
    store, archive, clearAsked, clearOffered, quarantined, otherLiveRuns: 1,
    clearAnswers: ['返回', `  ${PHRASE.toUpperCase()}  `, `  ${PHRASE} `],
  })
  await $.session.start(session)

  const declined = await promptHistory($, 'clear-all')
  const mistyped = await promptHistory($, 'clear-all')

  expect(declined.text).toBe('已取消，未删除任何内容。')
  expect(mistyped.text).toBe('确认短语不符，未删除任何内容。')
  expect(captureCalls(calls, 'clear-all')).toEqual([])
  expect(archive).toHaveLength(2)

  const cleared = await promptHistory($, 'clear-all')

  expect(clearOffered[0]).toEqual(['取消', '返回'])
  const asked = clearAsked[0] ?? ''
  expect(asked).toContain(projectRoot)
  expect(asked).toContain('2 条 Prompt Entry')
  expect(asked).toContain('20260928T000000Z-1')
  expect(asked).toContain('另有 1 个正在运行的 Run')
  expect(asked).toContain('正在提交中的 prompt 也会被清除')
  expect(asked).toContain('Claude Code 的 transcript')
  expect(asked).toContain(PHRASE)
  /* The host names its free-text entry itself ("Type something." on this
     build): the text points at it without naming a label it may not show. */
  expect(asked).toContain('自由输入')
  expect(asked).not.toContain('Other')
  expect(asked).not.toContain('PT-SECRET')
  const clearing = captureCalls(calls, 'clear-all')
  expect(clearing).toHaveLength(1)
  /* Every Run the store knows in this project goes to the helper, which
     keeps this one's session records: it goes on. */
  expect(clearing[0]?.argv[4]).toBe(runId)
  expect((clearing[0]?.stdin ?? '').split('\n').filter(Boolean).sort()).toEqual([otherRun, runId].sort())
  expect(archive).toEqual([])
  expect(quarantined).toEqual([])
  expect(cleared.text).toContain('已清除本项目的 Prompt Trail 档案：2 条 Prompt Entry、0 个 Pending Capture、1 个隔离档案')
  expect(cleared.text).toContain('Collection consent 与当前 Run 的采集模式未改变')
  expect(cleared.text).not.toContain('PT-SECRET')
  expect(store[`prompt-trail:consent:${projectId}`]).toBeDefined()
  expect(store[runModeKey]).toEqual({ version: 1, mode: 'enabled' })
})

test('after a clear the Run goes on collecting in an empty timeline', async ($, on) => {
  const store = collectingStore()
  store[reconcileKey] = { version: 1, eventId: 'e'.repeat(64), runId: otherRun, branchId: 'b'.repeat(64), parentEventId: null, attachmentCount: 2 }
  store[lifecycleKey(otherRun)] = { version: 1, queue: [owedClear('gen-1')] }
  const archive = archivedBefore()
  const calls = installSupportedTarget(on, { store, archive, clearAnswers: [PHRASE] })
  await $.session.start(session)
  await promptHistory($, '')
  expect(JSON.stringify(await renderBand($))).toContain('PT-SECRET-BEFORE-2')

  await promptHistory($, 'clear-all')

  expect(JSON.stringify(await renderBand($))).not.toContain('PT-SECRET-BEFORE')
  expect(store[reconcileKey]).toBeUndefined()
  expect((store[lifecycleKey(otherRun)] as { queue: unknown[] }).queue).toEqual([])

  const result = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(result.drop).toBeUndefined()
  /* The Run takes the new generation up where it left the old one. */
  expect(archive.map(row => row.kind)).toContain('run-attached')
  expect(archive.filter(row => row.kind === 'prompt').map(row => row.text)).toEqual(['PT-SECRET-AFTER'])
  expect(boundaryCalls(calls).map(call => call.argv[7])).not.toContain('clear')
})

test('damage offers a clear, which lets the held submission through once confirmed', async ($, on) => {
  const store = collectingStore()
  const archive = archivedBefore()
  const unavailableOffered: string[][] = []
  const clearOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store, archive, unavailableOffered, clearOffered,
    unavailableAnswers: ['清除全部档案', '清除全部档案'],
    clearAnswers: ['返回', PHRASE],
    beginFails: 'archive-integrity',
  })
  await $.session.start(session)

  const result = await composerPrompt($, { text: 'PT-SECRET-HELD' })

  expect(unavailableOffered[0]).toEqual(['重新检查完整性', '隔离并开始新档案', '清除全部档案', '禁用当前 Run 后继续'])
  /* Going back from the confirmation returns to the damage dialog. */
  expect(unavailableOffered).toHaveLength(2)
  expect(clearOffered).toHaveLength(2)
  expect(captureCalls(calls, 'clear-all')).toHaveLength(1)
  expect(result.drop).toBeUndefined()
})

test('a clear that leaves files behind says what is left and holds the archive', async ($, on) => {
  const store = collectingStore()
  const archive = archivedBefore()
  const clearUnderway = { value: false }
  const clearLeaves = [{ name: `${projectId}.sqlite3-wal`, bytes: 0 }]
  const unavailableOffered: string[][] = []
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store, archive, clearUnderway, clearLeaves, unavailableOffered, unavailableAsked,
    clearAnswers: [PHRASE], fills: [],
  })
  await $.session.start(session)

  const stopped = await promptHistory($, 'clear-all')

  expect(stopped.text).toContain('切点已生效，旧记录不会再被读写')
  expect(stopped.text).toContain(`${projectId}.sqlite3-wal`)
  expect(stopped.text).toContain('可再次执行 /prompt-history clear-all 继续')
  /* On record for every Run of the project, not only the one that cleared. */
  expect(store[`prompt-trail:archive-state:${projectId}`]).toMatchObject({
    state: 'unavailable',
    category: 'clear-unfinished',
  })
  const status = await promptHistory($, 'status')
  expect(status.text).toContain('clear: unfinished · 1 residual')

  const held = await composerPrompt($, { text: 'PT-SECRET-HELD' })

  expect(unavailableOffered).toEqual([['继续清除', '禁用当前 Run 后继续']])
  expect(unavailableAsked[0]).toContain(`${projectId}.sqlite3-wal`)
  expect(held.drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'capture-begin')).toEqual([])
})

test('an unfinished clear is finished from the held submission without the phrase again', async ($, on) => {
  const store = collectingStore()
  const clearUnderway = { value: true }
  const clearOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store, clearUnderway, clearOffered, clearLeaves: [],
    unavailableAnswers: ['继续清除'],
  })
  await $.session.start(session)

  const result = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(clearOffered).toEqual([])
  expect(captureCalls(calls, 'clear-all')).toHaveLength(1)
  expect(result.drop).toBeUndefined()
})

test('clear-all takes up an unfinished clear with one confirmation and no phrase', async ($, on) => {
  const clearUnderway = { value: true }
  const clearOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store: collectingStore(), clearUnderway, clearOffered, clearLeaves: [],
    clearAnswers: ['继续清除'],
  })
  await $.session.start(session)

  const finished = await promptHistory($, 'clear-all')

  expect(clearOffered).toEqual([['继续清除', '取消']])
  expect(captureCalls(calls, 'clear-all')).toHaveLength(1)
  expect(finished.text).toContain('已清除本项目的 Prompt Trail 档案')
})

test('opening the timeline after another Run cleared it shows nothing cleared', async ($, on) => {
  const archive = archivedBefore()
  const generation = { value: 'gen-1' }
  installSupportedTarget(on, { store: collectingStore(), archive, generation })
  await $.session.start(session)
  await promptHistory($, '')
  expect(JSON.stringify(await renderBand($))).toContain('PT-SECRET-BEFORE-2')

  /* Another Run clears the project; this one drew the old rows. */
  archive.splice(0)
  generation.value = 'gen-2'
  /* Folded and opened again, the band reads the archive anew. */
  await promptHistory($, '')
  await promptHistory($, '')

  expect(JSON.stringify(await renderBand($))).not.toContain('PT-SECRET-BEFORE')
})

test('after a clear status names no boundary of the cleared history', async ($, on) => {
  const store = collectingStore()
  store[runModeKey] = {
    version: 1,
    mode: 'enabled',
    boundary: { kind: 'collection-started', eventId: 'eeeeeeee-0000-4000-8000-000000000009', sequence: 2 },
  }
  installSupportedTarget(on, { store, archive: archivedBefore(), clearAnswers: [PHRASE] })
  await $.session.start(session)
  expect((await promptHistory($, 'status')).text).toContain('latest collection boundary: collection-started · sequence 2')

  await promptHistory($, 'clear-all')

  expect((await promptHistory($, 'status')).text).toContain('latest collection boundary: none')
  expect(store[runModeKey]).toEqual({ version: 1, mode: 'enabled' })
})

/* Found in review (Issue 30, round 1). */

function nextGenerationRow(): ArchiveRow {
  return {
    kind: 'prompt',
    eventId: 'eeeeeeee-0000-4000-8000-0000000000a1',
    sequence: 1,
    runId: otherRun,
    segmentId: sessionId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
    parentEventId: null,
    text: 'PT-SECRET-NEXT-GENERATION',
  }
}

test('continuing a clear another Run finished meanwhile removes nothing new', async ($, on) => {
  const archive: ArchiveRow[] = []
  const clearUnderway = { value: true }
  const calls = installSupportedTarget(on, {
    store: collectingStore(), archive, clearUnderway, clearLeaves: [],
    unavailableAnswers: ['继续清除'],
    /* While this Run's dialog is up, another finishes the clear and goes
       on collecting in the next generation. */
    duringAsk: () => {
      if (!clearUnderway.value) return
      clearUnderway.value = false
      archive.push(nextGenerationRow())
    },
  })
  await $.session.start(session)

  const result = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(captureCalls(calls, 'clear-all').map(call => call.argv[8])).toEqual(['--continue'])
  expect(archive.map(row => row.text)).toContain('PT-SECRET-NEXT-GENERATION')
  expect(result.drop).toBeUndefined()
})

test('clear-all says so when the clear it would continue has finished elsewhere', async ($, on) => {
  const archive: ArchiveRow[] = []
  const clearUnderway = { value: true }
  installSupportedTarget(on, {
    store: collectingStore(), archive, clearUnderway, clearLeaves: [],
    clearAnswers: ['继续清除'],
    duringAsk: () => {
      clearUnderway.value = false
      archive.push(nextGenerationRow())
    },
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-all')

  expect(answer.text).toBe('上一次清除已由其他 Run 完成，未删除任何新记录。')
  expect(archive).toHaveLength(1)
})

test('a clear the host cut short after the cut is reported as unfinished', async ($, on) => {
  const store = collectingStore()
  const clearUnderway = { value: false }
  installSupportedTarget(on, {
    store, archive: archivedBefore(), clearUnderway, clearRejects: true,
    clearLeaves: [{ name: `${projectId}.sqlite3`, bytes: 8192 }],
    clearAnswers: [PHRASE],
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-all')

  expect(answer.text).toContain('切点已生效')
  expect(answer.text).not.toContain('未删除任何内容')
  expect(store[`prompt-trail:archive-state:${projectId}`]).toMatchObject({ category: 'clear-unfinished' })
})

test('counts the archive cannot give are said to be unknown, not zero', async ($, on) => {
  const clearAsked: string[] = []
  installSupportedTarget(on, {
    store: collectingStore(), archive: archivedBefore(), pendingUnknown: true, clearAsked,
    clearAnswers: [PHRASE],
  })
  await $.session.start(session)

  const cleared = await promptHistory($, 'clear-all')

  expect(clearAsked[0]).toContain('Pending Capture 数量无法读取')
  expect(clearAsked[0]).not.toContain('0 个 Pending Capture')
  expect(cleared.text).not.toContain('0 个 Pending Capture')
})

test('what a clear could not forget is reported, not passed over', async ($, on) => {
  const store = collectingStore()
  store[runModeKey] = {
    version: 1,
    mode: 'enabled',
    boundary: { kind: 'collection-started', eventId: 'eeeeeeee-0000-4000-8000-000000000009', sequence: 2 },
  }
  installSupportedTarget(on, {
    store, archive: archivedBefore(), clearAnswers: [PHRASE],
    storeSetFailsFor: 'prompt-trail:run-mode:', sessionsFailed: 2,
  })
  await $.session.start(session)

  const cleared = await promptHistory($, 'clear-all')

  expect(cleared.text).toContain('2 条会话索引记录未能删除')
  expect(cleared.text).toContain('部分 Prompt Trail 状态未能清理')
  expect(cleared.text).not.toContain('PT-SECRET')
})

test('a clear this Run saw but could not record does not reach the next generation', async ($, on) => {
  /* The 2.1.273 test kit, whose types this repository checks against, cannot
     raise a classic hook event; the gate's current version covers this. */
  const classic = ($ as unknown as {
    classic?: { SessionEnd: (e: { reason: string }) => Promise<unknown> }
  }).classic
  if (!classic) return
  const archive = archivedBefore()
  const options = {
    store: collectingStore(), archive, clearAnswers: [PHRASE],
    storeSetFailsFor: 'prompt-trail:lifecycle:' as string | undefined,
  }
  installSupportedTarget(on, options)
  on('classic.SessionEnd', () => ({}))
  await $.session.start(session)
  /* A `/clear` whose boundary cannot even be queued is held in memory. */
  await classic.SessionEnd({ reason: 'clear' })

  await promptHistory($, 'clear-all')
  options.storeSetFailsFor = undefined
  const result = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(result.drop).toBeUndefined()
  expect(archive.map(row => row.kind)).not.toContain('clear')
})
