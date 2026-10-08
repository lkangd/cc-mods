import type {
  EngineInterface,
  Register,
  UiFocusInput,
  UiScrollInput,
} from 'claude-code'

// THROWAWAY PROTOTYPE. This file tests interaction contracts only.
const PLUGIN_NAME = 'prompt-history-scroll-probe'
const PARENT_PANE_ID = 'prompt-history-parent'
const CHUNK_SIZE = 12
const moduleInstanceId = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`

type PromptEntry = {
  kind: 'prompt'
  id: string
  sequence: number
  text: string
  run: number
  segment: number
  time: string
  synthetic: boolean
  requestId?: string
}

type Boundary = {
  kind: 'boundary'
  id: string
  sequence: number
  label: string
  boundary: 'run' | 'clear' | 'branch'
}

type TimelineEvent = PromptEntry | Boundary

type PendingParent = {
  draft: string
  candidates: Array<{ id: string; label: string }>
  selected: number
}

type LastRender = {
  requestId: string
  bodyColumns: number
  maxRows: number
  eventRows: number
  hasSurvey: boolean
}

type Notice = {
  tone: 'normal' | 'warning' | 'success'
  text: string
}

function makeSeedArchive(): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let sequence = 0
  const addBoundary = (boundary: Boundary['boundary'], label: string): void => {
    sequence += 1
    events.push({
      kind: 'boundary',
      id: `boundary-${sequence}`,
      sequence,
      boundary,
      label,
    })
  }
  const addPrompt = (
    run: number,
    segment: number,
    text: string,
  ): void => {
    sequence += 1
    const minute = String((sequence * 7) % 60).padStart(2, '0')
    events.push({
      kind: 'prompt',
      id: `seed-${sequence}`,
      sequence,
      text,
      run,
      segment,
      time: `${String(9 + Math.floor(sequence / 9)).padStart(2, '0')}:${minute}`,
      synthetic: true,
    })
  }

  addBoundary('run', 'Run 1 · 开始')
  const firstRun = [
    '梳理 prompt-history 的目标与边界',
    '保留重复 prompt，不按文本去重',
    '多行 prompt 第一行\n第二行\n第三行',
    '确认时间线按旧到新排列',
    '核实 AbovePrompt 的滚动原语',
    '把 requestId 视为临时 Jump Target',
    '项目移动后应视为新项目',
    '不同 worktree 使用不同时间线',
    '长历史必须保持连续体验',
    '不使用页码切割时间线',
    '记录完整原文但不写 prompt 日志',
    '旧 Run 条目仍需永久保留',
  ]
  firstRun.forEach(text => addPrompt(1, 1, text))
  addBoundary('clear', '/clear · Conversation segment 2')
  ;[
    'clear 后继续同一个 Run',
    'compact 不建立 clear boundary',
    'reload 不建立新 Run',
    '失效条目保留但不能跳转',
    '窄终端压缩次要元数据',
    '鼠标点击条目应直接跳转',
    '键盘 Enter 激活当前条目',
    'PageUp 与 PageDown 连续移动',
    'Home 与 End 到达两端',
  ].forEach(text => addPrompt(1, 2, text))
  addBoundary('run', 'Run 1 · 结束')
  addBoundary('run', 'Run 2 · 恢复项目')
  ;[
    '恢复后旧条目没有当前 requestId',
    '新 Run 内重新绑定 Jump Target',
    '查看旧历史时不要被新条目拉回',
    '位于底部时跟随新 prompt',
    '新条目提示显示未读数量',
    '回退时保留旧分支',
    '无法唯一匹配父节点时不得猜测',
  ].forEach(text => addPrompt(2, 1, text))
  addBoundary('branch', '↳ 回退后建立活动分支')
  ;[
    '提交前保存待恢复草稿',
    '父节点确认界面必须取得焦点',
    '选择后恢复草稿但不自动提交',
    '瞬时 survey 占用时完全让出',
    'survey 关闭后恢复原滚动位置',
  ].forEach(text => addPrompt(2, 1, text))
  addBoundary('clear', '/clear · Conversation segment 2')
  ;[
    '窄终端仍保持一行一个事件',
    '多行原文在列表中用 ↵ 压平',
    '文本按 bodyColumns 截断',
    '焦点离开时保留选择游标',
    '跳转成功后折叠时间线',
    '跳转失败时保持时间线展开',
    '准备开始真人交互验证',
  ].forEach(text => addPrompt(2, 2, text))
  return events
}

const archive = makeSeedArchive()
let nextSequence = Math.max(...archive.map(event => event.sequence)) + 1
let loadedStart = Math.max(0, archive.length - 20)
let viewStart = loadedStart
let selectedId = [...archive]
  .reverse()
  .find(event => event.kind === 'prompt')?.id
let expanded = false
let pinnedBottom = true
let unseen = 0
let mode: 'timeline' | 'parent' = 'timeline'
let pendingParent: PendingParent | undefined
let forceNextAmbiguity = false
let surveyActive = false
let surveyYielded = false
let lastRender: LastRender | undefined
let notice: Notice = {
  tone: 'normal',
  text: '默认折叠；点击标题或运行 /prompt-history 展开。',
}
let tracePath: string | undefined
let traceText = ''
let traceLoaded = false
let traceSequence = 0
let traceQueue = Promise.resolve()
let lastRenderSignature = ''
const pendingUserRows: Array<{ text: string; requestId: string }> = []

function flattened(text: string): string {
  return text.replace(/\r?\n/g, ' ↵ ').replace(/\s+/g, ' ').trim()
}

function cellWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  ) return 0
  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) return 2
  return 1
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((width, character) => width + cellWidth(character), 0)
}

function clipped(text: string, columns: number): string {
  const value = flattened(text)
  if (displayWidth(value) <= columns) return value
  const limit = Math.max(1, columns - 1)
  let width = 0
  let result = ''
  for (const character of Array.from(value)) {
    const nextWidth = width + cellWidth(character)
    if (nextWidth > limit) break
    result += character
    width = nextWidth
  }
  return `${result}…`
}

function promptEntries(): PromptEntry[] {
  return archive.filter((event): event is PromptEntry => event.kind === 'prompt')
}

function selectedEntry(): PromptEntry | undefined {
  return promptEntries().find(entry => entry.id === selectedId)
}

function activeEventRows(): number {
  return lastRender?.eventRows ?? 4
}

function maxViewStart(rows = activeEventRows()): number {
  return Math.max(loadedStart, archive.length - rows)
}

function setBottom(rows = activeEventRows()): void {
  viewStart = maxViewStart(rows)
  selectedId = [...archive]
    .reverse()
    .find(event => event.kind === 'prompt')?.id
  pinnedBottom = true
  unseen = 0
}

function promptsInWindow(rows = activeEventRows()): PromptEntry[] {
  return archive
    .slice(viewStart, viewStart + rows)
    .filter((event): event is PromptEntry => event.kind === 'prompt')
}

function selectWindowEdge(direction: -1 | 1): void {
  const visible = promptsInWindow()
  const candidate = direction < 0 ? visible[0] : visible[visible.length - 1]
  if (candidate) selectedId = candidate.id
}

function normalizeWindow(rows = activeEventRows()): void {
  if (pinnedBottom) viewStart = maxViewStart(rows)
  viewStart = Math.max(loadedStart, Math.min(viewStart, maxViewStart(rows)))
  const visibleIds = new Set(promptsInWindow(rows).map(entry => entry.id))
  if (!selectedId || !visibleIds.has(selectedId)) selectWindowEdge(1)
  pinnedBottom = viewStart >= maxViewStart(rows)
  if (pinnedBottom) unseen = 0
}

function shiftWindow(direction: -1 | 1, distance: number, edge?: 'home' | 'end'): void {
  const rows = activeEventRows()
  if (edge === 'home') {
    loadedStart = 0
    viewStart = 0
    pinnedBottom = false
    selectWindowEdge(-1)
    return
  }
  if (edge === 'end') {
    setBottom(rows)
    return
  }

  if (direction < 0 && viewStart <= loadedStart && loadedStart > 0) {
    loadedStart = Math.max(0, loadedStart - CHUNK_SIZE)
  }
  viewStart += direction * Math.max(1, distance)
  viewStart = Math.max(loadedStart, Math.min(viewStart, maxViewStart(rows)))
  pinnedBottom = viewStart >= maxViewStart(rows)
  if (pinnedBottom) unseen = 0
  selectWindowEdge(direction)
}

function appendPrompt(text: string, synthetic: boolean): PromptEntry {
  const entry: PromptEntry = {
    kind: 'prompt',
    id: `live-${nextSequence}-${Math.random().toString(36).slice(2, 7)}`,
    sequence: nextSequence,
    text,
    run: 3,
    segment: 1,
    time: new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    synthetic,
  }
  nextSequence += 1
  archive.push(entry)

  const pendingIndex = pendingUserRows.findIndex(row => row.text === text)
  if (!synthetic && pendingIndex >= 0) {
    const row = pendingUserRows.splice(pendingIndex, 1)[0]
    if (row) entry.requestId = row.requestId
  }

  if (pinnedBottom) {
    setBottom()
    notice = { tone: 'success', text: '位于底部：新条目已自动进入视窗。' }
  } else {
    unseen += 1
    notice = {
      tone: 'warning',
      text: `正在查看旧历史：保持位置，已有 ${unseen} 条新条目。`,
    }
  }
  return entry
}

function bindJumpTarget(text: string, requestId: string): boolean {
  if (requestId === 'placeholder') return false
  const alreadyBound = promptEntries().find(entry => entry.requestId === requestId)
  if (alreadyBound) return false
  const entry = promptEntries().find(
    candidate => !candidate.synthetic && !candidate.requestId && candidate.text === text,
  )
  if (entry) {
    entry.requestId = requestId
    return true
  }
  if (!pendingUserRows.some(row => row.requestId === requestId)) {
    pendingUserRows.push({ text, requestId })
  }
  return false
}

async function ensureTrace($: EngineInterface): Promise<void> {
  if (traceLoaded) return
  const cwd = await $.session.cwd()
  tracePath = `${cwd}/.scratch/prompt-history/prototypes/scrollable-timeline/traces/${moduleInstanceId}.jsonl`
  try {
    traceText = await $.fs.read(tracePath)
  } catch {
    traceText = ''
  }
  traceSequence = traceText.split('\n').filter(Boolean).length
  traceLoaded = true
}

function record(
  $: EngineInterface,
  event: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  traceQueue = traceQueue.then(async () => {
    await ensureTrace($)
    traceText += `${JSON.stringify({
      sequence: ++traceSequence,
      at: new Date().toISOString(),
      moduleInstanceId,
      event,
      ...data,
    })}\n`
    if (tracePath) await $.fs.write(tracePath, traceText)
  })
  return traceQueue
}

function selectedKey(): string | undefined {
  return selectedId ? `trail:row:${selectedId}` : undefined
}

function scheduleFocus($: EngineInterface, reason: string): void {
  const requestId = lastRender?.requestId
  const key = mode === 'parent'
    ? `trail:parent:${pendingParent?.selected ?? 0}`
    : selectedKey()
  if (!requestId || !key) return

  $.clock.after(0, () => {
    void $.ui.focus({ requestId, key }).then(result => {
      void record($, 'focus.request', { reason, key, deny: result.deny })
      if (result.deny) {
        notice = {
          tone: 'warning',
          text: `已展开，但宿主拒绝自动聚焦：${result.deny}`,
        }
        $.ui.invalidate('ui.render')
      }
    })
  })
}

function openTimeline($: EngineInterface, reason: string): void {
  expanded = true
  mode = pendingParent ? 'parent' : 'timeline'
  normalizeWindow()
  notice = {
    tone: 'normal',
    text: '已展开；宿主不允许插件抢焦点，请按 ctrl+x tab 或点击后操作。',
  }
  $.ui.invalidate('ui.render')
  void record($, 'timeline.open', { reason })
  const requestId = lastRender?.requestId
  if (pinnedBottom && requestId) {
    $.clock.after(0, () => {
      void $.ui.scroll({ in: requestId, to: 'end' }).then(result => {
        void record($, 'scroll.to-end', { reason, deny: result.deny })
      })
    })
  }
}

function collapseTimeline($: EngineInterface): void {
  if (pendingParent) {
    notice = { tone: 'warning', text: '必须先选择回退父节点，不能折叠确认界面。' }
    $.ui.invalidate('ui.render')
    return
  }
  expanded = false
  notice = { tone: 'normal', text: '时间线已折叠。' }
  $.ui.invalidate('ui.render')
}

async function jumpTo($: EngineInterface, id: string): Promise<void> {
  const entry = promptEntries().find(candidate => candidate.id === id)
  if (!entry) return
  selectedId = id
  if (!entry.requestId) {
    notice = {
      tone: 'warning',
      text: `#${entry.sequence} 没有当前 Run 的有效 Jump Target；条目仍保留。`,
    }
    $.ui.invalidate('ui.render')
    await record($, 'jump.refused', { sequence: entry.sequence, reason: 'stale' })
    return
  }

  const result = await $.ui.scroll({ to: { requestId: entry.requestId } })
  await record($, 'jump.request', {
    sequence: entry.sequence,
    requestId: entry.requestId,
    deny: result.deny,
  })
  if (result.deny) {
    notice = { tone: 'warning', text: `跳转被宿主拒绝：${result.deny}` }
    $.ui.invalidate('ui.render')
    return
  }

  expanded = false
  notice = {
    tone: 'success',
    text: `已跳转至 #${entry.sequence}；时间线折叠。请观察焦点是否自动回到输入框。`,
  }
  $.ui.invalidate('ui.render')
}

function armAmbiguity($: EngineInterface): void {
  forceNextAmbiguity = true
  notice = {
    tone: 'warning',
    text: '歧义探针已就绪：下一条 composer 提交会被 drop 并转入父节点确认。',
  }
  $.ui.invalidate('ui.render')
}

async function beginParentChoice($: EngineInterface, draft: string): Promise<void> {
  const candidates = [...promptEntries()]
    .reverse()
    .slice(0, 2)
    .map(entry => ({
      id: entry.id,
      label: `#${entry.sequence} · ${clipped(entry.text, 34)}`,
    }))
  candidates.push({ id: 'root', label: '新根分支 · 不关联已有 prompt' })
  pendingParent = { draft, candidates, selected: 0 }
  mode = 'parent'
  expanded = false
  notice = {
    tone: 'warning',
    text: '本次提交已阻止；请在父节点面板中确认。',
  }
  $.ui.invalidate('ui.render')
  await $.ui.open({
    id: PARENT_PANE_ID,
    title: '选择 prompt-history 父节点',
    focus: true,
    rows: 6,
  })
}

function chooseParent($: EngineInterface, index: number): void {
  const pending = pendingParent
  const candidate = pending?.candidates[index]
  if (!pending || !candidate) return
  const draft = pending.draft
  pendingParent = undefined
  mode = 'timeline'
  expanded = false
  notice = {
    tone: 'normal',
    text: `已选择「${candidate.label}」；正在恢复草稿，不会自动提交。`,
  }
  $.ui.invalidate('ui.render')

  $.clock.after(0, () => {
    void (async () => {
      await $.ui.close({ id: PARENT_PANE_ID })
      const result = await $.prompt.fill({ text: draft })
      notice = result.isFilled
        ? { tone: 'success', text: '草稿已恢复到输入框；请检查后人工重新提交。' }
        : { tone: 'warning', text: '宿主暂未接受 prompt.fill；草稿仍在原型内存中。' }
      $.ui.invalidate('ui.render')
      await record($, 'parent.chosen', {
        parent: candidate.id,
        draftLength: draft.length,
        isFilled: result.isFilled,
      })
    })()
  })
}

function edgeFocus(
  $: EngineInterface,
  direction: -1 | 1,
  distance: number,
  reason: string,
): void {
  shiftWindow(direction, distance)
  notice = {
    tone: 'normal',
    text: direction < 0 ? '已连续载入更早范围。' : '已向较新的范围移动。',
  }
  $.ui.invalidate('ui.render')
  scheduleFocus($, reason)
  void record($, 'window.shift', {
    reason,
    direction,
    distance,
    loadedStart,
    viewStart,
    pinnedBottom,
  })
}

function toneColor(tone: Notice['tone']): string | undefined {
  if (tone === 'warning') return 'yellow'
  if (tone === 'success') return 'cyan'
  return undefined
}

function timelineSummary(): string {
  const total = promptEntries().length
  const jumpable = promptEntries().filter(entry => entry.requestId).length
  const unread = unseen > 0 ? ` · ${unseen} 新` : ''
  return `${total} prompts · ${jumpable} 可跳转${unread}`
}

function reportText(): string {
  return [
    'prompt-history scroll probe',
    `expanded=${expanded}`,
    `mode=${mode}`,
    `archive=${archive.length}`,
    `loadedStart=${loadedStart}`,
    `viewStart=${viewStart}`,
    `selected=${selectedEntry()?.sequence ?? 'none'}`,
    `pinnedBottom=${pinnedBottom}`,
    `unseen=${unseen}`,
    `surveyYielded=${surveyYielded}`,
    `lastRender=${lastRender ? `${lastRender.bodyColumns}x${lastRender.maxRows}` : 'none'}`,
    `trace=${tracePath ?? 'not initialized'}`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.command.register({
        name: 'prompt-history',
        description: '展开或折叠 prompt-history 交互原型',
      }),
      $.command.register({
        name: 'prompt-history-probe-add',
        description: '向原型追加 1–5 条合成 prompt',
        argumentHint: '[count]',
      }),
      $.command.register({
        name: 'prompt-history-probe-ambiguity',
        description: '让下一条 composer 提交进入回退父节点确认',
      }),
      $.command.register({
        name: 'prompt-history-probe-reset',
        description: '重置原型视窗与交互状态',
      }),
      $.command.register({
        name: 'prompt-history-probe-report',
        description: '显示原型状态与 trace 路径',
      }),
    ])
    await record($, 'session.start', {
      cwd: e.cwd,
      surface: e.surface,
      targetVersion: '2.1.273',
    })
    return next(e)
  })

  on('command.run', { command: 'prompt-history' }, async ($) => {
    if (expanded) collapseTimeline($)
    else openTimeline($, 'command')
    await record($, 'command.prompt-history', { expanded, mode })
    return { text: expanded ? 'prompt-history 已展开。' : 'prompt-history 已折叠。' }
  })

  on('command.run', { command: 'prompt-history-probe-add' }, async ($, e) => {
    const requested = Number.parseInt(e.args.trim(), 10)
    const count = Number.isFinite(requested)
      ? Math.max(1, Math.min(5, requested))
      : 1
    for (let index = 0; index < count; index += 1) {
      appendPrompt(`合成新增 prompt ${nextSequence}：验证底部跟随与新条目提示`, true)
    }
    $.ui.invalidate('ui.render')
    await record($, 'command.add', { count, pinnedBottom, unseen, viewStart })
    return { text: `已追加 ${count} 条合成 prompt。` }
  })

  on('command.run', { command: 'prompt-history-probe-ambiguity' }, async ($) => {
    armAmbiguity($)
    await record($, 'command.arm-ambiguity')
    return { text: '歧义探针已就绪；下一条普通输入将被阻止并保留为草稿。' }
  })

  on('command.run', { command: 'prompt-history-probe-reset' }, async ($) => {
    expanded = false
    mode = 'timeline'
    pendingParent = undefined
    forceNextAmbiguity = false
    loadedStart = Math.max(0, archive.length - 20)
    unseen = 0
    pinnedBottom = true
    setBottom()
    notice = { tone: 'normal', text: '原型交互状态已重置。' }
    $.ui.invalidate('ui.render')
    await record($, 'command.reset')
    return { text: 'prompt-history 原型状态已重置。' }
  })

  on('command.run', { command: 'prompt-history-probe-report' }, async ($) => {
    await ensureTrace($)
    await record($, 'command.report', {
      expanded,
      mode,
      viewStart,
      loadedStart,
      pinnedBottom,
      unseen,
      surveyYielded,
    })
    return { text: reportText() }
  })

  on('tool.call', { tool: /^AskUserQuestion$/ }, async ($, e, next) => {
    surveyActive = true
    $.ui.invalidate('ui.render')
    await record($, 'survey.tool-start', { toolUseId: e.tool_use_id })
    try {
      return await next(e)
    } finally {
      surveyActive = false
      notice = {
        tone: 'success',
        text: 'AskUserQuestion 已结束；prompt-history 恢复此前状态。',
      }
      $.ui.invalidate('ui.render')
      await record($, 'survey.tool-end', { toolUseId: e.tool_use_id })
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' && pendingParent) {
      pendingParent.draft = e.text
      expanded = false
      mode = 'parent'
      notice = {
        tone: 'warning',
        text: '父节点仍未确认；本次提交继续被阻止，最新草稿已暂存。',
      }
      $.ui.invalidate('ui.render')
      await $.ui.open({
        id: PARENT_PANE_ID,
        title: '选择 prompt-history 父节点',
        focus: true,
        rows: 6,
      })
      await record($, 'prompt.blocked-pending-parent', { textLength: e.text.length })
      return { drop: 'prompt-history prototype: choose a parent before submitting.' }
    }

    if (e.origin.kind === 'composer' && forceNextAmbiguity) {
      forceNextAmbiguity = false
      await beginParentChoice($, e.text)
      await record($, 'prompt.blocked-ambiguity', { textLength: e.text.length })
      return { drop: 'prompt-history prototype: ambiguous rewind parent.' }
    }

    const result = await next(e)
    if (e.origin.kind === 'composer' && !result.drop) {
      const capturedText = result.text ?? e.text
      const entry = appendPrompt(capturedText, false)
      $.ui.invalidate('ui.render')
      await record($, 'prompt.captured', {
        sequence: entry.sequence,
        textLength: capturedText.length,
        pinnedBottom,
        unseen,
      })
    }
    return result
  })

  on(
    'ui.render',
    { component: 'UserMessage', props: { origin: { kind: 'composer' } } },
    ($, e, next) => {
      if (bindJumpTarget(e.props.text, e.requestId)) {
        $.ui.invalidate('ui.render')
      }
      return next(e)
    },
  )

  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== PARENT_PANE_ID || !pendingParent) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="yellow" bold wrap="truncate-end">
          提交已阻止 · 选择回退父节点
        </Text>
        {pendingParent.candidates.map((candidate, index) => (
          <Button
            key={`trail:parent:${index}`}
            plain
            autoFocus={index === pendingParent?.selected ? true : undefined}
            label={`${index === pendingParent?.selected ? '›' : ' '} ${clipped(candidate.label, e.props.bodyColumns - 4)}`}
            onPress={() => chooseParent($, index)}
          />
        ))}
        <Text dimColor wrap="truncate-end">
          ↑↓ 选择 · Enter 确认 · Esc 返回输入框但不会解除阻止
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    if (surveyActive || e.props.hasSurvey) {
      if (!surveyYielded) {
        surveyYielded = true
        void record($, 'survey.yield', {
          viewStart,
          selected: selectedEntry()?.sequence,
          expanded,
        })
      }
      return next(e)
    }

    if (surveyYielded) {
      surveyYielded = false
      notice = {
        tone: 'success',
        text: 'survey 已关闭；prompt-history 恢复到原滚动与选择位置。',
      }
      void record($, 'survey.restore', {
        viewStart,
        selected: selectedEntry()?.sequence,
        expanded,
      })
    }

    const compact = e.props.maxRows < 6 || e.props.bodyColumns < 28
    const edgeRows = compact ? 0 : 2
    const fixedRows = compact ? 1 : 2
    const eventRows = Math.max(1, e.props.maxRows - edgeRows - fixedRows)
    lastRender = {
      requestId: e.requestId,
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
      eventRows,
      hasSurvey: e.props.hasSurvey,
    }
    normalizeWindow(eventRows)

    const signature = [
      e.props.bodyColumns,
      e.props.maxRows,
      e.props.scroll.offset,
      e.props.scroll.bodyRows,
      expanded,
      mode,
      viewStart,
      loadedStart,
      unseen,
      selectedId,
    ].join(':')
    if (signature !== lastRenderSignature) {
      lastRenderSignature = signature
      void record($, 'above-prompt.render', {
        bodyColumns: e.props.bodyColumns,
        maxRows: e.props.maxRows,
        engineOffset: e.props.scroll.offset,
        engineBodyRows: e.props.scroll.bodyRows,
        expanded,
        mode,
        eventRows,
        viewStart,
        loadedStart,
      })
    }

    if (!expanded && !pendingParent) {
      return (
        <Button
          key="trail:toggle"
          plain
          label={clipped(`▸ prompt-history · ${timelineSummary()}`, e.props.bodyColumns - 1)}
          onPress={() => openTimeline($, 'title-click')}
        />
      )
    }

    if (compact) {
      return (
        <Box flexDirection="column">
          <Button
            key="trail:toggle"
            plain
            label={clipped(`▾ prompt-history · ${timelineSummary()}`, e.props.bodyColumns - 1)}
            onPress={() => collapseTimeline($)}
          />
          <Text color="yellow" wrap="truncate-end">
            {clipped(`终端空间不足（${e.props.bodyColumns} 列 / ${e.props.maxRows} 行）；保留折叠控制，扩大后恢复原位置。`, e.props.bodyColumns - 1)}
          </Text>
        </Box>
      )
    }

    if (mode === 'parent' && pendingParent) {
      return (
        <Text color="yellow" bold wrap="truncate-end">
          父节点确认面板已打开；确认前所有 composer 提交都会被阻止。
        </Text>
      )
    }

    const renderStart = Math.max(0, loadedStart - 1)
    const loadedEvents = archive.slice(renderStart)
    const contentRows = loadedEvents.length + 4
    const lastOffset = Math.max(0, contentRows - e.props.scroll.bodyRows)
    pinnedBottom = e.props.scroll.offset >= lastOffset
    if (pinnedBottom) unseen = 0

    return (
      <Box flexDirection="column">
        <Button
          key="trail:toggle"
          plain
          label={clipped(`▾ prompt-history · ${timelineSummary()}`, e.props.bodyColumns - 1)}
          onPress={() => collapseTimeline($)}
        />
        <Text color={toneColor(notice.tone)} dimColor={notice.tone === 'normal'} wrap="truncate-end">
          {clipped(notice.text, e.props.bodyColumns - 1)}
        </Text>
        <Text dimColor wrap="truncate-end">
          {loadedStart > 0
            ? `↑ 聚焦最早可见条目会预载上一批 · ${archive.length - renderStart}/${archive.length}`
            : '— 项目时间线起点 —'}
        </Text>
        {loadedEvents.map(event => {
          if (event.kind === 'boundary') {
            return (
              <Text
                key={`trail:boundary:${event.id}`}
                color={event.boundary === 'clear' ? 'yellow' : 'cyan'}
                wrap="truncate-end"
              >
                {clipped(`── ${event.label} ──`, e.props.bodyColumns - 1)}
              </Text>
            )
          }
          const current = event.id === selectedId
          const target = event.requestId ? '↵' : '×'
          const prefix = e.props.bodyColumns < 52
            ? `#${event.sequence}`
            : `#${event.sequence} ${event.time}`
          const lead = `${current ? '›' : ' '} ${prefix} `
          const tail = ` ${target}`
          const textColumns = Math.max(
            1,
            e.props.bodyColumns - displayWidth(lead) - displayWidth(tail) - 1,
          )
          return (
            <Button
              key={`trail:row:${event.id}`}
              plain
              dimColor={!event.requestId}
              autoFocus={current ? true : undefined}
              label={`${lead}${clipped(event.text, textColumns)}${tail}`}
              onPress={() => void jumpTo($, event.id)}
            />
          )
        })}
        <Text dimColor wrap="truncate-end">
          {unseen > 0
            ? `↓ ${unseen} 条新条目 · End 或滚到底后清零`
            : '— 当前已载入范围底部 —'}
        </Text>
      </Box>
    )
  })

  on('ui.focus', async ($, e, next) => {
    if (e.component === 'Pane' && e.requestId === PARENT_PANE_ID) {
      await record($, 'ui.focus.parent-pane', {
        element: e.element,
        origin: e.origin,
      })
      if (e.element?.startsWith('trail:parent:') && pendingParent) {
        const index = Number.parseInt(e.element.slice('trail:parent:'.length), 10)
        if (Number.isFinite(index)) pendingParent.selected = index
      }
      return next(e)
    }

    if (e.component !== 'AbovePrompt' || e.requestId !== lastRender?.requestId) {
      return next(e)
    }

    await record($, 'ui.focus', {
      element: e.element,
      origin: e.origin,
      viewStart,
      selected: selectedEntry()?.sequence,
    })

    if (!e.element && e.origin.kind === 'person' && expanded && mode === 'timeline') {
      expanded = false
      notice = { tone: 'normal', text: '焦点已回到 composer；时间线同步折叠。' }
      $.ui.invalidate('ui.render')
      await record($, 'timeline.collapse-on-focus-leave')
      return next(e)
    }

    if (e.element === 'trail:edge:older') {
      edgeFocus($, -1, 1, 'focus-edge-older')
      return {}
    }
    if (e.element === 'trail:edge:newer') {
      edgeFocus($, 1, 1, 'focus-edge-newer')
      return {}
    }
    if (e.element?.startsWith('trail:row:')) {
      selectedId = e.element.slice('trail:row:'.length)
      const focusedIndex = archive.findIndex(event => event.id === selectedId)
      if (focusedIndex <= loadedStart && loadedStart > 0) {
        loadedStart = Math.max(0, loadedStart - CHUNK_SIZE)
        $.ui.invalidate('ui.render')
        await record($, 'focus.prefetch-older', {
          focusedIndex,
          loadedStart,
          selected: selectedEntry()?.sequence,
        })
      }
    }
    if (e.element?.startsWith('trail:parent:') && pendingParent) {
      const index = Number.parseInt(e.element.slice('trail:parent:'.length), 10)
      if (Number.isFinite(index)) pendingParent.selected = index
    }
    return next(e)
  })

  on('ui.scroll', async ($, e, next) => {
    if (
      e.component !== 'AbovePrompt' ||
      e.requestId !== lastRender?.requestId ||
      !expanded ||
      mode !== 'timeline'
    ) {
      return next(e)
    }

    const oldLoadedStart = loadedStart
    const isHome = e.by < 0 && Math.abs(e.by) >= e.contentRows
    const isEnd = e.by > 0 && Math.abs(e.by) >= e.contentRows
    if (isHome) {
      loadedStart = 0
    } else if (e.by < 0 && e.offset <= 1 && loadedStart > 0) {
      loadedStart = Math.max(0, loadedStart - CHUNK_SIZE)
    }
    const addedRows = oldLoadedStart - loadedStart
    const requestedOffset = addedRows > 0 && !isHome
      ? e.offset + addedRows
      : e.offset

    if (addedRows > 0) $.ui.invalidate('ui.render')
    const result = await next(
      requestedOffset === e.offset ? e : { ...e, offset: requestedOffset },
    )

    const oldLastOffset = Math.max(0, e.contentRows - e.bodyRows)
    pinnedBottom = isEnd || (e.by >= 0 && e.offset >= oldLastOffset)
    if (e.by < 0) pinnedBottom = false
    if (pinnedBottom) unseen = 0

    await record($, 'ui.scroll', {
      by: e.by,
      requestedOffset: e.offset,
      rewrittenOffset: requestedOffset,
      bodyRows: e.bodyRows,
      contentRows: e.contentRows,
      origin: e.origin,
      pointer: e.pointer,
      loadedStart,
      addedRows,
      isHome,
      isEnd,
      pinnedBottom,
      deny: result.deny,
    })
    return result
  })
}
