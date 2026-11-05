import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCoverage,googleResearchQuery,exportOpml,importOpml} from '../static/research-utils.mjs';

test('similar reports retain every original story',()=>{
  const items=[{id:'a',title:'Severe flooding closes schools across northern France'},
    {id:'b',title:'Severe flooding closes schools in northern France'},
    {id:'c',title:'New airport opens in Japan'}];
  const groups=groupCoverage(items);
  assert.equal(groups.length,2);assert.deepEqual(groups[0].map(i=>i.id),['a','b']);
  assert.equal(groups.flat().length,items.length);
});
test('different figures and short vague headlines stay separate',()=>{
  assert.equal(groupCoverage([{title:'Earthquake leaves 10 injured in northern city'},
    {title:'Earthquake leaves 20 injured in northern city'}]).length,2);
  assert.equal(groupCoverage([{title:'France wins match'},{title:'Germany wins match'}]).length,2);
});
test('Google presets build editable regular-web queries',()=>{
  assert.equal(googleResearchQuery({subject:'Euphrates River',preset:'pdf',after:'2026-01-01',exclude:'tourism, river cruises'}),
    '"Euphrates River" filetype:pdf after:2026-01-01 -tourism -"river cruises"');
  assert.match(googleResearchQuery({subject:'Ada Lovelace',preset:'official'}),/site:un.org OR site:gov/);
  assert.throws(()=>googleResearchQuery({site:'un.org/secret'}));
  assert.throws(()=>googleResearchQuery({site:', ,'}));
  assert.throws(()=>googleResearchQuery({after:'2026-12-01',before:'2026-01-01'}));
});
test('OPML escapes source names and preserves application metadata',()=>{
  const text=exportOpml([{id:'google',name:'A & "B" <C>',url:'https://example.org/rss?a=1&b=2',enabled:false}]);
  assert.ok(text.includes('A &amp; &quot;B&quot; &lt;C&gt;'));
  assert.ok(text.includes('news-osint-enabled="false"'));
  assert.ok(text.includes('news-osint-id="google"'));
  assert.throws(()=>importOpml('<!DOCTYPE opml><opml/>',[]),/DTD/);
});
