import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { activeScopeKey, projectKey, settingsKey } from '../hooks/config'

const SESSION = { cwd: '/synthetic/project', surface: 'terminal', isInteractive: true } as const
const REPO = { root: '/synthetic/project', remote: null, internal: false, name: null }

type World = {
  store: Record<string, unknown>
  env: Record<string, string>
  requests: string[]
  response: { status: number; ok: boolean; headers: Record<string, string>; text: string }
  toasts: string[]
  rendered: string[]
  dropNextPrompt: boolean
}

function host(on: On, saved: Record<string, unknown> = {}): World {
  const world: World = {
    store: { ...saved }, env: { LANG: 'en_US.UTF-8' }, requests: [], toasts: [], rendered: [], dropNextPrompt: false,
    response: { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello' } }] }) },
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: REPO }))
  on('session.cwd', () => ({ value: SESSION.cwd }))
  on('store.get', (_$, e) => ({ value: world.store[e.key] }))
  on('store.set', (_$, e) => { world.store[e.key] = e.value; return { value: undefined } })
  on('env.get', (_$, e) => ({ value: world.env[e.name] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('http.fetch', (_$, e) => { world.requests.push(e.url); return { value: world.response } })
  on('ui.toast', (_$, e) => { world.toasts.push(e.text); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', (_$, e) => {
    const text = 'text' in e.props ? String(e.props.text) : ''
    world.rendered.push(text)
    return { type: 'Text', props: {}, children: [text] }
  })
  on('prompt.submit', (_$, e) => {
    if (world.dropNextPrompt) { world.dropNextPrompt = false; return { drop: 'downstream' } }
    return { text: e.text, context: e.context, origin: e.origin }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return world
}

test('a configured project loads in a new session and sends the translated input', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  expect(result).toMatchObject({ text: 'Hello' })
  expect(world.requests).toEqual(['https://api.deepseek.com/chat/completions'])
})

test('missing key blocks submission when success is required', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  expect(result).toHaveProperty('drop')
  expect(world.requests).toHaveLength(0)
  expect(world.toasts).toHaveLength(1)
})

test('missing key falls back to original when the success gate is off', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true, sendOnlyOnSuccess: false } })
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  expect(result).toMatchObject({ text: '你好' })
  expect(world.toasts).toHaveLength(1)
})

test('translation failure sends the original even when punctuation conversion is on', async ($, on) => {
  host(on, { [projectKey(REPO.root)]: { translateInput: true, punctuation: true, sendOnlyOnSuccess: false } })
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好，', origin: { kind: 'composer' }, wait: false })
  expect(result).toMatchObject({ text: '你好，' })
})

test('the final answer is translated for display while its stored row remains original', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateOutput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.response.text = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '你好' } }] })
  await $.session.start(SESSION)
  const stored = await $.session.append({
    uuid: 'answer-row', door: 'response', origin: { kind: 'model', model: 'synthetic' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
  })
  await $.turn.complete({ answer: 'Hello', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'answer-row', props: { text: 'Hello', isFirstOfReply: true } } as never)
  expect(stored.message?.content).toEqual([{ type: 'text', text: 'Hello' }])
  expect(world.rendered.at(-1)).toBe('你好\n\nOriginal:\nHello')
})

test('manual output translation waits for the reply button', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateOutput: true, outputMode: 'manual' } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.response.text = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '你好' } }] })
  await $.session.start(SESSION)
  await $.session.append({
    uuid: 'manual-row', door: 'response', origin: { kind: 'model', model: 'synthetic' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
  })
  await $.turn.complete({ answer: 'Hello', durationMs: 1, isAborted: false, turnId: 'manual-turn', reason: 'answer' })
  expect(world.requests).toHaveLength(0)
  const row = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'manual-row', props: { text: 'Hello', isFirstOfReply: true } } as never)
  expect(world.rendered.at(-1)).toBe('Hello')
  await row.press({ key: 'translate:manual-row' })
  expect(world.requests).toHaveLength(1)
  await row.redraw({ text: 'Hello', isFirstOfReply: true } as never)
  expect(world.rendered.at(-1)).toBe('你好\n\nOriginal:\nHello')
})

test('a final reply with two text blocks displays the aggregate translation once', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateOutput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.response.text = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '你好世界' } }] })
  await $.session.start(SESSION)
  await $.session.append({
    uuid: 'two-blocks', door: 'response', origin: { kind: 'model', model: 'synthetic' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }] },
  })
  await $.turn.complete({ answer: 'Hello world', durationMs: 1, isAborted: false, turnId: 'turn-2', reason: 'answer' })
  const first = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'two-blocks', props: { text: 'Hello', isFirstOfReply: true } } as never)
  await first.unmount()
  await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'two-blocks', props: { text: ' world', isFirstOfReply: false } } as never)
  expect(world.rendered.slice(-2)).toEqual(['你好世界\n\nOriginal:\nHello world', ''])
})

test('a new session reuses the saved global scope without changing project settings', async ($, on) => {
  const saved = {
    [projectKey(REPO.root)]: { translateInput: false },
    [settingsKey('global', REPO.root)]: { translateInput: true },
    [activeScopeKey(REPO.root)]: 'global',
  }
  const world = host(on, saved)
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  expect(result).toMatchObject({ text: 'Hello' })
  expect(world.store[projectKey(REPO.root)]).toEqual({ translateInput: false })
})

test('the user row shows both original input and the text sent to Claude', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  await $.session.start(SESSION)
  await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  await $.session.append({
    uuid: 'input-row', door: 'prompt', origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  })
  await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage', requestId: 'input-row', props: { text: 'Hello', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(world.rendered.at(-1)).toBe('Original: 你好\nSent to Claude: Hello')
})

test('a downstream drop does not attach the earlier original to a later prompt', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  await $.session.start(SESSION)
  world.dropNextPrompt = true
  await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '您好', origin: { kind: 'composer' }, wait: false })
  await $.session.append({
    uuid: 'later-prompt', door: 'prompt', origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  })
  await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage', requestId: 'later-prompt', props: { text: 'Hello', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(world.rendered.at(-1)).toBe('Original: 您好\nSent to Claude: Hello')
})

test('the settings pane persists project changes and switches to an independent global set', async ($, on) => {
  const world = host(on)
  await $.session.start(SESSION)
  const pane = await $.ui.mount({
    plugin: 'chat-interpreter', surface: 'terminal', component: 'Pane', requestId: 'chat-interpreter-settings',
    props: { title: 'Chat Interpreter', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  await pane.press({ key: 'translateInput' })
  expect(world.store[projectKey(REPO.root)]).toMatchObject({ translateInput: true })
  await pane.press({ key: 'scope' })
  expect(world.store[activeScopeKey(REPO.root)]).toBe('global')
  await pane.redraw({ title: 'Chat Interpreter', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } as never)
  await pane.press({ key: 'translateOutput' })
  await pane.press({ key: 'outputMode' })
  expect(world.store[settingsKey('global', REPO.root)]).toMatchObject({ outputMode: 'manual' })
  expect(world.store[settingsKey('global', REPO.root)]).toMatchObject({ translateOutput: true, translateInput: false })
  expect(world.store[projectKey(REPO.root)]).toMatchObject({ translateInput: true, translateOutput: false })
})
