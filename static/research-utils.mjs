const STOP=new Set('a an the and or but for from in into of on to with at by as is are was were be been this that it its over after before says say said new latest live update updates news'.split(' '));
const words=text=>(text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]);
export function groupCoverage(items) {
  const groups=[],index=new Map(),exact=new Map();
  for(const item of items) {
    const normalized=words(item.title).join(' '),tokens=new Set(words(item.title).filter(w=>w.length>2&&!STOP.has(w)));
    const numbers=(item.title.match(/\d+(?:[.,]\d+)*/g)||[]).sort().join('|');
    let match=exact.get(normalized);
    if(match===undefined && tokens.size>=4) {
      const candidates=new Map();
      for(const token of tokens)for(const id of index.get(token)||[])candidates.set(id,(candidates.get(id)||0)+1);
      let best=.71;
      for(const [id,shared]of [...candidates].sort((a,b)=>b[1]-a[1]).slice(0,30)) {
        const group=groups[id];if(shared<4||numbers!==group.numbers)continue;
        const score=shared/(tokens.size+group.tokens.size-shared);
        if(score>best){best=score;match=id;}
      }
    }
    if(match===undefined) {
      match=groups.length;groups.push({items:[],tokens,numbers});
      for(const token of tokens){if(!index.has(token))index.set(token,new Set());index.get(token).add(match);}
    }
    groups[match].items.push(item);exact.set(normalized,match);
  }
  return groups.map(group=>group.items);
}

const quote=value=>'"'+value.replaceAll('"','').trim()+'"';
export function googleResearchQuery({subject='',preset='general',site='',after='',before='',exclude=''}={}) {
  let query=subject.trim()?quote(subject):'';
  if(preset==='official')query+=' (site:un.org OR site:gov OR site:europa.eu)';
  if(preset==='pdf')query+=' filetype:pdf';
  if(preset==='academic')query+=' (site:edu OR site:ac.uk) filetype:pdf';
  if(site.trim()) {
    const domains=site.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
    if(!domains.length||domains.some(domain=>!/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(domain)))throw new Error('Enter domain names such as un.org, separated by commas.');
    query+=' '+(domains.length>1?'('+domains.map(d=>'site:'+d).join(' OR ')+')':'site:'+domains[0]);
  }
  for(const [key,value]of [['after',after],['before',before]])if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Choose a valid date.');query+=' '+key+':'+value;}
  if(after&&before&&after>before)throw new Error('The end date must follow the start date.');
  for(const term of exclude.split(',').map(t=>t.trim()).filter(Boolean).slice(0,12))query+=' -'+(term.includes(' ')?quote(term):term.replaceAll('"',''));
  return query.trim();
}

const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function exportOpml(sources) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>News-OSINT feeds</title></head><body>\n'+sources.map(s=>`  <outline type="rss" text="${xml(s.name)}" title="${xml(s.name)}" xmlUrl="${xml(s.url)}" news-osint-id="${xml(s.id)}" news-osint-enabled="${s.enabled?'true':'false'}"/>`).join('\n')+'\n</body></opml>\n';
}

export function importOpml(text,existing,Parser=globalThis.DOMParser) {
  if(text.length>1000000)throw new Error('Choose an OPML file smaller than 1 MB.');
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('OPML files with DTD declarations are not supported.');
  const doc=new Parser().parseFromString(text,'application/xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='opml')throw new Error('This is not a valid OPML file.');
  const result=existing.map(s=>({...s})),urls=new Set(result.map(s=>s.url)),ids=new Set(result.map(s=>s.id));let added=0,duplicates=0;
  for(const outline of doc.querySelectorAll('outline[xmlUrl]')) {
    const raw=outline.getAttribute('xmlUrl').trim();let url;
    try{url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error();}catch{throw new Error('An imported feed has an invalid web URL.');}
    if(urls.has(raw)){duplicates++;continue;}
    const preferred=outline.getAttribute('news-osint-id');
    const id=preferred&&/^[a-z0-9_-]{1,64}$/.test(preferred)&&!ids.has(preferred)?preferred:'feed_'+crypto.randomUUID().replaceAll('-','').slice(0,16);
    const name=(outline.getAttribute('title')||outline.getAttribute('text')||url.hostname).trim().slice(0,120);
    result.push({id,name:name||url.hostname,url:raw,enabled:outline.getAttribute('news-osint-enabled')!=='false'});urls.add(raw);ids.add(id);added++;
    if(result.length>100)throw new Error('Settings support up to 100 feeds.');
  }
  return {sources:result,added,duplicates};
}
