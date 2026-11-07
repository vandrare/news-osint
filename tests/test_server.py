import concurrent.futures
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class NewsTests(unittest.TestCase):
    def setUp(self):
        self.state_dir=tempfile.TemporaryDirectory()
        self.state_patch=patch.object(server,'STATE',Path(self.state_dir.name))
        self.state_patch.start()

    def tearDown(self):
        self.state_patch.stop()
        self.state_dir.cleanup()

    def test_theme_includes_current_name_and_fallback(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(Path, 'home', return_value=Path(folder)):
            self.assertEqual(server.theme()['name'], 'Default')
            current = Path(folder) / '.local/state/omarchy/current'
            (current / 'theme').mkdir(parents=True)
            (current / 'theme/colors.toml').write_text('background = "#123456"')
            (current / 'theme.name').write_text('Sirenis\n')
            result = server.theme()
            self.assertEqual(result['name'], 'Sirenis')
            self.assertEqual(result['background'], '#123456')
            self.assertEqual(result['accent'], server.FALLBACK['accent'])
            (current / 'theme.name').unlink()
            self.assertEqual(server.theme()['name'], 'Custom')

    def test_query_phrases_alternatives_and_exclusions(self):
        match = server.compile_query('"power outage" -planned OR earthquake')
        self.assertTrue(match('A POWER OUTAGE in Lyon'))
        self.assertFalse(match('A planned power outage in Lyon'))
        self.assertTrue(match('An earthquake in Tokyo'))
        self.assertFalse(match('Power prices rise'))
        with self.assertRaises(ValueError):
            server.compile_query('Lyon OR')

    def test_feed_removes_markup_and_rejects_unsafe_links(self):
        xml = b'''<rss><channel><item><title>City &amp; region</title>
        <link>https://example.org/story</link><description>&lt;b&gt;Publisher&lt;/b&gt; excerpt</description>
        <pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item>
        <item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>'''
        result = server.parse_feed(xml, 'bbc')['items']
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['title'], 'City & region')
        self.assertEqual(result[0]['summary'], 'Publisher excerpt')
        self.assertIsNotNone(result[0]['timestamp'])

    def test_date_filters_and_deduplication(self):
        now = time.time()
        stories = [dict(id='1', title='Same headline', summary='', timestamp=now),
                   dict(id='2', title='Same headline!', summary='', timestamp=now - 10),
                   dict(id='3', title='Old story', summary='', timestamp=now - 86400 * 5),
                   dict(id='4', title='Undated', summary='', timestamp=None)]
        with patch.object(server, 'load_feed', return_value=(stories, {'status':'ok'})):
            result = server.news({'sources':'bbc','hours':'24'})
        self.assertEqual([s['id'] for s in result['items']], ['1'])

    def test_cache_reuses_and_preserves_last_good_value(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'STATE', Path(folder)):
            self.assertEqual(server.cached('a', 100, lambda: [1]), ([1], False))
            def fail():
                raise OSError('offline')
            self.assertEqual(server.cached('a', 100, fail), ([1], False))
            self.assertEqual(server.cached('a', -1, fail, stale=True), ([1], True))
            with self.assertRaises(OSError):
                server.cached('missing', 100, fail, stale=True)

    def test_simultaneous_requests_share_cache(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'STATE', Path(folder)):
            calls = []
            def load():
                calls.append(1)
                time.sleep(.02)
                return 'value'
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                values = list(pool.map(lambda _: server.cached('concurrent', 100, load), range(4)))
            self.assertEqual(len(calls), 1)
            self.assertEqual(values, [('value', False)] * 4)

    def test_coordinate_validation(self):
        self.assertEqual(server.places('33.45, -112.07')[0]['lon'], -112.07)
        with self.assertRaises(ValueError):
            server.places('91, 0')
        with self.assertRaises(ValueError):
            server.profile('../secret')

    def test_google_feed_preserves_publisher_and_removes_title_suffix(self):
        xml = b'''<rss><channel><item><title>Lyon transit update - Example News</title>
        <source url="https://example.org">Example News</source>
        <link>https://news.google.com/rss/articles/example</link>
        <description>&lt;a href="https://example.org"&gt;Repeated headline&lt;/a&gt;</description>
        </item></channel></rss>'''
        story = server.parse_feed(xml, 'google')['items'][0]
        self.assertEqual(story['title'], 'Lyon transit update')
        self.assertEqual(story['source'], 'Example News')
        self.assertEqual(story['via'], 'Google News')
        self.assertEqual(story['summary'], '')
        self.assertEqual(server.parse_feed(b'<rss><channel/></rss>', 'google')['items'], [])

    def test_google_query_and_cache_are_specific_to_search(self):
        lyon = server.google_feed_url('Lyon', 24)
        paris = server.google_feed_url('Paris', 168)
        self.assertIn('q=Lyon+when%3A24h', lyon)
        self.assertIn('q=Paris+when%3A168h', paris)
        keys = []
        def cache(key, ttl, fn, stale=False):
            keys.append(key)
            return {'items': [], 'fetchedAt': time.time()}, False
        with patch.object(server, 'cached', side_effect=cache):
            server.load_feed('google', lyon)
            server.load_feed('google', paris)
        self.assertNotEqual(keys[0], keys[1])

    def test_google_results_are_not_rejected_by_local_literal_matching(self):
        story = dict(id='g1', title='Transit disruption', summary='', timestamp=time.time(), sourceId='google', via='Google News')
        with patch.object(server, 'load_feed', return_value=([story], {'status':'ok'})):
            result = server.news({'sources':'google', 'q':'Lyon site:example.org'})
        self.assertEqual(result['items'], [story])

    def test_infobox_plain_text_handles_nested_tables_and_citations(self):
        parser = server.InfoboxParser()
        parser.feed('''<table class="other"><tr><th>Ignore</th><td>me</td></tr></table>
        <table class="infobox geography"><tr><th colspan="2">Lyon</th></tr>
        <tr><th>Country</th><td><a href="/wiki/France">France</a><sup class="reference">[1]</sup></td></tr>
        <tr><th>Area</th><td>47.87 km<sup>2</sup></td></tr>
        <tr><th>Government</th><td><table><tr><td>Mayor</td></tr></table></td></tr>
        <tr><th>Time zone</th><td>CET<br>CEST<script>alert(1)</script></td></tr></table>
        <table class="infobox"><tr><th>Wrong box</th><td>ignored</td></tr></table>''')
        self.assertEqual(parser.rows, [dict(label='Country', value='France'),
                                      dict(label='Area', value='47.87 km²'),
                                      dict(label='Government', value='Mayor'),
                                      dict(label='Time zone', value='CET · CEST')])

    def test_reader_rejects_non_web_urls_and_embedded_credentials(self):
        for url in ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.org',
                    'https://example.org/\n--argument', None]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                server.article_url(url)
        self.assertEqual(server.article_url('https://example.org/story?q=a&b=c'),
                         'https://example.org/story?q=a&b=c')

    def test_reader_launch_keeps_url_as_literal_argument(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'STATE', Path(folder)), \
                patch.object(server.shutil, 'which', return_value='/usr/bin/electron'), \
                patch.object(server.subprocess, 'Popen') as start:
            url = 'https://example.org/story?q=$(touch%20/tmp/no)&a=b'
            self.assertEqual(server.open_reader(url), {'opened': True})
            args = start.call_args.args[0]
            self.assertEqual(args[-1], url)
            self.assertEqual(args[-2], str(server.ROOT / 'reader/main.cjs'))
            self.assertNotIn('shell', start.call_args.kwargs)

    def test_wikipedia_search_includes_people_without_coordinates(self):
        data={'query':{'pages':[{'pageid':1,'title':'Ada Lovelace','index':1,
                                'description':'English mathematician','pageprops':{'wikibase_item':'Q7259'}},
                               {'pageid':2,'title':'London','index':2,'coordinates':[{'lat':51.5,'lon':-.1}]}]}}
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'STATE',Path(folder)), \
                patch.object(server,'wiki',return_value=data):
            results=server.wikipedia_search('Ada')
        self.assertEqual(results[0]['title'],'Ada Lovelace')
        self.assertIsNone(results[0]['coordinates'])
        self.assertEqual(results[1]['coordinates']['lat'],51.5)

    def test_wikipedia_section_removes_scripts_styles_and_tables(self):
        parser=server.ArticleTextParser()
        parser.feed('<h2>Biography</h2><style>hidden style</style><p>A &amp; B.</p>'
                    '<table><tr><td>Navigation table</td></tr></table><p>More <b>text</b>.</p><script>bad()</script>')
        self.assertEqual(parser.text(),'Biography\n\nA & B.\n\nMore text.')
        with self.assertRaises(ValueError):
            server.wikipedia_section('123','../secret')

    def test_source_settings_seed_existing_sources_and_persist_edits(self):
        initial=server.sources()
        self.assertEqual([s['id'] for s in initial],list(server.FEEDS))
        self.assertTrue((server.STATE/'sources.json').exists())
        initial[1]['name']='BBC custom label'
        initial[2]['enabled']=False
        initial.append(dict(id='feed_local',name='Local feed',url='https://example.org/rss.xml',enabled=True))
        server.save_sources(initial)
        self.assertEqual(server.sources(),initial)
        self.assertEqual(len(server.sources()),7)

    def test_invalid_source_settings_do_not_overwrite_saved_configuration(self):
        original=server.sources()
        for mutation in [dict(id='bbc',name='Duplicate ID',url='https://example.org/rss',enabled=True),
                         dict(id='new',name='Invalid URL',url='file:///etc/passwd',enabled=True),
                         dict(id='new',name='',url='https://example.org/rss',enabled=True),
                         dict(id='new',name='Duplicate URL',url=original[0]['url'],enabled=True)]:
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):
                server.save_sources(original+[mutation])
            self.assertEqual(server.sources(),original)

    def test_atom_feed_uses_custom_name_and_iso_dates(self):
        data=b'''<feed xmlns="http://www.w3.org/2005/Atom"><title>Example</title><entry>
        <title>Custom topic</title><link rel="alternate" href="/story"/>
        <updated>2026-11-04T12:00:00Z</updated><summary type="html">&lt;p&gt;A summary&lt;/p&gt;</summary>
        </entry></feed>'''
        source=dict(id='custom',name='My source',url='https://example.org/feed',enabled=True)
        story=server.parse_feed(data,'custom',source)['items'][0]
        self.assertEqual(story['source'],'My source')
        self.assertEqual(story['url'],'https://example.org/story')
        self.assertEqual(story['summary'],'A summary')
        self.assertIsNotNone(story['timestamp'])
        with self.assertRaises(ValueError):
            server.parse_feed(b'<html><body>Not a feed</body></html>','custom',source)

    def test_custom_feeds_share_news_filters_and_disabled_feeds_are_not_fetched(self):
        server.save_sources([dict(id='custom',name='My RSS',url='https://example.org/rss',enabled=True),
                             dict(id='disabled',name='Disabled',url='https://example.org/disabled',enabled=False)])
        xml=b'<rss><channel><item><title>City story</title><link>https://example.org/story</link><description>More context</description></item></channel></rss>'
        with patch.object(server,'fetch',return_value=xml) as fetch:
            result=server.news({'q':'City','sources':'custom,disabled'})
            self.assertEqual(fetch.call_count,1)
        self.assertEqual(len(result['items']),1)
        self.assertEqual(result['items'][0]['source'],'My RSS')
        self.assertEqual(result['sources'][0]['id'],'custom')

    def test_same_headline_from_different_publishers_is_preserved(self):
        stories=[dict(id='a',title='Same event',url='https://one.example/story',summary='',timestamp=time.time()),
                 dict(id='b',title='Same event',url='https://two.example/story',summary='',timestamp=time.time()),
                 dict(id='c',title='Same event',url='https://one.example/story',summary='',timestamp=time.time())]
        with patch.object(server,'load_feed',return_value=(stories,{'status':'ok'})):
            result=server.news({'sources':'bbc'})
        self.assertEqual(len(result['items']),2)
        self.assertEqual({s['url'] for s in result['items']},{'https://one.example/story','https://two.example/story'})


if __name__ == '__main__':
    unittest.main()
