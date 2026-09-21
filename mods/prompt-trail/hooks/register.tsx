import type { EngineInterface, Register } from 'claude-code'
import { EXPECTED_HELPER_SHA256, HELPER_PROTOCOL } from './artifact'

type StartupState = {
  support: 'checking' | 'supported' | 'unsupported target' | 'helper unavailable'
  reason: string
  detected: string
  projectPath?: string
  databaseRoot?: string
  helperPath?: string
  locatorPath?: string
  sessionId?: string
  runId?: string
  archiveGeneration?: string
  helperTrusted?: true
}

type ConsentDecision = 'enabled' | 'declined'

type ProjectState = {
  root: string
  id: string
  databasePath?: string
  consent?: ConsentDecision
  archiveReady: boolean
}

type BranchState = {
  version: 1
  branchId: string
  parentEventId: string | null
}

type TimelineEntry = {
  eventId: string
  sequence: number
  text: string
}

type RuntimeTarget = {
  isInteractive: boolean
  surface: string | null
  cwd: string
}

type Locator = {
  locatorVersion: 1
  pluginProtocol: 1
  helperProtocol: number
  sessionId: string
  hostPid: number
  hostStartSeconds: number
  hostStartMicroseconds: number
  hostExecutable: string
  hostVersion: string
  pluginRoot: string
  pluginData: string
  databaseRoot: string
  helperPath: string
  manifestPath: string
  helperSha256: string
  artifactStatus: string
  runId: string
  archiveGeneration: string
}

type FileIdentity = {
  kind: string
  owner: number
  mode: number
}

type HelperPreflight = {
  status: 'supported'
  artifactStatus: 'trusted'
  sessionId: string
  runId: string
  archiveGeneration: string
  databaseRoot: string
  helperPath: string
  helperProtocol: number
  macosVersion: string
  sqliteVersionNumber: number
  sqliteReturning: true
}

const MINIMUM_CLAUDE_VERSION = [2, 1, 273] as const
const MINIMUM_CLAUDE_VERSION_TEXT = MINIMUM_CLAUDE_VERSION.join('.')
const COLLECTION_POLICY_VERSION = 1
const TARGET = `macOS 15.x arm64 · Claude Code >=${MINIMUM_CLAUDE_VERSION_TEXT} · interactive terminal`
const LOCATOR_SUFFIX = '.claude/plugins/data/.function-hook-locators/prompt-trail'
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_ERROR_CATEGORIES = new Set([
  'architecture',
  'archive-sqlite',
  'capture-conflict',
  'capture-input',
  'capture-not-found',
  'capture-parent-unknown',
  'claude-code-version',
  'claude-code-version-unproven',
  'database-path',
  'database-permissions',
  'database-root',
  'database-root-permissions',
  'database-root-unavailable',
  'database-unavailable',
  'digest-mismatch',
  'expected-digest-invalid',
  'helper-hash-unproven',
  'helper-missing',
  'helper-not-executable',
  'helper-not-regular',
  'helper-path',
  'helper-path-mismatch',
  'helper-path-unproven',
  'home-unavailable',
  'helper-untrusted',
  'host-executable',
  'host-generation',
  'locator-digest-mismatch',
  'locator-directory-permissions',
  'locator-identifiers',
  'locator-path',
  'locator-permissions',
  'locator-protocol-mismatch',
  'locator-schema',
  'locator-session',
  'macos-major-version',
  'macos-version-unproven',
  'manifest-invalid',
  'manifest-missing',
  'manifest-path',
  'manifest-untrusted',
  'operating-system',
  'operating-system-unproven',
  'plugin-artifacts-untrusted',
  'plugin-bin-untrusted',
  'plugin-data-permissions',
  'plugin-root-untrusted',
  'project-identity',
  'protocol-mismatch',
  'schema-version',
  'sqlite-capability',
])
const RETRYABLE_LOCATOR_REASONS = new Set([
  'claude-code-version-unproven',
  'locator-directory-permissions',
  'locator-permissions',
])

let startup: StartupState = {
  support: 'checking',
  reason: 'preflight-pending',
  detected: 'not checked',
}
let runtimeTarget: RuntimeTarget | undefined
let project: ProjectState | undefined
let expanded = false
let entries: TimelineEntry[] = []
let archiveUnavailable = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function supportsClaudeVersion(value: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return false
  const version = match.slice(1).map(component => Number.parseInt(component, 10))
  if (version.some(component => !Number.isSafeInteger(component))) return false
  for (let index = 0; index < MINIMUM_CLAUDE_VERSION.length; index += 1) {
    const component = version[index] ?? 0
    const minimum = MINIMUM_CLAUDE_VERSION[index] ?? 0
    if (component !== minimum) return component > minimum
  }
  return true
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key]
  if (typeof field !== 'string' || field.includes('\0')) {
    throw new Error(`locator-schema:${key}`)
  }
  return field
}

function requiredInteger(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key]
  if (!Number.isSafeInteger(field)) throw new Error(`locator-schema:${key}`)
  return field as number
}

function parseLocator(text: string): Locator {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('locator-schema')
  const locator = {
    locatorVersion: requiredInteger(value, 'locatorVersion'),
    pluginProtocol: requiredInteger(value, 'pluginProtocol'),
    helperProtocol: requiredInteger(value, 'helperProtocol'),
    sessionId: requiredString(value, 'sessionId'),
    hostPid: requiredInteger(value, 'hostPid'),
    hostStartSeconds: requiredInteger(value, 'hostStartSeconds'),
    hostStartMicroseconds: requiredInteger(value, 'hostStartMicroseconds'),
    hostExecutable: requiredString(value, 'hostExecutable'),
    hostVersion: requiredString(value, 'hostVersion'),
    pluginRoot: requiredString(value, 'pluginRoot'),
    pluginData: requiredString(value, 'pluginData'),
    databaseRoot: requiredString(value, 'databaseRoot'),
    helperPath: requiredString(value, 'helperPath'),
    manifestPath: requiredString(value, 'manifestPath'),
    helperSha256: requiredString(value, 'helperSha256'),
    artifactStatus: requiredString(value, 'artifactStatus'),
    runId: requiredString(value, 'runId'),
    archiveGeneration: requiredString(value, 'archiveGeneration'),
  }
  if (locator.locatorVersion !== 1 || locator.pluginProtocol !== 1) {
    throw new Error('locator-schema')
  }
  return locator as Locator
}

function parseHelperPreflight(text: string): HelperPreflight {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('preflight-response')
  if (
    value.status !== 'supported' ||
    value.artifactStatus !== 'trusted' ||
    typeof value.sessionId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.archiveGeneration !== 'string' ||
    typeof value.databaseRoot !== 'string' ||
    typeof value.helperPath !== 'string' ||
    !Number.isSafeInteger(value.helperProtocol) ||
    typeof value.macosVersion !== 'string' ||
    !Number.isSafeInteger(value.sqliteVersionNumber) ||
    value.sqliteReturning !== true
  ) {
    throw new Error('preflight-response')
  }
  return value as HelperPreflight
}

async function run(
  $: EngineInterface,
  argv: readonly string[],
  timeoutMs = 5_000,
  stdin?: string,
) {
  return $.process.run(argv, { timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
}

async function runText(
  $: EngineInterface,
  argv: readonly string[],
): Promise<string | undefined> {
  const result = await run($, argv)
  if (result.exitCode !== 0) return undefined
  const text = result.stdout.trim()
  return text || undefined
}

async function realpath($: EngineInterface, path: string): Promise<string> {
  const canonical = await runText($, ['/bin/realpath', path])
  if (!canonical) throw new Error('path-unproven')
  return canonical
}

async function fileIdentity(
  $: EngineInterface,
  path: string,
  unavailableReason: string,
): Promise<FileIdentity> {
  const result = await run(
    $,
    ['/usr/bin/stat', '-f', '%HT|%u|%Lp', path],
  )
  if (result.exitCode !== 0) throw new Error(unavailableReason)
  const [kind, ownerText, modeText, extra] = result.stdout.trim().split('|')
  const owner = Number.parseInt(ownerText ?? '', 10)
  const mode = Number.parseInt(modeText ?? '', 8)
  if (
    extra !== undefined ||
    !kind ||
    !Number.isSafeInteger(owner) ||
    !Number.isSafeInteger(mode)
  ) {
    throw new Error(unavailableReason)
  }
  return { kind, owner, mode }
}

async function hasExtendedAcl(
  $: EngineInterface,
  path: string,
  unavailableReason: string,
): Promise<boolean> {
  const result = await run($, ['/bin/ls', '-lde', path])
  if (result.exitCode !== 0 || !result.stdout) throw new Error(unavailableReason)
  return result.stdout
    .split('\n')
    .slice(1)
    .some(line => /^\s*\d+:/.test(line))
}

function normalizedHome(home: string): string {
  if (!home.startsWith('/') || home.includes('\0')) throw new Error('home-unavailable')
  return home.length > 1 && home.endsWith('/') ? home.slice(0, -1) : home
}

function safeCategory(stderr: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(stderr)
    if (
      isRecord(parsed) &&
      typeof parsed.category === 'string' &&
      SAFE_ERROR_CATEGORIES.has(parsed.category)
    ) return parsed.category
  } catch {
    // Diagnostics never repeat untrusted helper output.
  }
  return fallback
}

function unsupported(
  reason: string,
  detected: string,
  cwd: string,
  fields: Partial<StartupState> = {},
): StartupState {
  return {
    support: 'unsupported target',
    reason,
    detected,
    projectPath: cwd,
    ...fields,
  }
}

function unavailable(
  reason: string,
  detected: string,
  cwd: string,
  fields: Partial<StartupState> = {},
): StartupState {
  return {
    support: 'helper unavailable',
    reason,
    detected,
    projectPath: cwd,
    ...fields,
  }
}

async function inspectTarget(
  $: EngineInterface,
  isInteractive: boolean,
  surface: string | null,
  cwd: string,
): Promise<StartupState> {
  if (!isInteractive || surface !== 'terminal') {
    return unsupported(
      'interactive-terminal',
      `${surface ?? 'headless'} · ${isInteractive ? 'interactive' : 'non-interactive'}`,
      cwd,
    )
  }

  let os: string | undefined
  try {
    os = await runText($, ['/usr/bin/uname', '-s'])
  } catch {
    return unsupported('operating-system-unproven', 'unproven operating system', cwd)
  }
  if (!os) {
    return unsupported('operating-system-unproven', 'unproven operating system', cwd)
  }
  if (os !== 'Darwin') {
    return unsupported('operating-system', os, cwd)
  }

  let architecture: string | undefined
  try {
    architecture = await runText($, ['/usr/bin/uname', '-m'])
  } catch {
    return unsupported('architecture', `${os} unproven architecture`, cwd)
  }
  if (architecture !== 'arm64') {
    return unsupported(
      'architecture',
      `${os} ${architecture ?? 'unproven architecture'}`,
      cwd,
    )
  }

  let productVersion: string | undefined
  try {
    productVersion = await runText($, ['/usr/bin/sw_vers', '-productVersion'])
  } catch {
    return unsupported(
      'macos-version-unproven',
      `${os} ${architecture} unproven version`,
      cwd,
    )
  }
  if (!productVersion) {
    return unsupported(
      'macos-version-unproven',
      `${os} ${architecture} unproven version`,
      cwd,
    )
  }
  if (!productVersion.startsWith('15.')) {
    return unsupported(
      'macos-major-version',
      `${os} ${architecture} ${productVersion}`,
      cwd,
    )
  }

  const detectedPlatform = `macOS ${productVersion} ${architecture}`
  let home: string
  let sessionId: string
  try {
    home = normalizedHome((await $.env.get('HOME')) ?? '')
    sessionId = await $.session.id()
  } catch {
    return unsupported(
      'claude-code-version-unproven',
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
    )
  }
  if (!SAFE_IDENTIFIER.test(sessionId)) {
    return unsupported(
      'claude-code-version-unproven',
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
    )
  }

  const locatorPath = `${home}/${LOCATOR_SUFFIX}/${sessionId}.json`
  const locatorDirectory = locatorPath.slice(0, locatorPath.lastIndexOf('/'))
  let owner: number
  try {
    const ownerText = await runText($, ['/usr/bin/id', '-u'])
    owner = Number.parseInt(ownerText ?? '', 10)
    if (!Number.isSafeInteger(owner)) throw new Error('locator-permissions')
    const [locatorFile, locatorDir] = await Promise.all([
      fileIdentity($, locatorPath, 'claude-code-version-unproven'),
      fileIdentity($, locatorDirectory, 'locator-directory-permissions'),
    ])
    if (locatorFile.kind !== 'Regular File'
        || locatorFile.owner !== owner
        || locatorFile.mode !== 0o600) {
      throw new Error('locator-permissions')
    }
    if (locatorDir.kind !== 'Directory'
        || locatorDir.owner !== owner
        || locatorDir.mode !== 0o700) {
      throw new Error('locator-directory-permissions')
    }
    const [locatorAcl, locatorDirectoryAcl] = await Promise.all([
      hasExtendedAcl($, locatorPath, 'locator-permissions'),
      hasExtendedAcl($, locatorDirectory, 'locator-directory-permissions'),
    ])
    if (locatorAcl) throw new Error('locator-permissions')
    if (locatorDirectoryAcl) throw new Error('locator-directory-permissions')
    if (await realpath($, locatorPath) !== locatorPath) {
      throw new Error('locator-permissions')
    }
  } catch (error) {
    const reason = error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.message)
      ? error.message
      : 'locator-permissions'
    return unsupported(
      reason,
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
      { locatorPath, sessionId },
    )
  }

  let locator: Locator
  try {
    locator = parseLocator(await $.fs.read(locatorPath))
  } catch {
    return unsupported(
      'claude-code-version-unproven',
      `${detectedPlatform} · Claude Code version unproven`,
      cwd,
      { locatorPath, sessionId },
    )
  }

  const commonFields = {
    locatorPath,
    sessionId,
    runId: locator.runId,
    archiveGeneration: locator.archiveGeneration,
    helperPath: locator.helperPath,
    databaseRoot: locator.databaseRoot,
  }
  if (!supportsClaudeVersion(locator.hostVersion)) {
    const reason = /^\d+\.\d+\.\d+$/.test(locator.hostVersion)
      ? 'claude-code-version'
      : 'claude-code-version-unproven'
    return unsupported(
      reason,
      `${detectedPlatform} · Claude Code ${locator.hostVersion}`,
      cwd,
      commonFields,
    )
  }
  const detected = `${detectedPlatform} · Claude Code ${locator.hostVersion}`
  if (locator.sessionId !== sessionId) {
    return unavailable('locator-session', detected, cwd, commonFields)
  }
  if (!SAFE_IDENTIFIER.test(locator.runId)
      || !SAFE_IDENTIFIER.test(locator.archiveGeneration)) {
    return unavailable('locator-identifiers', detected, cwd, commonFields)
  }
  if (locator.helperProtocol !== HELPER_PROTOCOL) {
    return unavailable('protocol-mismatch', detected, cwd, commonFields)
  }
  if (locator.helperSha256 !== EXPECTED_HELPER_SHA256) {
    return unavailable('locator-digest-mismatch', detected, cwd, commonFields)
  }
  if (locator.artifactStatus !== 'trusted') {
    const reason = SAFE_ERROR_CATEGORIES.has(locator.artifactStatus)
      ? locator.artifactStatus
      : 'artifact-untrusted'
    return unavailable(reason, detected, cwd, commonFields)
  }
  if (
    !locator.pluginRoot.startsWith('/') ||
    !locator.pluginData.startsWith('/') ||
    locator.helperPath !== `${locator.pluginRoot}/bin/prompt-trail-helper` ||
    locator.manifestPath !== `${locator.pluginRoot}/artifacts/helper-manifest.json` ||
    locator.databaseRoot !== `${locator.pluginData}/archives`
  ) {
    return unavailable('locator-path', detected, cwd, commonFields)
  }

  try {
    const pluginBin = `${locator.pluginRoot}/bin`
    const pluginArtifacts = `${locator.pluginRoot}/artifacts`
    const identities = await Promise.all([
      fileIdentity($, locator.pluginRoot, 'plugin-root-untrusted'),
      fileIdentity($, pluginBin, 'plugin-bin-untrusted'),
      fileIdentity($, pluginArtifacts, 'plugin-artifacts-untrusted'),
      fileIdentity($, locator.pluginData, 'plugin-data-permissions'),
      fileIdentity($, locator.helperPath, 'helper-missing'),
      fileIdentity($, locator.manifestPath, 'manifest-missing'),
    ])
    const [pluginRoot, pluginBinDirectory, pluginArtifactsDirectory, pluginData, helper, manifest] = identities
    for (const [identity, reason] of [
      [pluginRoot, 'plugin-root-untrusted'],
      [pluginBinDirectory, 'plugin-bin-untrusted'],
      [pluginArtifactsDirectory, 'plugin-artifacts-untrusted'],
    ] as const) {
      if (identity.kind !== 'Directory'
          || (identity.owner !== owner && identity.owner !== 0)
          || (identity.mode & 0o022) !== 0) {
        throw new Error(reason)
      }
    }
    if (pluginData.kind !== 'Directory' || pluginData.owner !== owner || pluginData.mode !== 0o700) {
      throw new Error('plugin-data-permissions')
    }
    if (helper.kind !== 'Regular File') throw new Error('helper-not-regular')
    if (helper.owner !== owner || (helper.mode & 0o022) !== 0) {
      throw new Error('helper-untrusted')
    }
    if ((helper.mode & 0o111) === 0) throw new Error('helper-not-executable')
    if (manifest.kind !== 'Regular File'
        || manifest.owner !== owner
        || (manifest.mode & 0o022) !== 0) {
      throw new Error('manifest-untrusted')
    }

    const canonicalChecks = [
      locator.pluginRoot,
      pluginBin,
      pluginArtifacts,
      locator.pluginData,
      locator.helperPath,
      locator.manifestPath,
    ]
    for (const path of canonicalChecks) {
      if (await realpath($, path) !== path) throw new Error('noncanonical-path')
    }

    const digest = await run(
      $,
      ['/usr/bin/shasum', '-a', '256', locator.helperPath],
    )
    const actualDigest = digest.exitCode === 0
      ? digest.stdout.trim().split(/\s+/, 1)[0]
      : undefined
    if (actualDigest !== EXPECTED_HELPER_SHA256) throw new Error('digest-mismatch')
  } catch (error) {
    const reason = error instanceof Error && SAFE_ERROR_CATEGORIES.has(error.message)
      ? error.message
      : error instanceof Error && error.message === 'file-unavailable'
        ? 'helper-missing'
        : 'artifact-untrusted'
    return unavailable(reason, detected, cwd, commonFields)
  }

  let result
  try {
    result = await run(
      $,
      [
        locator.helperPath,
        'preflight',
        '--locator',
        locatorPath,
        '--session',
        sessionId,
        '--expected-sha',
        EXPECTED_HELPER_SHA256,
        '--protocol',
        String(HELPER_PROTOCOL),
      ],
      10_000,
    )
  } catch {
    return unavailable('execution-refused', detected, cwd, commonFields)
  }
  if (result.exitCode !== 0) {
    const reason = safeCategory(result.stderr, 'execution-refused')
    if (
      reason === 'operating-system' ||
      reason === 'operating-system-unproven' ||
      reason === 'architecture' ||
      reason === 'macos-major-version' ||
      reason === 'macos-version-unproven' ||
      reason === 'claude-code-version'
    ) {
      return unsupported(reason, detected, cwd, commonFields)
    }
    return unavailable(reason, detected, cwd, commonFields)
  }

  try {
    const preflight = parseHelperPreflight(result.stdout)
    if (
      preflight.sessionId !== sessionId ||
      preflight.runId !== locator.runId ||
      preflight.archiveGeneration !== locator.archiveGeneration ||
      preflight.databaseRoot !== locator.databaseRoot ||
      preflight.helperPath !== locator.helperPath ||
      preflight.helperProtocol !== HELPER_PROTOCOL ||
      !preflight.macosVersion.startsWith('15.') ||
      preflight.sqliteVersionNumber < 3_035_000
    ) throw new Error('preflight-response')
  } catch {
    return unavailable('preflight-response', detected, cwd, commonFields)
  }

  return {
    support: 'supported',
    reason: 'preflight-ok',
    detected,
    projectPath: cwd,
    ...commonFields,
    helperTrusted: true,
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function consentKey(projectId: string): string {
  return `prompt-trail:consent:${projectId}`
}

function branchKey(projectId: string, runId: string, sessionId: string): string {
  return `prompt-trail:branch:${projectId}:${runId}:${sessionId}`
}

function archiveStateKey(projectId: string): string {
  return `prompt-trail:archive-state:${projectId}`
}

function storedConsent(value: unknown): ConsentDecision | undefined {
  if (!isRecord(value) || value.policyVersion !== COLLECTION_POLICY_VERSION) {
    return undefined
  }
  return value.decision === 'enabled' || value.decision === 'declined'
    ? value.decision
    : undefined
}

function storedBranch(value: unknown): BranchState | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.branchId !== 'string' ||
    !SAFE_IDENTIFIER.test(value.branchId) ||
    (value.parentEventId !== null && (
      typeof value.parentEventId !== 'string' ||
      !SAFE_IDENTIFIER.test(value.parentEventId)
    ))
  ) return undefined
  return value as BranchState
}

async function canonicalProjectRoot(
  $: EngineInterface,
  cwd: string,
): Promise<string> {
  const canonicalCwd = await realpath($, cwd)
  let candidate = canonicalCwd
  const git = await run(
    $,
    ['/usr/bin/git', '-C', canonicalCwd, 'rev-parse', '--show-toplevel'],
  )
  if (git.exitCode === 0) {
    const root = git.stdout.trim()
    if (!root.startsWith('/') || /[\u0000-\u001f\u007f]/.test(root)) {
      throw new Error('project-root-unproven')
    }
    candidate = root
  } else {
    if (git.exitCode !== 128) throw new Error('project-root-unproven')
    let directory = canonicalCwd
    for (;;) {
      if (await $.fs.exists(`${directory}/.git`)) {
        throw new Error('project-root-unproven')
      }
      const slash = directory.lastIndexOf('/')
      if (slash <= 0) break
      directory = directory.slice(0, slash)
    }
  }
  const canonical = await realpath($, candidate)
  if (!canonical.startsWith('/') || /[\u0000-\u001f\u007f]/.test(canonical)) {
    throw new Error('project-root-unproven')
  }
  return canonical
}

async function prepareProject($: EngineInterface): Promise<ProjectState> {
  if (!runtimeTarget) throw new Error('project-root-unproven')
  const root = await canonicalProjectRoot($, runtimeTarget.cwd)
  const id = await sha256(root)
  const databasePath = startup.databaseRoot
    ? `${startup.databaseRoot}/${id}.sqlite3`
    : undefined
  if (project?.id === id) {
    project.root = root
    if (databasePath) project.databasePath = databasePath
    startup.projectPath = root
    return project
  }
  const consent = storedConsent(await $.store.get(consentKey(id)))
  let blocked = false
  try {
    const archiveState = await $.store.get(archiveStateKey(id))
    blocked = isRecord(archiveState)
      && archiveState.version === 1
      && archiveState.state === 'unavailable'
  } catch {
    blocked = consent === 'enabled'
  }
  archiveUnavailable = blocked
  project = {
    root,
    id,
    databasePath,
    consent,
    archiveReady: false,
  }
  startup.projectPath = root
  return project
}

async function markArchiveUnavailable(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  archiveUnavailable = true
  try {
    await $.store.set(archiveStateKey(currentProject.id), {
      version: 1,
      state: 'unavailable',
    })
  } catch {
    // The in-memory block remains active for this module instance.
  }
}

async function requestConsent(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<ConsentDecision | undefined> {
  if (currentProject.consent) return currentProject.consent
  if (!currentProject.databasePath) throw new Error('database-root-unavailable')
  const answer = await $.ui.ask(
    [
      'Prompt Trail 会保存每次成功提交的完整最终文本。',
      '内容以明文保存在本机，永久保留且没有应用配额，可能包含凭据。',
      `数据库：${currentProject.databasePath}`,
      '同一系统账户或 root 可读取或篡改这些数据。',
      'Prompt Trail 的删除不会删除 Claude Code transcript、文件系统快照或外部备份中的副本。',
      '是否为这个 Project Timeline 启用采集？',
    ].join('\n'),
    {
      header: '采集同意',
      options: ['启用', '继续但不启用'],
    },
  )
  const decision = answer === '启用'
    ? 'enabled'
    : answer === '继续但不启用'
      ? 'declined'
      : undefined
  if (!decision) return undefined
  currentProject.consent = decision
  try {
    await $.store.set(consentKey(currentProject.id), {
      policyVersion: COLLECTION_POLICY_VERSION,
      decision,
    })
  } catch (error) {
    if (decision === 'enabled') {
      currentProject.consent = undefined
      throw error
    }
  }
  return decision
}

async function branchState(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<{ key: string; value: BranchState }> {
  if (!startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const key = branchKey(currentProject.id, startup.runId, startup.sessionId)
  const existing = storedBranch(await $.store.get(key))
  if (existing) return { key, value: existing }
  const value: BranchState = {
    version: 1,
    branchId: crypto.randomUUID(),
    parentEventId: null,
  }
  await $.store.set(key, value)
  return { key, value }
}

function parsePendingResponse(
  text: string,
  eventId: string,
  projectId: string,
): void {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    value.pending !== true
  ) throw new Error('capture-response')
}

function parseConfirmedResponse(
  text: string,
  eventId: string,
  projectId: string,
): number {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1
  ) throw new Error('capture-response')
  return value.sequence as number
}

async function beginCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  branch: BranchState,
  eventId: string,
  occurredAt: number,
  text: string,
  attachmentKinds: readonly string[],
): Promise<void> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const result = await run(
    $,
    [
      startup.helperPath,
      'capture-begin',
      startup.databaseRoot,
      currentProject.id,
      startup.runId,
      startup.sessionId,
      branch.branchId,
      branch.parentEventId ?? '-',
      eventId,
      String(occurredAt),
      String(attachmentKinds.length),
      attachmentKinds.length > 0 ? attachmentKinds.join(',') : '-',
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      '--stdin',
    ],
    10_000,
    text,
  )
  if (result.exitCode !== 0) throw new Error('capture-begin')
  parsePendingResponse(result.stdout, eventId, currentProject.id)
  currentProject.archiveReady = true
}

async function confirmCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  eventId: string,
  text: string,
): Promise<number> {
  if (!startup.helperPath || !startup.databaseRoot) {
    throw new Error('capture-identity')
  }
  const result = await run(
    $,
    [
      startup.helperPath,
      'capture-confirm',
      startup.databaseRoot,
      currentProject.id,
      eventId,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
      '--stdin',
    ],
    10_000,
    text,
  )
  if (result.exitCode !== 0) throw new Error('capture-confirm')
  return parseConfirmedResponse(result.stdout, eventId, currentProject.id)
}

async function abortCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  eventId: string,
): Promise<void> {
  if (!startup.helperPath || !startup.databaseRoot) return
  const result = await run(
    $,
    [
      startup.helperPath,
      'capture-abort',
      startup.databaseRoot,
      currentProject.id,
      eventId,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error('capture-abort')
}

function statusValue(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function statusText(): string {
  const helperPath = startup.helperPath
    ? statusValue(startup.helperPath)
    : undefined
  const helper = startup.helperTrusted
    ? `trusted · ${helperPath ?? 'unproven path'}`
    : startup.support === 'helper unavailable'
      ? `unavailable${helperPath ? ` · ${helperPath}` : ''}`
      : startup.support === 'checking'
        ? 'checking'
        : `not checked${helperPath ? ` · ${helperPath}` : ''}`
  const consent = project?.consent === 'enabled'
    ? `granted · policy ${COLLECTION_POLICY_VERSION}`
    : project?.consent === 'declined'
      ? `declined · policy ${COLLECTION_POLICY_VERSION}`
      : 'not granted'
  const collectionMode = project?.consent === 'enabled' && !archiveUnavailable
    ? 'enabled'
    : 'disabled'
  const archive = archiveUnavailable
    ? 'unavailable'
    : project?.archiveReady && project.databasePath
      ? `ready · ${statusValue(project.databasePath)}`
      : 'not created'
  return [
    'Prompt Trail status',
    `support: ${startup.support}`,
    `reason: ${startup.reason}`,
    `target: ${TARGET}`,
    `detected: ${statusValue(startup.detected)}`,
    `collection consent: ${consent}`,
    `Run collection mode: ${collectionMode}`,
    `archive: ${archive}`,
    `project: ${startup.projectPath ? statusValue(startup.projectPath) : 'unavailable'}`,
    `database root: ${startup.databaseRoot ? statusValue(startup.databaseRoot) : 'unavailable'}`,
    `helper: ${helper}`,
    `locator: ${startup.locatorPath ? statusValue(startup.locatorPath) : 'unavailable'}`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    runtimeTarget = {
      isInteractive: e.isInteractive,
      surface: e.surface,
      cwd: e.cwd,
    }
    await $.command.register({
      name: 'prompt-history',
      description: 'Show Prompt Trail or inspect its status',
      argumentHint: '[status]',
      immediate: true,
    })
    try {
      startup = await inspectTarget($, e.isInteractive, e.surface, e.cwd)
    } catch {
      startup = {
        support: 'helper unavailable',
        reason: 'preflight-failed',
        detected: 'target could not be proven',
        projectPath: e.cwd,
      }
    }
    return next(e)
  })

  on('command.run', { command: 'prompt-history' }, async ($, e) => {
    const args = e.args.trim()
    if (args === '') {
      expanded = true
      $.ui.invalidate('ui.render')
      return { text: 'Prompt Trail 已展开。' }
    }
    if (args !== 'status') {
      return { text: '用法：/prompt-history [status]' }
    }
    if (runtimeTarget) {
      try {
        startup = await inspectTarget(
          $,
          runtimeTarget.isInteractive,
          runtimeTarget.surface,
          runtimeTarget.cwd,
        )
        if (RETRYABLE_LOCATOR_REASONS.has(startup.reason)) {
          startup = await inspectTarget(
            $,
            runtimeTarget.isInteractive,
            runtimeTarget.surface,
            runtimeTarget.cwd,
          )
        }
      } catch {
        startup = {
          support: 'helper unavailable',
          reason: 'preflight-failed',
          detected: 'target could not be proven',
          projectPath: runtimeTarget.cwd,
        }
      }
    }
    return { text: statusText() }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    if (!runtimeTarget) return next(e)

    let currentProject: ProjectState
    try {
      currentProject = await prepareProject($)
    } catch {
      if (project?.consent === 'enabled') {
        return { drop: 'Prompt Trail 无法证明当前项目身份；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (archiveUnavailable) {
      return { drop: 'Prompt Trail 档案当前不可用；为避免漏记，本次提交已阻止。' }
    }

    try {
      startup = await inspectTarget(
        $,
        runtimeTarget.isInteractive,
        runtimeTarget.surface,
        runtimeTarget.cwd,
      )
    } catch {
      if (currentProject.consent === 'enabled') {
        return { drop: 'Prompt Trail preflight 失败；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (startup.support !== 'supported') {
      if (currentProject.consent === 'enabled') {
        return { drop: 'Prompt Trail 当前不可采集；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (!startup.databaseRoot) {
      return { drop: 'Prompt Trail 无法证明数据库位置；本次提交未进入会话。' }
    }
    currentProject.databasePath = `${startup.databaseRoot}/${currentProject.id}.sqlite3`
    startup.projectPath = currentProject.root

    let decision: ConsentDecision | undefined
    try {
      decision = await requestConsent($, currentProject)
    } catch {
      return { drop: 'Prompt Trail 无法完成采集同意；本次提交未进入会话。' }
    }
    if (decision === 'declined') return next(e)
    if (decision !== 'enabled') {
      return { drop: '请选择“启用”或“继续但不启用”后再提交。' }
    }

    let branch: { key: string; value: BranchState }
    const eventId = crypto.randomUUID()
    try {
      branch = await branchState($, currentProject)
      await beginCapture(
        $,
        currentProject,
        branch.value,
        eventId,
        await $.clock.now(),
        e.text,
        e.attachments?.map(attachment => attachment.type) ?? [],
      )
    } catch {
      await markArchiveUnavailable($, currentProject)
      return { drop: 'Prompt Trail 无法预写 Pending Capture；本次提交未进入会话。' }
    }

    let result
    try {
      result = await next(e)
    } catch (error) {
      await markArchiveUnavailable($, currentProject)
      throw error
    }
    const finalText = result.text
    if (typeof finalText !== 'string') {
      try {
        await abortCapture($, currentProject, eventId)
      } catch {
        await markArchiveUnavailable($, currentProject)
      }
      return result
    }

    try {
      const sequence = await confirmCapture($, currentProject, eventId, finalText)
      const nextBranch: BranchState = {
        ...branch.value,
        parentEventId: eventId,
      }
      await $.store.set(branch.key, nextBranch)
      entries = [...entries, { eventId, sequence, text: finalText }]
      $.ui.invalidate('ui.render')
    } catch {
      await markArchiveUnavailable($, currentProject)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const toggle = () => {
      expanded = !expanded
      $.ui.invalidate('ui.render')
    }
    if (!expanded) {
      return (
        <Button
          key="prompt-trail:toggle"
          plain
          label="▸ Prompt Trail"
          onPress={toggle}
        />
      )
    }
    return (
      <Box flexDirection="column">
        <Button
          key="prompt-trail:toggle"
          plain
          label="▾ Prompt Trail"
          onPress={toggle}
        />
        {entries.length === 0 ? (
          <Text dimColor>尚无 Prompt Entry</Text>
        ) : entries.map((entry, index) => (
          <Text key={`prompt-trail:entry:${entry.eventId}`} wrap="truncate-end">
            {`${index + 1}. ${entry.text.replace(/\r\n?|\n/g, ' ↵ ')}`}
          </Text>
        ))}
      </Box>
    )
  })
}
