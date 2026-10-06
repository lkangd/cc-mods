"""Behavioral tests of the current hosts' unbound observation boundary.

IDs below are synthetic metadata fixtures, not claimed host identity receipts.
The prototype intentionally cannot confirm or discard an unbound capture.
"""
import unittest

from verdict import adjudicate


def observation():
    return {
        'captures': [{'eventId': 'c1', 'finalReady': True, 'textDigest': 'digest-a'}],
        'prefix': [{'id': 'u0', 'source': 'composer', 'textDigest': 'digest-a'}],
        'users': [{'id': 'u0', 'source': 'composer', 'textDigest': 'digest-a'}],
        'operations': [{'id': 'q1', 'operation': 'enqueue'}],
        'complete': True,
    }


class QueuedCaptureProof(unittest.TestCase):
    def test_successful_queue_delivery_remains_waiting_without_a_new_human_row(self):
        self.assertEqual(adjudicate(observation()), [{'eventId': 'c1', 'state': 'waiting'}])

    def test_new_same_text_row_cannot_confirm_a_capture_without_identity_proof(self):
        current = observation()
        current['operations'].append({'id': 'd1', 'operation': 'dequeue'})
        current['users'].append({'id': 'u1', 'source': 'composer', 'textDigest': 'digest-a'})
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_pop_all_without_a_capture_queue_binding_cannot_discard_it(self):
        current = observation()
        current['operations'].append({'id': 'p1', 'operation': 'popAll'})
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_rewind_or_replaced_prefix_is_not_a_waiting_capture(self):
        for rows in ([], [{'id': 'different', 'source': 'composer', 'textDigest': 'digest-a'}]):
            with self.subTest(rows=rows):
                current = observation()
                current['users'] = rows
                self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_missing_final_text_proof_cannot_be_treated_as_healthy_waiting(self):
        current = observation()
        current['captures'][0]['finalReady'] = False
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_missing_journal_boundary_is_not_proof_of_waiting(self):
        current = observation()
        current['complete'] = False
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_unchanged_row_id_with_changed_text_is_not_an_unchanged_prefix(self):
        current = observation()
        current['users'][0]['textDigest'] = 'changed-digest'
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_unrecognized_queue_operation_cannot_be_ignored(self):
        current = observation()
        current['operations'].append({'id': 'unknown', 'operation': 'unrecognized'})
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_two_identical_qualifications_are_not_collapsed_when_proof_is_missing(self):
        current = observation()
        current['captures'].append({'eventId': 'c2', 'finalReady': True, 'textDigest': 'digest-a'})
        current['users'] += [
            {'id': 'u1', 'source': 'composer', 'textDigest': 'digest-a'},
            {'id': 'u2', 'source': 'composer', 'textDigest': 'digest-a'},
        ]
        self.assertEqual(adjudicate(current), [
            {'eventId': 'c1', 'state': 'ambiguous'},
            {'eventId': 'c2', 'state': 'ambiguous'},
        ])

    def test_an_ignored_partial_tail_does_not_discard_a_waiting_capture(self):
        current = observation()
        current['partialTailIgnored'] = True
        self.assertEqual(adjudicate(current), [{'eventId': 'c1', 'state': 'waiting'}])


if __name__ == '__main__':
    unittest.main()
