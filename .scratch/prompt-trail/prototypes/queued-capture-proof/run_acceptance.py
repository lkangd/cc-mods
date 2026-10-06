"""Post-fix PTY acceptance for Issue 35 (authorized 2026-10-06): the formal
plugin alone on 2.1.290, in an isolated world. A queued prompt withdrawn with
the up arrow leaves no Prompt Entry and no new branch; a queued prompt of the
same text as the running one, taken from the queue, is archived once settled
as entered, under the right parent. One host start, at most eight composer
submissions (dialog choices are the scenario's own steps and not counted),
a ten-minute hard deadline, no retry. Records structure only."""

import argparse
import json
import os
import pathlib
import re
import signal
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[4] / 'mods' / 'prompt-trail'
sys.path.insert(0, str(ROOT / 'release'))
import evidence
import pty_driver
import pty_scenarios
from release_evidence import keychain_token

VERSION = '2.1.290'
A = 'PT35-ACC-A 请详细解释 JavaScript Promise、事件循环和 async/await，并给出两个例子。'
QB = 'PT35-ACC-QB 只回复 OK'
N1 = 'PT35-ACC-N1 请详细解释 JavaScript 微任务和宏任务的区别，并给出三个例子。'
N2 = 'PT35-ACC-N2 只回复 OK'
MARKERS = ['PT35-ACC-A', 'PT35-ACC-QB', 'PT35-ACC-N1', 'PT35-ACC-N2']


def label(text):
    return next((m[5:] for m in MARKERS if text and m in text), None)


def deadline(*_):
    raise TimeoutError('ten-minute acceptance deadline')


def run():
    token = keychain_token()
    scanner = evidence.Scanner(MARKERS, secrets=[token])
    output = pathlib.Path(tempfile.mkdtemp(prefix='pt35-acceptance-'))
    env = pty_driver.Environment(pty_driver.Host(VERSION), scanner, token, ROOT)
    ctx = pty_scenarios.Context(env, scanner)
    report = {'version': VERSION, 'submissions': 0, 'dialogChoices': 0, 'checks': [], 'reached': []}
    prior_handler = signal.signal(signal.SIGALRM, deadline)
    signal.alarm(600)

    def send(text):
        if report['submissions'] + 1 > 8:
            raise RuntimeError('eight-submission budget exhausted')
        report['submissions'] += 1
        ctx.send(t, text)

    def choose(option):
        report['dialogChoices'] += 1
        ctx.choose(t, option)

    def check(condition, what):
        report['checks'].append({'check': what, 'ok': bool(condition)})
        pty_scenarios.check(condition, what)

    def rows_of(text, *, queued):
        """Transcript rows holding the text: queue operations, or human user rows."""
        count = 0
        for _, body in ctx.transcripts():
            for line in body.splitlines():
                if text not in line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if queued and row.get('type') == 'queue-operation':
                    count += 1
                elif not queued and row.get('type') == 'user' and row.get('isMeta') is not True:
                    count += 1
        return count

    def queue_operation(name, text):
        for _, body in ctx.transcripts():
            for line in body.splitlines():
                if text in line and f'"operation":"{name}"' in line.replace(' ', ''):
                    return True
        return False

    def options():
        pattern = re.compile(r'^\s*(?:❯)?\s*\d+\. (已进入|未进入|新根分支)$')
        return [m.group(1) for m in map(pattern.match, t.rows()) if m]

    def draft():
        return t.rows()[pty_scenarios._prompt_box(t)]

    def entries():
        return [{'label': label(e['promptText']), 'eventId': e['eventId'], 'parent': e['parentEventId'],
                 'branchId': e['branchId'], 'sequence': e['sequence']} for e in ctx.entries()]

    try:
        t = env.launch(lines=60)
        ctx.start(t)

        # 1. A long turn, consented on its first prompt.
        send(A)
        t.wait_for('采集同意', 'the consent question', 30)
        choose('启用')
        t.wait_for('esc to interrupt', 'A running', 30)
        ctx.wait_entries(1)
        report['reached'].append('A running')

        # 2. QB queued behind it, then withdrawn with the up arrow.
        send(QB)
        t.wait_for(lambda _: queue_operation('enqueue', QB), 'QB enqueued', 30)
        # The host writes enqueue before prompt.submit reaches the hooks
        # (ticket, 2026-10-01), so the staged pending is waited for.
        staged = t.wait_for(lambda _: [label(p['promptText']) for p in ctx.pending()] or None,
                            'the queued prompt to be staged', 15)
        check(staged == ['ACC-QB'], 'the queued prompt is a Pending Capture')
        t.key('up')
        t.wait_for(lambda _: queue_operation('popAll', QB), 'QB withdrawn', 30)
        t.key(*(['backspace'] * (len(QB) + 16)), pause=0.01)
        t.wait_idle(timeout=180)
        env.snap(t, 'A done, QB withdrawn')
        check(rows_of(QB, queued=False) == 0, 'the withdrawn prompt has no transcript row')
        check([e['label'] for e in entries()] == ['ACC-A'], 'only A is archived after the withdrawal')
        report['reached'].append('withdrawn')

        # 3. The next idle submission settles it; it cannot have entered.
        send(N1)
        t.wait_for('有一条未决的 Pending Capture', 'the reconcile dialog', 30)
        env.snap(t, 'withdrawn dialog')
        check(sorted(options()) == ['新根分支', '未进入'], 'the withdrawn prompt is offered only 未进入 / 新根分支')
        check('此后宿主存储了 0 条 composer 行' in t.text(), 'the dialog states that no composer row was stored')
        choose('未进入')
        t.wait_for('已完成对账', 'the reconciliation notice', 30)
        check(not ctx.pending(), 'no pending is left after 未进入')
        check('ACC-N1' in draft(), 'the new prompt came back as a draft')
        report['reached'].append('settled not entered')

        # 4. Sent again, it is a long turn of its own.
        if report['submissions'] + 1 > 8:
            raise RuntimeError('eight-submission budget exhausted')
        report['submissions'] += 1
        t.key('enter')
        t.wait_for('esc to interrupt', 'N1 running', 30)
        ctx.wait_entries(2)
        found = entries()
        check([e['label'] for e in found] == ['ACC-A', 'ACC-N1'], 'A then N1 are archived')
        check(found[1]['parent'] == found[0]['eventId'] and found[1]['branchId'] == found[0]['branchId'],
              'N1 goes on from A on the same branch: no rewind, no new branch')
        report['reached'].append('N1 running')

        # 5. The same text again, queued behind it and taken from the queue.
        send(N1)
        t.wait_for(lambda _: queue_operation('enqueue', N1), 'the repeat enqueued', 30)
        t.wait_for(lambda _: rows_of(N1, queued=False) >= 2, 'the repeat entered the conversation', 240)
        t.wait_idle(timeout=240)
        env.snap(t, 'repeat done')
        check(len(entries()) == 2, 'the dequeued repeat is not archived before it is settled')
        check(len(ctx.pending()) == 1 and label(ctx.pending()[0]['promptText']) == 'ACC-N1',
              'the dequeued repeat stays a Pending Capture')
        report['reached'].append('dequeued')

        # 6. The next idle submission settles it as entered.
        send(N2)
        t.wait_for('有一条未决的 Pending Capture', 'the reconcile dialog', 30)
        env.snap(t, 'dequeued dialog')
        check(sorted(options()) == ['已进入', '新根分支', '未进入'], 'the dequeued prompt is offered all three choices')
        check('此后宿主存储了 1 条 composer 行' in t.text(), 'the dialog states one composer row was stored')
        choose('已进入')
        t.wait_for('已完成对账', 'the reconciliation notice', 30)
        found = entries()
        check([e['label'] for e in found] == ['ACC-A', 'ACC-N1', 'ACC-N1'], 'the repeat is archived once, after N1')
        check(found[2]['parent'] == found[1]['eventId'] and found[2]['branchId'] == found[0]['branchId'],
              'the repeat goes on from N1 on the same branch')
        check(not ctx.pending(), 'no pending is left after 已进入')
        check('ACC-N2' in draft(), 'N2 came back as a draft')
        report['reached'].append('settled entered')
        report['outcome'] = 'passed'
    except Exception as error:
        report['error'] = type(error).__name__
        report['errorDetail'] = str(error)[:200]
        report['outcome'] = 'failed'
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, prior_handler)
        try:
            report['entries'] = [{k: v for k, v in e.items() if k == 'label'} for e in entries()]
            report['pending'] = [label(p['promptText']) for p in ctx.pending()]
        except Exception:
            report['entries'] = 'unreadable'
        trace = env.trace
        report['privacy'] = env.finish()
        path = output / ('acceptance-' + VERSION + '.json')
        with path.open('x') as stream:
            json.dump({**report, 'trace': trace}, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.chmod(path, 0o600)
        print(json.dumps({k: v for k, v in report.items()}, ensure_ascii=False), flush=True)
        print(json.dumps({'temporaryReport': str(path)}), flush=True)
    return 0 if report['outcome'] == 'passed' and not report['privacy']['leaks'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Issue 35 post-fix PTY acceptance on 2.1.290; requires authorization.')
    parser.add_argument('--run-authorized-pty', action='store_true')
    args = parser.parse_args()
    if not args.run_authorized_pty:
        parser.error('model calls require explicit authorization and --run-authorized-pty')
    raise SystemExit(run())
