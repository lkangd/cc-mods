"""Replay sanitized probe snapshots through the public unbound proof boundary."""
import json
import pathlib
import sys

from verdict import adjudicate


def replay(report):
    calls = {}
    gaps = set()
    for observation in report['observations']:
        if observation.get('samplerFailures', 0):
            gaps.add('observation-write-failure')
        if observation.get('origin', {}).get('kind') != 'composer':
            continue
        if observation['phase'] not in ('submit.before', 'submit.after'):
            continue
        if not observation.get('observationId') or not observation.get('epoch'):
            gaps.add('unpaired-submission')
            continue
        key = observation['epoch'] + ':' + observation['observationId']
        phases = calls.setdefault(key, {})
        if observation['phase'] in phases:
            gaps.add('duplicate-observation')
            phases['duplicate'] = True
        phases[observation['phase']] = observation
    captures = []
    for key, phases in sorted(calls.items()):
        if 'submit.before' not in phases or 'submit.after' not in phases:
            gaps.add('unpaired-submission')
        if 'submit.before' in phases:
            after = phases.get('submit.after', {})
            captures.append({
                'eventId': key,
                'finalReady': bool(after.get('resultTextDigest')) and not after.get('result', {}).get('dropped')
                and not phases.get('duplicate', False),
            })
    journals = [journal for observation in report['observations']
                for journal in observation.get('journals', [])]
    journal_gaps = set()
    if not journals:
        journal_gaps.add('journal-unavailable')
    for journal in journals:
        if not (journal.get('complete') and journal.get('readStable') and journal.get('prefixDigest')):
            journal_gaps.add('unproven-read-boundary')
        journal_gaps.update(journal.get('gaps', []))
    return {
        'version': report['version'], 'captures': captures, 'gaps': sorted(gaps),
        'journalGaps': sorted(journal_gaps), 'analysisStatus': 'indeterminate',
        'contractStatus': 'unbound',
        'contractGaps': ['submit-enqueue-contract-missing', 'baseline-unproven', 'active-path-unproven'],
        'safe': adjudicate({
            'captures': captures, 'prefix': [], 'users': [], 'operations': [], 'complete': False,
        }),
        'observedCounts': {
            'composerAfter': sum(o.get('phase') == 'submit.after' and o.get('origin', {}).get('kind') == 'composer'
                                 for o in report['observations']),
            'queuedReturns': sum(o.get('phase') == 'submit.after' and bool(o.get('turnId'))
                                 and o.get('origin', {}).get('kind') == 'composer' for o in report['observations']),
            'journalSnapshots': len(journals),
        },
        'leakCount': len(report['privacy']['leaks']),
    }


if __name__ == '__main__':
    for path in sys.argv[1:]:
        print(json.dumps(replay(json.loads(pathlib.Path(path).read_text())), ensure_ascii=False))
