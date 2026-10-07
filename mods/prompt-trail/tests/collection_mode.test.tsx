import { expect } from 'claude-code/testing'
import { test } from './support'
import {
  SECRET,
  boundaryCalls,
  branchStateOf,
  captureCalls,
  composerPrompt,
  consentGranted,
  consentedStore,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
  runId,
  runModeKeyFor,
  session,
  sessionId,
} from './support'
import type { ArchiveRow, TargetOptions } from './support'

test('enable on an unconsented project asks first, then starts collection', async ($, on) => {
  const store: Record<string, unknown> = {}
  const calls = installSupportedTarget(on, { store, ask: '启用' })
  await $.session.start(session)

  const result = await promptHistory($, 'enable')

  expect(result.text).toContain('已开始采集')
  expect(store[`prompt-trail:consent:${projectId}`]).toStrictEqual(consentGranted)
  const boundaries = boundaryCalls(calls)
  expect(boundaries).toHaveLength(1)
  expect(boundaries[0]?.argv[7]).toBe('collection-started')
  // A control command is not a composer submission, so it archives no prompt.
  // Asking the archive what is unresolved is a read, not a capture.
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
  expect(store[runModeKeyFor()]).toMatchObject({ version: 1, mode: 'enabled' })
})

test('disable stops this Run without deleting entries or revoking consent', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store })
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($)

  const result = await promptHistory($, 'disable')

  expect(result.text).toContain('已停用采集')
  const boundaries = boundaryCalls(calls)
  expect(boundaries).toHaveLength(1)
  expect(boundaries[0]?.argv[7]).toBe('collection-stopped')
  expect(store[`prompt-trail:consent:${projectId}`]).toStrictEqual(consentGranted)
  expect(store[runModeKeyFor()]).toMatchObject({ version: 1, mode: 'disabled' })
  // The archived entry survives the switch being turned off.
  expect(JSON.stringify(await renderBand($)))
    .toContain(`1. ${SECRET.replace('\n', ' ↵ ')}`)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
})

test('a disabled Run passes submissions through and archives nothing', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore() })
  await $.session.start(session)
  await promptHistory($, 'disable')
  const before = calls.length

  const first = await composerPrompt($)
  const second = await composerPrompt($)

  expect(first).toMatchObject({ text: SECRET })
  expect(second).toMatchObject({ text: SECRET })
  expect(calls.slice(before).some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  expect(JSON.stringify(await renderBand($))).not.toContain('PT-SECRET')
})

test('the disabled interval is drawn as an explicit break, not as history', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore() })
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($)
  await promptHistory($, 'disable')
  await composerPrompt($)
  await promptHistory($, 'enable')
  await composerPrompt($)

  const rendered = JSON.stringify(await renderBand($))

  expect(rendered).toContain('采集已停止')
  expect(rendered).toContain('采集已恢复')
  expect(rendered).toContain('不补录')
  // Two collected prompts around one uncollected one: numbering counts only
  // the Prompt Entries and never claims the gap was recorded.
  expect(rendered).toContain('1. ')
  expect(rendered).toContain('2. ')
  expect(rendered).not.toContain('3. ')
})

test('re-enabling starts a new root Conversation Branch and back-fills nothing', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store })
  await $.session.start(session)
  await composerPrompt($)
  const beforeDisable = branchStateOf(store)
  expect(beforeDisable.parentEventId).not.toBe(null)

  await promptHistory($, 'disable')
  await composerPrompt($)
  const enabled = await promptHistory($, 'enable')

  expect(enabled.text).toContain('新的根 Conversation Branch')
  const afterEnable = branchStateOf(store)
  expect(afterEnable.branchId).not.toBe(beforeDisable.branchId)
  expect(afterEnable.parentEventId).toBe(null)
  expect(boundaryCalls(calls).map(call => call.argv[7]))
    .toStrictEqual(['collection-stopped', 'collection-resumed'])

  const begins = captureCalls(calls, 'capture-begin')
  await composerPrompt($)
  const resumed = captureCalls(calls, 'capture-begin').slice(begins.length)
  expect(resumed).toHaveLength(1)
  // A new root branch means no parent, so nothing links across the gap.
  expect(resumed[0]?.argv[7]).toBe('-')
  expect(resumed[0]?.argv[6]).toBe(afterEnable.branchId)
})

test('status reports consent, policy version, Run mode and the latest boundary', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore() })
  await $.session.start(session)
  await composerPrompt($)

  const collecting = await promptHistory($, 'status')
  expect(collecting.text).toContain('collection consent: granted · policy 1')
  expect(collecting.text).toContain('Run collection mode: enabled')
  expect(collecting.text).toContain('latest collection boundary: none')
  expect(collecting.text).not.toContain('PT-SECRET')

  await promptHistory($, 'disable')
  const stopped = await promptHistory($, 'status')
  expect(stopped.text).toContain('collection consent: granted · policy 1')
  expect(stopped.text).toContain('Run collection mode: disabled · 本 Run 已停用采集')
  expect(stopped.text).toContain('latest collection boundary: collection-stopped · sequence')
  expect(stopped.text).not.toContain('PT-SECRET')
})

test('enable on an unhealthy target never reads as a successful enable', async ($, on) => {
  const store: Record<string, unknown> = { ...consentedStore() }
  const calls = installSupportedTarget(on, { store, preflightThrows: true })
  await $.session.start(session)

  const result = await promptHistory($, 'enable')

  expect(result.text).toContain('未启用采集')
  expect(result.text).not.toContain('已开始采集')
  expect(result.text).not.toContain('已恢复采集')
  expect(boundaryCalls(calls)).toHaveLength(0)
  expect(store[runModeKeyFor()]).toBe(undefined)
  expect((await promptHistory($, 'status')).text)
    .toContain('Run collection mode: disabled ·')
})

test('disabling this Run leaves another Run mode untouched', async ($, on) => {
  const otherRunId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'
  const otherMode = { version: 1, mode: 'enabled' as const }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [runModeKeyFor(otherRunId)]: otherMode,
  }
  installSupportedTarget(on, { store })
  await $.session.start(session)

  await promptHistory($, 'disable')

  expect(store[runModeKeyFor()]).toMatchObject({ mode: 'disabled' })
  expect(store[runModeKeyFor(otherRunId)]).toStrictEqual(otherMode)
})

test('the Run mode is stored per Run so a new Run starts from the default', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, { store })
  await $.session.start(session)

  await promptHistory($, 'disable')

  const modeKeys = Object.keys(store).filter(key => key.startsWith('prompt-trail:run-mode:'))
  expect(modeKeys).toStrictEqual([runModeKeyFor()])
  // A durable, Run-scoped record: a reload of this Run reads it back as
  // disabled, while any other Run id has no record and collects by default.
  expect(store[runModeKeyFor()]).toMatchObject({
    version: 1,
    mode: 'disabled',
    boundary: { kind: 'collection-stopped' },
  })
  expect(store[runModeKeyFor('11111111-1111-4111-8111-111111111111')]).toBe(undefined)
})

test('an unreadable Run collection mode blocks the submission instead of guessing', async ($, on) => {
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    storeGetFailsFor: 'prompt-trail:run-mode:',
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(result.text).toBe(undefined)
  expect(JSON.stringify(result)).not.toContain('PT-SECRET')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('a disabled Run passes through even when project identity becomes unprovable', async ($, on) => {
  const options = { store: consentedStore(), gitExitCode: 0, hasGitDirectory: true }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)
  await promptHistory($, 'disable')
  const before = calls.length

  // The project root stops being provable after the Run was switched off.
  options.gitExitCode = 128
  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(calls.slice(before).some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('a disable landing mid-flight discards the capture instead of archiving it', async ($, on) => {
  let disable: (() => Promise<void>) | undefined
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    duringSubmit: async () => {
      await disable?.()
      disable = undefined
    },
  })
  await $.session.start(session)
  disable = async () => { await promptHistory($, 'disable') }

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  // The stop boundary says later prompts were not recorded, so the capture the
  // stop overtook is aborted rather than confirmed behind it.
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(JSON.stringify(await renderBand($))).not.toContain('PT-SECRET')
})

test('a stop boundary that never landed blocks resume until it is written', async ($, on) => {
  const store = consentedStore()
  const options = { store, boundaryFails: true }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const disabled = await promptHistory($, 'disable')
  expect(disabled.text).toContain('未能写入 Collection Boundary')
  expect(store[runModeKeyFor()]).toMatchObject({
    mode: 'disabled',
    stopBoundaryMissing: true,
  })

  /* The Run's own start never landed either, so it is what enable meets
     first; either way nothing resumes. */
  const refused = await promptHistory($, 'enable')
  expect(refused.text).toContain('未启用采集')
  expect(boundaryCalls(calls)
    .filter(call => call.argv[7] === 'collection-resumed')).toHaveLength(0)

  // Once the archive accepts writes again, enable writes the missing stop
  // first, then the resume.
  options.boundaryFails = false
  const resumed = await promptHistory($, 'enable')
  expect(resumed.text).toContain('已恢复采集')
  const landed = boundaryCalls(calls).map(call => call.argv[7])
  expect(landed.slice(-2)).toStrictEqual(['collection-stopped', 'collection-resumed'])
  expect(store[runModeKeyFor()]).toMatchObject({ mode: 'enabled' })
})

/* What a disable leaves in the archive when only its stop lands: the Run's
   start and its `collection-stopped`, and no record in the store. */
function stoppedArchive(): ArchiveRow[] {
  const row = (kind: string, sequence: number): ArchiveRow => ({
    kind,
    eventId: `eeeeeeee-0000-4000-8000-00000000000${sequence}`,
    sequence,
    runId,
    segmentId: sessionId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000001',
  })
  return [row('run-started', 1), row('collection-stopped', 2)]
}

test('a disable the store cannot hold is kept by its stop boundary in the archive', async ($, on) => {
  const store = consentedStore()
  const archive: ArchiveRow[] = []
  installSupportedTarget(on, { store, archive, storeSetFailsFor: 'prompt-trail:run-mode:' })
  await $.session.start(session)

  const result = await promptHistory($, 'disable')

  expect(result.text).toContain('已写入 Collection Boundary')
  expect(result.text).toContain('reload 后由档案中的这条 Collection Boundary 保持停用')
  expect(result.text).not.toContain('reload 后可能回到默认值')
  expect(store[runModeKeyFor()]).toBe(undefined)
  /* What the next module instance of this Run finds: no record of the
     switch, and the Run's stop as its latest Collection Boundary. */
  expect(archive.filter(row => row.runId === runId && row.kind.startsWith('collection-'))
    .map(row => row.kind)).toStrictEqual(['collection-stopped'])
})

test('after a reload, a Run the store has no record of stays disabled by its stop in the archive', async ($, on) => {
  const store = consentedStore()
  const archive = stoppedArchive()
  const calls = installSupportedTarget(on, { store, archive })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  expect(archive.some(row => row.kind === 'prompt')).toBe(false)
  const status = await promptHistory($, 'status')
  expect(status.text).toContain('Run collection mode: disabled · 本 Run 已停用采集')
  expect(status.text).toContain('latest collection boundary: collection-stopped · sequence 2')
  /* Enable resumes it as the disabled Run it is. */
  expect((await promptHistory($, 'enable')).text).toContain('已恢复采集')
  expect(boundaryCalls(calls).map(call => call.argv[7])).toStrictEqual(['collection-resumed'])
})

test('a Run whose latest boundary in the archive resumed collection collects when the store is silent', async ($, on) => {
  const archive: ArchiveRow[] = [...stoppedArchive(), {
    kind: 'collection-resumed',
    eventId: 'eeeeeeee-0000-4000-8000-000000000003',
    sequence: 3,
    runId,
    segmentId: sessionId,
    branchId: 'bbbbbbbb-0000-4000-8000-000000000003',
  }]
  const calls = installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  expect((await composerPrompt($)).text).toBe(SECRET)

  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(archive.filter(row => row.kind === 'prompt')).toHaveLength(1)
})

test('another Run\'s stop in the archive does not disable this one', async ($, on) => {
  const otherRunId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'
  const archive = stoppedArchive().map(row => ({ ...row, runId: otherRunId }))
  const calls = installSupportedTarget(on, { store: consentedStore(), archive })
  await $.session.start(session)

  expect((await composerPrompt($)).text).toBe(SECRET)

  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(captureCalls(calls, 'run-collection-state').map(call => call.argv[4])).toStrictEqual([runId])
})

test('a stop that never landed, in a store that cannot hold the switch, still warns of a reload', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, { store, boundaryFails: true, storeSetFailsFor: 'prompt-trail:run-mode:' })
  await $.session.start(session)

  const result = await promptHistory($, 'disable')

  expect(result.text).toContain('未能写入 Collection Boundary')
  expect(result.text).toContain('reload 后可能回到默认值')
  expect(result.text).not.toContain('保持停用')
  /* The switch still holds for this module instance. */
  expect((await composerPrompt($)).text).toBe(SECRET)
})

test('a record the store cannot overwrite goes, so a reload reads the stop in the archive', async ($, on) => {
  const store = { ...consentedStore(), [runModeKeyFor()]: { version: 1, mode: 'enabled' } }
  installSupportedTarget(on, { store, storeSetFailsFor: 'prompt-trail:run-mode:' })
  await $.session.start(session)

  const result = await promptHistory($, 'disable')

  expect(result.text).toContain('已写入 Collection Boundary')
  expect(result.text).toContain('reload 后由档案中的这条 Collection Boundary 保持停用')
  expect(store[runModeKeyFor()]).toBe(undefined)
})

test('a record the store can neither overwrite nor delete is what a reload reads, so the warning stays', async ($, on) => {
  const store = { ...consentedStore(), [runModeKeyFor()]: { version: 1, mode: 'enabled' } }
  installSupportedTarget(on, {
    store,
    storeSetFailsFor: 'prompt-trail:run-mode:',
    beforeStoreDelete: key => {
      if (key === runModeKeyFor()) throw new Error('store unavailable: PT-SECRET-STORE-DELETE')
    },
  })
  await $.session.start(session)

  const result = await promptHistory($, 'disable')

  expect(result.text).toContain('已写入 Collection Boundary')
  expect(result.text).toContain('reload 后可能回到默认值')
  expect(store[runModeKeyFor()]).toStrictEqual({ version: 1, mode: 'enabled' })
})

test('an archive that cannot say what the store does not know holds the submission, and disable still stops', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, collectionStateFails: 'archive-busy', fills: [] })
  await $.session.start(session)

  const held = await composerPrompt($)

  expect(held).toMatchObject({ drop: expect.any(String) })
  expect(JSON.stringify(held)).toContain('archive-busy')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  expect((await promptHistory($, 'status')).text).toContain('Run collection mode: unknown')

  const disabled = await promptHistory($, 'disable')
  expect(disabled.text).toContain('已停用采集')
  expect(store[runModeKeyFor()]).toMatchObject({ mode: 'disabled' })
  expect((await composerPrompt($)).text).toBe(SECRET)
})

/* PT-SEC-003 on 2.1.290: before consent nothing is collected, so an archive
   that cannot say this Run's mode (here a legacy archive no health record
   vouches for) does not let the first submission past the consent question. */
test('an archive that cannot say the Run mode still asks consent before the first submission', async ($, on) => {
  const store: Record<string, unknown> = {}
  installSupportedTarget(on, { store, collectionStateFails: 'archive-health-unknown', ask: '启用', fills: [] })
  await $.session.start(session)

  await composerPrompt($)

  expect(store[`prompt-trail:consent:${projectId}`]).toStrictEqual(consentGranted)
})

test('an archive that still cannot say the Run mode once consent is given holds the first submission', async ($, on) => {
  const store: Record<string, unknown> = {}
  const calls = installSupportedTarget(on, { store, collectionStateFails: 'archive-busy', ask: '启用', fills: [] })
  await $.session.start(session)

  const held = await composerPrompt($)

  expect(store[`prompt-trail:consent:${projectId}`]).toStrictEqual(consentGranted)
  expect(held).toMatchObject({ drop: expect.any(String) })
  expect(JSON.stringify(held)).toContain('archive-busy')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('a stop the archive could not say before consent still keeps the Run disabled after it', async ($, on) => {
  const store: Record<string, unknown> = {}
  const archive = stoppedArchive()
  const options: TargetOptions = { store, archive, collectionStateFails: 'archive-busy', fills: [] }
  /* The archive answers again while the person is being asked. */
  Object.defineProperty(options, 'ask', {
    get: () => {
      options.collectionStateFails = undefined
      return '启用'
    },
  })
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(store[`prompt-trail:consent:${projectId}`]).toStrictEqual(consentGranted)
  expect(result).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  expect(archive.some(row => row.kind === 'prompt')).toBe(false)
})
