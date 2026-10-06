const labels = (text: unknown): string[] => typeof text === 'string'
  ? [...new Set(text.match(/PT35-[A-Z0-9-]+/g) ?? [])].map(label => label.slice(5)) : [];

function summary(rows: unknown) {
  if (!Array.isArray(rows)) return { array: false };
  return rows.map(row => ({
    keys: Object.keys(row ?? {}), role: row?.role,
    labels: labels(row?.text), textLength: typeof row?.text === 'string' ? row.text.length : undefined,
    uuid: row?.uuid, id: row?.id,
    content: Array.isArray(row?.content) ? row.content.map((block: any) => ({
      keys: Object.keys(block ?? {}), type: block?.type, labels: labels(block?.text),
      textLength: typeof block?.text === 'string' ? block.text.length : undefined,
    })) : typeof row?.content === 'string' ? { labels: labels(row.content), textLength: row.content.length } : undefined,
  }));
}

const writer = `import fcntl,json,os,pathlib,sys
base=pathlib.Path(os.environ['CLAUDE_CONFIG_DIR'])
sys.path.insert(0,str(base))
from queue_observer_reader import collect_observation
r=collect_observation(json.loads(sys.stdin.read()),base)
fd=os.open(base/'queue-probe.jsonl',os.O_CREAT|os.O_WRONLY|os.O_APPEND,0o600)
with os.fdopen(fd,'a') as f:
 fcntl.flock(f,fcntl.LOCK_EX)
 f.write(json.dumps(r)+'\\n')
 f.flush()
`;

const epoch = 'probe-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
let sequence = 0;
let callSequence = 0;
let failedSaves = 0;
let activeSaves = 0;
async function save($: any, phase: string, e: any, result?: any, observationId?: string) {
  const startedSequence = ++sequence;
  activeSaves++;
  try {
    const record = {
      sequence: startedSequence, epoch, observationId, timestamp: new Date().toISOString(),
      phase, eventKeys: Object.keys(e), samplerFailures: failedSaves, activeSaves,
      sessionId: await $.session.id(), turnId: e.turnId, wait: e.wait,
      origin: e.origin, source: e.source, labels: labels(e.text ?? e.prompt ?? e.props?.text),
      inputText: e.text ?? e.prompt ?? e.props?.text, resultText: result?.text,
      requestId: e.requestId, propsKeys: e.props ? Object.keys(e.props) : undefined,
      propsOrigin: e.props?.origin,
      identity: { id: e.id, uuid: e.uuid, promptId: e.promptId, prompt_id: e.prompt_id, messageId: e.messageId },
      classic: { sessionId: e.session_id, transcriptPath: e.transcript_path },
      result: result ? { keys: Object.keys(result), labels: labels(result.text), dropped: typeof result.drop === 'string' } : undefined,
      rows: summary(await $.session.messages()), api: summary(await $.session.messages({ as: 'api' })),
    };
    const written = await $.process.run(['/usr/bin/python3', '-c', writer], { stdin: JSON.stringify(record) });
    if (written.exitCode !== 0) failedSaves++;
  } catch {
    failedSaves++;
  } finally {
    activeSaves--;
  }
}

export function register(on: any) {
  const seen = new Set<string>();
  on('prompt.submit', async ($: any, e: any, next: any) => {
    const observationId = 'call-' + ++callSequence;
    await save($, 'submit.before', e, undefined, observationId);
    try {
      const result = await next(e);
      await save($, 'submit.after', e, result, observationId);
      return result;
    } catch (error) {
      await save($, 'submit.error', e, undefined, observationId);
      throw error;
    }
  });
  on('turn.start', async ($: any, e: any, next: any) => {
    await save($, 'turn.start.before', e);
    const result = await next(e);
    await save($, 'turn.start.after', e, result);
    return result;
  });
  on('turn.complete', async ($: any, e: any, next: any) => {
    await save($, 'turn.complete.before', e);
    return next(e);
  });
  on('classic.UserPromptSubmit', async ($: any, e: any, next: any) => {
    await save($, 'classic.submit', e);
    return next(e);
  });
  on('classic.SessionStart', async ($: any, e: any, next: any) => {
    await save($, 'classic.start', e);
    return next(e);
  });
  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, ($: any, e: any, next: any) => {
    const names = labels(e.props.text);
    const key = e.requestId + ':' + names.join(',');
    if (names.length && !seen.has(key)) {
      seen.add(key);
      $.clock.after(0, () => { void save($, 'render.user', e); });
    }
    return next(e);
  });
}
