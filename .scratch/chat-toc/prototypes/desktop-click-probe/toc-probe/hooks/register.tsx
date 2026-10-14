/* Throwaway probe for chat-toc's desktop pane (2026-10-14): which elements
   carry a click to the plugin without a native button's chrome, and how
   wide the pane really is. Each variant counts its presses on screen. */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Press, SiteSeen } from '../types'

const PANE = 'toc-probe'
const presses = atom({ plugin: 'toc-probe', key: 'presses' } as const, [] as Press[])
const sites = atom({ plugin: 'toc-probe', key: 'sites' } as const, [] as SiteSeen[])

/* The transcript's sites the surface reports, newest per requestId. */
async function sawSite($: EngineInterface, seen: SiteSeen): Promise<void> {
  await update($, sites, list => [seen, ...list.filter(s => s.requestId !== seen.requestId)].slice(0, 8))
}

async function pressed($: EngineInterface, variant: string, target: string): Promise<void> {
  await update($, presses, list => [...list, { variant, target, at: Date.now() }].slice(-50))
}

/* Asks the host to scroll the transcript to a site; what it answered. */
async function scrollTo($: EngineInterface, requestId: string): Promise<void> {
  const got = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch((error: unknown) => ({ deny: `throw: ${String(error)}` }))
  await pressed($, 'L', `${requestId.slice(0, 8)} → ${got.deny === undefined ? 'ok' : `deny: ${got.deny}`}`)
}

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC',sans-serif"

/* 1000 px of markup, no width given: if the surface shrinks it to the slot,
   the labels shrink with it and the last one still sits at the right edge. */
function ruler(): string {
  const ticks: string[] = []
  for (let x = 0; x <= 1000; x += 50) {
    const tall = x % 100 === 0
    ticks.push(`<rect x="${x}" y="0" width="1" height="${tall ? 14 : 7}" class="t"/>`)
    if (tall) ticks.push(`<text x="${Math.min(x + 2, 975)}" y="26" class="t" font-size="11" font-family="${FONT}">${x}</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="30" viewBox="0 0 1000 30"><style>.t{fill:#444}@media (prefers-color-scheme: dark){.t{fill:#ccc}}</style>${ticks.join('')}</svg>`
}

/* A ruler drawn at the width chat-toc guesses: its right end should meet the
   pane's edge if the guess is right. */
function guessRuler(w: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" viewBox="0 0 ${w} 20"><style>.g{fill:#5769f7}.s{fill:#444}@media (prefers-color-scheme: dark){.g{fill:#b1b9f9}.s{fill:#ccc}}</style><rect x="0" y="0" width="${w}" height="4" class="g"/><text x="${w - 4}" y="17" text-anchor="end" font-size="11" class="s" font-family="${FONT}">guess ${w}px · scheme: <tspan class="s">light</tspan></text><style>@media (prefers-color-scheme: dark){tspan{display:none}}</style></svg>`
}

/* One entry as the design draws it: rail, node, bold prompt, a dim reply. */
function rowSvg(w: number, lit: boolean): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="46" viewBox="0 0 ${w} 46"><style>.rail{fill:#bbb}.lit{fill:#5769f7}.u{fill:#1a1a1a}.a{fill:#888}@media (prefers-color-scheme: dark){.rail{fill:#555}.lit{fill:#b1b9f9}.u{fill:#f2f2f2}.a{fill:#8a8a8a}}</style><rect x="6" y="0" width="2" height="46" class="${lit ? 'lit' : 'rail'}"/><circle cx="7" cy="10" r="5" class="${lit ? 'lit' : 'rail'}"/><text x="22" y="14" font-size="13" font-weight="600" class="u" font-family="${FONT}">跑一遍 verify-startup.sh</text><text x="22" y="34" font-size="12" class="a" font-family="${FONT}">├ 3 步 · 门禁通过：plugin test 87 项</text></svg>`
}

/* The segmented control's backdrop: a rounded well, the first of three
   52-wide slots lit. */
function segmentSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="30" viewBox="0 0 170 30"><style>.w{fill:#ecebe7}.p{fill:#ffffff}@media (prefers-color-scheme: dark){.w{fill:#2b2b29}.p{fill:#3d3d3a}}</style><rect x="0" y="0" width="162" height="30" rx="8" class="w"/><rect x="3" y="3" width="52" height="24" rx="6" class="p"/></svg>`
}

/* A node with the rail running on below it, sized to a two-line entry. */
function nodeSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="40" viewBox="0 0 14 40"><style>.r{fill:#bbb}@media (prefers-color-scheme: dark){.r{fill:#555}}</style><rect x="6" y="0" width="2" height="40" class="r"/><circle cx="7" cy="9" r="4.5" fill="none" stroke-width="1.6" class="r" style="stroke:currentColor"/><circle cx="7" cy="9" r="4.5" class="r"/></svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'toc-probe', description: 'Open the chat-toc desktop click probe' })
    void $.ui.open({ id: PANE, title: 'TOC probe' })
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const seen: SiteSeen = { component: 'UserMessage', surface: e.surface, requestId: e.requestId, onScreen: JSON.stringify(e.props.onScreen ?? null), at: Date.now() }
    $.clock.after(0, () => void sawSite($, seen))
    return next(e)
  })

  on('command.run', { command: 'toc-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'TOC probe' })
    return { text: 'TOC probe opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, presses)
    const seenSites = await read($, sites)
    const count = (v: string) => list.filter(p => p.variant === v).length
    const last = list[list.length - 1]
    const cols = e.props.bodyColumns
    const guess = Math.max(240, Math.min(900, cols * 8 - 8))
    const head = (title: string, v: string) => (
      <Text bold>
        {title} <Text color="suggestion">{`收到 ${count(v)} 次`}</Text>
      </Text>
    )
    const md =
      'Markdown' in ui ? (
        <ui.Markdown
          key="md"
          text={
            '[跑一遍 verify-startup.sh](https://toc-probe.invalid/a1)\n\n' +
            '**[把 0.1.2 的发布说明写一下](https://toc-probe.invalid/a2)**\n\n' +
            '├ 3 步 · [门禁通过：plugin test 87 项](https://toc-probe.invalid/a3)'
          }
          onLinkPress={link => void pressed($, 'A', link.href)}
        />
      ) : (
        <Text dimColor>no Markdown here</Text>
      )
    const svg = (source: string, alt: string, width?: number, height?: number) =>
      'Svg' in ui ? <ui.Svg source={source} alt={alt} width={width} height={height} /> : <Text dimColor>no Svg here</Text>
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{`surface ${e.surface} · bodyColumns ${cols} · viewport ${JSON.stringify(e.viewport ?? null)}`}</Text>
        <Text>{`最近一次：${last ? `${last.variant} ${last.target}` : '还没有'}`}</Text>
        <Text bold>{`K · 对话里的用户消息在屏幕上的位置（收到 ${seenSites.length} 条）`}</Text>
        {seenSites.map(s => (
          <Box key={`k-${s.requestId}`} flexDirection="row" gap={1}>
            <Button key={`l-${s.requestId}`} label="跳过去" onPress={() => scrollTo($, s.requestId)} />
            <Text dimColor wrap="truncate-end">{`${s.requestId.slice(0, 8)} ${new Date(s.at).toLocaleTimeString()}`}</Text>
          </Box>
        ))}
        {list
          .filter(p => p.variant === 'L')
          .slice(-4)
          .map((p, i) => (
            <Text key={`lr-${i}`} color="warning" wrap="wrap">{`L ${p.target}`}</Text>
          ))}
        <Text bold>尺子 1：标记宽 1000px，没给宽度</Text>
        {svg(ruler(), 'ruler, 1000 px of markup')}
        <Text bold>尺子 2：按 chat-toc 的猜法给宽度</Text>
        {svg(guessRuler(guess), `ruler at ${guess} px`, guess, 20)}
        {head('I · 分段控件：底图 + 叠在上面的 plain 按钮（各 52 宽）', 'I')}
        <Box position="relative" width={170} height={30}>
          {svg(segmentSvg(), 'segmented control', 170, 30)}
          <Box position="absolute" top={0} left={0} flexDirection="row" height={30} alignItems="center">
            {['全部', '用户', 'Agent'].map((label, i) => (
              <Box key={`iw${i}`} width={52} marginLeft={i === 0 ? 3 : 0} justifyContent="center" flexDirection="row">
                <Button key={`i${i}`} label={label} plain dimColor={i !== 0} onPress={() => pressed($, 'I', label)} />
              </Box>
            ))}
          </Box>
        </Box>
        {head('J · Box 宽度单位：下面三条宽 10 / 100 / 200', 'J')}
        <Box width={10} height={6} backgroundColor="suggestion" />
        <Box width={100} height={6} backgroundColor="suggestion" />
        <Box width={200} height={6} backgroundColor="suggestion" />
        <Box width={200} borderStyle="round" borderColor="suggestion">
          <Text>宽 200 的边框盒</Text>
        </Box>
        {head('A · Markdown 链接', 'A')}
        {md}
        {head('B · 按钮里放带样式的文字', 'B')}
        <Button key="b1" onPress={() => pressed($, 'B', 'b1')}>
          <Text bold>跑一遍 verify-startup.sh</Text> <Text dimColor>├ 3 步 · 门禁通过</Text>
        </Button>
        <Button key="b2" plain dimColor onPress={() => pressed($, 'B', 'b2 plain dim')}>
          把 0.1.2 的发布说明写一下
        </Button>
        {head('C · 图上盖一个透明按钮', 'C')}
        <Box position="relative">
          {svg(rowSvg(guess, false), 'entry drawn as svg')}
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <Button key="c1" label="·" plain onPress={() => pressed($, 'C', 'c1')} />
          </Box>
        </Box>
        {head('D · 时间做按钮，后面是图', 'D')}
        <Box flexDirection="row" gap={1} alignItems="flex-start">
          <Button key="d1" label="09:12" plain onPress={() => pressed($, 'D', 'd1')} />
          {svg(rowSvg(Math.max(160, guess - 70), true), 'entry drawn as svg, lit')}
        </Box>
        {head('E · plain 按钮里放粗体、换行、淡化', 'E')}
        <Button key="e1" plain onPress={() => pressed($, 'E', 'e1')}>
          <Text bold>跑一遍 verify-startup.sh</Text>
          {'\n'}
          <Text dimColor>├ 3 步 · 门禁通过</Text>
        </Button>
        <Button key="e2" plain onPress={() => pressed($, 'E', 'e2')}>
          <Text color="suggestion">当前位置：紫色的一条</Text>
        </Button>
        {head('F · plain 按钮里放很长的文字', 'F')}
        <Button key="f1" plain dimColor onPress={() => pressed($, 'F', 'f1')}>
          {'├ 11 步 · 已改起点判断，新增 rewind_regroup.test.ts，2.1.287 和 2.1.295 的 claude plugin test 都通过了，另外把 gate_scenarios.py 里两处等待时间从 5 秒放宽到 8 秒，这样负载高的时候也不会误报超时'}
        </Button>
        {head('G · 竖轨用带背景色的窄 Box', 'G')}
        <Box flexDirection="row" gap={1}>
          <Button key="g0" label="09:05" plain dimColor onPress={() => pressed($, 'G', 'g0 time')} />
          <Box width={1} backgroundColor="suggestion" />
          <Box flexDirection="column" flexShrink={1}>
            <Button key="g1" plain onPress={() => pressed($, 'G', 'g1 user')}>
              <Text bold>按你说的改，顺便补一个回归测试</Text>
            </Button>
            <Button key="g2" plain dimColor onPress={() => pressed($, 'G', 'g2 agent')}>
              {'├ 11 步 · 已改起点判断，新增 rewind_regroup.test.ts，2.1.287 和 2.1.295 都通过'}
            </Button>
          </Box>
        </Box>
        {head('H · 节点画成小图，文字是 plain 按钮', 'H')}
        <Box flexDirection="row" gap={1} alignItems="flex-start">
          <Button key="h0" label="09:06" plain dimColor onPress={() => pressed($, 'H', 'h0 time')} />
          {svg(nodeSvg(), 'node', 14, 40)}
          <Box flexDirection="column" flexShrink={1}>
            <Button key="h1" plain onPress={() => pressed($, 'H', 'h1 user')}>
              <Text bold>/tui fullscreen</Text>
            </Button>
            <Button key="h2" plain dimColor onPress={() => pressed($, 'H', 'h2 agent')}>
              {'├ 2 步 · 已切换到全屏布局'}
            </Button>
          </Box>
        </Box>
      </Box>
    )
  })
}
