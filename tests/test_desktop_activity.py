import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from desktop_activity import ActivityPulse
import local_ai
import server


class DesktopActivityTests(unittest.TestCase):
    def test_signal_clears_after_success_and_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ollama-activity.json'
            for failure in (False, True):
                try:
                    with ActivityPulse(directory, 'qwen3:4b', 'quick') as pulse:
                        state = json.loads(path.read_text())
                        self.assertTrue(state['active'])
                        self.assertEqual(state['model'], 'qwen3:4b')
                        pulse.update({'stage': 'generating'})
                        pulse.write(True)
                        self.assertEqual(json.loads(path.read_text())['stage'], 'generating')
                        if failure:
                            raise ValueError('Test failure')
                except ValueError:
                    pass
                self.assertFalse(json.loads(path.read_text())['active'])
                self.assertFalse(pulse.thread.is_alive())
                self.assertNotIn('text', state)

    def test_optional_signal_write_failure_does_not_break_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'file'
            file.write_text('not a directory')
            with ActivityPulse(file, 'qwen3:4b', 'quick'):
                pass

    def test_cache_hit_does_not_activate_orb(self):
        data = dict(model='qwen3:4b', mode='quick', kind='pasted',
                    title='Bridge repairs', text='The city council approved bridge repairs. ' * 10,
                    context='Local US politics')
        output = dict(summary=['Repairs were approved.'], claims=[], leaning='not applicable',
                      rationale='Municipal reporting.', evidence=[], limitations=['Unverified claims.'])
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'STATE', Path(directory)), \
                patch.object(local_ai, 'models', return_value={'models':[dict(name='qwen3:4b',digest='abc')]}), \
                patch.object(local_ai, 'ollama') as call:
            def generate(*args, **kwargs):
                self.assertTrue(json.loads((Path(directory)/'ollama-activity.json').read_text())['active'])
                return {'message': {'content': json.dumps(output)}}
            call.side_effect = generate
            first = local_ai.analyze(data, server.cached, activity_dir=directory)
            self.assertFalse(first['cached'])
            path = Path(directory) / 'ollama-activity.json'
            self.assertFalse(json.loads(path.read_text())['active'])
            path.unlink()
            second = local_ai.analyze(data, server.cached, activity_dir=directory)
            self.assertTrue(second['cached'])
            self.assertFalse(path.exists())
            self.assertEqual(call.call_count, 1)
