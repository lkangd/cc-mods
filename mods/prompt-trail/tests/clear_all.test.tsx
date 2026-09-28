import { expect, test } from 'claude-code/testing'
import type { LifecycleWrite } from '../hooks/lifecycle'
import {
  boundaryCalls,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  runId,
  session,
  sessionId,
} from './support'
import type { ArchiveRow } from './support'

/* Issue 30: clearing a Project Timeline. Everything archived before the cut
   goes, and nothing a writer of the cleared generation still owes may reach
   the next one. */

const otherRun = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' } }
}

function lifecycleKey(forRunId: string = runId): string {
  return `prompt-trail:lifecycle:${projectId}:${forRunId}`
}

function owedClear(generation?: string): LifecycleWrite {
  return {
    kind: 'clear',
    eventId: 'c'.repeat(64),
    runId: otherRun,
    segmentId: sessionId,
    branchId: 'dddddddd-eeee-4fff-8000-111111111111',
    occurredAt: 1_794_000_000_000,
    ...(generation ? { generation } : {}),
  }
}

test('an owed boundary is replayed into the generation it was owed to', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(otherRun)]: { version: 1, queue: [owedClear('gen-1')] },
  }
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  await composerPrompt($)

  expect(boundaryCalls(calls).map(call => call.argv[10])).toEqual(['gen-1'])
  expect(archive.map(row => row.kind)).toContain('clear')
})

test('a boundary owed to a cleared generation is dropped, not carried into the next', async ($, on) => {
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [lifecycleKey(otherRun)]: { version: 1, queue: [owedClear('gen-0')] },
  }
  const archive: ArchiveRow[] = []
  const calls = installSupportedTarget(on, { store, archive })

  await $.session.start(session)
  const result = await composerPrompt($)

  expect(result.drop).toBeUndefined()
  expect(archive.map(row => row.kind)).not.toContain('clear')
  expect((store[lifecycleKey(otherRun)] as { queue: unknown[] }).queue).toEqual([])
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
})

test('a lifecycle fact is owed to the generation in place when it happens', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, generation: { value: 'gen-7' } })

  await $.session.start(session)
  await composerPrompt($)

  const started = captureCalls(calls, 'boundary-append').filter(call => call.argv[7] === 'run-started')
  expect(started.map(call => call.argv[10])).toEqual(['gen-7'])
})
