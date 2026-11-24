import type { CommandRunInput, ElementTable, EngineInterface, PromptSubmitInput, Register, RenderElement, RenderInput } from 'claude-code'
import { activeScopeKey, normalizeSettings, settingsKey, systemIsChinese } from './config'
import type { OriginalStyle, Scope, Settings, TargetLanguage } from './config'
import { sampleSource, sameDestination, SETUP_TOOL, setupChoices, setupResult, trialTargets } from './setup'
import type { Interview } from './setup'
import { cacheName, decodeCache, planCacheCleanup } from './cache'
import type { CacheRecord, InputTranslation, Reply } from './cache'
import { CONNECTION_KEY, extractTranslation, fillTemplate, httpRequest, validateConnection, validEndpoint } from './connection'
import type { TranslationConnection } from './connection'
import { convertPunctuation, hasImageReference, hasTranslatableText, maskProtected, restoreProtected, splitImageReferences } from './text'

const PANE_ID = 'chat-interpreter-settings'
const REPLY_LAYOUT_DELAY_MS = 100
const TRANSLATABLE_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

const WORDS = {
  en: {
    title: 'Chat Interpreter', project: 'Project', global: 'Global', scope: 'Active scope',
    punctuation: 'Convert punctuation', input: 'Translate user input', output: 'Translate agent output',
    inputTarget: 'Input target language', outputTarget: 'Output target language', outputMode: 'Output translation',
    automatic: 'Automatic', manual: 'Manual', translateReply: 'Translate reply',
    onlySuccess: 'Send input only after successful translation', original: 'Show original text',
    connectionReady: 'Translation connection configured. Change it with /chat-interpreter:setup.', connectionMissing: 'Connect a translator with /chat-interpreter:setup.',
    en: 'English', zh: 'Chinese', inputGroup: 'User input', outputGroup: 'Agent replies', general: 'General',
    translating: 'Translating…', hide: 'Hide translation', show: 'Show translation', sendAnyway: 'Send anyway',
    jumpToTranslation: 'Jump to translation',
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
    connectionReady: '已配置翻译连接。运行 /chat-interpreter:setup 可更改。', connectionMissing: '请运行 /chat-interpreter:setup 配置翻译连接。',
    en: '英文', zh: '中文', inputGroup: '用户输入', outputGroup: 'Agent 回复', general: '通用',
    translating: '翻译中…', hide: '收起译文', show: '查看译文', sendAnyway: '仍然发送',
    jumpToTranslation: '跳到译文',
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
  setup?: Interview
  setupTurn?: string
  root: string
  scope: Scope
  isChinese: boolean
  connectionAvailable: boolean
  settings: Record<Scope, Settings>
  pendingInputs: PendingInput[]
  inputRows: Map<string, InputTranslation>
  pendingSkillRows: string[]
  skillReplies: Map<string, Map<string, string>>
  responseRows: ResponseRow[]
  replies: Map<string, Reply>
  replyRows: Map<string, string>
  rowPrefixes: Map<string, string | null>
  unmatchedReplies: Map<string, string>
  outputRows: Map<string, string>
  hidden: Set<string>
  pendingJumps: Set<string>
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

const ROW_UUID = /^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-)[\da-f]{12}$/i

function indexRow(state: InterpreterState, row: string): void {
  const prefix = ROW_UUID.exec(row)?.[1]
  if (!prefix) return
  const prior = state.rowPrefixes.get(prefix)
  if (prior === undefined) state.rowPrefixes.set(prefix, row)
  else if (prior !== row) state.rowPrefixes.set(prefix, null)
}

function transcriptRow(state: InterpreterState, requestId: string): string {
  // The terminal replaces the UUID suffix with a block number for split messages.
  const prefix = ROW_UUID.exec(requestId)?.[1]
  if (prefix && /^\d{12}$/.test(requestId.slice(prefix.length))) {
    return state.rowPrefixes.get(prefix) ?? requestId
  }
  return requestId
}

function visibleReply(state: InterpreterState, requestId: string, text: string): Reply | undefined {
  const prefix = ROW_UUID.exec(requestId)?.[1]
  if (!prefix || !hasTranslatableText(text)) return undefined
  // Pending rows are grouped when their turn completes. Older rows can use their exact render ID.
  if (state.responseRows.some(row => row.uuid.startsWith(prefix))) return undefined
  return { original: text, anchor: requestId, rows: [requestId] }
}

function restoreRecord(state: InterpreterState, record: CacheRecord): void {
  if (record.kind === 'input') {
    indexRow(state, record.row)
    state.inputRows.set(record.row, record.value)
    const skill = record.value.skill
    if (skill?.replyRow) {
      indexRow(state, skill.replyRow)
      const originals = state.skillReplies.get(skill.replyRow) ?? new Map<string, string>()
      originals.set(record.row, skill.originalArgs)
      state.skillReplies.set(skill.replyRow, originals)
    }
  }
  if (record.kind === 'output') state.outputRows.set(outputKey(record.row, record.target), record.translated)
  if (record.kind === 'reply') {
    state.replies.set(record.row, record.value)
    for (const row of record.value.rows) {
      indexRow(state, row)
      state.replyRows.set(row, record.row)
    }
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
  state.rowPrefixes.clear()
  state.unmatchedReplies.clear()
  state.outputRows.clear()
  state.hidden.clear()
  state.pendingJumps.clear()
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
  await saveRecords($, state, [record])
}

async function saveRecords($: EngineInterface, state: InterpreterState, records: CacheRecord[]): Promise<void> {
  for (const record of records) restoreRecord(state, record)
  const { cacheDir, sessionId } = state
  if (!cacheDir || !sessionId) return
  let written = false
  try {
    for (const record of records) {
      const name = cacheName(sessionId, record)
      if (!name) continue
      await $.fs.write(`${cacheDir}/${name}`, JSON.stringify(record))
      written = true
    }
    if (written) await cleanCache($, cacheDir)
  } catch {
    if (!state.cacheWarning) $.ui.toast(words(state).cacheFailed)
    state.cacheWarning = true
  }
}

async function loadState($: EngineInterface, state: InterpreterState): Promise<void> {
  const repo = await $.session.repo()
  state.root = repo?.root ?? await $.session.cwd()
  const [active, project, global, connection, lcAll, lcMessages, lang] = await Promise.all([
    $.store.get(activeScopeKey(state.root)),
    $.store.get(settingsKey('project', state.root)),
    $.store.get(settingsKey('global', state.root)),
    $.store.get(CONNECTION_KEY),
    $.env.get('LC_ALL'), $.env.get('LC_MESSAGES'), $.env.get('LANG'),
  ])
  state.scope = active === 'global' ? 'global' : 'project'
  state.settings.project = normalizeSettings(project)
  state.settings.global = normalizeSettings(global)
  state.connectionAvailable = Boolean(connection)
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

async function privateConfig($: EngineInterface, state: InterpreterState, connection: TranslationConnection): Promise<{ secret?: string; endpoint?: string }> {
  const localUrl = connection.kind === 'http' && connection.url === 'local'
  if (!connection.credential && !localUrl) return {}
  let config: { secret?: string; endpoint?: string } = {}
  if (state.configDir) {
    try {
      config = JSON.parse(await $.fs.read(`${state.configDir}/chat-interpreter/credentials/${connection.id}.json`)) ?? {}
    } catch { /* The operator can provision this candidate while the session stays open. */ }
  }
  if (connection.credential && (typeof config.secret !== 'string' || !config.secret.trim() || /[\r\n\0]/.test(config.secret))) {
    throw new Error('Translation credential is missing or invalid. Provision it locally for this candidate.')
  }
  if (localUrl && !validEndpoint(config.endpoint)) throw new Error('The local translation endpoint is missing or invalid.')
  return config
}

async function credentialReady($: EngineInterface, state: InterpreterState, connection: TranslationConnection): Promise<boolean> {
  try { await privateConfig($, state, connection); return true } catch { return false }
}

async function translateText($: EngineInterface, connection: TranslationConnection, config: { secret?: string; endpoint?: string }, text: string, target: TargetLanguage): Promise<string> {
  const { masked, values } = maskProtected(text)
  let response: string
  if (connection.kind === 'http') {
    const endpoint = connection.url === 'local' ? config.endpoint! : connection.url
    const result = await $.http.fetch(endpoint, httpRequest(connection, masked, target, config.secret))
      .catch(() => { throw new Error('Translation HTTP request unavailable or failed on this surface.') })
    if (result.status === 401 || result.status === 403) throw new Error('Translation credential was rejected. Check local credentials and access.')
    if (!result.ok) throw new Error(`Translation HTTP request failed (status ${result.status}).`)
    response = result.text
  } else {
    const argv = [connection.program, ...connection.args.map(arg => fillTemplate(arg, masked, target))]
    const result = await $.process.run(argv, {
      stdin: fillTemplate(connection.stdin, masked, target),
      ...(connection.credential && { env: { [connection.credential.env]: config.secret! } }),
    }).catch(() => { throw new Error('Translation CLI unavailable on this surface or could not be launched.') })
    if (result.exitCode !== 0 || result.isStdoutTruncated) throw new Error('Translation CLI failed or its output was truncated.')
    response = result.stdout.replace(/\r?\n$/, '')
  }
  return restoreProtected(extractTranslation(response, connection.resultPath, config.secret), values)
}

async function translate($: EngineInterface, state: InterpreterState, text: string, target: TargetLanguage): Promise<string> {
  const saved = await $.store.get(CONNECTION_KEY)
  state.connectionAvailable = Boolean(saved)
  return runTranslation($, state, validateConnection(saved), text, target)
}

async function runTranslation($: EngineInterface, state: InterpreterState, connection: TranslationConnection, text: string, target: TargetLanguage): Promise<string> {
  const config = await privateConfig($, state, connection)
  if (!hasImageReference(text)) return translateText($, connection, config, text, target)
  // Keep the original image references even if the translator omits them.
  const result: string[] = []
  for (const part of splitImageReferences(text)) {
    if (part.protected || !hasTranslatableText(part.text)) {
      result.push(part.text)
      continue
    }
    const core = part.text.trim()
    const start = part.text.indexOf(core)
    const translated = await translateText($, connection, config, core, target)
    result.push(part.text.slice(0, start), translated.trim(), part.text.slice(start + core.length))
  }
  return result.join('')
}

function failureMessage(state: InterpreterState, kind: 'translationFailed' | 'inputBlocked' | 'inputFallback'): string {
  const w = words(state)
  return state.connectionAvailable ? w[kind] : `${w.connectionMissing} ${w[kind]}`
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
  const language = (target: TargetLanguage) => target === 'en' || target === 'zh' ? w[target] : target
  const section = (label: string) => {
    // The built-in labels contain only ASCII and Han characters.
    const labelCells = [...label].reduce((cells, char) => cells + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0)
    const title = Text({ bold: true, wrap: 'truncate-end', children: [label] })
    const ruleCells = e.props.bodyColumns - labelCells - 2
    if (ruleCells < 2) return Box({ justifyContent: 'center', children: [title] })
    const left = Math.floor(ruleCells / 2)
    const right = ruleCells - left
    return Box({ flexDirection: 'row', columnGap: 1, children: [
      Text({ dimColor: true, children: ['─'.repeat(left)] }),
      title,
      Text({ dimColor: true, children: ['─'.repeat(right)] }),
    ] })
  }
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
    Text({ dimColor: true, children: [state.connectionAvailable ? w.connectionReady : w.connectionMissing] }),
    section(w.inputGroup),
    toggle($, state, Button, 'translateInput', w.input, settings.translateInput),
    Text({ children: [`${w.inputTarget}: ${language(settings.inputTarget)}`] }),
    toggle($, state, Button, 'sendOnlyOnSuccess', w.onlySuccess, settings.sendOnlyOnSuccess),
    section(w.outputGroup),
    toggle($, state, Button, 'translateOutput', w.output, settings.translateOutput),
    Button({ key: 'outputMode', plain: true, label: `${w.outputMode}: ${settings.outputMode === 'automatic' ? w.automatic : w.manual} ↔`,
      onPress: () => saveSetting($, state, 'outputMode', settings.outputMode === 'automatic' ? 'manual' : 'automatic'),
    }),
    Text({ children: [`${w.outputTarget}: ${language(settings.outputTarget)}`] }),
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

function drawLabel(Text: ElementTable['Text'], label: string): RenderElement {
  return Text({ bold: true, inverse: true, children: [` ${label} `] })
}

function drawOriginal(elements: Pick<ElementTable, 'Box' | 'Text' | 'Markdown'>, label: string, text: string, style: OriginalStyle, columns: number): RenderElement {
  const { Box, Text } = elements
  const body = [drawLabel(Text, label), ...drawMessageText(elements, text, true)]
  if (style === 'box') return Box({ flexDirection: 'column', marginTop: 1, borderStyle: 'single', borderDimColor: true, paddingX: 1, children: body })
  if (style === 'doubleRule') {
    body.unshift(Box({ height: 1, overflow: 'hidden', children: [
      Text({ dimColor: true, children: ['═'.repeat(Math.max(1, Math.min(1000, columns)))] }),
    ] }))
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

function findFinalRow(rows: readonly ResponseRow[], answer: string): ResponseRow | undefined {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row && (row.text === answer || row.blocks.at(-1) === answer)) return row
  }
  return undefined
}

function replyRecord(row: ResponseRow, group: ResponseRow[]): Extract<CacheRecord, { kind: 'reply' }> {
  return { kind: 'reply', row: row.uuid, value: {
    original: group.map(item => item.text).join('\n\n'),
    anchor: row.uuid,
    rows: group.map(item => item.uuid),
  } }
}

function manualReplyRecords(rows: readonly ResponseRow[]): CacheRecord[] {
  const groups = new Map<string, ResponseRow[]>()
  for (const row of rows) {
    const key = row.messageId ?? row.uuid
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()].map(group => replyRecord(group.at(-1)!, group))
}

async function translateReply($: EngineInterface, state: InterpreterState, row: string, reply: Reply, settings: Settings): Promise<boolean> {
  const target = settings.outputTarget
  const key = outputKey(row, target)
  if (state.busy.has(key)) return false
  state.busy.add(key)
  const session = state.sessionId
  $.ui.invalidate('ui.render')
  try {
    const text = settings.punctuation ? convertPunctuation(reply.original, target) : reply.original
    const translated = await translate($, state, text, target)
    if (state.sessionId !== session) return false
    await saveRecord($, state, { kind: 'output', row, target, translated })
    if (state.sessionId !== session) return false
    state.hidden.delete(key)
    return true
  } catch {
    $.ui.toast(failureMessage(state, 'translationFailed'))
    return false
  } finally {
    state.busy.delete(key)
    $.ui.invalidate('ui.render')
  }
}

async function revealTranslation($: EngineInterface, state: InterpreterState, key: string, requestId: string): Promise<void> {
  const session = state.sessionId
  const result = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch(() => undefined)
  if (!result || session !== state.sessionId) return
  // A slow translation can outlive the click that authorized transcript scrolling.
  if (result.deny === 'not person-initiated') {
    state.pendingJumps.add(key)
    $.ui.invalidate('ui.render')
  } else if (!result.deny && state.pendingJumps.delete(key)) {
    $.ui.invalidate('ui.render')
  }
}

async function onReplyPress($: EngineInterface, state: InterpreterState, row: string, reply: Reply, requestId: string): Promise<void> {
  const settings = current(state)
  if (!settings.translateOutput || settings.outputMode !== 'manual') return
  const session = state.sessionId
  const key = outputKey(row, settings.outputTarget)
  if (state.outputRows.has(key)) {
    const showing = state.hidden.delete(key)
    if (!showing) state.hidden.add(key)
    $.ui.invalidate('ui.render')
    if (!showing) return
  } else if (!await translateReply($, state, row, reply, settings)) {
    return
  }
  // Scrolling against the old row layout can snap back when the terminal lays out the translation.
  await $.clock.sleep(REPLY_LAYOUT_DELAY_MS)
  const active = current(state)
  if (state.sessionId === session && active.translateOutput && active.outputTarget === settings.outputTarget &&
      !state.hidden.has(key)) {
    await revealTranslation($, state, key, requestId)
  }
}

async function translateInput($: EngineInterface, state: InterpreterState, text: string, target: TargetLanguage): Promise<string> {
  state.inputBusy++
  $.ui.invalidate('ui.render')
  try {
    return await translate($, state, text, target)
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
    $.ui.toast(failureMessage(state, 'inputFallback'))
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

async function setupAction($: EngineInterface, state: InterpreterState, interview: Interview, e: Record<string, unknown>) {
  const candidate = interview.candidate
  if (e.action === 'status') {
    const { translateInput, translateOutput, inputTarget, outputTarget } = current(state)
    return setupResult({
      scope: state.scope, translateInput, translateOutput, inputTarget, outputTarget, connected: state.connectionAvailable,
      ...(candidate ? { candidateId: candidate.id, credentialReady: await credentialReady($, state, candidate) } : {}),
    })
  }
  if (e.action === 'cancel' && interview.busy !== 'confirm') {
    state.setup = undefined
    return setupResult({ cancelled: true })
  }
  if (interview.busy) return { deny: 'Another setup operation is in progress.' }
  if (e.action === 'stage') {
    if (!e.connection || typeof e.connection !== 'object' || Array.isArray(e.connection)) return { deny: 'Supply a connection description.' }
    try {
      const description = { ...e.connection, id: crypto.randomUUID() }
      const next = validateConnection(description)
      if (candidate && !e.renewCredentials && sameDestination(candidate, next)) next.id = candidate.id
      interview.candidate = next
      interview.samples.clear()
      interview.review = undefined
      return setupResult({ candidateId: next.id, credentialReady: await credentialReady($, state, next) })
    } catch {
      return { deny: 'Invalid translation connection. Check the request description, credential reference, and result path.' }
    }
  }
  if (!candidate) return { deny: 'Stage a translation connection first.' }
  const scope = state.scope
  if (e.action === 'trial') {
    interview.review = undefined
    interview.busy = 'trial'
    try {
      const choices = setupChoices(e.mode, e.inputTarget, e.outputTarget)
      const samples = []
      for (const target of trialTargets(choices)) {
        const key = target.toLowerCase()
        let sample = interview.samples.get(key)
        if (!sample) {
          const source = sampleSource(target)
          const translation = await runTranslation($, state, candidate, source, target)
          if (state.setup !== interview) return { deny: 'The interview ended during the trial.' }
          sample = { target, source, translation }
          interview.samples.set(key, sample)
        }
        samples.push(sample)
      }
      interview.review = { scope, choices, replies: interview.replies }
      return setupResult({ scope, ...choices, samples })
    } catch (error) {
      return { deny: error instanceof Error ? error.message : 'Translation trial failed.' }
    } finally {
      interview.busy = undefined
    }
  }
  if (e.action !== 'confirm') return { deny: 'Unknown setup action.' }
  const review = interview.review
  if (!review || review.scope !== scope) return { deny: 'Run a trial for the current scope and choices first.' }
  if (interview.replies <= review.replies) return { deny: 'Show the samples and choices and wait for the person to confirm.' }
  interview.busy = 'confirm'
  try {
    const key = settingsKey(scope, state.root)
    const storedScope = await $.store.get(activeScopeKey(state.root))
    const prior = normalizeSettings(await $.store.get(key))
    if (state.setup !== interview || state.scope !== scope || (storedScope === 'global' ? 'global' : 'project') !== scope) {
      return { deny: 'The interview or active scope changed. Review the choices again.' }
    }
    const settings = { ...prior, ...review.choices }
    await $.store.set(key, settings)
    try {
      await $.store.set(CONNECTION_KEY, candidate)
    } catch {
      await $.store.set(key, prior)
      throw new Error('Save failed')
    }
    state.settings[scope] = settings
    state.connectionAvailable = true
    state.setup = undefined
    $.ui.invalidate('ui.render')
    return setupResult({ saved: true, scope })
  } catch {
    return { deny: 'Could not save the translation setup. Check local storage and retry.' }
  } finally {
    interview.busy = undefined
  }
}

export function register(on: Parameters<Register>[0]): void {
  const state: InterpreterState = {
    root: '', scope: 'project', isChinese: false, connectionAvailable: false,
    settings: { project: normalizeSettings(), global: normalizeSettings() },
    pendingInputs: [], inputRows: new Map(), pendingSkillRows: [], skillReplies: new Map(), responseRows: [], outputRows: new Map(),
    replies: new Map(), replyRows: new Map(), rowPrefixes: new Map(), unmatchedReplies: new Map(),
    hidden: new Set(), pendingJumps: new Set(), busy: new Set(), inputBusy: 0, cacheWarning: false,
  }

  on('session.start', async ($, e, next) => {
    await loadState($, state)
    await $.tool.register(SETUP_TOOL)
    await $.command.register({ name: 'chat-interpreter', description: 'Configure prompt and reply translation' })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'compact') state.setup = undefined
    await loadCache($, state, e.session_id).catch(() => undefined)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'chat-interpreter' }, async ($) => {
    state.connectionAvailable = Boolean(await $.store.get(CONNECTION_KEY))
    await $.ui.open({ id: PANE_ID, title: words(state).title, focus: true, closeOnEscape: true })
    return {}
  })

  on('tool.call', { tool: 'mcp__chat-interpreter__setup' }, async ($, e) => {
    const interview = state.setup
    if (!interview || e.agentId) return { deny: 'Start /chat-interpreter:setup in this conversation first.' }
    return setupAction($, state, interview, e)
  })

  on('command.run', async ($, e, next) => {
    if (e.command === 'chat-interpreter:setup') {
      if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return { text: 'Run /chat-interpreter:setup yourself to start the interview.' }
      if (state.setup?.busy === 'confirm') return { text: state.isChinese ? '正在保存翻译连接。' : 'Saving the translation connection.' }
      if (e.args.trim().toLowerCase() === 'cancel') {
        state.setup = undefined
        return { text: state.isChinese ? '已退出翻译设置。' : 'Translation setup closed.' }
      }
      state.setup = { replies: 0, samples: new Map() }
      state.blocked = undefined
      state.bypassDraft = undefined
      $.ui.invalidate('ui.render')
      return next(e)
    }
    if (state.setup) return next(e)
    if (e.command === 'chat-interpreter') return next(e)
    const settings = current(state)
    const args = await runSkill($, state, e, settings)
    if (args === undefined) return { text: failureMessage(state, 'inputBlocked') }
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
        Text({ dimColor: true, children: [failureMessage(state, 'inputBlocked')] }),
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
    if (state.setup) {
      if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') state.setup.replies++
      return next(e)
    }
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
      const reason = failureMessage(state, 'inputBlocked')
      $.ui.toast(reason)
      state.blocked = { kind: 'prompt', text: original, attachments: e.attachments }
      $.ui.invalidate('ui.render')
      return { drop: reason }
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
      if (blocks.length) state.responseRows.push({ uuid: e.uuid, text: blocks.join(''), blocks, messageId })
    }
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (state.setup) state.setupTurn = e.turnId
    const rows = state.pendingSkillRows.splice(0)
    if (current(state).showOriginal) {
      for (const row of rows) {
        const skill = state.inputRows.get(row)?.skill
        if (!skill) continue
        const visible = skill.originalArgs.replace(/\r\n?|\n/g, ' ↵ ').replace(/\t/g, ' ')
          .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
        $.ui.log(`${words(state).skillOriginal}: ${visible}`, { to: 'transcript' })
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const session = state.sessionId
    const rows = state.responseRows.splice(0)
    state.pendingSkillRows.length = 0
    const answer = e.reason === 'answer' ? e.answer : undefined
    const row = answer ? findFinalRow(rows, answer) : undefined
    const result = await next(e)
    if (state.setupTurn === e.turnId) {
      state.setupTurn = undefined
      return result
    }
    if (state.sessionId !== session || state.setup) return result
    const settings = current(state)
    if (settings.translateOutput && settings.outputMode === 'manual') {
      if (answer && !row) {
        const id = `turn:${e.turnId}`
        state.unmatchedReplies.set(answer, id)
        restoreRecord(state, { kind: 'reply', row: id, value: { original: answer, anchor: '', rows: [] } })
      }
      await saveRecords($, state, manualReplyRecords(rows))
      $.ui.invalidate('ui.render')
      return result
    }
    if (!answer) return result
    const group = row?.messageId ? rows.filter(item => item.messageId === row.messageId) : row ? [row] : []
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
    const item = state.inputRows.get(e.requestId) ?? state.inputRows.get(transcriptRow(state, e.requestId))
    if (!item || item.skill) return next(e)
    const settings = current(state)
    const w = words(state)
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const sent = hasImageReference(item.sent) ? await next(e) : undefined
    if (sent && !settings.showOriginal) return sent
    // The native terminal row includes a blank line before the image prompt.
    const imageRow = sent && e.surface === 'terminal' ? Box({ marginTop: -1, children: [sent] }) : sent
    return Box({ flexDirection: 'column', children: [
      ...(settings.showOriginal ? [drawLabel(Text, w.sentLabel)] : []),
      ...(imageRow ? [imageRow] : drawMessageText(elements, item.sent)),
      ...(settings.showOriginal ? [drawOriginal(elements, w.originalLabel, item.original, settings.originalStyle, e.viewport?.columns ?? 40)] : []),
    ] })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const settings = current(state)
    const displayRow = state.replyRows.has(e.requestId) ? e.requestId : transcriptRow(state, e.requestId)
    const registeredRow = state.replyRows.get(displayRow) ??
      (e.props.isFirstOfReply ? state.unmatchedReplies.get(e.props.text) : undefined)
    const row = registeredRow ?? e.requestId
    const key = outputKey(row, settings.outputTarget)
    const cached = state.outputRows.get(key)
    const reply = registeredRow ? state.replies.get(registeredRow)
      : settings.translateOutput && (settings.outputMode === 'manual' || cached !== undefined)
        ? visibleReply(state, e.requestId, e.props.text) : undefined
    if (!reply) {
      if (!state.skillReplies.has(e.requestId)) return next(e)
      return withSkillOriginals($.ui.resolve(e), state, e, await next(e))
    }
    if (reply.rows.length === 0 && !reply.anchor) {
      reply.anchor = e.requestId
      state.replyRows.set(e.requestId, row)
      state.unmatchedReplies.delete(e.props.text)
    }
    const translatable = settings.translateOutput && hasTranslatableText(reply.original)
    const manual = settings.outputMode === 'manual' && translatable
    const translated = settings.translateOutput && !state.hidden.has(key) ? cached : undefined
    const punctuation = settings.punctuation && !translatable
      ? convertPunctuation(reply.original, settings.outputTarget) : undefined
    const display = translated ?? punctuation
    const changed = display !== undefined && display !== reply.original
    const anchor = (displayRow === reply.anchor || e.requestId === reply.anchor) &&
      (reply.rows.length > 1 || e.props.isFirstOfReply || e.props.text === reply.original)
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
    const showJump = translated !== undefined && (state.pendingJumps.has(key) ||
      (e.surface === 'terminal' && settings.outputMode === 'automatic' && changed))
    if (showJump) children.push(Button({
      key: `jump:${row}`, variant: 'secondary', label: w.jumpToTranslation,
      onPress: () => revealTranslation($, state, key, e.requestId),
    }))
    if (state.busy.has(key)) children.push(Text({ dimColor: true, children: [w.translating] }))
    else if (manual) children.push(Button({
      key: `translate:${row}`, variant: cached === undefined ? 'primary' : 'secondary',
      label: cached === undefined ? w.translateReply : state.hidden.has(key) ? w.show : w.hide,
      onPress: () => onReplyPress($, state, row, reply, e.requestId),
    }))
    const drawn = children.length === 1 ? rendered : Box({ flexDirection: 'column', children })
    return withSkillOriginals(elements, state, e, drawn)
  })
}
