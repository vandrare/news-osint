'use strict';
const {app, BrowserWindow, WebContentsView, ipcMain, shell, screen} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');
const {validBounds,fitBounds} = require('./geometry.cjs');

app.setName('news-osint-reader');
const statePath = process.env.NEWS_OSINT_READER_STATE || path.join(os.homedir(), '.local/state/news-osint/reader');
fs.mkdirSync(statePath, {recursive:true});
app.setPath('userData', statePath);
const ownInstance = app.requestSingleInstanceLock();
if (!ownInstance) app.quit();

let win, article, theme, themeKey = '', cssKey, pendingUrl;
let currentError = '';
let savedGeometryKey = '', restoringGeometry = false;
const geometryPath = path.join(statePath,'window.json');
const BAR = 36;
function hyprClient() {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return null;
  try {
    return JSON.parse(execFileSync('hyprctl',['clients','-j'],{encoding:'utf8',timeout:1000}))
      .find(client=>client.pid===process.pid && client.title==='News-OSINT Reader') || null;
  } catch { return null; }
}
function saveGeometry() {
  if (!win || win.isDestroyed() || win.isMinimized() || restoringGeometry) return;
  const client = hyprClient();
  // Hyprland can report a floating window as maximized to its Wayland client.
  if (client ? (!client.floating || client.fullscreen) : (win.isMaximized() || win.isFullScreen())) return;
  const bounds = client
    ? {x:client.at[0],y:client.at[1],width:client.size[0],height:client.size[1]} : win.getNormalBounds();
  if (!validBounds(bounds)) return;
  const key = JSON.stringify(bounds);
  if (key===savedGeometryKey) return;
  try { fs.writeFileSync(geometryPath+'.tmp',key);fs.renameSync(geometryPath+'.tmp',geometryPath);savedGeometryKey=key; }
  catch { /* A read-only state directory must not prevent article reading. */ }
}
function restoreHyprGeometry(bounds, attempts=0) {
  if (!win || win.isDestroyed()) return;
  const client = hyprClient();
  if (!client && attempts<12) {setTimeout(()=>restoreHyprGeometry(bounds,attempts+1),100);return;}
  if (client && /^0x[0-9a-f]+$/i.test(client.address)) {
    const target = `window="address:${client.address}"`;
    try {
      if (!client.floating) execFileSync('hyprctl',['dispatch',`hl.dsp.window.float({${target},action="enable"})`],{timeout:1000});
      execFileSync('hyprctl',['dispatch',`hl.dsp.window.resize({${target},x=${bounds.width},y=${bounds.height},relative=false})`],{timeout:1000});
      execFileSync('hyprctl',['dispatch',`hl.dsp.window.move({${target},x=${bounds.x},y=${bounds.y},relative=false})`],{timeout:1000});
    } catch { /* Other compositors continue using Electron's native restoration. */ }
  }
  setTimeout(()=>{restoringGeometry=false;saveGeometry();},350);
}
function webUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function argumentUrl(argv) { return argv.map(value=>webUrl(value)).find(Boolean) || null; }
pendingUrl = argumentUrl(process.argv);
function readTheme() {
  const colors = {background:'#171612', foreground:'#e8dfcc', accent:'#d9a45d', muted:'#ac9d86', selection:'#51412b', dark_background:'#11100d'};
  for (const filename of ['.local/state/omarchy/current/theme/colors.toml', '.config/omarchy/current/theme/colors.toml']) {
    try {
      const text = fs.readFileSync(path.join(os.homedir(), filename), 'utf8');
      for (const match of text.matchAll(/^([a-z_]+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)) colors[match[1]] = match[2];
      break;
    } catch { /* Use the next theme path or built-in palette. */ }
  }
  return colors;
}
function sendState() {
  if (!win || win.isDestroyed() || !article || article.webContents.isDestroyed()) return;
  const contents = article.webContents;
  const url = webUrl(contents.getURL()) || pendingUrl;
  win.webContents.send('reader:state', {host:url ? new URL(url).hostname : 'Article reader',
    loading:contents.isLoading(), back:contents.navigationHistory.canGoBack(),
    forward:contents.navigationHistory.canGoForward(), error:currentError, theme});
}
async function paintScrollbars() {
  if (!article || article.webContents.isDestroyed()) return;
  const contents = article.webContents;
  const css = `*{scrollbar-width:thin!important;scrollbar-color:${theme.accent} ${theme.dark_background}!important}::-webkit-scrollbar{width:9px!important;height:9px!important}::-webkit-scrollbar-track{background:${theme.dark_background}!important}::-webkit-scrollbar-thumb{background:${theme.accent}!important;border:2px solid ${theme.dark_background}!important;border-radius:8px!important}`;
  try {
    if (cssKey) await contents.removeInsertedCSS(cssKey).catch(()=>{});
    cssKey = await contents.insertCSS(css, {cssOrigin:'user'});
  } catch { /* Navigation may have replaced the page while applying its scrollbar colors. */ }
}
function updateTheme() {
  const colors = readTheme(), key = JSON.stringify(colors);
  if (key === themeKey) return;
  theme = colors; themeKey = key;
  if (win && !win.isDestroyed()) win.setBackgroundColor(theme.accent);
  sendState(); paintScrollbars();
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width,height] = win.getContentSize();
  article.setBounds({x:1,y:BAR,width:Math.max(1,width-2),height:Math.max(1,height-BAR-1)});
}
function navigate(url) {
  const safe = webUrl(url);
  if (!safe || !article) return;
  pendingUrl = safe; currentError = ''; article.setVisible(true);
  article.webContents.loadURL(safe).catch(()=>{});
  if (win.isMinimized()) win.restore();
  win.show(); win.focus(); sendState();
}
function keyboard(event, input) {
  if (input.type !== 'keyDown') return;
  const modifier = input.control || input.meta;
  if (input.key === 'Escape' || (modifier && input.key.toLowerCase() === 'w')) { event.preventDefault(); win.close(); }
  else if (modifier && input.key.toLowerCase() === 'r') { event.preventDefault(); article.webContents.reload(); }
  else if (input.alt && input.key === 'ArrowLeft' && article.webContents.navigationHistory.canGoBack()) { event.preventDefault(); article.webContents.navigationHistory.goBack(); }
  else if (input.alt && input.key === 'ArrowRight' && article.webContents.navigationHistory.canGoForward()) { event.preventDefault(); article.webContents.navigationHistory.goForward(); }
}
function createWindow() {
  theme = readTheme(); themeKey = JSON.stringify(theme);
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  let saved;
  try { saved=JSON.parse(fs.readFileSync(geometryPath,'utf8')); } catch { /* First launch. */ }
  const bounds=fitBounds(saved,screen.getAllDisplays().map(display=>display.workArea),area);
  restoringGeometry=true;
  win = new BrowserWindow({...bounds,
    minWidth:480,minHeight:360,frame:false,resizable:true,show:false,title:'News-OSINT Reader',
    backgroundColor:theme.accent,autoHideMenuBar:true,icon:path.join(__dirname,'../static/icon.svg'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenu(null);
  article = new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,
    webSecurity:true,allowRunningInsecureContent:false,partition:'persist:articles'}});
  // Preserve the browser's normal white backing for pages without a body color.
  article.setBackgroundColor('#ffffff');
  const session = article.webContents.session;
  session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
  session.on('will-download',event=>event.preventDefault());
  win.contentView.addChildView(article); layout();
  win.on('resize',layout);
  win.once('ready-to-show',()=>win.show());
  win.on('close',()=>{restoringGeometry=false;saveGeometry();});
  win.on('move',saveGeometry);
  const geometryTimer=setInterval(saveGeometry,1500);geometryTimer.unref();
  win.on('closed',()=>clearInterval(geometryTimer));
  win.on('closed',()=>{if(!article.webContents.isDestroyed())article.webContents.close();win=null;});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('before-input-event',keyboard);
  win.webContents.on('did-finish-load',sendState);
  article.webContents.on('before-input-event',keyboard);
  article.webContents.setWindowOpenHandler(({url})=>{const safe=webUrl(url);if(safe)setImmediate(()=>navigate(safe));return {action:'deny'};});
  for (const event of ['will-navigate','will-redirect']) article.webContents.on(event,(e,url)=>{if(!webUrl(e.url || url))e.preventDefault();});
  article.webContents.on('did-start-loading',()=>{currentError='';article.setVisible(true);sendState();});
  for (const event of ['did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated']) article.webContents.on(event,sendState);
  article.webContents.on('dom-ready',()=>{paintScrollbars();sendState();});
  article.webContents.on('did-fail-load',(event,code,_description,_url,isMainFrame)=>{
    code = event.errorCode ?? code;
    isMainFrame = event.isMainFrame ?? isMainFrame;
    if(!isMainFrame || code===-3)return;
    currentError='This page could not load. Try again or open it in your browser.';
    article.setVisible(false);sendState();
  });
  ipcMain.on('reader:action',(event,action)=>{
    if(!win || event.sender !== win.webContents)return;
    const contents=article.webContents;
    if(action==='close')win.close();
    else if(action==='back'&&contents.navigationHistory.canGoBack())contents.navigationHistory.goBack();
    else if(action==='forward'&&contents.navigationHistory.canGoForward())contents.navigationHistory.goForward();
    else if(action==='reload')navigate(webUrl(contents.getURL())||pendingUrl);
    else if(action==='external') {const url=webUrl(contents.getURL())||pendingUrl;if(url)shell.openExternal(url).catch(()=>{});}
  });
  win.loadURL(pathToFileURL(path.join(__dirname,'reader.html')).href).then(()=>{
    if(win&&!win.isDestroyed()){win.show();restoreHyprGeometry(bounds);}
  });
  if(pendingUrl)navigate(pendingUrl);
}
if (ownInstance) {
  app.on('second-instance',(_event,argv)=>{const url=argumentUrl(argv);if(url){if(win)navigate(url);else pendingUrl=url;}});
  app.whenReady().then(()=>{createWindow();const timer=setInterval(updateTheme,3000);timer.unref();});
  app.on('window-all-closed',()=>app.quit());
}
