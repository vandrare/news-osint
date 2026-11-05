'use strict';
import * as maplibregl from './vendor/maplibre-gl.mjs';
import {groupCoverage,googleResearchQuery,exportOpml,importOpml} from './research-utils.mjs';
maplibregl.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs', import.meta.url).href);
const $ = (id) => document.getElementById(id);
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const state = {items: [], selected: null, place: null, pendingStory: null, map: null, markers: [], theme: {}, request: 0, placeRequest: 0, profileRequest: 0, refreshTimer: null};
function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeStore(key, value) { try { localStorage.setItem(key, JSON.stringify(value));return true; } catch { toast('Local storage is unavailable. Changes will last for this session.');return false; } }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
async function get(url) { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; }
function link(label, url) { const el = make('a', label); try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return make('span', label); } catch { return make('span', label); } el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; return el; }
function button(text, onClick) { const el = make('button', text); el.type = 'button'; el.addEventListener('click', onClick); return el; }
async function openInReader(url) {
  const response=await fetch('/api/reader',{method:'POST',headers:{'Content-Type':'application/json','X-News-OSINT':'reader'},body:JSON.stringify({url})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The article reader could not start.');
  $('footer-status').textContent='Opened in floating reader';
}
function articleLink(label, url) {
  const el = link(label, url);
  el.addEventListener('click', async event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      await openInReader(url);
    } catch (error) { toast(error.message); }
  });
  return el;
}
function filters() { return {q: $('query').value.trim(), hours: $('hours').value, sources: [...document.querySelectorAll('#source-filters input:checked')].map(x => x.value).join(',')}; }
function restoreFilters(value) { if (!value || typeof value !== 'object') return; $('query').value = value.q || ''; $('hours').value = value.hours || '0'; if (typeof value.sources === 'string') document.querySelectorAll('#source-filters input').forEach(el => el.checked = value.sources.split(',').includes(el.value)); }
function dateLabel(timestamp) { if (!timestamp) return 'Date unavailable'; return new Date(timestamp * 1000).toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function empty(title, message) { const box = make('div', undefined, 'empty'); box.append(make('span', '◎', 'empty-symbol'), make('h3', title), make('p', message)); return box; }

const workspace=readStore('news-osint.workspace',{});
state.restoringWorkspace=true;
state.bookmarks=readStore('news-osint.bookmarks',{});state.view=workspace.view==='saved'?'saved':'news';
state.reference=workspace.reference||null;
function storyById(id){return state.items.find(item=>item.id===id)||state.bookmarks[id]?.item;}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=make('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function saveBookmarks(){writeStore('news-osint.bookmarks',state.bookmarks);$('saved-view').textContent='Saved'+(Object.keys(state.bookmarks).length?' ('+Object.keys(state.bookmarks).length+')':'');}
function bookmarkDetails(item,record) {
  const details=make('details',undefined,'bookmark-notes');details.open=state.view==='saved';details.append(make('summary','Notes & references'));
  const label=make('label','Research notes');const note=make('textarea');note.rows=4;note.maxLength=10000;note.placeholder='What matters about this story?';note.value=record.note||'';note.addEventListener('input',()=>{record.note=note.value;saveBookmarks();});label.append(note);details.append(label);
  const attachments=make('div',undefined,'bookmark-attachments');
  function renderAttachments(){attachments.replaceChildren();
    if(record.location)attachments.append(button('⌖ '+record.location.title,()=>choosePlace(record.location,item)),button('Remove location',()=>{delete record.location;saveBookmarks();renderAttachments();}));
    if(record.reference)attachments.append(button('Wikipedia: '+record.reference.title,()=>{document.body.classList.remove('hide-right');showReference(record.reference.pageid,record.reference.title,record.reference.context,record.reference.topic);}),button('Remove reference',()=>{delete record.reference;saveBookmarks();renderAttachments();}));
  }
  renderAttachments();details.append(attachments);
  const controls=make('div',undefined,'bookmark-attach-actions');controls.append(button('Attach current reference',()=>{if(!state.reference){toast('Select a Wikipedia article first.');return;}record.reference={...state.reference};saveBookmarks();renderAttachments();}),button('Attach current map location',()=>{if(!state.place){toast('Select a location first.');return;}record.location={...state.place};saveBookmarks();renderAttachments();}));details.append(controls);return details;
}

function saveWorkspace(){
  if(state.restoringWorkspace)return;
  const map=state.map?{center:state.map.getCenter().toArray(),zoom:state.map.getZoom(),bearing:state.map.getBearing(),pitch:state.map.getPitch()}:workspace.map;
  writeStore('news-osint.workspace',{map,reference:state.reference,place:state.place,selected:state.selected,view:state.view,
    panels:{left:document.body.classList.contains('hide-left'),right:document.body.classList.contains('hide-right'),expanded:document.body.classList.contains('map-expanded'),mobile:innerWidth<=760}});
}
function setView(view){state.view=view;document.body.classList.remove('map-expanded');$('expand-map').textContent='⤢ Expand';renderStories();saveWorkspace();}

function updateResearchQuery(){
  if($('research-preset').value==='custom')return;
  try{$('research-query').value=googleResearchQuery({subject:$('research-subject').value,preset:$('research-preset').value,site:$('research-sites').value,after:$('research-after').value,before:$('research-before').value,exclude:$('research-exclude').value});state.researchError=null;$('research-status').textContent='';}
  catch(error){state.researchError=error.message;$('research-status').textContent=error.message;}
}
function openResearch(subject='',query=null){hideSelectionTools();$('research-subject').value=subject;$('research-preset').value=query?'custom':'general';for(const id of ['sites','after','before','exclude'])$('research-'+id).value='';$('research-status').textContent='';if(query)$('research-query').value=query;else updateResearchQuery();$('research-dialog').showModal();}
function researchUrl(){if($('research-preset').value!=='custom'){updateResearchQuery();if(state.researchError)throw new Error(state.researchError);}const q=$('research-query').value.trim();if(!q)throw new Error('Enter a search query.');return 'https://www.google.com/search?'+new URLSearchParams({q});}

function renderSourceFilters(sources, selected=null) {
  const fieldset=$('source-filters');fieldset.replaceChildren(make('legend','Sources'));
  for (const source of sources.filter(s=>s.enabled)) {
    const label=make('label');const input=make('input');input.type='checkbox';input.value=source.id;
    input.checked=selected===null||selected.has(source.id);label.append(input,document.createTextNode(source.name));fieldset.append(label);
  }
  if(!sources.some(s=>s.enabled))fieldset.append(make('p','Enable or add feeds in Settings.','muted'));
}

async function loadSources() {
  let data;try{data=await get('/api/sources');writeStore('news-osint.source-cache',data);}catch(error){data=readStore('news-osint.source-cache',null);if(!data)throw error;}
  state.sources=data.sources;
  const saved=readStore('news-osint.filters',null);
  const known=new Set(readStore('news-osint.known-sources',['google','bbc','guardian','aljazeera','npr','france24']));
  const selected=saved&&typeof saved.sources==='string'?new Set(saved.sources.split(',')):null;
  if(selected)for(const source of data.sources)if(!known.has(source.id)&&source.enabled)selected.add(source.id);
  renderSourceFilters(data.sources,selected);
  writeStore('news-osint.known-sources',data.sources.map(s=>s.id));
}

async function settingsRequest(path,data) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-News-OSINT':'settings'},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Settings request failed.');return result;
}

function renderSettingsSources() {
  const list=$('settings-sources');list.replaceChildren();
  if(!state.sourceDraft.length)list.append(make('p','No sources in the list. Add a feed below.','muted'));
  for(const source of state.sourceDraft) {
    const card=make('div',undefined,'source-editor');card.dataset.sourceId=source.id;
    const nameLabel=make('label','Name');const name=make('input');name.value=source.name;name.maxLength=120;name.required=true;name.setAttribute('aria-label','Source name');name.addEventListener('input',()=>source.name=name.value);nameLabel.append(name);
    const urlLabel=make('label','Feed URL');const url=make('input');url.type='url';url.value=source.url;url.maxLength=4000;url.required=true;url.setAttribute('aria-label','Feed URL');url.addEventListener('input',()=>source.url=url.value);urlLabel.append(url);
    const controls=make('div',undefined,'source-editor-actions');const enabledLabel=make('label');const enabled=make('input');enabled.type='checkbox';enabled.checked=source.enabled;enabled.addEventListener('change',()=>source.enabled=enabled.checked);enabledLabel.append(enabled,document.createTextNode('Enabled'));
    const status=make('span',undefined,'feed-test-status');status.setAttribute('role','status');
    const check=button('Test feed',async()=>{
      if(!url.reportValidity())return;check.disabled=true;status.textContent='Checking…';
      try{const result=await settingsRequest('/api/sources/test',{id:source.id,url:source.url});status.textContent=`${result.count} ${result.count===1?'story':'stories'} found`;status.title=result.sample||'This feed is valid but currently empty.';}
      catch(error){status.textContent=error.message;}
      finally{check.disabled=false;}
    });
    const remove=button('Remove',()=>{state.sourceDraft=state.sourceDraft.filter(s=>s.id!==source.id);renderSettingsSources();});remove.setAttribute('aria-label','Remove '+source.name);
    controls.append(enabledLabel,check,remove);card.append(nameLabel,urlLabel,controls,status);
    if(source.id==='google')card.append(make('small','The default Google News URL also supports topic searches. A different URL is treated as a regular feed.','muted'));
    list.append(card);
  }
}

async function openSettings() {
  $('settings-open').disabled=true;
  try {
    const data=await get('/api/sources');state.sourceDraft=data.sources.map(s=>({...s}));renderSettingsSources();
    $('settings-status').textContent='';$('add-feed-form').reset();$('settings-dialog').showModal();
  } catch(error){toast(error.message);}
  finally{$('settings-open').disabled=false;}
}

async function saveSettings() {
  for(const input of document.querySelectorAll('.source-editor input:not([type=checkbox])'))if(!input.reportValidity())return;
  const previous=new Set((state.sources||[]).filter(s=>s.enabled).map(s=>s.id));
  const selected=new Set(filters().sources.split(','));$('settings-save').disabled=true;$('settings-status').textContent='Saving…';
  try {
    const data=await settingsRequest('/api/sources',{sources:state.sourceDraft});state.sources=data.sources;
    for(const source of data.sources)if(source.enabled&&!previous.has(source.id))selected.add(source.id);
    renderSourceFilters(data.sources,selected);writeStore('news-osint.known-sources',data.sources.map(s=>s.id));
    $('settings-dialog').close();toast('News sources saved.');loadNews();
  } catch(error){$('settings-status').textContent=error.message;}
  finally{$('settings-save').disabled=false;}
}

async function loadNews(options={}) {
  if(!options?.background){state.view='news';document.body.classList.remove('map-expanded');$('expand-map').textContent='⤢ Expand';}
  const request = ++state.request;
  const active = filters(); writeStore('news-osint.filters', active);
  $('stories').setAttribute('aria-busy', 'true'); $('refresh-now').disabled = true;
  $('footer-status').textContent = 'Checking sources…'; $('news-notice').hidden = true;
  try {
    const data = await get('/api/news?' + new URLSearchParams(active));
    if (request !== state.request) return;
    state.items = data.items;writeStore('news-osint.last-news',{data,filters:active});
    if(state.view!=='saved')renderStories();syncMarkers();
    $('checked-at').textContent = 'Checked ' + new Date(data.checkedAt * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const health = $('source-health'); health.replaceChildren();
    for (const source of data.sources) {
      const row = make('div', undefined, 'source-row'); row.dataset.state = source.status;
      const name = make('span'); name.append(make('i'), document.createTextNode(source.name));
      const description = source.status === 'error' ? 'NO CACHE' : `${source.count} · ${source.status === 'cached' ? 'OFFLINE CACHE' : 'COLLECTED'}`;
      row.append(name, make('span', description));
      row.title = source.fetchedAt ? 'Last collected ' + dateLabel(source.fetchedAt) : source.error || '';
      health.append(row);
      if(source.fetchedAt)health.append(make('div','Collected '+dateLabel(source.fetchedAt),'source-collected'));
    }
    const unavailable = data.sources.filter(s => s.status !== 'ok');
    if (unavailable.length) { $('news-notice').hidden = false; $('news-notice').textContent = unavailable.map(s => `${s.name}: ${s.status === 'cached' ? 'showing previously collected stories' : 'temporarily unavailable'}`).join(' · '); }
    $('footer-status').textContent = `${data.sources.filter(s => s.status !== 'error').length}/${data.sources.length} sources · RSS refresh cache: 5 min`;
    $('connection-status').textContent=!navigator.onLine?'Offline · showing collected coverage':data.sources.some(s=>s.status==='cached')?'Using cached coverage':unavailable.length?unavailable.length+' sources unavailable':'Coverage current';
    saveWorkspace();
  } catch (error) {
    if (request !== state.request) return;
    const last=readStore('news-osint.last-news',null),matches=last&&JSON.stringify(last.filters)===JSON.stringify(active);
    if(matches){state.items=last.data.items;if(state.view!=='saved')renderStories();syncMarkers();}
    else if(state.view!=='saved'){state.items=[];renderStories();}
    $('news-notice').hidden = false; $('news-notice').textContent = error.message + (matches?' Showing saved results checked '+dateLabel(last.data.checkedAt)+'.':' No saved results for this search.');
    $('connection-status').textContent='Refresh unavailable · cached data only';
    $('footer-status').textContent = 'News refresh failed';
  } finally { if (request === state.request) { $('stories').setAttribute('aria-busy', 'false'); $('refresh-now').disabled = false; } }
}

function renderStories() {
  hideSelectionTools();
  const saved=state.view==='saved';
  const items=saved?Object.values(state.bookmarks).sort((a,b)=>b.savedAt-a.savedAt).map(record=>record.item):state.items;
  const groups=!saved&&$('group-coverage').checked?groupCoverage(items):items.map(item=>[item]);
  $('results-title').textContent=saved?'Saved research':filters().q?'Search coverage':'Latest coverage';
  $('result-count').textContent=`${items.length} ${saved?'saved stories':'stories'}`+(!saved&&groups.length<items.length?` · ${groups.length} groups`:'');
  $('view-news').hidden=!saved;$('export-research').hidden=!saved;$('group-coverage').parentElement.hidden=saved;
  $('saved-view').setAttribute('aria-pressed',String(saved));
  $('checked-at').hidden=saved;$('refresh-now').hidden=saved;
  const fragment=document.createDocumentFragment();
  if(!items.length)fragment.append(empty(saved?'No saved stories yet.':'No matching coverage.',saved?'Use Save on a story to keep it with your notes and references.':'Try broader terms, a longer date range, or more sources.'));
  for(const group of groups){
    if(group.length===1){fragment.append(makeStory(group[0]));continue;}
    const container=make('section',undefined,'coverage-group');container.append(make('div',`${group.length} reports · similar headlines`,'coverage-label'),makeStory(group[0]));
    const others=make('details',undefined,'other-coverage');others.append(make('summary',`Other coverage (${group.length-1})`));
    for(const item of group.slice(1))others.append(makeStory(item));container.append(others);fragment.append(container);
  }
  $('stories').replaceChildren(fragment);saveBookmarks();
}
function makeStory(item) {
  const article=make('article',undefined,'story'+(state.selected===item.id?' selected':''));article.dataset.id=item.id;
  const meta=make('div',undefined,'story-meta');meta.append(make('span',item.source,'source-tag'));
  if(item.via)meta.append(make('span','via '+item.via));meta.append(make('span','·'),make('time',dateLabel(item.timestamp)));
  article.append(meta,make('h3',item.title,'research-text'));if(item.summary)article.append(make('p',item.summary,'research-text'));
  const actions=make('div',undefined,'story-actions');actions.append(articleLink('Read article ↗',item.url));
  const external=link('Open in browser ↗',item.url);external.className='external-story-link';actions.append(external);
  actions.append(button(state.bookmarks[item.id]?'Saved ✓':'Save',()=>{
    if(state.bookmarks[item.id])delete state.bookmarks[item.id];
    else state.bookmarks[item.id]={item:{...item},savedAt:Date.now(),note:'',location:readStore('news-osint.locations',{})[item.id]||null};
    saveBookmarks();renderStories();
  }),button('Locate',()=>locateStory(item)),button('Copy link',async()=>{try{await navigator.clipboard.writeText(item.url);toast('Story link copied.');}catch{toast('Could not copy. Open the publisher link to copy its address.');}}));
  article.append(actions);
  const location=readStore('news-osint.locations',{})[item.id]||state.bookmarks[item.id]?.location;
  if(location){const chosen=button('⌖ '+location.title+' · manually linked',()=>choosePlace(location,item));chosen.className='story-location';article.append(chosen);}
  if(state.bookmarks[item.id])article.append(bookmarkDetails(item,state.bookmarks[item.id]));return article;
}

let selectingText=false, researchSelection=null;
function hideSelectionTools() { $('selection-tools').hidden=true;researchSelection=null; }
function showSelectionTools() {
  if(selectingText || $('settings-dialog').open || $('research-dialog').open)return;
  const selection=window.getSelection();
  if(!selection || selection.isCollapsed || selection.rangeCount!==1){hideSelectionTools();return;}
  const text=selection.toString().replace(/\s+/g,' ').trim();
  const element=node=>node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  const start=element(selection.anchorNode)?.closest('.research-text');
  const end=element(selection.focusNode)?.closest('.research-text');
  const story=start?.closest('.story');
  if(!text || text.length>180 || !story || !$('stories').contains(story) || story!==end?.closest('.story')){hideSelectionTools();return;}
  const range=selection.getRangeAt(0),rect=range.getBoundingClientRect();
  const bounds=$('stories').getBoundingClientRect();
  if(rect.bottom<bounds.top || rect.top>bounds.bottom){hideSelectionTools();return;}
  researchSelection={text,storyId:story.dataset.id};
  const tools=$('selection-tools');$('selection-label').textContent=text;tools.hidden=false;
  const width=tools.offsetWidth,height=tools.offsetHeight;
  tools.style.left=Math.max(8,Math.min(rect.left+(rect.width-width)/2,innerWidth-width-8))+'px';
  const above=rect.top-height-10;
  tools.style.top=Math.max(8,Math.min(above>=8?above:rect.bottom+10,innerHeight-height-8))+'px';
}
function researchSelected(action) {
  const chosen=researchSelection;if(!chosen)return;
  hideSelectionTools();window.getSelection()?.removeAllRanges();
  document.body.classList.remove('map-expanded');$('expand-map').textContent='⤢ Expand';
  if(action==='wikipedia') {
    document.body.classList.remove('hide-left');if(innerWidth<=760)document.body.classList.add('hide-right');
    switchSearchTab('wikipedia');$('wiki-query').value=chosen.text;$('left').scrollTo({top:0});$('wiki-query').focus({preventScroll:true});searchWikipedia();
  } else if(action==='map') {
    document.body.classList.remove('hide-right');if(innerWidth<=760)document.body.classList.add('hide-left');
    state.pendingStory=storyById(chosen.storyId)||null;
    $('place-query').value=chosen.text;$('right').scrollTo({top:0});$('place-query').focus({preventScroll:true});findPlaces(chosen.text);
  } else if(action==='research') {
    openResearch(chosen.text);
  } else if(action==='news') {
    document.body.classList.remove('hide-left');if(innerWidth<=760)document.body.classList.add('hide-right');
    switchSearchTab('news');$('query').value='"'+chosen.text.replaceAll('"','')+'"';$('left').scrollTo({top:0});$('query').focus({preventScroll:true});loadNews();
  }
}

document.addEventListener('pointerdown',event=>{
  if($('selection-tools').contains(event.target))return;
  if(!$('stories').contains(event.target)&&!$('selection-tools').hidden)window.getSelection()?.removeAllRanges();
  selectingText=$('stories').contains(event.target);hideSelectionTools();
});
document.addEventListener('pointerup',()=>{const wasSelecting=selectingText;selectingText=false;if(wasSelecting)requestAnimationFrame(showSelectionTools);});
document.addEventListener('pointercancel',()=>{selectingText=false;hideSelectionTools();});
document.addEventListener('selectionchange',()=>{if(!selectingText)requestAnimationFrame(showSelectionTools);});
$('selection-tools').addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')event.preventDefault();});
for(const action of ['wikipedia','map','news','research'])$('selection-'+action).addEventListener('click',()=>researchSelected(action));
$('selection-tools').addEventListener('keydown',event=>{
  if(['ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault();const buttons=[...$('selection-tools').querySelectorAll('button')];const index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length].focus();
  }
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('selection-tools').hidden){hideSelectionTools();window.getSelection()?.removeAllRanges();}});
document.addEventListener('scroll',hideSelectionTools,true);
window.addEventListener('resize',hideSelectionTools);

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
  if (item) { const locations = readStore('news-osint.locations', {}); locations[item.id] = place; writeStore('news-osint.locations', locations);if(state.bookmarks[item.id]){state.bookmarks[item.id].location={...place};saveBookmarks();}renderStories(); }
  saveWorkspace();
  $('right').scrollTo({top:0,behavior:'smooth'});
  if (!place.pageid) { ++state.profileRequest; const info=$('location-info'); info.replaceChildren(make('h2',place.title),make('p', 'Coordinate selected. Search for a nearby city to load its Wikipedia profile.', 'muted')); return; }
  await showReference(place.pageid,place.title,'PLACE CONTEXT');
}

async function showReference(pageid, title, context, topic=false) {
  const request = ++state.profileRequest;
  const info = $('location-info'); info.replaceChildren(make('span',context,'eyebrow'),make('h2',title));
  info.append(make('p', 'Loading Wikipedia and Wikidata…', 'muted'));
  try {
    let data;
    try{data=await get('/api/profile?id='+encodeURIComponent(pageid));const cache=readStore('news-osint.reference-cache',{});cache[pageid]=data;const keys=Object.keys(cache);if(keys.length>12)delete cache[keys.find(key=>key!==String(pageid))];writeStore('news-osint.reference-cache',cache);}
    catch(error){data=readStore('news-osint.reference-cache',{})[pageid];if(!data)throw error;data={...data,cacheStale:true};}
    if (request !== state.profileRequest) return;
    state.reference={pageid:data.pageid,title:data.title,context,topic};saveWorkspace();
    info.replaceChildren(make('span', context, 'eyebrow'), make('h2', data.title));
    if(data.cacheStale)info.append(make('p','Cached background · the source could not be refreshed.','cache-notice'));
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
    if(topic&&!state.restoringWorkspace) info.scrollIntoView({block:'start',behavior:'smooth'});
  } catch (error) { if (request === state.profileRequest) info.replaceChildren(make('h2', title), make('p', error.message, 'muted')); }
}

function renderSaved() {
  const saved = readStore('news-osint.saved', []); $('saved-count').textContent = saved.length;
  $('saved-list').replaceChildren();
  if (!saved.length) $('saved-list').append(make('p', 'Keep a useful query here to return to it later.'));
  saved.forEach((entry, index) => {
    const row = make('div', undefined, 'saved-item');
    row.append(button(entry.kind==='research'?'Research: '+entry.q:entry.q || 'All coverage', () => { if(entry.kind==='research')openResearch(entry.subject,entry.q);else{restoreFilters(entry);loadNews();} }), button('×', () => { saved.splice(index,1); writeStore('news-osint.saved', saved); renderSaved(); }));
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
    const remembered=workspace.map;
    const valid=remembered&&Array.isArray(remembered.center)&&remembered.center.length===2&&remembered.center.every(Number.isFinite)&&Math.abs(remembered.center[0])<=180&&Math.abs(remembered.center[1])<=85&&Number.isFinite(remembered.zoom);
    state.map = new maplibregl.Map({container:'map', style:'https://tiles.openfreemap.org/styles/positron',center:valid?remembered.center:[15,25],zoom:valid?Math.max(0,Math.min(22,remembered.zoom)):1.4,
      bearing:valid&&Number.isFinite(remembered.bearing)?remembered.bearing:0,pitch:valid&&Number.isFinite(remembered.pitch)?Math.max(0,Math.min(85,remembered.pitch)):0,attributionControl:true});
    state.map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
    state.map.on('load', () => { $('map-status').hidden = true; paintMap(); syncMarkers();if(state.place)addMarker(state.place); });
    state.map.on('moveend',saveWorkspace);
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
$('settings-open').addEventListener('click',openSettings);
for(const id of ['settings-close','settings-cancel'])$(id).addEventListener('click',()=>$('settings-dialog').close());
$('settings-save').addEventListener('click',saveSettings);
$('import-opml').addEventListener('click',()=>$('opml-file').click());
$('opml-file').addEventListener('change',async()=>{const file=$('opml-file').files[0];if(!file)return;
  try{if(file.size>1000000)throw new Error('Choose an OPML file smaller than 1 MB.');const result=importOpml(await file.text(),state.sourceDraft);state.sourceDraft=result.sources;renderSettingsSources();$('settings-status').textContent=`Imported ${result.added} feeds; ${result.duplicates} already present. Save changes to apply.`;}
  catch(error){$('settings-status').textContent=error.message;}finally{$('opml-file').value='';}
});
$('export-opml').addEventListener('click',()=>download('news-osint-feeds.opml',exportOpml(state.sourceDraft),'application/xml'));
$('saved-view').addEventListener('click',()=>setView(state.view==='saved'?'news':'saved'));
$('view-news').addEventListener('click',()=>setView('news'));
$('group-coverage').addEventListener('change',()=>{writeStore('news-osint.group-coverage',$('group-coverage').checked);renderStories();});
$('export-research').addEventListener('click',()=>download('news-osint-research.json',JSON.stringify({version:1,bookmarks:state.bookmarks},null,2),'application/json'));
$('research-open').addEventListener('click',()=>openResearch($('query').value.replace(/^"|"$/g,'')));
$('research-close').addEventListener('click',()=>$('research-dialog').close());
for(const id of ['subject','preset','sites','after','before','exclude'])$('research-'+id).addEventListener('input',updateResearchQuery);
$('research-query').addEventListener('input',()=>{$('research-preset').value='custom';state.researchError=null;$('research-status').textContent='';});
$('research-reader').addEventListener('click',async()=>{const control=$('research-reader');control.disabled=true;try{await openInReader(researchUrl());$('research-dialog').close();}catch(error){$('research-status').textContent=error.message;}finally{control.disabled=false;}});
$('research-browser').addEventListener('click',()=>{try{window.open(researchUrl(),'_blank','noopener,noreferrer');$('research-dialog').close();}catch(error){$('research-status').textContent=error.message;}});
$('research-save').addEventListener('click',()=>{try{researchUrl();const saved=readStore('news-osint.saved',[]),q=$('research-query').value.trim();if(!saved.some(s=>s.kind==='research'&&s.q===q)){saved.push({kind:'research',q,subject:$('research-subject').value});writeStore('news-osint.saved',saved);renderSaved();}$('research-status').textContent='Saved in your sidebar searches.';}catch(error){$('research-status').textContent=error.message;}});
$('add-feed-form').addEventListener('submit',event=>{
  event.preventDefault();const name=$('new-feed-name').value.trim(),url=$('new-feed-url').value.trim();
  if(!name)return;
  if(state.sourceDraft.some(source=>source.url===url)){$('settings-status').textContent='This feed URL is already in the list.';return;}
  state.sourceDraft.push({id:'feed_'+crypto.randomUUID().replaceAll('-','').slice(0,16),name,url,enabled:true});renderSettingsSources();$('add-feed-form').reset();$('settings-status').textContent='Feed added to the list. Save changes to start using it.';
});
$('wiki-form').addEventListener('submit', event=>{event.preventDefault();searchWikipedia();});
for (const name of ['news','wikipedia']) {
  $('tab-'+name).addEventListener('click',()=>switchSearchTab(name));
  $('tab-'+name).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=name==='news'?'wikipedia':'news';switchSearchTab(next);$('tab-'+next).focus();}});
}
$('refresh-now').addEventListener('click', loadNews);
$('place-form').addEventListener('submit', event => { event.preventDefault(); if ($('place-query').value.trim()) findPlaces($('place-query').value.trim()); });
$('save-search').addEventListener('click', () => { const saved = readStore('news-osint.saved', []), entry = filters(); if (saved.some(x => JSON.stringify(x) === JSON.stringify(entry))) { toast('This search is already saved.'); return; } saved.push(entry); writeStore('news-osint.saved', saved); renderSaved(); toast('Search saved.'); });
$('google').addEventListener('click', () => { let q = $('query').value.trim(); if (!q) { toast('Enter a topic to research in Google.'); return; } const hours = Number($('hours').value); if (hours) q += ' after:' + new Date(Date.now()-hours*3600000).toISOString().slice(0,10); window.open('https://www.google.com/search?' + new URLSearchParams({q,tbm:'nws'}), '_blank', 'noopener,noreferrer'); });
$('refresh').addEventListener('change', () => { clearInterval(state.refreshTimer); const minutes = Number($('refresh').value); writeStore('news-osint.refresh', minutes); if (minutes) state.refreshTimer = setInterval(() => { if (!document.hidden) loadNews({background:true}); }, minutes*60000); });
$('world').addEventListener('click', () => state.map?.flyTo({center:[15,25],zoom:1.4}));
$('toggle-left').addEventListener('click', () => { document.body.classList.remove('map-expanded'); $('expand-map').textContent = '⤢ Expand'; document.body.classList.toggle('hide-left'); });
$('toggle-right').addEventListener('click', () => { document.body.classList.remove('map-expanded'); $('expand-map').textContent = '⤢ Expand'; document.body.classList.toggle('hide-right'); });
$('expand-map').addEventListener('click', () => { document.body.classList.remove('hide-right'); document.body.classList.toggle('map-expanded'); $('expand-map').textContent = document.body.classList.contains('map-expanded') ? '⤡ Restore' : '⤢ Expand'; });
$('reset-layout').addEventListener('click', () => { writeStore('news-osint.layout',{left:25,right:25}); document.body.classList.remove('hide-left','hide-right','map-expanded'); $('expand-map').textContent = '⤢ Expand'; applyLayout(); });
$('export').addEventListener('click', () => {
  const items=state.view==='saved'?Object.values(state.bookmarks).map(record=>record.item):state.items;
  if (!items.length) { toast('No stories to export.'); return; }
  const safe = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; };
  const rows = [['Title','Source','Published','URL','Publisher feed excerpt'],...items.map(i=>[i.title,i.source,i.published,i.url,i.summary])];
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a = make('a'); a.href = url; a.download = 'news-osint-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
restoreFilters(readStore('news-osint.filters', {})); renderSaved(); applyLayout();
$('group-coverage').checked=readStore('news-osint.group-coverage',true);
saveBookmarks();
if(state.view==='saved')renderStories();
$('wiki-query').value=readStore('news-osint.wiki-query','');
switchSearchTab(readStore('news-osint.search-tab','news'));
if(!$('wiki-controls').hidden && $('wiki-query').value)searchWikipedia();
resizeDivider('divider-left','left'); resizeDivider('divider-right','right');
if (innerWidth <= 760) document.body.classList.add('hide-left','hide-right');
if(workspace.panels&&workspace.panels.mobile===(innerWidth<=760)) {
  document.body.classList.toggle('hide-left',!!workspace.panels.left);document.body.classList.toggle('hide-right',!!workspace.panels.right);document.body.classList.toggle('map-expanded',!!workspace.panels.expanded);
  $('expand-map').textContent=workspace.panels.expanded?'⤡ Restore':'⤢ Expand';
}
if(workspace.place&&Number.isFinite(workspace.place.lat)&&Number.isFinite(workspace.place.lon)){state.place=workspace.place;$('place-query').value=workspace.place.title||'';}
state.selected=workspace.selected||null;
for(const id of ['toggle-left','toggle-right','expand-map','reset-layout'])$(id).addEventListener('click',saveWorkspace);
window.addEventListener('beforeunload',saveWorkspace);
window.addEventListener('offline',()=>{$('connection-status').textContent='Offline · cached coverage available';});
window.addEventListener('online',()=>{$('connection-status').textContent='Connection restored · refresh to check sources';});
$('refresh').value = String(readStore('news-osint.refresh', 0)); $('refresh').dispatchEvent(new Event('change'));
loadTheme().then(initMap); setInterval(loadTheme, 3000);
loadSources().then(()=>loadNews({background:true})).catch(error=>{if(state.view==='saved')renderStories();else $('stories').replaceChildren(empty('Could not load source settings.',error.message));$('stories').setAttribute('aria-busy','false');});
(async()=>{try{if(workspace.reference)await showReference(workspace.reference.pageid,workspace.reference.title,workspace.reference.context,workspace.reference.topic);}finally{state.restoringWorkspace=false;saveWorkspace();}})();
