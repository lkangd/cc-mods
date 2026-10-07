import { expect } from 'claude-code/testing'
import { test } from './support'
import type { Engine } from 'claude-code/testing'
import { clipCells, textCells } from '../hooks/cells'
import type { ArchiveRow } from './support'
import {
  BAND_ID,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  promptHistory,
  renderBand,
  session,
} from './support'

/* Issue 23: the timeline stays usable within the terminal's limits. Every row
   the band draws keeps to one line, whatever the text is made of. */

test('a row is measured in the cells the terminal draws it in', () => {
  expect(textCells('abc')).toBe(3)
  expect(textCells('中文')).toBe(4)
  /* e and a combining acute accent: one cell. */
  expect(textCells('e\u0301')).toBe(1)
  expect(textCells('a\u20dd')).toBe(1)
  /* A text heart asked to draw as emoji takes two cells. */
  expect(textCells('\u2764\ufe0f')).toBe(2)
  expect(textCells('1\ufe0f\u20e3')).toBe(2)
  /* A family joined by ZWJ, a toned thumb and a flag: one emoji each. */
  expect(textCells('\u{1f468}\u200d\u{1f469}\u200d\u{1f467}')).toBe(2)
  expect(textCells('\u{1f44d}\u{1f3fd}')).toBe(2)
  expect(textCells('\u{1f1e8}\u{1f1f3}')).toBe(2)
})

test('a row is cut to its cells with an ellipsis, never inside a character', () => {
  expect(clipCells('abcdef', 6)).toBe('abcdef')
  expect(clipCells('abcdef', 4)).toBe('abc…')
  expect(clipCells('ab中文', 4)).toBe('ab…')
  expect(clipCells('ab\u2764\ufe0fcd', 4)).toBe('ab…')
  expect(clipCells('ab\u{1f468}\u200d\u{1f469}\u200d\u{1f467}cd', 5)).toBe('ab\u{1f468}\u200d\u{1f469}\u200d\u{1f467}…')
  expect(clipCells('ae\u0301cd', 3)).toBe('ae\u0301…')
  /* An Arabic letter keeps its vowel mark. */
  expect(clipCells('\u0628\u064eXY', 2)).toBe('\u0628\u064e…')
})

const otherRunId = '12121212-3434-4565-8787-909090909090'
const otherSessionId = '31313131-4242-4353-8464-757575757575'
const branchId = 'dddddddd-eeee-4fff-8000-111111111111'

/* One lineage of `count` entries from another Run, one row each. */
function archiveOf(count: number): ArchiveRow[] {
  const id = (sequence: number) => `e${String(sequence).padStart(7, '0')}-0000-4000-8000-000000000000`
  return Array.from({ length: count }, (_, index) => ({
    kind: 'prompt',
    eventId: id(index + 1),
    sequence: index + 1,
    runId: otherRunId,
    segmentId: otherSessionId,
    branchId,
    text: `PT-SECRET-OLD-${index + 1}`,
    attachmentCount: 0,
    parentEventId: index === 0 ? null : id(index),
  }))
}

type Drawn = { labels: string[]; texts: string[]; rows: number }

/* What the band drew: every Button's label and every Text's words, in order,
   and how many rows it is. */
function drawn(tree: unknown): Drawn {
  const labels: string[] = []
  const texts: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node === 'string') return void texts.push(node)
    if (!node || typeof node !== 'object') return
    const { type, props, children } = node as { type?: string; props?: Record<string, unknown>; children?: unknown }
    if (type === 'Button' && typeof props?.label === 'string') labels.push(props.label.replace(/^× /, ''))
    walk(children)
  }
  walk(tree)
  const root = tree as { type?: string; children?: unknown[] } | undefined
  return { labels, texts, rows: root?.type === 'Box' ? root.children?.length ?? 0 : 1 }
}

/* The person's trackpad over the band, as the engine hands it on while the
   band's tree is taller than it. */
function scrollBand($: Engine, by: number) {
  return $.ui.scroll({
    component: 'AbovePrompt',
    requestId: BAND_ID,
    offset: 0,
    by,
    bodyRows: 11,
    contentRows: 13,
    origin: { kind: 'person' },
    pointer: { column: 4, row: 2 },
  })
}

test('too narrow or too short, the open band shows its title and that space is short', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)

  /* 28 columns of the band's column are 23 of its body, beside the
     engine's five for `[-]`. The label is cut to the body. */
  for (const [view, label] of [
    [{ bodyColumns: 22 }, '▾ Prompt Trail · 空间…'],
    [{ maxRows: 5 }, '▾ Prompt Trail · 空间不足'],
  ] as const) {
    const band = drawn(await renderBand($, view))
    expect(band.labels).toEqual([label])
    expect(band.rows).toBe(1)
  }
  /* 28 columns and 6 rows are room enough. */
  expect(drawn(await renderBand($, { bodyColumns: 23, maxRows: 6 })).labels).toContain('40. PT-SECRET-OLD-40')
})

test('the title still folds and opens the band while space is short', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($, { bodyColumns: 20 })

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })
  expect(drawn(await renderBand($, { bodyColumns: 20 })).labels).toEqual(['▸ Prompt Trail'])

  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:toggle' })
  expect(drawn(await renderBand($, { bodyColumns: 20 })).labels).toEqual(['▾ Prompt Trail · 空…'])
})

test('room again, the band shows the rows and new-entry count it had before', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  await composerPrompt($, { text: 'PT-SECRET-NEW' })
  const before = drawn(await renderBand($))
  expect(before.labels[0]).toBe('▾ Prompt Trail · 1 条新条目')

  await renderBand($, { bodyColumns: 20 })
  await composerPrompt($, { text: 'PT-SECRET-NEWER' })
  await renderBand($, { maxRows: 4 })
  const after = drawn(await renderBand($))

  expect(after.labels[0]).toBe('▾ Prompt Trail · 2 条新条目')
  const firstEntry = (band: Drawn) => band.labels.find(label => /^\d+\. /.test(label))
  expect(firstEntry(after)).toBe(firstEntry(before))
})

/* A question the model asks through the AskUserQuestion tool. */
function askQuestion($: Engine) {
  return $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{
      question: 'A 还是 B？',
      header: '选择',
      options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
      multiSelect: false,
    }],
  })
}

/* The engine's own band, beneath the plugin: it draws nothing there. */
function engineBand(on: import('claude-code').On) {
  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

/* Lets the hooks a call entered run up to where they wait. */
async function settleHooks(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

test('an AskUserQuestion dialog takes the band\'s place until it closes', async ($, on) => {
  let close = () => {}
  const target = { store: consentedStore(), archive: archiveOf(40), askHold: new Promise<void>(resolve => { close = resolve }) }
  installSupportedTarget(on, target)
  engineBand(on)
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  const before = drawn(await renderBand($))

  const asking = askQuestion($)
  await settleHooks()
  expect(drawn(await renderBand($)).labels).toEqual([])

  close()
  await asking
  expect(drawn(await renderBand($)).labels).toEqual(before.labels)
})

test('a dialog that fails still gives the band back', async ($, on) => {
  let fail = (_error: Error) => {}
  const target = { store: consentedStore(), archive: archiveOf(40), askHold: new Promise<void>((_, reject) => { fail = reject }) }
  installSupportedTarget(on, target)
  engineBand(on)
  await $.session.start(session)
  await promptHistory($)

  const asking = askQuestion($).catch(() => undefined)
  await settleHooks()
  expect(drawn(await renderBand($)).labels).toEqual([])

  fail(new Error('the dialog failed'))
  await asking
  expect(drawn(await renderBand($)).labels).toContain('40. PT-SECRET-OLD-40')
})

test('a survey holding the band takes its place', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  engineBand(on)
  await $.session.start(session)
  await promptHistory($)

  expect(drawn(await renderBand($, { hasSurvey: true })).labels).toEqual([])
  expect(drawn(await renderBand($)).labels).toContain('40. PT-SECRET-OLD-40')
})

/* The title row's hint: how to take the band's keyboard. */
const FOCUS_HINT = 'ctrl+x tab 键盘选择'

test('the title row says how to take the keyboard, whatever holds it', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(3) })
  await $.session.start(session)
  await promptHistory($)

  const band = drawn(await renderBand($))

  expect(band.texts).toContain(FOCUS_HINT)
})

test('the title row offers no way up of its own: at the bottom or away from it the trackpad reaches the band', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)

  /* Taller than its 12 rows, the tree has the engine hand the band its
     scrolling; the title row holds the title alone among its buttons. */
  let band = drawn(await renderBand($))
  expect(band.rows).toBeGreaterThan(12)
  expect(band.labels.filter(label => !/^\d+\. /.test(label))).toEqual(['▾ Prompt Trail'])
  expect(band.texts).toContain(FOCUS_HINT)

  await scrollBand($, -10)
  band = drawn(await renderBand($))
  expect(band.rows).toBeGreaterThan(12)
  expect(band.labels.filter(label => !/^\d+\. /.test(label))).toEqual(['▾ Prompt Trail'])
})

test('short of room, the title row drops the keyboard hint', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)

  /* The title takes 14 columns; the hint and its gap 21 more. */
  let band = drawn(await renderBand($, { bodyColumns: 34 }))
  expect(band.texts).not.toContain(FOCUS_HINT)

  band = drawn(await renderBand($, { bodyColumns: 35 }))
  expect(band.texts).toContain(FOCUS_HINT)
})

test('with nothing to select the title row gives no keyboard hint', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: [] })
  await $.session.start(session)
  await promptHistory($)

  expect(drawn(await renderBand($)).texts).not.toContain(FOCUS_HINT)
})

test('with many new entries in a narrow band the title row keeps the count on screen', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  await $.session.start(session)
  await promptHistory($)
  await renderBand($)
  await scrollBand($, -10)
  for (let index = 0; index < 10; index += 1) await composerPrompt($, { text: `PT-SECRET-NEW-${index}` })

  const band = drawn(await renderBand($, { bodyColumns: 28 }))

  /* The count shows on the title and on the row that takes the view back
     down. */
  expect(band.labels[0]).toBe(clipCells('▾ Prompt Trail · 10 条新条目', 28))
  expect(band.labels[0]).toMatch(/^▾ Prompt Trail · 10/)
  expect(textCells(band.labels[0]!)).toBeLessThanOrEqual(28)
  expect(band.labels).toContain('↓ 10 条新条目')
})

test('scrolling a survey that holds the band leaves the band\'s view where it was', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), archive: archiveOf(40) })
  engineBand(on)
  await $.session.start(session)
  await promptHistory($)
  const before = drawn(await renderBand($))
  await renderBand($, { hasSurvey: true })

  await scrollBand($, -3)

  expect(drawn(await renderBand($)).labels).toEqual(before.labels)
})
