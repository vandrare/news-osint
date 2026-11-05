export const MAP_STYLE_URL='https://tiles.openfreemap.org/styles/positron';
export const DEFAULT_MAP_MODE='stardock';
export function mapMode(value){return value==='detailed'?'detailed':DEFAULT_MAP_MODE;}

const defaults={background:'#171612',foreground:'#e8dfcc',blue:'#83abc0',green:'#9cb878',accent:'#d9a45d',selection:'#51412b',lighter_background:'#302c24'};
export function mixColor(first,second,ratio){
  const a=first.slice(1).match(/../g).map(x=>parseInt(x,16)),b=second.slice(1).match(/../g).map(x=>parseInt(x,16));
  return '#'+a.map((x,i)=>Math.round(x*(1-ratio)+b[i]*ratio).toString(16).padStart(2,'0')).join('');
}
export function mapPalette(theme,mode=DEFAULT_MAP_MODE){
  const t={...defaults};for(const key of Object.keys(t))if(/^#[0-9a-f]{6}$/i.test(theme?.[key]||''))t[key]=theme[key];
  if(mapMode(mode)==='stardock'){
    const tone=amount=>mixColor(t.background,t.foreground,amount);
    return {land:tone(.13),water:tone(.05),urban:tone(.21),coast:tone(.34),river:tone(.26),admin1:tone(.22),admin0:tone(.42),label:tone(.72),halo:tone(.13),building:tone(.21),park:tone(.13),road:tone(.22)};
  }
  return {land:t.background,water:mixColor(t.background,t.blue,.15),urban:t.background,coast:mixColor(t.blue,t.foreground,.25),river:t.blue,admin1:t.accent,admin0:t.accent,label:t.foreground,halo:t.background,building:t.lighter_background,park:mixColor(t.background,t.green,.16),road:t.selection};
}
function overviewLayer(layer){
  if(layer.type==='background')return true;
  const source=layer['source-layer']||'';
  if(layer.type==='fill')return source==='water'||layer.id==='landuse_residential';
  if(layer.type==='line')return source==='waterway'||source==='boundary';
  return layer.type==='symbol'&&source==='place'&&/^label_(city|town|village)/.test(layer.id);
}
export function buildMapStyle(base,theme,mode=DEFAULT_MAP_MODE){
  const overview=mapMode(mode)==='stardock',palette=mapPalette(theme,mode),style=structuredClone(base);
  style.name=overview?'StarDock-style overview':'Detailed themed map';
  style.metadata={...style.metadata,'news-osint:mode':mapMode(mode)};
  style.transition={duration:0,delay:0};
  if(overview)style.layers=style.layers.filter(overviewLayer);
  for(const layer of style.layers){
    const id=layer.id.toLowerCase(),source=layer['source-layer']||'';
    const paint=layer.paint||={};
    if(layer.type==='background')paint['background-color']=palette.land;
    if(layer.type==='fill'){
      const water=source==='water'||/water/.test(id);
      paint['fill-color']=water?palette.water:source==='building'?palette.building:overview&&source==='landuse'?palette.urban:/park|wood|forest|grass/.test(id)?palette.park:palette.land;
      if(water)paint['fill-outline-color']=palette.coast;
    }
    if(layer.type==='line'){
      paint['line-color']=source==='waterway'||/water/.test(id)?palette.river:source==='boundary'||/boundary/.test(id)?(/boundary_2/.test(id)?palette.admin0:palette.admin1):palette.road;
      if(overview&&source==='boundary')paint['line-width']=/boundary_2/.test(id)?1:.6;
      if(overview&&source==='waterway')paint['line-width']=['interpolate',['linear'],['zoom'],3,.35,10,1.2];
    }
    if(layer.type==='fill-extrusion')paint['fill-extrusion-color']=palette.building;
    if(layer.type==='symbol'){
      layer.layout||={};
      if(/country/.test(id))layer.layout.visibility='none';
      if(layer.layout['text-field']){
        paint['text-color']=!overview&&/water/.test(id)?palette.river:palette.label;paint['text-halo-color']=palette.halo;
      }
      if(overview){
        for(const key of Object.keys(layer.layout))if(key.startsWith('icon-'))delete layer.layout[key];
        Object.assign(layer.layout,{'text-field':['coalesce',['get','name_en'],['get','name:latin'],['get','name']],
          'text-font':['Noto Sans Regular'],'text-size':10.5,'text-padding':10,'text-max-width':8,'text-allow-overlap':false,'text-anchor':'center','text-offset':[0,0]});
        Object.assign(paint,{'text-halo-width':1,'text-halo-blur':0});
      }
    }
  }
  return style;
}
