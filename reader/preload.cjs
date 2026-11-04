'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('readerControls',{
  back:()=>ipcRenderer.send('reader:action','back'),
  forward:()=>ipcRenderer.send('reader:action','forward'),
  reload:()=>ipcRenderer.send('reader:action','reload'),
  external:()=>ipcRenderer.send('reader:action','external'),
  close:()=>ipcRenderer.send('reader:action','close'),
  onState:callback=>ipcRenderer.on('reader:state',(_event,state)=>callback(state))
});
