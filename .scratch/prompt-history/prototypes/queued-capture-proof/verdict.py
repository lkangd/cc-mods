"""The unbound proof boundary exposed by the two probed hosts.

No verified capture-to-queue receipt exists yet. This prototype therefore
returns only waiting/ambiguous, never entered/withdrawn. It neither archives
entries nor claims that an ordered-journal identity adapter is implemented.
"""


def adjudicate(observation):
    changed = observation['users'] != observation['prefix']
    terminal = any(row['operation'] != 'enqueue' for row in observation['operations'])
    state = 'ambiguous' if changed or terminal or not observation['complete'] else 'waiting'
    return [
        {'eventId': capture['eventId'], 'state': state if capture['finalReady'] else 'ambiguous'}
        for capture in observation['captures']
    ]
