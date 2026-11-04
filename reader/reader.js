'use strict';
for (const action of ['back','forward','reload','external','close'])document.getElementById(action).addEventListener('click',()=>window.readerControls[action]());
document.getElementById('retry').addEventListener('click',()=>window.readerControls.reload());
document.getElementById('external-error').addEventListener('click',()=>window.readerControls.external());
window.readerControls.onState(state=>{
  document.getElementById('host').textContent=state.host;
  document.getElementById('back').disabled=!state.back;
  document.getElementById('forward').disabled=!state.forward;
  document.getElementById('loading').hidden=!state.loading;
  document.getElementById('error').hidden=!state.error;
  document.getElementById('error-message').textContent=state.error||'';
  const keys={background:'bg',dark_background:'panel',foreground:'fg',accent:'accent',muted:'muted'};
  for(const [key,css]of Object.entries(keys))if(/^#[0-9a-fA-F]{6}$/.test(state.theme?.[key]||''))document.documentElement.style.setProperty('--'+css,state.theme[key]);
});
