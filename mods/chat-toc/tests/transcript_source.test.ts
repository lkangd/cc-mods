import { expect, test } from 'claude-code/testing'
import { TRANSCRIPT, appendRow, entryTexts, host, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'

/* Where the TOC's rows come from: the first read of a small file whole,
   anything larger or newer in chunks from a byte offset; and what the pane
   says when the file cannot be read, or only in part. */

const DD = '{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$3"; } < "$2"'
const WINDOWS_TRANSCRIPT = 'C:\\Users\\synthetic\\.claude\\projects\\p\\synthetic-session.jsonl'

/* A prompt and a reply of about a megabyte each: five pass 4 MiB. */
function bigSession(prompts: string[]) {
  const t = transcript()
  for (const p of prompts) {
    t.prompt(p)
    t.reply([{ type: 'text', text: '长'.repeat(350_000) }])
  }
  return t
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

type Pane = Awaited<ReturnType<typeof mountPane>>

async function buttonTexts(pane: Pane) {
  return entryTexts(pane)
}

/* The texts of the drawn tree's Text elements, in drawing order. */
async function texts(pane: Pane): Promise<string[]> {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { type?: string; children?: unknown[] }
    if (el.type === 'Text') {
      const own = (el.children ?? []).filter((c): c is string => typeof c === 'string').join('')
      out.push(own)
    }
    for (const child of el.children ?? []) walk(child)
  }
  walk(await pane.drawn())
  return out.filter(t => t.trim() !== '')
}

function offsetsOf(world: Host): number[] {
  return world.runs.map(r => Number(r.argv[4]))
}

test('a transcript over 4 MiB is read in 4,000,000-byte chunks from byte offsets, and every prompt is listed', async ($, on) => {
  const prompts = ['CT-SYN big one', 'CT-SYN big two', 'CT-SYN big three', 'CT-SYN big four', 'CT-SYN big five']
  const t = bigSession(prompts)
  const world = host(on, t.jsonl())
  expect(bytesOf(t.jsonl()).length).toBeGreaterThan(4 * 1024 * 1024)
  await start($, world)
  const pane = await mountPane($)

  expect(world.reads).toEqual([])
  expect(world.runs[0]?.argv).toEqual(['sh', '-c', DD, 'sh', '0', TRANSCRIPT, '4000000'])
  const bytes = bytesOf(t.jsonl())
  /* Each later chunk starts just after a newline, where the last one's
     whole lines ended. */
  for (const offset of offsetsOf(world).slice(1)) expect(bytes[offset - 1]).toBe(0x0a)
  expect(world.runs.length).toBe(2)
  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(prompts))
})

test('rows appended after the first read are read from where it stopped, never from the start', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN first')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)
  const firstSize = bytesOf(t.jsonl()).length
  expect(world.reads).toEqual([TRANSCRIPT])

  const second = t.prompt('CT-SYN 第二条')
  world.file = t.jsonl()
  await appendRow($, second)
  await world.clock.advance(300)

  expect(world.reads).toEqual([TRANSCRIPT])
  expect(offsetsOf(world)).toEqual([firstSize])
  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN first', 'CT-SYN 第二条']))
})

test('a half-written last row is read once the rest of it is written', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN first')
  const second = t.prompt('CT-SYN written in two goes')
  const whole = t.jsonl()
  const cut = whole.lastIndexOf('CT-SYN written')
  const world = host(on, whole.slice(0, cut))
  await start($, world)
  const pane = await mountPane($)
  expect(await buttonTexts(pane)).not.toContain('CT-SYN written in two goes')

  world.file = whole
  await appendRow($, second)
  await world.clock.advance(300)

  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN first', 'CT-SYN written in two goes']))
  expect(await texts(pane)).not.toContain('有 1 行无法识别，目录可能不完整')
})

test('a file that got smaller is read again from the start', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN old one')
  t.prompt('CT-SYN old two')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  const shorter = transcript()
  const only = shorter.prompt('CT-SYN new')
  world.file = shorter.jsonl()
  await appendRow($, only)
  await world.clock.advance(300)

  expect(world.reads).toEqual([TRANSCRIPT, TRANSCRIPT])
  expect(world.runs).toEqual([])
  const listed = await buttonTexts(pane)
  expect(listed).toContain('CT-SYN new')
  expect(listed).not.toContain('CT-SYN old one')
  expect(listed.length).toBe(2)
})

test('a transcript refused for permission lists nothing and says why at the bottom', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN hidden')
  const world = host(on, t.jsonl())
  world.refuse = 'denied'
  await start($, world)
  const pane = await mountPane($)

  expect(await buttonTexts(pane)).toEqual([])
  expect(await texts(pane)).toEqual(['没有权限读本会话的 transcript，目录无法显示'])
})

test('a read that fails after entries showed takes them all away, and says so', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN shown')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)
  expect(await buttonTexts(pane)).toContain('CT-SYN shown')

  const next = t.prompt('CT-SYN unread')
  world.file = t.jsonl()
  world.refuse = 'error'
  await appendRow($, next)
  await world.clock.advance(300)

  expect(await buttonTexts(pane)).toEqual([])
  expect(await texts(pane)).toEqual(['读不到本会话的 transcript，目录无法显示'])

  world.refuse = undefined
  await appendRow($, next)
  await world.clock.advance(300)
  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN shown', 'CT-SYN unread']))
})

test('lines that are not rows are skipped and counted at the bottom of the pane', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  t.prompt('CT-SYN two')
  const world = host(on, t.jsonl() + 'not a row\n[1,2]\n')
  await start($, world)
  const pane = await mountPane($)

  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN one', 'CT-SYN two']))
  const drawn = await texts(pane)
  expect(drawn[drawn.length - 1]).toBe('有 2 行无法识别，目录可能不完整')
})

test('a line longer than a chunk is skipped and counted, and the rows around it are listed', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN before the long line')
  const after = transcript(Date.UTC(2026, 9, 10, 2, 0, 0))
  after.prompt('CT-SYN after the long line')
  const long = JSON.stringify({ type: 'attachment', content: 'x'.repeat(4_300_000) })
  const world = host(on, t.jsonl() + long + '\n' + after.jsonl())
  await start($, world)
  const pane = await mountPane($)

  expect(world.reads).toEqual([])
  const drawn = await texts(pane)
  expect(drawn[drawn.length - 1]).toBe('有 1 行无法识别，目录可能不完整')
  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN after the long line']))
})

test('on Windows the chunks are read by Windows PowerShell 5.1 as base64, the path passed through the environment', async ($, on) => {
  const prompts = ['CT-SYN 窗口 one', 'CT-SYN 窗口 two', 'CT-SYN 窗口 three', 'CT-SYN 窗口 four', 'CT-SYN 窗口 five']
  const t = bigSession(prompts)
  const world = host(on, t.jsonl(), WINDOWS_TRANSCRIPT)
  await start($, world)
  const pane = await mountPane($)

  const first = world.runs[0]
  expect(first?.argv.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command'])
  expect(first?.argv[4]).toContain('[IO.File]::Open($env:CHAT_TOC_PATH')
  expect(first?.argv[4]).toContain('[Convert]::ToBase64String(')
  expect(first?.env).toEqual({ CHAT_TOC_PATH: WINDOWS_TRANSCRIPT, CHAT_TOC_OFFSET: '0', CHAT_TOC_BYTES: '3000000' })
  /* 3,000,000 B of base64 is 4,000,000 B, under `$.process.run`'s 4 MiB. */
  const bytes = bytesOf(t.jsonl())
  for (const run of world.runs.slice(1)) expect(bytes[Number(run.env?.CHAT_TOC_OFFSET) - 1]).toBe(0x0a)
  expect(await buttonTexts(pane)).toEqual(expect.arrayContaining(prompts))
})
