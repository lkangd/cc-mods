import { expect, test } from 'claude-code/testing'
import { foldTimeline } from '../hooks/branch'
import { gitToplevelArgv, projectRootFrom } from '../hooks/project'
import type { ArchiveRow } from './support'
import {
  BAND_ID,
  SECRET,
  captureCalls,
  composerPrompt,
  installSupportedTarget,
  projectId,
  projectRoot,
  promptHistory,
  renderBand,
  runId,
  session,
} from './support'

function consentedStore(): Record<string, unknown> {
  return { [`prompt-trail:consent:${projectId}`]: { policyVersion: 1, decision: 'enabled' } }
}

/* Issue 24: each canonical project root has a Project Timeline of its own,
   decided from the directory Claude Code started in and nothing else. */

test('a Git project is rooted where Git says its working tree begins', () => {
  expect(projectRootFrom('/work/repo/src', { exitCode: 0, stdout: '/work/repo\n' }, false))
    .toBe('/work/repo')
  /* A worktree is a working tree of its own. */
  expect(projectRootFrom('/work/repo-wt/src', { exitCode: 0, stdout: '/work/repo-wt\n' }, false))
    .toBe('/work/repo-wt')
})

test('an answer from Git that is not a plain absolute path proves nothing', () => {
  expect(projectRootFrom('/work/repo', { exitCode: 0, stdout: 'repo\n' }, false)).toBeUndefined()
  expect(projectRootFrom('/work/repo', { exitCode: 0, stdout: '/work/\u001brepo\n' }, false)).toBeUndefined()
  expect(projectRootFrom('/work/repo', { exitCode: 0, stdout: '\n' }, false)).toBeUndefined()
})

test('without a .git above it, the start directory is the project root however Git failed', () => {
  /* 128 is "not a repository"; 1 is the shim a Mac without the Command Line
     Tools answers with. */
  for (const exitCode of [128, 1, 69]) {
    expect(projectRootFrom('/work/notes', { exitCode, stdout: '' }, false)).toBe('/work/notes')
  }
})

test('a .git that Git could not read leaves the project root unproven', () => {
  for (const exitCode of [128, 1]) {
    expect(projectRootFrom('/work/repo', { exitCode, stdout: '' }, true)).toBeUndefined()
  }
})

test('Git is asked without the environment that could point it elsewhere', () => {
  const argv = gitToplevelArgv('/work/repo/src')

  expect(argv.slice(-5)).toStrictEqual(['/usr/bin/git', '-C', '/work/repo/src', 'rev-parse', '--show-toplevel'])
  expect(argv[0]).toBe('/usr/bin/env')
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES']) {
    expect(argv[argv.indexOf(name) - 1]).toBe('-u')
  }
})

test('a failing Git outside any repository collects under the start directory', async ($, on) => {
  const calls = installSupportedTarget(on, { store: consentedStore(), gitExitCode: 1, hasGitDirectory: false })
  await $.session.start(session)

  const result = await composerPrompt($)
  const status = await promptHistory($, 'status')

  expect(result.text).toBe(SECRET)
  expect(captureCalls(calls, 'capture-confirm')).toHaveLength(1)
  expect(status.text).toContain(`project: ${projectRoot}`)
  const git = calls.find(call => call.argv.includes('/usr/bin/git'))
  expect(git?.argv).toStrictEqual(gitToplevelArgv(projectRoot))
})

test('disabling this Run leaves another Run its branch, its owed writes and its archive', async ($, on) => {
  const otherRun = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'
  const otherBranch = `prompt-trail:branch:${projectId}:${otherRun}:22222222-3333-4444-8555-666666666666`
  const otherLifecycle = `prompt-trail:lifecycle:${projectId}:${otherRun}`
  const branch = { version: 1, branchId: '33333333-4444-4555-8666-777777777777', parentEventId: null }
  const lifecycle = { version: 1, queue: [] }
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [otherBranch]: branch,
    [otherLifecycle]: lifecycle,
  }
  installSupportedTarget(on, { store })
  await $.session.start(session)
  await composerPrompt($)

  await promptHistory($, 'disable')

  expect(store[`prompt-trail:run-mode:${projectId}:${runId}`]).toMatchObject({ mode: 'disabled' })
  expect(store[otherBranch]).toStrictEqual(branch)
  expect(store[otherLifecycle]).toStrictEqual(lifecycle)
  expect(store[`prompt-trail:archive-state:${projectId}`]).toBeUndefined()
})

test('status reports this project alone, whatever another project holds', async ($, on) => {
  const otherProject = 'e'.repeat(64)
  const store: Record<string, unknown> = {
    ...consentedStore(),
    [`prompt-trail:consent:${otherProject}`]: { policyVersion: 1, decision: 'declined' },
    [`prompt-trail:archive-state:${otherProject}`]: { version: 1, state: 'unavailable' },
    [`prompt-trail:reconcile:${otherProject}`]: {
      version: 1,
      eventId: '88888888-9999-4aaa-8bbb-cccccccccccc',
      runId,
      segmentId: '11111111-2222-4333-8444-555555555555',
      branchId: '22222222-3333-4444-8555-666666666666',
      parentEventId: null,
      occurredAtMs: 1_795_000_000_000,
      attachmentCount: 0,
    },
  }
  installSupportedTarget(on, { store })
  await $.session.start(session)
  await composerPrompt($)

  const status = await promptHistory($, 'status')

  expect(status.text).toContain('collection consent: granted')
  expect(status.text).toContain('pending reconciliation: none')
  expect(status.text).not.toContain('archive: unavailable')
  expect(status.text).not.toContain(otherProject)
  expect(status.text).not.toContain('88888888')
})

type Row = Parameters<typeof foldTimeline>[0][number]

function prompt(eventId: string, sequence: number, parentEventId: string | null, run = 'run-a'): Row {
  return { kind: 'prompt', eventId, sequence, runId: run, parentEventId }
}

function boundary(eventId: string, sequence: number, run: string): Row {
  return { kind: 'boundary', eventId, sequence, runId: run }
}

test('another Run writing alongside this one folds into one place from its first event', () => {
  const rows: Row[] = [
    prompt('a1', 1, null),
    boundary('b-start', 2, 'run-b'),
    prompt('b1', 3, null, 'run-b'),
    prompt('a2', 4, 'a1'),
    prompt('b2', 5, 'b1', 'run-b'),
    boundary('b-off', 6, 'run-b'),
    prompt('a3', 7, 'a2'),
  ]

  const folds = foldTimeline(rows, 'run-a', 'a3')

  /* Its boundaries go with it; only its Prompt Entries are counted. */
  expect([...folds.folded]).toEqual([
    ['b-start', 'b-start'], ['b1', 'b-start'], ['b2', 'b-start'], ['b-off', 'b-start'],
  ])
  expect([...folds.counts]).toEqual([['b-start', 2]])
  expect([...folds.runs]).toEqual(['b-start'])
})

test('another Run is folded only after this Run began', () => {
  const rows: Row[] = [
    prompt('b1', 1, null, 'run-b'),
    prompt('a1', 2, null),
    prompt('b2', 3, 'b1', 'run-b'),
    prompt('a2', 4, 'a1'),
  ]

  const folds = foldTimeline(rows, 'run-a', 'a2')

  expect([...folds.folded]).toEqual([['b2', 'b2']])
})

test('another Run that entered no prompt after this one began is drawn as it is', () => {
  const rows: Row[] = [prompt('a1', 1, null), boundary('b-off', 2, 'run-b'), prompt('a2', 3, 'a1')]

  expect(foldTimeline(rows, 'run-a', 'a2').folded.size).toBe(0)
})

test('each other Run folds on its own', () => {
  const rows: Row[] = [
    prompt('a1', 1, null),
    prompt('b1', 2, null, 'run-b'),
    prompt('c1', 3, null, 'run-c'),
    prompt('b2', 4, 'b1', 'run-b'),
    prompt('a2', 5, 'a1'),
  ]

  expect([...foldTimeline(rows, 'run-a', 'a2').counts]).toEqual([['b1', 2], ['c1', 1]])
})

test('the band folds a Run writing alongside this one and opens it on a press', async ($, on) => {
  const archive: ArchiveRow[] = []
  const otherRun = 'abababab-cdcd-4efe-8a0a-121212121212'
  const other = { runId: otherRun, segmentId: '45454545-6767-4898-8a9a-bcbcbcbcbcbc', branchId: '56565656-7878-4989-8aba-cdcdcdcdcdcd' }
  installSupportedTarget(on, { store: consentedStore(), archive, transcript: [] })
  await $.session.start(session)
  await promptHistory($)
  await composerPrompt($, { text: 'PT-SECRET-MINE-1' })

  /* Another process archives between this Run's two prompts. */
  const next = () => Math.max(...archive.map(row => row.sequence)) + 1
  archive.push({ kind: 'prompt', eventId: 'b1000000-0000-4000-8000-000000000000', sequence: next(), ...other, parentEventId: null, text: 'PT-SECRET-OTHER', attachmentCount: 0 })
  archive.push({ kind: 'run-detached', eventId: 'b2000000-0000-4000-8000-000000000000', sequence: next(), ...other })
  await composerPrompt($, { text: 'PT-SECRET-MINE-2' })
  await promptHistory($)
  const folded = JSON.stringify(await renderBand($, { maxRows: 40 }))
  await $.ui.press({ plugin: 'prompt-trail', key: 'prompt-trail:fold:b1000000-0000-4000-8000-000000000000', requestId: BAND_ID })
  const opened = JSON.stringify(await renderBand($, { maxRows: 40 }))

  expect(folded).toContain('▸ 另一 Run · 1 条')
  expect(folded).not.toContain('PT-SECRET-OTHER')
  expect(folded).not.toContain('Run 离开')
  expect(folded).toContain('PT-SECRET-MINE-2')
  expect(opened).toContain('▾ 另一 Run · 1 条')
  expect(opened).toContain('PT-SECRET-OTHER')
  expect(opened).toContain('Run 离开')
})
