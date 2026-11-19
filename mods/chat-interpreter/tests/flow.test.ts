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
  notices: string[]
  rendered: string[]
  dropNextPrompt: boolean
  files: Record<string, string>
  submitted: string[]
  commands: string[]
  commandList: Array<{ name: string; description: string; source: 'user' | 'plugin'; plugin?: string }>
  waitForResponse?: Promise<void>
  fetchStarted?: () => void
}

function host(on: On, saved: Record<string, unknown> = {}): World {
  const world: World = {
    store: { ...saved }, env: { LANG: 'en_US.UTF-8', HOME: '/synthetic/home' }, requests: [], toasts: [], notices: [], rendered: [], dropNextPrompt: false,
    files: {}, submitted: [], commands: [],
    commandList: [{ name: 'review', description: 'Review', source: 'user' }],
    response: { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hello' } }] }) },
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.repo', () => ({ value: REPO }))
  on('session.cwd', () => ({ value: SESSION.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('store.get', (_$, e) => ({ value: world.store[e.key] }))
  on('store.set', (_$, e) => { world.store[e.key] = e.value; return { value: undefined } })
  on('env.get', (_$, e) => ({ value: world.env[e.name] }))
  on('fs.exists', (_$, e) => ({ value: Object.keys(world.files).some(path => path === e.path || path.startsWith(e.path + '/')) }))
  on('fs.write', (_$, e) => { world.files[e.path] = e.text; return { value: undefined } })
  on('fs.read', (_$, e) => ({ value: world.files[e.path] ?? '' }))
  on('fs.list', (_$, e) => ({
    value: Object.keys(world.files).filter(path => path.startsWith(e.path + '/')).map(path => ({
      name: path.slice(e.path!.length + 1), kind: 'file' as const, size: world.files[path]!.length, mtimeMs: Date.now(), isLink: false,
    })),
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: world.commandList }))
  on('command.run', (_$, e) => { world.commands.push(e.args); return { text: e.args } })
  on('prompt.read', () => ({ value: { text: 'existing draft', cursor: 0 } }))
  on('http.fetch', async (_$, e) => {
    world.requests.push(e.url)
    world.fetchStarted?.()
    await world.waitForResponse
    return { value: world.response }
  })
  on('ui.toast', (_$, e) => { world.toasts.push(e.text); return { value: undefined } })
  on('ui.log', (_$, e) => {
    if (e.to === 'transcript') world.notices.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', (_$, e) => {
    const text = 'text' in e.props ? String(e.props.text) : ''
    world.rendered.push(text)
    return { type: 'Text', props: {}, children: [text] }
  })
  on('prompt.submit', (_$, e) => {
    if (world.dropNextPrompt) { world.dropNextPrompt = false; return { drop: 'downstream' } }
    world.submitted.push(e.text)
    return { text: e.text, context: e.context, origin: e.origin }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
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

test('a new session without a key reports the cause when it blocks an image prompt', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '[Image #1]请解释 `foo()`。',
    attachments: [{ type: 'image', mediaType: 'image/png' }], origin: { kind: 'composer' }, wait: false })
  const reason = 'Missing DEEPSEEK_API_KEY in this Claude Code process. Translation failed. The original input is still in the prompt box.'
  expect(result).toMatchObject({ drop: reason })
  expect(world.requests).toHaveLength(0)
  expect(world.toasts).toEqual([reason])
})

test('missing key falls back to original when the success gate is off', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true, sendOnlyOnSuccess: false } })
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  expect(result).toMatchObject({ text: '你好' })
  expect(world.toasts).toEqual([expect.stringContaining('DEEPSEEK_API_KEY')])
})

test('translation failure sends the original even when punctuation conversion is on', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true, punctuation: true, sendOnlyOnSuccess: false } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.response = { ...world.response, status: 503, ok: false }
  await $.session.start(SESSION)
  const result = await $.prompt.submit({ text: '你好，', origin: { kind: 'composer' }, wait: false })
  expect(result).toMatchObject({ text: '你好，' })
  expect(world.toasts).toEqual(['Translation failed; sending original text.'])
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
  expect(world.rendered.at(-1)).toBe('你好')
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
  let release!: () => void
  world.waitForResponse = new Promise(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { world.fetchStarted = resolve })
  const press = row.press({ key: 'translate:manual-row' })
  await started
  try {
    await row.redraw({ text: 'Hello', isFirstOfReply: true } as never)
    expect(await row.find({ type: 'Text', text: 'Translating…' })).toBeDefined()
  } finally {
    release()
  }
  await press
  expect(world.requests).toHaveLength(1)
  await row.redraw({ text: 'Hello', isFirstOfReply: true } as never)
  expect(world.rendered.at(-1)).toBe('你好')
  expect(await row.find({ type: 'Markdown', text: 'Hello' })).toBeDefined()
  await row.press({ key: 'translate:manual-row' })
  await row.redraw({ text: 'Hello', isFirstOfReply: true } as never)
  expect(world.rendered.at(-1)).toBe('Hello')
  expect(await row.find({ type: 'Markdown', text: 'Hello' })).toBeUndefined()
  await row.press({ key: 'translate:manual-row' })
  expect(world.requests).toHaveLength(1)
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
  expect(world.rendered.slice(-2)).toEqual(['你好世界', ''])
})

test('resume restores input and reply cache with an actionable button and no request', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateOutput: true, outputMode: 'manual' } })
  await $.session.start(SESSION)
  const directory = '/synthetic/home/.claude/chat-interpreter-cache/resumed'
  world.files[`${directory}.input-row.input.json`] = JSON.stringify({
    kind: 'input', row: 'input-row', value: { original: '原文', sent: 'Sent', target: 'en' },
  })
  world.files[`${directory}.answer-row.reply.json`] = JSON.stringify({
    kind: 'reply', row: 'answer-row', value: { original: 'Hello', anchor: 'answer-row', rows: ['answer-row'] },
  })
  world.files[`${directory}.answer-row.output-zh.json`] = JSON.stringify({
    kind: 'output', row: 'answer-row', target: 'zh', translated: '你好',
  })
  await $.classic.SessionStart({ source: 'resume', session_id: 'resumed' })
  const input = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage',
    requestId: 'input-row', props: { text: 'Sent', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(await input.find({ type: 'Markdown', text: '原文' })).toBeDefined()
  const reply = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage',
    requestId: 'answer-row', props: { text: 'Hello', isFirstOfReply: true } } as never)
  expect(world.rendered.at(-1)).toBe('你好')
  await reply.press({ key: 'translate:answer-row' })
  expect(world.requests).toHaveLength(0)
})

test('an image prompt and its reply keep their translation UI when Claude normalizes render IDs', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true, translateOutput: true, outputMode: 'manual' } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  const inputId = '1f0e97b7-82dd-4768-ba10-be6f1ee002bd'
  const replyId = '556e5bea-c008-478e-b607-f03a31f918b7'
  const sent = '[Image #1] Explain the image.'
  const original = '[Image #1] 请解释图片。'
  const answer = 'The attached image is a test.'
  // The translator returns only prose. The host's image reference stays local.
  world.response.text = JSON.stringify({ choices: [{ message: { content: 'Explain the image.' } }] })
  await $.session.start(SESSION)
  const submitted = await $.prompt.submit({ text: original, attachments: [{ type: 'image', mediaType: 'image/png' }],
    origin: { kind: 'composer' }, wait: false })
  expect(submitted).toMatchObject({ text: sent })
  await $.session.append({ uuid: inputId, door: 'prompt', origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [
      { type: 'text', text: sent },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
    ] } })
  await $.session.append({ uuid: replyId, door: 'response', origin: { kind: 'model', model: 'synthetic' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: answer }] } })
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 'image-turn', reason: 'answer' })
  await $.classic.SessionStart({ source: 'resume', session_id: 'other-session' })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-1' })
  const input = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage',
    requestId: '1f0e97b7-82dd-4768-ba10-000000000000', props: { text: sent, origin: { kind: 'composer' }, isExpanded: false } } as never)
  expect(await input.find({ type: 'Markdown', text: original })).toBeDefined()
  expect(world.rendered).toContain(sent)
  const props = { text: answer, isFirstOfReply: true }
  const reply = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage',
    requestId: '556e5bea-c008-478e-b607-000000000000', props } as never)
  world.response.text = JSON.stringify({ choices: [{ message: { content: '附件是一张测试图片。' } }] })
  await reply.press({ key: `translate:${replyId}` })
  await reply.redraw(props as never)
  expect(world.rendered.at(-1)).toBe('附件是一张测试图片。')
})

test('slash submissions stay intact and verified skills translate only typed arguments', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.files['/synthetic/project/.claude/skills/review/SKILL.md'] = 'Skill body'
  await $.session.start(SESSION)
  const slash = await $.prompt.submit({ text: '/review 请审查', origin: { kind: 'composer' }, wait: false })
  expect(slash).toMatchObject({ text: '/review 请审查' })
  expect(world.requests).toHaveLength(0)
  const command = (name: string) => ({ command: name, args: '请审查', origin: { kind: 'composer' }, presentation: { columns: 80, isFullscreen: true } }) as never
  expect(await $.command.run(command('review'))).toMatchObject({ text: 'Hello' })
  await $.session.append({
    uuid: 'skill-row', door: 'command', origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{
      type: 'text',
      text: '<command-name>/review</command-name>\n    <command-message>review</command-message>\n    <command-args>Hello</command-args>',
    }] },
  })
  const saved = Object.entries(world.files).find(([path]) => path.endsWith('.skill-row.input.json'))
  expect(saved && JSON.parse(saved[1]).value).toMatchObject({ original: '/review 请审查', sent: '/review Hello' })
  expect(await $.command.run(command('unknown'))).toMatchObject({ text: '请审查' })
  expect(world.requests).toHaveLength(1)
})

test('translating a resumed reply to identical text shows the result without duplicating it', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateOutput: true, outputMode: 'manual' } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  const original = '这段原文已经是中文。'
  world.response.text = JSON.stringify({ choices: [{ message: { content: original } }] })
  world.files['/synthetic/home/.claude/chat-interpreter-cache/resumed.first-row.reply.json'] = JSON.stringify({
    kind: 'reply', row: 'first-row', value: { original, anchor: 'first-row', rows: ['first-row'] },
  })
  await $.session.start(SESSION)
  await $.classic.SessionStart({ source: 'resume', session_id: 'resumed' })
  const props = { text: original, isFirstOfReply: true }
  const row = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage',
    requestId: 'first-row', props } as never)
  await row.press({ key: 'translate:first-row' })
  await row.redraw(props as never)
  expect(await row.find({ type: 'Text', text: 'Translation matches the original.' })).toBeDefined()
  expect(await row.find({ type: 'Markdown', text: original })).toBeUndefined()
  expect(world.requests).toHaveLength(1)
  await row.press({ key: 'translate:first-row' })
  await row.redraw(props as never)
  expect(await row.find({ type: 'Text', text: 'Translation matches the original.' })).toBeUndefined()
})

test('translated skill arguments show their original once before the agent responds', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.files['/synthetic/project/.claude/skills/review/SKILL.md'] = 'The skill instruction body.'
  world.response.text = JSON.stringify({ choices: [{ message: { content: 'Is it normal?' } }] })
  await $.session.start(SESSION)
  await $.command.run({ command: 'review', args: '正常吗？', origin: { kind: 'composer' },
    presentation: { columns: 80, isFullscreen: true } } as never)
  await $.session.append({
    uuid: 'skill-cmp', door: 'command', origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{ type: 'text',
      text: '<command-name>/review</command-name>\n<command-args>Is it normal?</command-args>' }] },
  })
  await $.turn.start({ text: 'Is it normal?', turnId: 'skill-turn' })
  expect(world.notices).toEqual(['Original skill arguments: 正常吗？'])
  await $.session.append({
    uuid: 'skill-answer', door: 'response', origin: { kind: 'model', model: 'synthetic' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'My answer.' }] },
  })
  const target = { plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'skill-answer',
    props: { text: 'My answer.', isFirstOfReply: true } } as never
  const row = await $.ui.mount(target)
  expect(await row.find({ type: 'Markdown', text: '正常吗？' })).toBeUndefined()
  await row.unmount()
  await $.classic.SessionStart({ source: 'resume', session_id: 'other-session' })
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-1' })
  const resumed = await $.ui.mount(target)
  expect(await resumed.find({ type: 'Markdown', text: '正常吗？' })).toBeUndefined()
  await $.turn.start({ text: 'Another turn', turnId: 'next-turn' })
  expect(world.notices).toEqual(['Original skill arguments: 正常吗？'])
  expect(world.requests).toHaveLength(1)
})

test('an unmatched final answer offers a live manual translation without caching an unverified row', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateOutput: true, outputMode: 'manual' } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.response.text = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '你好' } }] })
  await $.session.start(SESSION)
  await $.turn.complete({ answer: 'Hello', durationMs: 1, isAborted: false, turnId: 'fallback-turn', reason: 'answer' })
  const props = { text: 'Hello', isFirstOfReply: true }
  const row = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'live-row', props } as never)
  await row.press({ key: 'translate:turn:fallback-turn' })
  await row.redraw(props as never)
  expect(world.rendered.at(-1)).toBe('你好')
  expect(Object.keys(world.files)).toEqual([])
})

test('a plugin skill declared in a nested manifest path translates its typed arguments', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  const command = 'mattpocock-skills:tdd'
  const root = '/synthetic/installed/mattpocock-skills'
  world.commandList.push({ name: command, description: 'TDD', source: 'plugin', plugin: 'mattpocock-skills' })
  world.files['/synthetic/home/.claude/plugins/installed_plugins.json'] = JSON.stringify({
    plugins: { 'mattpocock-skills@mattpocock': [{ installPath: root }] },
  })
  world.files[`${root}/.claude-plugin/plugin.json`] = JSON.stringify({ skills: ['./skills/engineering/tdd'] })
  world.files[`${root}/skills/engineering/tdd/SKILL.md`] = 'This is the skill body.'
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  world.response.text = JSON.stringify({ choices: [{ message: { content: 'Is it normal?' } }] })
  await $.session.start(SESSION)
  const result = await $.command.run({ command, args: '正常吗？', origin: { kind: 'composer' },
    presentation: { columns: 80, isFullscreen: true } } as never)
  expect(result).toMatchObject({ text: 'Is it normal?' })
})

test('long input and reply originals remain visible after translation', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true, translateOutput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  const original = 'Original text '.repeat(850) + '最後一段'
  await $.session.start(SESSION)
  await $.prompt.submit({ text: original, origin: { kind: 'composer' }, wait: false })
  await $.session.append({
    uuid: 'long-input', door: 'prompt', origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  })
  const input = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage', requestId: 'long-input',
    props: { text: 'Hello', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(await input.find({ type: 'Text', text: /最後一段/ })).toBeDefined()
  await $.session.append({
    uuid: 'long-reply', door: 'response', origin: { kind: 'model', model: 'synthetic' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: original }] },
  })
  await $.turn.complete({ answer: original, durationMs: 1, isAborted: false, turnId: 'long-turn', reason: 'answer' })
  const reply = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AssistantMessage', requestId: 'long-reply',
    props: { text: original, isFirstOfReply: true } } as never)
  expect(await reply.find({ type: 'Text', text: /最後一段/ })).toBeDefined()
})

test('failed prompt and skill translations can send their original text once', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.files['/synthetic/project/.claude/skills/review/SKILL.md'] = 'Skill body'
  await $.session.start(SESSION)
  const bandProps = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 } }
  const band = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: bandProps } as never)
  const prompt = await $.prompt.submit({ text: '你好，缓存', origin: { kind: 'composer' }, wait: false })
  expect(prompt).toHaveProperty('drop')
  await band.redraw(bandProps as never)
  expect(await band.find({ type: 'Text', text: /^Missing DEEPSEEK_API_KEY / })).toBeDefined()
  await band.press({ key: 'send-anyway' })
  expect(world.submitted).toEqual(['你好，缓存'])
  await band.redraw(bandProps as never)
  expect(await band.find({ key: 'send-anyway' })).toBeUndefined()
  await $.command.run({ command: 'review', args: '请审查', origin: { kind: 'composer' }, presentation: { columns: 80, isFullscreen: true } } as never)
  expect(world.commands).toEqual([])
  await band.redraw(bandProps as never)
  await band.press({ key: 'send-anyway' })
  expect(world.commands).toEqual(['请审查'])
})

test('input shows translation progress before the prompt enters', async ($, on) => {
  const world = host(on, { [projectKey(REPO.root)]: { translateInput: true } })
  world.env.DEEPSEEK_API_KEY = 'synthetic-key'
  await $.session.start(SESSION)
  const bandProps = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 } }
  const band = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: bandProps } as never)
  let release!: () => void
  world.waitForResponse = new Promise(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { world.fetchStarted = resolve })
  const submit = $.prompt.submit({ text: '你好', origin: { kind: 'composer' }, wait: false })
  await started
  try {
    expect(world.submitted).toEqual([])
    await band.redraw(bandProps as never)
    expect(await band.find({ type: 'Text', text: 'Translating…' })).toBeDefined()
  } finally {
    release()
  }
  await submit
  expect(world.submitted).toEqual(['Hello'])
  await band.redraw(bandProps as never)
  expect(await band.find({ type: 'Text', text: 'Translating…' })).toBeUndefined()
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
  const row = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage', requestId: 'input-row', props: { text: 'Hello', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(await row.find({ type: 'Markdown', text: '你好' })).toBeDefined()
  expect(await row.find({ type: 'Markdown', text: 'Hello' })).toBeDefined()
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
  const row = await $.ui.mount({ plugin: 'chat-interpreter', surface: 'terminal', component: 'UserMessage', requestId: 'later-prompt', props: { text: 'Hello', origin: { kind: 'composer' }, isExpanded: true } } as never)
  expect(await row.find({ type: 'Markdown', text: '您好' })).toBeDefined()
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
  expect(await pane.find({ key: 'originalStyle', text: /Box/ })).toBeDefined()
  await pane.press({ key: 'originalStyle' })
  expect(world.store[projectKey(REPO.root)]).toMatchObject({ originalStyle: 'doubleRule' })
  await pane.press({ key: 'scope' })
  expect(world.store[activeScopeKey(REPO.root)]).toBe('global')
  await pane.redraw({ title: 'Chat Interpreter', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } as never)
  await pane.press({ key: 'translateOutput' })
  await pane.press({ key: 'outputMode' })
  expect(world.store[settingsKey('global', REPO.root)]).toMatchObject({ outputMode: 'manual' })
  expect(world.store[settingsKey('global', REPO.root)]).toMatchObject({ translateOutput: true, translateInput: false })
  expect(world.store[projectKey(REPO.root)]).toMatchObject({ translateInput: true, translateOutput: false })
})
