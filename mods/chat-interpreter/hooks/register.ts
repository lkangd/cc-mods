import type { CommandRunInput, ElementTable, EngineInterface, PromptSubmitInput, Register, RenderElement, RenderInput } from 'claude-code'
import { activeScopeKey, normalizeSettings, settingsKey, systemIsChinese } from './config'
import type { OriginalStyle, Scope, Settings, TargetLanguage } from './config'
import { cacheName, decodeCache, planCacheCleanup } from './cache'
import type { CacheRecord, InputTranslation, Reply } from './cache'
import { DEEPSEEK_URL, translationRequest, translationResult } from './deepseek'
import { convertPunctuation, hasTranslatableText } from './text'

const PANE_ID = 'chat-interpreter-settings'
const TRANSLATABLE_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

const WORDS = {
  en: {
    title: 'Chat Interpreter', project: 'Project', global: 'Global', scope: 'Active scope',
    punctuation: 'Convert punctuation', input: 'Translate user input', output: 'Translate agent output',
    inputTarget: 'Input target language', outputTarget: 'Output target language', outputMode: 'Output translation',
    automatic: 'Automatic', manual: 'Manual', translateReply: 'Translate reply',
    onlySuccess: 'Send input only after successful translation', original: 'Show original text',
    keyReady: 'DeepSeek API key: configured', keyMissing: 'DeepSeek API key: missing (DEEPSEEK_API_KEY)',
    en: 'English', zh: 'Chinese', inputGroup: 'User input', outputGroup: 'Agent replies', general: 'General',
    translating: 'Translating…', hide: 'Hide translation', show: 'Show translation', sendAnyway: 'Send anyway',
    identical: 'Translation matches the original.',
    skillOriginal: 'Original skill arguments',
    originalStyle: 'Original text divider', box: 'Box', doubleRule: 'Double line', none: 'None',
    cacheFailed: 'Translation history could not be saved.',
    originalLabel: 'Original', sentLabel: 'Sent to Claude', translationFailed: 'Translation failed; showing original text.',
    inputBlocked: 'Translation failed. The original input is still in the prompt box.',
    inputFallback: 'Translation failed; sending original text.',
  },
  zh: {
    title: '聊天翻译', project: '项目', global: '全局', scope: '当前范围',
    punctuation: '转换标点符号', input: '翻译用户输入', output: '翻译 Agent 输出',
    inputTarget: '输入目标语言', outputTarget: '输出目标语言', outputMode: '输出翻译方式',
    automatic: '自动', manual: '手动', translateReply: '翻译此回复',
    onlySuccess: '翻译成功才发送输入', original: '显示原文',
    keyReady: 'DeepSeek API 密钥：已配置', keyMissing: 'DeepSeek API 密钥：缺少 DEEPSEEK_API_KEY',
    en: '英文', zh: '中文', inputGroup: '用户输入', outputGroup: 'Agent 回复', general: '通用',
    translating: '翻译中…', hide: '收起译文', show: '查看译文', sendAnyway: '仍然发送',
    identical: '译文与原文相同。',
    skillOriginal: '技能原始参数',
    originalStyle: '原文分隔样式', box: '方框', doubleRule: '双横线', none: '无',
    cacheFailed: '无法保存翻译历史。',
    originalLabel: '原文', sentLabel: '发送给 Claude', translationFailed: '翻译失败，显示原文。',
    inputBlocked: '翻译失败，原始输入仍在输入框中。',
    inputFallback: '翻译失败，发送原文。',
  },
}

type ResponseRow = { uuid: string; text: string; blocks: string[]; messageId?: string }
type Blocked = { kind: 'prompt'; text: string; attachments?: PromptSubmitInput['attachments'] }
  | { kind: 'skill'; command: string; args: string }
type PendingInput = InputTranslation & { skillMatch?: { command: string; args: string } }
type InterpreterState = {
  root: string
  scope: Scope
  isChinese: boolean
  keyAvailable: boolean
  settings: Record<Scope, Settings>
  pendingInputs: PendingInput[]
  inputRows: Map<string, InputTranslation>
  pendingSkillRows: string[]
  skillReplies: Map<string, Map<string, string>>
  responseRows: ResponseRow[]
  replies: Map<string, Reply>
  replyRows: Map<string, string>
  unmatchedReplies: Map<string, string>
  outputRows: Map<string, string>
  hidden: Set<string>
  busy: Set<string>
  inputBusy: number
  blocked?: Blocked
  bypassDraft?: string
  cacheDir?: string
  configDir?: string
  sessionId?: string
  cacheWarning: boolean
}

function words(state: InterpreterState): typeof WORDS.en { return WORDS[state.isChinese ? 'zh' : 'en'] }
function current(state: InterpreterState): Settings { return state.settings[state.scope] }
function textBlocks(message: { content: readonly unknown[] }): string[] {
  return message.content.flatMap(block => {
    if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'text') return []
    return 'text' in block && typeof block.text === 'string' ? [block.text] : []
  })
}

function outputKey(row: string, target: TargetLanguage): string {
  return `${row}:${target}`
}

function restoreRecord(state: InterpreterState, record: CacheRecord): void {
  if (record.kind === 'input') {
    state.inputRows.set(record.row, record.value)
    const skill = record.value.skill
    if (skill?.replyRow) {
      const originals = state.skillReplies.get(skill.replyRow) ?? new Map<string, string>()
      originals.set(record.row, skill.originalArgs)
      state.skillReplies.set(skill.replyRow, originals)
    }
  }
  if (record.kind === 'output') state.outputRows.set(outputKey(record.row, record.target), record.translated)
  if (record.kind === 'reply') {
    state.replies.set(record.row, record.value)
    for (const row of record.value.rows) state.replyRows.set(row, record.row)
  }
}

async function cleanCache($: EngineInterface, dir: string): Promise<string[]> {
  if (!await $.fs.exists(dir)) return []
  const plan = planCacheCleanup(await $.fs.list(dir), Date.now())
  for (let i = 0; i < plan.remove.length; i += 100) {
    const paths = plan.remove.slice(i, i + 100).map(name => `${dir}/${name}`)
    const result = await $.process.run(['rm', '-f', '--', ...paths])
    if (result.exitCode !== 0) throw new Error('Translation cache cleanup failed')
  }
  return plan.keep
}

async function readCacheRecord($: EngineInterface, dir: string, name: string): Promise<CacheRecord | undefined> {
  try {
    return decodeCache(await $.fs.read(`${dir}/${name}`))
  } catch {
    // An expired or incomplete cache file can be skipped.
    return undefined
  }
}

async function loadCache($: EngineInterface, state: InterpreterState, id?: string): Promise<void> {
  if (!state.cacheDir) return
  const sessionId = id ?? await $.session.id()
  if (state.sessionId === sessionId) return
  state.sessionId = sessionId
  state.inputRows.clear()
  state.pendingSkillRows.length = 0
  state.skillReplies.clear()
  state.replies.clear()
  state.replyRows.clear()
  state.unmatchedReplies.clear()
  state.outputRows.clear()
  state.hidden.clear()
  state.pendingInputs.length = 0
  state.responseRows.length = 0
  state.blocked = undefined
  state.bypassDraft = undefined
  const dir = state.cacheDir
  const names = (await cleanCache($, dir)).filter(name => name.startsWith(`${sessionId}.`))
  for (let i = 0; i < names.length; i += 8) {
    const batch = names.slice(i, i + 8)
    const records = await Promise.all(batch.map(name => readCacheRecord($, dir, name)))
    if (state.sessionId !== sessionId) return
    for (const [index, record] of records.entries()) {
      if (record && cacheName(sessionId, record) === batch[index]) restoreRecord(state, record)
    }
  }
}

async function saveRecord($: EngineInterface, state: InterpreterState, record: CacheRecord): Promise<void> {
  restoreRecord(state, record)
  if (!state.cacheDir || !state.sessionId) return
  const name = cacheName(state.sessionId, record)
  if (!name) return
  try {
    await $.fs.write(`${state.cacheDir}/${name}`, JSON.stringify(record))
    await cleanCache($, state.cacheDir)
  } catch {
    if (!state.cacheWarning) $.ui.toast(words(state).cacheFailed)
    state.cacheWarning = true
  }
}

async function loadState($: EngineInterface, state: InterpreterState): Promise<void> {
  const repo = await $.session.repo()
  state.root = repo?.root ?? await $.session.cwd()
  const [active, project, global, key, lcAll, lcMessages, lang] = await Promise.all([
    $.store.get(activeScopeKey(state.root)),
    $.store.get(settingsKey('project', state.root)),
    $.store.get(settingsKey('global', state.root)),
    $.env.get('DEEPSEEK_API_KEY'),
    $.env.get('LC_ALL'), $.env.get('LC_MESSAGES'), $.env.get('LANG'),
  ])
  state.scope = active === 'global' ? 'global' : 'project'
  state.settings.project = normalizeSettings(project)
  state.settings.global = normalizeSettings(global)
  state.keyAvailable = Boolean(key)
  state.isChinese = systemIsChinese([lcAll, lcMessages, lang])
  const home = await $.env.get('HOME') ?? await $.env.get('USERPROFILE')
  state.configDir = await $.env.get('CLAUDE_CONFIG_DIR') || (home ? `${home}/.claude` : undefined)
  state.cacheDir = state.configDir ? `${state.configDir}/chat-interpreter-cache` : undefined
  await loadCache($, state).catch(() => undefined)
}

async function saveSetting<K extends keyof Settings>($: EngineInterface, state: InterpreterState, field: K, value: Settings[K]): Promise<void> {
  state.settings[state.scope] = { ...current(state), [field]: value }
  await $.store.set(settingsKey(state.scope, state.root), current(state))
  $.ui.invalidate('ui.render')
}

async function switchScope($: EngineInterface, state: InterpreterState, scope: string): Promise<void> {
  state.scope = scope === 'global' ? 'global' : 'project'
  await $.store.set(activeScopeKey(state.root), state.scope)
  $.ui.invalidate('ui.render')
}

async function translate($: EngineInterface, text: string, target: TargetLanguage): Promise<string> {
  const key = await $.env.get('DEEPSEEK_API_KEY')
  if (!key) throw new Error('DEEPSEEK_API_KEY is missing')
  const request = translationRequest(key, text, target)
  const response = await $.http.fetch(DEEPSEEK_URL, request.init)
  return translationResult(response, request.values)
}

function showFailure($: EngineInterface, state: InterpreterState, kind: 'translationFailed' | 'inputBlocked' | 'inputFallback'): void {
  $.ui.toast(words(state)[kind])
}

function toggle($: EngineInterface, state: InterpreterState, Button: ElementTable['Button'], key: 'punctuation' | 'translateInput' | 'translateOutput' | 'sendOnlyOnSuccess' | 'showOriginal', label: string, enabled: boolean): RenderElement {
  return Button({
    key,
    label: `${enabled ? '☑' : '☐'} ${label}`,
    plain: true,
    onPress: () => saveSetting($, state, key, !enabled),
  })
}

function drawSettings($: EngineInterface, state: InterpreterState, e: RenderInput<'Pane'>): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const w = words(state)
  const settings = current(state)
  const otherTarget = (target: TargetLanguage): TargetLanguage => target === 'en' ? 'zh' : 'en'
  const section = (label: string) => Box({ flexDirection: 'row', columnGap: 1, children: [
    Text({ bold: true, children: [label] }),
    Text({ dimColor: true, children: ['────────'] }),
  ] })
  return Box({ flexDirection: 'column', children: [
    section(w.general),
    Button({ key: 'scope', plain: true, label: `${w.scope}: ${state.scope === 'project' ? w.project : w.global} ↔`,
      onPress: () => switchScope($, state, state.scope === 'project' ? 'global' : 'project'),
    }),
    toggle($, state, Button, 'punctuation', w.punctuation, settings.punctuation),
    toggle($, state, Button, 'showOriginal', w.original, settings.showOriginal),
    Button({ key: 'originalStyle', plain: true, label: `${w.originalStyle}: ${w[settings.originalStyle]} ↔`,
      onPress: () => saveSetting($, state, 'originalStyle', NEXT_ORIGINAL_STYLE[settings.originalStyle]),
    }),
    Text({ dimColor: true, children: [state.keyAvailable ? w.keyReady : w.keyMissing] }),
    section(w.inputGroup),
    toggle($, state, Button, 'translateInput', w.input, settings.translateInput),
    Button({ key: 'inputTarget', plain: true, label: `${w.inputTarget}: ${w[settings.inputTarget]} ↔`,
      onPress: () => saveSetting($, state, 'inputTarget', otherTarget(settings.inputTarget)),
    }),
    toggle($, state, Button, 'sendOnlyOnSuccess', w.onlySuccess, settings.sendOnlyOnSuccess),
    section(w.outputGroup),
    toggle($, state, Button, 'translateOutput', w.output, settings.translateOutput),
    Button({ key: 'outputMode', plain: true, label: `${w.outputMode}: ${settings.outputMode === 'automatic' ? w.automatic : w.manual} ↔`,
      onPress: () => saveSetting($, state, 'outputMode', settings.outputMode === 'automatic' ? 'manual' : 'automatic'),
    }),
    Button({ key: 'outputTarget', plain: true, label: `${w.outputTarget}: ${w[settings.outputTarget]} ↔`,
      onPress: () => saveSetting($, state, 'outputTarget', otherTarget(settings.outputTarget)),
    }),
  ] })
}

function findPendingInput(state: InterpreterState, sent: string): InputTranslation | undefined {
  const command = sent.match(/<command-name>\s*\/([^<\s]+)\s*<\/command-name>/)?.[1]
  const args = sent.match(/<command-args>([\s\S]*)<\/command-args>\s*$/)?.[1]
  const index = state.pendingInputs.findIndex(item => item.sent === sent ||
    item.skillMatch && item.skillMatch.command === command && item.skillMatch.args === args)
  if (index < 0) return undefined
  const item = state.pendingInputs.splice(index, 1)[0]!
  return { original: item.original, sent: item.sent, target: item.target, skill: item.skill }
}

function forgetPendingInput(state: InterpreterState, pending: PendingInput): void {
  const index = state.pendingInputs.indexOf(pending)
  if (index >= 0) state.pendingInputs.splice(index, 1)
}

function enqueuePendingInput(state: InterpreterState, pending: PendingInput): void {
  if (state.pendingInputs.length >= 100) state.pendingInputs.shift()
  state.pendingInputs.push(pending)
}

function drawMessageText(elements: Pick<ElementTable, 'Markdown' | 'Text'>, text: string, dimColor = false): RenderElement[] {
  if (text.length <= 10000) return [elements.Markdown({ text, dimColor })]
  // Keep long text intact when the host's Markdown element cannot hold it.
  return (text.match(/[\s\S]{1,4000}/gu) ?? []).map(chunk => elements.Text({ dimColor, children: [chunk] }))
}

const NEXT_ORIGINAL_STYLE: Record<OriginalStyle, OriginalStyle> = { box: 'doubleRule', doubleRule: 'none', none: 'box' }

function drawOriginal(elements: Pick<ElementTable, 'Box' | 'Text' | 'Markdown'>, label: string, text: string, style: OriginalStyle, columns: number): RenderElement {
  const { Box, Text } = elements
  const body = [Text({ bold: true, dimColor: true, children: [label] }), ...drawMessageText(elements, text, true)]
  if (style === 'box') return Box({ flexDirection: 'column', marginTop: 1, borderStyle: 'single', borderDimColor: true, paddingX: 1, children: body })
  if (style === 'doubleRule') {
    body.unshift(Text({ dimColor: true, children: ['═'.repeat(Math.max(1, Math.min(48, columns - 8)))] }))
  }
  return Box({ flexDirection: 'column', marginTop: 1, children: body })
}

function withSkillOriginals(elements: ElementTable, state: InterpreterState, e: RenderInput<'AssistantMessage'>, rendered: RenderElement): RenderElement {
  const settings = current(state)
  const originals = state.skillReplies.get(e.requestId)
  if (!settings.showOriginal || !e.props.isFirstOfReply || !originals?.size) return rendered
  const { Box } = elements
  const children = [...originals.values()].map(text =>
    drawOriginal(elements, words(state).skillOriginal, text, settings.originalStyle, e.viewport?.columns ?? 40))
  return Box({ flexDirection: 'column', rowGap: 1, children: [...children, rendered] })
}

function findFinalRow(state: InterpreterState, answer: string): ResponseRow | undefined {
  for (let index = state.responseRows.length - 1; index >= 0; index--) {
    const row = state.responseRows[index]
    if (row && (row.text === answer || row.blocks.at(-1) === answer)) return row
  }
  return undefined
}

async function translateReply($: EngineInterface, state: InterpreterState, row: string, reply: Reply, settings: Settings): Promise<void> {
  const target = settings.outputTarget
  const key = outputKey(row, target)
  if (state.busy.has(key)) return
  state.busy.add(key)
  const session = state.sessionId
  $.ui.invalidate('ui.render')
  try {
    const text = settings.punctuation ? convertPunctuation(reply.original, target) : reply.original
    const translated = await translate($, text, target)
    if (state.sessionId === session) {
      await saveRecord($, state, { kind: 'output', row, target, translated })
      state.hidden.delete(key)
    }
  } catch {
    showFailure($, state, 'translationFailed')
  } finally {
    state.busy.delete(key)
    $.ui.invalidate('ui.render')
  }
}

async function onReplyPress($: EngineInterface, state: InterpreterState, row: string, reply: Reply): Promise<void> {
  const settings = current(state)
  if (!settings.translateOutput || settings.outputMode !== 'manual') return
  const key = outputKey(row, settings.outputTarget)
  if (state.outputRows.has(key)) {
    if (state.hidden.has(key)) state.hidden.delete(key)
    else state.hidden.add(key)
    $.ui.invalidate('ui.render')
    return
  }
  await translateReply($, state, row, reply, settings)
}

async function translateInput($: EngineInterface, state: InterpreterState, text: string, target: TargetLanguage): Promise<string> {
  state.inputBusy++
  $.ui.invalidate('ui.render')
  try {
    return await translate($, text, target)
  } finally {
    state.inputBusy--
    $.ui.invalidate('ui.render')
  }
}

async function processInput($: EngineInterface, state: InterpreterState, original: string, settings: Settings): Promise<string | undefined> {
  const text = settings.punctuation ? convertPunctuation(original, settings.inputTarget) : original
  if (!settings.translateInput || !hasTranslatableText(text)) return text
  try {
    return await translateInput($, state, text, settings.inputTarget)
  } catch {
    if (settings.sendOnlyOnSuccess) return undefined
    showFailure($, state, 'inputFallback')
    return original
  }
}

async function resendBlocked($: EngineInterface, state: InterpreterState, blocked: Blocked): Promise<void> {
  if (state.blocked !== blocked) return
  state.blocked = undefined
  $.ui.invalidate('ui.render')
  try {
    const original = blocked.kind === 'skill' ? `/${blocked.command} ${blocked.args}` : blocked.text
    if (blocked.kind === 'skill') {
      await $.command.run({ command: blocked.command, args: blocked.args })
    } else {
      // The host exposes attachment metadata only. Let the original composer
      // submit it intact rather than replaying an incomplete plugin prompt.
      if (blocked.attachments?.length || /(?:^|\s)@\S/.test(blocked.text)) {
        state.bypassDraft = blocked.text
        $.ui.toast(state.isChinese ? '请按回车发送原始草稿。' : 'Press Enter to send the original draft.')
        return
      }
      const result = await $.prompt.submit({ text: blocked.text, asUser: true })
      if (result.drop) return
    }
    const draft = await $.prompt.read().catch(() => undefined)
    if (draft?.text === original) await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
  } catch {
    state.blocked ??= blocked
    $.ui.invalidate('ui.render')
  }
}

async function knownSkill($: EngineInterface, state: InterpreterState, command: string): Promise<boolean> {
  const parts = command.split(':')
  const name = parts.at(-1)!
  if (parts.length > 2 || !parts.every(part => /^[\w-]+$/.test(part))) return false
  const registered = (await $.command.list()).find(item => item.name === command)
  if (registered?.source === 'builtin' || registered?.source === 'mcp') return false
  if (parts.length === 1 && registered?.source !== 'plugin') {
    for (const base of new Set([state.configDir, `${state.root}/.claude`, `${await $.session.cwd()}/.claude`])) {
      if (base && await $.fs.exists(`${base}/skills/${name}/SKILL.md`)) return true
    }
  }
  // The skill listing also contains legacy commands. Only accept a verified skill file.
  if (!state.configDir || parts.length !== 2) return false
  if (registered?.source !== 'plugin') return false
  const plugin = registered.plugin ?? parts[0]!
  const indexPath = `${state.configDir}/plugins/installed_plugins.json`
  if (!await $.fs.exists(indexPath)) return false
  const index = JSON.parse(await $.fs.read(indexPath)) as { plugins?: Record<string, { installPath?: string }[]> }
  const roots = new Set(Object.entries(index.plugins ?? {})
    .filter(([id]) => id === plugin || id.split('@')[0] === plugin)
    .flatMap(([, entries]) => entries.flatMap(entry => entry.installPath ? [entry.installPath] : [])))
  for (const root of roots) {
    if (await pluginProvidesSkill($, root, name)) return true
  }
  return false
}

async function pluginProvidesSkill($: EngineInterface, root: string, name: string): Promise<boolean> {
  if (await $.fs.exists(`${root}/skills/${name}/SKILL.md`)) return true
  try {
    const manifest = JSON.parse(await $.fs.read(`${root}/.claude-plugin/plugin.json`)) as { skills?: unknown }
    const declared = Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills]
    for (const value of declared) {
      if (typeof value !== 'string') continue
      const path = value.replace(/^\.\//, '').replace(/\/$/, '')
      if (!path.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '..' && part !== '.')) continue
      const tail = path.split('/').at(-1)
      const skillFile = tail === 'SKILL.md' ? path : `${path}/SKILL.md`
      const skillFolder = skillFile.split('/').at(-2)
      if (skillFolder === name && await $.fs.exists(`${root}/${skillFile}`)) return true
      if (tail !== 'SKILL.md' && await $.fs.exists(`${root}/${path}/${name}/SKILL.md`)) return true
    }
  } catch {
    return false
  }
  return false
}

async function runSkill($: EngineInterface, state: InterpreterState, e: CommandRunInput, settings: Settings): Promise<string | undefined> {
  if (!TRANSLATABLE_ORIGINS.has(e.origin.kind) || !e.args.trim() || (!settings.translateInput && !settings.punctuation)) return e.args
  if (!await knownSkill($, state, e.command).catch(() => false)) return e.args
  state.blocked = undefined
  const args = await processInput($, state, e.args, settings)
  if (args !== undefined) return args
  state.blocked = { kind: 'skill', command: e.command, args: e.args }
  const draft = await $.prompt.read().catch(() => undefined)
  if (draft && !draft.text) await $.prompt.fill({ text: `/${e.command} ${e.args}`, mode: 'replace' }).catch(() => undefined)
  $.ui.invalidate('ui.render')
  return undefined
}

export function register(on: Parameters<Register>[0]): void {
  const state: InterpreterState = {
    root: '', scope: 'project', isChinese: false, keyAvailable: false,
    settings: { project: normalizeSettings(), global: normalizeSettings() },
    pendingInputs: [], inputRows: new Map(), pendingSkillRows: [], skillReplies: new Map(), responseRows: [], outputRows: new Map(),
    replies: new Map(), replyRows: new Map(), unmatchedReplies: new Map(), hidden: new Set(), busy: new Set(), inputBusy: 0, cacheWarning: false,
  }

  on('session.start', async ($, e, next) => {
    await loadState($, state)
    await $.command.register({ name: 'chat-interpreter', description: 'Configure prompt and reply translation' })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await loadCache($, state, e.session_id).catch(() => undefined)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'chat-interpreter' }, async ($) => {
    state.keyAvailable = Boolean(await $.env.get('DEEPSEEK_API_KEY'))
    await $.ui.open({ id: PANE_ID, title: words(state).title, focus: true, closeOnEscape: true })
    return {}
  })

  on('command.run', async ($, e, next) => {
    if (e.command === 'chat-interpreter') return next(e)
    const settings = current(state)
    const args = await runSkill($, state, e, settings)
    if (args === undefined) return { text: words(state).inputBlocked }
    const pending: PendingInput | undefined = args !== e.args ? {
      original: `/${e.command} ${e.args}`,
      sent: `/${e.command} ${args}`,
      skill: { originalArgs: e.args },
      skillMatch: { command: e.command, args },
      target: settings.inputTarget,
    } : undefined
    if (pending) enqueuePendingInput(state, pending)
    try {
      const result = await next({ ...e, args })
      if (pending && result.exitCode) forgetPendingInput(state, pending)
      return result
    } catch (error) {
      if (pending) forgetPendingInput(state, pending)
      throw error
    }
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((!state.inputBusy && !state.blocked) || e.props.hasSurvey) return next(e)
    const rendered = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const blocked = state.blocked
    const feedback = state.inputBusy
      ? Text({ dimColor: true, children: [words(state).translating] })
      : Box({ flexDirection: 'row', columnGap: 1, children: [
        Text({ dimColor: true, children: [words(state).inputBlocked] }),
        Button({ key: 'send-anyway', label: words(state).sendAnyway, plain: true,
          onPress: () => blocked ? resendBlocked($, state, blocked) : undefined }),
      ] })
    return Box({ flexDirection: 'column', children: [rendered, feedback] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    return drawSettings($, state, e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!TRANSLATABLE_ORIGINS.has(e.origin.kind) && !(e.origin.kind === 'plugin' && e.origin.asUser && e.origin.name !== 'chat-interpreter')) return next(e)
    const bypass = state.bypassDraft
    state.bypassDraft = undefined
    if (bypass === e.text && e.origin.kind === 'composer') return next(e)
    if (state.blocked) {
      state.blocked = undefined
      $.ui.invalidate('ui.render')
    }
    if (/^\s*\//.test(e.text)) return next(e)
    const settings = current(state)
    const original = e.text
    const target = settings.inputTarget
    const sent = await processInput($, state, original, settings)
    if (sent === undefined) {
      showFailure($, state, 'inputBlocked')
      state.blocked = { kind: 'prompt', text: original, attachments: e.attachments }
      $.ui.invalidate('ui.render')
      return { drop: words(state).inputBlocked }
    }
    const pending = sent !== original ? { original, sent, target } : undefined
    if (pending) enqueuePendingInput(state, pending)
    const result = await next({ ...e, text: sent })
    if (pending && 'drop' in result) forgetPendingInput(state, pending)
    return result
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    if (current(state).translateInput && current(state).sendOnlyOnSuccess) {
      return { drop: words(state).inputBlocked }
    }
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (e.agentId) return next(e)
    if ((e.door === 'prompt' || e.door === 'command') && e.message.type === 'user') {
      const matched = findPendingInput(state, textBlocks(e.message).join(''))
      if (matched?.skill) state.pendingSkillRows.push(e.uuid)
      else if (e.door === 'prompt') state.pendingSkillRows.length = 0
      if (matched) await saveRecord($, state, { kind: 'input', row: e.uuid, value: matched })
    }
    if (e.door === 'response' && e.message.type === 'assistant') {
      const blocks = textBlocks(e.message)
      const messageId = 'id' in e.message && typeof e.message.id === 'string' ? e.message.id : undefined
      if (blocks.length) {
        state.responseRows.push({ uuid: e.uuid, text: blocks.join(''), blocks, messageId })
        if (state.pendingSkillRows.length) {
          for (const row of state.pendingSkillRows.splice(0)) {
            const input = state.inputRows.get(row)
            if (!input?.skill) continue
            const value = { ...input, skill: { ...input.skill, replyRow: e.uuid } }
            await saveRecord($, state, { kind: 'input', row, value })
          }
          $.ui.invalidate('ui.render')
        }
      }
      if (state.responseRows.length > 100) state.responseRows.shift()
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const session = state.sessionId
    const answer = !e.agentId && e.reason === 'answer' ? e.answer : undefined
    const row = answer ? findFinalRow(state, answer) : undefined
    const group = row?.messageId ? state.responseRows.filter(item => item.messageId === row.messageId) : row ? [row] : []
    if (!e.agentId) {
      state.responseRows.length = 0
      state.pendingSkillRows.length = 0
    }
    const result = await next(e)
    if (!answer || state.sessionId !== session) return result
    const settings = current(state)
    const id = row?.uuid ?? `turn:${e.turnId}`
    const reply = { original: row ? group.map(item => item.text).join('\n\n') : answer, anchor: row?.uuid ?? '', rows: group.map(item => item.uuid) }
    const record = { kind: 'reply', row: id, value: reply } as const
    if (!row) state.unmatchedReplies.set(answer, id)
    if (row && (settings.translateOutput || settings.punctuation)) await saveRecord($, state, record)
    else restoreRecord(state, record)
    $.ui.invalidate('ui.render')
    if (settings.translateOutput && settings.outputMode === 'automatic' && hasTranslatableText(reply.original)) {
      await translateReply($, state, id, reply, settings)
    }
    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const item = state.inputRows.get(e.requestId)
    if (!item || item.skill) return next(e)
    const settings = current(state)
    const w = words(state)
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    return Box({ flexDirection: 'column', children: [
      Text({ bold: true, children: [w.sentLabel] }),
      ...drawMessageText(elements, item.sent),
      ...(settings.showOriginal ? [drawOriginal(elements, w.originalLabel, item.original, settings.originalStyle, e.viewport?.columns ?? 40)] : []),
    ] })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const row = state.replyRows.get(e.requestId) ??
      (e.props.isFirstOfReply ? state.unmatchedReplies.get(e.props.text) : undefined)
    const reply = row ? state.replies.get(row) : undefined
    if (!row || !reply) {
      if (!state.skillReplies.has(e.requestId)) return next(e)
      return withSkillOriginals($.ui.resolve(e), state, e, await next(e))
    }
    if (reply.rows.length === 0 && !reply.anchor) {
      reply.anchor = e.requestId
      state.replyRows.set(e.requestId, row)
      state.unmatchedReplies.delete(e.props.text)
    }
    const settings = current(state)
    const key = outputKey(row, settings.outputTarget)
    const cached = state.outputRows.get(key)
    const translatable = settings.translateOutput && hasTranslatableText(reply.original)
    const manual = settings.outputMode === 'manual' && translatable
    const translated = settings.translateOutput && !state.hidden.has(key) ? cached : undefined
    const punctuation = settings.punctuation && !translatable
      ? convertPunctuation(reply.original, settings.outputTarget) : undefined
    const display = translated ?? punctuation
    const changed = display !== undefined && display !== reply.original
    const anchor = e.requestId === reply.anchor && (reply.rows.length > 1 || e.props.isFirstOfReply || e.props.text === reply.original)
    if (!anchor) {
      const rendered = changed ? await next({ ...e, props: { ...e.props, text: '' } }) : await next(e)
      if (!state.skillReplies.has(e.requestId)) return rendered
      return withSkillOriginals($.ui.resolve(e), state, e, rendered)
    }
    const rendered = await next({ ...e, props: { ...e.props, text: changed ? display : e.props.text } })
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const w = words(state)
    const children: RenderElement[] = [rendered]
    if (changed && settings.showOriginal) {
      children.push(drawOriginal(elements, w.originalLabel, reply.original, settings.originalStyle, e.viewport?.columns ?? 40))
    }
    if (translated === reply.original) children.push(Text({ dimColor: true, children: [w.identical] }))
    if (state.busy.has(key)) children.push(Text({ dimColor: true, children: [w.translating] }))
    else if (manual) children.push(Button({
      key: `translate:${row}`, plain: true, label: cached === undefined ? w.translateReply : state.hidden.has(key) ? w.show : w.hide,
      onPress: () => onReplyPress($, state, row, reply),
    }))
    const drawn = children.length === 1 ? rendered : Box({ flexDirection: 'column', children })
    return withSkillOriginals(elements, state, e, drawn)
  })
}
