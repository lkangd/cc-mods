import { expect } from 'claude-code/testing'
import { test } from './support'
import type { BranchState, BranchMatch } from '../hooks/branch'
import { chooseBranch, foldTimeline, forkSources, settleBranch, transcriptRows } from '../hooks/branch'
import type { ArchiveRow, ProcessCall } from './support'
import {
  SECRET,
  captureCalls,
  composerPrompt,
  consentedStore,
  installSupportedTarget,
  parentChoices,
  parentPane,
  pickParent,
  projectId,
  promptHistory,
  renderBand,
  runId,
  session,
  sessionId,
} from './support'

const branchId = 'b1b1b1b1-0000-4000-8000-000000000001'
const freshBranchId = 'b2b2b2b2-0000-4000-8000-000000000002'
const storedParent = 'e1e1e1e1-0000-4000-8000-000000000001'
const otherEntry = 'e2e2e2e2-0000-4000-8000-000000000002'

function stored(parentEventId: string | null, extra: Partial<BranchState> = {}): BranchState {
  return { version: 1, branchId, parentEventId, ...extra }
}

function none(): BranchMatch {
  return { match: 'none', candidates: [], candidateCount: 0 }
}

function ambiguous(...eventIds: string[]): BranchMatch {
  return {
    match: 'ambiguous',
    candidates: eventIds.map((eventId, index) => ({ eventId, sequence: 20 - index, runId: 'run' })),
    candidateCount: eventIds.length,
  }
}

function unique(eventId: string): BranchMatch {
  return {
    match: 'unique',
    eventId,
    candidates: [{ eventId, sequence: 7, runId: 'run' }],
    candidateCount: 1,
  }
}

/* Settling the Active Branch against what the transcript proves. The decision
   is pure: it names the branch state to keep, write or ask about, and the hook
   carries it out. */

test('a resume whose transcript ends on the stored parent keeps its branch', () => {
  expect(settleBranch(stored(storedParent), unique(storedParent), freshBranchId, false))
    .toEqual({ kind: 'keep' })
})

test('a resume whose transcript ends elsewhere branches from where it ends', () => {
  expect(settleBranch(stored(storedParent), unique(otherEntry), freshBranchId, false)).toEqual({
    kind: 'set',
    state: { version: 1, branchId: freshBranchId, parentEventId: otherEntry },
  })
})

test('a stored parent among tied lineages settles the tie', () => {
  expect(settleBranch(stored(storedParent), ambiguous(otherEntry, storedParent), freshBranchId, false))
    .toEqual({ kind: 'keep' })
})

test('a stored lineage a compacted transcript cannot place is put to the person, stored parent first', () => {
  expect(settleBranch(stored(storedParent), none(), freshBranchId, true))
    .toEqual({ kind: 'ask', options: [storedParent] })
  const tied = Array.from({ length: 8 }, (_, index) => `e${index}e${index}-0000-4000-8000-00000000000${index}`)
  const asked = settleBranch(stored(storedParent), ambiguous(...tied), freshBranchId, false)
  expect(asked).toEqual({ kind: 'ask', options: [storedParent, ...tied] })
})

test('a new session starts from the entry its shared history ends on', () => {
  expect(settleBranch(undefined, unique(otherEntry), freshBranchId, false)).toEqual({
    kind: 'set',
    state: { version: 1, branchId: freshBranchId, parentEventId: otherEntry },
  })
  /* A boundary may have created the branch record before any prompt; it is
     still a session with no lineage, and keeps the branch id it was given. */
  expect(settleBranch(stored(null), unique(otherEntry), freshBranchId, false)).toEqual({
    kind: 'set',
    state: { version: 1, branchId, parentEventId: otherEntry },
  })
})

test('a new session with nothing archived behind it starts a root without asking', () => {
  expect(settleBranch(undefined, none(), freshBranchId, false)).toEqual({
    kind: 'set',
    state: { version: 1, branchId: freshBranchId, parentEventId: null },
  })
  expect(settleBranch(stored(null), none(), freshBranchId, false)).toEqual({ kind: 'keep' })
})

test('a fork whose shared history matches several lineages starts a marked root', () => {
  expect(settleBranch(undefined, ambiguous(storedParent, otherEntry), freshBranchId, false)).toEqual({
    kind: 'set',
    state: {
      version: 1,
      branchId: freshBranchId,
      parentEventId: null,
      explicitRoot: true,
      rootReason: 'ambiguous-prefix',
    },
  })
})

test('a root somebody chose is never overruled by the transcript', () => {
  const chosen = stored(null, { explicitRoot: true })
  expect(settleBranch(chosen, unique(otherEntry), freshBranchId, false)).toEqual({ kind: 'keep' })
  expect(settleBranch(chosen, ambiguous(storedParent, otherEntry), freshBranchId, false))
    .toEqual({ kind: 'keep' })
  /* Once a prompt has been chained onto it, it is an ordinary lineage. */
  const grown = stored(storedParent, { explicitRoot: true })
  expect(settleBranch(grown, none(), freshBranchId, true))
    .toEqual({ kind: 'ask', options: [storedParent] })
})

test('the person\'s answer keeps, moves or re-roots the branch', () => {
  expect(chooseBranch(stored(storedParent), storedParent, freshBranchId)).toEqual(stored(storedParent))
  expect(chooseBranch(stored(storedParent), otherEntry, freshBranchId))
    .toEqual({ version: 1, branchId: freshBranchId, parentEventId: otherEntry })
  expect(chooseBranch(stored(storedParent), 'root', freshBranchId))
    .toEqual({ version: 1, branchId: freshBranchId, parentEventId: null, explicitRoot: true })
})

test('the transcript rows sent for matching are the person-side user rows, oldest first', () => {
  const rows = transcriptRows([
    { role: 'user', text: 'PT-SECRET-FIRST' },
    { role: 'assistant', text: 'reply' },
    { role: 'user', text: '', toolResults: [{ tool_use_id: 't', text: 'out', isError: false }] },
    { role: 'user', text: '' },
    { role: 'user', text: '中文🙂\nsecond' },
  ])

  /* An attachment-only prompt is an empty row, and stays one: the archive
     holds a text-less Prompt Entry that has to be matched too. */
  expect(rows.truncated).toBe(false)
  expect(rows.stdin).toBe('15\nPT-SECRET-FIRST0\n17\n中文🙂\nsecond')
})

test('a transcript at the engine\'s row limit is marked truncated', () => {
  const full = Array.from({ length: 4096 }, () => ({ role: 'user' as const, text: 'x' }))
  expect(transcriptRows(full).truncated).toBe(true)
  expect(transcriptRows(full.slice(1)).truncated).toBe(false)
})

test('a row too long to have been archived is left out rather than sent', () => {
  const long = 'x'.repeat(1024 * 1024 + 1)
  const rows = transcriptRows([
    { role: 'user', text: 'PT-SECRET-A' },
    { role: 'user', text: long },
  ])
  expect(rows.stdin).toBe('11\nPT-SECRET-A')
})

/* The same decisions, carried out by the hooks: a composer submission settles
   its session's Active Branch before anything is staged. */

function branchKey(forSessionId: string = sessionId): string {
  return `prompt-trail:branch:${projectId}:${runId}:${forSessionId}`
}

/* Compaction cleared the rows that proved this session's lineage. */
function compactedKey(forSessionId: string = sessionId): string {
  return `prompt-trail:compacted:${projectId}:${forSessionId}`
}

function matchCalls(calls: readonly ProcessCall[]): ProcessCall[] {
  return captureCalls(calls, 'branch-match')
}

function parentOf(call: ProcessCall | undefined): { branchId?: string; parent?: string } {
  return { branchId: call?.argv[6], parent: call?.argv[7] }
}

const earlier = 'e1e1e1e1-0000-4000-8000-00000000000a'
const forkPoint = 'e3e3e3e3-0000-4000-8000-00000000000c'

function archivedEntry(eventId: string, sequence: number, text: string): ArchiveRow {
  return {
    kind: 'prompt',
    eventId,
    sequence,
    runId,
    segmentId: sessionId,
    branchId,
    parentEventId: null,
    text,
  }
}

test('a resume continues the stored lineage, matched inside its own session', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const calls = installSupportedTarget(on, {
    store,
    archive: [archivedEntry(earlier, 1, 'PT-SECRET-EARLIER')],
    messages: [
      { role: 'user', text: 'PT-SECRET-EARLIER' },
      { role: 'assistant', text: 'reply' },
    ],
    branchMatch: unique(earlier),
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  const [match] = matchCalls(calls)
  /* The stored parent is named, so a tie on its lineage settles on it. */
  expect(match?.argv.slice(4, 8)).toEqual([runId, sessionId, 'whole', earlier])
  expect(match?.argv.at(-1)).toBe('--stdin')
  expect(match?.stdin).toBe('17\nPT-SECRET-EARLIER')
  expect(parentOf(captureCalls(calls, 'capture-begin')[0])).toEqual({ branchId, parent: earlier })
})

test('a fork starts its branch from the entry its shared history ends on', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    messages: [
      { role: 'user', text: 'PT-SECRET-SHARED' },
      { role: 'user', text: '', toolResults: [{ tool_use_id: 't', text: 'out', isError: false }] },
    ],
    branchMatch: unique(forkPoint),
  })
  await $.session.start(session)

  await composerPrompt($)

  const [match] = matchCalls(calls)
  /* No lineage of its own yet: the whole project is searched. */
  expect(match?.argv.slice(4, 8)).toEqual(['-', '-', 'whole', '-'])
  expect(match?.stdin).toBe('16\nPT-SECRET-SHARED')
  const begin = parentOf(captureCalls(calls, 'capture-begin')[0])
  expect(begin.parent).toBe(forkPoint)
  expect(store[branchKey()]).toMatchObject({ branchId: begin.branchId, parentEventId: expect.any(String) })
})

/* What the engine writes where a compaction replaced the rows before it; a
   fork of a compacted session opens on it. */
const COMPACTION_SUMMARY =
  'This session is being continued from a previous conversation that ran out of context. '
  + 'The summary below covers the earlier portion of the conversation.\n\nSummary: PT-SECRET-SUMMARY'

test('a fork of a compacted session places its shared history among truncated lineages', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    messages: [
      { role: 'user', text: COMPACTION_SUMMARY },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: 'PT-SECRET-SHARED' },
    ],
    branchMatch: unique(forkPoint),
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(matchCalls(calls)[0]?.argv.slice(4, 8)).toEqual(['-', '-', 'truncated', '-'])
  expect(parentOf(captureCalls(calls, 'capture-begin')[0]).parent).toBe(forkPoint)
  /* Kept, so the session stays matched as compacted after a reload. */
  expect(store[compactedKey()]).toBe(true)
})

test('a fork whose transcript only quotes the compaction summary later is matched whole', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, {
    store,
    messages: [
      { role: 'user', text: 'PT-SECRET-SHARED' },
      { role: 'user', text: COMPACTION_SUMMARY },
    ],
    branchMatch: unique(forkPoint),
  })
  await $.session.start(session)

  await composerPrompt($)

  expect(matchCalls(calls)[0]?.argv[6]).toBe('whole')
  expect(store).not.toHaveProperty(compactedKey())
})

test('a session is aligned in full once, then again only when the session changes', async ($, on) => {
  const classicSession = { id: sessionId }
  const calls = installSupportedTarget(on, { store: consentedStore(), classicSession, transcript: [] })
  await $.session.start(session)

  await composerPrompt($)
  await composerPrompt($, { text: 'PT-SECRET-SECOND' })
  expect(matchCalls(calls)).toHaveLength(1)

  /* An in-process `/resume` into another session of the same Run. */
  classicSession.id = '99999999-2222-4333-8444-555555555555'
  await composerPrompt($, { text: 'PT-SECRET-THIRD' })
  expect(matchCalls(calls)).toHaveLength(2)
})

test('a fork whose shared history matches several lineages archives from a marked root', async ($, on) => {
  const store = consentedStore()
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    messages: [{ role: 'user', text: 'PT-SECRET-SHARED' }],
    branchMatch: ambiguous(earlier, forkPoint),
    parentPane: pane,
  })
  await $.session.start(session)

  const result = await composerPrompt($)

  /* A background fork submits on its own; nobody is asked, nothing is lost. */
  expect(result).toMatchObject({ text: SECRET })
  expect(pane.opens).toHaveLength(0)
  expect(parentOf(captureCalls(calls, 'capture-begin')[0]).parent).toBe('-')
  expect(store[branchKey()]).toMatchObject({
    parentEventId: expect.any(String),
    explicitRoot: true,
    rootReason: 'ambiguous-prefix',
  })
})

test('a stored lineage a compacted transcript contradicts is put to the person, and the draft comes back', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier), [compactedKey()]: true })
  const fills: string[] = []
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    fills,
    parentPane: pane,
    archive: [archivedEntry(earlier, 3, 'PT-SECRET-EARLIER')],
    branchMatch: none(),
  })
  await $.session.start(session)

  const asked = await composerPrompt($)

  expect(asked).toMatchObject({ drop: expect.stringContaining('确认父节点') })
  /* Its earliest rows are gone, so a lineage may begin before them. */
  expect(matchCalls(calls)[0]?.argv[6]).toBe('truncated')
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  /* The stored parent is offered first, by its sequence and its text. */
  expect(await parentChoices($)).toEqual(['#1 PT-SECRET-EARLIER', '新根分支'])
  await pickParent($, pane, labels => labels.find(label => label === '新根分支'))
  expect(fills).toEqual([SECRET])
  expect(store[branchKey()]).toMatchObject({ parentEventId: null, explicitRoot: true })

  /* The resubmission goes through from the chosen root, without asking again. */
  const resubmitted = await composerPrompt($)
  expect(resubmitted).toMatchObject({ text: SECRET })
  expect(matchCalls(calls)).toHaveLength(1)
  expect(parentOf(captureCalls(calls, 'capture-begin')[0]).parent).toBe('-')
})

test('choosing the stored parent keeps the branch it was on', async ($, on) => {
  const pane = parentPane()
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const calls = installSupportedTarget(on, {
    store,
    fills: [],
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)

  await composerPrompt($)
  await pickParent($, pane, labels => labels[0])
  await composerPrompt($)

  /* Not in the loaded window: the stored parent is named by its event id. */
  expect(parentOf(captureCalls(calls, 'capture-begin')[0])).toEqual({ branchId, parent: earlier })
})

test('choosing another candidate branches from it', async ($, on) => {
  const pane = parentPane()
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const calls = installSupportedTarget(on, {
    store,
    fills: [],
    parentPane: pane,
    branchMatch: ambiguous(forkPoint),
  })
  await $.session.start(session)

  await composerPrompt($)
  await pickParent($, pane, labels => labels[1])
  await composerPrompt($)

  const begin = parentOf(captureCalls(calls, 'capture-begin')[0])
  expect(begin.parent).toBe(forkPoint)
  expect(begin.branchId).not.toBe(branchId)
})

test('a submission made before the parent is chosen stays blocked and asks again', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier), [compactedKey()]: true })
  const pane = parentPane()
  const calls = installSupportedTarget(on, {
    store,
    fills: [],
    parentPane: pane,
    branchMatch: none(),
  })
  await $.session.start(session)

  const first = await composerPrompt($)
  const second = await composerPrompt($)

  expect(first).toMatchObject({ drop: expect.any(String) })
  expect(second).toMatchObject({ drop: expect.any(String) })
  expect(pane.opens).toHaveLength(2)
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  expect(store[branchKey()]).toEqual(stored(earlier))
})

test('a resume whose uncompacted transcript reaches no archived entry starts a root without asking', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const pane = parentPane()
  const calls = installSupportedTarget(on, { store, parentPane: pane, branchMatch: none() })
  await $.session.start(session)

  const result = await composerPrompt($)

  expect(result).toMatchObject({ text: SECRET })
  expect(pane.opens).toHaveLength(0)
  expect(matchCalls(calls)[0]?.argv[6]).toBe('whole')
  const begin = parentOf(captureCalls(calls, 'capture-begin')[0])
  expect(begin.parent).toBe('-')
  expect(begin.branchId).not.toBe(branchId)
  /* Rewound, not chosen: a later transcript may still place it. */
  expect(store[branchKey()]).not.toHaveProperty('explicitRoot')
})

for (const [name, failure] of [
  ['a transcript that cannot be read blocks the submission', { messagesFail: true }],
  ['a match the helper cannot answer blocks the submission', { branchMatchFails: true }],
] as const) {
  test(name, async ($, on) => {
    const fills: string[] = []
    const calls = installSupportedTarget(on, { store: consentedStore(), fills, ...failure })
    await $.session.start(session)

    const result = await composerPrompt($)

    expect(result).toMatchObject({ drop: expect.stringContaining('Conversation Branch') })
    expect(JSON.stringify(result)).not.toContain('PT-SECRET-MESSAGES')
    expect(fills).toEqual([SECRET])
    expect(captureCalls(calls, 'capture-begin')).toHaveLength(0)
  })
}

test('a Run that collects nothing never aligns', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore() })
  await $.session.start(session)
  await promptHistory($, 'disable')

  await composerPrompt($)

  expect(matchCalls(calls)).toHaveLength(0)
})

test('re-enabled collection starts a root no transcript overrules', async ($, on) => {
  const store = consentedStore()
  const calls = installSupportedTarget(on, { store, branchMatch: unique(forkPoint) })
  await $.session.start(session)
  await promptHistory($, 'disable')
  await promptHistory($, 'enable')

  await composerPrompt($)

  expect(matchCalls(calls)).toHaveLength(0)
  expect(parentOf(captureCalls(calls, 'capture-begin')[0]).parent).toBe('-')
})

/* The view: what left the active path folds away, nothing is dropped. */

type Row = { kind: 'prompt' | 'boundary'; eventId: string; sequence: number; runId: string; parentEventId?: string | null }

function entry(eventId: string, sequence: number, parentEventId: string | null, run = 'run-a'): Row {
  return { kind: 'prompt', eventId, sequence, runId: run, parentEventId }
}

test('entries this Run left behind after a resume fold at their fork point', () => {
  /* a1 → a2 → a3, rewound in the transcript to a1 and continued with a4. */
  const rows: Row[] = [
    entry('z1', 1, null),
    { kind: 'boundary', eventId: 'clear', sequence: 2, runId: 'run-a' },
    entry('a1', 3, null),
    entry('a2', 4, 'a1'),
    entry('other', 5, null, 'run-b'),
    entry('a3', 6, 'a2'),
    entry('a4', 7, 'a1'),
  ]

  const folds = foldTimeline(rows, 'run-a', 'a4')

  /* z1 lies before the active path's first entry and is not folded; the Run
     writing alongside folds on its own (Issue 24). */
  expect([...folds.folded]).toEqual([['a2', 'a2'], ['other', 'other'], ['a3', 'a2']])
  expect([...folds.counts]).toEqual([['a2', 2], ['other', 1]])
  expect([...folds.runs]).toEqual(['other'])
})

test('a later segment the resumed session never saw folds as a branch of its own', () => {
  const rows: Row[] = [
    entry('a1', 1, null),
    { kind: 'boundary', eventId: 'clear', sequence: 2, runId: 'run-a' },
    entry('b1', 3, null),
    entry('b2', 4, 'b1'),
    entry('a2', 5, 'a1'),
  ]

  const folds = foldTimeline(rows, 'run-a', 'a2')

  expect([...folds.counts]).toEqual([['b1', 2]])
})

test('two branches off different points fold separately', () => {
  const rows: Row[] = [
    entry('a1', 1, null),
    entry('a2', 2, 'a1'),
    entry('x', 3, 'a1'),
    entry('y', 4, 'a2'),
    entry('a3', 5, 'a2'),
  ]

  expect([...foldTimeline(rows, 'run-a', 'a3').counts]).toEqual([['x', 1], ['y', 1]])
})

test('nothing folds without an active path of this Run in view', () => {
  const rows: Row[] = [entry('a1', 1, null), entry('a2', 2, 'a1')]

  expect(foldTimeline(rows, 'run-a', null).counts.size).toBe(0)
  expect(foldTimeline(rows, 'run-a', 'outside-window').counts.size).toBe(0)
})

test('a forked Run names the Run its first entry continues', () => {
  const rows: Row[] = [
    entry('a1', 1, null, 'run-a'),
    entry('f1', 2, 'a1', 'run-f'),
    entry('f2', 3, 'f1', 'run-f'),
    entry('n1', 4, null, 'run-n'),
  ]

  expect([...forkSources(rows)]).toEqual([['run-f', 'run-a']])
})

const left = 'e4e4e4e4-0000-4000-8000-00000000000d'
const otherRun = 'f0f0f0f0-1111-4222-8333-444444444444'

test('entries a resume left behind fold into one row that expands', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(left) })
  installSupportedTarget(on, {
    store,
    archive: [
      archivedEntry(earlier, 1, 'PT-SECRET-KEPT'),
      { ...archivedEntry(left, 2, 'PT-SECRET-LEFT'), parentEventId: earlier },
    ],
    /* The resumed transcript ends on the first entry, not the second. */
    branchMatch: unique(earlier),
  })
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($)

  const folded = JSON.stringify(await renderBand($))
  expect(folded).toContain('PT-SECRET-KEPT')
  expect(folded).toContain('另一分支 · 1 条')
  expect(folded).not.toContain('PT-SECRET-LEFT')
  expect(folded).toContain('PT-SECRET-CONSENT-CAPTURE')

  await $.ui.press({ plugin: 'prompt-trail', key: `prompt-trail:fold:${left}` })
  const open = JSON.stringify(await renderBand($))
  expect(open).toContain('PT-SECRET-LEFT')

  await $.ui.press({ plugin: 'prompt-trail', key: `prompt-trail:fold:${left}` })
  expect(JSON.stringify(await renderBand($))).not.toContain('PT-SECRET-LEFT')
})

test('a forked Run names the Run whose entry it continues', async ($, on) => {
  const store = consentedStore()
  installSupportedTarget(on, {
    store,
    archive: [{ ...archivedEntry(forkPoint, 1, 'PT-SECRET-SHARED'), runId: otherRun, segmentId: otherRun }],
    branchMatch: unique(forkPoint),
  })
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($)

  expect(JSON.stringify(await renderBand($))).toContain(`从 Run ${otherRun.slice(0, 8)} 分出`)
})

test('a fork that could not be tied to one lineage says so where its branch begins', async ($, on) => {
  installSupportedTarget(on, { store: consentedStore(), branchMatch: ambiguous(earlier, forkPoint) })
  await $.session.start(session)
  await composerPrompt($)
  await promptHistory($)

  expect(JSON.stringify(await renderBand($))).toContain('共享前缀无法唯一确定')
})

test('a resume replaying shared history archives nothing for it', async ($, on) => {
  const store = consentedStore({ [branchKey()]: stored(earlier) })
  const archive = [archivedEntry(earlier, 1, 'PT-SECRET-EARLIER')]
  const calls = installSupportedTarget(on, { store, archive, branchMatch: unique(earlier) })
  /* The engine's own drawing of a transcript row, beneath the plugin. */
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  await $.session.start(session)

  /* The resumed transcript draws its old prompts again; no submission runs. */
  for (const requestId of ['replayed-1', 'replayed-2']) {
    await $.ui.render({
      component: 'UserMessage',
      surface: 'terminal',
      requestId,
      viewport: { columns: 80, rows: 24 },
      props: { text: 'PT-SECRET-EARLIER', origin: { kind: 'composer' }, isExpanded: false },
    })
  }
  await composerPrompt($)

  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
  expect(archive.filter(row => row.kind === 'prompt').map(row => row.text))
    .toEqual(['PT-SECRET-EARLIER', SECRET])
})

/* A session the host started a moment ago can run its hooks before the
   bridge has published its locator: on 2.1.280 a background `/fork` submits
   its argument about a second before, and the conversation `/fork` continues
   in a new session has its locator published only once it is taken up. */

test('a submission that reaches a session before its locator waits for the bridge', async ($, on) => {
  const locatorPublished = { value: false }
  let clock: import('claude-code/testing').MockClock | undefined
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    locatorPublished,
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)

  const submitted = composerPrompt($)
  await clock!.advance(200)
  locatorPublished.value = true
  await clock!.advance(200)
  const result = await submitted

  expect(result).toMatchObject({ text: SECRET })
  expect(captureCalls(calls, 'capture-begin')).toHaveLength(1)
})

test('a band opened after a late locator reads the archive it missed at start', async ($, on) => {
  const locatorPublished = { value: false }
  installSupportedTarget(on, {
    store: consentedStore(),
    locatorPublished,
    archive: [archivedEntry(earlier, 1, 'PT-SECRET-EARLIER')],
  })
  await $.session.start(session)
  locatorPublished.value = true

  await promptHistory($)

  expect(JSON.stringify(await renderBand($))).toContain('PT-SECRET-EARLIER')
})

test('a session changed in process waits for its own late locator', async ($, on) => {
  const classicSession = { id: sessionId }
  const locatorPublished = { value: true }
  let clock: import('claude-code/testing').MockClock | undefined
  const calls = installSupportedTarget(on, {
    store: consentedStore(),
    classicSession,
    locatorPublished,
    onClock: mocked => { clock = mocked },
  })
  await $.session.start(session)
  await composerPrompt($)

  /* `/resume` into another session whose locator the bridge has not
     published yet. */
  classicSession.id = '99999999-2222-4333-8444-555555555555'
  locatorPublished.value = false
  const submitted = composerPrompt($, { text: 'PT-SECRET-SECOND' })
  await clock!.advance(200)
  locatorPublished.value = true
  await clock!.advance(200)
  const result = await submitted

  expect(result).toMatchObject({ text: 'PT-SECRET-SECOND' })
  expect(captureCalls(calls, 'capture-begin').map(call => call.argv[5]))
    .toEqual([sessionId, classicSession.id])
})
