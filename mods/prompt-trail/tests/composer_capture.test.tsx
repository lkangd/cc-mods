import type { PromptOrigin } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  promptHistory,
  renderBand,
  session,
} from './support'

const enabledConsent = {
  consent: { policyVersion: 1, decision: 'enabled' as const },
}

/** Every origin the engine can stamp that is not the person's own Enter. */
const nonComposerOrigins: readonly PromptOrigin[] = [
  { kind: 'bridge' },
  { kind: 'sdk' },
  { kind: 'task-notification' },
  { kind: 'scheduled-trigger' },
  { kind: 'peer' },
  { kind: 'peer-send-message' },
  { kind: 'projects-relay' },
  { kind: 'channel', server: 'slack' },
  { kind: 'coordinator' },
  { kind: 'observer' },
  { kind: 'observer-activity' },
  { kind: 'auto-continuation' },
  { kind: 'unclassified' },
  { kind: 'slack-ping' },
  { kind: 'plugin', name: 'another-plugin' },
]

const expand = promptHistory

test('no origin but the composer creates a Prompt Entry', async ($, on) => {
  const calls = installSupportedTarget(on, enabledConsent)
  await $.session.start(session)

  for (const origin of nonComposerOrigins) {
    const result = await composerPrompt($, { text: SECRET, origin })
    expect(result).toMatchObject({ text: SECRET })
  }

  expect(calls.some(call => call.argv[1]?.startsWith('capture-'))).toBe(false)
  await expand($)
  /* The Run did start — its first capture was staged — but no entry exists. */
  const band = JSON.stringify(await renderBand($))
  expect(band).not.toContain('PT-SECRET')
  expect(band).not.toContain('1. ')
})

test('a slash command run archives nothing while slash text still does', async ($, on) => {
  const calls = installSupportedTarget(on, enabledConsent)
  await $.session.start(session)

  await expand($)
  await $.command.run({
    command: 'prompt-history',
    args: 'status',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  /* Asking the archive what is unresolved is a read, not a capture. */
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(0)

  const typed = await composerPrompt($, { text: '/cost' })

  expect(typed).toMatchObject({ text: '/cost' })
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-confirm')[0]?.stdin).toBe('/cost')
})

test('three identical prompts stay three distinct Prompt Entries', async ($, on) => {
  const calls = installSupportedTarget(on, { ...enabledConsent, transcript: [] })
  await $.session.start(session)

  for (let index = 0; index < 3; index += 1) {
    expect(await composerPrompt($, { text: SECRET })).toMatchObject({ text: SECRET })
  }

  const begins = captureCalls(calls, 'capture-begin')
  const confirms = captureCalls(calls, 'capture-confirm')
  expect(begins).toHaveLength(3)
  expect(confirms).toHaveLength(3)
  const eventIds = begins.map(call => call.argv[8])
  expect(new Set(eventIds).size).toBe(3)
  expect(begins.map(call => call.argv[7])).toStrictEqual([
    '-',
    eventIds[0],
    eventIds[1],
  ])
  expect(confirms.map(call => call.stdin)).toStrictEqual([SECRET, SECRET, SECRET])

  await expand($)
  const rendered = JSON.stringify(await renderBand($))
  const line = SECRET.replace('\n', ' ↵ ')
  expect(rendered).toContain(`1. ${line}`)
  expect(rendered).toContain(`2. ${line}`)
  expect(rendered).toContain(`3. ${line}`)
  expect(rendered).not.toContain('4. ')
})

test('wide, blank-line and combining text is archived verbatim and shown on one line', async ($, on) => {
  const text = 'PT-SECRET-宽字符\n\n中文 段落\nemoji 👩‍💻🇨🇳\ncombining é ā\n\n尾行'
  const calls = installSupportedTarget(on, enabledConsent)
  await $.session.start(session)

  await composerPrompt($, { text })

  expect(captureCalls(calls, 'capture-begin')[0]?.stdin).toBe(text)
  expect(captureCalls(calls, 'capture-confirm')[0]?.stdin).toBe(text)

  await expand($)
  const rendered = JSON.stringify(await renderBand($))
  expect(rendered).toContain(`1. ${text.replace(/\n/g, ' ↵ ')}`)
  expect(rendered).toContain('wrap')
})

test('attachments archive only their count and broad kinds', async ($, on) => {
  const calls = installSupportedTarget(on, enabledConsent)
  await $.session.start(session)

  await composerPrompt($, {
    text: SECRET,
    attachments: [
      { type: 'image', mediaType: 'image/png', filename: 'PT-SECRET-shot.png' },
      { type: 'document', mediaType: 'application/pdf', filename: 'PT-SECRET-plan.pdf' },
    ],
  })

  const begin = captureCalls(calls, 'capture-begin')[0]
  expect(begin?.argv[10]).toBe('2')
  expect(begin?.argv[11]).toBe('image,document')
  const argv = JSON.stringify(calls.map(call => call.argv))
  expect(argv).not.toContain('PT-SECRET-shot.png')
  expect(argv).not.toContain('PT-SECRET-plan.pdf')
  expect(argv).not.toContain('image/png')
  expect(argv).not.toContain('application/pdf')
})

test('an attachment-only submission forms a text-less Prompt Entry', async ($, on) => {
  const calls = installSupportedTarget(on, enabledConsent)
  await $.session.start(session)

  const result = await composerPrompt($, {
    text: '',
    attachments: [{ type: 'image', filename: 'PT-SECRET-paste.png' }],
  })

  expect(result).toMatchObject({ text: '' })
  const begin = captureCalls(calls, 'capture-begin')[0]
  expect(begin?.stdin).toBe('')
  expect(begin?.argv[10]).toBe('1')
  expect(begin?.argv[11]).toBe('image')
  expect(captureCalls(calls, 'capture-confirm')[0]?.stdin).toBe('')

  await expand($)
  const rendered = JSON.stringify(await renderBand($))
  expect(rendered).toContain('1. （附件 ×1）')
  expect(rendered).not.toContain('PT-SECRET')
})

test('a drop beneath leaves no Prompt Entry and discards the Pending Capture', async ($, on) => {
  const calls = installSupportedTarget(on, {
    ...enabledConsent,
    dropBeneath: '下游拒绝了这次提交。',
  })
  await $.session.start(session)

  const result = await composerPrompt($, { text: SECRET })

  expect(result).toMatchObject({ drop: '下游拒绝了这次提交。' })
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(captureCalls(calls, 'capture-abort')).toHaveLength(1)

  await expand($)
  /* The Run did start — its first capture was staged — but no entry exists. */
  const band = JSON.stringify(await renderBand($))
  expect(band).not.toContain('PT-SECRET')
  expect(band).not.toContain('1. ')
})

test('a render replay never archives an entry again', async ($, on) => {
  const calls = installSupportedTarget(on, enabledConsent)
  await $.session.start(session)
  await composerPrompt($, { text: SECRET })
  await expand($)
  const before = calls.length

  // Press handles are minted per render, so compare the rows, not the handles.
  const rows = async () => JSON.stringify(await renderBand($))
    .replace(/"handle":\d+/g, '"handle":0')
  const first = await rows()
  const second = await rows()

  expect(calls).toHaveLength(before)
  expect(first).toBe(second)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
})

test('a blocked Run keeps the archive consistent with the conversation', async ($, on) => {
  const store: Record<string, unknown> = {
    [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' },
  }
  const calls = installSupportedTarget(on, {
    store,
    dropBeneath: '下游拒绝了这次提交。',
    abortFails: true,
  })
  await $.session.start(session)

  const dropped = await composerPrompt($, { text: SECRET })
  expect(dropped).toMatchObject({ drop: '下游拒绝了这次提交。' })

  const blocked = await composerPrompt($, { text: SECRET })

  expect(blocked).toMatchObject({ drop: expect.any(String) })
  expect(blocked.text).toBe(undefined)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(0)
  expect(store[`prompt-trail:archive-state:${projectId}`])
    .toStrictEqual({ version: 1, state: 'unavailable' })
})
