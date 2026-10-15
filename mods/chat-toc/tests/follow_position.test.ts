import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, entryTexts, host, isBarKey, mountPane, start } from './host'
import { transcript } from './fixture'

/* CT-POS-001..003, CT-COEX-001: the pane lights the group the transcript
   shows at the top of its view, keeps it in its window, pauses while the
   person scrolls it or has its keyboard, and follows again once the
   Current position moves. */

type Pane = Awaited<ReturnType<typeof mountPane>>
type Rows = { first: number; last: number; of: number } | null

/* Twenty groups, each a prompt and a reply. */
async function session($: Engine, on: Parameters<typeof host>[0], rows = 14) {
  const t = transcript()
  const prompts: string[] = []
  const replies: string[] = []
  for (let i = 0; i < 20; i++) {
    prompts.push(t.prompt(`CT-SYN prompt ${i}`))
    replies.push(t.reply([{ type: 'text', text: `CT-SYN answer ${i}` }]))
  }
  const world = host(on, t.jsonl())
  /* What Claude Code draws at a transcript site, beneath chat-toc's hooks. */
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  await start($, world)
  const pane = await mountPane($, rows)
  const drawn = new Map<string, { redraw: (props: unknown) => Promise<unknown> }>()
  /* A transcript site reporting where its row is in the view. */
  const report = async (component: 'UserMessage' | 'AssistantMessage', requestId: string, onScreen: Rows) => {
    const props =
      component === 'UserMessage'
        ? { text: 'CT-SYN', origin: { kind: 'composer' }, isExpanded: false, onScreen }
        : { text: 'CT-SYN', isStreaming: false, onScreen }
    const was = drawn.get(`${component}|${requestId}`)
    if (was) await was.redraw(props)
    else {
      const site = await $.ui.mount({
        plugin: 'chat-toc',
        surface: 'terminal',
        component,
        requestId,
        viewport: { columns: 160, rows: 40, isFullscreen: true },
        props,
      } as never)
      drawn.set(`${component}|${requestId}`, site as never)
    }
    await world.clock.settle()
  }
  /* The view showing group `g` at its top, its prompt cut at the top and
     its reply whole below; the rows before it drawn and gone. */
  const view = async (g: number) => {
    await report('UserMessage', prompts[g]!, { first: 0, last: 0, of: 2 })
    await report('AssistantMessage', replies[g]!, { first: 1, last: 3, of: 3 })
  }
  return { world, pane, prompts, replies, report, view }
}

/* The entries whose rail is drawn lit (`◉`, `┣╸`, `┃` in the theme's
   `suggestion`): the lit group's. */
async function litKeys(pane: Pane): Promise<string[]> {
  const out: string[] = []
  const isLitRail = (node: unknown): boolean => {
    if (typeof node !== 'object' || node === null) return false
    const el = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (el.type === 'Button') return false
    if (el.type === 'Text' && el.props?.color === 'suggestion' && /^[◉┣┃]/.test(String(el.children?.[0] ?? ''))) return true
    return (el.children ?? []).some(isLitRail)
  }
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    const key = el.props?.key
    if (el.type === 'Box' && typeof key === 'string' && key.startsWith('row-')) {
      if (isLitRail(el)) out.push(key.slice('row-'.length))
      return
    }
    for (const child of el.children ?? []) walk(child)
  }
  walk(await pane.drawn())
  return out
}

const prompts = async (pane: Pane) => (await entryTexts(pane)).filter(s => s.startsWith('CT-SYN prompt'))

async function scrollPane($: Engine, by: number) {
  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by, bodyRows: 14, contentRows: 14, origin: { kind: 'person' } } as never)
}

test('before the transcript reports where it is, nothing is lit and the window shows the newest', async ($, on) => {
  const { pane } = await session($, on)

  expect(await litKeys(pane)).toEqual([])
  expect(await prompts(pane)).toContain('CT-SYN prompt 19')
})

test('the group at the top of the transcript view is lit, both sides, and its entries come into the window', async ($, on) => {
  const { pane, view } = await session($, on)

  await view(4)

  expect(await litKeys(pane)).toEqual(['g4.u', 'g4.a'])
  expect(await prompts(pane)).toContain('CT-SYN prompt 4')
})

test('a row left over from an old view, never reported gone, does not hold the highlight', async ($, on) => {
  const { pane, view } = await session($, on)
  await view(4)

  /* The view scrolls far down; group 4's rows are unmounted without a word. */
  await view(15)

  expect(await litKeys(pane)).toEqual(['g15.u', 'g15.a'])
})

test('a row reported gone is dropped', async ($, on) => {
  const { pane, view, report, prompts: asked, replies } = await session($, on)
  await view(4)
  await view(15)

  await report('UserMessage', asked[15]!, null)
  await report('AssistantMessage', replies[15]!, null)

  /* Only group 4's rows say they are on screen now. */
  expect(await litKeys(pane)).toEqual(['g4.u', 'g4.a'])
})

test('with the last drawn row wholly in view the last group is lit', async ($, on) => {
  const { pane, report, prompts: asked, replies } = await session($, on)

  await report('UserMessage', asked[18]!, { first: 0, last: 1, of: 3 })
  await report('AssistantMessage', replies[18]!, { first: 0, last: 2, of: 3 })
  await report('UserMessage', asked[19]!, { first: 0, last: 2, of: 3 })
  await report('AssistantMessage', replies[19]!, { first: 0, last: 1, of: 3 })
  expect(await litKeys(pane)).toEqual(['g18.u', 'g18.a'])

  await report('AssistantMessage', replies[19]!, { first: 0, last: 2, of: 3 })
  expect(await litKeys(pane)).toEqual(['g19.u', 'g19.a'])
})

test('scrolling the pane pauses following; the next change of position follows again', async ($, on) => {
  const { pane, view } = await session($, on)
  await view(10)

  await scrollPane($, -30)
  expect(await prompts(pane)).not.toContain('CT-SYN prompt 10')

  await view(12)
  expect(await prompts(pane)).toContain('CT-SYN prompt 12')
  expect(await litKeys(pane)).toEqual(['g12.u', 'g12.a'])
})

test('the transcript redrawing the same view does not end the pause', async ($, on) => {
  const { pane, view } = await session($, on)
  await view(10)
  await scrollPane($, -30)

  await view(10)

  expect(await prompts(pane)).not.toContain('CT-SYN prompt 10')
})

test('the pane holding the keyboard pauses following', async ($, on) => {
  const { pane, view } = await session($, on)
  const props = { title: '目录', bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 14 }, view: {} }

  await pane.redraw({ ...props, isFocused: true })

  /* The highlight still moves; the window does not. */
  await view(3)
  expect(await prompts(pane)).not.toContain('CT-SYN prompt 3')

  /* Given the keyboard back, the position moved meanwhile: it follows. */
  await pane.redraw({ ...props, isFocused: false })
  expect(await prompts(pane)).toContain('CT-SYN prompt 3')
  expect(await litKeys(pane)).toEqual(['g3.u', 'g3.a'])
})

test('a change of position while the pane is a tab behind another ends the pause', async ($, on) => {
  const { pane, view, world } = await session($, on)
  await view(10)
  await scrollPane($, -30)
  const tab = (isShown: boolean) => {
    world.panes = world.panes.map(p => (p.id === PANE ? { ...p, isShown } : p))
  }

  /* A tab behind is not drawn at all. */
  await pane.unmount()
  tab(false)
  /* Away and back again while the pane is not drawn. */
  await view(14)
  await view(10)
  tab(true)
  const back = await mountPane($, 14)

  expect(await prompts(back)).toContain('CT-SYN prompt 10')
})

test('a Layout switch with no selection keeps the lit group in the window', async ($, on) => {
  const { pane, view } = await session($, on)
  await view(10)
  await scrollPane($, -30)
  expect(await prompts(pane)).not.toContain('CT-SYN prompt 10')

  await pane.press({ key: 'layout' })

  const texts = await entryTexts(pane)
  expect(texts.some(s => s.includes('CT-SYN prompt 10'))).toBe(true)
})

test('a switch with the focus ring on the filter row, where a hotkey finds it, keeps the lit group in the window', async ($, on) => {
  const { pane, view } = await session($, on)
  await view(10)
  const props = { title: '目录', bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 14 }, view: {} }
  await pane.redraw({ ...props, isFocused: true })
  await $.ui.focus({ component: 'Pane', requestId: PANE, element: 'f-user', origin: { kind: 'person' } } as never)
  await scrollPane($, -30)
  expect(await prompts(pane)).not.toContain('CT-SYN prompt 10')

  await pane.press({ key: 'layout' })

  const texts = await entryTexts(pane)
  expect(texts.some(s => s.includes('CT-SYN prompt 10'))).toBe(true)
})

test('a view holding only standalone tool rows, such as file edits, lights their group', async ($, on) => {
  /* Group 1 makes edits after its text; each draws as its own ToolUse row
     and ToolResult block, never folded into a ToolGroup. */
  const t = transcript()
  const asked: string[] = []
  const edits: string[] = []
  for (let i = 0; i < 3; i++) {
    asked.push(t.prompt(`CT-SYN prompt ${i}`))
    t.reply([{ type: 'text', text: `CT-SYN looking ${i}` }])
    if (i === 1) {
      for (let k = 0; k < 4; k++) {
        const id = `toolu_edit_${k}`
        edits.push(id)
        t.reply([{ type: 'tool_use', id, name: 'Edit', input: {} }])
        t.toolResult(id)
      }
    }
    t.reply([{ type: 'text', text: `CT-SYN answer ${i}` }])
  }
  const world = host(on, t.jsonl())
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  await start($, world)
  const pane = await mountPane($, 14)
  const site = async (component: string, requestId: string, props: Record<string, unknown>) => {
    await $.ui.mount({
      plugin: 'chat-toc',
      surface: 'terminal',
      component,
      requestId,
      viewport: { columns: 160, rows: 40, isFullscreen: true },
      props,
    } as never)
    await world.clock.settle()
  }
  const tool = (id: string, first: number, last: number) =>
    ({ tool_use_id: id, tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {}, onScreen: { first, last, of: 30 } })

  /* The view: the middle of the second edit's diff down to the third's. */
  await site('ToolUse', edits[1]!, tool(edits[1]!, 12, 29))
  await site('ToolResult', edits[1]!, { tool_use_id: edits[1]!, tool: 'Edit', output: {}, isErrored: false, onScreen: { first: 0, last: 0, of: 1 } })
  await site('ToolUse', edits[2]!, tool(edits[2]!, 0, 9))

  expect(await litKeys(pane)).toEqual(['g1.u', 'g1.a'])
})

test('the Minimap\'s cell of the lit group is the only one not dim, and moves with the view', async ($, on) => {
  /* One row more than the rest: the Minimap takes three of them. */
  const { pane, view } = await session($, on, 18)
  const bright = async () =>
    drawnButtons(await pane.drawn())
      .filter(b => isBarKey(b.key))
      .flatMap(b => (b.dimColor === false ? [b.key] : []))

  expect(await bright()).toEqual([])
  await view(4)
  expect(await bright()).toEqual(['m.4'])
  await view(11)
  expect(await bright()).toEqual(['m.11'])
})
