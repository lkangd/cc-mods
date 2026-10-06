import { expect } from 'claude-code/testing'
import { test } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  runId,
  session,
  sessionId,
  storeComposerRow,
} from './support'

/* A prompt becomes a Prompt Entry only once the host has stored its row of
   the conversation. A prompt typed over a running turn is queued: it may be
   taken from the queue later or withdrawn, and nothing ties a stored row to
   the submission it came from, so the person settles it. */

const consentGranted = { policyVersion: 1, decision: 'enabled' as const }
const TURN = 'turn-running-0001'
const QUEUED = 'PT-SECRET-QUEUED'
const NEXT = 'PT-SECRET-NEXT'

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: consentGranted }
}

function reconcileKey(): string {
  return `prompt-trail:reconcile:${projectId}:${runId}`
}

function branchOf(store: Record<string, unknown>): { parentEventId?: string | null } {
  const key = Object.keys(store).find(name => name.startsWith('prompt-trail:branch:'))
  return (key === undefined ? {} : store[key]) as { parentEventId?: string | null }
}

function begun(calls: ReturnType<typeof installSupportedTarget>) {
  return captureCalls(calls, 'capture-begin').map(call => ({ parent: call.argv[7], eventId: call.argv[8] }))
}

test('a queued submission stays a Pending Capture and moves no branch', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, transcript: [] })
  await $.session.start(session)

  await composerPrompt($)
  const first = begun(calls)[0]?.eventId
  const queued = await composerPrompt($, { text: QUEUED, turnId: TURN })

  /* The host took the prompt into its queue; the plugin does not stop it. */
  expect(queued.text).toBe(QUEUED)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(branchOf(store).parentEventId).toBe(first)
  expect(store[reconcileKey()]).toMatchObject({
    version: 2,
    eventId: begun(calls)[1]?.eventId,
    membership: 'unproven',
    rowsSince: 0,
  })
})

test('a withdrawn queued prompt can only be settled as not entered', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const reconcileOffered: string[][] = []
  const calls = installSupportedTarget(on, { store, transcript: [], fills, reconcileOffered, reconcileAnswer: '未进入' })
  await $.session.start(session)

  await composerPrompt($)
  const first = begun(calls)[0]?.eventId
  await composerPrompt($, { text: QUEUED, turnId: TURN })
  const queuedEvent = begun(calls)[1]?.eventId
  /* Withdrawn: the host never stores its row. The turn ends, and the person
     sends the next prompt to an idle session. */
  const settled = await composerPrompt($, { text: NEXT })

  expect(reconcileOffered).toStrictEqual([['未进入', '新根分支']])
  expect(captureCalls(calls, 'capture-abort').map(call => call.argv[4])).toStrictEqual([queuedEvent])
  expect(settled.drop).toContain('已完成对账')
  expect(fills).toStrictEqual([NEXT])

  /* Sent again, it goes on from the entry before the withdrawn one: no
     rewind, no new branch. */
  const again = await composerPrompt($, { text: NEXT })
  expect(again.text).toBe(NEXT)
  expect(begun(calls)[2]?.parent).toBe(first)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(2)
})

test('a queued prompt the host later stored may be settled as entered', async ($, on) => {
  const store = consentedStore()
  const reconcileOffered: string[][] = []
  const reconcileAsked: string[] = []
  const calls = installSupportedTarget(on, {
    store, reconcileOffered, reconcileAsked, reconcileAnswer: '已进入',
  })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($, { text: QUEUED, turnId: TURN })
  const queuedEvent = begun(calls)[1]?.eventId
  /* Taken from the queue once the running turn ended. */
  await storeComposerRow(QUEUED)
  expect(store[reconcileKey()]).toMatchObject({ rowsSince: 1 })
  const settled = await composerPrompt($, { text: NEXT })

  expect(reconcileOffered).toStrictEqual([['已进入', '未进入', '新根分支']])
  expect(reconcileAsked[0]).toContain('此后宿主存储了 1 条 composer 行')
  expect(reconcileAsked[0]).not.toContain(QUEUED)
  const confirms = captureCalls(calls, 'capture-confirm')
  expect(confirms.map(call => call.argv[4])).toContain(queuedEvent)
  expect(confirms.at(-1)?.stdin).toBe(QUEUED)
  expect(settled.drop).toContain('已完成对账')
  expect(branchOf(store).parentEventId).toBe(queuedEvent)
})

test('a prompt typed while a queued one is unsettled is held, not staged', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  const reconcileOffered: string[][] = []
  const calls = installSupportedTarget(on, { store, fills, reconcileOffered })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($, { text: QUEUED, turnId: TURN })
  const held = await composerPrompt($, { text: NEXT, turnId: TURN })

  expect(held.drop).toContain('上一条排队提交尚未结算')
  expect(fills).toStrictEqual([NEXT])
  /* Nobody is asked while the queue may still hold it. */
  expect(reconcileOffered).toStrictEqual([])
  expect(begun(calls)).toHaveLength(2)
})

test('an idle submission is confirmed only by exactly one stored row', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, rowsInSubmit: 0 })
  await $.session.start(session)

  const none = await composerPrompt($)
  expect(none.text).toBe(SECRET)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(store[reconcileKey()]).toMatchObject({ membership: 'unproven' })
})

test('two rows stored inside one idle submission prove nothing', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, rowsInSubmit: 2 })
  await $.session.start(session)

  await composerPrompt($)

  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(store[reconcileKey()]).toMatchObject({ membership: 'unproven', rowsSince: 0 })
})

test('after a restart the stored-row count is unknown and all three choices are offered', async ($, on) => {
  const eventId = '77777777-8888-4999-8aaa-bbbbbbbbbbbb'
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [reconcileKey()]: {
      version: 2,
      eventId,
      runId,
      branchId: '22222222-3333-4444-8555-666666666666',
      parentEventId: null,
      attachmentCount: 0,
      membership: 'unproven',
      rowsSince: 0,
    },
  }
  const reconcileOffered: string[][] = []
  const reconcileAsked: string[] = []
  installSupportedTarget(on, { store, reconcileOffered, reconcileAsked })
  await $.session.start(session)

  const blocked = await composerPrompt($, { text: NEXT })

  /* Rows stored while no module instance watched cannot be ruled out. */
  expect(reconcileOffered).toStrictEqual([['已进入', '未进入', '新根分支']])
  expect(reconcileAsked[0]).toContain('无法证明是否有存储行')
  expect(blocked.drop).toBeDefined()
})

test('rows of other origins or of a subagent are not counted', async ($, on) => {
  const store = consentedStore()
  const reconcileOffered: string[][] = []
  installSupportedTarget(on, { store, reconcileOffered, reconcileAnswer: '未进入' })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($, { text: QUEUED, turnId: TURN })
  await storeComposerRow(QUEUED, { agentId: 'agent-0001' })
  await storeComposerRow(QUEUED, { origin: { kind: 'peer' } })
  await composerPrompt($, { text: NEXT })

  expect(store[reconcileKey()]).toBeUndefined()
  expect(reconcileOffered).toStrictEqual([['未进入', '新根分支']])
})

test('a prompt queued while another is still being queued is held', async ($, on) => {
  const store = consentedStore()
  const fills: string[] = []
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  let submits = 0
  const calls = installSupportedTarget(on, {
    store,
    fills,
    /* The first queued prompt stays inside the host's queueing until the
       second has been dealt with: queued too, or held. */
    duringSubmit: async () => {
      const submit = submits++
      if (submit === 1) await gate
      if (submit === 2) release()
    },
  })
  await $.session.start(session)

  await composerPrompt($)
  const first = composerPrompt($, { text: QUEUED, turnId: TURN })
  const second = composerPrompt($, { text: NEXT, turnId: TURN })
  void second.then(() => release())

  expect((await first).text).toBe(QUEUED)
  expect((await second).drop).toContain('上一条排队提交尚未结算')
  expect(fills).toStrictEqual([NEXT])
  expect(begun(calls)).toHaveLength(2)
})

test('a composer row stored before the queued pending is recorded counts for it', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    duringSubmit: async () => { await storeComposerRow(QUEUED) },
  })
  await $.session.start(session)

  await composerPrompt($, { text: QUEUED, turnId: TURN })

  expect(store[reconcileKey()]).toMatchObject({ membership: 'unproven', rowsSince: 1 })
})

test("rows of another Run's conversation are not counted for this Run's pending", async ($, on) => {
  const otherRun = '12121212-3434-4565-8787-909090909090'
  const store: Record<string, unknown> = {
    ...consentedStore(),
    /* The Run resumed into collects nothing, so its prompts pass straight
       through and are stored outside any capture. */
    [`prompt-trail:run-mode:${projectId}:${otherRun}`]: { version: 1, mode: 'disabled' },
  }
  const classicSession = { id: sessionId }
  const identity = { runId }
  installSupportedTarget(on, { store, transcript: [], classicSession, run: identity })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($, { text: QUEUED, turnId: TURN })
  /* `/resume` into a session of the other Run, where the person sends a prompt. */
  classicSession.id = '31313131-4242-4353-8464-757575757575'
  identity.runId = otherRun
  await composerPrompt($, { text: NEXT })

  expect(store[reconcileKey()]).toMatchObject({ rowsSince: 0 })
  expect(store[`prompt-trail:reconcile:${projectId}:${otherRun}`]).toBeUndefined()
})
