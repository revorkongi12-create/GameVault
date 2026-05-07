const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

function loadAppConfig() {
  const defaults = {
    apiBase:"http://localhost:3000",
    useLocalServer:true
  };

  try {
    const configPath = path.join(__dirname, "app.config.json");

    if (!fs.existsSync(configPath)) return defaults;

    return {
      ...defaults,
      ...JSON.parse(fs.readFileSync(configPath, "utf8"))
    };
  } catch (error) {
    console.error("Could not load app config:", error.message);
    return defaults;
  }
}

const appConfig = loadAppConfig();

if (process.platform === "win32") {
  app.setAppUserModelId("com.gamevault.app");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  const shouldStartLocalServer = process.env.GAMEVAULT_USE_LOCAL_SERVER
    ? process.env.GAMEVAULT_USE_LOCAL_SERVER !== "false"
    : appConfig.useLocalServer;

  if (shouldStartLocalServer) {
    require("./server");
  }
}

function createWindow(){
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width:1200,
    height:800,
    fullscreen:true,
    autoHideMenuBar:true,
    icon:path.join(__dirname, "build", "GameVault.ico"),
    webPreferences:{
      preload:path.join(__dirname, "preload.js"),
      nodeIntegration:false,
      contextIsolation:true
    }
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));

  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11" && input.type === "keyDown") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
      return;
    }

    if (input.key === "Escape" && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  if (gotSingleInstanceLock) createWindow();
});

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();

  if (!win) return;

  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on("toggle-fullscreen", event => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
});

ipcMain.handle("open-external", async (event, url) => {
  try {
    const parsedUrl = new URL(url);
    const allowedProtocols = new Set(["https:", "http:", "steam:"]);

    if (!allowedProtocols.has(parsedUrl.protocol)) {
      return { ok:false, error:"Unsupported link type." };
    }

    await shell.openExternal(url, { activate:true });

    return { ok:true };
  } catch (error) {
    return {
      ok:false,
      error:error.message
    };
  }
});

ipcMain.handle("get-app-config", () => appConfig);
