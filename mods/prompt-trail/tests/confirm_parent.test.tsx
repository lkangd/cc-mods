import { expect } from 'claude-code/testing'
import { test } from './support'
import type { BranchState, BranchMatch } from '../hooks/branch'
import type { ArchiveRow, ParentPane, ProcessCall } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  parentChoices,
  parentPane,
  PARENT_PANE_ID,
  pickParent,
  projectId,
  renderParentPane,
  runId,
  session,
  sessionId,
} from './support'

/* When a transcript cannot place the next prompt's parent, the submission is
   dropped and the person chooses in a focused Pane; the draft waits in memory
   and comes back only once they have chosen. Nothing is ever resubmitted. */

const branchId = 'b1b1b1b1-0000-4000-8000-000000000001'
const earlier = 'e1e1e1e1-0000-4000-8000-000000000001'
const forkPoint = 'e2e2e2e2-0000-4000-8000-000000000002'

function branchKey(): string {
  return `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
}

function stored(parentEventId: string | null): BranchState {
  return { version: 1, branchId, parentEventId }
}

function ambiguous(...eventIds: string[]): BranchMatch {
  return {
    match: 'ambiguous',
    candidates: eventIds.map((eventId, index) => ({ eventId, sequence: 20 - index, runId: 'run' })),
    candidateCount: eventIds.length,
  }
}

function archivedEntry(eventId: string, sequence: number, text: string): ArchiveRow {
  return {
    kind: 'prompt',
    eventId,
    sequence,
    runId,
    segmentId: sessionId,
    branchId,
    parentEventId: null,
    text,
  }
}

function parentOf(calls: readonly ProcessCall[]) {
  const begin = captureCalls(calls, 'capture-begin')[0]
  return { branchId: begin?.argv[6], parent: begin?.argv[7] }
}

test('an ambiguous submission is dropped and the person chooses in a focused Pane', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const fills: string[] = []
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    fills,
    parentPane: pane,
    archive: [archivedEntry(earlier, 3, 'PT-SECRET-EARLIER')],
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)

  const dropped = await composerPrompt($)

  expect(dropped).toMatchObject({ drop: expect.stringContaining('确认父节点') })
  expect(dropped).not.toMatchObject({ drop: expect.stringContaining('PT-SECRET') })
  expect(pane.opens).toEqual([
    expect.objectContaining({ focus: true, closeOnEscape: true, holdToasts: true }),
  ])
  /* The draft waits for the choice, in memory only; nothing is staged. */
  expect(fills).toEqual([])
  expect(JSON.stringify(store)).not.toContain('PT-SECRET-CONSENT')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  /* The stored parent first, by its text; one outside the window by its id. */
  expect(await parentChoices($)).toEqual([
    '#1 PT-SECRET-EARLIER',
    `#2 事件 ${forkPoint.slice(0, 8)}`,
    '新根分支',
  ])

  await pickParent($, pane, labels => labels[1])

  /* The Pane goes first, so the prompt box is free to take the draft back. */
  expect(pane.log).toEqual(['open', 'close:plugin', 'fill'])
  expect(fills).toEqual([SECRET])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)

  const resubmitted = await composerPrompt($)
  expect(resubmitted).toMatchObject({ text: SECRET })
  expect(parentOf(calls).parent).toBe(forkPoint)
  expect(parentOf(calls).branchId).not.toBe(branchId)
})

test('a stored parent outside the window is named by the number the helper places it at', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const pane = parentPane()
  installSupportedTarget(on, {
    store,
    parentPane: pane,
    /* The band's window does not hold the stored parent. */
    archive: [archivedEntry(forkPoint, 900, 'PT-SECRET-RECENT')],
    branchMatch: {
      ...ambiguous(forkPoint),
      prefer: { eventId: earlier, sequence: 7, ordinal: 5 },
    },
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(await parentChoices($)).toEqual([
    `#5 事件 ${earlier.slice(0, 8)}`,
    '#1 PT-SECRET-RECENT',
    '新根分支',
  ])
})

test('a submission made before choosing is dropped too, and its text is the draft that comes back', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const fills: string[] = []
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    fills,
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)

  await composerPrompt($, { text: 'PT-SECRET-FIRST' })
  const again = await composerPrompt($, { text: 'PT-SECRET-LATEST' })

  /* Judged again rather than defaulting to any candidate. */
  expect(again).toMatchObject({ drop: expect.stringContaining('确认父节点') })
  expect(captureCalls(calls, 'branch-match')).toHaveLength(2)
  expect(pane.opens).toHaveLength(2)
  expect(pane.opens[1]).toMatchObject({ focus: true })
  expect(fills).toEqual([])
  expect(store[branchKey()]).toEqual(stored(earlier))

  await pickParent($, pane, labels => labels[0])

  expect(fills).toEqual(['PT-SECRET-LATEST'])
  expect(pane.toasts).toEqual([expect.stringContaining('已确认父节点')])
})

test('a submission that the transcript can place again closes a waiting Pane and goes through', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const fills: string[] = []
  const pane = parentPane()
  let matches = 0
  const calls = installSupportedTarget(on, {
    store,
    fills,
    parentPane: pane,
    branchMatch: () => {
      matches += 1
      return matches === 1 ? ambiguous(forkPoint) : ambiguous(forkPoint, earlier)
    },
  })
  await $.session.start(session)

  await composerPrompt($, { text: 'PT-SECRET-FIRST' })
  const placed = await composerPrompt($, { text: 'PT-SECRET-LATEST' })

  expect(placed).toMatchObject({ text: 'PT-SECRET-LATEST' })
  expect(pane.log).toEqual(['open', 'close:plugin'])
  /* The older draft is superseded by the submission that went through. */
  expect(fills).toEqual([])
  expect(parentOf(calls)).toEqual({ branchId, parent: earlier })
})

test('a choice that cannot be saved keeps the Pane open and says so, and may be retried', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const fills: string[] = []
  const pane = parentPane()
  const options = {
    store,
    fills,
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
    storeSetFailsFor: 'prompt-trail:branch:' as string | undefined,
  }
  installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)

  await pickParent($, pane, labels => labels[1])

  expect(pane.log).toEqual(['open'])
  expect(fills).toEqual([])
  expect(JSON.stringify(await renderParentPane($))).toContain('无法保存所选父节点')

  options.storeSetFailsFor = undefined
  await pickParent($, pane, labels => labels[1])

  expect(pane.log).toEqual(['open', 'close:plugin', 'fill'])
  expect(fills).toEqual([SECRET])
  expect(store[branchKey()]).toMatchObject({ parentEventId: forkPoint })
})

test('a choice made after the session moved on settles nothing and hands the draft back', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const fills: string[] = []
  const pane = parentPane()
  const classicSession = { id: sessionId }
  installSupportedTarget(on, {
    store,
    fills,
    parentPane: pane,
    classicSession,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)
  await composerPrompt($)

  /* A `/clear` or an in-process `/resume` while the Pane waited. */
  classicSession.id = '99999999-2222-4333-8444-555555555555'
  await pickParent($, pane, labels => labels[1])

  expect(store[branchKey()]).toEqual(stored(earlier))
  expect(pane.log).toEqual(['open', 'close:plugin', 'fill'])
  expect(fills).toEqual([SECRET])
  expect(pane.toasts).toEqual([expect.stringContaining('已失效')])
})

test('a Pane left open by a module instance that reloaded says so and closes', async ($, on) => {
  const pane = parentPane()
  installSupportedTarget(on, { store: consentedStore(), parentPane: pane })
  await $.session.start(session)

  const drawn = JSON.stringify(await renderParentPane($))
  await pane.clock?.settle()

  expect(drawn).toContain('已失效')
  expect(await parentChoices($)).toEqual([])
  expect(pane.log).toContain('close:plugin')
})

test('a Pane that cannot be opened hands the draft straight back', async ($, on) => {
  const fills: string[] = []
  const pane: ParentPane = { ...parentPane(), refused: true }
  const calls = installSupportedTarget(on, {
    store: consentedStore({ [branchKey()]: stored(earlier) }),
    fills,
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)

  const dropped = await composerPrompt($)

  expect(dropped).toMatchObject({ drop: expect.stringContaining('无法打开') })
  expect(dropped).not.toMatchObject({ drop: expect.stringContaining('PT-SECRET') })
  expect(fills).toEqual([SECRET])
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
})

test('a draft the prompt box will not take back is said to be lost, never claimed restored', async ($, on) => {
  const pane = parentPane()
  installSupportedTarget(on, {
    store: consentedStore({ [branchKey()]: stored(earlier) }),
    fillFails: true,
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)
  await composerPrompt($)

  await pickParent($, pane, labels => labels[0])

  expect(pane.toasts).toEqual([expect.stringContaining('草稿未能恢复，请重新输入')])
})

test('every candidate is offered, each on one row, with the ones the helper did not name counted', async ($, on) => {
  const tied = Array.from({ length: 8 }, (_, index) => `f${index}f${index}f${index}f${index}-0000-4000-8000-00000000000${index}`)
  const pane = parentPane()
  installSupportedTarget(on, {
    store: consentedStore({ [branchKey()]: stored(earlier) }),
    parentPane: pane,
    archive: [archivedEntry(earlier, 3, '一段很长的中文提示词用来验证按终端宽度截断')],
    branchMatch: { ...ambiguous(...tied), candidateCount: 12 },
  })
  await $.session.start(session)
  await composerPrompt($)

  const labels = await parentChoices($)
  expect(labels).toHaveLength(10)
  expect(labels.at(-1)).toBe('新根分支')
  expect(JSON.stringify(await renderParentPane($))).toContain('另有 4 个候选未列出')
  /* Ten cells across, less the frame's margin: wide characters count twice. */
  const narrow = JSON.stringify(await renderParentPane($, 12))
  expect(narrow).toContain('"#1 一段很…"')
})

test('a second press before the first choice is carried out is the same choice', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const fills: string[] = []
  const pane = parentPane()
  installSupportedTarget(on, {
    store,
    fills,
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)
  await composerPrompt($)
  await renderParentPane($)

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:parent:1', requestId: PARENT_PANE_ID })
  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:parent:root', requestId: PARENT_PANE_ID })
  await pane.clock?.settle()

  expect(store[branchKey()]).toMatchObject({ parentEventId: forkPoint })
  expect(fills).toEqual([SECRET])
  expect(pane.log).toEqual(['open', 'close:plugin', 'fill'])
})

test('an emoji drawn two cells wide is clipped as two cells', async ($, on) => {
  const pane = parentPane()
  installSupportedTarget(on, {
    store: consentedStore({ [branchKey()]: stored(earlier) }),
    parentPane: pane,
    archive: [archivedEntry(earlier, 3, 'R⌚⌚⌚⌚⌚⌚')],
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)
  await composerPrompt($)

  expect(JSON.stringify(await renderParentPane($, 12))).toContain('"#1 R⌚⌚…"')
})
