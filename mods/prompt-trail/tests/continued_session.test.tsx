import { expect } from 'claude-code/testing'
import { test } from './support'
import type { BranchMatch, BranchState } from '../hooks/branch'
import type { ArchiveRow, ProcessCall } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  parentChoices,
  parentPane,
  pickParent,
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
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    parentPane: pane,
    classicSession: { id: continuedSession },
    continuedFrom: sourceSession,
    archive: [archivedEntry(earlier, 7, 'PT-SECRET-EARLIER')],
    branchMatch: { match: 'none', candidates: [], candidateCount: 0 },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(await parentChoices($)).toEqual(['#1 PT-SECRET-EARLIER', '新根分支'])
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

/* A conversation moved twice: from the source to a session that never
   submits, and from that one on. The locator names only the session just
   before. */
const laterSession = '88888888-2222-4333-8444-555555555555'

test('a session continued from one that never submitted still goes on along the first one’s branch', async ($, on) => {
  const store = consentedStore({ [branchKey(sourceSession)]: stored(earlier) })
  const classicSession = { id: continuedSession }
  const options = {
    store,
    classicSession,
    continuedFrom: sourceSession,
    archive: [archivedEntry(earlier, 7, 'PT-SECRET-EARLIER')],
    messages: [
      { role: 'user' as const, text: 'PT-SECRET-EARLIER' },
      { role: 'assistant' as const, text: 'reply' },
    ],
    branchMatch: unique(earlier),
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  /* Moved on before the middle session wrote anything. */
  classicSession.id = laterSession
  options.continuedFrom = continuedSession
  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(parentOf(captureCalls(calls, 'capture-begin')[0])).toEqual({ branchId, parent: earlier })
  expect(store[branchKey(continuedSession)]).toEqual(stored(earlier))
})

test('a continued session whose locator comes late takes up its source’s branch and compaction without submitting', async ($, on) => {
  const store = consentedStore({
    [branchKey(sourceSession)]: stored(earlier),
    [compactedKey(sourceSession)]: true,
  })
  const locatorPublished = { value: false }
  let clock: import('claude-code/testing').MockClock | undefined
  const calls = installSupportedTarget(on, {
    store,
    classicSession: { id: continuedSession },
    continuedFrom: sourceSession,
    locatorPublished,
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  expect(store[branchKey(continuedSession)]).toBeUndefined()

  locatorPublished.value = true
  await clock!.advance(2_000)

  expect(store[branchKey(continuedSession)]).toEqual(stored(earlier))
  expect(store[compactedKey(continuedSession)]).toBe(true)
  /* Nothing reaches the archive until the session writes. */
  expect(calls.filter(call => call.argv[1] === 'boundary-append')).toHaveLength(0)
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
