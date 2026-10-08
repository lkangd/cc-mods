import unittest

from replay import replay


class ReplayBoundary(unittest.TestCase):
    def test_call_pairing_survives_reverse_observation_write_order(self):
        def observation(phase, call):
            return {
                'phase': phase, 'observationId': call, 'epoch': 'e1',
                'origin': {'kind': 'composer'}, 'turnId': 'running',
                'resultTextDigest': 'same', 'result': {},
            }

        report = {'version': 'synthetic', 'observations': [
            observation('submit.after', 'b'), observation('submit.before', 'a'),
            observation('submit.after', 'a'), observation('submit.before', 'b'),
        ], 'privacy': {'leaks': []}}
        result = replay(report)
        self.assertEqual(result['captures'], [
            {'eventId': 'e1:a', 'finalReady': True},
            {'eventId': 'e1:b', 'finalReady': True},
        ])
        self.assertEqual(result['gaps'], [])

    def test_legacy_observations_cannot_be_paired_by_text_or_sequence(self):
        report = {'version': 'synthetic', 'observations': [
            {'phase': 'submit.before', 'sequence': 1, 'origin': {'kind': 'composer'}},
            {'phase': 'submit.after', 'sequence': 2, 'origin': {'kind': 'composer'},
             'resultTextDigest': 'same'},
        ], 'privacy': {'leaks': []}}
        result = replay(report)
        self.assertEqual(result['captures'], [])
        self.assertIn('unpaired-submission', result['gaps'])

    def test_missing_after_preserves_observed_qualification_as_unready(self):
        report = {'version': 'synthetic', 'observations': [
            {'phase': 'submit.before', 'epoch': 'e1', 'observationId': 'a',
             'origin': {'kind': 'composer'}},
        ], 'privacy': {'leaks': []}}
        result = replay(report)
        self.assertEqual(result['captures'], [{'eventId': 'e1:a', 'finalReady': False}])
        self.assertIn('unpaired-submission', result['gaps'])

    def test_inode_and_complete_bytes_alone_do_not_prove_read_coverage(self):
        report = {'version': 'synthetic', 'observations': [
            {'phase': 'turn.complete.before', 'journals': [
                {'file': 'synthetic.jsonl', 'device': 1, 'inode': 2,
                 'bytes': 10, 'completeBytes': 10, 'rows': []},
            ]},
        ], 'privacy': {'leaks': []}}
        result = replay(report)
        self.assertEqual(result['analysisStatus'], 'indeterminate')
        self.assertIn('unproven-read-boundary', result['journalGaps'])
        self.assertNotIn('afterQueue', result)

    def test_duplicate_phase_cannot_overwrite_an_uncertain_call(self):
        before = {'phase': 'submit.before', 'epoch': 'e1', 'observationId': 'a',
                  'origin': {'kind': 'composer'}}
        after = {**before, 'phase': 'submit.after', 'resultTextDigest': 'same', 'result': {}}
        result = replay({'version': 'synthetic', 'observations': [before, after, after],
                         'privacy': {'leaks': []}})
        self.assertIn('duplicate-observation', result['gaps'])
        self.assertEqual(result['captures'], [{'eventId': 'e1:a', 'finalReady': False}])

    def test_a_reported_sampler_failure_is_not_silently_lost(self):
        result = replay({'version': 'synthetic', 'observations': [
            {'phase': 'turn.complete.before', 'samplerFailures': 1},
        ], 'privacy': {'leaks': []}})
        self.assertIn('observation-write-failure', result['gaps'])
        self.assertEqual(result['analysisStatus'], 'indeterminate')


if __name__ == '__main__':
    unittest.main()
