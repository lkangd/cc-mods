import { expect, test } from 'claude-code/testing'
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
  expect(captureCalls(calls, 'integrity-check')).toHaveLength(1)
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
  const options: TargetOptions = {
    store,
    generation,
    beginFails: 'archive-integrity',
    fills: [],
    unavailableAnswers: ['隔离并开始新档案'],
    /* Another Run quarantined it while this one's dialog was up. */
    duringAsk: () => {
      options.beginFails = false
      generation.value = 'gen-2'
    },
  }
  const calls = installSupportedTarget(on, options)
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'quarantine').map(call => call.argv[4])).toStrictEqual(['gen-1'])
  expect(store[archiveStateKey]).toBeUndefined()
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

  expect(status).toContain('Archive generation: 1000012-1f50')
  expect(status).toContain('Quarantined archives: 1')
  expect(status).toContain(`archives/quarantine/${projectId}/20260928T000000Z-1（8192 bytes）`)
  expect(status).toContain('重新检查完整性 / 隔离并开始新档案 / 禁用当前 Run 后继续')
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
  installSupportedTarget(on, { store })
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
  expect(store[`prompt-trail:reconcile:${projectId}`]).toBeUndefined()
})
