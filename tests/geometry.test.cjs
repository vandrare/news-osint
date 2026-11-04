const test=require('node:test');
const assert=require('node:assert/strict');
const {validBounds,fitBounds}=require('../reader/geometry.cjs');
const primary={x:0,y:30,width:1920,height:1050};
test('restore an existing window without moving it',()=>{
  const saved={x:130,y:110,width:860,height:640};
  assert.deepEqual(fitBounds(saved,[primary],primary),saved);
});
test('recover from a disconnected monitor',()=>{
  const result=fitBounds({x:4000,y:100,width:1000,height:800},[primary],primary);
  assert.ok(result.x>=primary.x && result.x+result.width<=primary.width);
  assert.ok(result.y>=primary.y);
});
test('respect displays with negative global coordinates',()=>{
  const left={x:-1920,y:0,width:1920,height:1080};
  const saved={x:-1500,y:100,width:800,height:600};
  assert.deepEqual(fitBounds(saved,[left,primary],primary),saved);
});
test('ignore corrupt settings and fit oversized windows',()=>{
  assert.equal(validBounds({x:NaN,y:0,width:800,height:600}),false);
  const result=fitBounds({x:0,y:0,width:5000,height:4000},[primary],primary);
  assert.ok(result.width<primary.width && result.height<primary.height);
  assert.equal(fitBounds(null,[primary],primary).width,1000);
});
