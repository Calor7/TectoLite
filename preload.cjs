// Preload script for context isolation
// This file runs in a sandboxed context with access to Node APIs
// and can safely expose specific APIs to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

/**
 * @typedef {Object} TectoLiteElectronApi
 * @property {NodeJS.ProcessVersions} versions
 * @property {(url: string) => Promise<void>} openExternal
 * @property {(reportId: string, reportText: string, screenshotDataUrl: string | null) => Promise<string>} saveBugReport
 * @property {(json: string) => Promise<void>} writeAutosave
 * @property {(json: string, filename: string) => Promise<'saved' | 'cancelled'>} saveProject
 * @property {() => Promise<string | null>} readAutosave
 * @property {() => Promise<void>} clearAutosave
 */

/** @type {TectoLiteElectronApi} */
const electronApi = Object.freeze({
  versions: process.versions,
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveBugReport: (reportId, reportText, screenshotDataUrl) => ipcRenderer.invoke('save-bug-report', reportId, reportText, screenshotDataUrl),
  writeAutosave: (json) => ipcRenderer.invoke('autosave:write', json),
  saveProject: (json, filename) => ipcRenderer.invoke('project:save', json, filename),
  readAutosave: () => ipcRenderer.invoke('autosave:read'),
  clearAutosave: () => ipcRenderer.invoke('autosave:clear')
});

contextBridge.exposeInMainWorld('electron', electronApi);
