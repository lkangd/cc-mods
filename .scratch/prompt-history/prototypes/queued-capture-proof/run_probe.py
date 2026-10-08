import argparse
import json
import os
import pathlib
import re
import shutil
import signal
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[4] / 'mods' / 'prompt-history'
SCRATCH = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'release'))
import evidence
import pty_driver
import pty_scenarios
from release_evidence import keychain_token


def labels(value):
    return sorted({label[5:] for label in re.findall(r'PT35-[A-Z0-9-]+', json.dumps(value, ensure_ascii=False))})


def transcript(ctx):
    found = []
    for _, text in ctx.transcripts():
        for line in text.splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get('type') not in ('queue-operation', 'user', 'attachment'):
                continue
            item = {key: row[key] for key in ('type', 'operation', 'uuid', 'parentUuid', 'isMeta', 'isSidechain') if key in row}
            item.update(labels=labels(row))
            found.append(item)
    return found


def observations(env):
    path = env.config / 'queue-probe.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def deadline(*_):
    raise TimeoutError('five-minute probe deadline')


def run(version):
    token = keychain_token()
    markers = ['PT35-BOOT-002', 'PT35-HOLD-003', 'PT35-DUP-002', 'PT35-AFTER-002']
    scanner = evidence.Scanner(markers, secrets=[token])
    output = pathlib.Path(tempfile.mkdtemp(prefix='pt35-stage2-'))
    env = pty_driver.Environment(pty_driver.Host(version), scanner, token, ROOT)
    ctx = pty_scenarios.Context(env, scanner)
    report = {'version': version, 'checkpoints': [], 'reservedComposerInputs': 0}
    prior_handler = signal.signal(signal.SIGALRM, deadline)
    signal.alarm(300)

    def send(text, *, idle=False, consent=False):
        # Reserve an extra invocation for the collection-consent path.
        cost = 2 if consent else 1
        if report['reservedComposerInputs'] + cost > 6:
            raise RuntimeError('six-input probe budget exhausted')
        report['reservedComposerInputs'] += cost
        if idle:
            ctx.submit(t, text, consent=consent)
        else:
            ctx.send(t, text)

    def checkpoint(name):
        report['checkpoints'].append({'at': name, 'transcript': transcript(ctx)})

    try:
        reader_path = env.config / 'queue_observer_reader.py'
        shutil.copyfile(SCRATCH / 'journal_reader.py', reader_path)
        os.chmod(reader_path, 0o600)
        t = env.launch(plugins=[SCRATCH / 'queue-probe'], lines=60)
        ctx.start(t)
        send('PT35-BOOT-002 只回复 OK', idle=True, consent=True)
        send('PT35-HOLD-003 请详细解释 JavaScript Promise、事件循环和 async/await，并给出两个例子。')
        t.wait_for('esc to interrupt', 'initial turn running', 30)
        duplicate = 'PT35-DUP-002 请详细解释 JavaScript 微任务和宏任务的区别，并给出两个例子。'
        # Do not wait for observer completion between the duplicate inputs.
        send(duplicate)
        send(duplicate)
        checkpoint('duplicates.sent')
        t.wait_for(lambda _: any(row['type'] == 'user' and 'DUP-002' in row['labels']
                                for row in transcript(ctx)), 'first duplicate user row', 120)
        current = transcript(ctx)
        if sum(row['type'] == 'user' and 'DUP-002' in row['labels'] for row in current) != 1:
            raise RuntimeError('partial-withdrawal window not observed; no retry')
        t.key('up')
        t.wait_for(lambda _: any(row.get('operation') == 'popAll' and 'DUP-002' in row['labels']
                                for row in transcript(ctx)), 'remaining duplicate withdrawn', 30)
        checkpoint('partial.withdraw')
        t.key(*(['backspace'] * (len(duplicate) + 16)), pause=0.01)
        t.wait_idle()
        send('PT35-AFTER-002 只回复 OK', idle=True)
        checkpoint('after.withdraw')
        report['outcome'] = 'observed-not-repair-pass'
    except Exception as error:
        report['error'] = type(error).__name__
        report['outcome'] = 'inconclusive'
        if isinstance(error, TimeoutError):
            for terminal in env.terminals:
                try:
                    terminal.kill()
                except (ProcessLookupError, ChildProcessError):
                    pass
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, prior_handler)
        try:
            for terminal in env.terminals:
                if not getattr(terminal, 'reaped', False):
                    try:
                        terminal.kill()
                    except (ProcessLookupError, ChildProcessError):
                        pass
            try:
                report['observations'] = observations(env)
            except (OSError, ValueError):
                report['observations'] = []
                report['error'] = 'observation-read-failed'
                report['outcome'] = 'inconclusive'
            report['endBoundary'] = {'checkpoint': 'after-host-termination', 'observerDrained': False, 'atomicHostSnapshot': False}
        finally:
            report['privacy'] = env.finish()
        path = output / ('queue-probe-stage2-' + version + '.json')
        with path.open('x') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.chmod(path, 0o600)
        print(json.dumps({'version': version, 'outcome': report['outcome'],
                          'leaks': len(report['privacy']['leaks']), 'temporaryReport': str(path)}), flush=True)
    return 1 if 'error' in report or report['privacy']['leaks'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Bounded isolated PTY probe; requires fresh model-call authorization.')
    parser.add_argument('version', choices=('2.1.273', '2.1.283'))
    parser.add_argument('--run-authorized-pty', action='store_true')
    args = parser.parse_args()
    if not args.run_authorized_pty:
        parser.error('model calls require explicit authorization and --run-authorized-pty')
    raise SystemExit(run(args.version))
