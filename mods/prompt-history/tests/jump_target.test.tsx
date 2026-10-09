import { expect } from 'claude-code/testing'
import { test } from './support'
import type { Engine, MockClock } from 'claude-code/testing'
import { jumpOutcome, promptTargets, recordRow, transcriptPrompts, vanishedRows } from '../hooks/jump'
import type { DrawnRow } from '../hooks/jump'
import type { ArchiveRow, TargetOptions, TranscriptRow } from './support'
import {
  BAND_ID,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

/* The band draws the prompts the current session's transcript holds, in
   order, and nothing else. A prompt the transcript drew can be jumped back
   to: the drawn rows are walked in order, each prompt taking the next row
   with its text. */

test('a drawn row is kept once, where it was first drawn', () => {
  const rows: DrawnRow[] = []
  const seen = new Set<string>()
  expect(recordRow(rows, seen, 'r1', 'PH-SECRET-A')).toBe(true)
  expect(recordRow(rows, seen, 'r2', 'PH-SECRET-A')).toBe(true)
  /* A redraw of the first row, as a resize or a scroll brings. */
  expect(recordRow(rows, seen, 'r1', 'PH-SECRET-A')).toBe(false)
  expect(rows).toEqual([
    { requestId: 'r1', text: 'PH-SECRET-A' },
    { requestId: 'r2', text: 'PH-SECRET-A' },
  ])
})

test('a row the transcript lost is not kept when the engine draws it again', () => {
  const rows: DrawnRow[] = []
  expect(recordRow(rows, new Set(['r1']), 'r1', 'PH-SECRET-A')).toBe(false)
  expect(rows).toEqual([])
})

test('rows a rewind removed are the drawn rows past the last one the transcript holds', () => {
  const rows = [
    { requestId: 'r1', text: 'PH-SECRET-A' },
    { requestId: 'r2', text: 'PH-SECRET-A' },
    { requestId: 'r3', text: 'PH-SECRET-B' },
  ]
  expect(vanishedRows(rows, ['PH-SECRET-A', 'task notification', 'PH-SECRET-A'])).toEqual(['r3'])
  expect(vanishedRows(rows, ['PH-SECRET-A', 'PH-SECRET-A', 'PH-SECRET-B', 'PH-SECRET-C'])).toEqual([])
  /* A clear leaves the transcript empty. */
  expect(vanishedRows(rows, [])).toEqual(['r1', 'r2', 'r3'])
})

test('a row whose drawing differs from the transcript is not taken for removed while later rows are held', () => {
  const rows = [
    { requestId: 'r1', text: 'PH-SECRET-A' },
    { requestId: 'r2', text: '[Pasted text #1]' },
    { requestId: 'r3', text: 'PH-SECRET-B' },
  ]
  expect(vanishedRows(rows, ['PH-SECRET-A', 'PH-SECRET-PASTED', 'PH-SECRET-B'])).toEqual([])
})

test('the transcript\'s prompts are the person\'s own rows, without engine markup', () => {
  expect(transcriptPrompts([
    { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context. PH-SECRET-SUMMARY' },
    { role: 'user', text: 'PH-SECRET-ONE' },
    { role: 'assistant', text: 'PH-SECRET-ANSWER' },
    { role: 'user', text: '', toolResults: [{}] },
    { role: 'user', text: '<command-name>/cost</command-name>\n<command-message>cost</command-message>' },
    { role: 'user', text: '<local-command-stdout>PH-SECRET-OUTPUT</local-command-stdout>' },
    { role: 'user', text: '<local-command-caveat>Caveat</local-command-caveat>' },
    { role: 'user', text: '<bash-input>ls</bash-input>' },
    { role: 'user', text: '<task-notification>done</task-notification>' },
    { role: 'user', text: '[Request interrupted by user]' },
    { role: 'user', text: 'PH-SECRET-TWO <command-name>quoted</command-name>' },
    { role: 'user', text: '' },
  ])).toEqual(['PH-SECRET-ONE', 'PH-SECRET-TWO <command-name>quoted</command-name>', ''])
})

test('each prompt takes the next drawn row with its text, in order', () => {
  const rows = [
    { requestId: 'r1', text: 'PH-SECRET-A' },
    { requestId: 'r2', text: 'PH-SECRET-B' },
    { requestId: 'r3', text: 'PH-SECRET-A' },
  ]
  expect(promptTargets(['PH-SECRET-A', 'PH-SECRET-B', 'PH-SECRET-A', 'PH-SECRET-A'], rows))
    .toEqual(['r1', 'r2', 'r3', undefined])
  /* A prompt drawn unlike its stored text has no row, and the walk goes on
     from where it was. */
  expect(promptTargets(['PH-SECRET-A', 'PH-SECRET-PASTED', 'PH-SECRET-B'], rows))
    .toEqual(['r1', undefined, 'r2'])
  expect(promptTargets([], rows)).toEqual([])
})

test('a jump the engine made collapses, one it refused goes stale, a failure changes nothing', () => {
  expect(jumpOutcome({})).toBe('collapse')
  expect(jumpOutcome({ deny: 'no such row' })).toBe('stale')
  expect(jumpOutcome(undefined)).toBe('keep')
})

/* The same, carried out by the hooks. */

function install(on: Parameters<typeof installSupportedTarget>[0], options: TargetOptions) {
  let clock: MockClock | undefined
  /* The options stay live: a test may change them part-way through. */
  options.onClock = mocked => { clock = mocked }
  const calls = installSupportedTarget(on, options)
  /* The engine's own drawing of a transcript row, beneath the plugin. */
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'PromptHint', surface: 'terminal' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  return { calls, settle: () => clock!.settle(), advance: (ms: number) => clock!.advance(ms) }
}

/* The transcript holding the person's rows. */
function holding(...texts: string[]): TranscriptRow[] {
  return texts.map(text => ({ role: 'user', text }))
}

/* The transcript drawing one of the person's rows. */
function drawRow($: Engine, requestId: string, text: string, origin: { kind: string } = { kind: 'composer' }) {
  return $.ui.render({
    component: 'UserMessage',
    surface: 'terminal',
    requestId,
    viewport: { columns: 80, rows: 24 },
    props: { text, origin: origin as { kind: 'composer' }, isExpanded: false },
  })
}

/* Each prompt's label in the band, in order, marked `~` when it is dimmed:
   no drawn row is tied to it, and it cannot be jumped to. */
function entryLabels(tree: unknown): string[] {
  const labels: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown }
    if (typeof props?.key === 'string' && props.key.startsWith('prompt-history:prompt:')) {
      labels.push(`${props.dimColor ? '~' : ''}${String(props.label)}`)
    }
    walk(children)
  }
  walk(tree)
  return labels
}

function bandText(tree: unknown): string {
  return JSON.stringify(tree)
}

test('replayed rows become jump targets; a prompt the engine has not drawn is dimmed', async ($, on) => {
  const { settle } = install(on, {
    store: consentedStore(),
    transcript: holding('PH-SECRET-ONE', 'PH-SECRET-TWO', 'PH-SECRET-TWO', 'PH-SECRET-THREE'),
  })
  /* A reload replays the transcript before the session starts. */
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await drawRow($, 'row-3', 'PH-SECRET-TWO')
  await $.session.start(session)
  await settle()
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PH-SECRET-ONE',
    '2. PH-SECRET-TWO',
    '3. PH-SECRET-TWO',
    '~4. PH-SECRET-THREE',
  ])
})

test('a new session draws none of what the project archived before it', async ($, on) => {
  const branchId = 'dddddddd-eeee-4fff-8000-222222222222'
  const archive: ArchiveRow[] = [
    { kind: 'prompt', eventId: 'f1111111-0000-4000-8000-000000000000', sequence: 1, runId, segmentId: sessionId, branchId, parentEventId: null, text: 'PH-SECRET-ARCHIVED' },
  ]
  install(on, { store: consentedStore(), archive, transcript: [] })
  await $.session.start(session)
  await promptHistory($)

  const band = bandText(await renderBand($, { maxRows: 40 }))
  expect(band).not.toContain('PH-SECRET-ARCHIVED')
  expect(band).toContain('当前会话尚无 prompt')

  await composerPrompt($, { text: 'PH-SECRET-NEW' })
  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['~1. PH-SECRET-NEW'])
})

test('a project that collects nothing still draws the session\'s prompts', async ($, on) => {
  const calls = install(on, { ask: '继续但不启用', transcript: [] }).calls
  await $.session.start(session)
  await composerPrompt($, { text: 'PH-SECRET-UNCOLLECTED' })
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['~1. PH-SECRET-UNCOLLECTED'])
  expect(calls.some(call => call.argv[1] === 'capture-confirm')).toBe(false)
})

test('previews and rows anyone else wrote are never tied, and a row drawn twice keeps its place', async ($, on) => {
  const { settle } = install(on, { store: consentedStore(), transcript: holding('PH-SECRET-ONE') })
  await $.session.start(session)
  await promptHistory($)
  await drawRow($, 'placeholder', 'PH-SECRET-ONE')
  await drawRow($, 'row-n', 'PH-SECRET-ONE', { kind: 'task-notification' })
  await settle()
  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['~1. PH-SECRET-ONE'])

  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await settle()
  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])
})

test('a read of the transcript that fails keeps what the band drew', async ($, on) => {
  const transcript = holding('PH-SECRET-ONE')
  const options: TargetOptions = { store: consentedStore(), transcript }
  const { settle } = install(on, options)
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await promptHistory($)
  await settle()

  options.messagesFail = true
  transcript.splice(0)
  await renderBand($, { maxRows: 40 })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])
})

test('activating a prompt with no row does nothing, and the band stays open', async ($, on) => {
  const { settle } = install(on, { store: consentedStore(), transcript: holding('PH-SECRET-ONE', 'PH-SECRET-TWO') })
  await $.session.start(session)
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await settle()
  await promptHistory($)
  await renderBand($, { maxRows: 40 })

  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:prompt:0', requestId: BAND_ID })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '~1. PH-SECRET-ONE',
    '2. PH-SECRET-TWO',
  ])
})

test('a jump the engine could not carry out keeps the prompt and the band as they were', async ($, on) => {
  const { settle } = install(on, { store: consentedStore(), transcript: holding('PH-SECRET-ONE', 'PH-SECRET-TWO') })
  await $.session.start(session)
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await settle()
  await promptHistory($)
  await renderBand($, { maxRows: 40 })

  /* The test engine has no transcript to scroll: the call fails rather than
     being refused, which proves nothing about the row. Where a jump lands,
     and the fold after it, is the terminal acceptance's. */
  await $.ui.press({ plugin: 'prompt-history', key: 'prompt-history:prompt:1', requestId: BAND_ID })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '~1. PH-SECRET-ONE',
    '2. PH-SECRET-TWO',
  ])
})

test('what a rewind removed is gone as soon as the band opens', async ($, on) => {
  const transcript = holding('PH-SECRET-ONE', 'PH-SECRET-TWO')
  const { settle } = install(on, { store: consentedStore(), transcript })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await settle()

  /* Rewound to the first prompt; the engine says nothing of it. */
  transcript.splice(1)
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])
})

test('what a rewind removed while the band is open is gone on its next drawing', async ($, on) => {
  const transcript = holding('PH-SECRET-ONE', 'PH-SECRET-TWO')
  const { settle } = install(on, { store: consentedStore(), transcript })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await promptHistory($)
  await settle()
  await renderBand($, { maxRows: 40 })

  /* Rewound with the band open; the engine only draws the band again. */
  transcript.splice(1)
  await renderBand($, { maxRows: 40 })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])
})

test('a rewind with the band open is found when the engine puts the old prompt back in the prompt box', async ($, on) => {
  const transcript = holding('PH-SECRET-ONE', 'PH-SECRET-TWO')
  const { settle, advance } = install(on, { store: consentedStore(), transcript })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await promptHistory($)
  await settle()
  await renderBand($, { maxRows: 40 })
  await advance(500)

  /* A rewind draws nothing but the hint line under the refilled prompt. */
  transcript.splice(1)
  await $.ui.render({
    component: 'PromptHint',
    surface: 'terminal',
    requestId: 'prompt-hint',
    viewport: { columns: 80, rows: 24 },
    props: { isDraft: true, isWorking: false, hint: '' },
  })
  await settle()

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])
})

test('a transcript cut short just after the drawing that asked is found by the follow-up', async ($, on) => {
  const transcript = holding('PH-SECRET-ONE', 'PH-SECRET-TWO')
  const { settle, advance } = install(on, { store: consentedStore(), transcript })
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await promptHistory($)
  await settle()
  await renderBand($, { maxRows: 40 })
  await advance(500)

  /* The band is drawn while the transcript still holds both rows, and loses
     one a moment later with nothing drawn after. */
  await renderBand($, { maxRows: 40 })
  await settle()
  transcript.splice(1)
  await advance(500)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])
})

/* Issue 43: an in-process `/resume` back into a session this process already
   drew replays its rows under the requestIds they had. Drawn once the new
   session has started, they are its transcript again, not the old one drawn
   on its way out. */
test('rows replayed by an in-process resume back into a drawn session are tied again', async ($, on) => {
  const classic = $.classic
  const elsewhere = '66666666-7777-4888-8999-aaaaaaaaaaaa'
  const classicSession = { id: sessionId }
  const transcript = holding('PH-SECRET-ONE')
  const { settle } = install(on, { store: consentedStore(), classicSession, transcript })
  on('classic.SessionEnd', () => ({}))
  on('classic.SessionStart', () => ({}))
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await settle()

  /* Out to another session and back, in the same process; each time the
     engine draws the transcript it leaves once more on the way out. */
  await classic.SessionEnd({ reason: 'resume', session_id: sessionId })
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  classicSession.id = elsewhere
  transcript.splice(0)
  await classic.SessionStart({ source: 'resume', session_id: elsewhere })
  await classic.SessionEnd({ reason: 'resume', session_id: elsewhere })
  classicSession.id = sessionId
  transcript.push(...holding('PH-SECRET-ONE'))
  await classic.SessionStart({ source: 'resume', session_id: sessionId })
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  transcript.push(...holding('PH-SECRET-TWO'))
  await drawRow($, 'row-2', 'PH-SECRET-TWO')
  await settle()
  await promptHistory($)

  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PH-SECRET-ONE',
    '2. PH-SECRET-TWO',
  ])
})

test('a clear empties the band: the next session draws only its own prompts', async ($, on) => {
  const classic = $.classic
  const cleared = '66666666-7777-4888-8999-aaaaaaaaaaaa'
  const classicSession = { id: sessionId }
  const transcript = holding('PH-SECRET-ONE')
  const { settle } = install(on, { store: consentedStore(), classicSession, transcript })
  on('classic.SessionEnd', () => ({}))
  on('classic.SessionStart', () => ({}))
  await $.session.start(session)
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await promptHistory($)
  await settle()
  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual(['1. PH-SECRET-ONE'])

  /* The clear's SessionEnd comes while the transcript still holds the row,
     and the engine draws it once more before the next session starts. */
  await classic.SessionEnd({ reason: 'clear', session_id: sessionId })
  await drawRow($, 'row-1', 'PH-SECRET-ONE')
  await settle()
  expect(bandText(await renderBand($, { maxRows: 40 }))).toContain('当前会话尚无 prompt')

  classicSession.id = cleared
  transcript.splice(0, 1, ...holding('PH-SECRET-ONE', 'PH-SECRET-NEW'))
  await classic.SessionStart({ source: 'clear', session_id: cleared })
  await drawRow($, 'row-0', 'PH-SECRET-ONE')
  await drawRow($, 'row-2', 'PH-SECRET-NEW')
  await settle()

  /* Rows drawn on the way out are never tied, whatever the next transcript
     holds. */
  expect(entryLabels(await renderBand($, { maxRows: 40 }))).toEqual([
    '1. PH-SECRET-ONE',
    '2. PH-SECRET-NEW',
  ])
})
