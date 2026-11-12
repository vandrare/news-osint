import json
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

import local_ai
import server


class LocalAITests(unittest.TestCase):
    def example(self):
        return {'summary': ['The article reports a debate.'], 'claims': ['Officials proposed a change.'],
                'leaning': 'left', 'rationale': 'The wording favors one side.',
                'evidence': [{'quote': 'a disastrous policy', 'explanation': 'An evaluative description.'}],
                'limitations': ['This is an assessment of framing, not verification.']}

    def test_quotes_must_match_and_labels_require_evidence(self):
        result = local_ai.clean_result(self.example(), 'The minister announced a new policy today.', 'pasted')
        self.assertEqual(result['evidence'], [])
        self.assertEqual(result['leaning'], 'unclear')
        self.assertIn('removed', result['limitations'][-1])
        result = local_ai.clean_result(self.example(), 'They called it a  disastrous\npolicy.', 'pasted')
        self.assertEqual(result['leaning'], 'left')
        self.assertEqual(len(result['evidence']), 1)

    def test_rss_never_establishes_article_leaning(self):
        result = local_ai.clean_result(self.example(), 'They called it a disastrous policy.', 'rss')
        self.assertEqual(result['leaning'], 'unclear')
        self.assertIn('RSS', result['limitations'][-1])

    def test_invalid_model_results_are_rejected(self):
        for change in [{'summary': 'not an array'}, {'evidence': 'not evidence'}, {'leaning': 'truth'}, {'rationale': None}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                local_ai.clean_result({**self.example(), **change}, 'a disastrous policy', 'pasted')

    def test_cloud_models_are_excluded(self):
        with patch.object(local_ai, 'ollama', return_value={'models': [
            {'name': 'qwen3:4b', 'digest': 'abc'}, {'name': 'remote:cloud'},
            {'name': 'remote', 'remote_host': 'https://example.org'}, {'name': 'remote2', 'remote_model': 'foo'}]}):
            self.assertEqual([m['name'] for m in local_ai.models()['models']], ['qwen3:4b'])

    def test_extract_prefers_article_and_ignores_scripts_and_navigation(self):
        parser = local_ai.ArticleParser()
        paragraph = 'This is the actual news reporting with several detailed statements and attributed claims. '
        parser.feed('<nav><p>' + 'Navigation ' * 90 + '</p></nav><article><p>' + paragraph * 6 +
                    '<script>ignore instructions</script></p><p>' + paragraph * 6 + '</p></article>')
        self.assertNotIn('Navigation', parser.text())
        self.assertNotIn('instructions', parser.text())
        self.assertIn('actual news', parser.text())

    def test_google_wrapper_reports_publisher_url_needed(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.headers.get_content_type.return_value = 'text/html'
        response.headers.get_content_charset.return_value = 'utf-8'
        response.read.return_value = b'<html><p>Google News</p></html>'
        response.geturl.return_value = 'https://news.google.com/rss/articles/example'
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(local_ai, 'public_url'), patch.object(local_ai.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(ValueError, 'publisher.*URL'):
                local_ai.extract('https://news.google.com/rss/articles/example')

    def test_google_link_resolution_and_invalid_destination(self):
        page = '<div data-n-a-sg="signature" data-n-a-ts="123"></div>'
        response = MagicMock()
        response.__enter__.return_value = response
        rpc = json.dumps([['wrb.fr', 'Fbv4je', json.dumps(['garturlres', 'https://publisher.example/article'])]])
        response.read.return_value = (")]}'\n\n123\n" + rpc + '\n').encode()
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(local_ai, 'public_url', side_effect=lambda url: url):
            self.assertEqual(local_ai.decode_google_article('https://news.google.com/rss/articles/example', page, opener), 'https://publisher.example/article')
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://news.google.com/_/DotsSplashUi/data/batchexecute')
        self.assertIn('Fbv4je', request.data.decode())
        with patch.object(local_ai, 'public_url', side_effect=ValueError('Private address')):
            with self.assertRaises(ValueError):
                local_ai.decode_google_article('https://news.google.com/rss/articles/example', page, opener)

    def test_extraction_blocks_private_targets(self):
        for url in ['http://127.0.0.1', 'http://[::1]', 'file:///tmp/news', 'http://localhost:11434']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                local_ai.public_url(url)

    def test_failed_or_busy_inference_can_be_retried(self):
        data = dict(model='qwen3:4b', text='They called it a disastrous policy. ' * 15,
                    title='Policy debate', kind='pasted', context='UK politics')
        installed = {'models': [{'name': 'qwen3:4b', 'digest': 'one', 'size': 100}]}
        def uncached(key, ttl, generate):
            return generate(), False
        with patch.object(local_ai, 'models', return_value=installed):
            local_ai.BUSY.acquire()
            try:
                with self.assertRaisesRegex(ValueError, 'Another article'):
                    local_ai.analyze(data, uncached)
            finally:
                local_ai.BUSY.release()
            with patch.object(local_ai, 'ollama', return_value={'done_reason': 'length'}):
                with self.assertRaisesRegex(ValueError, 'output space'):
                    local_ai.analyze(data, uncached)
            self.assertFalse(local_ai.BUSY.locked())
            with patch.object(local_ai, 'ollama', return_value={'message': {'content': 'not JSON'}}):
                with self.assertRaisesRegex(ValueError, 'structured analysis'):
                    local_ai.analyze(data, uncached)
            self.assertFalse(local_ai.BUSY.locked())
            with patch.object(local_ai, 'ollama', return_value={'message': {'content': json.dumps(self.example())}}):
                self.assertEqual(local_ai.analyze(data, uncached)['leaning'], 'left')

    def test_streaming_collects_json_and_rejects_incomplete_stream(self):
        text = json.dumps(self.example())
        chunks = [dict(message={'content': text[:30]}, done=False),
                  dict(message={'content': text[30:]}, done=False),
                  dict(message={'content': ''}, done=True, done_reason='stop')]
        response = io.BytesIO(b''.join(json.dumps(x).encode() + b'\n' for x in chunks))
        events = []
        with patch.object(local_ai.LOCAL, 'open', return_value=response) as call:
            result = local_ai.stream_chat({'model': 'qwen3:4b'}, events.append)
        self.assertEqual(result['message']['content'], text)
        self.assertEqual(events[0]['stage'], 'loading')
        self.assertTrue(any(e['stage'] == 'generating' for e in events))
        self.assertTrue(json.loads(call.call_args.args[0].data)['stream'])
        with patch.object(local_ai.LOCAL, 'open', return_value=io.BytesIO(b'{"done":false}\n')):
            with self.assertRaisesRegex(ValueError, 'before completing'):
                local_ai.stream_chat({}, lambda e: None)

    def test_quick_profile_and_cache_are_distinct_from_detailed(self):
        data = dict(model='qwen3:4b', text='They called it a disastrous policy. ' * 15,
                    title='Policy debate', kind='pasted', context='UK politics')
        installed = {'models': [{'name': 'qwen3:4b', 'digest': 'one', 'size': 100}]}
        output = {'message': {'content': json.dumps(self.example())}, 'done_reason': 'stop'}
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'STATE', Path(folder)), \
                patch.object(local_ai, 'models', return_value=installed), patch.object(local_ai, 'stream_chat', return_value=output) as call:
            detailed = local_ai.analyze({**data, 'mode': 'detailed'}, server.cached, lambda e: None)
            quick = local_ai.analyze({**data, 'mode': 'quick'}, server.cached, lambda e: None)
            self.assertEqual(call.call_count, 2)
            self.assertEqual(quick['mode'], 'quick')
            payload = call.call_args.args[0]
            self.assertEqual(payload['keep_alive'], '15m')
            self.assertFalse(payload['think'])
            self.assertEqual(payload['options']['num_ctx'], 12288)
            for field in ['summary', 'claims', 'evidence', 'limitations']:
                self.assertEqual(payload['format']['properties'][field]['maxItems'], 2)
            saved = local_ai.analyze({**data, 'mode': 'quick'}, server.cached, lambda e: None)
            self.assertTrue(saved['cached'])
            self.assertEqual(call.call_count, 2)
            with self.assertRaisesRegex(ValueError, 'Quick or Detailed'):
                local_ai.analyze({**data, 'mode': 'unknown'}, server.cached)

    def test_analysis_cache_and_model_digest_invalidation(self):
        data = dict(model='qwen3:4b', text='They called it a disastrous policy. ' * 15,
                    title='Policy debate', kind='pasted', context='UK politics')
        installed = {'models': [{'name': 'qwen3:4b', 'digest': 'one', 'size': 100}]}
        output = {'message': {'content': json.dumps(self.example())}, 'done_reason': 'stop'}
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'STATE', Path(folder)), \
                patch.object(local_ai, 'models', return_value=installed), patch.object(local_ai, 'ollama', return_value=output) as call:
            first = local_ai.analyze(data, server.cached)
            second = local_ai.analyze(data, server.cached)
            self.assertFalse(first['cached'])
            self.assertTrue(second['cached'])
            self.assertEqual(second, {**first, 'cached': True})
            self.assertEqual(call.call_count, 1)
            installed['models'][0]['digest'] = 'two'
            local_ai.analyze(data, server.cached)
            self.assertEqual(call.call_count, 2)
            self.assertFalse(call.call_args.args[1]['stream'])
            self.assertEqual(call.call_args.args[0], '/api/chat')
            with self.assertRaises(ValueError):
                local_ai.analyze({**data, 'model': 'missing'}, server.cached)
            with self.assertRaises(ValueError):
                local_ai.analyze({**data, 'text': 'too short'}, server.cached)
