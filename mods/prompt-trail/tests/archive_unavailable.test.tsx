import { expect, test } from 'claude-code/testing'
import {
  SECRET,
  boundaryCalls,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  parentPane,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
} from './support'
import type { TargetOptions } from './support'

/* Issue 25: when Prompt Trail cannot prove a new Prompt Entry will be kept, a
   collecting Run stops the submission, keeps the draft, and offers only a
   retry or disabling the Run. */

const archiveStateKey = `prompt-trail:archive-state:${projectId}`
const otherRun = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' } }
}

test('a failed pre-write asks what to do, and cancelling keeps the draft', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const unavailableAsked: string[] = []
  installSupportedTarget(on, { store, beginFails: 'archive-busy', fills, unavailableAsked })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableAsked).toHaveLength(1)
  expect(unavailableAsked[0]).toContain('本次提交尚未进入会话')
  expect(unavailableAsked[0]).toContain('本项目所有 Run')
  expect(unavailableAsked[0]).toContain('archive-busy')
  expect(unavailableAsked[0]).not.toContain('PT-SECRET')
  expect(result.text).toBeUndefined()
  expect(result.drop).toContain('草稿已恢复')
  expect(fills).toStrictEqual([SECRET])
  /* A shared failure is the whole archive's, so every Run of the project
     learns of it at its next operation. */
  expect(store[archiveStateKey]).toMatchObject({
    version: 2,
    state: 'unavailable',
    category: 'archive-busy',
    runId,
  })
})

test('a retry after the archive recovers submits the same prompt once', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const options: TargetOptions = {
    store,
    beginFails: 'archive-busy',
    fills,
    unavailableAnswers: ['重试'],
    duringAsk: () => { options.beginFails = false },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(fills).toStrictEqual([])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(2)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  /* Two pre-writes with two event ids: the first never staged. */
  const staged = captureCalls(calls, 'capture-begin').map(call => call.argv[8])
  expect(captureCalls(calls, 'capture-confirm')[0]?.argv[4]).toBe(staged[1])
  expect(store[archiveStateKey]).toBeUndefined()
  const status = await promptHistory($, 'status')
  expect(status.text).toContain('Run collection mode: enabled')
})

test('a retry that fails again asks again, naming what it met this time', async ($, on) => {
  const unavailableAsked: string[] = []
  const options: TargetOptions = {
    store: consentedStore(),
    beginFails: 'archive-busy',
    fills: [],
    unavailableAnswers: ['重试'],
    unavailableAsked,
    duringAsk: () => { options.beginFails = 'archive-full' },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableAsked).toHaveLength(2)
  expect(unavailableAsked[1]).toContain('archive-full')
  expect(result.drop).toContain('archive-full')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(2)
})

test('disabling the Run lets the prompt through unarchived behind a stop boundary', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    beginFails: 'archive-busy',
    fills,
    parentPane: pane,
    unavailableAnswers: ['禁用当前 Run 后继续'],
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(fills).toStrictEqual([])
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(boundaryCalls(calls).map(call => call.argv[7])).toStrictEqual(['collection-stopped'])
  expect(store[`prompt-trail:run-mode:${projectId}:${runId}`]).toMatchObject({ mode: 'disabled' })
  expect(pane.toasts.join('\n')).toContain('当前 Run 已停用采集')
  expect(pane.toasts.join('\n')).not.toMatch(/完整/)
})

test('disabling while the archive refuses the stop boundary still lets the prompt through', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    beginFails: 'archive-full',
    boundaryFails: 'archive-full',
    fills: [],
    unavailableAnswers: ['禁用当前 Run 后继续'],
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  /* The disabled interval is not claimed complete: enable owes the stop
     boundary before it resumes. */
  expect(store[`prompt-trail:run-mode:${projectId}:${runId}`])
    .toMatchObject({ mode: 'disabled', stopBoundaryMissing: true })
})

test('a helper the host killed is this Run\'s failure, named without the host\'s words', async ($, on) => {
  const store = consentedStore()
  const unavailableAsked: string[] = []
  installSupportedTarget(on, { store, beginRejects: true, fills: [], unavailableAsked })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(unavailableAsked[0]).toContain('helper-timeout')
  expect(unavailableAsked[0]).toContain('本 Run（其他 Run 不受影响）')
  expect(unavailableAsked[0]).not.toContain('PT-SECRET')
  expect(result.drop).not.toContain('PT-SECRET')
  expect(store[archiveStateKey]).toBeUndefined()
})

test('a Run-local failure is not put on record, and the next submission tries for real', async ($, on) => {
  const store = consentedStore()
  const unavailableAsked: string[] = []
  const options: TargetOptions = {
    store,
    listFails: 'locator-directory',
    fills: [],
    unavailableAsked,
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const first = await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(first.drop).toContain('locator-directory')
  expect(unavailableAsked[0]).toContain('本 Run（其他 Run 不受影响）')
  expect(store[archiveStateKey]).toBeUndefined()
  expect(status.text).toContain('archive: unavailable · 范围 run · 类别 locator-directory')

  options.listFails = false
  const second = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  expect(second.text).toBe('PT-SECRET-SECOND')
  expect(unavailableAsked).toHaveLength(1)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
})

/* A Run's first submission writes its start boundary, and a write the
   archive takes lifts any report; these Runs have started already. */
async function attached(
  $: import('claude-code/testing').Engine,
  store: Record<string, unknown>,
  report: Record<string, unknown>,
) {
  await $.session.start(session)
  expect((await composerPrompt($, { text: 'PT-SECRET-EARLIER' })).text).toBe('PT-SECRET-EARLIER')
  store[archiveStateKey] = report
}

test('another Run\'s report stops this Run before it touches the archive', async ($, on) => {
  const store = consentedStore()
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, { store, fills: [], unavailableAsked })
  await attached($, store, { version: 2, state: 'unavailable', category: 'archive-full', since: 1, runId: otherRun })
  const writes = calls.length

  const result = await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(result.drop).toBeDefined()
  expect(unavailableAsked[0]).toContain('archive-full（由另一个 Run 报告）')
  expect(unavailableAsked[0]).not.toContain(otherRun)
  expect(captureCalls(calls.slice(writes), 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls.slice(writes), 'boundary-append')).toHaveLength(0)
  expect(status.text).toContain('archive: unavailable · 范围 archive · 类别 archive-full · 由另一个 Run 报告')
  expect(status.text).not.toContain(otherRun)
})

test('a retry past another Run\'s report lifts it once the archive takes the write', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [archiveStateKey]: { version: 2, state: 'unavailable', category: 'archive-busy', since: 1, runId: otherRun },
  }
  installSupportedTarget(on, { store, fills: [], unavailableAnswers: ['重试'] })
  await $.session.start(session)

  const result = await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(result.text).toBe(SECRET)
  expect(store[archiveStateKey]).toBeUndefined()
  expect(status.text).toContain('Run collection mode: enabled')
})

test('an unread report left by an earlier build still stops the Run', async ($, on) => {
  const store = consentedStore()
  const unavailableAsked: string[] = []
  const calls = installSupportedTarget(on, { store, fills: [], unavailableAsked })
  await attached($, store, { version: 1, state: 'unavailable' })
  const writes = calls.length

  await composerPrompt($)

  expect(unavailableAsked[0]).toContain('category-unrecorded')
  expect(captureCalls(calls.slice(writes), 'capture-begin')).toHaveLength(0)
})

test('the host failing a submission puts nothing on record', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    duringSubmit: async () => { throw new Error('host failure: PT-SECRET-HOST') },
  })
  await $.session.start(session)

  await composerPrompt($).catch(() => undefined)

  expect(store[archiveStateKey]).toBeUndefined()
  const status = await promptHistory($, 'status')
  expect(status.text).not.toContain('archive: unavailable')
})

test('enable writes its boundary despite a report on record, and lifts it', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [`prompt-trail:run-mode:${projectId}:${runId}`]: {
      version: 1,
      mode: 'disabled',
      boundary: { kind: 'collection-stopped', eventId: '44444444-5555-4666-8777-888888888888', sequence: 1 },
    },
    [archiveStateKey]: { version: 2, state: 'unavailable', category: 'archive-busy', since: 1, runId: otherRun },
  }
  const calls = installSupportedTarget(on, { store })
  await $.session.start(session)

  const enabled = await promptHistory($, 'enable')

  expect(boundaryCalls(calls).map(call => call.argv[7])).toStrictEqual(['collection-resumed'])
  expect(store[archiveStateKey]).toBeUndefined()
  expect(enabled.text).not.toContain('未启用采集')
})

test('enable held up by a boundary it owes names the failure and records it', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [`prompt-trail:run-mode:${projectId}:${runId}`]: {
      version: 1,
      mode: 'disabled',
      boundary: { kind: 'collection-stopped', eventId: '44444444-5555-4666-8777-888888888888', sequence: 1 },
    },
  }
  installSupportedTarget(on, { store, boundaryFails: 'archive-busy' })
  await $.session.start(session)

  const enabled = await promptHistory($, 'enable')

  expect(enabled.text).toContain('archive-busy')
  expect(store[archiveStateKey]).toMatchObject({ state: 'unavailable', category: 'archive-busy' })
})

test('low disk space is shown once per Run and reported by status', async ($, on) => {
  const store = consentedStore()
  const pane = parentPane()
  installSupportedTarget(on, { store, lowSpace: true, parentPane: pane })
  await $.session.start(session)

  const before = await promptHistory($, 'status')
  await composerPrompt($)
  await composerPrompt($, { text: 'PT-SECRET-SECOND' })
  const after = await promptHistory($, 'status')

  expect(before.text).toContain('disk space: unknown')
  expect(after.text).toContain('disk space: low')
  const warnings = pane.toasts.filter(text => text.includes('1 GiB'))
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).not.toContain('PT-SECRET')
  expect(store[`prompt-trail:space-warned:${projectId}:${runId}`]).toBeDefined()
})

test('a Run already warned of low space is not warned again after a restart', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [`prompt-trail:space-warned:${projectId}:${runId}`]: { version: 1 },
  }
  const pane = parentPane()
  installSupportedTarget(on, { store, lowSpace: true, parentPane: pane })
  await $.session.start(session)

  await composerPrompt($)

  expect(pane.toasts.filter(text => text.includes('1 GiB'))).toHaveLength(0)
})

test('ample disk space warns of nothing', async ($, on) => {
  const pane = parentPane()
  installSupportedTarget(on, { store: consentedStore(), lowSpace: false, parentPane: pane })
  await $.session.start(session)

  await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(pane.toasts.filter(text => text.includes('1 GiB'))).toHaveLength(0)
  expect(status.text).toContain('disk space: ok')
})

function titleOf(tree: unknown): string {
  const node = tree as { props?: { label?: unknown }; children?: unknown }
  if (typeof node?.props?.label === 'string') return node.props.label
  const children = Array.isArray(node?.children) ? node.children : [node?.children]
  for (const child of children) {
    if (child && typeof child === 'object') {
      const found = titleOf(child)
      if (found) return found
    }
  }
  return ''
}

test('the band says the archive is unavailable until it works again', async ($, on) => {
  const options: TargetOptions = {
    store: consentedStore(),
    beginFails: 'archive-busy',
    fills: [],
  }
  installSupportedTarget(on, options)
  await $.session.start(session)
  expect(titleOf(await renderBand($))).not.toContain('档案不可用')

  await composerPrompt($)
  expect(titleOf(await renderBand($))).toContain('档案不可用')
  await promptHistory($)
  expect(JSON.stringify(await renderBand($))).toContain('档案不可用')

  options.beginFails = false
  options.unavailableAnswers = ['重试']
  await composerPrompt($)
  expect(JSON.stringify(await renderBand($))).not.toContain('档案不可用')
})

test('a disabled Run shows no unavailable archive on its band', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [`prompt-trail:run-mode:${projectId}:${runId}`]: { version: 1, mode: 'disabled' },
    [archiveStateKey]: { version: 2, state: 'unavailable', category: 'archive-busy', since: 1, runId: otherRun },
  }
  installSupportedTarget(on, { store })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(titleOf(await renderBand($))).not.toContain('档案不可用')
})

test('enable that cannot write its resume boundary names the failure and records it', async ($, on) => {
  const store = consentedStore()
  const options: TargetOptions = { store }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($, 'disable')
  options.boundaryFails = 'archive-busy'
  const writes = calls.length

  const enabled = await promptHistory($, 'enable')

  expect(boundaryCalls(calls.slice(writes)).map(call => call.argv[7])).toStrictEqual(['collection-resumed'])
  expect(enabled.text).toContain('archive-busy')
  expect(store[archiveStateKey]).toMatchObject({ state: 'unavailable', category: 'archive-busy' })
})
