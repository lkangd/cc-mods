import { expect, test } from 'claude-code/testing'
import type { BranchMatch, BranchState } from '../hooks/branch'
import type { ArchiveRow, ProcessCall } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  promptHistory,
  runId,
  session,
  sessionId,
} from './support'

/* A conversation moved to a background session goes on in a new classic
   session of the same Run. The bridge names the session it came from in the
   locator; the new session takes up that session's Active Branch rather than
   starting one of its own. */

const sourceSession = sessionId
const continuedSession = '77777777-2222-4333-8444-555555555555'
const branchId = 'b1b1b1b1-0000-4000-8000-000000000001'
const earlier = 'e1e1e1e1-0000-4000-8000-00000000000a'

const consent = { policyVersion: 1, decision: 'enabled' }

function consentedStore(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: consent, ...extra }
}

function branchKey(forSessionId: string): string {
  return `prompt-trail:branch:${projectId}:${runId}:${forSessionId}`
}

function stored(parentEventId: string | null): BranchState {
  return { version: 1, branchId, parentEventId }
}

function unique(eventId: string): BranchMatch {
  return {
    match: 'unique',
    eventId,
    candidates: [{ eventId, sequence: 7, runId }],
    candidateCount: 1,
  }
}

function archivedEntry(eventId: string, sequence: number, text: string): ArchiveRow {
  return {
    kind: 'prompt',
    eventId,
    sequence,
    runId,
    segmentId: sourceSession,
    branchId,
    parentEventId: null,
    text,
  }
}

function parentOf(call: ProcessCall | undefined): { branchId?: string; parent?: string } {
  return { branchId: call?.argv[6], parent: call?.argv[7] }
}

test('a continued session goes on along the branch of the session it came from', async ($, on) => {
  const store = consentedStore({ [branchKey(sourceSession)]: stored(earlier) })
  const calls = installSupportedTarget(on, {
    store,
    classicSession: { id: continuedSession },
    continuedFrom: sourceSession,
    archive: [archivedEntry(earlier, 7, 'PT-SECRET-EARLIER')],
    messages: [
      { role: 'user', text: 'PT-SECRET-EARLIER' },
      { role: 'assistant', text: 'reply' },
    ],
    branchMatch: unique(earlier),
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(parentOf(captureCalls(calls, 'capture-begin')[0])).toEqual({ branchId, parent: earlier })
  /* The branch is this session's own from here on; the source's stays put. */
  expect(store[branchKey(continuedSession)]).toMatchObject({ branchId })
  expect(store[branchKey(sourceSession)]).toEqual(stored(earlier))
})

function compactedKey(forSessionId: string): string {
  return `prompt-trail:compacted:${projectId}:${forSessionId}`
}

test('a continuation of a compacted session puts a lineage it cannot place to the person', async ($, on) => {
  /* The source was compacted before the move, so the copied transcript lacks
     the rows that would prove where its branch stands. */
  const store = consentedStore({
    [branchKey(sourceSession)]: stored(earlier),
    [compactedKey(sourceSession)]: true,
  })
  const parentQuestions: { question: string; labels: string[] }[] = []
  const calls = installSupportedTarget(on, {
    store,
    parentQuestions,
    classicSession: { id: continuedSession },
    continuedFrom: sourceSession,
    archive: [archivedEntry(earlier, 7, 'PT-SECRET-EARLIER')],
    branchMatch: { match: 'none', candidates: [], candidateCount: 0 },
    parentAnswer: () => undefined,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(parentQuestions[0]?.labels).toEqual(['#7 PT-SECRET-EARLIER', '新根分支'])
  expect(captureCalls(calls, 'branch-match')[0]?.argv[6]).toBe('truncated')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  /* Marked as its own, so a session continued from this one inherits it too. */
  expect(store[compactedKey(continuedSession)]).toBe(true)
})

test('a continued session that already has a branch of its own keeps it', async ($, on) => {
  const ownBranch = 'b3b3b3b3-0000-4000-8000-000000000003'
  const store = consentedStore({
    [branchKey(sourceSession)]: stored(earlier),
    [branchKey(continuedSession)]: { version: 1, branchId: ownBranch, parentEventId: null },
  })
  const calls = installSupportedTarget(on, {
    store,
    classicSession: { id: continuedSession },
    continuedFrom: sourceSession,
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(parentOf(captureCalls(calls, 'capture-begin')[0])).toEqual({ branchId: ownBranch, parent: '-' })
})

test('a continued session whose source recorded no branch starts one of its own', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    classicSession: { id: continuedSession },
    continuedFrom: sourceSession,
  })
  await $.session.start(session)

  await composerPrompt($)

  const begin = parentOf(captureCalls(calls, 'capture-begin')[0])
  expect(begin.parent).toBe('-')
  expect(begin.branchId).not.toBe(branchId)
  expect(store[branchKey(sourceSession)]).toBeUndefined()
})

for (const [name, continuedFrom] of [
  ['not an identifier', '../elsewhere'],
  ['the session itself', continuedSession],
] as const) {
  test(`a locator naming ${name} as the source is refused`, async ($, on) => {
    const calls = installSupportedTarget(on, {
      store: consentedStore(),
      classicSession: { id: continuedSession },
      continuedFrom,
    })
    await $.session.start(session)

    const status = await promptHistory($, 'status')

    expect(JSON.stringify(status)).toContain('locator-identifiers')
    expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  })
}
