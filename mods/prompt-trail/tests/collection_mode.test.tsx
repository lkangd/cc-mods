import { expect } from 'claude-code/testing'
import { test } from './support'
import {
  SECRET,
  boundaryCalls,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
} from './support'

const consentGranted = { policyVersion: 1, decision: 'enabled' as const }

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: consentGranted }
}

function runModeKey(forRunId: string = runId): string {
  return `prompt-trail:run-mode:${projectId}:${forRunId}`
}

function branchIds(store: Record<string, unknown>): unknown {
  const key = Object.keys(store).find(name => name.startsWith('prompt-trail:branch:'))
  return key === undefined ? undefined : store[key]
}

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
  expect(store[runModeKey()]).toMatchObject({ version: 1, mode: 'enabled' })
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
  expect(store[runModeKey()]).toMatchObject({ version: 1, mode: 'disabled' })
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
  const beforeDisable = branchIds(store) as { branchId: string; parentEventId: string | null }
  expect(beforeDisable.parentEventId).not.toBe(null)

  await promptHistory($, 'disable')
  await composerPrompt($)
  const enabled = await promptHistory($, 'enable')

  expect(enabled.text).toContain('新的根 Conversation Branch')
  const afterEnable = branchIds(store) as { branchId: string; parentEventId: string | null }
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
  expect(store[runModeKey()]).toBe(undefined)
  expect((await promptHistory($, 'status')).text)
    .toContain('Run collection mode: disabled ·')
})

test('disabling this Run leaves another Run mode untouched', async ($, on) => {
  const otherRunId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'
  const otherMode = { version: 1, mode: 'enabled' as const }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [runModeKey(otherRunId)]: otherMode,
  }
  installSupportedTarget(on, { store })
  await $.session.start(session)

  await promptHistory($, 'disable')

  expect(store[runModeKey()]).toMatchObject({ mode: 'disabled' })
  expect(store[runModeKey(otherRunId)]).toStrictEqual(otherMode)
})

test('the Run mode is stored per Run so a new Run starts from the default', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, { store })
  await $.session.start(session)

  await promptHistory($, 'disable')

  const modeKeys = Object.keys(store).filter(key => key.startsWith('prompt-trail:run-mode:'))
  expect(modeKeys).toStrictEqual([runModeKey()])
  // A durable, Run-scoped record: a reload of this Run reads it back as
  // disabled, while any other Run id has no record and collects by default.
  expect(store[runModeKey()]).toMatchObject({
    version: 1,
    mode: 'disabled',
    boundary: { kind: 'collection-stopped' },
  })
  expect(store[runModeKey('11111111-1111-4111-8111-111111111111')]).toBe(undefined)
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
  expect(store[runModeKey()]).toMatchObject({
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
  expect(store[runModeKey()]).toMatchObject({ mode: 'enabled' })
})
