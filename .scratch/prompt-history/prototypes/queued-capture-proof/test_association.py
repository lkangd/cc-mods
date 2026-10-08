import unittest

from association import analyze


def sample():
    return {
        'captures': [{'eventId': 'c1', 'origin': 'composer', 'finalReady': True}],
        'prefix': [], 'users': [{'id': 'u1', 'source': 'composer', 'textDigest': 'same'}],
        'records': [
            {'kind': 'enqueue', 'id': 'q1'}, {'kind': 'dequeue', 'id': 'd1'},
            {'kind': 'user', 'id': 'u1'},
        ],
        'complete': True, 'baseline': [],
    }


class ConditionalAssociation(unittest.TestCase):
    def test_single_entered_mapping_is_only_conditional(self):
        result = analyze(sample())
        self.assertEqual(result['analysisStatus'], 'unique')
        self.assertEqual(result['mappingCount'], 1)
        self.assertEqual(result['witnesses'], [
            {'c1': {'queueId': 'q1', 'userId': 'u1', 'state': 'entered'}},
        ])
        self.assertEqual(result['safe'], [{'eventId': 'c1', 'state': 'ambiguous'}])
        self.assertEqual(result['contractStatus'], 'hypothesis-only')

    def test_identical_captures_have_two_identity_mappings_even_if_both_entered(self):
        observation = sample()
        observation['captures'].append({'eventId': 'c2', 'origin': 'composer', 'finalReady': True})
        for capture in observation['captures']:
            capture['textDigest'] = 'same'
        observation['records'].insert(1, {'kind': 'enqueue', 'id': 'q2'})
        observation['records'].extend([{'kind': 'dequeue', 'id': 'd2'}, {'kind': 'user', 'id': 'u2'}])
        observation['users'].append({'id': 'u2', 'source': 'composer', 'textDigest': 'same'})
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'multiple')
        self.assertEqual(result['mappingCount'], 2)
        self.assertEqual(result['witnesses'], [
            {'c1': {'queueId': 'q1', 'userId': 'u1', 'state': 'entered'},
             'c2': {'queueId': 'q2', 'userId': 'u2', 'state': 'entered'}},
            {'c1': {'queueId': 'q2', 'userId': 'u2', 'state': 'entered'},
             'c2': {'queueId': 'q1', 'userId': 'u1', 'state': 'entered'}},
        ])

    def test_an_explicit_capture_order_only_narrows_the_hypothesis(self):
        observation = sample()
        observation['captures'].append({'eventId': 'c2', 'origin': 'composer', 'finalReady': True})
        observation['records'].insert(1, {'kind': 'enqueue', 'id': 'q2'})
        observation['records'].extend([{'kind': 'dequeue', 'id': 'd2'}, {'kind': 'user', 'id': 'u2'}])
        observation['users'].append({'id': 'u2', 'source': 'composer', 'textDigest': 'same'})
        observation.update(captureOrder=['c2', 'c1'], verified=True)
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'unique')
        self.assertEqual(result['witnesses'][0]['c2']['queueId'], 'q1')
        self.assertEqual(result['witnesses'][0]['c1']['queueId'], 'q2')
        self.assertEqual(result['safe'], [
            {'eventId': 'c1', 'state': 'ambiguous'}, {'eventId': 'c2', 'state': 'ambiguous'},
        ])
        self.assertEqual(result['contractStatus'], 'hypothesis-only')

    def test_pop_all_does_not_withdraw_dequeued_or_later_captures(self):
        observation = sample()
        observation['captures'].extend([
            {'eventId': 'c2', 'origin': 'composer', 'finalReady': True},
            {'eventId': 'c3', 'origin': 'composer', 'finalReady': True},
        ])
        observation['captureOrder'] = ['c1', 'c2', 'c3']
        observation['records'] = [
            {'kind': 'enqueue', 'id': 'q1'}, {'kind': 'enqueue', 'id': 'q2'},
            {'kind': 'dequeue', 'id': 'd1'}, {'kind': 'popAll', 'id': 'p1'},
            {'kind': 'user', 'id': 'u1'}, {'kind': 'enqueue', 'id': 'q3'},
            {'kind': 'dequeue', 'id': 'd3'}, {'kind': 'user', 'id': 'u3'},
        ]
        observation['users'].append({'id': 'u3', 'source': 'composer', 'textDigest': 'same'})
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'unique')
        self.assertEqual(result['witnesses'], [{
            'c1': {'queueId': 'q1', 'userId': 'u1', 'state': 'entered'},
            'c2': {'queueId': 'q2', 'userId': None, 'state': 'withdrawn'},
            'c3': {'queueId': 'q3', 'userId': 'u3', 'state': 'entered'},
        }])
        self.assertTrue(all(row['state'] == 'ambiguous' for row in result['safe']))

    def test_an_unobserved_ingress_cannot_be_filtered_to_make_a_bijection(self):
        observation = sample()
        observation['records'].insert(0, {'kind': 'enqueue', 'id': 'hidden'})
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'indeterminate')
        self.assertEqual(result['witnesses'], [])
        self.assertIn('incomplete-ingress', result['reasons'])

    def test_missing_or_changed_structural_boundary_never_creates_a_unique_proof(self):
        for key, value in [('complete', False), ('baseline', None),
                           ('prefix', [{'id': 'old', 'source': 'composer', 'textDigest': 'old'}])]:
            with self.subTest(key=key):
                observation = sample()
                observation[key] = value
                result = analyze(observation)
                self.assertEqual(result['analysisStatus'], 'indeterminate')
                self.assertEqual(result['witnesses'], [])
                self.assertIn('unproven-boundary', result['reasons'])

    def test_noncomposer_or_unready_capture_cannot_enter_the_model(self):
        for key, value in [('origin', 'plugin'), ('finalReady', False)]:
            with self.subTest(key=key):
                observation = sample()
                observation['captures'][0][key] = value
                result = analyze(observation)
                self.assertEqual(result['analysisStatus'], 'indeterminate')
                self.assertIn('ineligible-or-unready', result['reasons'])

    def test_unknown_operation_or_noncomposer_row_is_not_silently_ignored(self):
        for mutation in ('operation', 'source'):
            with self.subTest(mutation=mutation):
                observation = sample()
                if mutation == 'operation':
                    observation['records'].append({'kind': 'unknown', 'id': 'x'})
                else:
                    observation['users'][0]['source'] = 'plugin'
                result = analyze(observation)
                self.assertEqual(result['analysisStatus'], 'indeterminate')
                self.assertIn('unmodeled-record', result['reasons'])

    def test_impossible_fifo_is_a_conflict_not_a_withdrawal(self):
        observation = sample()
        observation['records'][0], observation['records'][1] = observation['records'][1], observation['records'][0]
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'inconsistent')
        self.assertEqual(result['mappingCount'], 0)
        self.assertEqual(result['witnesses'], [])
        self.assertIn('contradictory-model', result['reasons'])

    def test_truncated_search_cannot_report_the_first_mapping_as_unique(self):
        observation = sample()
        observation['captures'].append({'eventId': 'c2', 'origin': 'composer', 'finalReady': True})
        observation['records'].insert(1, {'kind': 'enqueue', 'id': 'q2'})
        observation['maxSearchBranches'] = 1
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'indeterminate')
        self.assertIsNone(result['mappingCount'])
        self.assertEqual(result['mappingCountLowerBound'], 1)
        self.assertIn('capacity', result['reasons'])

    def test_fixed_capacity_is_not_expanded_by_the_caller(self):
        observation = sample()
        observation['captures'] = [
            {'eventId': 'c' + str(i), 'origin': 'composer', 'finalReady': True} for i in range(4)
        ]
        observation['records'] = [{'kind': 'enqueue', 'id': 'q' + str(i)} for i in range(4)]
        observation['users'] = []
        observation['maxSearchBranches'] = 1000000
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'indeterminate')
        self.assertEqual(result['witnesses'], [])
        self.assertIn('capacity', result['reasons'])

    def test_recorded_user_must_match_the_new_prefix_suffix(self):
        observation = sample()
        observation['users'] = []
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'inconsistent')
        self.assertEqual(result['mappingCount'], 0)
        self.assertEqual(result['witnesses'], [])

    def test_dequeued_without_user_is_still_waiting_not_withdrawn(self):
        observation = sample()
        observation['records'].pop()
        observation['users'] = []
        result = analyze(observation)
        self.assertEqual(result['witnesses'], [
            {'c1': {'queueId': 'q1', 'userId': None, 'state': 'waiting'}},
        ])
        self.assertEqual(result['safe'], [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_colliding_capture_or_queue_ids_are_not_folded(self):
        for namespace in ('captures', 'queue'):
            with self.subTest(namespace=namespace):
                observation = sample()
                observation['captures'].append({'eventId': 'c2', 'origin': 'composer', 'finalReady': True})
                observation['records'].insert(1, {'kind': 'enqueue', 'id': 'q2'})
                if namespace == 'captures':
                    observation['captures'][1]['eventId'] = 'c1'
                else:
                    observation['records'][1]['id'] = 'q1'
                result = analyze(observation)
                self.assertEqual(result['analysisStatus'], 'inconsistent')
                self.assertEqual(result['mappingCount'], 0)

    def test_inconsistent_capture_order_is_not_an_identity_receipt(self):
        observation = sample()
        observation['captureOrder'] = ['unknown']
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'inconsistent')
        self.assertEqual(result['mappingCount'], 0)
        self.assertEqual(result['witnesses'], [])

    def test_hypothetical_queue_membership_is_not_healthy_waiting_proof(self):
        observation = sample()
        observation['users'] = []
        observation['records'] = [{'kind': 'enqueue', 'id': 'q1'}]
        observation['verified'] = True
        result = analyze(observation)
        self.assertEqual(result['witnesses'][0]['c1']['state'], 'waiting')
        self.assertEqual(result['safe'], [{'eventId': 'c1', 'state': 'ambiguous'}])

    def test_two_captures_cannot_share_the_same_user_identity(self):
        observation = sample()
        observation['captures'].append({'eventId': 'c2', 'origin': 'composer', 'finalReady': True})
        observation['records'].insert(1, {'kind': 'enqueue', 'id': 'q2'})
        observation['records'].extend([{'kind': 'dequeue', 'id': 'd2'}, {'kind': 'user', 'id': 'u1'}])
        observation['users'].append(dict(observation['users'][0]))
        observation['captureOrder'] = ['c1', 'c2']
        result = analyze(observation)
        self.assertEqual(result['analysisStatus'], 'inconsistent')
        self.assertEqual(result['mappingCount'], 0)


if __name__ == '__main__':
    unittest.main()
