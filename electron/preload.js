const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dgfp", {
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  pickFile: (filters) => ipcRenderer.invoke("dialog:pick-file", filters),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  copyText: (value) => clipboard.writeText(String(value || "")),
  getInfo: () => ipcRenderer.invoke("backend:info"),
  inspectSource: (inputDir) => ipcRenderer.invoke("backend:inspect-source", { inputDir }),
  inspectLeieSource: (inputDir, duplicateKey) =>
    ipcRenderer.invoke("backend:inspect-leie-source", { inputDir, duplicateKey }),
  getPreview: (data) => ipcRenderer.invoke("backend:preview", data),
  saveUiSettings: (data) => ipcRenderer.invoke("backend:save-ui-settings", data),
  acknowledgeReleaseAnnouncement: (releaseKey) =>
    ipcRenderer.invoke("backend:acknowledge-release-announcement", { releaseKey }),
  importUploadSource: (sourcePath) =>
    ipcRenderer.invoke("backend:import-upload-source", { sourcePath }),
  exportDiagnostics: (outputDir) => ipcRenderer.invoke("backend:export-diagnostics", { outputDir }),
  testUploadTarget: (data) => ipcRenderer.invoke("backend:test-upload-target", data),
  runJob: (command, data) => ipcRenderer.invoke("backend:run", { command, data }),
  cancelJob: () => ipcRenderer.invoke("backend:cancel"),
  onBackendEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("backend:event", listener);
    return () => ipcRenderer.removeListener("backend:event", listener);
  },
});
