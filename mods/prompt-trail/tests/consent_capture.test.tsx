import { expect, test } from 'claude-code/testing'
import {
  SECRET,
  FINAL_SECRET,
  composerPrompt,
  databasePath,
  installSupportedTarget,
  projectId,
  promptHistory,
  runId,
  session,
  type TargetOptions,
} from './support'

test('declining consent lets the prompt enter without creating archive state', async ($, on) => {
  const calls = installSupportedTarget(on, { ask: '继续但不启用' })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  expect(calls.some(call => call.argv.includes(databasePath))).toBe(false)
  const status = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  expect(status.text).toContain('collection consent: declined')
  expect(status.text).toContain('archive: not created')
})

test('enabled consent stages through stdin and confirms the final prompt atomically', async ($, on) => {
  const calls = installSupportedTarget(on, { ask: '启用', rewrite: true })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: FINAL_SECRET })
  const begin = calls.find(call => call.argv[1] === 'capture-begin')
  const confirm = calls.find(call => call.argv[1] === 'capture-confirm')
  expect(begin?.stdin).toBe(SECRET)
  expect(confirm?.stdin).toBe(FINAL_SECRET)
  expect(begin?.argv).not.toContain(SECRET)
  expect(begin?.argv).not.toContain(FINAL_SECRET)
  expect(confirm?.argv).not.toContain(SECRET)
  expect(confirm?.argv).not.toContain(FINAL_SECRET)
  expect(JSON.stringify(calls.map(call => call.argv))).not.toContain('PT-SECRET')

  const status = await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  expect(status.text).toContain('collection consent: granted · policy 1')
  expect(status.text).toContain('Run collection mode: enabled')
  expect(status.text).toContain(`archive: ready · ${databasePath}`)
  expect(status.text).not.toContain('PT-SECRET')
})

test('status gives the size of the archive in place, or says it is unknown', async ($, on) => {
  const options: TargetOptions = { ask: '启用', archiveBytes: 20_480 }
  installSupportedTarget(on, options)
  await $.session.start(session)
  await composerPrompt($)

  const sized = (await promptHistory($, 'status')).text
  options.statusFails = 'archive-busy'
  const unknown = (await promptHistory($, 'status')).text

  expect(sized).toContain(`archive: ready · ${databasePath} · 20480 bytes`)
  expect(unknown).toContain(`archive: ready · ${databasePath} · size unknown`)
})

test('stored current-policy consent survives reload without another question', async ($, on) => {
  const calls = installSupportedTarget(on, {
    consent: { policyVersion: 1, decision: 'enabled' },
  })
  let questions = 0
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    questions += 1
    throw new Error('must not ask')
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(questions).toBe(0)
  expect(calls.some(call => call.argv[1] === 'capture-confirm')).toBe(true)
})

test('an older consent policy asks again before collection', async ($, on) => {
  const calls = installSupportedTarget(on, {
    ask: '继续但不启用',
    consent: { policyVersion: 0, decision: 'enabled' },
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('bare prompt-history expands and renders the confirmed first entry', async ($, on) => {
  installSupportedTarget(on, { ask: '启用' })
  await $.session.start(session)
  await composerPrompt($)

  const command = await $.command.run({
    command: 'prompt-history',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  expect(command.text).toContain('Prompt Trail 已展开')

  const tree = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    requestId: 'prompt-trail-band',
    viewport: { columns: 80, rows: 24 },
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  })
  const rendered = JSON.stringify(tree)
  expect(rendered).toContain('▾ Prompt Trail')
  expect(rendered).toContain(`1. ${SECRET.replace('\n', ' ↵ ')}`)
  expect(rendered).not.toContain('2. ')
})

test('a failed preflight blocks submission once collection is enabled', async ($, on) => {
  const calls = installSupportedTarget(on, {
    consent: { policyVersion: 1, decision: 'enabled' },
    preflightThrows: true,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ drop: expect.any(String) })
  expect(result.text).toBe(undefined)
  expect(JSON.stringify(result)).not.toContain('PT-SECRET')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('an unprovable project root blocks submission once collection is enabled', async ($, on) => {
  const calls = installSupportedTarget(on, {
    consent: { policyVersion: 1, decision: 'enabled' },
    gitExitCode: 128,
    hasGitDirectory: true,
  })
  await $.session.start(session)

  const first = await composerPrompt($)
  expect(first).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)

  const second = await composerPrompt($)
  expect(second).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

test('a confirmation failure keeps collection blocked across a reload', async ($, on) => {
  const store: Record<string, unknown> = {
    [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' },
  }
  /* The prompt appears twice, so the transcript cannot settle the pending. */
  const calls = installSupportedTarget(on, {
    store,
    confirmFails: true,
    messages: [{ role: 'user', text: SECRET }, { role: 'user', text: SECRET }],
  })
  await $.session.start(session)

  const first = await composerPrompt($)
  expect(first).toMatchObject({ text: SECRET })
  expect(calls.some(call => call.argv[1] === 'capture-confirm')).toBe(true)

  const blocked = await composerPrompt($)
  expect(blocked).toMatchObject({ drop: expect.any(String) })
  /* The prompt did enter the session, so the unresolved Pending Capture
     persists. The archive's refusal is on record for the other Runs too, until
     any write it takes lifts it (Issue 25). */
  expect(store[`prompt-trail:reconcile:${projectId}:${runId}`]).toMatchObject({
    version: 1,
    eventId: expect.any(String),
  })
  expect(store[`prompt-trail:archive-state:${projectId}`])
    .toMatchObject({ state: 'unavailable', category: 'archive-sqlite' })
})

test('a store write failure never blocks a prompt the person declined to collect', async ($, on) => {
  const calls = installSupportedTarget(on, {
    ask: '继续但不启用',
    storeSetFails: true,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(JSON.stringify(result)).not.toContain('PT-SECRET-STORE')
  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
})

