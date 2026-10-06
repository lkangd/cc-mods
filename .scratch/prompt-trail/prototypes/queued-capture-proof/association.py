"""Conditional FIFO study. Its witnesses are not host identity receipts."""
from itertools import permutations

ASSUMPTIONS = [
    'empty-known-baseline', 'no-hidden-ingress', 'capture-enqueue-bijection',
    'fifo-dequeue', 'dequeue-user-bijection', 'dequeue-user-order', 'composer-only-new-users',
]


def analyze(observation):
    result = {
        'analysisStatus': 'indeterminate', 'mappingCount': None, 'witnesses': [],
        'safe': [{'eventId': capture['eventId'], 'state': 'ambiguous'}
                 for capture in observation['captures']],
        'contractStatus': 'hypothesis-only', 'assumptions': list(ASSUMPTIONS), 'reasons': [],
    }
    if any(capture.get('origin') != 'composer' or not capture['finalReady']
           for capture in observation['captures']):
        result['reasons'].append('ineligible-or-unready')
        return result
    prefix = observation['prefix']
    if (not observation['complete'] or observation.get('baseline') != []
            or observation['users'][:len(prefix)] != prefix):
        result['reasons'].append('unproven-boundary')
        return result
    if (any(row['kind'] not in ('enqueue', 'dequeue', 'popAll', 'user')
            or row.get('origin', 'composer') != 'composer' for row in observation['records'])
            or any(row.get('source') != 'composer' for row in observation['users'][len(prefix):])):
        result['reasons'].append('unmodeled-record')
        return result
    enqueues = [row for row in observation['records'] if row['kind'] == 'enqueue']
    if len(observation['captures']) > 3 or len(enqueues) > 3 or len(observation['records']) > 12:
        result['reasons'].append('capacity')
        return result
    if len(enqueues) != len(observation['captures']):
        result['reasons'].append('incomplete-ingress')
        return result
    if ([row['id'] for row in observation['records'] if row['kind'] == 'user']
            != [row['id'] for row in observation['users'][len(prefix):]]):
        result.update(analysisStatus='inconsistent', mappingCount=0)
        result['reasons'].append('contradictory-model')
        return result
    capture_ids = [capture['eventId'] for capture in observation['captures']]
    enqueue_ids = [row['id'] for row in enqueues]
    user_ids = [row['id'] for row in observation['users']]
    if (len(set(capture_ids)) != len(capture_ids) or len(set(enqueue_ids)) != len(enqueue_ids)
            or len(set(user_ids)) != len(user_ids)
            or ('captureOrder' in observation and sorted(observation['captureOrder']) != sorted(capture_ids))):
        result.update(analysisStatus='inconsistent', mappingCount=0)
        result['reasons'].append('contradictory-model')
        return result
    queue, in_flight, outcomes = [], [], {}
    for row in observation['records']:
        if ((row['kind'] == 'dequeue' and not queue)
                or (row['kind'] == 'user' and not in_flight)):
            result.update(analysisStatus='inconsistent', mappingCount=0)
            result['reasons'].append('contradictory-model')
            return result
        if row['kind'] == 'enqueue':
            queue.append(row['id'])
            outcomes[row['id']] = {'queueId': row['id'], 'userId': None, 'state': 'waiting'}
        elif row['kind'] == 'dequeue':
            in_flight.append(queue.pop(0))
        elif row['kind'] == 'user':
            outcomes[in_flight.pop(0)].update(userId=row['id'], state='entered')
        elif row['kind'] == 'popAll':
            for key in queue:
                outcomes[key]['state'] = 'withdrawn'
            queue.clear()
    witnesses = []
    budget = min(observation.get('maxSearchBranches', 128), 128)
    for branch, order in enumerate(permutations(outcomes.values())):
        if branch >= budget:
            result.update(mappingCountLowerBound=len(witnesses), witnesses=witnesses[:2])
            result['reasons'].append('capacity')
            return result
        witness = {capture['eventId']: outcome for capture, outcome in zip(observation['captures'], order)}
        if 'captureOrder' in observation:
            if [witness[key]['queueId'] for key in observation['captureOrder']] != list(outcomes):
                continue
        witnesses.append(witness)
    result.update(
        analysisStatus='unique' if len(witnesses) == 1 else 'multiple',
        mappingCount=len(witnesses), witnesses=witnesses[:2],
    )
    return result
