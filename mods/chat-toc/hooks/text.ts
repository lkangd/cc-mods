/* Every word chat-toc draws or says, in the system's language: Chinese
   when the locale says Chinese, English otherwise. The host has no locale
   of its own to ask, so register.tsx reads the POSIX variables at
   `session.start` and sets the language once; the language holds for the
   process, and every pure module reads `text` as it draws. */

export type Language = 'en' | 'zh'

export type Locale = { LC_ALL?: string | undefined; LC_MESSAGES?: string | undefined; LANG?: string | undefined }

/* The POSIX order: LC_ALL over LC_MESSAGES over LANG, the first one set. */
export function languageOf(locale: Locale): Language {
  const tag = [locale.LC_ALL, locale.LC_MESSAGES, locale.LANG].find(v => v !== undefined && v !== '')
  return tag !== undefined && /^zh([_.@-]|$)/i.test(tag) ? 'zh' : 'en'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* What the band above the prompt counts: the listed turns, and the agent's
   steps (tool calls) across them; then the context use, when there is one. */
export type BandCounts = { turns: number; steps: number; percent?: number | undefined }

/* A run of the band's counts; the numbers are drawn stronger. */
export type BandPart = { text: string; isNumber: boolean }

const n = (value: number): BandPart => ({ text: String(value), isNumber: true })
const w = (text: string): BandPart => ({ text, isNumber: false })

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/* A number with its thousands grouped: `12,345`. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ',')

/* The context use, long (`context 62% used`) or short (`62% used`). */
const enContextUse = (percent: number, isShort: boolean) => (isShort ? `${percent}% used` : `context ${percent}% used`)
const zhContextUse = (percent: number, isShort: boolean) => (isShort ? `已用 ${percent}%` : `上下文已用 ${percent}%`)

const EN = {
  paneTitle: 'Contents',
  commandDescription: 'Open the conversation contents',
  empty: 'No conversation in this session yet',
  notWritten: 'This session has no transcript file yet; the contents appear after the first message',
  unlocated: 'The contents appear after the next message',
  refused: 'This entry is not in the conversation view now; cannot jump to it',
  compacted: 'This entry was compacted before the session resumed; cannot jump to it',
  denied: "No permission to read this session's transcript; nothing to show",
  readError: "Cannot read this session's transcript; nothing to show",
  unreadable: (lines: number) => `${count(lines, 'line', 'lines')} not recognized; the contents may be incomplete`,
  filters: { all: 'All', user: 'User', agent: 'Agent' },
  layouts: { card: 'Card', compact: 'Compact', timeline: 'Timeline' },
  layoutButton: (name: string) => `Layout: ${name}`,
  turns: (n: number) => count(n, 'turn', 'turns'),
  steps: (n: number) => count(n, 'step', 'steps'),
  bandCounts: (c: BandCounts): BandPart[] => [
    n(c.turns),
    w(c.turns === 1 ? ' user turn' : ' user turns'),
    w(' · '),
    n(c.steps),
    w(c.steps === 1 ? ' agent step' : ' agent steps'),
    ...(c.percent === undefined ? [] : [w(` · ${enContextUse(c.percent, false)}`)]),
  ],
  bandOpen: 'Open contents ❯',
  running: 'Running',
  interrupted: 'Interrupted',
  error: 'Error',
  noReply: 'No text reply',
  imageOnly: '(image only)',
  monthDay: (month: number, day: number) => `${MONTHS[month] ?? ''} ${day}`,
  withYear: (monthDay: string, year: number) => `${monthDay}, ${year}`,
  today: (monthDay: string) => `Today · ${monthDay}`,
  rail: 'Rail',
  compactionRule: (isAuto: boolean, count: number, time: string) =>
    [isAuto ? 'Auto-compacted' : 'Compacted', count > 1 ? `×${count}` : '', count > 1 && time ? `· ${time}` : time].filter(Boolean).join(' '),
  earlierElsewhere: "Earlier turns are not in this session's file",
  earlierTurns: (n: number) => `↑ ${n} earlier ${n === 1 ? 'turn' : 'turns'}`,
  laterTurns: (n: number) => `↓ ${n} later ${n === 1 ? 'turn' : 'turns'}`,
  backToTop: '↑ Back to top',
  contextUse: enContextUse,
  stripAlt: (n: number, per: number) =>
    per === 1 ? `${count(n, 'turn', 'turns')}, one bar per turn, height by steps` : `${count(n, 'turn', 'turns')}, ${per} turns per bar, height by steps`,
  preview: 'Preview',
  previewUser: 'User',
  previewAgent: 'Agent',
  moreLines: (n: number) => `↓ ${count(n, 'more line', 'more lines')} · `,
  expand: 'expand',
  back: '← Back',
  changedHeading: 'Changed',
  readHeading: 'Read',
  notShown: (n: number, key: string | undefined) => `… ${grouped(n)} more ${n === 1 ? 'character' : 'characters'} not shown · ${key === undefined ? '' : `${key}: `}Copy`,
  changed: (names: string) => `changed ${names}`,
  readFiles: (n: number) => `read ${n}`,
  tokensOut: (tokens: string) => `${tokens} out`,
  underASecond: '<1s',
  seconds: (s: number) => `${s}s`,
  minutes: (m: number, s: number) => (s === 0 ? `${m}m` : `${m}m ${s}s`),
  hours: (h: number, m: number) => (m === 0 ? `${h}h` : `${h}h ${m}m`),
  find: 'Find',
  searchPlaceholder: 'words or a file path',
  searchSubmit: 'jump',
  searchShow: 'show',
  matchCount: (matches: number, of: number) => `${matches} of ${of}`,
  noMatch: 'No turns match',
  matched: (fields: readonly ('user' | 'agent' | 'files')[]) =>
    `matched: ${fields.map(f => (f === 'user' ? 'User' : f === 'agent' ? 'Agent' : 'files')).join(' · ')}`,
  readNamed: (names: string) => `read ${names}`,
  reuse: 'Reuse',
  copy: 'Copy',
  copied: 'Copied',
  imagesLeft: 'Images not included',
  fillDialog: "Couldn't fill the prompt: a dialog is open",
  fillRefused: "Couldn't fill the prompt: another plugin refused",
  fillNoComposer: "Couldn't fill the prompt: there is no prompt box here",
  copyFailed: (reason: 'no-surface' | 'no-clipboard' | 'refused'): string =>
    reason === 'no-clipboard' ? 'Too long to copy here' : reason === 'refused' ? "Couldn't copy: another plugin refused" : "Couldn't copy: no clipboard here",
}

export type Text = typeof EN

const ZH: Text = {
  paneTitle: '目录',
  commandDescription: '打开对话目录',
  empty: '本会话还没有对话',
  notWritten: '本会话还没写进 transcript 文件，提交第一条消息后显示目录',
  unlocated: '提交下一条消息后显示目录',
  refused: '这一条当前没有显示在对话里，无法跳转',
  compacted: '这一条在压缩之前，恢复会话后无法跳转',
  denied: '没有权限读本会话的 transcript，目录无法显示',
  readError: '读不到本会话的 transcript，目录无法显示',
  unreadable: lines => `有 ${lines} 行无法识别，目录可能不完整`,
  filters: { all: '全部', user: '用户', agent: 'Agent' },
  layouts: { card: '卡片', compact: '紧凑', timeline: '时间轴' },
  layoutButton: name => `布局 ${name}`,
  turns: n => `${n} 轮`,
  steps: n => `${n} 步`,
  bandCounts: c => [
    w('用户 '),
    n(c.turns),
    w(' 轮 · Agent '),
    n(c.steps),
    w(' 步'),
    ...(c.percent === undefined ? [] : [w(` · ${zhContextUse(c.percent, false)}`)]),
  ],
  bandOpen: '展开目录 ❯',
  running: '进行中',
  interrupted: '已中断',
  error: '出错',
  noReply: '无文字回复',
  imageOnly: '（只有图片）',
  monthDay: (month, day) => `${month + 1}月${day}日`,
  withYear: (monthDay, year) => `${year}年${monthDay}`,
  today: monthDay => `今天 · ${monthDay}`,
  rail: '轨道',
  compactionRule: (isAuto, count, time) =>
    [isAuto ? '自动压缩' : '已压缩', count > 1 ? `×${count}` : '', count > 1 && time ? `· ${time}` : time].filter(Boolean).join(' '),
  earlierElsewhere: '更早的轮次不在本会话的文件里',
  earlierTurns: n => `↑ 更早的 ${n} 轮`,
  laterTurns: n => `↓ 更晚的 ${n} 轮`,
  backToTop: '↑ 回到顶部',
  contextUse: zhContextUse,
  stripAlt: (n, per) => (per === 1 ? `${n} 轮，每轮一根竖条，高度按步数` : `${n} 轮，每根竖条 ${per} 轮，高度按步数`),
  preview: '预览',
  previewUser: '用户',
  previewAgent: 'Agent',
  moreLines: n => `↓ 还有 ${n} 行 · `,
  expand: '展开',
  back: '← 返回',
  changedHeading: '改过',
  readHeading: '读过',
  notShown: (n, key) => `… 还有 ${grouped(n)} 字未显示 · ${key === undefined ? '' : `${key}: `}复制`,
  changed: names => `改 ${names}`,
  readFiles: n => `读 ${n}`,
  tokensOut: tokens => `输出 ${tokens}`,
  underASecond: '<1 秒',
  seconds: s => `${s} 秒`,
  minutes: (m, s) => (s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`),
  hours: (h, m) => (m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`),
  find: '搜索',
  searchPlaceholder: '词或文件路径',
  searchSubmit: '跳转',
  searchShow: '预览',
  matchCount: (matches, of) => `${matches} / ${of}`,
  noMatch: '没有匹配的轮次',
  matched: fields => `匹配：${fields.map(f => (f === 'user' ? '用户' : f === 'agent' ? 'Agent' : '文件')).join(' · ')}`,
  readNamed: names => `读 ${names}`,
  reuse: '填入',
  copy: '复制',
  copied: '已复制',
  imagesLeft: '图片未包含',
  fillDialog: '无法填入：有对话框打开',
  fillRefused: '无法填入：被其他插件拒绝',
  fillNoComposer: '无法填入：此处没有输入框',
  copyFailed: reason => (reason === 'no-clipboard' ? '太长，无法在此复制' : reason === 'refused' ? '无法复制：被其他插件拒绝' : '无法复制：此处没有剪贴板'),
}

/* The words in use. Swapped in place, so a module holding it reads the
   language set since. */
export const text: Text = { ...EN, filters: { ...EN.filters }, layouts: { ...EN.layouts } }

/* The turn count, then the context use while `fits` takes the line: long,
   else short, else left out. The footer and the desktop's strip each say
   what fits. */
export function turnsAndContextUse(n: number, percent: number | undefined, fits: (line: string) => boolean): string {
  const turns = text.turns(n)
  if (percent === undefined) return turns
  for (const isShort of [false, true]) {
    const line = `${turns} · ${text.contextUse(percent, isShort)}`
    if (fits(line)) return line
  }
  return turns
}

export function setLanguage(language: Language): void {
  const from = language === 'zh' ? ZH : EN
  Object.assign(text, from, { filters: { ...from.filters }, layouts: { ...from.layouts } })
}
