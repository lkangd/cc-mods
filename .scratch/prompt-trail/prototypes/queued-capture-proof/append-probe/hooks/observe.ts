/* Structure-only observer for the 2026-10-06 session.append probe: which rows
   a composer submission leaves, and in what order against prompt.submit.
   Never records prompt text, raw uuids or paths; PT35 markers are reduced to
   their suffix so the scanner's full markers never appear. */

const labels = (value: unknown): string[] => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return [...new Set(text.match(/PT35-[A-Z0-9-]+/g) ?? [])].map(label => label.slice(5))
}

const writer = `import fcntl,os,pathlib,sys
base=pathlib.Path(os.environ['CLAUDE_CONFIG_DIR'])
fd=os.open(base/'append-probe.jsonl',os.O_CREAT|os.O_WRONLY|os.O_APPEND,0o600)
with os.fdopen(fd,'a') as f:
 fcntl.flock(f,fcntl.LOCK_EX)
 f.write(sys.stdin.read()+'\\n')
 f.flush()
`

let sequence = 0
let calls = 0
let openCalls = 0
const rowIds = new Map<string, string>()

/* A stable short alias per row uuid, so rows can be matched across records
   without the uuid itself leaving the process. */
function alias(uuid: unknown): string | undefined {
  if (typeof uuid !== 'string') return undefined
  let found = rowIds.get(uuid)
  if (!found) {
    found = 'row-' + (rowIds.size + 1)
    rowIds.set(uuid, found)
  }
  return found
}

function record($: any, entry: Record<string, unknown>): void {
  const line = JSON.stringify({ sequence: ++sequence, openCalls, ...entry })
  void $.process.run(['/usr/bin/python3', '-c', writer], { stdin: line }).catch(() => undefined)
}

function rowShape(e: any) {
  const message = e.message ?? {}
  return {
    door: e.door,
    origin: e.origin?.kind,
    originDetail: e.origin && e.origin.kind !== 'composer' ? Object.keys(e.origin) : undefined,
    type: message.type,
    name: message.name,
    role: message.role,
    isMeta: message.isMeta === true,
    agent: typeof e.agentId === 'string',
    blocks: Array.isArray(message.content) ? message.content.map((block: any) => block?.type) : undefined,
    labels: labels(message.content),
  }
}

const WATCHED_DOORS = new Set(['prompt', 'command', 'delivery', 'attachment'])

export function register(on: any) {
  on('prompt.submit', async ($: any, e: any, next: any) => {
    const call = 'call-' + ++calls
    openCalls++
    record($, {
      phase: 'submit.before', call, origin: e.origin?.kind,
      turnId: typeof e.turnId === 'string', wait: e.wait, labels: labels(e.text),
    })
    try {
      const result = await next(e)
      openCalls--
      record($, {
        phase: 'submit.after', call, entered: typeof result?.text === 'string',
        dropped: typeof result?.drop === 'string', labels: labels(result?.text),
      })
      return result
    } catch (error) {
      openCalls--
      record($, { phase: 'submit.error', call })
      throw error
    }
  })

  on('session.append', async ($: any, e: any, next: any) => {
    const watched = WATCHED_DOORS.has(e.door)
    if (watched) record($, { phase: 'append.before', row: alias(e.uuid), ...rowShape(e) })
    const result = await next(e)
    if (watched) {
      record($, {
        phase: 'append.after', row: alias(result?.uuid ?? e.uuid),
        sameUuid: result?.uuid === e.uuid, denied: typeof result?.deny === 'string',
      })
    }
    return result
  })

  on('turn.start', async ($: any, e: any, next: any) => {
    record($, { phase: 'turn.start' })
    return next(e)
  })

  on('turn.complete', async ($: any, e: any, next: any) => {
    record($, { phase: 'turn.complete' })
    return next(e)
  })
}
