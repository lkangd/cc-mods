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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const EN = {
  paneTitle: 'Contents',
  commandDescription: 'Open the conversation contents',
  empty: 'No conversation in this session yet',
  notWritten: 'This session has no transcript file yet; the contents appear after the first message',
  unlocated: 'The contents appear after the next message',
  paused: '⏸ Not following',
  refused: 'This entry is not in the conversation view now; cannot jump to it',
  compacted: 'This entry was compacted before the session resumed; cannot jump to it',
  unscrollable: 'The Claude app cannot jump to the conversation yet',
  denied: "No permission to read this session's transcript; nothing to show",
  readError: "Cannot read this session's transcript; nothing to show",
  unreadable: (lines: number) => `${count(lines, 'line', 'lines')} not recognized; the contents may be incomplete`,
  dock: {
    mainScreen: 'The contents dock on the right only in the fullscreen layout; run /tui fullscreen to switch',
    narrow: 'The terminal is too narrow to dock the contents; widen it and they appear',
    askedNarrow: 'The terminal is too narrow, so the contents sit above the prompt; widen it to dock them on the right',
    askedMainScreen: 'Outside the fullscreen layout the contents sit above the prompt; run /tui fullscreen to dock them on the right',
  },
  filters: { all: 'All', user: 'User', agent: 'Agent' },
  layouts: { card: 'Card', compact: 'Compact', timeline: 'Timeline' },
  layoutButton: (name: string) => `Layout: ${name}`,
  turns: (n: number) => count(n, 'turn', 'turns'),
  steps: (n: number) => count(n, 'step', 'steps'),
  running: 'Running',
  interrupted: 'Interrupted',
  error: 'Error',
  noReply: 'No text reply',
  imageOnly: '(image only)',
  monthDay: (month: number, day: number) => `${MONTHS[month] ?? ''} ${day}`,
  withYear: (monthDay: string, year: number) => `${monthDay}, ${year}`,
  today: (monthDay: string) => `Today · ${monthDay}`,
  filterAlt: (name: string) => `Filter: ${name}`,
  rail: 'Rail',
  stripAlt: (n: number, per: number) =>
    per === 1 ? `${count(n, 'turn', 'turns')}, one bar per turn, height by steps` : `${count(n, 'turn', 'turns')}, ${per} turns per bar, height by steps`,
}

export type Text = typeof EN

const ZH: Text = {
  paneTitle: '目录',
  commandDescription: '打开对话目录',
  empty: '本会话还没有对话',
  notWritten: '本会话还没写进 transcript 文件，提交第一条消息后显示目录',
  unlocated: '提交下一条消息后显示目录',
  paused: '⏸ 暂停跟随',
  refused: '这一条当前没有显示在对话里，无法跳转',
  compacted: '这一条在压缩之前，恢复会话后无法跳转',
  unscrollable: 'Claude 应用暂不支持跳转到对话',
  denied: '没有权限读本会话的 transcript，目录无法显示',
  readError: '读不到本会话的 transcript，目录无法显示',
  unreadable: lines => `有 ${lines} 行无法识别，目录可能不完整`,
  dock: {
    mainScreen: '目录只在全屏布局里停靠在右侧，运行 /tui fullscreen 切换',
    narrow: '终端太窄，目录没有停靠；把终端拉宽后会自动出现',
    askedNarrow: '终端太窄，目录暂时放在输入框上方；把终端拉宽后会停靠到右侧',
    askedMainScreen: '非全屏布局里目录放在输入框上方；运行 /tui fullscreen 切换后会停靠到右侧',
  },
  filters: { all: '全部', user: '用户', agent: 'Agent' },
  layouts: { card: '卡片', compact: '紧凑', timeline: '时间轴' },
  layoutButton: name => `布局 ${name}`,
  turns: n => `${n} 轮`,
  steps: n => `${n} 步`,
  running: '进行中',
  interrupted: '已中断',
  error: '出错',
  noReply: '无文字回复',
  imageOnly: '（只有图片）',
  monthDay: (month, day) => `${month + 1}月${day}日`,
  withYear: (monthDay, year) => `${year}年${monthDay}`,
  today: monthDay => `今天 · ${monthDay}`,
  filterAlt: name => `筛选：${name}`,
  rail: '轨道',
  stripAlt: (n, per) => (per === 1 ? `${n} 轮，每轮一根竖条，高度按步数` : `${n} 轮，每根竖条 ${per} 轮，高度按步数`),
}

/* The words in use. Swapped in place, so a module holding it reads the
   language set since. */
export const text: Text = { ...EN, dock: { ...EN.dock }, filters: { ...EN.filters }, layouts: { ...EN.layouts } }

export function setLanguage(language: Language): void {
  const from = language === 'zh' ? ZH : EN
  Object.assign(text, from, { dock: { ...from.dock }, filters: { ...from.filters }, layouts: { ...from.layouts } })
}
