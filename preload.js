const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gameVault", {
  apiBase: process.env.GAMEVAULT_API_BASE,
  getAppConfig() {
    return ipcRenderer.invoke("get-app-config");
  },
  openExternal(url) {
    return ipcRenderer.invoke("open-external", url);
  },
  toggleFullscreen() {
    ipcRenderer.send("toggle-fullscreen");
  }
});
