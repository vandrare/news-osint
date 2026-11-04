'use strict';
import * as maplibregl from './vendor/maplibre-gl.mjs';
maplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs', import.meta.url).href);
const $ = (id) => document.getElementById(id);
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const state = {items: [], selected: null, place: null, pendingStory: null, map: null, markers: [], theme: {}, request: 0, placeRequest: 0, profileRequest: 0, refreshTimer: null};
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Local storage is unavailable. Changes will last for this session.'); } }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
async function get(url) { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; }
function link(label, url) { const el = make('a', label); try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return make('span', label); } catch { return make('span', label); } el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; return el; }
function button(text, onClick) { const el = make('button', text); el.type = 'button'; el.addEventListener('click', onClick); return el; }
function articleLink(label, url) {
  const el = link(label, url);
  el.addEventListener('click', async event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      const response = await fetch('/api/reader', {method:'POST', headers:{'Content-Type':'application/json','X-News-OSINT':'reader'}, body:JSON.stringify({url})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The article reader could not start.');
      $('footer-status').textContent = 'Article opened in floating reader';
    } catch (error) { toast(error.message); }
  });
  return el;
}
function filters() { return {q: $('query').value.trim(), hours: $('hours').value, sources: [...document.querySelectorAll('fieldset input:checked')].map(x => x.value).join(',')}; }
function restoreFilters(value) { if (!value || typeof value !== 'object') return; $('query').value = value.q || ''; $('hours').value = value.hours || '0'; if (typeof value.sources === 'string') document.querySelectorAll('fieldset input').forEach(el => el.checked = value.sources.split(',').includes(el.value)); }
function dateLabel(timestamp) { if (!timestamp) return 'Date unavailable'; return new Date(timestamp * 1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function empty(title, message) { const box = make('div', undefined, 'empty'); box.append(make('span', '◎', 'empty-symbol'), make('h3', title), make('p', message)); return box; }

async function loadNews() {
  const request = ++state.request;
  const active = filters(); writeStore('news-osint.filters', active);
  $('stories').setAttribute('aria-busy', 'true'); $('refresh-now').disabled = true;
  $('footer-status').textContent = 'Checking sources…'; $('news-notice').hidden = true;
  try {
    const data = await get('/api/news?' + new URLSearchParams(active));
    if (request !== state.request) return;
    state.items = data.items; renderStories(); syncMarkers();
    $('results-title').textContent = active.q ? 'Search coverage' : 'Latest coverage';
    $('result-count').textContent = `${data.items.length} stories · ${data.collected} checked`;
    $('checked-at').textContent = 'Checked ' + new Date(data.checkedAt * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const health = $('source-health'); health.replaceChildren();
    for (const source of data.sources) {
      const row = make('div', undefined, 'source-row'); row.dataset.state = source.status;
      const name = make('span'); name.append(make('i'), document.createTextNode(source.name));
      const description = source.status === 'error' ? 'UNAVAILABLE' : `${source.count} · ${source.status === 'cached' ? 'STALE CACHE' : 'OK'}`;
      row.append(name, make('span', description));
      row.title = source.fetchedAt ? 'Last collected ' + dateLabel(source.fetchedAt) : source.error || '';
      health.append(row);
    }
    const unavailable = data.sources.filter(s => s.status !== 'ok');
    if (unavailable.length) { $('news-notice').hidden = false; $('news-notice').textContent = unavailable.map(s => `${s.name}: ${s.status === 'cached' ? 'showing previously collected stories' : 'temporarily unavailable'}`).join(' · '); }
    $('footer-status').textContent = `${data.sources.filter(s => s.status !== 'error').length}/${data.sources.length} sources · RSS refresh cache: 5 min`;
  } catch (error) {
    if (request !== state.request) return;
    $('news-notice').hidden = false; $('news-notice').textContent = error.message + (state.items.length ? ' Previous results remain below.' : '');
    if (!state.items.length) $('stories').replaceChildren(empty('Could not load coverage.', 'Check your connection, then refresh to try again.'));
    $('footer-status').textContent = 'News refresh failed';
  } finally { if (request === state.request) { $('stories').setAttribute('aria-busy', 'false'); $('refresh-now').disabled = false; } }
}

function renderStories() {
  const fragment = document.createDocumentFragment();
  if (!state.items.length) fragment.append(empty('No matching coverage.', 'Try broader terms, a longer date range, or more sources. RSS feeds contain a limited selection of recent stories.'));
  for (const item of state.items) {
    const article = make('article', undefined, 'story' + (state.selected === item.id ? ' selected' : '')); article.dataset.id = item.id;
    const meta = make('div', undefined, 'story-meta'); meta.append(make('span', item.source, 'source-tag'));
    if (item.via) meta.append(make('span', 'via ' + item.via));
    meta.append(make('span', '·'), make('time', dateLabel(item.timestamp)));
    const title = make('h3'); title.append(articleLink(item.title, item.url)); article.append(meta, title);
    if (item.summary) article.append(make('p', item.summary));
    const actions = make('div', undefined, 'story-actions'); actions.append(articleLink('Read article ↗', item.url));
    const external = link('Open in browser ↗', item.url); external.className = 'external-story-link'; actions.append(external);
    actions.append(button('Locate', () => locateStory(item)), button('Copy link', async () => { try { await navigator.clipboard.writeText(item.url); toast('Story link copied.'); } catch { toast('Could not copy. Open the publisher link to copy its address.'); } }));
    article.append(actions);
    const location = readStore('news-osint.locations', {})[item.id];
    if (location) {
      const chosen = button('⌖ ' + location.title + ' · manually linked', () => choosePlace(location, item)); chosen.className = 'story-location';
      article.append(chosen);
    }
    fragment.append(article);
  }
  $('stories').replaceChildren(fragment);
}

function locateStory(item) {
  state.selected = item.id; state.pendingStory = item; renderStories();
  document.body.classList.remove('hide-right');
  $('place-results').replaceChildren(make('p', 'Enter a place mentioned in this story, then choose a match. The pin records your selection, not a verified event location.'));
  $('place-query').focus();
  $('footer-status').textContent = 'Locate: ' + item.title;
}

async function findPlaces(query) {
  const request = ++state.placeRequest;
  $('place-results').replaceChildren(make('p', 'Finding places…'));
  try {
    const results = await get('/api/places?' + new URLSearchParams({q: query}));
    if (request !== state.placeRequest) return;
    $('place-results').replaceChildren();
    if (!results.length) { $('place-results').append(make('p', 'No geolocated article found. Try the city and country, another spelling, or latitude, longitude.')); return; }
    for (const place of results) {
      const choice = button(place.title, () => choosePlace(place, state.pendingStory)); choice.className = 'place-choice';
      if (place.description) choice.append(make('small', place.description));
      $('place-results').append(choice);
    }
  } catch (error) { if (request === state.placeRequest) $('place-results').replaceChildren(make('p', error.message)); }
}

function switchSearchTab(tab) {
  const wikipedia = tab === 'wikipedia';
  for (const name of ['news','wikipedia']) {
    const selected = name === (wikipedia ? 'wikipedia' : 'news');
    $('tab-'+name).setAttribute('aria-selected', String(selected));
    $('tab-'+name).tabIndex = selected ? 0 : -1;
  }
  $('news-controls').hidden = wikipedia; $('wiki-controls').hidden = !wikipedia;
  writeStore('news-osint.search-tab', wikipedia ? 'wikipedia' : 'news');
}

async function searchWikipedia() {
  const query = $('wiki-query').value.trim();
  if (!query) { $('wiki-query').focus(); return; }
  const request = state.wikiRequest = (state.wikiRequest || 0) + 1;
  writeStore('news-osint.wiki-query', query);
  const results = $('wiki-results'); results.replaceChildren(make('p','Searching Wikipedia…','muted')); results.setAttribute('aria-busy','true');
  try {
    const entries = await get('/api/wiki-search?' + new URLSearchParams({q:query}));
    if (request !== state.wikiRequest) return;
    results.replaceChildren();
    if (!entries.length) results.append(make('p','No matching articles. Try another name or a broader subject.','muted'));
    for (const entry of entries) {
      const item = button(entry.title, () => {
        state.pendingStory = null;
        document.body.classList.remove('hide-right','map-expanded'); $('expand-map').textContent = '⤢ Expand';
        showReference(entry.pageid,entry.title,'WIKIPEDIA REFERENCE',true);
        if (innerWidth<=760) document.body.classList.add('hide-left');
      });
      item.className = 'wiki-result';
      if (entry.description) item.append(make('small',entry.description));
      results.append(item);
    }
  } catch (error) { if (request===state.wikiRequest) results.replaceChildren(make('p',error.message,'muted')); }
  finally { if(request===state.wikiRequest) results.setAttribute('aria-busy','false'); }
}

function addMarker(place, item = null) {
  if (!state.map) return;
  if (!item && state.placeMarker) state.placeMarker.remove();
  if (item) { const previous = state.markers.find(m => m.id === item.id); if (previous) previous.marker.remove(); state.markers = state.markers.filter(m => m.id !== item.id); }
  const element = make('button', undefined, 'map-pin'); element.type = 'button'; element.setAttribute('aria-label', item ? item.title : place.title);
  const content = make('div'); content.append(make('strong', place.title));
  if (item) { content.append(make('p', item.title), articleLink('Read story ↗', item.url), make('p', 'Manually linked location')); }
  const marker = new maplibregl.Marker({element}).setLngLat([place.lon, place.lat]).setPopup(new maplibregl.Popup({offset:12}).setDOMContent(content)).addTo(state.map);
  element.addEventListener('click', () => { if (item) { state.selected = item.id; renderStories(); document.querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}); } });
  if (item) state.markers.push({id:item.id, marker}); else state.placeMarker = marker;
}

function syncMarkers() {
  if (!state.map) return;
  const locations = readStore('news-osint.locations', {});
  const activeIds = new Set(state.items.map(item => item.id));
  for (const old of state.markers) if (!activeIds.has(old.id)) old.marker.remove();
  state.markers = state.markers.filter(old => activeIds.has(old.id));
  for (const item of state.items) if (locations[item.id] && !state.markers.some(old => old.id === item.id)) addMarker(locations[item.id], item);
}

async function choosePlace(place, item = null) {
  ++state.placeRequest;
  state.place = place; state.pendingStory = null; $('place-query').value = place.title; $('place-results').replaceChildren();
  $('coordinates').textContent = `${Number(place.lat).toFixed(3)}°, ${Number(place.lon).toFixed(3)}°`;
  if (state.map) { state.map.resize(); state.map.flyTo({center:[place.lon,place.lat], zoom:place.title.includes(',') && !place.pageid ? 10 : 8, essential:false}); }
  addMarker(place, item);
  if (item) { const locations = readStore('news-osint.locations', {}); locations[item.id] = place; writeStore('news-osint.locations', locations); renderStories(); }
  $('right').scrollTo({top:0,behavior:'smooth'});
  if (!place.pageid) { ++state.profileRequest; const info=$('location-info'); info.replaceChildren(make('h2',place.title),make('p', 'Coordinate selected. Search for a nearby city to load its Wikipedia profile.', 'muted')); return; }
  await showReference(place.pageid,place.title,'PLACE CONTEXT');
}

async function showReference(pageid, title, context, topic=false) {
  const request = ++state.profileRequest;
  const info = $('location-info'); info.replaceChildren(make('span',context,'eyebrow'),make('h2',title));
  info.append(make('p', 'Loading Wikipedia and Wikidata…', 'muted'));
  try {
    const data = await get('/api/profile?id=' + encodeURIComponent(pageid));
    if (request !== state.profileRequest) return;
    info.replaceChildren(make('span', context, 'eyebrow'), make('h2', data.title));
    const crumbs = make('div', undefined, 'breadcrumbs');
    for (const parent of data.hierarchy) { const control = button(parent.label + ' ↗', () => { state.pendingStory = null; findPlaces(parent.title); }); control.title = 'Find ' + parent.role.toLowerCase(); crumbs.append(control); }
    info.append(crumbs);
    for (const fact of data.facts) { const row = make('div', undefined, 'fact'); row.append(make('span', fact.label), make('strong', fact.value)); info.append(row); }
    const filter = button('Search news about this ↗', () => { $('query').value = '"' + data.title.replace(/\s*\([^)]*\)\s*$/, '').replaceAll('"','') + '"'; switchSearchTab('news'); loadNews(); if (innerWidth <= 760) document.body.classList.add('hide-right'); }); filter.className = 'primary'; info.append(filter);
    const reading = make('div',undefined,'reference-actions'); reading.append(articleLink('Read full article ↗',data.url));
    if (topic && data.coordinates) reading.append(button('Show on map',()=>choosePlace({pageid:data.pageid,title:data.title,lat:data.coordinates.lat,lon:data.coordinates.lon})));
    info.append(reading);
    const excerpt = data.extract || 'No introduction is available for this article.';
    const text = make('p', excerpt.length > 1050 ? excerpt.slice(0, 1050).replace(/\s+\S*$/, '') + '…' : excerpt, 'muted'); info.append(text);
    if (excerpt.length > 1050) info.append(button('Read more background', (event) => { text.textContent = excerpt; event.currentTarget.remove(); }));
    if (data.notice) info.append(make('p', data.notice, 'muted'));
    if (data.infobox?.length) {
      const facts = make('details', undefined, 'wiki-facts'); facts.open = true;
      facts.append(make('summary', 'Wikipedia facts'));
      const table = make('dl');
      for (const fact of data.infobox) table.append(make('dt', fact.label), make('dd', fact.value));
      facts.append(table); info.append(facts);
    } else if (data.infoboxNotice) info.append(make('p', data.infoboxNotice, 'muted'));
    else info.append(make('p', 'This article has no facts table available.', 'attribution'));
    if (data.sections?.length) {
      const sections = make('section',undefined,'wiki-sections'); sections.append(make('h3','Explore this article'));
      for (const section of data.sections) {
        const details = make('details'); details.append(make('summary',section.title));
        const body = make('p',undefined,'section-text muted'); details.append(body);
        let loaded=false, loading=false;
        details.addEventListener('toggle',async()=>{
          if (!details.open || loaded || loading) return;
          loading=true; body.textContent='Loading section…';
          try { const result=await get('/api/wiki-section?'+new URLSearchParams({id:data.pageid,section:section.index})); body.textContent=result.text||'No readable text in this section.';loaded=true; }
          catch(error) { body.textContent=error.message+' Close and reopen this section to retry.'; }
          finally { loading=false; }
        });
        sections.append(details);
      }
      info.append(sections);
    }
    const sources = make('div', undefined, 'profile-links'); sources.append(link('Wikipedia ↗', data.url));
    if (data.wikidata) sources.append(link('Wikidata ↗', 'https://www.wikidata.org/wiki/' + data.wikidata));
    info.append(sources, make('p', 'Wikipedia text: CC BY-SA 4.0 · Wikidata: CC0. Background information may lag current events.', 'attribution'));
    if(topic) info.scrollIntoView({block:'start',behavior:'smooth'});
  } catch (error) { if (request === state.profileRequest) info.replaceChildren(make('h2', title), make('p', error.message, 'muted')); }
}

function renderSaved() {
  const saved = readStore('news-osint.saved', []); $('saved-count').textContent = saved.length;
  $('saved-list').replaceChildren();
  if (!saved.length) $('saved-list').append(make('p', 'Keep a useful query here to return to it later.'));
  saved.forEach((entry, index) => {
    const row = make('div', undefined, 'saved-item');
    row.append(button(entry.q || 'All coverage', () => { restoreFilters(entry); loadNews(); }), button('×', () => { saved.splice(index,1); writeStore('news-osint.saved', saved); renderSaved(); }));
    row.lastChild.setAttribute('aria-label', 'Remove saved search ' + (entry.q || 'All coverage')); $('saved-list').append(row);
  });
}

function mixColor(first, second, ratio) {
  const a = first.slice(1).match(/../g).map(x => parseInt(x, 16));
  const b = second.slice(1).match(/../g).map(x => parseInt(x, 16));
  return '#' + a.map((x, i) => Math.round(x * (1-ratio) + b[i] * ratio).toString(16).padStart(2,'0')).join('');
}
function paintMap() {
  if (!state.map?.isStyleLoaded()) return;
  const t = state.theme;
  const land = t.background;
  const water = mixColor(t.background, t.blue, .15);
  const coast = mixColor(t.blue, t.foreground, .25);
  for (const layer of state.map.getStyle().layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === 'background') state.map.setPaintProperty(layer.id, 'background-color', land);
      if (layer.type === 'fill') {
        const isWater = layer['source-layer'] === 'water' || /water/.test(id);
        state.map.setPaintProperty(layer.id, 'fill-color', isWater ? water : /park|wood|forest|grass/.test(id) ? mixColor(land,t.green,.16) : /building/.test(id) ? t.lighter_background : land);
        if (isWater) state.map.setPaintProperty(layer.id, 'fill-outline-color', coast);
      }
      if (layer.type === 'line') state.map.setPaintProperty(layer.id, 'line-color', /water/.test(id) ? t.blue : /boundary/.test(id) ? t.accent : t.selection);
      if (layer.type === 'symbol' && layer.layout?.['text-field']) { state.map.setPaintProperty(layer.id, 'text-color', /water/.test(id) ? t.blue : t.foreground); state.map.setPaintProperty(layer.id, 'text-halo-color', t.background); }
      if (layer.type === 'symbol' && /country/.test(id)) state.map.setLayoutProperty(layer.id, 'visibility', 'none');
      if (layer.type === 'fill-extrusion') state.map.setPaintProperty(layer.id, 'fill-extrusion-color', t.lighter_background);
    } catch { /* Optional style properties differ by provider. */ }
  }
}
async function loadTheme() {
  try {
    const theme = await get('/api/theme');
    if (JSON.stringify(theme) === JSON.stringify(state.theme)) return;
    state.theme = theme;
    const keys = {background:'bg',dark_background:'panel',foreground:'fg',muted:'muted',accent:'accent',selection:'line',lighter_background:'raised',blue:'blue',green:'good',red:'bad'};
    for (const [key, css] of Object.entries(keys)) document.documentElement.style.setProperty('--' + css, theme[key]);
    const rgb = theme.background.slice(1).match(/../g).map(x => parseInt(x,16));
    document.documentElement.style.colorScheme = (rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722) > 140 ? 'light' : 'dark';
    state.needsMapPaint = true; paintMap();
  } catch { /* The existing palette remains usable if the local server stops. */ }
}
function initMap() {
  try {
    state.map = new maplibregl.Map({container:'map', style:'https://tiles.openfreemap.org/styles/positron',center:[15,25],zoom:1.4,attributionControl:true});
    state.map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
    state.map.on('load', () => { $('map-status').hidden = true; paintMap(); syncMarkers(); });
    state.map.on('error', () => { $('map-status').hidden = false; $('map-status').textContent = 'Some map data could not load. Check your connection; place search and news still work.'; });
    state.map.on('idle', () => { if (state.map.areTilesLoaded()) $('map-status').hidden = true; if (state.needsMapPaint) { state.needsMapPaint = false; paintMap(); } });
    new ResizeObserver(() => state.map.resize()).observe($('map-wrap'));
  } catch { $('map-status').textContent = 'Map needs WebGL support. News and place profiles remain available.'; }
}

function applyLayout() {
  const layout = readStore('news-osint.layout', {left:25,right:25});
  document.documentElement.style.setProperty('--left', Math.max(15,Math.min(35,Number(layout.left) || 25)) + '%');
  document.documentElement.style.setProperty('--right', Math.max(18,Math.min(50,Number(layout.right) || 25)) + '%');
}
function resizeDivider(id, side) {
  const divider = $(id);
  function set(value) {
    const layout = readStore('news-osint.layout', {left:25,right:25});
    const other = Number(layout[side === 'left' ? 'right' : 'left']) || 25;
    layout[side] = Math.max(side === 'left' ? 15 : 18, Math.min(side === 'left' ? 35 : 50, 70 - other, value));
    writeStore('news-osint.layout', layout); applyLayout();
  }
  divider.addEventListener('pointerdown', (event) => {
    divider.setPointerCapture(event.pointerId);
    const move = e => { const box = $('workspace').getBoundingClientRect(); set((side === 'left' ? e.clientX - box.left : box.right - e.clientX) / box.width * 100); };
    const stop = () => { divider.removeEventListener('pointermove',move); divider.removeEventListener('pointerup',stop); divider.removeEventListener('pointercancel',stop); };
    divider.addEventListener('pointermove',move); divider.addEventListener('pointerup',stop); divider.addEventListener('pointercancel',stop);
  });
  divider.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--'+side)); set(current + ((event.key === 'ArrowRight') === (side === 'left') ? 2 : -2)); } });
}

$('search-form').addEventListener('submit', event => { event.preventDefault(); loadNews(); if (innerWidth <= 760) document.body.classList.add('hide-left'); });
$('wiki-form').addEventListener('submit', event=>{event.preventDefault();searchWikipedia();});
for (const name of ['news','wikipedia']) {
  $('tab-'+name).addEventListener('click',()=>switchSearchTab(name));
  $('tab-'+name).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=name==='news'?'wikipedia':'news';switchSearchTab(next);$('tab-'+next).focus();}});
}
$('refresh-now').addEventListener('click', loadNews);
$('place-form').addEventListener('submit', event => { event.preventDefault(); if ($('place-query').value.trim()) findPlaces($('place-query').value.trim()); });
$('save-search').addEventListener('click', () => { const saved = readStore('news-osint.saved', []), entry = filters(); if (saved.some(x => JSON.stringify(x) === JSON.stringify(entry))) { toast('This search is already saved.'); return; } saved.push(entry); writeStore('news-osint.saved', saved); renderSaved(); toast('Search saved.'); });
$('google').addEventListener('click', () => { let q = $('query').value.trim(); if (!q) { toast('Enter a topic to research in Google.'); return; } const hours = Number($('hours').value); if (hours) q += ' after:' + new Date(Date.now()-hours*3600000).toISOString().slice(0,10); window.open('https://www.google.com/search?' + new URLSearchParams({q,tbm:'nws'}), '_blank', 'noopener,noreferrer'); });
$('refresh').addEventListener('change', () => { clearInterval(state.refreshTimer); const minutes = Number($('refresh').value); writeStore('news-osint.refresh', minutes); if (minutes) state.refreshTimer = setInterval(() => { if (!document.hidden) loadNews(); }, minutes*60000); });
$('world').addEventListener('click', () => state.map?.flyTo({center:[15,25],zoom:1.4}));
$('toggle-left').addEventListener('click', () => { document.body.classList.remove('map-expanded'); $('expand-map').textContent = '⤢ Expand'; document.body.classList.toggle('hide-left'); });
$('toggle-right').addEventListener('click', () => { document.body.classList.remove('map-expanded'); $('expand-map').textContent = '⤢ Expand'; document.body.classList.toggle('hide-right'); });
$('expand-map').addEventListener('click', () => { document.body.classList.remove('hide-right'); document.body.classList.toggle('map-expanded'); $('expand-map').textContent = document.body.classList.contains('map-expanded') ? '⤡ Restore' : '⤢ Expand'; });
$('reset-layout').addEventListener('click', () => { writeStore('news-osint.layout',{left:25,right:25}); document.body.classList.remove('hide-left','hide-right','map-expanded'); $('expand-map').textContent = '⤢ Expand'; applyLayout(); });
$('export').addEventListener('click', () => {
  if (!state.items.length) { toast('No stories to export.'); return; }
  const safe = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; };
  const rows = [['Title','Source','Published','URL','Publisher feed excerpt'],...state.items.map(i=>[i.title,i.source,i.published,i.url,i.summary])];
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a = make('a'); a.href = url; a.download = 'news-osint-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
restoreFilters(readStore('news-osint.filters', {})); renderSaved(); applyLayout();
$('wiki-query').value=readStore('news-osint.wiki-query','');
switchSearchTab(readStore('news-osint.search-tab','news'));
if(!$('wiki-controls').hidden && $('wiki-query').value)searchWikipedia();
if (!readStore('news-osint.google-initialized', false)) {
  document.querySelector('fieldset input[value="google"]').checked = true;
  writeStore('news-osint.google-initialized', true);
}
resizeDivider('divider-left','left'); resizeDivider('divider-right','right');
if (innerWidth <= 760) document.body.classList.add('hide-left','hide-right');
$('refresh').value = String(readStore('news-osint.refresh', 0)); $('refresh').dispatchEvent(new Event('change'));
loadTheme().then(initMap); setInterval(loadTheme, 3000); loadNews();
