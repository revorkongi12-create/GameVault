const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const childProcess = require("child_process");
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

function pathExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath));
  } catch {
    return false;
  }
}

function readJsonFile(filePath) {
  try {
    if (!pathExists(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Could not read ${filePath}:`, error.message);
    return null;
  }
}

function findFirstExisting(paths) {
  return paths.find(pathExists) || "";
}

function getEpicManifestGames() {
  const manifestDir = path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");

  if (!pathExists(manifestDir)) return [];

  return fs.readdirSync(manifestDir)
    .filter(file => file.endsWith(".item"))
    .map(file => readJsonFile(path.join(manifestDir, file)))
    .filter(Boolean)
    .filter(manifest => manifest.DisplayName && manifest.InstallLocation)
    .map(manifest => {
      const executablePath = manifest.LaunchExecutable
        ? path.join(manifest.InstallLocation, manifest.LaunchExecutable)
        : "";
      const launchUrl = manifest.CatalogItemId
        ? `com.epicgames.launcher://apps/${manifest.CatalogItemId}?action=launch&silent=true`
        : "";

      return {
        id:`epic:${manifest.AppName || manifest.CatalogItemId || manifest.DisplayName}`,
        source:"epic",
        accessType:"epic",
        name:manifest.DisplayName,
        hours:0,
        recentHours:0,
        completion:0,
        image:"",
        achievements:[],
        genres:[],
        installPath:manifest.InstallLocation,
        launchPath:pathExists(executablePath) ? executablePath : "",
        launchUrl,
        localSourceLabel:"Epic Games"
      };
    });
}

function getMinecraftLauncherPath() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return findFirstExisting([
    path.join(programFiles, "Minecraft Launcher", "MinecraftLauncher.exe"),
    path.join(programFilesX86, "Minecraft Launcher", "MinecraftLauncher.exe"),
    path.join(localAppData, "Programs", "Minecraft Launcher", "MinecraftLauncher.exe")
  ]);
}

function getCurseForgePath() {
  const localAppData = process.env.LOCALAPPDATA || "";

  return findFirstExisting([
    path.join(localAppData, "Programs", "CurseForge Windows", "CurseForge.exe"),
    path.join(localAppData, "Overwolf", "CurseForge", "CurseForge.exe")
  ]);
}

function getModrinthPath() {
  const localAppData = process.env.LOCALAPPDATA || "";

  return findFirstExisting([
    path.join(localAppData, "Programs", "Modrinth App", "Modrinth App.exe"),
    path.join(localAppData, "Modrinth App", "Modrinth App.exe")
  ]);
}

function getMinecraftGames() {
  const appData = process.env.APPDATA || "";
  const userProfile = process.env.USERPROFILE || "";
  const minecraftDir = path.join(appData, ".minecraft");
  const launcherProfiles = readJsonFile(path.join(minecraftDir, "launcher_profiles.json"));
  const launcherPath = getMinecraftLauncherPath();
  const games = [];

  if (launcherProfiles?.profiles) {
    Object.entries(launcherProfiles.profiles).forEach(([profileId, profile]) => {
      const name = profile.name || profileId;

      games.push({
        id:`minecraft:vanilla:${profileId}`,
        source:"minecraft",
        accessType:"minecraft",
        name:`Minecraft - ${name}`,
        hours:0,
        recentHours:0,
        completion:0,
        image:"",
        achievements:[],
        genres:["Sandbox", "Survival"],
        installPath:profile.gameDir || minecraftDir,
        launchPath:launcherPath,
        launchUrl:launcherPath ? "" : "minecraft://",
        localSourceLabel:"Minecraft"
      });
    });
  } else if (pathExists(minecraftDir) || launcherPath) {
    games.push({
      id:"minecraft:vanilla:launcher",
      source:"minecraft",
      accessType:"minecraft",
      name:"Minecraft Launcher",
      hours:0,
      recentHours:0,
      completion:0,
      image:"",
      achievements:[],
      genres:["Sandbox", "Survival"],
      installPath:minecraftDir,
      launchPath:launcherPath,
      launchUrl:launcherPath ? "" : "minecraft://",
      localSourceLabel:"Minecraft"
    });
  }

  const cursePath = getCurseForgePath();
  const curseInstancesRoot = findFirstExisting([
    path.join(userProfile, "curseforge", "minecraft", "Instances"),
    path.join(userProfile, "Documents", "Curse", "Minecraft", "Instances")
  ]);

  if (pathExists(curseInstancesRoot)) {
    fs.readdirSync(curseInstancesRoot, { withFileTypes:true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => {
        const instancePath = path.join(curseInstancesRoot, entry.name);
        const manifest = readJsonFile(path.join(instancePath, "manifest.json"));
        const name = manifest?.name || entry.name;

        games.push({
          id:`minecraft:curseforge:${entry.name}`,
          source:"minecraft",
          accessType:"minecraftCurseForge",
          name:`Minecraft - ${name}`,
          hours:0,
          recentHours:0,
          completion:0,
          image:"",
          achievements:[],
          genres:["Sandbox", "Modded"],
          installPath:instancePath,
          launchPath:cursePath || launcherPath,
          launchUrl:"",
          localSourceLabel:"CurseForge"
        });
      });
  }

  const modrinthPath = getModrinthPath();
  const modrinthProfilesRoot = path.join(appData, "com.modrinth.theseus", "profiles");

  if (pathExists(modrinthProfilesRoot)) {
    fs.readdirSync(modrinthProfilesRoot, { withFileTypes:true })
      .filter(entry => entry.isDirectory())
      .forEach(entry => {
        const instancePath = path.join(modrinthProfilesRoot, entry.name);
        const profile = readJsonFile(path.join(instancePath, "profile.json"));
        const name = profile?.name || entry.name;

        games.push({
          id:`minecraft:modrinth:${entry.name}`,
          source:"minecraft",
          accessType:"minecraftModrinth",
          name:`Minecraft - ${name}`,
          hours:0,
          recentHours:0,
          completion:0,
          image:"",
          achievements:[],
          genres:["Sandbox", "Modded"],
          installPath:instancePath,
          launchPath:modrinthPath || launcherPath,
          launchUrl:"",
          localSourceLabel:"Modrinth"
        });
      });
  }

  const seen = new Set();

  return games.filter(game => {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}

function scanLocalLibrarySources() {
  return {
    games:[
      ...getEpicManifestGames(),
      ...getMinecraftGames()
    ]
  };
}

function launchLocalGame(game) {
  if (game.launchUrl) {
    return shell.openExternal(game.launchUrl, { activate:true });
  }

  if (game.launchPath && pathExists(game.launchPath)) {
    const cwd = game.installPath && pathExists(game.installPath) ? game.installPath : path.dirname(game.launchPath);

    childProcess.spawn(game.launchPath, [], {
      cwd,
      detached:true,
      stdio:"ignore"
    }).unref();
    return Promise.resolve();
  }

  if (game.installPath && pathExists(game.installPath)) {
    return shell.openPath(game.installPath);
  }

  throw new Error("No launch target was found for this game.");
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

ipcMain.handle("scan-local-library-sources", async () => {
  try {
    return {
      ok:true,
      ...scanLocalLibrarySources()
    };
  } catch (error) {
    return {
      ok:false,
      error:error.message,
      games:[]
    };
  }
});

ipcMain.handle("launch-local-game", async (event, game) => {
  try {
    await launchLocalGame(game || {});
    return { ok:true };
  } catch (error) {
    return {
      ok:false,
      error:error.message
    };
  }
});
