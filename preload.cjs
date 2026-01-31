// Preload script for context isolation
// This file runs in a sandboxed context with access to Node APIs
// and can safely expose specific APIs to the renderer process

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  versions: process.versions
});
