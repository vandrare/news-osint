'use strict';

function validBounds(value) {
  return value && ['x','y','width','height'].every(key=>Number.isFinite(value[key]) && Math.abs(value[key]) < 1000000)
    && value.width >= 200 && value.height >= 150;
}

function fitBounds(saved, areas, fallback) {
  const valid = validBounds(saved);
  let area = valid && areas.find(a=>saved.x < a.x+a.width && saved.x+saved.width > a.x && saved.y < a.y+a.height && saved.y+saved.height > a.y);
  area = area || fallback;
  const width = Math.min(Math.max(480, valid ? Math.round(saved.width) : 1000), area.width-24);
  const height = Math.min(Math.max(360, valid ? Math.round(saved.height) : 850), area.height-24);
  const x = valid && saved.x < area.x+area.width && saved.x+saved.width > area.x ? saved.x : area.x+(area.width-width)/2;
  const y = valid && saved.y < area.y+area.height && saved.y+saved.height > area.y ? saved.y : area.y+(area.height-height)/2;
  return {x:Math.round(Math.max(area.x,Math.min(x,area.x+area.width-width))),
    y:Math.round(Math.max(area.y,Math.min(y,area.y+area.height-height))),width,height};
}

module.exports = {validBounds,fitBounds};
