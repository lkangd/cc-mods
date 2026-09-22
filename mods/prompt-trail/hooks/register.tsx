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

type CollectionBoundaryKind =
  | 'collection-started'
  | 'collection-stopped'
  | 'collection-resumed'

/* The Run-level switch, persisted per project and Run so an explicit disable
   survives a module reload. A Run with no record collects by default; only
   `/prompt-history disable` turns the switch off. */
type RunModeState = {
  version: 1
  mode: 'enabled' | 'disabled'
  boundary?: {
    kind: CollectionBoundaryKind
    eventId: string
    sequence: number
  }
  /* Set when disable could not write its stop boundary. The archive then has
     no durable record of where collection ended, so resuming would leave a
     resume boundary with no matching stop and misrepresent the gap. */
  stopBoundaryMissing?: true
}

/* A Pending Capture whose outcome is not known: the submission entered the
   session but its confirmation never landed. It is persisted per project
   rather than per Run, because the pending lives in the project's archive and
   a restart into a new Run still owes an answer for it. It carries identity
   only; the draft never enters `$.store`. */
type ReconcileState = {
  version: 1
  eventId: string
  runId: string
  branchId: string
  parentEventId: string | null
  attachmentCount: number
}

type TimelineItem =
  | {
    kind: 'prompt'
    eventId: string
    sequence: number
    text: string
    attachmentCount: number
  }
  | {
    kind: 'boundary'
    eventId: string
    sequence: number
    boundary: CollectionBoundaryKind
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
  'boundary-conflict',
  'boundary-input',
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
let timeline: TimelineItem[] = []
let archiveUnavailable = false
let runMode: { key: string; value: RunModeState } | undefined
/* `text` is present only while the module instance that staged the capture is
   still loaded; after a restart the staged bytes in the archive are the only
   copy of the prompt, and the helper confirms from them without handing them
   back. */
let reconcile: { state: ReconcileState; text?: string } | undefined
/* One archive-side discovery per Run: a restart has to learn that a pending is
   owed, but a healthy Run must not pay for a subprocess on every prompt. */
let pendingDiscovered = false
/* Set when the archive could not say whether anything is owed. Not knowing is
   not the same as nothing being owed, and status says so. */
let pendingUnknown = false

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

function reconcileKey(projectId: string): string {
  return `prompt-trail:reconcile:${projectId}`
}

/* Keyed by Run rather than by classic session, so a module reload inside the
   same Run keeps the switch while a new process starts from the default. */
function runModeKey(projectId: string, runId: string): string {
  return `prompt-trail:run-mode:${projectId}:${runId}`
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

function storedRunMode(value: unknown): RunModeState | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    (value.mode !== 'enabled' && value.mode !== 'disabled')
  ) return undefined
  const missing = value.stopBoundaryMissing === true
    ? { stopBoundaryMissing: true as const }
    : {}
  const boundary = value.boundary
  if (boundary === undefined) return { version: 1, mode: value.mode, ...missing }
  if (
    !isRecord(boundary) ||
    !isCollectionBoundaryKind(boundary.kind) ||
    typeof boundary.eventId !== 'string' ||
    !SAFE_IDENTIFIER.test(boundary.eventId) ||
    !Number.isSafeInteger(boundary.sequence) ||
    (boundary.sequence as number) < 1
  ) return { version: 1, mode: value.mode, ...missing }
  return {
    version: 1,
    mode: value.mode,
    boundary: {
      kind: boundary.kind,
      eventId: boundary.eventId,
      sequence: boundary.sequence as number,
    },
    ...missing,
  }
}

function storedReconcile(value: unknown): ReconcileState | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.eventId !== 'string' ||
    !SAFE_IDENTIFIER.test(value.eventId) ||
    typeof value.runId !== 'string' ||
    !SAFE_IDENTIFIER.test(value.runId) ||
    typeof value.branchId !== 'string' ||
    !SAFE_IDENTIFIER.test(value.branchId)
  ) return undefined
  const parent = value.parentEventId
  if (parent !== null && (typeof parent !== 'string' || !SAFE_IDENTIFIER.test(parent))) {
    return undefined
  }
  const attachmentCount = Number.isSafeInteger(value.attachmentCount)
    && (value.attachmentCount as number) >= 0
    ? value.attachmentCount as number
    : 0
  return {
    version: 1,
    eventId: value.eventId,
    runId: value.runId,
    branchId: value.branchId,
    parentEventId: parent,
    attachmentCount,
  }
}

function isCollectionBoundaryKind(value: unknown): value is CollectionBoundaryKind {
  return value === 'collection-started'
    || value === 'collection-stopped'
    || value === 'collection-resumed'
}

/* A Run with no stored record collects by default; `stored` tells enable
   whether this Run is resuming after its own explicit disable. */
async function loadRunMode(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<{ key: string; value: RunModeState }> {
  if (!startup.runId) {
    /* Without a proven Run id the switch still has to be readable, or an
       unhealthy target would silently resume collecting a disabled Run. */
    if (runMode?.key.startsWith(`prompt-trail:run-mode:${currentProject.id}:`)) {
      return { key: runMode.key, value: runMode.value }
    }
    throw new Error('capture-identity')
  }
  const key = runModeKey(currentProject.id, startup.runId)
  if (runMode?.key === key) return { key, value: runMode.value }
  /* An unreadable switch is not an absent one: defaulting to enabled here
     would resume collecting a Run the person explicitly disabled, so the
     failure propagates and the caller fails closed. */
  const value = storedRunMode(await $.store.get(key))
    ?? { version: 1, mode: 'enabled' as const }
  runMode = { key, value }
  return { key, value }
}

async function saveRunMode(
  $: EngineInterface,
  key: string,
  value: RunModeState,
): Promise<void> {
  runMode = { key, value }
  await $.store.set(key, value)
}

function parseBoundaryResponse(
  text: string,
  eventId: string,
  projectId: string,
  kind: CollectionBoundaryKind,
): number {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.eventId !== eventId ||
    value.projectId !== projectId ||
    value.kind !== kind ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1
  ) throw new Error('boundary-response')
  return value.sequence as number
}

/* A Collection Boundary is a non-prompt Timeline Event: it carries no text and
   takes the next project-level sequence, so it orders against Prompt Entries. */
async function appendBoundary(
  $: EngineInterface,
  currentProject: ProjectState,
  branchId: string,
  kind: CollectionBoundaryKind,
): Promise<{ eventId: string; sequence: number }> {
  if (!startup.helperPath || !startup.databaseRoot || !startup.runId || !startup.sessionId) {
    throw new Error('capture-identity')
  }
  const eventId = crypto.randomUUID()
  const result = await run(
    $,
    [
      startup.helperPath,
      'boundary-append',
      startup.databaseRoot,
      currentProject.id,
      startup.runId,
      startup.sessionId,
      branchId,
      kind,
      eventId,
      String(await $.clock.now()),
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error('boundary-append')
  const sequence = parseBoundaryResponse(
    result.stdout,
    eventId,
    currentProject.id,
    kind,
  )
  currentProject.archiveReady = true
  return { eventId, sequence }
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
  let owed: ReconcileState | undefined
  try {
    const archiveState = await $.store.get(archiveStateKey(id))
    blocked = isRecord(archiveState)
      && archiveState.version === 1
      && archiveState.state === 'unavailable'
    owed = storedReconcile(await $.store.get(reconcileKey(id)))
  } catch {
    /* Not knowing whether something is owed is itself a reason to stop, so an
       unreadable record fails closed exactly as an unreadable archive does. */
    blocked = consent === 'enabled'
  }
  archiveUnavailable = blocked
  reconcile = owed ? { state: owed } : undefined
  pendingDiscovered = false
  pendingUnknown = false
  runMode = undefined
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

/* `text` is the text `next(e)` returned. Without it — a reconciliation after a
   restart, where the draft is gone — the helper archives the bytes it already
   staged, which never leave it. */
async function confirmCapture(
  $: EngineInterface,
  currentProject: ProjectState,
  eventId: string,
  text: string | undefined,
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
      text === undefined ? '--pending' : '--stdin',
    ],
    10_000,
    text,
  )
  if (result.exitCode !== 0) throw new Error('capture-confirm')
  return parseConfirmedResponse(result.stdout, eventId, currentProject.id)
}

function parsePendingList(text: string, projectId: string): ReconcileState[] {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.projectId !== projectId ||
    !Array.isArray(value.pending)
  ) throw new Error('capture-list')
  const owed: ReconcileState[] = []
  for (const row of value.pending) {
    const state = storedReconcile(isRecord(row) ? { ...row, version: 1 } : undefined)
    if (!state) throw new Error('capture-list')
    owed.push(state)
  }
  return owed
}

/* What the archive still holds unresolved. It is the only way a new process
   learns that a previous one left a Pending Capture behind — its `$.store`
   record may never have been written. */
async function listPending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<ReconcileState[]> {
  if (!startup.helperPath || !startup.databaseRoot) {
    throw new Error('capture-identity')
  }
  const result = await run(
    $,
    [
      startup.helperPath,
      'capture-list',
      startup.databaseRoot,
      currentProject.id,
      EXPECTED_HELPER_SHA256,
      String(HELPER_PROTOCOL),
    ],
    10_000,
  )
  if (result.exitCode !== 0) throw new Error('capture-list')
  return parsePendingList(result.stdout, currentProject.id)
}

async function saveReconcile(
  $: EngineInterface,
  currentProject: ProjectState,
  state: ReconcileState,
  text: string | undefined,
): Promise<void> {
  reconcile = { state, text }
  try {
    await $.store.set(reconcileKey(currentProject.id), state)
  } catch {
    /* The in-memory block still holds for this module instance; a reload
       re-discovers the pending from the archive. */
  }
}

async function clearReconcile(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  reconcile = undefined
  /* A crash can leave more than one Run's pending behind, and only the first
     was taken. Settling one re-opens the question rather than letting the rest
     pass unnoticed; the extra listing costs a subprocess only after an actual
     reconciliation. */
  pendingDiscovered = false
  try {
    await $.store.delete(reconcileKey(currentProject.id))
  } catch {
    // The archive no longer holds the pending, so a stale record self-heals.
  }
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

/* `$.session.messages()` answers at most the latest 4096 rows and mixes the
   engine's own `user` rows in with the person's, so it proves an outcome only
   in the two unambiguous shapes: the staged text appears exactly once, or it
   appears nowhere in a transcript short enough to be whole. Anything else is
   for the person to settle. */
const TRANSCRIPT_LIMIT = 4096

function transcriptVerdict(
  messages: readonly { role: string; text: string }[],
  text: string,
): 'entered' | 'absent' | 'ambiguous' {
  const matches = messages.filter(
    message => message.role === 'user' && message.text === text,
  ).length
  if (matches === 1) return 'entered'
  if (matches === 0 && messages.length < TRANSCRIPT_LIMIT) return 'absent'
  return 'ambiguous'
}

/* Settling one Pending Capture. It answers whether the Run may collect again;
   every path that does not reach a definite answer leaves the block in place
   rather than guessing, and no path resubmits the prompt that was dropped. */
async function reconcilePending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<'resolved' | 'blocked'> {
  const owed = reconcile
  if (!owed) return 'resolved'

  const confirmPending = async (): Promise<'resolved' | 'blocked'> => {
    try {
      const sequence = await confirmCapture(
        $,
        currentProject,
        owed.state.eventId,
        owed.text,
      )
      /* Only the Run that staged it may chain its own Active Branch onto the
         entry; another Run's branch is not this reconciliation's to move. */
      if (startup.runId === owed.state.runId && startup.sessionId) {
        await $.store.set(
          branchKey(currentProject.id, startup.runId, startup.sessionId),
          {
            version: 1,
            branchId: owed.state.branchId,
            parentEventId: owed.state.eventId,
          } satisfies BranchState,
        )
      }
      if (owed.text !== undefined) {
        timeline = [
          ...timeline,
          {
            kind: 'prompt',
            eventId: owed.state.eventId,
            sequence,
            text: owed.text,
            attachmentCount: owed.state.attachmentCount,
          },
        ]
        $.ui.invalidate('ui.render')
      }
      await clearReconcile($, currentProject)
      return 'resolved'
    } catch {
      return 'blocked'
    }
  }

  const discardPending = async (): Promise<'resolved' | 'blocked'> => {
    try {
      await abortCapture($, currentProject, owed.state.eventId)
      await clearReconcile($, currentProject)
      return 'resolved'
    } catch {
      return 'blocked'
    }
  }

  let verdict: 'entered' | 'absent' | 'ambiguous' = 'ambiguous'
  if (owed.text !== undefined) {
    try {
      verdict = transcriptVerdict(await $.session.messages(), owed.text)
    } catch {
      verdict = 'ambiguous'
    }
  }
  if (verdict === 'entered') return confirmPending()
  if (verdict === 'absent') return discardPending()

  let answer: string | undefined
  try {
    answer = await $.ui.ask(
      [
        'Prompt Trail 有一条未决的 Pending Capture：提交已交给 Claude Code，但归档确认没有完成。',
        `事件 ID：${owed.state.eventId.slice(0, 8)}`,
        '时间线无法唯一证明这条提交是否进入会话，请选择如何记录它。',
        '“已进入”归档为 Prompt Entry；“未进入”丢弃这条 pending；',
        '“新根分支”同样不归档，并让其后的 prompt 从新的根 Conversation Branch 开始。',
      ].join('\n'),
      {
        header: '未决 Pending Capture',
        options: ['已进入', '未进入', '新根分支'],
      },
    )
  } catch {
    return 'blocked'
  }

  if (answer === '已进入') return confirmPending()
  if (answer === '未进入') return discardPending()
  if (answer === '新根分支') {
    /* Nothing after an outcome nobody could vouch for is chained onto it. The
       new root is written first: if that write fails the pending is still
       there, so the block holds and the choice is not silently lost. */
    if (startup.runId && startup.sessionId) {
      try {
        await $.store.set(
          branchKey(currentProject.id, startup.runId, startup.sessionId),
          {
            version: 1,
            branchId: crypto.randomUUID(),
            parentEventId: null,
          } satisfies BranchState,
        )
      } catch {
        return 'blocked'
      }
    }
    return discardPending()
  }
  /* A closed or cancelled dialog is not an answer: the Run stays blocked. */
  return 'blocked'
}

/* Whether anything is owed before this Run archives its first prompt. The
   archive is asked once, because a previous process may have left a pending
   without ever writing its `$.store` record. */
async function discoverPending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<void> {
  if (pendingDiscovered || reconcile) return
  let owed: ReconcileState[]
  try {
    owed = await listPending($, currentProject)
  } catch (error) {
    pendingUnknown = true
    throw error
  }
  pendingDiscovered = true
  pendingUnknown = false
  const first = owed[0]
  /* Persisted, not just held in memory: a reconciliation that gets partway —
     the entry confirmed but its branch not yet written — must still be owed
     after a restart, and by then the archive no longer lists it. */
  if (first) await saveReconcile($, currentProject, first, undefined)
}

/* A crash can leave one pending per Run behind, so settling one re-asks the
   archive rather than assuming it was the only one. The bound is the helper's
   own fixed batch, which is also the most a single listing can report. */
const PENDING_SETTLE_LIMIT = 64

async function settlePending(
  $: EngineInterface,
  currentProject: ProjectState,
): Promise<'clear' | 'settled' | 'blocked'> {
  let settledAny = false
  for (let attempt = 0; attempt < PENDING_SETTLE_LIMIT; attempt += 1) {
    await discoverPending($, currentProject)
    if (!reconcile) return settledAny ? 'settled' : 'clear'
    if (await reconcilePending($, currentProject) === 'blocked') return 'blocked'
    settledAny = true
  }
  return 'blocked'
}

/* The draft belongs to the person, not to the submission Prompt Trail
   refused: it goes back into the composer, and they decide whether to send
   it again. */
async function restoreDraft($: EngineInterface, text: string): Promise<boolean> {
  try {
    const filled = await $.prompt.fill({ text })
    return filled.isFilled !== false
  } catch {
    return false
  }
}

/* Never claim the draft came back when it did not: a dialog holding the keys
   or a surface with no prompt box both answer `isFilled: false`. */
function draftNote(restored: boolean): string {
  return restored ? '草稿已恢复' : '草稿未能恢复，请重新输入'
}

/* One row of the expanded list: the entry's text folded to a single line, or a
   marker for an attachment-only submission, which archives no text at all. */
function entryLine(entry: Extract<TimelineItem, { kind: 'prompt' }>): string {
  if (entry.text === '') {
    return entry.attachmentCount > 0 ? `（附件 ×${entry.attachmentCount}）` : '（空提交）'
  }
  return entry.text.replace(/\r\n?|\n/g, ' ↵ ')
}

/* A disabled interval is drawn as an explicit break, never as continuous
   history: the stop marker says the prompts after it were not recorded and the
   resume marker says nothing from that interval is reconstructed. */
function boundaryLine(kind: CollectionBoundaryKind): string {
  if (kind === 'collection-stopped') {
    return '—— 采集已停止（其后的 prompt 未记录）——'
  }
  if (kind === 'collection-resumed') {
    return '—— 采集已恢复（新根分支；停用期间的 prompt 不补录）——'
  }
  return '—— 采集已开始 ——'
}

function boundarySummary(mode: RunModeState | undefined): string {
  if (mode?.stopBoundaryMissing) return 'collection-stopped · 未能写入档案'
  if (!mode?.boundary) return 'none'
  return `${mode.boundary.kind} · sequence ${mode.boundary.sequence}`
}

/* Enough to identify the unresolved event and nothing more: no draft, no
   prompt text, not even its length. */
function reconcileSummary(): string {
  if (reconcile) return `${reconcile.state.eventId.slice(0, 8)} · 待对账`
  if (pendingUnknown) return 'unknown · 未决 Pending Capture 不可读'
  return 'none'
}

/* Why this Run is or is not collecting, most specific reason first. */
function collectionModeText(): string {
  if (!runMode) return 'unknown · Run collection mode 不可读'
  if (runMode.value.mode === 'disabled') return 'disabled · 本 Run 已停用采集'
  if (project?.consent !== 'enabled') return 'disabled · 未授予 Collection consent'
  if (reconcile) return 'disabled · 未决 Pending Capture 待对账'
  if (pendingUnknown) return 'unknown · 未决 Pending Capture 不可读'
  if (archiveUnavailable) return 'disabled · 档案不可用'
  if (startup.support !== 'supported') {
    return `disabled · ${statusValue(startup.reason)}`
  }
  return 'enabled'
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
  const consentState = project?.consent === 'enabled'
    ? 'granted'
    : project?.consent === 'declined'
      ? 'declined'
      : 'not granted'
  const consent = `${consentState} · policy ${COLLECTION_POLICY_VERSION}`
  /* The Run switch and what it actually amounts to are reported together, so a
     Run that is switched on but not collecting never reads as collecting. */
  const collectionMode = collectionModeText()
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
    `latest collection boundary: ${boundarySummary(runMode?.value)}`,
    `pending reconciliation: ${reconcileSummary()}`,
    `archive: ${archive}`,
    `project: ${startup.projectPath ? statusValue(startup.projectPath) : 'unavailable'}`,
    `database root: ${startup.databaseRoot ? statusValue(startup.databaseRoot) : 'unavailable'}`,
    `helper: ${helper}`,
    `locator: ${startup.locatorPath ? statusValue(startup.locatorPath) : 'unavailable'}`,
  ].join('\n')
}

async function refreshStartup($: EngineInterface): Promise<void> {
  if (!runtimeTarget) return
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

function recordBoundary(
  kind: CollectionBoundaryKind,
  appended: { eventId: string; sequence: number },
): void {
  timeline = [
    ...timeline,
    {
      kind: 'boundary',
      eventId: appended.eventId,
      sequence: appended.sequence,
      boundary: kind,
    },
  ]
}

/* Turning the current Run's collection on. It never reports success from an
   unsupported or unhealthy target, and a real off-to-on transition starts a
   fresh root Conversation Branch so nothing from the disabled interval is
   back-filled onto the new lineage. */
async function enableCollection($: EngineInterface): Promise<string> {
  if (!runtimeTarget) return 'Prompt Trail 尚未确定运行目标，无法启用采集。'

  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    return 'Prompt Trail 无法证明当前项目身份，未启用采集。'
  }

  await refreshStartup($)
  if (startup.support !== 'supported') {
    return `Prompt Trail 在当前环境不可采集（${startup.support}：${startup.reason}），未启用采集。`
  }
  if (!startup.databaseRoot) {
    return 'Prompt Trail 无法证明数据库位置，未启用采集。'
  }
  currentProject.databasePath = `${startup.databaseRoot}/${currentProject.id}.sqlite3`
  startup.projectPath = currentProject.root

  const hadConsent = currentProject.consent === 'enabled'
  let decision: ConsentDecision | undefined
  try {
    decision = await requestConsent($, currentProject)
  } catch {
    return 'Prompt Trail 无法完成采集同意，未启用采集。'
  }
  if (decision === 'declined') {
    return '这个 Project Timeline 未授予 Collection consent，采集保持关闭。'
  }
  if (decision !== 'enabled') {
    return '请选择“启用”或“继续但不启用”后再运行 /prompt-history enable。'
  }

  /* Resuming over an unreconciled submission would archive the next prompt
     without ever settling the last one, so enable reconciles first — ahead of
     the archive block, which an earlier uncertain failure may have raised over
     the very pending that needs settling — and refuses while anything is owed. */
  try {
    if (await settlePending($, currentProject) === 'blocked') {
      return '仍有未决的 Pending Capture 待对账，未启用采集；请先完成对账。'
    }
  } catch {
    return 'Prompt Trail 无法读取未决的 Pending Capture，未启用采集。'
  }

  if (archiveUnavailable) {
    return 'Prompt Trail 档案当前不可用，未启用采集。'
  }

  /* Already collecting means the switch is on and consent was granted before
     this command ran; there is no transition to mark. */
  let current: { key: string; value: RunModeState }
  try {
    current = await loadRunMode($, currentProject)
  } catch {
    return 'Prompt Trail 无法读取当前 Run collection mode，未启用采集。'
  }
  if (current.value.mode === 'enabled' && hadConsent && !current.value.stopBoundaryMissing) {
    return '当前 Run 已在采集，未写入新的 Collection Boundary。'
  }

  /* A resume whose matching stop boundary never reached the archive would
     present the disabled interval as continuous history, so the stop is
     retried first and the resume waits until it lands. */
  if (current.value.stopBoundaryMissing) {
    let stop: { eventId: string; sequence: number }
    try {
      const branch = await branchState($, currentProject)
      stop = await appendBoundary(
        $,
        currentProject,
        branch.value.branchId,
        'collection-stopped',
      )
    } catch {
      return '上一次停用的 Collection Boundary 仍未写入档案；在它写入前不恢复采集，否则禁用区间会被显示为完整历史。'
    }
    recordBoundary('collection-stopped', stop)
    current = {
      key: current.key,
      value: {
        version: 1,
        mode: current.value.mode,
        boundary: { kind: 'collection-stopped', ...stop },
      },
    }
    await saveRunMode($, current.key, current.value)
  }

  const kind: CollectionBoundaryKind = current.value.mode === 'disabled'
    ? 'collection-resumed'
    : 'collection-started'
  const branchId = crypto.randomUUID()
  let appended: { eventId: string; sequence: number }
  try {
    appended = await appendBoundary($, currentProject, branchId, kind)
  } catch {
    await markArchiveUnavailable($, currentProject)
    return 'Prompt Trail 无法写入 Collection Boundary，未启用采集。'
  }

  try {
    if (startup.runId && startup.sessionId) {
      await $.store.set(
        branchKey(currentProject.id, startup.runId, startup.sessionId),
        { version: 1, branchId, parentEventId: null } satisfies BranchState,
      )
    }
    await saveRunMode($, current.key, {
      version: 1,
      mode: 'enabled',
      boundary: { kind, eventId: appended.eventId, sequence: appended.sequence },
    })
  } catch {
    return '已写入 Collection Boundary，但无法保存 Run collection mode；reload 后状态可能回到默认值。'
  }

  recordBoundary(kind, appended)
  $.ui.invalidate('ui.render')
  return kind === 'collection-resumed'
    ? '当前 Run 已恢复采集，并从新的根 Conversation Branch 开始；停用期间的 prompt 不补录。'
    : '当前 Run 已开始采集，并从新的根 Conversation Branch 开始。'
}

/* Turning the current Run's collection off. Stopping always takes effect —
   that is the direction that cannot lose data — and the Collection Boundary is
   attempted afterwards and reported honestly if it could not be written. */
async function disableCollection($: EngineInterface): Promise<string> {
  if (!runtimeTarget) return 'Prompt Trail 尚未确定运行目标，无法停用采集。'

  let currentProject: ProjectState
  try {
    currentProject = await prepareProject($)
  } catch {
    return 'Prompt Trail 无法证明当前项目身份，未改变 Run collection mode。'
  }

  let current: { key: string; value: RunModeState }
  try {
    current = await loadRunMode($, currentProject)
  } catch {
    return 'Prompt Trail 无法读取当前 Run collection mode，未改变采集开关。'
  }
  if (current.value.mode === 'disabled') {
    return '当前 Run 已停用采集，未写入新的 Collection Boundary。'
  }

  /* The boundary is attempted even when the archive is already flagged
     unavailable: the flag can be stale, and a stop that lands is what keeps
     the disabled interval from reading as continuous history. */
  const kind: CollectionBoundaryKind = 'collection-stopped'
  let appended: { eventId: string; sequence: number } | undefined
  if (
    startup.support === 'supported' &&
    startup.databaseRoot &&
    currentProject.consent === 'enabled'
  ) {
    try {
      const branch = await branchState($, currentProject)
      appended = await appendBoundary($, currentProject, branch.value.branchId, kind)
    } catch {
      appended = undefined
    }
  }

  const boundaryRequired = currentProject.consent === 'enabled'
  const value: RunModeState = {
    version: 1,
    mode: 'disabled',
    ...(appended
      ? {
        boundary: {
          kind,
          eventId: appended.eventId,
          sequence: appended.sequence,
        },
      }
      : {}),
    ...(boundaryRequired && !appended ? { stopBoundaryMissing: true as const } : {}),
  }
  let persisted = true
  try {
    await saveRunMode($, current.key, value)
  } catch {
    persisted = false
    runMode = { key: current.key, value }
  }

  if (appended) {
    recordBoundary(kind, appended)
    $.ui.invalidate('ui.render')
  }
  const boundaryNote = !boundaryRequired
    ? '该项目尚未授予 Collection consent，本就没有采集，未写入 Collection Boundary'
    : appended
      ? '已写入 Collection Boundary'
      : '未能写入 Collection Boundary；在它补写成功前 enable 不会恢复采集'
  const persistenceNote = persisted
    ? ''
    : '；无法保存 Run collection mode，reload 后可能回到默认值'
  return `当前 Run 已停用采集，${boundaryNote}${persistenceNote}。既有 Prompt Entries、Collection consent 和其他 Run 均未改变。`
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
      argumentHint: '[enable|disable|status]',
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
    if (args === 'status') {
      await refreshStartup($)
      /* An unsupported target is reported without resolving the project, so
         status never probes a host Prompt Trail does not run on. A merely
         unhealthy helper still has a real project whose consent and Run mode
         are worth reporting. */
      if (startup.support !== 'unsupported target') {
        try {
          const currentProject = await prepareProject($)
          await loadRunMode($, currentProject)
          /* Best effort: a pending this Run has not met yet still blocks it,
             so status says so rather than reading as healthy. A failure here
             never costs the rest of the report. */
          try {
            await discoverPending($, currentProject)
          } catch {
            /* `discoverPending` has already recorded that the archive could
               not be asked, so the report says "unknown" rather than reading
               as healthy; the other lines still stand. */
          }
        } catch {
          // status stays available without a proven project identity.
        }
      }
      return { text: statusText() }
    }
    if (args === 'enable') return { text: await enableCollection($) }
    if (args === 'disable') return { text: await disableCollection($) }
    return { text: '用法：/prompt-history [enable|disable|status]' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    if (!runtimeTarget) return next(e)

    let currentProject: ProjectState
    try {
      currentProject = await prepareProject($)
    } catch {
      /* A Run that is already known to be disabled collects nothing, so there
         is nothing to miss and nothing to block. */
      if (runMode?.value.mode === 'disabled') return next(e)
      if (project?.consent === 'enabled') {
        return { drop: 'Prompt Trail 无法证明当前项目身份；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    /* A disabled Run lets the submission through untouched: no Pending Capture,
       no Prompt Entry, and no archive block standing in its way. */
    let mode: RunModeState
    try {
      mode = (await loadRunMode($, currentProject)).value
    } catch {
      if (currentProject.consent === 'enabled') {
        return { drop: 'Prompt Trail 无法读取当前 Run collection mode；为避免漏记，本次提交已阻止。' }
      }
      return next(e)
    }
    if (mode.mode === 'disabled') return next(e)

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

    /* Anything unresolved is settled before another capture is staged, so a
       second pending can never pile onto the first. This runs ahead of the
       archive block, because a pending the archive still holds is exactly what
       an earlier uncertain failure may have left behind — blocking on the flag
       first would make it unreachable forever. */
    let settled: 'clear' | 'settled' | 'blocked'
    try {
      settled = await settlePending($, currentProject)
    } catch {
      await markArchiveUnavailable($, currentProject)
      const restored = await restoreDraft($, e.text)
      return {
        drop: `Prompt Trail 无法读取未决的 Pending Capture，${draftNote(restored)}；为避免漏记，本次提交已阻止。`,
      }
    }
    if (settled !== 'clear') {
      /* A submission that met a reconciliation is never sent on the person's
         behalf, whether or not it succeeded: the draft goes back and they
         press Enter again. */
      const restored = await restoreDraft($, e.text)
      return {
        drop: settled === 'settled'
          ? `Prompt Trail 已完成对账，${draftNote(restored)}；请重新提交。`
          : `Prompt Trail 仍有未决的 Pending Capture 待对账，${draftNote(restored)}；本次提交未进入会话。`,
      }
    }

    if (archiveUnavailable) {
      return { drop: 'Prompt Trail 档案当前不可用；为避免漏记，本次提交已阻止。' }
    }

    let branch: { key: string; value: BranchState }
    const eventId = crypto.randomUUID()
    const attachmentKinds = e.attachments?.map(attachment => attachment.type) ?? []
    try {
      branch = await branchState($, currentProject)
      await beginCapture(
        $,
        currentProject,
        branch.value,
        eventId,
        await $.clock.now(),
        e.text,
        attachmentKinds,
      )
    } catch {
      /* The helper may have committed the pending row and died before saying
         so, so this Run stops trusting its earlier "nothing owed" answer and
         asks the archive again on the next submission. */
      pendingDiscovered = false
      await markArchiveUnavailable($, currentProject)
      const restored = await restoreDraft($, e.text)
      return {
        drop: `Prompt Trail 无法预写 Pending Capture，${draftNote(restored)}；本次提交未进入会话。`,
      }
    }

    let result
    try {
      result = await next(e)
    } catch (error) {
      /* The capture is staged and the submission's fate is unknown, so the
         pending must be rediscoverable rather than sealed behind the flag. */
      pendingDiscovered = false
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

    /* `/prompt-history disable` runs immediately, so it can land while this
       submission is still in flight. The stop boundary says later prompts were
       not recorded, so a capture the stop overtook is discarded rather than
       archived inside the disabled interval. */
    let stillCollecting = true
    try {
      stillCollecting = (await loadRunMode($, currentProject)).value.mode === 'enabled'
    } catch {
      stillCollecting = false
    }
    if (!stillCollecting) {
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
      timeline = [
        ...timeline,
        {
          kind: 'prompt',
          eventId,
          sequence,
          text: finalText,
          attachmentCount: attachmentKinds.length,
        },
      ]
      $.ui.invalidate('ui.render')
    } catch {
      /* The prompt did enter the session, so the pending is kept rather than
         dropped, and this Run collects nothing further until the outcome is
         settled. The final text stays in memory so a reconciliation in this
         module instance can still archive exactly what entered. */
      await saveReconcile(
        $,
        currentProject,
        {
          version: 1,
          eventId,
          runId: startup.runId ?? branch.value.branchId,
          branchId: branch.value.branchId,
          parentEventId: branch.value.parentEventId,
          attachmentCount: attachmentKinds.length,
        },
        finalText,
      )
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
    /* The displayed number counts Prompt Entries only, so a boundary drawn in
       between never consumes a position in the session-level numbering. */
    let position = 0
    const rows = [...timeline]
      .sort((left, right) => left.sequence - right.sequence)
      .map(item => ({
        item,
        position: item.kind === 'prompt' ? (position += 1) : 0,
      }))
    return (
      <Box flexDirection="column">
        <Button
          key="prompt-trail:toggle"
          plain
          label="▾ Prompt Trail"
          onPress={toggle}
        />
        {rows.length === 0 ? (
          <Text dimColor>尚无 Prompt Entry</Text>
        ) : rows.map(row => (
          <Text
            key={`prompt-trail:${row.item.kind}:${row.item.eventId}`}
            wrap="truncate-end"
            {...(row.item.kind === 'boundary' ? { dimColor: true } : {})}
          >
            {row.item.kind === 'boundary'
              ? boundaryLine(row.item.boundary)
              : `${row.position}. ${entryLine(row.item)}`}
          </Text>
        ))}
      </Box>
    )
  })
}
