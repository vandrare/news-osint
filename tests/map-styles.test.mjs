import test from 'node:test';
import assert from 'node:assert/strict';
import {mapMode,mapPalette,buildMapStyle} from '../static/map-styles.mjs';
const theme={background:'#171612',foreground:'#e8dfcc',blue:'#83abc0',accent:'#d9a45d'};
const base={version:8,sources:{geo:{type:'vector',url:'https://example.org/tiles.json'}},layers:[
  {id:'background',type:'background'},
  {id:'water',type:'fill','source-layer':'water',source:'geo'},
  {id:'building',type:'fill','source-layer':'building',source:'geo'},
  {id:'highway_major_inner',type:'line','source-layer':'transportation',source:'geo'},
  {id:'waterway',type:'line','source-layer':'waterway',source:'geo'},
  {id:'boundary_2',type:'line','source-layer':'boundary',source:'geo'},
  {id:'label_city',type:'symbol','source-layer':'place',source:'geo',layout:{'text-field':['get','name'],'icon-image':'old-dot'}},
  {id:'label_country_1',type:'symbol','source-layer':'place',source:'geo',layout:{'text-field':['get','name']}},
  {id:'water_name_point_label',type:'symbol','source-layer':'water_name',source:'geo',layout:{'text-field':['get','name']}}
]};
test('overview is default and excludes road/building clutter without mutating base',()=>{
  const original=JSON.stringify(base),style=buildMapStyle(base,theme);
  assert.equal(mapMode(null),'stardock');assert.equal(style.metadata['news-osint:mode'],'stardock');
  assert.ok(!style.layers.some(l=>['building','highway_major_inner','label_country_1','water_name_point_label'].includes(l.id)));
  assert.ok(style.layers.some(l=>l.id==='waterway'));assert.ok(style.layers.some(l=>l.id==='label_city'));
  assert.equal(style.layers.find(l=>l.id==='label_city').layout['icon-image'],undefined);
  assert.equal(JSON.stringify(base),original);
});
test('overview follows StarDock surface/ink blends in dark and light themes',()=>{
  const dark=mapPalette(theme),light=mapPalette({background:'#ffffff',foreground:'#000000'});
  assert.equal(dark.water,'#21201b');assert.equal(dark.land,'#32302a');
  assert.equal(light.water,'#f2f2f2');assert.equal(light.land,'#dedede');
  assert.notEqual(dark.coast,dark.water);assert.notEqual(light.coast,light.water);
});
test('detailed map retains roads and prior water blend while hiding country names',()=>{
  const style=buildMapStyle(base,theme,'detailed');
  assert.ok(style.layers.some(l=>l.id==='building'));assert.ok(style.layers.some(l=>l.id==='highway_major_inner'));
  assert.equal(style.layers.find(l=>l.id==='water').paint['fill-color'],'#272c2c');
  assert.equal(style.layers.find(l=>l.id==='label_country_1').layout.visibility,'none');
});
