const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gameVault", {
  apiBase: process.env.GAMEVAULT_API_BASE,
  getAppConfig() {
    return ipcRenderer.invoke("get-app-config");
  },
  openExternal(url) {
    return ipcRenderer.invoke("open-external", url);
  },
  scanLocalLibrarySources() {
    return ipcRenderer.invoke("scan-local-library-sources");
  },
  launchLocalGame(game) {
    return ipcRenderer.invoke("launch-local-game", game);
  },
  toggleFullscreen() {
    ipcRenderer.send("toggle-fullscreen");
  }
});
