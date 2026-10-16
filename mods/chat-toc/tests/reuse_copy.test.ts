import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* CT-REUSE-001's automated half: Reuse and copy from the preview's label
   rows (spec §7). The worlds speak Chinese (host.ts). */

const CODE = 'CT-SYN fix this\n\n```ts\nconst a = 1\n```'

function two() {
  const t = transcript()
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt(CODE)
  t.reply([{ type: 'text', text: '## CT-SYN done\n\n- `one`' }])
  return t
}

type Pane = Awaited<ReturnType<typeof mountPane>>
const keys = async (pane: Pane) => drawnButtons(await pane.drawn()).map(b => b.key)
const label = async (pane: Pane, key: string) => {
  const button = await pane.find({ type: 'Button', key })
  return button === undefined ? undefined : `${String(button.props.hotkey)}: ${button.text}`
}

test('the User label row carries r: 填入 · c: 复制, the Agent row a: 复制', async ($, on) => {
  await start($, host(on, two().jsonl()))
  const pane = await mountPane($)

  expect(await label(pane, 'preview.reuse')).toBe('r: 填入')
  expect(await label(pane, 'preview.copy.user')).toBe('c: 复制')
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 复制')
  const drawn = await keys(pane)
  expect(drawn.indexOf('preview.reuse')).toBeLessThan(drawn.indexOf('preview.copy.user'))
  expect(drawn.indexOf('preview.copy.user')).toBeLessThan(drawn.indexOf('preview.copy.agent'))
})

test('r fills an empty composer with the User input as typed, replacing; never submits', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)

  await pane.press({ key: 'preview.reuse' })
  expect(world.fills).toEqual([{ text: CODE, mode: 'replace' }])
  expect(world.toasts).toEqual([])
})
