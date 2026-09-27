import { expect, test } from 'claude-code/testing'
import {
  FINAL_SECRET,
  SECRET,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  promptHistory,
  runId,
  session,
} from './support'

const consentGranted = { policyVersion: 1, decision: 'enabled' as const }

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: consentGranted }
}

function reconcileKey(): string {
  return `prompt-trail:reconcile:${projectId}`
}

function runModeKey(forRunId: string = runId): string {
  return `prompt-trail:run-mode:${projectId}:${forRunId}`
}

function branchIds(store: Record<string, unknown>): { branchId?: string } {
  const key = Object.keys(store).find(name => name.startsWith('prompt-trail:branch:'))
  return (key === undefined ? {} : store[key]) as { branchId?: string }
}

test('a failed pre-write drops the submission and restores the draft', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const calls = installSupportedTarget(on, { store, beginFails: true, fills })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.drop).toBeDefined()
  expect(result.text).toBeUndefined()
  /* The draft comes back to the composer rather than being lost with the
     submission the plugin refused to let through. */
  expect(fills).toStrictEqual([SECRET])
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  /* A pre-write that failed staged nothing, so there is nothing to reconcile. */
  expect(store[reconcileKey()]).toBeUndefined()
})

/* A transcript that cannot settle the pending either way: the prompt appears
   twice, so reconciliation has to ask rather than confirm or discard. */
const UNPROVABLE = [
  { role: 'user' as const, text: SECRET },
  { role: 'user' as const, text: SECRET },
]

test('a failed confirmation keeps the pending and blocks the next submission', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const calls = installSupportedTarget(on, { store, confirmFails: true, fills, messages: UNPROVABLE })
  await $.session.start(session)

  const entered = await composerPrompt($)
  const blocked = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  /* The first prompt did enter the session; only its confirmation failed. */
  expect(entered.text).toBe(SECRET)
  expect(blocked.drop).toContain('对账')
  expect(fills).toStrictEqual(['PT-SECRET-SECOND'])
  const pendingEventId = captureCalls(calls, 'capture-begin')[0]?.argv[8]
  expect(store[reconcileKey()]).toMatchObject({
    version: 1,
    eventId: pendingEventId,
    runId,
  })
  /* The blocked submission never staged a Pending Capture of its own. */
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
})

test('a transcript that uniquely proves the prompt entered confirms it', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFailsOnce: true,
    messages: [
      { role: 'user', text: SECRET },
      { role: 'assistant', text: 'PT-SECRET-REPLY' },
    ],
  })
  await $.session.start(session)
  await composerPrompt($)

  const blocked = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  const confirms = captureCalls(calls, 'capture-confirm')
  expect(confirms).toHaveLength(2)
  expect(confirms[1]?.argv[4]).toBe(captureCalls(calls, 'capture-begin')[0]?.argv[8])
  expect(blocked.drop).toContain('已完成对账')
  expect(store[reconcileKey()]).toBeUndefined()
  /* Nothing was asked: the transcript settled it. */
  expect(calls.some(call => call.argv[1] === 'capture-abort')).toBe(false)
})

test('a transcript that proves the prompt never entered discards the pending', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFails: true,
    messages: [{ role: 'assistant', text: 'PT-SECRET-UNRELATED' }],
  })
  await $.session.start(session)
  await composerPrompt($)

  const blocked = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  expect(captureCalls(calls, 'capture-abort')).toHaveLength(1)
  expect(blocked.drop).toContain('已完成对账')
  expect(store[reconcileKey()]).toBeUndefined()
})

test('an ambiguous transcript asks, and 已进入 archives the entry', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFailsOnce: true,
    /* The same text twice: which one is the staged submission cannot be told. */
    messages: [
      { role: 'user', text: SECRET },
      { role: 'user', text: SECRET },
    ],
    reconcileAnswer: '已进入',
  })
  await $.session.start(session)
  await composerPrompt($)

  await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  const confirms = captureCalls(calls, 'capture-confirm')
  expect(confirms).toHaveLength(2)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
  expect(store[reconcileKey()]).toBeUndefined()
})

test('未进入 discards the pending and leaves the branch alone', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFails: true,
    messages: [
      { role: 'user', text: SECRET },
      { role: 'user', text: SECRET },
    ],
    reconcileAnswer: '未进入',
  })
  await $.session.start(session)
  await composerPrompt($)
  const before = branchIds(store).branchId

  await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  expect(captureCalls(calls, 'capture-abort')).toHaveLength(1)
  expect(branchIds(store).branchId).toBe(before)
  expect(store[reconcileKey()]).toBeUndefined()
})

test('新根分支 discards the pending and starts a new root branch', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFails: true,
    messages: [
      { role: 'user', text: SECRET },
      { role: 'user', text: SECRET },
    ],
    reconcileAnswer: '新根分支',
  })
  await $.session.start(session)
  await composerPrompt($)
  const before = branchIds(store).branchId

  await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  /* Nothing uncertain is archived, and nothing after it is chained onto a
     parent the reconciliation could not vouch for. */
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(1)
  expect(branchIds(store).branchId).not.toBe(before)
  /* A root the person chose: a later resume's transcript does not overrule it. */
  expect(branchIds(store)).toMatchObject({ parentEventId: null, explicitRoot: true })
  expect(store[reconcileKey()]).toBeUndefined()
})

test('a cancelled reconciliation stays blocked and never retries the submission', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const calls = installSupportedTarget(on, {
    store,
    confirmFails: true,
    messages: [
      { role: 'user', text: SECRET },
      { role: 'user', text: SECRET },
    ],
    fills,
  })
  await $.session.start(session)
  await composerPrompt($)

  const first = await composerPrompt($, { text: 'PT-SECRET-SECOND' })
  const second = await composerPrompt($, { text: 'PT-SECRET-THIRD' })

  expect(first.drop).toContain('对账')
  expect(second.drop).toContain('对账')
  /* Neither default happened, and the original submission was not resubmitted. */
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(store[reconcileKey()]).toBeDefined()
  expect(fills).toStrictEqual(['PT-SECRET-SECOND', 'PT-SECRET-THIRD'])
})

test('status reports the reconciliation and its event id without prompt text', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, confirmFails: true })
  await $.session.start(session)
  await composerPrompt($)

  const result = await promptHistory($, 'status')

  const eventId = captureCalls(calls, 'capture-begin')[0]?.argv[8] ?? ''
  expect(result.text).toContain('pending reconciliation')
  expect(result.text).toContain(eventId.slice(0, 8))
  expect(result.text).not.toContain(SECRET)
  expect(result.text).not.toContain('PT-SECRET')
})

test('disable keeps the pending and enable refuses until it is reconciled', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, confirmFails: true, messages: UNPROVABLE })
  await $.session.start(session)
  await composerPrompt($)

  const disabled = await promptHistory($, 'disable')
  const enabled = await promptHistory($, 'enable')

  expect(disabled.text).toContain('已停用采集')
  /* Disabling never resolves a pending on the user's behalf. */
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
  expect(store[reconcileKey()]).toBeDefined()
  expect(enabled.text).toContain('对账')
  expect(store[runModeKey()]).toMatchObject({ mode: 'disabled' })
})

test('a restart discovers the pending from the archive and confirms it from staged text', async ($, on) => {
  /* A fresh process: consent survives in the store, the reconciliation record
     does not, and only the archive still knows something is owed. */
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    pendingList: [{
      eventId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
      runId: 'cccccccc-dddd-4eee-8fff-000000000000',
      segmentId: '11111111-2222-4333-8444-555555555555',
      branchId: '22222222-3333-4444-8555-666666666666',
      parentEventId: null,
      occurredAtMs: 1_795_000_000_000,
      attachmentCount: 0,
    }],
    reconcileAnswer: '已进入',
  })
  await $.session.start(session)

  const blocked = await composerPrompt($)

  const confirms = captureCalls(calls, 'capture-confirm')
  expect(confirms).toHaveLength(1)
  expect(confirms[0]?.argv[4]).toBe('77777777-8888-4999-8aaa-bbbbbbbbbbbb')
  /* The draft is gone with the old process, so the staged text is the only
     text that can be archived. */
  expect(confirms[0]?.argv[7]).toBe('--pending')
  expect(confirms[0]?.stdin).toBeUndefined()
  expect(blocked.drop).toContain('已完成对账')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
})

test('the archive is asked about unresolved pendings once per Run', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  expect(captureCalls(calls, 'capture-list')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(2)
})

test('repeating a recovery never produces two Prompt Entries', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFailsOnce: true,
    messages: [{ role: 'user', text: SECRET }],
  })
  await $.session.start(session)
  await composerPrompt($)

  await composerPrompt($, { text: 'PT-SECRET-SECOND' })
  await composerPrompt($, { text: 'PT-SECRET-THIRD' })

  const pendingEventId = captureCalls(calls, 'capture-begin')[0]?.argv[8]
  const confirms = captureCalls(calls, 'capture-confirm')
  /* The pending is confirmed once by the failed submission, once by the
     reconciliation, and never again. */
  expect(
    confirms.filter(call => call.argv[4] === pendingEventId),
  ).toHaveLength(2)
  expect(store[reconcileKey()]).toBeUndefined()
})

test('a rewritten final text is what a same-Run reconciliation archives', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    rewrite: true,
    confirmFailsOnce: true,
    messages: [{ role: 'user', text: FINAL_SECRET }],
  })
  await $.session.start(session)
  await composerPrompt($)

  await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  const confirms = captureCalls(calls, 'capture-confirm')
  expect(confirms).toHaveLength(2)
  /* The reconciliation still holds the text that entered, so it confirms with
     that rather than falling back to the staged draft. */
  expect(confirms[1]?.argv[7]).toBe('--stdin')
  expect(confirms[1]?.stdin).toBe(FINAL_SECRET)
})

test('every pending a crash left behind is settled, not just the first', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    pendingList: [
      {
        eventId: '11111111-aaaa-4bbb-8ccc-dddddddddddd',
        runId: 'cccccccc-dddd-4eee-8fff-000000000000',
        segmentId: '11111111-2222-4333-8444-555555555555',
        branchId: '22222222-3333-4444-8555-666666666666',
        parentEventId: null,
        occurredAtMs: 1_795_000_000_000,
        attachmentCount: 0,
      },
      {
        eventId: '22222222-aaaa-4bbb-8ccc-dddddddddddd',
        runId: 'eeeeeeee-dddd-4eee-8fff-000000000000',
        segmentId: '11111111-2222-4333-8444-555555555555',
        branchId: '33333333-3333-4444-8555-666666666666',
        parentEventId: null,
        occurredAtMs: 1_795_000_000_001,
        attachmentCount: 0,
      },
    ],
    reconcileAnswer: '未进入',
  })
  await $.session.start(session)

  const first = await composerPrompt($)
  /* Settling the older pending re-asks the archive rather than assuming it was
     the only one, so both are gone before anything is staged again. */
  expect(first.drop).toContain('已完成对账')
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(2)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)

  const second = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  expect(second.text).toBe('PT-SECRET-SECOND')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
})

test('status discovers a pending this Run has not met yet', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    pendingList: [{
      eventId: '44444444-aaaa-4bbb-8ccc-dddddddddddd',
      runId: 'cccccccc-dddd-4eee-8fff-000000000000',
      segmentId: '11111111-2222-4333-8444-555555555555',
      branchId: '22222222-3333-4444-8555-666666666666',
      parentEventId: null,
      occurredAtMs: 1_795_000_000_000,
      attachmentCount: 0,
    }],
  })
  await $.session.start(session)

  const result = await promptHistory($, 'status')

  expect(result.text).toContain('pending reconciliation: 44444444 · 待对账')
  expect(result.text).toContain('Run collection mode: disabled · 未决 Pending Capture 待对账')
})

test('a draft the host refuses to restore is never reported as restored', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, { store, beginFails: true, fillFails: true })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.drop).toContain('草稿未能恢复')
  expect(result.drop).not.toContain('草稿已恢复')
})

test('an unanswerable archive restores the draft and is reported, not assumed healthy', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  installSupportedTarget(on, { store, listFails: true, fills })
  await $.session.start(session)

  const blocked = await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(blocked.drop).toContain('无法读取未决的 Pending Capture')
  /* The draft is not lost just because the archive could not be asked. */
  expect(fills).toStrictEqual([SECRET])
  expect(status.text).toContain('pending reconciliation: unknown · 未决 Pending Capture 不可读')
  expect(status.text).not.toContain('Run collection mode: enabled')
})

test('a pending the archive kept is still reachable after an uncertain pre-write', async ($, on) => {
  /* capture-begin failed, but the helper may well have committed the row
     before it died. The archive block that failure raises must not put the
     pending out of reach. */
  const store = consentedStore()
  const pendingList: Record<string, unknown>[] = []
  const options = {
    store,
    beginFails: true,
    pendingList,
    reconcileAnswer: '未进入' as const,
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const first = await composerPrompt($)
  expect(first.drop).toContain('无法预写 Pending Capture')
  /* What the helper actually committed before dying. */
  options.pendingList = [{
    eventId: '55555555-aaaa-4bbb-8ccc-dddddddddddd',
    runId,
    segmentId: '11111111-2222-4333-8444-555555555555',
    branchId: '22222222-3333-4444-8555-666666666666',
    parentEventId: null,
    occurredAtMs: 1_795_000_000_000,
    attachmentCount: 0,
  }]

  const second = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  expect(captureCalls(calls, 'capture-abort')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-abort')[0]?.argv[4])
    .toBe('55555555-aaaa-4bbb-8ccc-dddddddddddd')
  expect(second.drop).toContain('已完成对账')
})

test('enable settles every pending before it resumes collection', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    pendingList: [
      {
        eventId: '66666666-aaaa-4bbb-8ccc-dddddddddddd',
        runId,
        segmentId: '11111111-2222-4333-8444-555555555555',
        branchId: '22222222-3333-4444-8555-666666666666',
        parentEventId: null,
        occurredAtMs: 1_795_000_000_000,
        attachmentCount: 0,
      },
      {
        eventId: '77777777-bbbb-4bbb-8ccc-dddddddddddd',
        runId,
        segmentId: '11111111-2222-4333-8444-555555555555',
        branchId: '33333333-3333-4444-8555-666666666666',
        parentEventId: null,
        occurredAtMs: 1_795_000_000_001,
        attachmentCount: 0,
      },
    ],
    reconcileAnswer: '未进入',
  })
  await $.session.start(session)
  await promptHistory($, 'disable')

  const result = await promptHistory($, 'enable')

  /* Resuming with one of two pendings still owed would report success and
     then block the very next prompt. */
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(2)
  expect(result.text).toContain('已恢复采集')
})

test('新根分支 keeps the block when the new root cannot be stored', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    confirmFails: true,
    messages: [
      { role: 'user', text: SECRET },
      { role: 'user', text: SECRET },
    ],
    reconcileAnswer: '新根分支',
    /* The Run's own branch is written first; the reset is what fails. */
    branchSetFailsAfter: 1,
  })
  await $.session.start(session)
  await composerPrompt($)

  const blocked = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

  /* The pending is still there, so the choice is not silently lost. */
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
  expect(blocked.drop).toContain('仍有未决的 Pending Capture')
  expect(store[reconcileKey()]).toBeDefined()
})

/* A pending of another Run that a live process is attached to. */
const HELD_ELSEWHERE = {
  eventId: '55555555-6666-4777-8888-999999999999',
  runId: 'dddddddd-eeee-4fff-8000-111111111111',
  segmentId: '11111111-2222-4333-8444-555555555555',
  branchId: '22222222-3333-4444-8555-666666666666',
  parentEventId: null,
  occurredAtMs: 1_795_000_000_000,
  attachmentCount: 0,
}

test('a pending another live Run holds is left to that Run', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    pendingList: [{ ...HELD_ELSEWHERE }],
    liveRuns: [HELD_ELSEWHERE.runId],
    reconcileAnswer: '未进入',
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  /* It may be a submission still in flight there: this Run neither asks about
     it nor settles it, and its own prompt goes through. */
  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'capture-list')[0]?.argv[4]).toBe(runId)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-confirm').map(call => call.argv[4]))
    .not.toContain(HELD_ELSEWHERE.eventId)
  expect(store[reconcileKey()]).toBeUndefined()
})

test('status counts the pendings live Runs hold, as the archive answers now', async ($, on) => {
  const store = consentedStore()
  const options = {
    store,
    pendingList: [{ ...HELD_ELSEWHERE }],
    liveRuns: [HELD_ELSEWHERE.runId],
  }
  installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)

  const held = await promptHistory($, 'status')
  /* That Run settled its submission meanwhile. */
  options.pendingList = []
  const settled = await promptHistory($, 'status')

  expect(held.text).toContain('pending reconciliation: none · 另有 1 条属于正在运行的其他 Run')
  expect(settled.text).toContain('pending reconciliation: none\n')
})

for (const lookedAt of ['submission', 'status'] as const) {
  test(`a pending left to a live Run is settled here once that Run is gone (${lookedAt})`, async ($, on) => {
    const store = consentedStore()
    const options = {
      store,
      pendingList: [{ ...HELD_ELSEWHERE }],
      liveRuns: [HELD_ELSEWHERE.runId],
      reconcileAnswer: '未进入' as const,
    }
    const calls = installSupportedTarget(on, options)
    await $.session.start(session)
    await composerPrompt($)

    /* That Run's process exits without settling it. */
    options.liveRuns = []
    if (lookedAt === 'status') await promptHistory($, 'status')
    const next = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

    expect(next.drop).toContain('已完成对账')
    expect(captureCalls(calls, 'capture-abort').map(call => call.argv[4])).toStrictEqual([HELD_ELSEWHERE.eventId])
  })
}

/* A pending a crashed process left behind, which every live Run may offer. */
const ORPHANED = { ...HELD_ELSEWHERE, eventId: '66666666-7777-4888-8999-aaaaaaaaaaaa' }

for (const answer of ['已进入', '未进入'] as const) {
  test(`${answer} on a pending another Run settled first counts as settled`, async ($, on) => {
    const store = consentedStore()
    const calls = installSupportedTarget(on, {
      store,
      pendingList: [{ ...ORPHANED }],
      settledElsewhere: true,
      reconcileAnswer: answer,
    })
    await $.session.start(session)

    const first = await composerPrompt($)
    const second = await composerPrompt($, { text: 'PT-SECRET-SECOND' })

    /* The first Run's answer stands; this one's is not an archive failure. */
    expect(first.drop).toContain('已完成对账')
    expect(store[reconcileKey()]).toBeUndefined()
    expect(store[`prompt-trail:archive-state:${projectId}`]).toBeUndefined()
    expect(second.text).toBe('PT-SECRET-SECOND')
    expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  })
}
