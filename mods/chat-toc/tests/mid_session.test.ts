import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { EMPTY_TEXT } from '../hooks/pane'
import { UNLOCATED_TEXT } from '../hooks/locate'
import { TRANSCRIPT, drawHint, entryTexts, host, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'

/* chat-toc enabled in a session already running (CT-LIFE-007): the host
   raises `session.start` alone, with no classic event to say where the
   transcript is, so chat-toc works the path out from the session id, the
   working directory and the config dir, and takes any classic event's
   `transcript_path` over it. */

const SESSION = { cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true } as const
const DERIVED = '/home/synthetic/.claude/projects/-home-synthetic-project/synthetic-session.jsonl'
const CONFIGURED = '/cfg/claude/projects/-home-synthetic-project/synthetic-session.jsonl'

type Pane = Awaited<ReturnType<typeof mountPane>>

/* The texts of the drawn tree's Text elements. */
async function texts(pane: Pane): Promise<string[]> {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { type?: string; children?: unknown[] }
    if (el.type === 'Text') out.push((el.children ?? []).filter((c): c is string => typeof c === 'string').join(''))
    for (const child of el.children ?? []) walk(child)
  }
  walk(await pane.drawn())
  return out.filter(t => t.trim() !== '')
}

function conversation(...prompts: string[]): string {
  const t = transcript()
  for (const p of prompts) {
    t.prompt(p)
    t.reply([{ type: 'text', text: 'ok' }])
  }
  return t.jsonl()
}

/* The plugin loading after the session began: the hint line is drawn,
   then `session.start` alone. */
async function enableMidSession($: Engine, world: Host) {
  await drawHint($)
  await $.session.start(SESSION)
  await world.clock.settle()
}

test('enabled in mid-session, it lists the conversation so far from the path under HOME/.claude', async ($, on) => {
  const world = host(on, conversation('CT-SYN alpha', 'CT-SYN beta'), DERIVED)
  world.env.HOME = '/home/synthetic'

  await enableMidSession($, world)
  const pane = await mountPane($)

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN alpha', 'CT-SYN beta']))
})

test('CLAUDE_CONFIG_DIR, when set, is where it looks', async ($, on) => {
  const world = host(on, conversation('CT-SYN configured'), CONFIGURED)
  world.env.HOME = '/home/synthetic'
  world.env.CLAUDE_CONFIG_DIR = '/cfg/claude'

  await enableMidSession($, world)
  const pane = await mountPane($)

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN configured']))
})

test('a worked-out path with no file yet reads as a session without a conversation', async ($, on) => {
  const world = host(on, undefined, DERIVED)
  world.env.HOME = '/home/synthetic'

  await enableMidSession($, world)
  const pane = await mountPane($)

  expect(await entryTexts(pane)).toEqual([])
  expect(await texts(pane)).toContain(EMPTY_TEXT)
})

test('with no path to work out the pane says the next submit shows the TOC, and the submit does', async ($, on) => {
  const world = host(on, conversation('CT-SYN later'))
  world.env.HOME = '/home/synthetic'
  world.sessionId = undefined

  await enableMidSession($, world)
  const pane = await mountPane($)
  expect(await entryTexts(pane)).toEqual([])
  expect(await texts(pane)).toContain(UNLOCATED_TEXT)

  await $.classic.UserPromptSubmit({ prompt: 'CT-SYN later', transcript_path: TRANSCRIPT })
  await world.clock.settle()

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN later']))
  expect(await texts(pane)).not.toContain(UNLOCATED_TEXT)
})

test("a classic event's transcript_path unlike the worked-out one replaces it, and the file is read from the start", async ($, on) => {
  /* The host's folder rule changed under chat-toc: the guess finds nothing. */
  const world = host(on, conversation('CT-SYN real'), TRANSCRIPT)
  world.env.HOME = '/home/synthetic'

  await enableMidSession($, world)
  const pane = await mountPane($)
  expect(await entryTexts(pane)).toEqual([])

  await $.classic.UserPromptSubmit({ prompt: 'CT-SYN real', transcript_path: TRANSCRIPT })
  await world.clock.settle()

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN real']))
})

test("a later classic path unlike the one read forgets the old file's entries", async ($, on) => {
  const world = host(on, conversation('CT-SYN old'))
  await start($, world)
  const pane = await mountPane($)
  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN old']))

  world.path = '/home/synthetic/.claude/projects/p/synthetic-next.jsonl'
  world.file = conversation('CT-SYN new')
  await $.classic.UserPromptSubmit({ prompt: 'CT-SYN new', transcript_path: world.path })
  await world.clock.settle()

  const listed = await entryTexts(pane)
  expect(listed).toEqual(expect.arrayContaining(['CT-SYN new']))
  expect(listed).not.toContain('CT-SYN old')
})

test('a session.start after the classic path is known never puts a worked-out path over it, raised together or after', async ($, on) => {
  const world = host(on, conversation('CT-SYN kept'))
  world.env.HOME = '/home/synthetic'
  await drawHint($)
  await Promise.all([$.session.start(SESSION), $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })])
  await world.clock.settle()
  /* A hot reload raises session.start again. */
  await $.session.start(SESSION)
  await world.clock.settle()
  const pane = await mountPane($)

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN kept']))
})
