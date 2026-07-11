// Preload script for context isolation
// This file runs in a sandboxed context with access to Node APIs
// and can safely expose specific APIs to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  versions: process.versions,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveBugReport: (reportId, reportText, screenshotDataUrl) => ipcRenderer.invoke('save-bug-report', reportId, reportText, screenshotDataUrl)
});
