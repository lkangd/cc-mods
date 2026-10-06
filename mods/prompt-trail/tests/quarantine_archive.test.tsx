import { expect } from 'claude-code/testing'
import { test } from './support'
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
import type { ArchiveRow, TargetOptions } from './support'

/* Issue 28: a damaged archive is never repaired or overwritten. A collecting
   Run held by it may check it again, quarantine it unchanged and go on in an
   empty generation, or disable itself. */

const archiveStateKey = `prompt-trail:archive-state:${projectId}`
const reconcileKey = `prompt-trail:reconcile:${projectId}:${runId}`
const branchKey = `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
const otherRun = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'
const DAMAGE_CHOICES = ['重新检查完整性', '隔离并开始新档案', '清除全部档案', '禁用当前 Run 后继续']

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' } }
}

/* One earlier Prompt Entry of this Run, the tip its branch continues from. */
function earlierEntry(): ArchiveRow {
  return {
    kind: 'prompt',
    eventId: 'eeeeeeee-0000-4000-8000-000000000001',
    sequence: 1,
    runId,
    segmentId: sessionId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    parentEventId: null,
    text: 'PT-SECRET-EARLIER',
  }
}

function onBranch(store: Record<string, unknown>, generation?: string): void {
  store[branchKey] = {
    version: 1,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    parentEventId: 'eeeeeeee-0000-4000-8000-000000000001',
    ...(generation ? { generation } : {}),
  }
}

test('helper damage blocks a submission even when the display store has no report', async ($, on) => {
  const store = consentedStore()
  const unavailableOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store,
    health: { state: 'damaged', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111' },
    fills: [], unavailableOffered,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.drop).toContain('草稿已恢复')
  expect(unavailableOffered).toStrictEqual([DAMAGE_CHOICES])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
  expect(captureCalls(calls, 'archive-health').length).toBeGreaterThan(0)
})

test('late helper damage remains visible when ordinary success deletes an older display mirror', async ($, on) => {
  const store = consentedStore()
  const health: NonNullable<TargetOptions['health']> = {
    state: 'healthy', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  let confirmed = false
  const calls = installSupportedTarget(on, {
    store, health, fills: [],
    processResponder: call => {
      if (call.argv[1] === 'capture-confirm') confirmed = true
      return undefined
    },
    beforeStoreDelete: key => {
      if (key === archiveStateKey && confirmed) {
        Object.assign(health, { state: 'damaged', token: '33333333-3333-4333-8333-333333333333' })
        store[archiveStateKey] = { version: 2, state: 'unavailable', category: 'archive-integrity', generation: 'gen-1', runId: otherRun }
      }
    },
  })
  await $.session.start(session)

  expect((await composerPrompt($)).text).toBe(SECRET)
  /* The old get→delete raced with the other Run's report and erased its
     mirror, but cannot erase the helper's guarded damage state. */
  expect(store[archiveStateKey]).toBeUndefined()
  expect(JSON.stringify(await renderBand($))).toContain('档案不可用')
  const held = await composerPrompt($, { text: 'PT-SECRET-LATER' })
  expect(held.drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
})

test('damage arriving after the health query is refused by the helper capture mutation', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = {
    state: 'healthy', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const unavailableOffered: string[][] = []
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, {
    store: consentedStore(), health, archive, fills: [], unavailableOffered,
    processResponder: call => {
      if (call.argv[1] === 'capture-begin') {
        Object.assign(health, { state: 'damaged', token: '33333333-3333-4333-8333-333333333333' })
      }
      return undefined
    },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.drop).toContain('草稿已恢复')
  expect(unavailableOffered).toStrictEqual([DAMAGE_CHOICES])
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(archive.filter(row => row.kind === 'prompt')).toHaveLength(0)
})

test('a helper healthy tombstone prevents an old damage mirror from blocking collection', async ($, on) => {
  const store = consentedStore()
  store[archiveStateKey] = {
    version: 2, state: 'unavailable', category: 'archive-integrity', runId: otherRun, generation: 'gen-1',
  }
  const calls = installSupportedTarget(on, {
    store,
    health: { state: 'healthy', generation: 'gen-1', token: '22222222-2222-4222-8222-222222222222' },
    fills: [],
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(captureCalls(calls, 'archive-health-reset')).toHaveLength(0)
})

test('damage recovery uses the generation and token bound helper reset receipt', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = {
    state: 'damaged', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const calls = installSupportedTarget(on, {
    store: consentedStore(), health, fills: [], unavailableAnswers: ['重新检查完整性'],
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  const resets = captureCalls(calls, 'archive-health-reset')
  expect(resets).toHaveLength(1)
  expect(resets[0]?.argv.slice(4, 6)).toStrictEqual(['gen-1', '11111111-1111-4111-8111-111111111111'])
  expect(health.state).toBe('healthy')
  expect(health.token).not.toBe('11111111-1111-4111-8111-111111111111')
})

test('a reset receipt without a generation is not recovery proof', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = {
    state: 'damaged', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const calls = installSupportedTarget(on, {
    store: consentedStore(), health, fills: [], unavailableAnswers: ['重新检查完整性'],
    processResponder: call => call.argv[1] === 'archive-health-reset'
      ? { exitCode: 0, stdout: JSON.stringify({ projectId, state: 'healthy', token: '22222222-2222-4222-8222-222222222222' }), stderr: '' }
      : undefined,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
  expect(health.state).toBe('damaged')
})

test('an existing archive with unknown health requires explicit initialization before collecting', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = { state: 'unknown', generation: 'gen-1', token: null }
  const store = consentedStore()
  store[archiveStateKey] = { version: 1, state: 'unavailable', category: 'archive-integrity' }
  const unavailableAsked: string[] = []
  const options: TargetOptions = { store, health, fills: [], unavailableAsked }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const held = await composerPrompt($)

  expect(held.drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
  expect(unavailableAsked[0]).toContain('档案健康状态未知')
  expect(unavailableAsked[0]).not.toContain('档案已损坏')

  store[archiveStateKey] = { version: 2, state: 'unavailable', category: 'archive-integrity', generation: 'gen-1' }
  expect((await composerPrompt($)).drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  options.unavailableAnswers = ['初始化并完整复检']
  expect((await composerPrompt($)).text).toBe(SECRET)
  expect(captureCalls(calls, 'archive-health-init')).toHaveLength(1)
  expect(health.state).toBe('healthy')
})

test('a brand new absent archive may start collection without a health initialization dialog', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = { state: 'unknown', generation: null, token: null }
  const unavailableOffered: string[][] = []
  const calls = installSupportedTarget(on, { store: consentedStore(), health, unavailableOffered })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(unavailableOffered).toHaveLength(0)
  expect(captureCalls(calls, 'archive-health-init')).toHaveLength(0)
  expect(captureCalls(calls, 'archive-health-reset')).toHaveLength(0)
  expect(health.state).toBe('healthy')
  expect(health.generation).toBe('gen-1')
})

test('an absent archive ignores a retired generation damage mirror and starts collecting', async ($, on) => {
  const store = consentedStore()
  store[archiveStateKey] = {
    version: 2, state: 'unavailable', category: 'archive-integrity', runId: otherRun, generation: 'retired-gen',
  }
  const health: NonNullable<TargetOptions['health']> = { state: 'unknown', generation: null, token: null }
  const unavailableOffered: string[][] = []
  const calls = installSupportedTarget(on, { store, health, unavailableOffered, fills: [] })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(unavailableOffered).toHaveLength(0)
  expect(captureCalls(calls, 'archive-health-init')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(health.state).toBe('healthy')
})

test('a plain retry cannot bypass unknown health and status directs explicit initialization', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = {
    state: 'healthy', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const unavailableOffered: string[][] = []
  const options: TargetOptions = {
    store: consentedStore(), health, fills: [], beginFails: 'archive-busy',
    unavailableAnswers: ['重试'], unavailableOffered,
    duringAsk: () => {
      options.beginFails = false
      Object.assign(health, { state: 'unknown', token: null })
    },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const held = await composerPrompt($)

  expect(held.drop).toContain('草稿已恢复')
  expect(unavailableOffered).toStrictEqual([
    ['重试', '禁用当前 Run 后继续'], ['初始化并完整复检', '禁用当前 Run 后继续'],
  ])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  const status = await promptHistory($, 'status')
  expect(status.text).toContain('档案健康状态未知')
  expect(status.text).toContain('初始化并完整复检')

  options.duringAsk = undefined
  options.unavailableAnswers = ['初始化并完整复检']
  expect((await composerPrompt($)).text).toBe(SECRET)
  expect(captureCalls(calls, 'archive-health-init')).toHaveLength(1)
  expect(captureCalls(calls, 'archive-health-reset')).toHaveLength(0)
})

test('enable refuses unknown helper health before writing any collection boundary', async ($, on) => {
  const store = consentedStore()
  store[`prompt-trail:run-mode:${projectId}:${runId}`] = { version: 1, mode: 'disabled' }
  const calls = installSupportedTarget(on, {
    store, health: { state: 'unknown', generation: 'gen-1', token: null },
  })
  await $.session.start(session)

  const enabled = await promptHistory($, 'enable')

  expect(enabled.text).toContain('未启用采集')
  expect(enabled.text).toContain('档案健康状态未知')
  expect(enabled.text).toContain('初始化并完整复检')
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
  expect(store[`prompt-trail:run-mode:${projectId}:${runId}`]).toMatchObject({ mode: 'disabled' })
})

test('a disabled Run can explicitly initialize unknown health while enabling', async ($, on) => {
  const store = consentedStore()
  store[`prompt-trail:run-mode:${projectId}:${runId}`] = { version: 1, mode: 'disabled' }
  const health: NonNullable<TargetOptions['health']> = { state: 'unknown', generation: 'gen-1', token: null }
  const archive = [earlierEntry()]
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store, health, archive, unavailableAsked, unavailableAnswers: ['初始化并完整复检'],
  })
  await $.session.start(session)

  const enabled = await promptHistory($, 'enable')

  expect(enabled.text).toContain('已恢复采集')
  expect(captureCalls(calls, 'archive-health-init')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(archive[0]?.text).toBe('PT-SECRET-EARLIER')
  expect(health.state).toBe('healthy')
  expect(store[`prompt-trail:run-mode:${projectId}:${runId}`]).toMatchObject({ mode: 'enabled' })
  expect(unavailableAsked[0]).not.toContain('本次提交尚未进入会话')
})

test('enable keeps a disabled Run off when explicit initialization finds damage', async ($, on) => {
  const store = consentedStore()
  store[`prompt-trail:run-mode:${projectId}:${runId}`] = { version: 1, mode: 'disabled' }
  const health: NonNullable<TargetOptions['health']> = { state: 'unknown', generation: 'gen-1', token: null }
  const calls = installSupportedTarget(on, {
    store, health, unavailableAnswers: ['初始化并完整复检'], integrity: { result: 'damaged', problems: 1 },
  })
  await $.session.start(session)

  const enabled = await promptHistory($, 'enable')

  expect(enabled.text).toContain('未启用采集')
  expect(health.state).toBe('damaged')
  expect(store[`prompt-trail:run-mode:${projectId}:${runId}`]).toMatchObject({ mode: 'disabled' })
  expect(captureCalls(calls, 'archive-health-init')).toHaveLength(1)
  expect(captureCalls(calls, 'boundary-append')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
})

test('damage offers a recheck, a quarantine, a clear, or disabling the Run', async ($, on) => {
  const store = consentedStore()
  const unavailableAsked: string[] = []
  const unavailableOffered: string[][] = []
  installSupportedTarget(on, {
    store,
    beginFails: 'archive-integrity',
    fills: [],
    unavailableAsked,
    unavailableOffered,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableOffered).toStrictEqual([DAMAGE_CHOICES])
  expect(unavailableAsked[0]).toContain('archive-integrity')
  expect(unavailableAsked[0]).toContain('旧记录原样保留')
  expect(unavailableAsked[0]).not.toContain('PT-SECRET')
  expect(result.drop).toContain('草稿已恢复')
  /* The record names the generation found damaged: that one, and no later
     one, is what a quarantine may move. */
  expect(store[archiveStateKey]).toMatchObject({
    state: 'unavailable',
    category: 'archive-integrity',
    generation: 'gen-1',
  })
})

test('damage another Run found stops this Run before it writes anything', async ($, on) => {
  const store = consentedStore()
  store[archiveStateKey] = {
    version: 2, state: 'unavailable', category: 'archive-integrity', since: 1, runId: otherRun, generation: 'gen-1',
  }
  const unavailableAsked: string[] = []
  const unavailableOffered: string[][] = []
  const calls = installSupportedTarget(on, {
    store, fills: [], unavailableAsked, unavailableOffered,
    health: { state: 'damaged', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111' },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableOffered).toStrictEqual([DAMAGE_CHOICES])
  expect(unavailableAsked[0]).toContain('由另一个 Run 报告')
  /* Neither this Run's start nor a pending goes into the damaged generation. */
  expect(captureCalls(calls, 'boundary-append')).toStrictEqual([])
  expect(captureCalls(calls, 'capture-begin')).toStrictEqual([])
  expect(result.drop).toContain('草稿已恢复')
  expect(store[archiveStateKey]).toMatchObject({ category: 'archive-integrity', runId: otherRun })
})

test('ordinary success retires a stale damage mirror when helper health is healthy', async ($, on) => {
  const store = consentedStore()
  store[archiveStateKey] = {
    version: 2, state: 'unavailable', category: 'archive-integrity', since: 1, runId: otherRun, generation: 'gen-1',
  }
  const calls = installSupportedTarget(on, {
    store, fills: [],
    health: { state: 'healthy', generation: 'gen-1', token: '22222222-2222-4222-8222-222222222222' },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'boundary-append').length).toBeGreaterThan(0)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(store[archiveStateKey]).toBeUndefined()
})

/* A pending the pre-write staged before the damage showed: the confirmation
   meets it, and the transcript proves the prompt entered, so settling the
   pending confirms it. The damage lifts once the person has chosen. */
function damagedWhileOwed(
  store: Record<string, unknown>,
  choice: TargetOptions,
): { options: TargetOptions; unavailableAsked: string[]; unavailableOffered: string[][] } {
  const unavailableAsked: string[] = []
  const unavailableOffered: string[][] = []
  const options: TargetOptions = {
    store,
    archive: [earlierEntry()],
    confirmFails: 'archive-integrity',
    messages: [{ role: 'user', text: SECRET }],
    fills: [],
    unavailableAsked,
    unavailableOffered,
    duringAsk: () => { options.confirmFails = undefined },
    ...choice,
  }
  return { options, unavailableAsked, unavailableOffered }
}

test('damage met while settling a pending offers the same choices, not an endless reconciliation', async ($, on) => {
  const store = consentedStore()
  onBranch(store, 'gen-1')
  const { options, unavailableAsked, unavailableOffered } = damagedWhileOwed(store, {
    unavailableAnswers: ['隔离并开始新档案'],
  })
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)
  expect((await composerPrompt($)).text).toBe(SECRET)

  const next = await composerPrompt($, { text: 'PT-SECRET-NEXT' })

  expect(unavailableOffered).toStrictEqual([DAMAGE_CHOICES])
  expect(unavailableAsked[0]).toContain('archive-integrity')
  expect(unavailableAsked[0]).not.toContain('PT-SECRET')
  /* The quarantine took the pending with the damaged generation; the new
     prompt starts the next one. */
  expect(captureCalls(calls, 'quarantine').map(call => call.argv[4])).toStrictEqual(['gen-1'])
  expect(next.text).toBe('PT-SECRET-NEXT')
  expect(store[reconcileKey]).toBeUndefined()
})

test('a recheck that passes over an owed pending settles it first', async ($, on) => {
  const store = consentedStore()
  onBranch(store, 'gen-1')
  const { options } = damagedWhileOwed(store, { unavailableAnswers: ['重新检查完整性'] })
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)

  const next = await composerPrompt($, { text: 'PT-SECRET-NEXT' })

  expect(captureCalls(calls, 'archive-health-reset')).toHaveLength(1)
  /* Settled from the transcript; the new prompt comes back to send again. */
  expect(options.archive?.filter(row => row.kind === 'prompt').map(row => row.text)).toContain(SECRET)
  expect(next.drop).toContain('已完成对账')
  expect(store[reconcileKey]).toBeUndefined()
})

test('a clear over an owed pending takes the pending with it', async ($, on) => {
  const store = consentedStore()
  onBranch(store, 'gen-1')
  const { options } = damagedWhileOwed(store, {
    unavailableAnswers: ['清除全部档案'],
    clearAnswers: ['delete all prompts'],
  })
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)

  const next = await composerPrompt($, { text: 'PT-SECRET-NEXT' })

  expect(captureCalls(calls, 'clear-all')).toHaveLength(1)
  expect(next.text).toBe('PT-SECRET-NEXT')
  expect(store[reconcileKey]).toBeUndefined()
})

test('disabling the Run over an owed pending lets the prompt through and keeps the pending', async ($, on) => {
  const store = consentedStore()
  onBranch(store, 'gen-1')
  const { options } = damagedWhileOwed(store, { unavailableAnswers: ['禁用当前 Run 后继续'] })
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)

  const next = await composerPrompt($, { text: 'PT-SECRET-NEXT' })

  expect(next.text).toBe('PT-SECRET-NEXT')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  /* Still owed: enable settles it before collection resumes. */
  expect(store[reconcileKey]).toBeDefined()
})

test('other shared failures keep the plain retry', async ($, on) => {
  const unavailableOffered: string[][] = []
  installSupportedTarget(on, {
    store: consentedStore(),
    beginFails: 'archive-busy',
    fills: [],
    unavailableOffered,
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(unavailableOffered).toStrictEqual([['重试', '禁用当前 Run 后继续']])
})

test('a recheck that passes lifts the report and submits the prompt once', async ($, on) => {
  const store = consentedStore()
  const options: TargetOptions = {
    store,
    beginFails: 'archive-integrity',
    fills: [],
    unavailableAnswers: ['重新检查完整性'],
    duringAsk: () => { options.beginFails = false },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'archive-health-reset')).toHaveLength(1)
  expect(captureCalls(calls, 'quarantine')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(store[archiveStateKey]).toBeUndefined()
})

test('a recheck that fails asks again with what it found, and writes nothing', async ($, on) => {
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    beginFails: 'archive-integrity',
    fills: [],
    integrity: { result: 'damaged', problems: 3 },
    unavailableAnswers: ['重新检查完整性'],
    unavailableAsked,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableAsked).toHaveLength(2)
  expect(unavailableAsked[1]).toContain('完整性检查未通过（3 个问题）')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(result.drop).toContain('草稿已恢复')
})

test('a quarantine moves the damaged generation aside and the prompt starts the next one', async ($, on) => {
  const store = consentedStore()
  onBranch(store, 'gen-1')
  const archive: ArchiveRow[] = [earlierEntry()]
  const options: TargetOptions = {
    store,
    archive,
    beginFails: 'archive-integrity',
    fills: [],
    unavailableAnswers: ['隔离并开始新档案'],
    duringAsk: () => { options.beginFails = false },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'quarantine').map(call => call.argv[4])).toStrictEqual(['gen-1'])
  expect(store[archiveStateKey]).toBeUndefined()
  /* The new generation: the quarantine, this Run taking it up, and the
     prompt on a new root. */
  expect(archive.map(row => [row.kind, row.runId])).toStrictEqual([
    ['archive-quarantined', runId],
    ['run-attached', runId],
    ['prompt', runId],
  ])
  expect(archive[2]?.parentEventId).toBeNull()
  expect(archive[2]?.text).toBe(SECRET)
  expect(store[branchKey]).toMatchObject({ parentEventId: archive[2]?.eventId, generation: 'gen-2' })
})

test('a capture meant for a generation another Run replaced starts over in the new one', async ($, on) => {
  const store = consentedStore()
  const archive: ArchiveRow[] = []
  const generation = { value: 'gen-1' }
  const calls = installSupportedTarget(on, { store, archive, generation, transcript: [] })
  await $.session.start(session)
  expect((await composerPrompt($)).text).toBe(SECRET)
  expect(store[branchKey]).toMatchObject({ generation: 'gen-1' })
  const earlier = archive.find(row => row.kind === 'prompt')!.eventId
  /* Another Run quarantines the archive meanwhile. */
  archive.splice(0, archive.length, {
    kind: 'archive-quarantined',
    eventId: 'qqqqqqqq-0000-4000-8000-000000000001',
    sequence: 1,
    runId: otherRun,
    segmentId: 'ssssssss-0000-4000-8000-000000000001',
    branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
  })
  generation.value = 'gen-2'

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  const begins = captureCalls(calls, 'capture-begin').slice(1)
  expect(begins.map(call => [call.argv[7], call.argv[12]])).toStrictEqual([
    [earlier, 'gen-1'],
    ['-', '-'],
  ])
  expect(archive.map(row => [row.kind, row.runId])).toStrictEqual([
    ['archive-quarantined', otherRun],
    ['run-attached', runId],
    ['prompt', runId],
  ])
  expect(archive[2]?.parentEventId).toBeNull()
  expect(store[branchKey]).toMatchObject({ generation: 'gen-2' })
})

test('after a restart, a branch from a replaced generation starts over before it is matched', async ($, on) => {
  const store = consentedStore()
  onBranch(store, 'gen-1')
  const archive: ArchiveRow[] = [{
    kind: 'archive-quarantined',
    eventId: 'qqqqqqqq-0000-4000-8000-000000000001',
    sequence: 1,
    runId: otherRun,
    segmentId: 'ssssssss-0000-4000-8000-000000000001',
    branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
  }]
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    archive,
    generation: { value: 'gen-2' },
    messages: [{ role: 'user', text: 'PT-SECRET-EARLIER' }, { role: 'assistant', text: 'ok' }],
    parentPane: pane,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(pane.opens).toHaveLength(0)
  expect(captureCalls(calls, 'capture-begin').map(call => [call.argv[7], call.argv[12]])).toStrictEqual([
    ['-', '-'],
  ])
  /* The process's own start lands first; then the Run taking up the new
     generation, and the prompt on a new root. */
  expect(archive.map(row => [row.kind, row.runId])).toStrictEqual([
    ['archive-quarantined', otherRun],
    ['run-started', runId],
    ['run-attached', runId],
    ['prompt', runId],
  ])
  expect(archive[3]?.parentEventId).toBeNull()
  expect(store[branchKey]).toMatchObject({ generation: 'gen-2' })
})

test('a quarantine another Run already made is taken as done', async ($, on) => {
  const store = consentedStore()
  const generation = { value: 'gen-1' }
  const health: NonNullable<TargetOptions['health']> = {
    state: 'healthy', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const options: TargetOptions = {
    store,
    generation,
    health,
    beginFails: 'archive-integrity',
    fills: [],
    unavailableAnswers: ['隔离并开始新档案'],
    /* Another Run quarantined it while this one's dialog was up. */
    duringAsk: () => {
      options.beginFails = false
      generation.value = 'gen-2'
      Object.assign(health, { state: 'healthy', generation: 'gen-2', token: '22222222-2222-4222-8222-222222222222' })
    },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'quarantine').map(call => call.argv[4])).toStrictEqual(['gen-1'])
  expect(store[archiveStateKey]).toBeUndefined()
})

test('a stale quarantine reply cannot attach or capture in a newer damaged generation', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = {
    state: 'healthy', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const generation = { value: 'gen-1' }
  const options: TargetOptions = {
    store: consentedStore(), health, generation, beginFails: 'archive-integrity', fills: [],
    unavailableAnswers: ['隔离并开始新档案'],
    duringAsk: () => {
      options.beginFails = false
      generation.value = 'gen-2'
      Object.assign(health, { state: 'damaged', generation: 'gen-2', token: '33333333-3333-4333-8333-333333333333' })
    },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.drop).toContain('草稿已恢复')
  expect(captureCalls(calls, 'boundary-append').filter(call => call.argv[7] === 'run-attached')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(health.state).toBe('damaged')
})

test('damage published after an old reset receipt must quarantine the current generation', async ($, on) => {
  const health: NonNullable<TargetOptions['health']> = {
    state: 'damaged', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111',
  }
  const generation = { value: 'gen-1' }
  const calls = installSupportedTarget(on, {
    store: consentedStore(), health, generation, fills: [],
    unavailableAnswers: ['重新检查完整性', '隔离并开始新档案'],
    processResponder: call => {
      if (call.argv[1] !== 'archive-health-reset') return undefined
      generation.value = 'gen-5'
      Object.assign(health, { state: 'damaged', generation: 'gen-5', token: '33333333-3333-4333-8333-333333333333' })
      return {
        exitCode: 0, stderr: '',
        stdout: JSON.stringify({ projectId, state: 'healthy', generation: 'gen-1', token: '22222222-2222-4222-8222-222222222222' }),
      }
    },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'quarantine').map(call => call.argv[4])).toStrictEqual(['gen-5'])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
})

test('a quarantine that fails keeps the Run held and asks again', async ($, on) => {
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    beginFails: 'archive-integrity',
    quarantineFails: 'quarantine-failed',
    fills: [],
    unavailableAnswers: ['隔离并开始新档案'],
    unavailableAsked,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableAsked).toHaveLength(2)
  expect(unavailableAsked[1]).toContain('quarantine-failed')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(result.drop).toContain('草稿已恢复')
})

test('the band shows where the quarantined records ended', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    archive: [{
      kind: 'archive-quarantined',
      eventId: 'qqqqqqqq-0000-4000-8000-000000000001',
      sequence: 1,
      runId: otherRun,
      segmentId: 'ssssssss-0000-4000-8000-000000000001',
      branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
    }],
    generation: { value: 'gen-2' },
  })
  await $.session.start(session)
  await promptHistory($)

  const band = JSON.stringify(await renderBand($))

  expect(band).toContain('此前的记录已隔离')
})

test('status names the generation, each quarantined archive and the choices', async ($, on) => {
  installSupportedTarget(on, {
    store: consentedStore(),
    beginFails: 'archive-integrity',
    fills: [],
    generation: { value: '1000012-1f5023aa-6ab9f774-350e89d' },
    quarantined: [{
      name: '20260928T000000Z-1',
      path: `/Users/tester/.claude/plugins/data/prompt-trail-inline/archives/quarantine/${projectId}/20260928T000000Z-1`,
      bytes: 8192,
    }],
  })
  await $.session.start(session)
  await composerPrompt($)

  const status = (await promptHistory($, 'status')).text ?? ''

  /* Whole: its first characters are the device and the high digits of the
     inode, which the next generation shares. */
  expect(status).toMatch(/^Archive generation: 1000012-1f5023aa-6ab9f774-350e89d$/m)
  expect(status).toContain('Quarantined archives: 1')
  expect(status).toContain(`archives/quarantine/${projectId}/20260928T000000Z-1（8192 bytes）`)
  expect(status).toContain('重新检查完整性 / 隔离并开始新档案 / 清除全部档案 / 禁用当前 Run 后继续')
  expect(status).not.toContain('PT-SECRET')
})

test('a view of a replaced generation gives way to the new one', async ($, on) => {
  const archive: ArchiveRow[] = [1, 2, 3].map(sequence => ({
    ...earlierEntry(),
    eventId: `eeeeeeee-0000-4000-8000-00000000000${sequence}`,
    sequence,
    text: `PT-SECRET-OLD-${sequence}`,
  }))
  const generation = { value: 'gen-1' }
  installSupportedTarget(on, { store: consentedStore(), archive, generation })
  await $.session.start(session)
  await promptHistory($)
  expect(JSON.stringify(await renderBand($))).toContain('PT-SECRET-OLD-3')
  /* Another Run quarantines the archive meanwhile. */
  archive.splice(0, archive.length, {
    kind: 'archive-quarantined',
    eventId: 'qqqqqqqq-0000-4000-8000-000000000001',
    sequence: 1,
    runId: otherRun,
    segmentId: 'ssssssss-0000-4000-8000-000000000001',
    branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
  })
  generation.value = 'gen-2'

  /* Folded and opened again, the band reads the archive anew. */
  await promptHistory($)
  await promptHistory($)

  const band = JSON.stringify(await renderBand($))
  expect(band).toContain('此前的记录已隔离')
  expect(band).not.toContain('PT-SECRET-OLD')
})

test('enable that meets damage names the choices the next submission offers', async ($, on) => {
  const store = consentedStore()
  const options: TargetOptions = { store }
  installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($, 'disable')
  options.boundaryFails = 'archive-integrity'

  const enabled = (await promptHistory($, 'enable')).text ?? ''

  expect(enabled).toContain('archive-integrity')
  expect(enabled).toContain('下一次提交时可选择重新检查完整性、隔离并开始新档案')
  expect(store[archiveStateKey]).toMatchObject({ category: 'archive-integrity', generation: 'gen-1' })
})

test('enable that meets damage while settling a pending names the choices, not a read failure', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    confirmFails: 'archive-integrity',
    messages: [{ role: 'user', text: SECRET }],
  })
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($, 'disable')

  const enabled = (await promptHistory($, 'enable')).text ?? ''

  expect(enabled).toContain('archive-integrity')
  expect(enabled).toContain('下一次提交时可选择重新检查完整性、隔离并开始新档案')
  expect(enabled).not.toContain('无法读取')
})

test('a recheck that finds a newer generation damaged quarantines that one', async ($, on) => {
  const store = consentedStore()
  const generation = { value: 'gen-1' }
  const options: TargetOptions = {
    store,
    generation,
    beginFails: 'archive-integrity',
    fills: [],
    integrity: { result: 'damaged', problems: 2 },
    unavailableAnswers: ['重新检查完整性', '隔离并开始新档案'],
    /* Another Run quarantined gen-1 while the first dialog was up, and the
       generation now in place is damaged too. */
    duringAsk: () => {
      if (generation.value === 'gen-1') generation.value = 'gen-5'
      else options.beginFails = false
    },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'quarantine').map(call => call.argv[4])).toStrictEqual(['gen-5'])
})

test('a recheck that fails is on record for status, across Runs and restarts', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    beginFails: 'archive-integrity',
    fills: [],
    integrity: { result: 'damaged', problems: 4 },
    unavailableAnswers: ['重新检查完整性'],
  })
  await $.session.start(session)
  await composerPrompt($)

  expect(store[archiveStateKey]).toMatchObject({ recheck: { result: 'damaged', problems: 4 } })
  expect(store[archiveStateKey]).not.toHaveProperty('recheck.text')
})

test('a record left by another Run shows its recheck in status', async ($, on) => {
  const store = consentedStore()
  store[archiveStateKey] = {
    version: 2,
    state: 'unavailable',
    category: 'archive-integrity',
    since: 1_795_000_000_000,
    runId: otherRun,
    generation: 'gen-1',
    recheck: { result: 'unreadable', problems: 0 },
  }
  installSupportedTarget(on, {
    store,
    health: { state: 'damaged', generation: 'gen-1', token: '11111111-1111-4111-8111-111111111111' },
  })
  await $.session.start(session)

  const status = (await promptHistory($, 'status')).text ?? ''

  expect(status).toContain('完整性检查未通过（档案已无法作为数据库读取）')
})

test('a quarantine left unfinished before a restart is finished by the next choice', async ($, on) => {
  const store = consentedStore()
  store[archiveStateKey] = {
    version: 2,
    state: 'unavailable',
    category: 'quarantine-failed',
    since: 1_795_000_000_000,
    runId: otherRun,
  }
  const quarantineUnderway = { value: true }
  const calls = installSupportedTarget(on, {
    store,
    fills: [],
    quarantineUnderway,
    unavailableAnswers: ['隔离并开始新档案'],
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'integrity-check')).toHaveLength(0)
  expect(captureCalls(calls, 'quarantine')).toHaveLength(1)
  expect(quarantineUnderway.value).toBe(false)
  expect(store[archiveStateKey]).toBeUndefined()
})

test('entering a new generation again after a lost branch write replays the same attach', async ($, on) => {
  const store = consentedStore()
  const archive: ArchiveRow[] = []
  const generation = { value: 'gen-1' }
  const options: TargetOptions = {
    store,
    archive,
    generation,
    transcript: [],
    fills: [],
    unavailableAnswers: ['重试'],
  }
  installSupportedTarget(on, options)
  await $.session.start(session)
  expect((await composerPrompt($)).text).toBe(SECRET)
  archive.splice(0, archive.length, {
    kind: 'archive-quarantined',
    eventId: 'qqqqqqqq-0000-4000-8000-000000000001',
    sequence: 1,
    runId: otherRun,
    segmentId: 'ssssssss-0000-4000-8000-000000000001',
    branchId: 'bbbbbbbb-0000-4000-8000-000000000002',
  })
  generation.value = 'gen-2'
  /* The attach lands, and the new root branch cannot be saved. */
  options.branchSetFailsAfter = 0
  options.duringAsk = () => { options.branchSetFailsAfter = undefined }

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(archive.map(row => row.kind)).toStrictEqual(['archive-quarantined', 'run-attached', 'prompt'])
})

test('a branch the transcript settles on names the generation it was matched in', async ($, on) => {
  const store = consentedStore()
  const entry = earlierEntry()
  const calls = installSupportedTarget(on, {
    store,
    archive: [entry],
    messages: [{ role: 'user', text: 'PT-SECRET-EARLIER' }, { role: 'assistant', text: 'ok' }],
    branchMatch: { match: 'unique', eventId: entry.eventId, candidates: [], candidateCount: 1 },
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(captureCalls(calls, 'capture-begin').map(call => [call.argv[7], call.argv[12]])).toStrictEqual([
    [entry.eventId, 'gen-1'],
  ])
})

test('a reconciliation owed in a replaced generation is dropped, not asked about', async ($, on) => {
  const store = consentedStore()
  store[`prompt-trail:reconcile:${projectId}`] = {
    version: 1,
    eventId: 'pppppppp-0000-4000-8000-000000000001',
    runId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
    parentEventId: null,
    attachmentCount: 0,
    generation: 'gen-1',
  }
  const calls = installSupportedTarget(on, {
    store,
    generation: { value: 'gen-2' },
    messages: [{ role: 'user', text: 'PT-SECRET-AMBIGUOUS' }],
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'capture-confirm').map(call => call.argv[4])).not.toContain(
    'pppppppp-0000-4000-8000-000000000001',
  )
  expect(store[reconcileKey]).toBeUndefined()
})
