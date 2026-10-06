import json
import pathlib
import tempfile
import unittest

from journal_reader import collect_observation, read_journal


class JournalBoundary(unittest.TestCase):
    def test_partial_tail_is_not_parsed_or_used_as_a_terminal_operation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            first = json.dumps({'type': 'queue-operation', 'operation': 'enqueue', 'content': 'private-body'}).encode() + b'\n'
            path.write_bytes(first + b'{"type":"queue-operation","operation":"popAll"')
            result = read_journal(path)
            self.assertEqual(result['completeBytes'], len(first))
            self.assertTrue(result['hasPartialTail'])
            self.assertEqual([row['operation'] for row in result['rows']], ['enqueue'])
            self.assertTrue(result['complete'])
            self.assertNotIn('private-body', json.dumps(result))

    def test_a_bad_complete_json_line_is_an_explicit_gap(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            path.write_bytes(b'{broken-record}\n' + b'{"type":"queue-operation","operation":"enqueue"}\n')
            result = read_journal(path)
            self.assertFalse(result['complete'])
            self.assertIn('malformed-json', result['gaps'])

    def test_same_inode_prefix_rewrite_or_truncation_is_not_continuity(self):
        for replacement, gap in [(b'omega', 'prefix-changed'), (None, 'journal-truncated')]:
            with self.subTest(gap=gap), tempfile.TemporaryDirectory() as folder:
                path = pathlib.Path(folder) / 'synthetic.jsonl'
                first = b'{"type":"queue-operation","operation":"enqueue","content":"alpha"}\n'
                path.write_bytes(first)
                previous = read_journal(path)
                path.write_bytes(first.replace(b'alpha', replacement) if replacement else b'')
                result = read_journal(path, previous)
                self.assertEqual(result['inode'], previous['inode'])
                self.assertFalse(result['complete'])
                self.assertIn(gap, result['gaps'])

    def test_replacing_the_file_with_identical_bytes_still_breaks_its_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            body = b'{"type":"user","uuid":"synthetic-u1"}\n'
            path.write_bytes(body)
            previous = read_journal(path)
            replacement = pathlib.Path(folder) / 'replacement.jsonl'
            replacement.write_bytes(body)
            replacement.replace(path)
            result = read_journal(path, previous)
            self.assertFalse(result['complete'])
            self.assertIn('journal-replaced', result['gaps'])

    def test_nonobject_json_records_are_a_gap_not_a_valid_empty_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            path.write_bytes(b'[]\n')
            result = read_journal(path)
            self.assertFalse(result['complete'])
            self.assertIn('malformed-record', result['gaps'])

    def test_read_boundary_reports_the_single_handle_stability_check(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            path.write_bytes(b'{"type":"queue-operation","operation":"enqueue"}\n')
            result = read_journal(path)
            self.assertTrue(result['readStable'])
            self.assertEqual(result['bytes'], path.stat().st_size)

    def test_failed_read_is_a_gap_not_an_empty_queue(self):
        with tempfile.TemporaryDirectory() as folder:
            result = read_journal(pathlib.Path(folder) / 'missing.jsonl')
            self.assertFalse(result['complete'])
            self.assertEqual(result['rows'], [])
            self.assertIn('journal-unavailable', result['gaps'])

    def test_identical_bytes_cannot_erase_a_previously_unproven_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            path.write_bytes(b'{"type":"queue-operation","operation":"enqueue"}\n')
            previous = read_journal(path)
            previous.update(complete=False, gaps=['synthetic-read-failure'])
            result = read_journal(path, previous)
            self.assertFalse(result['complete'])
            self.assertIn('previous-gap', result['gaps'])

    def test_observer_collection_uses_the_reader_and_removes_stdin_bodies(self):
        with tempfile.TemporaryDirectory() as folder:
            config = pathlib.Path(folder)
            (config / 'projects').mkdir()
            (config / 'projects' / 'synthetic.jsonl').write_bytes(b'{broken}\n')
            result = collect_observation({
                'sessionId': 'synthetic', 'inputText': 'private-input', 'resultText': 'private-final',
            }, config)
            self.assertNotIn('private-input', json.dumps(result))
            self.assertNotIn('private-final', json.dumps(result))
            self.assertTrue(result['journals'][0]['readStable'])
            self.assertIn('malformed-json', result['journals'][0]['gaps'])

    def test_attachment_payloads_do_not_even_contribute_a_text_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'synthetic.jsonl'
            path.write_text(json.dumps({'type': 'attachment', 'message': {'content': 'private-attachment'}}) + '\n')
            result = read_journal(path)
            self.assertNotIn('textDigest', result['rows'][0])
            self.assertNotIn('private-attachment', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
