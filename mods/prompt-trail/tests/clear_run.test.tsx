import { expect, test } from 'claude-code/testing'
import type { LifecycleWrite } from '../hooks/lifecycle'
import {
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
import type { ArchiveRow } from './support'

/* Issue 29: clearing the current Run. Its records go from the archive in
   place and every other Run's stay; the person confirms once. */

const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const branchKey = `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
const earlierSession = '22222222-3333-4444-8555-666666666666'
const earlierBranchKey = `prompt-trail:branch:${projectId}:${runId}:${earlierSession}`
const otherBranchKey = `prompt-trail:branch:${projectId}:${otherRun}:${otherRun}`
const runModeKey = `prompt-trail:run-mode:${projectId}:${runId}`
const otherRunModeKey = `prompt-trail:run-mode:${projectId}:${otherRun}`
const lifecycleKey = `prompt-trail:lifecycle:${projectId}:${runId}`
const reconcileKey = `prompt-trail:reconcile:${projectId}`
const consentKey = `prompt-trail:consent:${projectId}`
const archiveStateKey = `prompt-trail:archive-state:${projectId}`

const ownFirst = 'eeeeeeee-0000-4000-8000-000000000002'
const ownSecond = 'eeeeeeee-0000-4000-8000-000000000004'

/* This Run started, archived two prompts, and another Run forked from its
   first. */
function archivedBefore(): ArchiveRow[] {
  const row = (sequence: number, fields: Partial<ArchiveRow>): ArchiveRow => ({
    kind: 'prompt',
    eventId: `eeeeeeee-0000-4000-8000-00000000000${sequence}`,
    sequence,
    runId,
    segmentId: sessionId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    parentEventId: null,
    ...fields,
  })
  return [
    row(1, { kind: 'run-started', occurredAt: 1_795_000_000_000 }),
    row(2, { text: 'PT-SECRET-OWN-FIRST' }),
    row(3, {
      runId: otherRun,
      segmentId: otherRun,
      branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
      parentEventId: ownFirst,
      text: 'PT-SECRET-OTHER-FORK',
    }),
    row(4, { parentEventId: ownFirst, text: 'PT-SECRET-OWN-SECOND' }),
  ]
}

function owedDetach(): LifecycleWrite {
  return {
    kind: 'run-detached',
    eventId: 'd'.repeat(64),
    runId,
    segmentId: earlierSession,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    occurredAt: 1_794_000_000_000,
    generation: 'gen-1',
  }
}

function collectingStore(): Record<string, unknown> {
  const branch = (parentEventId: string) => ({
    version: 1,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    parentEventId,
    generation: 'gen-1',
  })
  return {
    [consentKey]: { policyVersion: 1, decision: 'enabled' },
    [branchKey]: branch(ownSecond),
    [earlierBranchKey]: branch(ownFirst),
    [otherBranchKey]: {
      version: 1, branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
      parentEventId: 'eeeeeeee-0000-4000-8000-000000000003',
    },
    [runModeKey]: {
      version: 1,
      mode: 'enabled',
      boundary: { kind: 'collection-started', eventId: 'eeeeeeee-0000-4000-8000-000000000009', sequence: 1 },
    },
    [otherRunModeKey]: {
      version: 1,
      mode: 'enabled',
      boundary: { kind: 'collection-started', eventId: 'eeeeeeee-0000-4000-8000-000000000008', sequence: 2 },
    },
    [lifecycleKey]: { version: 1, queue: [owedDetach()] },
  }
}

test('clear-run with nothing of this Run archived asks nothing and removes nothing', async ($, on) => {
  const clearAsked: string[] = []
  const archive = archivedBefore().filter(row => row.runId === otherRun)
  const calls = installSupportedTarget(on, { store: collectingStore(), archive, clearAsked })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toBe('当前 Run 没有可清除的 Prompt Trail 记录。')
  expect(clearAsked).toEqual([])
  expect(captureCalls(calls, 'clear-run')).toEqual([])
})

test('clear-run shows the Run it removes and cancelling removes nothing', async ($, on) => {
  const archive = archivedBefore()
  const clearAsked: string[] = []
  const clearOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store: collectingStore(), archive, clearAsked, clearOffered, clearAnswers: ['取消'],
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toBe('已取消，未删除任何内容。')
  expect(clearOffered).toEqual([['清除当前 Run', '取消']])
  const asked = clearAsked[0] ?? ''
  expect(asked).toContain('整条会话谱系')
  expect(asked).toContain('共 1 次')
  expect(asked).toMatch(/最早一条在 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  expect(asked).toContain('2 条 Prompt Entry、0 个 Pending Capture、1 条边界事件')
  expect(asked).toContain('其他 Run 有 1 条记录以本 Run 的条目为父节点')
  expect(asked).toContain('编号可能前移')
  expect(asked).toContain('Collection consent 与当前 Run 的采集模式不变')
  expect(asked).toContain('Claude Code 的 transcript')
  expect(asked).not.toContain('PT-SECRET')
  expect(asked).not.toContain(runId)
  expect(captureCalls(calls, 'clear-run')).toEqual([])
  expect(archive).toHaveLength(4)
})

test('a confirmed clear-run removes this Run and leaves every other Run as it was', async ($, on) => {
  const store = collectingStore()
  const archive = archivedBefore()
  store[reconcileKey] = {
    version: 1, eventId: 'e'.repeat(64), runId, branchId: 'b'.repeat(64), parentEventId: null, attachmentCount: 0,
  }
  const calls = installSupportedTarget(on, { store, archive, clearAnswers: ['清除当前 Run'] })
  await $.session.start(session)
  await promptHistory($, '')
  expect(JSON.stringify(await renderBand($))).toContain('PT-SECRET-OWN-SECOND')

  const answer = await promptHistory($, 'clear-run')

  expect(captureCalls(calls, 'clear-run').map(call => call.argv.slice(4, 5))).toEqual([[runId]])
  expect(answer.text).toContain('已清除当前 Run 的 Prompt Trail 记录：2 条 Prompt Entry、0 个 Pending Capture、1 条边界事件')
  expect(answer.text).toContain('其他 Run 的 1 条记录断开了与本 Run 的父链接')
  expect(answer.text).toContain('下一次提交开始新的根')
  expect(answer.text).not.toContain('PT-SECRET')
  expect(archive.map(row => [row.text, row.parentEventId])).toEqual([['PT-SECRET-OTHER-FORK', null]])
  expect(JSON.stringify(await renderBand($))).not.toContain('PT-SECRET-OWN')
  /* This Run's sessions start new roots; its consent and mode stay, and
     what it owed of the cleared history goes. */
  for (const key of [branchKey, earlierBranchKey]) {
    expect(store[key]).toMatchObject({ parentEventId: null, explicitRoot: true })
  }
  expect(store[consentKey]).toEqual({ policyVersion: 1, decision: 'enabled' })
  expect(store[runModeKey]).toEqual({ version: 1, mode: 'enabled' })
  expect((store[lifecycleKey] as { queue: unknown[] }).queue).toEqual([])
  expect(store[reconcileKey]).toBeUndefined()
  /* Another Run's state is its own. */
  expect(store[otherBranchKey]).toEqual(collectingStore()[otherBranchKey])
  expect(store[otherRunModeKey]).toEqual(collectingStore()[otherRunModeKey])

  const next = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(next.drop).toBeUndefined()
  expect(captureCalls(calls, 'capture-begin').at(-1)?.argv[7]).toBe('-')
  expect(archive.filter(row => row.runId === runId && row.kind === 'prompt').map(row => row.text))
    .toEqual(['PT-SECRET-AFTER'])
})

test('clear-run refuses while the project holds a quarantined archive', async ($, on) => {
  const clearAsked: string[] = []
  const quarantined = [{ name: '20260928T000000Z-1', path: '/q/20260928T000000Z-1', bytes: 4096 }]
  const calls = installSupportedTarget(on, {
    store: collectingStore(), archive: archivedBefore(), quarantined, clearAsked,
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toContain('本项目有隔离档案')
  expect(answer.text).toContain('/prompt-history clear-all')
  expect(clearAsked).toEqual([])
  expect(captureCalls(calls, 'clear-run')).toEqual([])
})

test('a Run clear that cannot empty the WAL says what is left and holds every submission', async ($, on) => {
  const store = collectingStore()
  const clearRunUnderway = { value: false }
  const clearRunLeaves = [{ name: `${projectId}.sqlite3-wal`, bytes: 32_768 }]
  const unavailableOffered: string[][] = []
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store, archive: archivedBefore(), clearRunUnderway, clearRunLeaves, unavailableOffered, unavailableAsked,
    clearAnswers: ['清除当前 Run'], fills: [],
  })
  await $.session.start(session)

  const stopped = await promptHistory($, 'clear-run')

  expect(stopped.text).toContain('逻辑删除已完成')
  expect(stopped.text).toContain('物理清除未完成')
  expect(stopped.text).toContain(`${projectId}.sqlite3-wal（32768 字节）`)
  expect(stopped.text).toContain('可再次执行 /prompt-history clear-run 继续')
  expect(store[archiveStateKey]).toMatchObject({ state: 'unavailable', category: 'clear-run-unfinished' })
  expect((await promptHistory($, 'status')).text).toContain('clear-run: unfinished · 1 residual')

  const held = await composerPrompt($, { text: 'PT-SECRET-HELD' })

  expect(unavailableOffered).toEqual([['继续清除', '禁用当前 Run 后继续']])
  expect(unavailableAsked[0]).toContain('之前确认过的一次按 Run 清除')
  expect(unavailableAsked[0]).toContain(`${projectId}.sqlite3-wal`)
  expect(held.drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'capture-begin')).toEqual([])
})

test('a held submission finishes an unfinished Run clear without asking again', async ($, on) => {
  const clearRunUnderway = { value: true, runId: otherRun }
  const clearOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store: collectingStore(), archive: archivedBefore(), clearRunUnderway, clearOffered,
    unavailableAnswers: ['继续清除'],
  })
  await $.session.start(session)

  const result = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(clearOffered).toEqual([])
  expect(captureCalls(calls, 'clear-run').map(call => call.argv[7])).toEqual(['--continue'])
  expect(result.drop).toBeUndefined()
})

test('clear-run in another Run only finishes the Run clear under way', async ($, on) => {
  const store = collectingStore()
  const archive = archivedBefore()
  const clearRunUnderway = { value: true, runId: otherRun }
  const clearOffered: string[][] = []
  const clearAsked: string[] = []
  const clearRunLeaves = [{ name: `${projectId}.sqlite3.pre-migration-v1`, bytes: 4096 }]
  store[archiveStateKey] = { version: 2, state: 'unavailable', category: 'clear-run-unfinished', since: 1 }
  installSupportedTarget(on, {
    store, archive, clearRunUnderway, clearOffered, clearAsked, clearRunLeaves,
    clearAnswers: ['继续清除'],
    /* What was left can be removed by the time the person answers. */
    duringAsk: () => {
      clearRunLeaves.splice(0)
    },
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(clearOffered).toEqual([['继续清除', '取消']])
  expect(clearAsked[0]).toContain(`${projectId}.sqlite3.pre-migration-v1`)
  expect(clearAsked[0]).not.toContain('PT-SECRET')
  expect(answer.text).toContain('之前确认过的按 Run 清除已完成。当前 Run 的记录未清除')
  expect(archive.filter(row => row.runId === runId)).toHaveLength(3)
  expect(store[branchKey]).toEqual(collectingStore()[branchKey])
  /* Finished, the archive is usable again for every Run. */
  expect(store[archiveStateKey]).toBeUndefined()
})

test('declining to continue a Run clear under way removes nothing', async ($, on) => {
  const clearRunUnderway = { value: true, runId: otherRun }
  const calls = installSupportedTarget(on, {
    store: collectingStore(), archive: archivedBefore(), clearRunUnderway, clearAnswers: ['取消'],
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toBe('已取消，未删除任何内容。')
  expect(captureCalls(calls, 'clear-run')).toEqual([])
})

test('clear-run points to clear-all while a clear-all is unfinished', async ($, on) => {
  const clearAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store: collectingStore(), clearUnderway: { value: true }, clearLeaves: [], clearAsked,
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toContain('clear-all 尚未完成')
  expect(clearAsked).toEqual([])
  expect(captureCalls(calls, 'clear-run')).toEqual([])
})

test('a pending another Run owes is left to it by a Run clear', async ($, on) => {
  const store = collectingStore()
  const owed = {
    version: 1, eventId: 'e'.repeat(64), runId: otherRun, branchId: 'b'.repeat(64), parentEventId: null, attachmentCount: 0,
  }
  store[reconcileKey] = owed
  installSupportedTarget(on, { store, archive: archivedBefore(), clearAnswers: ['清除当前 Run'] })
  await $.session.start(session)

  await promptHistory($, 'clear-run')

  expect(store[reconcileKey]).toEqual(owed)
})

test('clear-run says so when the Run clear it would continue finished elsewhere', async ($, on) => {
  const clearRunUnderway = { value: true, runId: otherRun }
  installSupportedTarget(on, {
    store: collectingStore(), archive: archivedBefore(), clearRunUnderway,
    clearAnswers: ['继续清除'],
    duringAsk: () => {
      clearRunUnderway.value = false
    },
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toBe('之前的按 Run 清除已由其他 Run 完成，未删除任何新记录。')
})

test('a Run clear the host cut short after the cut is reported as unfinished', async ($, on) => {
  const store = collectingStore()
  const clearRunUnderway = { value: false }
  installSupportedTarget(on, {
    store, archive: archivedBefore(), clearRunUnderway, clearRunRejects: true,
    clearAnswers: ['清除当前 Run'],
  })
  await $.session.start(session)

  const answer = await promptHistory($, 'clear-run')

  expect(answer.text).toContain('物理清除未完成')
  expect(answer.text).not.toContain('未删除任何内容')
  expect(store[archiveStateKey]).toMatchObject({ category: 'clear-run-unfinished' })
})

test('a branch standing on an entry a Run clear took starts a new root and goes on', async ($, on) => {
  const store = collectingStore()
  store[branchKey] = { version: 1, branchId: 'bbbbbbbb-0000-4000-8000-000000000001', parentEventId: null, explicitRoot: true }
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, archive, transcript: [], parentsChecked: true })
  await $.session.start(session)
  await composerPrompt($, { text: 'PT-SECRET-TIP' })
  const tip = archive.find(row => row.text === 'PT-SECRET-TIP')?.eventId
  /* A Run clear takes the entry this session's branch stands on. */
  archive.splice(0, archive.length, ...archive.filter(row => row.eventId !== tip))

  const result = await composerPrompt($, { text: 'PT-SECRET-AFTER' })

  expect(result.drop).toBeUndefined()
  expect(captureCalls(calls, 'capture-begin').map(call => call.argv[7])).toEqual(['-', tip, '-'])
  expect(archive.filter(row => row.kind === 'prompt').map(row => [row.text, row.parentEventId ?? null]))
    .toEqual([['PT-SECRET-AFTER', null]])
  expect(store[branchKey]).toMatchObject({ explicitRoot: true })
  expect((store[branchKey] as { branchId: string }).branchId).not.toBe('bbbbbbbb-0000-4000-8000-000000000001')
})
