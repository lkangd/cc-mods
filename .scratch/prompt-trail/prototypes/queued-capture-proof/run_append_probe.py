"""Bounded isolated PTY probe for the 2026-10-06 plan: on 2.1.290, which
session.append rows a composer submission leaves, and when, against
prompt.submit. One host start, at most six composer inputs (consent counts
twice), a five-minute hard deadline, no retry. Records structure only."""

import argparse
import json
import os
import pathlib
import re
import signal
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[4] / 'mods' / 'prompt-trail'
SCRATCH = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'release'))
import evidence
import pty_driver
import pty_scenarios
from release_evidence import keychain_token

VERSION = '2.1.290'


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
            item = {key: row[key] for key in ('type', 'operation', 'isMeta', 'isSidechain') if key in row}
            attachment = row.get('attachment')
            if isinstance(attachment, dict) and 'type' in attachment:
                item['attachmentType'] = attachment['type']
            item['labels'] = labels(row)
            found.append(item)
    return found


def observations(env):
    path = env.config / 'append-probe.jsonl'
    rows = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    return sorted(rows, key=lambda row: row['sequence'])


def deadline(*_):
    raise TimeoutError('five-minute probe deadline')


def entered(ctx, label):
    return any(row['type'] != 'queue-operation' and label in row['labels'] for row in transcript(ctx))


def operation(ctx, name, label):
    return any(row.get('operation') == name and label in row['labels'] for row in transcript(ctx))


def run():
    token = keychain_token()
    markers = ['PT35-BOOT-003', 'PT35-HOLD-004', 'PT35-QA-001', 'PT35-QB-001']
    scanner = evidence.Scanner(markers, secrets=[token])
    output = pathlib.Path(tempfile.mkdtemp(prefix='pt35-stage3-'))
    env = pty_driver.Environment(pty_driver.Host(VERSION), scanner, token, ROOT)
    ctx = pty_scenarios.Context(env, scanner)
    report = {'version': VERSION, 'checkpoints': [], 'reservedComposerInputs': 0, 'reached': []}
    prior_handler = signal.signal(signal.SIGALRM, deadline)
    signal.alarm(300)

    def send(text, *, idle=False, consent=False):
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
        t = env.launch(plugins=[SCRATCH / 'append-probe'], lines=60)
        ctx.start(t)
        # 1. An idle submission: is its composer row stored before next(e) resolves?
        send('PT35-BOOT-003 只回复 OK', idle=True, consent=True)
        checkpoint('idle.done')
        report['reached'].append('idle')
        # 2. A long turn, then a submission queued behind it, left to dequeue.
        send('PT35-HOLD-004 请详细解释 JavaScript Promise、事件循环和 async/await，并给出两个例子。')
        t.wait_for('esc to interrupt', 'hold turn running', 30)
        send('PT35-QA-001 请详细解释 JavaScript 微任务和宏任务的区别，并给出三个例子。')
        t.wait_for(lambda _: operation(ctx, 'enqueue', 'QA-001'), 'QA enqueued', 30)
        t.wait_for(lambda _: entered(ctx, 'QA-001'), 'QA entered the conversation', 150)
        checkpoint('queued.entered')
        report['reached'].append('dequeue')
        # 3. Another queued submission, withdrawn with the up arrow.
        b = 'PT35-QB-001 只回复 OK'
        send(b)
        t.wait_for(lambda _: operation(ctx, 'enqueue', 'QB-001'), 'QB enqueued', 30)
        t.key('up')
        t.wait_for(lambda _: operation(ctx, 'popAll', 'QB-001'), 'QB withdrawn', 30)
        t.key(*(['backspace'] * (len(b) + 16)), pause=0.01)
        t.wait_idle()
        checkpoint('withdrawn.idle')
        report['reached'].append('withdraw')
        report['outcome'] = 'observed'
    except Exception as error:
        report['error'] = type(error).__name__
        report['errorDetail'] = str(error)[:200]
        report['outcome'] = 'inconclusive'
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
        finally:
            report['privacy'] = env.finish()
        path = output / ('append-probe-' + VERSION + '.json')
        with path.open('x') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.chmod(path, 0o600)
        print(json.dumps({'version': VERSION, 'outcome': report['outcome'], 'reached': report['reached'],
                          'leaks': len(report['privacy']['leaks']), 'temporaryReport': str(path)}), flush=True)
    return 1 if 'error' in report or report['privacy']['leaks'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Bounded isolated 2.1.290 session.append probe; requires authorization.')
    parser.add_argument('--run-authorized-pty', action='store_true')
    args = parser.parse_args()
    if not args.run_authorized_pty:
        parser.error('model calls require explicit authorization and --run-authorized-pty')
    raise SystemExit(run())
