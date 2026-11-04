#!/usr/bin/env python3
"""News-OSINT: loopback-only, standard-library backend. No subscriptions."""
import argparse
import concurrent.futures
import email.utils
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import tomllib
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parent
STATE = Path(os.environ.get('NEWS_OSINT_STATE', Path.home() / '.local/state/news-osint'))
UA = 'News-OSINT/0.1 (personal local desktop news reader)'
FEEDS = {
    'google': ('Google News', 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US%3Aen'),
    'bbc': ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
    'guardian': ('The Guardian', 'https://www.theguardian.com/world/rss'),
    'aljazeera': ('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'),
    'npr': ('NPR World', 'https://feeds.npr.org/1004/rss.xml'),
    'france24': ('France 24', 'https://www.france24.com/en/rss'),
}
FALLBACK = dict(background='#171612', foreground='#e8dfcc', accent='#d9a45d',
                muted='#ac9d86', selection='#51412b', dark_background='#11100d',
                lighter_background='#302c24', blue='#83abc0', green='#9cb878', red='#e47746')
LOCKS = {}
LOCK = threading.Lock()


def get_lock(key):
    with LOCK:
        return LOCKS.setdefault(key, threading.Lock())


def cached(key, ttl, fn, stale=False):
    path = STATE / 'cache' / (hashlib.sha256(key.encode()).hexdigest() + '.json')
    with get_lock(key):
        old = None
        try:
            old = json.loads(path.read_text())
            if time.time() - old['time'] < ttl:
                return old['value'], False
        except (OSError, ValueError, KeyError):
            pass
        try:
            value = fn()
        except Exception:
            if stale and old is not None:
                return old['value'], True
            raise
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps({'time': time.time(), 'value': value}))
        temp.replace(path)
        return value, False


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json, application/xml;q=0.9,*/*;q=0.8'})
    with urllib.request.urlopen(req, timeout=18) as response:
        data = response.read(8_000_001)
        if len(data) > 8_000_000:
            raise ValueError('Response too large')
        return data


def api(base, **params):
    return json.loads(fetch(base + '?' + urllib.parse.urlencode(params)))


def wiki(**params):
    return api('https://en.wikipedia.org/w/api.php', format='json', formatversion=2, **params)


def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value or ''))).strip()


def parse_feed(data, key):
    root = ET.fromstring(data)
    name = FEEDS[key][0]
    items = []
    for item in root.findall('.//item'):
        url = item.findtext('link', '').strip()
        if urllib.parse.urlsplit(url).scheme not in ('http', 'https'):
            continue
        title = plain(item.findtext('title'))
        if not title:
            continue
        published = item.findtext('pubDate', '')
        try:
            timestamp = email.utils.parsedate_to_datetime(published).timestamp()
        except (ValueError, TypeError, OverflowError):
            timestamp = None
        publisher = plain(item.findtext('source')) if key == 'google' else name
        publisher = publisher or name
        if key == 'google' and title.endswith(' - ' + publisher):
            title = title[:-len(' - ' + publisher)]
        items.append(dict(id=hashlib.sha256(url.encode()).hexdigest()[:16], title=title,
                          url=url, summary='' if key == 'google' else plain(item.findtext('description'))[:1400],
                          source=publisher, via='Google News' if key == 'google' else None,
                          sourceId=key, published=published, timestamp=timestamp))
    if not items and not (key == 'google' and root.find('channel') is not None):
        raise ValueError('No readable stories in feed')
    return {'items': items, 'fetchedAt': time.time()}


def google_feed_url(query='', hours=0):
    if not query.strip():
        return FEEDS['google'][1]
    query = query.strip()[:500]
    if hours:
        query += f' when:{max(1, int(hours))}h'
    return 'https://news.google.com/rss/search?' + urllib.parse.urlencode(
        dict(q=query, hl='en-US', gl='US', ceid='US:en'))


def load_feed(key, url=None):
    try:
        url = url or FEEDS[key][1]
        value, stale = cached('feed:' + key + (':' + url if key == 'google' else ''),
                              300, lambda: parse_feed(fetch(url), key), stale=True)
        return value['items'], dict(id=key, name=FEEDS[key][0], status='cached' if stale else 'ok',
                                   fetchedAt=value['fetchedAt'], count=len(value['items']))
    except Exception as exc:
        return [], dict(id=key, name=FEEDS[key][0], status='error', count=0,
                        error='Feed unavailable: ' + type(exc).__name__)


def compile_query(query):
    """Simple documented language: phrases, implicit AND, OR, -exclusions."""
    tokens = re.findall(r'-?"[^"]+"|\S+', query)
    groups = [[]]
    for token in tokens:
        if token.upper() == 'OR':
            if not groups[-1]:
                raise ValueError('OR needs a term on both sides')
            groups.append([])
        elif token.upper() == 'AND':
            continue
        else:
            negative = token.startswith('-')
            term = token[1:] if negative else token
            term = term.strip('"').casefold()
            if term:
                groups[-1].append((term, negative))
    if len(groups) > 1 and not groups[-1]:
        raise ValueError('OR needs a term on both sides')
    return lambda text: any(all((term not in text.casefold()) if neg else (term in text.casefold())
                               for term, neg in group) for group in groups)


def news(params):
    keys = [k for k in params.get('sources', ','.join(FEEDS)).split(',') if k in FEEDS]
    match = compile_query(params.get('q', '')[:500])
    try:
        hours = max(0, min(float(params.get('hours', 0)), 24 * 365))
    except ValueError:
        raise ValueError('Invalid date range')
    cutoff = time.time() - hours * 3600 if hours else 0
    items, statuses = [], []
    tasks = [(key, google_feed_url(params.get('q', ''), hours) if key == 'google' else None) for key in keys]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result, status in pool.map(lambda task: load_feed(*task), tasks):
            items.extend(result)
            statuses.append(status)
    seen = set()
    filtered = []
    for item in sorted(items, key=lambda i: i['timestamp'] or 0, reverse=True):
        signature = re.sub(r'\W', '', item['title'].casefold())
        if signature in seen or (item.get('sourceId') != 'google' and not match(item['title'] + ' ' + item['summary'])):
            continue
        if hours and (item['timestamp'] is None or item['timestamp'] < cutoff):
            continue
        seen.add(signature)
        filtered.append(item)
    return dict(items=filtered, sources=statuses, collected=len(items), checkedAt=time.time())


def places(query):
    query = query.strip()[:180]
    if not query:
        return []
    coordinates = re.fullmatch(r'\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*', query)
    if coordinates:
        lat, lon = map(float, coordinates.groups())
        if abs(lat) > 90 or abs(lon) > 180:
            raise ValueError('Coordinates must be latitude, longitude within valid ranges')
        return [dict(title=f'{lat}, {lon}', lat=lat, lon=lon, pageid=None)]

    def lookup():
        data = wiki(action='query', generator='search', gsrsearch=query, gsrlimit=12,
                    prop='coordinates|pageprops|description', colimit='max', coprimary='primary')
        pages = data.get('query', {}).get('pages', [])
        return [dict(title=p['title'], pageid=p['pageid'], description=p.get('description', ''),
                     lat=p['coordinates'][0]['lat'], lon=p['coordinates'][0]['lon'],
                     wikidata=p.get('pageprops', {}).get('wikibase_item'))
                for p in sorted(pages, key=lambda p: p.get('index', 0)) if p.get('coordinates')]
    return cached('places:' + query.casefold(), 86400 * 7, lookup)[0]


def wikipedia_search(query):
    query = query.strip()[:180]
    if not query:
        return []
    def lookup():
        data = wiki(action='query', generator='search', gsrsearch=query, gsrlimit=12,
                    prop='description|pageprops|coordinates', colimit='max', coprimary='primary')
        return [dict(title=page['title'], pageid=page['pageid'], description=page.get('description', ''),
                     wikidata=page.get('pageprops', {}).get('wikibase_item'),
                     coordinates=page.get('coordinates', [None])[0])
                for page in sorted(data.get('query', {}).get('pages', []), key=lambda p:p.get('index', 0))]
    return cached('wiki-search:' + query.casefold(), 86400, lookup)[0]


def entities(ids):
    if not ids:
        return {}
    def lookup():
        return api('https://www.wikidata.org/w/api.php', action='wbgetentities',
                   ids='|'.join(sorted(ids)), props='labels|claims|sitelinks',
                   languages='en', sitefilter='enwiki', format='json').get('entities', {})
    return cached('entities:' + '|'.join(sorted(ids)), 86400, lookup)[0]


def claim(entity, prop):
    values = entity.get('claims', {}).get(prop, [])
    return sorted((v for v in values if v.get('rank') != 'deprecated'),
                  key=lambda v: v.get('rank') == 'preferred', reverse=True)


def target(entity, prop):
    for value in claim(entity, prop):
        item = value.get('mainsnak', {}).get('datavalue', {}).get('value', {})
        if isinstance(item, dict) and item.get('id'):
            return item['id']
    return None


class InfoboxParser(HTMLParser):
    """Extract plain label/value pairs from the first Wikipedia infobox."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.finished = False
        self.cell = None
        self.skipped = 0
        self.sup_references = []
        self.labels = []
        self.values = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table':
            if self.depth:
                self.depth += 1
            elif not self.finished and 'infobox' in attrs.get('class', '').split():
                self.depth = 1
        if not self.depth:
            return
        if tag == 'sup':
            reference = 'reference' in attrs.get('class', '').split() or attrs.get('id', '').startswith('cite_ref')
            self.sup_references.append(reference)
            if reference:
                self.skipped += 1
        elif tag in ('style', 'script'):
            self.skipped += 1
        if self.depth == 1:
            if tag == 'tr':
                self.labels, self.values = [], []
            elif tag in ('th', 'td'):
                self.cell = self.labels if tag == 'th' else self.values
                # Row headings such as “• Total” are values in some infoboxes.
                if 'infobox-label' in attrs.get('class', '').split():
                    self.cell = self.labels
        if tag in ('br', 'li') and self.cell is not None:
            self.cell.append(' · ')

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag == 'sup' and self.sup_references:
            if self.sup_references.pop():
                self.skipped -= 1
        elif tag in ('style', 'script') and self.skipped:
            self.skipped -= 1
        if self.depth == 1:
            if tag == 'tr':
                label = re.sub(r'\s+', ' ', ''.join(self.labels)).strip(' ·\xa0')
                value = re.sub(r'\s+', ' ', ''.join(self.values)).strip(' ·\xa0')
                if label and value and len(label) < 130 and len(self.rows) < 50:
                    self.rows.append(dict(label=label, value=value[:1000]))
                self.cell = None
            elif tag in ('th', 'td'):
                self.cell = None
        if tag == 'table':
            self.depth -= 1
            if not self.depth:
                self.finished = True

    def handle_data(self, text):
        if self.depth and self.cell is not None and not self.skipped:
            if self.sup_references and not self.sup_references[-1]:
                text = text.translate(str.maketrans('0123456789+-=()', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾'))
            self.cell.append(text)


def article_details(pageid):
    data = wiki(action='parse', pageid=pageid, prop='text|sections', disableeditsection=1, disabletoc=1)
    text = data.get('parse', {}).get('text', '')
    if isinstance(text, dict):
        text = text.get('*', '')
    parser = InfoboxParser()
    parser.feed(text)
    excluded = {'references', 'notes', 'external links', 'further reading', 'bibliography', 'sources', 'see also'}
    sections = [dict(index=section['index'], title=plain(section['line']))
                for section in data.get('parse', {}).get('sections', [])
                if section.get('toclevel') == 1 and plain(section['line']).casefold() not in excluded
                and re.fullmatch(r'\d+', section.get('index', ''))][:12]
    return {'infobox': parser.rows, 'sections': sections}


class ArticleTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'table'):
            self.skip.append(tag)
        if not self.skip and tag in ('p', 'li', 'h2', 'h3', 'h4', 'br'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if self.skip and tag == self.skip[-1]:
            self.skip.pop()
        if not self.skip and tag in ('p', 'li', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_data(self, value):
        if not self.skip:
            self.parts.append(value)

    def text(self):
        return '\n\n'.join(re.sub(r'\s+', ' ', line).strip() for line in ''.join(self.parts).splitlines()
                           if line.strip())[:14000]


def wikipedia_section(pageid, index):
    if not re.fullmatch(r'\d+', str(pageid)) or not re.fullmatch(r'\d{1,5}', str(index)):
        raise ValueError('Invalid Wikipedia section identifier')
    def lookup():
        data = wiki(action='parse', pageid=pageid, section=index, prop='text', disableeditsection=1)
        if 'error' in data:
            raise ValueError('Wikipedia section not found')
        text = data.get('parse', {}).get('text', '')
        if isinstance(text, dict):
            text = text.get('*', '')
        parser = ArticleTextParser()
        parser.feed(text)
        return {'text': parser.text()}
    return cached('wiki-section:' + str(pageid) + ':' + str(index), 86400, lookup)[0]


def profile(pageid):
    if not re.fullmatch(r'\d+', str(pageid)):
        raise ValueError('Invalid Wikipedia page identifier')
    def lookup():
        data = wiki(action='query', pageids=pageid, prop='extracts|pageprops|info|coordinates',
                    exintro=1, explaintext=1, inprop='url', coprimary='primary')
        pages = data.get('query', {}).get('pages', [])
        if not pages or pages[0].get('missing'):
            raise ValueError('Wikipedia article not found')
        page = pages[0]
        qid = page.get('pageprops', {}).get('wikibase_item')
        result = dict(title=page['title'], extract=page.get('extract', '')[:4000],
                      pageid=page['pageid'], url=page.get('fullurl', ''), hierarchy=[], facts=[],
                      wikidata=qid, infobox=[], sections=[], coordinates=page.get('coordinates', [None])[0])
        try:
            result.update(article_details(pageid))
        except Exception:
            result['infoboxNotice'] = 'Wikipedia facts are temporarily unavailable.'
        if not qid:
            return result
        try:
            entity = entities({qid}).get(qid, {})
            parent, country = target(entity, 'P131'), target(entity, 'P17')
            related = entities({x for x in (parent, country) if x and x != qid})
            ancestor = parent
            for _ in range(2):
                ancestor = target(related.get(ancestor, {}), 'P131') if ancestor else None
                if not ancestor or ancestor == country or ancestor in related or ancestor == qid:
                    break
                related.update(entities({ancestor}))
            chain = []
            ancestor = parent
            while ancestor and ancestor != qid and ancestor not in chain and ancestor != country:
                chain.append(ancestor)
                ancestor = target(related.get(ancestor, {}), 'P131')
                if ancestor not in related:
                    break
            for role, rid in [('Administrative area', rid) for rid in chain] + [('Country', country)]:
                if not rid or rid == qid or any(x['id'] == rid for x in result['hierarchy']):
                    continue
                e = related.get(rid, {})
                label = e.get('labels', {}).get('en', {}).get('value', rid)
                title = e.get('sitelinks', {}).get('enwiki', {}).get('title', label)
                result['hierarchy'].append(dict(id=rid, label=label, title=title, role=role))
            populations = claim(entity, 'P1082')
            def population_date(v):
                return v.get('qualifiers', {}).get('P585', [{}])[0].get('datavalue', {}).get('value', {}).get('time', '')
            if populations:
                pop = max(populations, key=population_date)
                amount = pop.get('mainsnak', {}).get('datavalue', {}).get('value', {}).get('amount')
                if amount:
                    year = population_date(pop)[1:5]
                    result['facts'].append(dict(label='Population' + (f' ({year})' if year else ' (date unavailable)'), value=f'{int(float(amount)):,}'))
        except Exception:
            result['notice'] = 'Wikidata facts are temporarily unavailable.'
        return result
    return cached('profile:v5:' + str(pageid), 86400, lookup, stale=True)[0]


def theme():
    for path in [Path.home() / '.local/state/omarchy/current/theme/colors.toml',
                 Path.home() / '.config/omarchy/current/theme/colors.toml']:
        try:
            data = tomllib.loads(path.read_text())
            colors = {key: value for key, value in data.items()
                      if isinstance(value, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', value)}
            return {**FALLBACK, **colors}
        except (OSError, ValueError):
            pass
    return FALLBACK


def article_url(value):
    if not isinstance(value, str) or len(value) > 12000 or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid article address')
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('The article reader accepts web links only')
    return value


def open_reader(url):
    url = article_url(url)
    electron = shutil.which('electron')
    if not electron:
        raise OSError('Electron is not installed')
    STATE.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.pop('ELECTRON_RUN_AS_NODE', None)
    with (STATE / 'reader.log').open('a') as log:
        subprocess.Popen([electron, '--class=news-osint-reader', str(ROOT / 'reader/main.cjs'), url],
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env,
                         start_new_session=True, cwd=ROOT)
    return {'opened': True}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        host = self.headers.get('Host', '')
        if (host.split(':')[0] not in ('127.0.0.1', 'localhost')
                or self.headers.get('Origin') != 'http://' + host
                or self.headers.get('X-News-OSINT') != 'reader'):
            self.send_error(403)
            return
        if self.path != '/api/reader':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16000:
                raise ValueError('Invalid reader request')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Invalid reader request')
            self.respond(json.dumps(open_reader(data.get('url'))).encode(), 'application/json')
        except ValueError as exc:
            self.respond(json.dumps({'error': str(exc)}).encode(), 'application/json', 400)
        except OSError:
            self.respond(json.dumps({'error': 'The article reader could not start. Use Open in browser instead.'}).encode(), 'application/json', 503)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query, keep_blank_values=True).items()}
        if self.headers.get('Host', '').split(':')[0] not in ('127.0.0.1', 'localhost'):
            self.send_error(403)
            return
        try:
            routes = {'/api/health': lambda: {'app': 'news-osint', 'version': '0.1'},
                      '/api/theme': theme, '/api/news': lambda: news(params),
                      '/api/places': lambda: places(params.get('q', '')),
                      '/api/wiki-search': lambda: wikipedia_search(params.get('q', '')),
                      '/api/wiki-section': lambda: wikipedia_section(params.get('id', ''), params.get('section', '')),
                      '/api/profile': lambda: profile(params.get('id', ''))}
            if parsed.path in routes:
                self.respond(json.dumps(routes[parsed.path]()).encode(), 'application/json')
                return
            relative = urllib.parse.unquote(parsed.path).lstrip('/') or 'index.html'
            path = (ROOT / 'static' / relative).resolve()
            if not path.is_relative_to(ROOT / 'static') or not path.is_file():
                self.send_error(404)
                return
            mime = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
                    '.svg': 'image/svg+xml', '.json': 'application/json'}.get(path.suffix, 'application/octet-stream')
            self.respond(path.read_bytes(), mime)
        except ValueError as exc:
            self.respond(json.dumps({'error': str(exc)}).encode(), 'application/json', 400)
        except Exception as exc:
            self.log_error('%s', type(exc).__name__)
            self.respond(json.dumps({'error': 'Source unavailable. Check your connection and try again.'}).encode(), 'application/json', 502)

    def respond(self, body, mime, status=200):
        self.send_response(status)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; worker-src blob: 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=47831)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'News-OSINT listening on http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
