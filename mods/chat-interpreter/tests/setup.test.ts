import { expect, test } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'
import { projectKey } from '../hooks/config'

const ROOT = '/project'
const SESSION = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
const TOOL = 'mcp__chat-interpreter__setup'
const COMMAND = 'chat-interpreter:setup'
const PERSON = { kind: 'composer' } as const

function setupHost(on: On, saved: Record<string, unknown> = {}) {
  const store = { ...saved }
  const requests: string[] = []
  const files: Record<string, string> = {}
  const service = { text: JSON.stringify({ translation: 'Bonjour' }), status: 200 }
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_$, e) => { files[e.path] = e.text; return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'interview' }))
  on('env.get', (_$, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/config' : undefined }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => { store[e.key] = e.value; return { value: undefined } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: TOOL } }))
  on('command.run', (_$, e) => ({ text: e.args }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('http.fetch', (_$, e) => {
    requests.push(e.url)
    return { value: { status: service.status, ok: service.status === 200, headers: {}, text: service.text } }
  })
  return { store, requests, files, service }
}

async function decoded(call: Promise<ToolCallResult>) {
  const response = await call
  return typeof response.result === 'string' ? { result: JSON.parse(response.result) } : response
}

test('only a person can start an interview, and cancelling restores blocked input', async ($, on) => {
  setupHost(on, { [projectKey(ROOT)]: { translateInput: true } })
  await $.session.start(SESSION)
  const status = () => decoded($.tool.call({ tool: TOOL, action: 'status' }))
  expect(await status()).toMatchObject({ deny: expect.any(String) })
  await $.command.run({ command: COMMAND, args: '', origin: { kind: 'plugin', name: 'other' } } as never)
  expect(await status()).toMatchObject({ deny: expect.any(String) })
  await $.command.run({ command: COMMAND, args: '', origin: PERSON } as never)
  expect(await status()).toMatchObject({ result: { scope: 'project', translateInput: true } })
  const send = () => $.prompt.submit({ text: '你好', origin: PERSON, wait: false })
  expect(await send()).toMatchObject({ text: '你好' })
  await $.tool.call({ tool: TOOL, action: 'cancel' })
  expect(await send()).toMatchObject({ drop: expect.any(String) })
})

const SERVICE = {
  kind: 'http', url: 'https://translation.example/translate',
  body: { source: '{{text}}', language: '{{target}}' }, resultPath: ['translation'],
}

test('both directions share a trial, and a new target must be reviewed before confirmation', async ($, on) => {
  const world = setupHost(on)
  await $.session.start(SESSION)
  await $.command.run({ command: COMMAND, args: '', origin: PERSON } as never)
  const setup = (action: string, fields = {}) => decoded($.tool.call({ tool: TOOL, action, ...fields }))
  expect(await setup('stage', { connection: SERVICE })).toMatchObject({ result: { candidateId: expect.any(String) } })
  const trial = (outputTarget: string) => setup('trial', { mode: 'both', inputTarget: 'fr', outputTarget })
  expect(await trial('fr')).toMatchObject({ result: { samples: [{ target: 'fr', translation: 'Bonjour' }] } })
  expect(await setup('confirm')).toMatchObject({ deny: expect.any(String) })
  await $.prompt.submit({ text: 'Use German for replies.', origin: PERSON, wait: false })
  expect(await trial('de')).toMatchObject({ result: { samples: [
    { target: 'fr', translation: 'Bonjour' }, { target: 'de', translation: 'Bonjour' },
  ] } })
  expect(await setup('confirm')).toMatchObject({ deny: expect.any(String) })
  await $.prompt.submit({ text: 'Yes, save these settings.', origin: PERSON, wait: false })
  expect(await setup('confirm')).toMatchObject({ result: { saved: true, scope: 'project' } })
  expect(world.requests).toEqual([SERVICE.url, SERVICE.url])
  expect(await $.prompt.submit({ text: 'Hello', origin: PERSON, wait: false })).toMatchObject({ text: 'Bonjour' })
  expect(world.requests).toHaveLength(3)
})


test('credentials can be provided in the same session, and a failed extraction cannot replace the active service', async ($, on) => {
  const existing = { ...SERVICE, id: 'existing-123', url: 'https://previous.example/translate' }
  const world = setupHost(on, { 'translation-connection': existing, [projectKey(ROOT)]: { translateInput: true } })
  await $.session.start(SESSION)
  await $.command.run({ command: COMMAND, args: '', origin: PERSON } as never)
  const setup = (action: string, fields = {}) => decoded($.tool.call({ tool: TOOL, action, ...fields }))
  const candidate = { ...SERVICE, url: 'local', credential: { header: 'X-Auth', prefix: '' } }
  const staged = await setup('stage', { connection: candidate })
  expect(staged).toMatchObject({ result: { credentialReady: false } })
  const trial = () => setup('trial', { mode: 'output', inputTarget: 'en', outputTarget: 'fr' })
  expect(await trial()).toMatchObject({ deny: expect.stringContaining('credential') })
  expect(world.requests).toHaveLength(0)
  const secret = 'dummy-private-test-value'
  const endpoint = 'https://private.example/translate'
  world.files[`/config/chat-interpreter/credentials/${staged.result.candidateId}.json`] = JSON.stringify({ secret, endpoint })
  expect(await setup('status')).toMatchObject({ result: { credentialReady: true } })
  world.service.text = JSON.stringify({ wrongField: secret })
  const failed = await trial()
  expect(failed).toMatchObject({ deny: expect.stringContaining('result') })
  expect(JSON.stringify(failed)).not.toContain(secret)
  expect(await setup('confirm')).toMatchObject({ deny: expect.any(String) })
  expect(await setup('stage', { connection: { ...candidate, resultPath: ['translated'] } })).toMatchObject({
    result: { candidateId: staged.result.candidateId, credentialReady: true },
  })
  world.service.text = JSON.stringify({ translated: 'Bonjour' })
  const sample = await trial()
  expect(sample).toMatchObject({ result: { samples: [{ target: 'fr', translation: 'Bonjour' }] } })
  expect(JSON.stringify(sample)).not.toContain(secret)
  expect(JSON.stringify(sample)).not.toContain(endpoint)
  await $.command.run({ command: COMMAND, args: 'cancel', origin: PERSON } as never)
  world.service.text = JSON.stringify({ translation: 'Previous service' })
  expect(await $.prompt.submit({ text: 'Hello', origin: PERSON, wait: false })).toMatchObject({ text: 'Previous service' })
  expect(world.requests).toEqual([endpoint, endpoint, existing.url])
})

for (const [mode, translateInput, translateOutput, sampleTarget] of [
  ['input', true, false, 'en'], ['output', false, true, 'fr'], ['later', false, false, 'en'],
] as const) {
  test(`${mode} activation saves only the active scope after a single trial`, async ($, on) => {
    const world = setupHost(on, {
      ['active-scope:' + ROOT]: 'global',
      [projectKey(ROOT)]: { punctuation: true, inputTarget: 'ja' },
      'settings:global': { translateInput: true, punctuation: true },
    })
    await $.session.start(SESSION)
    await $.command.run({ command: COMMAND, args: '', origin: PERSON } as never)
    const setup = (action: string, fields = {}) => decoded($.tool.call({ tool: TOOL, action, ...fields }))
    expect(await setup('status')).toMatchObject({ result: { scope: 'global', translateInput: true } })
    await setup('stage', { connection: SERVICE })
    const proposal = await setup('trial', { mode, inputTarget: 'en', outputTarget: 'fr' })
    expect(proposal).toMatchObject({ result: { scope: 'global', samples: [{ target: sampleTarget }], translateInput, translateOutput } })
    await $.prompt.submit({ text: 'Yes', origin: PERSON, wait: false })
    expect(await setup('confirm')).toMatchObject({ result: { saved: true } })
    expect(world.store['settings:global']).toMatchObject({ punctuation: true, translateInput, translateOutput, inputTarget: 'en', outputTarget: 'fr' })
    expect(world.store[projectKey(ROOT)]).toEqual({ punctuation: true, inputTarget: 'ja' })
    expect(world.requests).toHaveLength(1)
  })
}
