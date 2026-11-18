import type { ElementTable, EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'
import { activeScopeKey, normalizeSettings, settingsKey, systemIsChinese } from './config'
import type { Direction, Scope, Settings } from './config'
import { DEEPSEEK_URL, translationRequest, translationResult } from './deepseek'
import { convertPunctuation, hasSourceLanguage } from './text'

const PANE_ID = 'chat-interpreter-settings'
const TRANSLATABLE_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

const WORDS = {
  en: {
    title: 'Chat Interpreter', project: 'Project', global: 'Global', scope: 'Active scope',
    punctuation: 'Convert punctuation', input: 'Translate user input', output: 'Translate agent output',
    inputDirection: 'Input direction', outputDirection: 'Output direction', outputMode: 'Output translation',
    automatic: 'Automatic', manual: 'Manual', translateReply: 'Translate reply',
    onlySuccess: 'Send input only after successful translation', original: 'Show original text',
    keyReady: 'DeepSeek API key: configured', keyMissing: 'DeepSeek API key: missing (DEEPSEEK_API_KEY)',
    zhEn: 'Chinese → English', enZh: 'English → Chinese',
    originalLabel: 'Original', sentLabel: 'Sent to Claude', translationFailed: 'Translation failed; showing original text.',
    inputBlocked: 'Translation failed. The original input is still in the prompt box.',
    inputFallback: 'Translation failed; sending original text.',
  },
  zh: {
    title: '聊天翻译', project: '项目', global: '全局', scope: '当前范围',
    punctuation: '转换标点符号', input: '翻译用户输入', output: '翻译 Agent 输出',
    inputDirection: '输入方向', outputDirection: '输出方向', outputMode: '输出翻译方式',
    automatic: '自动', manual: '手动', translateReply: '翻译此回复',
    onlySuccess: '翻译成功才发送输入', original: '显示原文',
    keyReady: 'DeepSeek API 密钥：已配置', keyMissing: 'DeepSeek API 密钥：缺少 DEEPSEEK_API_KEY',
    zhEn: '中文 → 英文', enZh: '英文 → 中文',
    originalLabel: '原文', sentLabel: '发送给 Claude', translationFailed: '翻译失败，显示原文。',
    inputBlocked: '翻译失败，原始输入仍在输入框中。',
    inputFallback: '翻译失败，发送原文。',
  },
}

type RowTranslation = { original: string; translated: string }
type InputTranslation = { original: string; sent: string }
type ResponseRow = { uuid: string; text: string }
type InterpreterState = {
  root: string
  scope: Scope
  isChinese: boolean
  keyAvailable: boolean
  settings: Record<Scope, Settings>
  pendingInputs: InputTranslation[]
  inputRows: Map<string, InputTranslation>
  responseRows: ResponseRow[]
  outputRows: Map<string, RowTranslation>
  manualAnswers: Map<string, string>
  manualBusy: Set<string>
}

function words(state: InterpreterState): typeof WORDS.en { return WORDS[state.isChinese ? 'zh' : 'en'] }
function current(state: InterpreterState): Settings { return state.settings[state.scope] }
function incomingText(message: { content: readonly unknown[] }): string {
  return message.content.flatMap(block => {
    if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'text') return []
    return 'text' in block && typeof block.text === 'string' ? [block.text] : []
  }).join('')
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

async function translate($: EngineInterface, text: string, direction: Direction): Promise<string> {
  const key = await $.env.get('DEEPSEEK_API_KEY')
  if (!key) throw new Error('DEEPSEEK_API_KEY is missing')
  const request = translationRequest(key, text, direction)
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
  const directionLabel = (direction: Direction): string => direction === 'zh-en' ? w.zhEn : w.enZh
  const reverse = (direction: Direction): Direction => direction === 'zh-en' ? 'en-zh' : 'zh-en'
  return Box({ flexDirection: 'column', rowGap: 1, children: [
    Text({ children: [w.title] }),
    Button({ key: 'scope', plain: true, label: `${w.scope}: ${state.scope === 'project' ? w.project : w.global} ↔`,
      onPress: () => switchScope($, state, state.scope === 'project' ? 'global' : 'project'),
    }),
    toggle($, state, Button, 'punctuation', w.punctuation, settings.punctuation),
    toggle($, state, Button, 'translateInput', w.input, settings.translateInput),
    Button({ key: 'inputDirection', plain: true, label: `${w.inputDirection}: ${directionLabel(settings.inputDirection)} ↔`,
      onPress: () => saveSetting($, state, 'inputDirection', reverse(settings.inputDirection)),
    }),
    toggle($, state, Button, 'sendOnlyOnSuccess', w.onlySuccess, settings.sendOnlyOnSuccess),
    toggle($, state, Button, 'translateOutput', w.output, settings.translateOutput),
    Button({ key: 'outputMode', plain: true, label: `${w.outputMode}: ${settings.outputMode === 'automatic' ? w.automatic : w.manual} ↔`,
      onPress: () => saveSetting($, state, 'outputMode', settings.outputMode === 'automatic' ? 'manual' : 'automatic'),
    }),
    Button({ key: 'outputDirection', plain: true, label: `${w.outputDirection}: ${directionLabel(settings.outputDirection)} ↔`,
      onPress: () => saveSetting($, state, 'outputDirection', reverse(settings.outputDirection)),
    }),
    toggle($, state, Button, 'showOriginal', w.original, settings.showOriginal),
    Text({ dimColor: true, children: [state.keyAvailable ? w.keyReady : w.keyMissing] }),
  ] })
}

function findPendingInput(state: InterpreterState, sent: string): InputTranslation | undefined {
  const index = state.pendingInputs.findIndex(item => item.sent === sent)
  if (index < 0) return undefined
  return state.pendingInputs.splice(index, 1)[0]
}

function findFinalRow(state: InterpreterState, answer: string): ResponseRow | undefined {
  for (let index = state.responseRows.length - 1; index >= 0; index--) {
    const row = state.responseRows[index]
    if (row?.text === answer) return row
  }
  return undefined
}

async function translateManual($: EngineInterface, state: InterpreterState, key: string, answer: string): Promise<void> {
  if (state.manualBusy.has(key)) return
  state.manualBusy.add(key)
  try {
    const settings = current(state)
    let displayed = settings.punctuation ? convertPunctuation(answer, settings.outputDirection) : answer
    displayed = await translate($, displayed, settings.outputDirection)
    const entry = { original: answer, translated: displayed }
    state.outputRows.set(key, entry)
    state.outputRows.set(`text:${answer}`, entry)
    state.manualAnswers.delete(key)
    state.manualAnswers.delete(`text:${answer}`)
    $.ui.invalidate('ui.render')
  } catch {
    showFailure($, state, 'translationFailed')
  } finally {
    state.manualBusy.delete(key)
  }
}

export function register(on: Parameters<Register>[0]): void {
  const state: InterpreterState = {
    root: '', scope: 'project', isChinese: false, keyAvailable: false,
    settings: { project: normalizeSettings(), global: normalizeSettings() },
    pendingInputs: [], inputRows: new Map(), responseRows: [], outputRows: new Map(), manualAnswers: new Map(), manualBusy: new Set(),
  }

  on('session.start', async ($, e, next) => {
    await loadState($, state)
    await $.command.register({ name: 'chat-interpreter', description: 'Configure prompt and reply translation' })
    return next(e)
  })

  on('command.run', { command: 'chat-interpreter' }, async ($) => {
    state.keyAvailable = Boolean(await $.env.get('DEEPSEEK_API_KEY'))
    await $.ui.open({ id: PANE_ID, title: words(state).title, focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    return drawSettings($, state, e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!TRANSLATABLE_ORIGINS.has(e.origin.kind) && !(e.origin.kind === 'plugin' && e.origin.asUser)) return next(e)
    const settings = current(state)
    const original = e.text
    let sent = settings.punctuation ? convertPunctuation(original, settings.inputDirection) : original
    if (settings.translateInput && hasSourceLanguage(sent, settings.inputDirection)) {
      try {
        sent = await translate($, sent, settings.inputDirection)
      } catch {
        if (settings.sendOnlyOnSuccess) {
          showFailure($, state, 'inputBlocked')
          return { drop: words(state).inputBlocked }
        }
        sent = original
        showFailure($, state, 'inputFallback')
      }
    }
    const pending = sent !== original ? { original, sent } : undefined
    if (pending) state.pendingInputs.push(pending)
    const result = await next({ ...e, text: sent })
    if (pending && 'drop' in result) {
      const index = state.pendingInputs.indexOf(pending)
      if (index >= 0) state.pendingInputs.splice(index, 1)
    }
    return result
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    if (current(state).translateInput && current(state).sendOnlyOnSuccess) {
      return { drop: words(state).inputBlocked }
    }
    return next(e)
  })

  on('session.append', ($, e, next) => {
    if (e.agentId) return next(e)
    if (e.door === 'prompt' && e.message.type === 'user') {
      const matched = findPendingInput(state, incomingText(e.message))
      if (matched) state.inputRows.set(e.uuid, matched)
    }
    if (e.door === 'response' && e.message.type === 'assistant') {
      state.responseRows.push({ uuid: e.uuid, text: incomingText(e.message) })
      if (state.responseRows.length > 100) state.responseRows.shift()
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer' || !e.answer) return result
    const settings = current(state)
    let displayed = settings.punctuation ? convertPunctuation(e.answer, settings.outputDirection) : e.answer
    const row = findFinalRow(state, e.answer)
    if (settings.translateOutput && settings.outputMode === 'manual' && hasSourceLanguage(displayed, settings.outputDirection)) {
      if (row) state.manualAnswers.set(row.uuid, e.answer)
      else state.manualAnswers.set(`text:${e.answer}`, e.answer)
    } else if (settings.translateOutput && hasSourceLanguage(displayed, settings.outputDirection)) {
      try {
        displayed = await translate($, displayed, settings.outputDirection)
      } catch {
        showFailure($, state, 'translationFailed')
        return result
      }
    }
    if (displayed !== e.answer) {
      const entry = { original: e.answer, translated: displayed }
      if (row) state.outputRows.set(row.uuid, entry)
      state.outputRows.set(`text:${e.answer}`, entry)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const item = state.inputRows.get(e.requestId)
    if (!item) return next(e)
    const settings = current(state)
    const w = words(state)
    const text = settings.showOriginal ? `${w.originalLabel}: ${item.original}\n${w.sentLabel}: ${item.sent}` : item.sent
    return next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const key = state.manualAnswers.has(e.requestId) ? e.requestId : `text:${e.props.text}`
    const answer = state.manualAnswers.get(key)
    const item = state.outputRows.get(e.requestId) ?? state.outputRows.get(`text:${e.props.text}`)
    if (!item && !answer) return next(e)
    if (item && !e.props.isFirstOfReply) return next({ ...e, props: { ...e.props, text: '' } })
    const settings = current(state)
    const text = item && settings.showOriginal
      ? `${item.translated}\n\n${words(state).originalLabel}:\n${item.original}`
      : item?.translated ?? e.props.text
    const rendered = await next({ ...e, props: { ...e.props, text } })
    if (!answer || !e.props.isFirstOfReply || settings.outputMode !== 'manual' || !settings.translateOutput) return rendered
    const { Box, Button } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', children: [rendered, Button({ key: `translate:${e.requestId}`, plain: true,
      label: words(state).translateReply, onPress: () => translateManual($, state, key, answer),
    })] })
  })
}
