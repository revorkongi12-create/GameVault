const shell = window.gameVault || {
  apiBase:"http://localhost:3000",
  openExternal(url) {
    window.open(url, "_blank");
    return Promise.resolve({ ok:true });
  },
  scanLocalLibrarySources() {
    return Promise.resolve({ ok:true, games:[] });
  },
  launchLocalGame() {
    return Promise.resolve({ ok:false, error:"Local launching is only available in the desktop app." });
  },
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
};

let API_BASE = shell.apiBase || "http://localhost:3000";
const CLIENT_ID_STORAGE_KEY = "gameVaultClientId";
const CLIENT_ID = localStorage.getItem(CLIENT_ID_STORAGE_KEY) || createClientId();
let activeViewName = "home";
let navigationHistory = [];
let librarySyncInProgress = false;
let steamExtrasInProgress = false;

localStorage.setItem(CLIENT_ID_STORAGE_KEY, CLIENT_ID);

function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const randomParts = new Uint32Array(4);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomParts);
  } else {
    randomParts.forEach((value, index) => {
      randomParts[index] = Math.floor(Math.random() * 0xffffffff);
    });
  }

  return [...randomParts]
    .map(part => part.toString(16).padStart(8, "0"))
    .join("-");
}

function getApiUrl(path) {
  const normalizedBase = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  const url = new URL(path.replace(/^\//, ""), normalizedBase);

  url.searchParams.set("clientId", CLIENT_ID);

  return url.toString();
}
const PLACEHOLDER_APP_IDS = new Set([1145360, 620, 413150]);
const MAX_SHOWCASE_TROPHIES = 9;
const MAX_COMPLETED_TROPHIES = 3;
const HARD_ACHIEVEMENT_PERCENT = 2;
const STEAM_LEGENDARY_PERCENT = 25;
const ACTIVITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_TICK_INTERVAL_MS = 30 * 1000;
const ACHIEVEMENT_SYNC_SCHEMA_VERSION = 2;
const PROFILE_SCOPED_STATE_VERSION = 1;
const OWNER_STEAM_IDS = new Set(["76561199160380662"]);
const ACTIVITY_ICONS = {
  achievement:"✦",
  session:"▶",
  play:"▶",
  trophy:"◆",
  new:"＋"
};
const GAME_IMAGE_FALLBACKS = [
  appid => `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
  appid => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
  appid => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`,
  appid => `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
  appid => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`,
  appid => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`
];

const state = {
  games: [],
  currentGameId: null,
  goals: [],
  activities: [],
  trophies: [],
  friends: [],
  selectedFriendSteamId: null,
  visibleFriendsCount: 8,
  activeSession: null,
  sessionHistory: [],
  selectedTheme: "default",
  selectedUiStyle: "vault",
  customAccent: "",
  customAccent2: "",
  selectedBadge: "none",
  customDisplayName: "",
  customAvatar: "",
  profileBio: "",
  profileBackground: "",
  profileBackgroundPreset: "vault",
  profileLayout: "hero",
  profileStatVisibility: {
    totalHours:true,
    games:true,
    level:true,
    score:true,
    steamLevel:true,
    libraryValue:true
  },
  steamExtras: null,
  steamProfile: null,
  steamLibrarySyncedAt: null,
  localLibrarySyncedAt: null,
  steamAchievementsSyncedAt: null,
  achievementSyncVersion: 0,
  pinnedAchievementIds: [],
  pinnedGameIds: [],
  huntingExpanded: {
    rareMissing:false,
    rareWins:false
  },
  keybinds: {}
};

const profileScopedStateKeys = [
  "games",
  "currentGameId",
  "goals",
  "activities",
  "trophies",
  "friends",
  "selectedFriendSteamId",
  "visibleFriendsCount",
  "activeSession",
  "sessionHistory",
  "selectedTheme",
  "selectedUiStyle",
  "customAccent",
  "customAccent2",
  "selectedBadge",
  "customDisplayName",
  "customAvatar",
  "profileBio",
  "profileBackground",
  "profileBackgroundPreset",
  "profileLayout",
  "profileStatVisibility",
  "steamExtras",
  "steamLibrarySyncedAt",
  "localLibrarySyncedAt",
  "steamAchievementsSyncedAt",
  "achievementSyncVersion",
  "pinnedAchievementIds",
  "pinnedGameIds",
  "huntingExpanded"
];

function saveState() {
  if (state.steamProfile?.steamid) {
    saveProfileScopedState(state.steamProfile.steamid);
  }

  localStorage.setItem("gameVault", JSON.stringify({
    steamProfile:state.steamProfile,
    keybinds:state.keybinds
  }));
}

function getProfileStateStorageKey(steamid) {
  return `gameVaultProfileState:${steamid}`;
}

function getDefaultProfileScopedState() {
  return {
    games: [],
    currentGameId: null,
    goals: [],
    activities: [],
    trophies: [],
    friends: [],
    selectedFriendSteamId: null,
    visibleFriendsCount: 8,
    activeSession: null,
    sessionHistory: [],
    selectedTheme: "default",
    selectedUiStyle: "vault",
    customAccent: "",
    customAccent2: "",
    selectedBadge: "none",
    customDisplayName: "",
    customAvatar: "",
    profileBio: "",
    profileBackground: "",
    profileBackgroundPreset: "vault",
    profileLayout: "hero",
    profileStatVisibility: {
      totalHours:true,
      games:true,
      level:true,
      score:true,
      steamLevel:true,
      libraryValue:true
    },
    steamExtras: null,
    steamLibrarySyncedAt: null,
    localLibrarySyncedAt: null,
    steamAchievementsSyncedAt: null,
    achievementSyncVersion: 0,
    pinnedAchievementIds: [],
    pinnedGameIds: [],
    huntingExpanded: {
      rareMissing:false,
      rareWins:false
    }
  };
}

function getProfileScopedStateSnapshot() {
  const snapshot = {};

  profileScopedStateKeys.forEach(key => {
    snapshot[key] = globalThis.structuredClone ? globalThis.structuredClone(state[key]) : JSON.parse(JSON.stringify(state[key]));
  });

  return snapshot;
}

function saveProfileScopedState(steamid) {
  if (!steamid) return;

  localStorage.setItem(getProfileStateStorageKey(steamid), JSON.stringify({
    version:PROFILE_SCOPED_STATE_VERSION,
    savedAt:Date.now(),
    state:getProfileScopedStateSnapshot()
  }));
}

function normalizeProfileScopedState() {
  const defaults = getDefaultProfileScopedState();

  Object.entries(defaults).forEach(([key, value]) => {
    if (state[key] === undefined || state[key] === null && Array.isArray(value)) {
      state[key] = globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
    }
  });

  if (!state.profileStatVisibility) state.profileStatVisibility = {};
  state.profileStatVisibility = {
    ...defaults.profileStatVisibility,
    ...state.profileStatVisibility
  };
  if (!Array.isArray(state.goals)) state.goals = [];
  if (!Array.isArray(state.activities)) state.activities = [];
  if (!Array.isArray(state.trophies)) state.trophies = [];
  if (!Array.isArray(state.friends)) state.friends = [];
  if (!Array.isArray(state.sessionHistory)) state.sessionHistory = [];
  if (!Array.isArray(state.pinnedAchievementIds)) state.pinnedAchievementIds = [];
  if (!Array.isArray(state.pinnedGameIds)) state.pinnedGameIds = [];
  if (!("customAccent" in state)) state.customAccent = "";
  if (!("customAccent2" in state)) state.customAccent2 = "";
  if (!state.huntingExpanded) state.huntingExpanded = { rareMissing:false, rareWins:false };
  if (!state.visibleFriendsCount) state.visibleFriendsCount = 8;
}

function applyProfileScopedState(steamid) {
  const saved = steamid ? localStorage.getItem(getProfileStateStorageKey(steamid)) : null;
  const defaults = getDefaultProfileScopedState();
  let scopedState = defaults;

  if (saved) {
    try {
      const parsed = JSON.parse(saved);

      if (parsed.version === PROFILE_SCOPED_STATE_VERSION && parsed.state) {
        scopedState = {
          ...defaults,
          ...parsed.state,
          profileStatVisibility:{
            ...defaults.profileStatVisibility,
            ...(parsed.state.profileStatVisibility || {})
          }
        };
      }
    } catch (error) {
      console.error("Could not load profile-specific GameVault state:", error);
    }
  }

  profileScopedStateKeys.forEach(key => {
    state[key] = globalThis.structuredClone ? globalThis.structuredClone(scopedState[key]) : JSON.parse(JSON.stringify(scopedState[key]));
  });
  normalizeProfileScopedState();
}

function isOldPlaceholderLibrary(games) {
  return games.length === PLACEHOLDER_APP_IDS.size &&
    games.every(game => PLACEHOLDER_APP_IDS.has(game.appid));
}

function sortGamesAlphabetically(games) {
  return [...games].sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, {
      numeric:true,
      sensitivity:"base"
    });
  });
}

function loadState() {
  const data = localStorage.getItem("gameVault");

  if (data) {
    Object.assign(state, JSON.parse(data));

    if (!state.goals) state.goals = [];
    if (!state.activities) state.activities = [];
    if (!state.trophies) state.trophies = [];
    if (!state.friends) state.friends = [];
    if (!("selectedFriendSteamId" in state)) state.selectedFriendSteamId = null;
    if (!("visibleFriendsCount" in state)) state.visibleFriendsCount = 8;
    if (!("activeSession" in state)) state.activeSession = null;
    if (!state.sessionHistory) state.sessionHistory = [];
    if (!("selectedTheme" in state)) state.selectedTheme = "default";
    if (!("selectedUiStyle" in state)) state.selectedUiStyle = "vault";
    if (!("customAccent" in state)) state.customAccent = "";
    if (!("customAccent2" in state)) state.customAccent2 = "";
    if (!("selectedBadge" in state)) state.selectedBadge = "none";
    if (!("customDisplayName" in state)) state.customDisplayName = "";
    if (!("customAvatar" in state)) state.customAvatar = "";
    if (!("profileBio" in state)) state.profileBio = "";
    if (!("profileBackground" in state)) state.profileBackground = "";
    if (!("profileBackgroundPreset" in state)) state.profileBackgroundPreset = "vault";
    if (!("profileLayout" in state)) state.profileLayout = "hero";
    if (!state.profileStatVisibility) state.profileStatVisibility = {};
    state.profileStatVisibility = {
      totalHours:true,
      games:true,
      level:true,
      score:true,
      steamLevel:true,
      libraryValue:true,
      ...state.profileStatVisibility
    };
    if (!("steamExtras" in state)) state.steamExtras = null;
    if (!("steamProfile" in state)) state.steamProfile = null;
    if (!("steamLibrarySyncedAt" in state)) state.steamLibrarySyncedAt = null;
    if (!("localLibrarySyncedAt" in state)) state.localLibrarySyncedAt = null;
    if (!("steamAchievementsSyncedAt" in state)) state.steamAchievementsSyncedAt = null;
    if (!("achievementSyncVersion" in state)) state.achievementSyncVersion = 0;
    if (!Array.isArray(state.pinnedAchievementIds)) state.pinnedAchievementIds = [];
    if (!Array.isArray(state.pinnedGameIds)) state.pinnedGameIds = [];
    if (!state.huntingExpanded) state.huntingExpanded = { rareMissing:false, rareWins:false };
    if (!state.keybinds) state.keybinds = {};
    state.keybinds = normalizeKeybinds(state.keybinds);

    if (state.steamProfile?.steamid) {
      applyProfileScopedState(state.steamProfile.steamid);
    }

    if (!state.steamLibrarySyncedAt && isOldPlaceholderLibrary(state.games)) {
      state.games = [];
      state.currentGameId = null;
    }

    state.games.forEach(game => {
      if (!game.lastPlayed) game.lastPlayed = 0;
      if (!game.achievements) game.achievements = [];
      if (!game.genres) game.genres = [];
      if (!("backlogStatus" in game)) game.backlogStatus = null;
      if (!game.source) game.source = "steam";
      if (!game.accessType) game.accessType = game.source === "steam" ? "owned" : game.source;

      game.achievements.forEach(achievement => {
        achievement.rarity = getAchievementRarityLabel(achievement);
      });
    });

    state.games = sortGamesAlphabetically(state.games);

    saveState();
  } else {
    state.games = [];
    state.currentGameId = null;

    state.activities = [];

    state.trophies = [];
    state.friends = [];
    state.selectedFriendSteamId = null;
    state.visibleFriendsCount = 8;
    state.activeSession = null;
    state.sessionHistory = [];
    state.selectedTheme = "default";
    state.selectedUiStyle = "vault";
    state.customAccent = "";
    state.customAccent2 = "";
    state.selectedBadge = "none";
    state.customDisplayName = "";
    state.customAvatar = "";
    state.profileBio = "";
    state.profileBackground = "";
    state.profileBackgroundPreset = "vault";
    state.profileLayout = "hero";
    state.profileStatVisibility = {
      totalHours:true,
      games:true,
      level:true,
      score:true,
      steamLevel:true,
      libraryValue:true
    };
    state.steamExtras = null;
    state.steamProfile = null;
    state.steamLibrarySyncedAt = null;
    state.localLibrarySyncedAt = null;
    state.steamAchievementsSyncedAt = null;
    state.achievementSyncVersion = 0;
    state.pinnedAchievementIds = [];
    state.pinnedGameIds = [];
    state.huntingExpanded = {
      rareMissing:false,
      rareWins:false
    };
    state.keybinds = normalizeKeybinds({});

    saveState();
  }
}

function getCurrentGame() {
  return state.games.find(game => String(game.id) === String(state.currentGameId));
}

function findGameById(gameId) {
  return state.games.find(game => String(game.id) === String(gameId));
}

function getGameId(game) {
  return String(game?.appid || game?.id || "");
}

function isSteamGame(game) {
  return !game?.source || game.source === "steam";
}

function isLocalLibraryGame(game) {
  return ["epic", "minecraft"].includes(game?.source);
}

function isGamePinned(game) {
  return state.pinnedGameIds.includes(getGameId(game));
}

function getRecentGame() {
  const currentSteamGame = state.steamProfile?.currentGameId
    ? state.games.find(game => String(game.appid) === String(state.steamProfile.currentGameId))
    : null;

  if (currentSteamGame) return currentSteamGame;

  const playedGames = state.games.filter(game => game.lastPlayed || game.recentHours);

  return playedGames.reduce((latest, game) => {
    if (!latest) return game;

    const gamePlayedAt = game.lastPlayed || 0;
    const latestPlayedAt = latest.lastPlayed || 0;

    if (gamePlayedAt !== latestPlayedAt) {
      return gamePlayedAt > latestPlayedAt ? game : latest;
    }

    return (game.recentHours || 0) > (latest.recentHours || 0) ? game : latest;
  }, null);
}

function getQuickLaunchGames() {
  const pinnedGames = state.pinnedGameIds
    .map(id => state.games.find(game => getGameId(game) === String(id)))
    .filter(Boolean);
  const recentGame = getRecentGame();
  const games = [];

  [recentGame, ...pinnedGames].filter(Boolean).forEach(game => {
    if (!games.some(item => getGameId(item) === getGameId(game))) {
      games.push(game);
    }
  });

  return games.slice(0, 6);
}

function getTotalHours() {
  return state.games.reduce((sum, game) => sum + game.hours, 0);
}

function getPlaytimeMilestoneData() {
  const totalHours = getTotalHours();
  const unlocked = playtimeMilestones.filter(milestone => totalHours >= milestone.hours);
  const next = playtimeMilestones.find(milestone => totalHours < milestone.hours) || null;

  return {
    totalHours,
    unlocked,
    next
  };
}

function getUnlockedAchievements() {
  return state.games.reduce((sum, game) => {
    return sum + game.achievements.filter(achievement => achievement.unlocked).length;
  }, 0);
}

function getTotalAchievements() {
  return state.games.reduce((sum, game) => sum + game.achievements.length, 0);
}

function getAchievementScore() {
  return getUnlockedAchievements() * 10;
}

function getLevelData() {
  const xp = getAchievementScore();

  return getLevelDataFromXp(xp);
}

function getLevelDataFromXp(xp) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp / 15))) / 2));
  const levelStart = 15 * level * (level - 1);
  const nextLevelStart = 15 * (level + 1) * level;
  const current = xp - levelStart;
  const needed = nextLevelStart - levelStart;
  const percent = Math.round((current / needed) * 100);

  return {
    xp,
    level,
    current,
    needed,
    percent
  };
}

function getLevelTitle(level = getLevelData().level) {
  if (level >= 50) return "Vault Legend";
  if (level >= 40) return "Completionist";
  if (level >= 30) return "Rare Hunter";
  if (level >= 20) return "Vault Curator";
  if (level >= 10) return "Achievement Chaser";
  if (level >= 5) return "Library Scout";

  return "New Arrival";
}

const profileThemes = [
  { id:"default", name:"Amber Vault" },
  { id:"blue", name:"Vault Blue" },
  { id:"green", name:"Vault Green" },
  { id:"red", name:"Vault Red" },
  { id:"purple", name:"Vault Purple" },
  { id:"crimson", name:"Crimson Glass" },
  { id:"emerald", name:"Emerald Grid" },
  { id:"violet", name:"Violet Rift" },
  { id:"rose", name:"Rose Neon" },
  { id:"arctic", name:"Arctic White" },
  { id:"copper", name:"Copper Core" },
  { id:"lime", name:"Lime Circuit" },
  { id:"indigo", name:"Indigo Night" },
  { id:"teal", name:"Teal Signal" },
  { id:"mono", name:"Mono Steel" },
  { id:"owner", name:"Owner Ember", special:"owner" },
  { id:"patreonBronze", name:"Patreon Bronze", special:"patreon", tier:1 },
  { id:"patreonSilver", name:"Patreon Silver", special:"patreon", tier:2 },
  { id:"patreonGold", name:"Patreon Gold", special:"patreon", tier:3 },
  { id:"patreonPrismatic", name:"Patreon Prismatic", special:"patreon", tier:4 },
  { id:"patreonEclipse", name:"Patreon Eclipse", special:"patreon", tier:5 },
  { id:"royal", name:"Royal Blue" },
  { id:"cyan", name:"Neon Cyan" },
  { id:"pink", name:"Arcade Pink" },
  { id:"silver", name:"Silver Steel" },
  { id:"obsidian", name:"Obsidian" },
  { id:"sunset", name:"Sunset" },
  { id:"mint", name:"Mint" }
];

const colorPresetIdeas = [
  { name:"Amber", accent:"#ff8a2a", accent2:"#ffbf69" },
  { name:"Blue", accent:"#66c0f4", accent2:"#1b75bb" },
  { name:"Green", accent:"#56d68a", accent2:"#1d8a4a" },
  { name:"Red", accent:"#ff5d73", accent2:"#7a1f2f" },
  { name:"Purple", accent:"#b983ff", accent2:"#6d4aff" },
  { name:"Crimson", accent:"#ff375f", accent2:"#ff9f1c" },
  { name:"Emerald", accent:"#00d084", accent2:"#78ffd6" },
  { name:"Violet", accent:"#8f5cff", accent2:"#ff77e9" },
  { name:"Arctic", accent:"#e8f7ff", accent2:"#7dd3fc" },
  { name:"Copper", accent:"#c77d31", accent2:"#f4d35e" },
  { name:"Lime", accent:"#c3ff00", accent2:"#00ffa3" },
  { name:"Teal", accent:"#2dd4bf", accent2:"#38bdf8" }
];

const profileBadges = [
  { id:"none", name:"No Badge", level:1 },
  { id:"scout", name:"Library Scout", level:5 },
  { id:"chaser", name:"Achievement Chaser", level:10 },
  { id:"curator", name:"Vault Curator", level:20 },
  { id:"rare", name:"Rare Hunter", level:30 },
  { id:"completionist", name:"Completionist", level:40 },
  { id:"legend", name:"Vault Legend", level:50 },
  { id:"owner", name:"Owner", special:"owner" },
  { id:"patreon1", name:"Patreon Supporter", special:"patreon", tier:1 },
  { id:"patreon2", name:"Patreon Backer", special:"patreon", tier:2 },
  { id:"patreon3", name:"Patreon Champion", special:"patreon", tier:3 },
  { id:"patreon4", name:"Patreon Mythic", special:"patreon", tier:4 },
  { id:"patreon5", name:"Patreon Founder", special:"patreon", tier:5 }
];

const uiStyles = [
  { id:"vault", name:"Vault Glass" },
  { id:"contrast", name:"High Contrast" },
  { id:"arcade", name:"Arcade Glow" },
  { id:"minimal", name:"Minimal Dark" },
  { id:"command", name:"Command Bar" },
  { id:"cinema", name:"Cinema Deck" }
];

const profileBackgroundPresets = [
  { id:"vault", name:"Vault Gradient" },
  { id:"nebula", name:"Nebula" },
  { id:"ember", name:"Ember" },
  { id:"ocean", name:"Ocean" },
  { id:"forest", name:"Forest" }
];

const profileLayouts = [
  { id:"hero", name:"Hero" },
  { id:"split", name:"Split" },
  { id:"minimal", name:"Minimal" }
];

const profileStatLabels = {
  totalHours:"Total Hours",
  games:"Games",
  level:"GameVault Level",
  score:"Score",
  steamLevel:"Steam Level",
  libraryValue:"Library Value"
};

const playtimeMilestones = [
  { hours:10, title:"Settled In", description:"10 total hours played" },
  { hours:50, title:"Weekend Warrior", description:"50 total hours played" },
  { hours:100, title:"Centurion", description:"100 total hours played" },
  { hours:250, title:"Vault Regular", description:"250 total hours played" },
  { hours:500, title:"Half-Thousand Hero", description:"500 total hours played" },
  { hours:1000, title:"Timekeeper", description:"1,000 total hours played" },
  { hours:2500, title:"Deep Library", description:"2,500 total hours played" },
  { hours:5000, title:"Vault Veteran", description:"5,000 total hours played" },
  { hours:10000, title:"Ten-Thousand Hour Club", description:"10,000 total hours played" },
  { hours:25000, title:"Eternal Queue", description:"25,000 total hours played" },
  { hours:50000, title:"Mythic Archivist", description:"50,000 total hours played" }
];

const keybindDefaults = {
  toggleFullscreen:"F11",
  home:"1",
  library:"2",
  achievements:"3",
  goals:"4",
  trophies:"5",
  friends:"6",
  stats:"7",
  settings:"8"
};

const keybindLabels = {
  toggleFullscreen:"Toggle Fullscreen",
  home:"Home",
  library:"Library",
  achievements:"Achievements",
  goals:"Goals",
  trophies:"Trophies",
  friends:"Friends",
  stats:"Insights",
  settings:"Settings"
};

function normalizeKeyName(key) {
  if (!key) return "";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function normalizeKeybinds(keybinds) {
  return {
    ...keybindDefaults,
    ...(keybinds || {})
  };
}

function normalizeThemeId(themeId) {
  const legacyThemes = {
    steam:"blue",
    cozy:"green",
    rare:"royal",
    gold:"purple"
  };

  return legacyThemes[themeId] || themeId || "default";
}

function getUnlockedThemes() {
  return profileThemes.filter(isThemeUnlocked);
}

function getUnlockedBadges() {
  const level = getLevelData().level;

  return profileBadges.filter(badge => {
    if (badge.special) return isSpecialBadgeUnlocked(badge);
    return level >= badge.level;
  });
}

function getSelectedBadge() {
  const badge = profileBadges.find(item => item.id === state.selectedBadge) || profileBadges[0];

  return getUnlockedBadges().some(item => item.id === badge.id) ? badge : profileBadges[0];
}

function getProfileBadgeRailItems({ includeLevel = true } = {}) {
  const selectedBadge = getSelectedBadge();
  const latestMilestone = getPlaytimeMilestoneData().unlocked.at(-1);
  const badges = [];

  if (includeLevel) {
    badges.push({
      label:`Lvl ${getLevelData().level}`,
      className:"level"
    });
  }

  if (selectedBadge.id !== "none") {
    badges.push({
      label:selectedBadge.name,
      className:selectedBadge.special || "earned"
    });
  }

  if (latestMilestone) {
    badges.push({
      label:`${latestMilestone.hours.toLocaleString()}h`,
      title:latestMilestone.title,
      className:"hours"
    });
  }

  if (isOwnerAccount() && selectedBadge.id !== "owner") {
    badges.push({
      label:"Owner",
      className:"owner"
    });
  }

  return badges;
}

function renderProfileBadgeRail(options) {
  const badges = getProfileBadgeRailItems(options);

  return badges.map(badge => `
    <span class="profile-mini-badge ${badge.className}" title="${escapeHtml(badge.title || badge.label)}">
      ${escapeHtml(badge.label)}
    </span>
  `).join("");
}

function getProfileBackgroundStyle() {
  if (state.profileBackground) {
    return `linear-gradient(to right, rgba(0,0,0,.72), rgba(0,0,0,.18)), url("${state.profileBackground.replace(/"/g, "%22")}")`;
  }

  const preset = state.profileBackgroundPreset || "vault";
  const backgrounds = {
    vault:"radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 45%, transparent), transparent 30%), linear-gradient(135deg,#1e2a44,#24113f,#0f1018)",
    nebula:"radial-gradient(circle at 20% 20%, rgba(185,131,255,.42), transparent 30%), radial-gradient(circle at 78% 42%, rgba(102,192,244,.28), transparent 32%), linear-gradient(135deg,#0b0920,#21113a,#071521)",
    ember:"radial-gradient(circle at 22% 18%, rgba(255,191,105,.42), transparent 28%), radial-gradient(circle at 74% 58%, rgba(255,93,115,.28), transparent 34%), linear-gradient(135deg,#201007,#2a1015,#0d0909)",
    ocean:"radial-gradient(circle at 16% 22%, rgba(102,192,244,.38), transparent 30%), radial-gradient(circle at 76% 70%, rgba(86,214,138,.18), transparent 34%), linear-gradient(135deg,#061423,#0d2a36,#070b12)",
    forest:"radial-gradient(circle at 18% 24%, rgba(86,214,138,.36), transparent 30%), radial-gradient(circle at 80% 54%, rgba(255,191,105,.16), transparent 34%), linear-gradient(135deg,#06130d,#10291b,#080d0a)"
  };

  return backgrounds[preset] || backgrounds.vault;
}

function applySelectedTheme() {
  state.selectedTheme = normalizeThemeId(state.selectedTheme);
  if (!profileThemes.some(theme => theme.id === state.selectedTheme && isThemeUnlocked(theme))) {
    state.selectedTheme = "default";
  }

  document.body.dataset.theme = state.selectedTheme || "default";
  applyCustomColors();
}

function applySelectedUiStyle() {
  if (!uiStyles.some(style => style.id === state.selectedUiStyle)) {
    state.selectedUiStyle = "vault";
  }

  document.body.dataset.uiStyle = state.selectedUiStyle;
}

function isValidHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function hexToRgb(value) {
  if (!isValidHexColor(value)) return null;

  const hex = value.slice(1);

  return {
    r:parseInt(hex.slice(0, 2), 16),
    g:parseInt(hex.slice(2, 4), 16),
    b:parseInt(hex.slice(4, 6), 16)
  };
}

function mixHexColor(colorA, colorB, amount = .5) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);

  if (!a || !b) return colorA;

  const mix = channel => Math.round(a[channel] + (b[channel] - a[channel]) * amount)
    .toString(16)
    .padStart(2, "0");

  return `#${mix("r")}${mix("g")}${mix("b")}`;
}

function applyCustomColors() {
  const accent = isValidHexColor(state.customAccent) ? state.customAccent : "";
  const accent2 = isValidHexColor(state.customAccent2)
    ? state.customAccent2
    : accent
      ? mixHexColor(accent, "#ffffff", .36)
      : "";

  if (!accent) {
    document.body.style.removeProperty("--accent");
    document.body.style.removeProperty("--accent2");
    document.body.style.removeProperty("--theme-glow");
    return;
  }

  const rgb = hexToRgb(accent);

  document.body.style.setProperty("--accent", accent);
  document.body.style.setProperty("--accent2", accent2);
  document.body.style.setProperty("--theme-glow", `rgba(${rgb.r},${rgb.g},${rgb.b},.24)`);
}

function isOwnerAccount() {
  return OWNER_STEAM_IDS.has(String(state.steamProfile?.steamid || ""));
}

function isSpecialBadgeUnlocked(badge) {
  if (badge.special === "owner") return isOwnerAccount();
  if (badge.special === "patreon") return false;

  return true;
}

function isThemeUnlocked(theme) {
  if (theme.special === "owner") return isOwnerAccount();
  if (theme.special === "patreon") return false;

  return true;
}

function getCompletedGames() {
  return state.games.filter(game => game.completion === 100);
}

function getMostPlayedGame() {
  return [...state.games].sort((a, b) => b.hours - a.hours)[0];
}

function getAchievementPercent(achievement) {
  return typeof achievement?.globalPercent === "number"
    ? achievement.globalPercent
    : null;
}

function getAchievementRarityLabel(achievement) {
  const percent = getAchievementPercent(achievement);

  if (percent !== null && percent < HARD_ACHIEVEMENT_PERCENT) return "hard";
  if (percent !== null && percent <= STEAM_LEGENDARY_PERCENT) return "legendary";
  if (percent !== null && percent <= 40) return "rare";

  return achievement?.rarity || "common";
}

function isHardAchievement(achievement) {
  const percent = getAchievementPercent(achievement);

  return percent !== null && percent < HARD_ACHIEVEMENT_PERCENT;
}

function isSteamLegendaryAchievement(achievement) {
  const percent = getAchievementPercent(achievement);

  return achievement?.rarity === "legendary" ||
    achievement?.rarity === "hard" ||
    (percent !== null && percent <= STEAM_LEGENDARY_PERCENT);
}

function isGameVaultRareAchievement(achievement) {
  const rarity = getAchievementRarityLabel(achievement);

  return ["hard", "legendary", "rare"].includes(rarity);
}

function getAchievementRarityClass(achievement) {
  const rarity = getAchievementRarityLabel(achievement);
  const glowClass = isSteamLegendaryAchievement(achievement) ? " steam-glow-achievement" : "";

  return isGameVaultRareAchievement(achievement) ? ` ${rarity}-achievement rare-achievement${glowClass}` : "";
}

function getAchievementHuntBadge(achievement) {
  if (!isGameVaultRareAchievement(achievement)) return "";

  return achievement.unlocked ? "Rare win" : "Rare target";
}

function getAchievementId(game, achievement) {
  return `${game?.appid || game?.id || "game"}::${achievement?.apiname || achievement?.name || "achievement"}`;
}

function isAchievementPinned(game, achievement) {
  return state.pinnedAchievementIds.includes(getAchievementId(game, achievement));
}

function getPinnedAchievementTargets() {
  const pinnedIds = new Set(state.pinnedAchievementIds);

  return state.games.flatMap(game => getGameAchievements(game)
    .filter(achievement => pinnedIds.has(getAchievementId(game, achievement)))
    .map(achievement => ({ game, achievement })));
}

function renderAchievementIcon(achievement) {
  const icon = achievement?.unlocked
    ? achievement.icon
    : achievement?.iconGray || achievement?.icon;

  return icon
    ? `<img src="${escapeHtml(icon)}" alt="">`
    : `<span>${achievement?.unlocked ? "Done" : "Lock"}</span>`;
}

function renderAchievementTargetButton(item, { pinned = false } = {}) {
  const gameId = Number(item.game.id) || Number(item.game.appid) || 0;
  const rarityClass = getAchievementRarityClass(item.achievement);

  return `
    <button class="hunting-target${rarityClass}${pinned ? " pinned-hunt-target" : ""}" onclick="openGame(${gameId})">
      <span class="hunting-target-icon">${renderAchievementIcon(item.achievement)}</span>

      <span>
        ${escapeHtml(item.achievement.name || "Unnamed achievement")}
        <small>${escapeHtml(item.game.name || "Unknown game")} - ${formatAchievementPercent(item.achievement)}</small>
      </span>
    </button>
  `;
}

function renderExpandableHuntingCard({ title, panelKey, items, fallbackItems, emptyText, fallbackText }) {
  const sourceItems = items.length ? items : fallbackItems;
  const expanded = Boolean(state.huntingExpanded?.[panelKey]);
  const visibleItems = sourceItems.slice(0, expanded ? 9 : 4);

  return `
    <div class="hunting-card">
      <div class="hunting-card-header">
        <strong>${title}</strong>
        ${sourceItems.length > 4 ? `<button class="hunting-expand-btn" onclick="toggleHuntingPanel('${panelKey}')">${expanded ? "Show less" : "Show more"}</button>` : ""}
      </div>
      ${!items.length && fallbackItems.length ? `<p>${fallbackText}</p>` : ""}
      ${
        visibleItems.length
          ? visibleItems.map(item => renderAchievementTargetButton(item)).join("")
          : `<p>${emptyText}</p>`
      }
    </div>
  `;
}

function formatAchievementPercent(achievement) {
  const percent = getAchievementPercent(achievement);

  return percent !== null ? `${percent.toFixed(1)}%` : "No global rarity";
}

function getLegendaryAchievements(game) {
  return getGameAchievements(game).filter(achievement => {
    return achievement.unlocked && isSteamLegendaryAchievement(achievement);
  });
}

function getAchievementRaritySortValue(achievement) {
  const percent = getAchievementPercent(achievement);
  const rarity = getAchievementRarityLabel(achievement);

  if (percent !== null) return percent;
  if (rarity === "hard") return HARD_ACHIEVEMENT_PERCENT;
  if (rarity === "legendary") return STEAM_LEGENDARY_PERCENT;
  if (rarity === "rare") return 40;

  return 100;
}

function getGamesWithLegendaryAchievements() {
  return state.games.filter(game => getLegendaryAchievements(game).length > 0);
}

function getTrophyTypeLabel(type) {
  const labels = {
    completed: "Completed Game",
    mostPlayed: "Most Hours Played",
    hardest: "Hardest Achievement",
    favorite: "Favorite Game",
    rarest: "Rarest Achievement",
    hiddenGem: "Hidden Gem",
    genreSpecialist: "Genre Specialist"
  };

  return labels[type] || "Trophy";
}

function addActivity(type, icon, text, time = "Just now") {
  state.activities.unshift({
    type,
    icon,
    text,
    time,
    sortTime:Date.now()
  });

  state.activities = state.activities.slice(0, 6);
  refreshActivityPanels();
}

function getActivityIcon(item) {
  return ACTIVITY_ICONS[item.type] || ACTIVITY_ICONS[String(item.icon || "").toLowerCase()] || ACTIVITY_ICONS.new;
}

function renderActivityIconMarkup(item) {
  if (item.achievementIcon) {
    return `<span class="activity-icon achievement-activity-icon"><img src="${escapeHtml(item.achievementIcon)}" alt=""></span>`;
  }

  return `<span class="activity-icon">${getActivityIcon(item)}</span>`;
}

function getRarestUnlockedAchievement() {
  return state.games
    .flatMap(game => getGameAchievements(game)
      .filter(achievement => achievement.unlocked)
      .map(achievement => ({ game, achievement })))
    .sort((a, b) => {
      const aPercent = getAchievementPercent(a.achievement);
      const bPercent = getAchievementPercent(b.achievement);

      if (aPercent === null && bPercent === null) return 0;
      if (aPercent === null) return 1;
      if (bPercent === null) return -1;

      return aPercent - bPercent;
    })[0];
}

function getHiddenGemGame() {
  return state.games
    .filter(game => game.hours > 0)
    .sort((a, b) => {
      const aRare = gameRareCompletionScore(a);
      const bRare = gameRareCompletionScore(b);

      if (bRare !== aRare) return bRare - aRare;
      return a.hours - b.hours;
    })[0];
}

function gameRareCompletionScore(game) {
  return getGameAchievements(game)
    .filter(achievement => achievement.unlocked && isSteamLegendaryAchievement(achievement))
    .length;
}

function getGenreSpecialistOptions() {
  const counts = new Map();

  state.games
    .filter(game => game.hours > 0 || game.completion === 100)
    .forEach(game => {
      (game.genres || []).forEach(genre => {
        const current = counts.get(genre) || { genre, games:[], hours:0 };

        current.games.push(game);
        current.hours += game.hours;
        counts.set(genre, current);
      });
    });

  return [...counts.values()].sort((a, b) => {
    if (b.games.length !== a.games.length) return b.games.length - a.games.length;
    return b.hours - a.hours;
  });
}

function getGenreSpecialistData(genre = null) {
  const options = getGenreSpecialistOptions();

  if (genre) {
    return options.find(item => item.genre === genre) || null;
  }

  return options[0];
}

function getBacklogLabel(status) {
  const labels = {
    want:"Want to Play",
    playing:"Playing",
    hold:"On Hold",
    finished:"Finished",
    dropped:"Dropped"
  };

  return labels[status] || "No Backlog Status";
}

function getAccessTypeLabel(accessType) {
  const labels = {
    owned:"Owned / Steam Library",
    recent:"Recently Played",
    familyOrFree:"Shared / Free / Recently Played",
    epic:"Epic Games",
    minecraft:"Minecraft",
    minecraftCurseForge:"CurseForge",
    minecraftModrinth:"Modrinth"
  };

  return labels[accessType] || labels.owned;
}

function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!hours) return `${minutes}m`;
  if (!remainingMinutes) return `${hours}h`;

  return `${hours}h ${remainingMinutes}m`;
}

function getRecentAchievementActivities() {
  return state.games.flatMap(game => {
    return game.achievements
      .filter(achievement => achievement.unlocked && achievement.unlockTime)
      .map(achievement => ({
        type:"achievement",
        icon:"Trophy",
        achievementIcon:achievement.icon || achievement.iconGray || "",
        text:`Unlocked ${achievement.name} in ${game.name}`,
        time:new Date(achievement.unlockTime * 1000).toLocaleDateString(),
        sortTime:achievement.unlockTime * 1000
      }));
  });
}

function getFilteredManualActivities() {
  return state.activities
    .filter(activity => ["session", "achievement"].includes(activity.type))
    .map(activity => ({
      ...activity,
      sortTime:activity.sortTime || 0
    }));
}

function getActivityFeedItems() {
  const items = [
    ...getRecentAchievementActivities(),
    ...getFilteredManualActivities()
  ];

  if (state.activeSession) {
    items.unshift({
      type:"session",
      icon:"Play",
      text:`Current session: ${state.activeSession.gameName} for ${formatDuration(Date.now() - state.activeSession.startedAt)}`,
      time:"In progress",
      sortTime:Date.now()
    });
  }

  return items
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 5);
}

function getLatestFinishedSession() {
  return [...(state.sessionHistory || [])]
    .sort((a, b) => b.endedAt - a.endedAt)[0] || null;
}

function getSteamCurrentGame() {
  const appid = state.steamProfile?.currentGameId;

  if (!appid) return null;

  return state.games.find(game => String(game.appid) === String(appid)) || {
    id:Number(appid),
    appid:Number(appid),
    name:state.steamProfile.currentGame || "Steam game"
  };
}

function refreshActivityPanels() {
  renderActivityFeed();
}

function finishActiveSession() {
  if (!state.activeSession) return;

  const duration = Date.now() - state.activeSession.startedAt;

  if (duration >= 60000) {
    state.sessionHistory.unshift({
      gameId:state.activeSession.gameId,
      gameName:state.activeSession.gameName,
      startedAt:state.activeSession.startedAt,
      endedAt:Date.now(),
      durationMs:duration
    });

    state.sessionHistory = state.sessionHistory.slice(0, 500);

    addActivity(
      "session",
      "Play",
      `Played ${state.activeSession.gameName} for ${formatDuration(duration)}`,
      "Last session"
    );
  }

  state.activeSession = null;
  saveState();
  refreshActivityPanels();
}

function startGameSession(game) {
  if (state.activeSession?.gameId === game.id) {
    refreshActivityPanels();
    return;
  }

  if (state.activeSession) {
    finishActiveSession();
  }

  state.activeSession = {
    gameId:game.id,
    gameName:game.name,
    startedAt:Date.now()
  };

  saveState();
  refreshActivityPanels();
}

function updateCurrentSessionFromSteamProfile() {
  const currentSteamGame = getSteamCurrentGame();

  if (currentSteamGame) {
    startGameSession(currentSteamGame);
    return;
  }

  finishActiveSession();
}

function launchSteamGame(game) {
  if (!game.appid) {
    alert(`${game.name} does not have a Steam App ID yet.`);
    return;
  }

  window.location.href = `steam://run/${game.appid}`;
}

async function launchGame(game) {
  if (isLocalLibraryGame(game)) {
    const result = await shell.launchLocalGame?.({
      id:game.id,
      name:game.name,
      source:game.source,
      installPath:game.installPath || "",
      launchPath:game.launchPath || "",
      launchUrl:game.launchUrl || ""
    });

    if (!result?.ok) {
      alert(`Could not launch ${game.name}. ${result?.error || "No local launch target was found."}`);
    }
    return;
  }

  launchSteamGame(game);
}

window.openSteamProfileUrl = function(profileUrl) {
  if (profileUrl) {
    shell.openExternal(profileUrl);
  }
};

function setFriendActionStatus(message) {
  const status = document.getElementById("friendActionStatus");

  if (status) {
    status.textContent = message;
  }
}

function setGameInviteStatus(message) {
  const status = document.getElementById("gameInviteStatus");

  if (status) {
    status.textContent = message;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

window.openSteamChat = async function(steamid, profileUrl = "") {
  if (!steamid) return;

  setFriendActionStatus("Opening Steam chat...");
  setGameInviteStatus("Opening Steam chat...");

  const friendsResult = await shell.openExternal("steam://open/friends");
  await wait(500);
  const chatResult = await shell.openExternal(`steam://friends/message/${steamid}`);

  if (chatResult?.ok) {
    setFriendActionStatus("Steam chat requested. If it does not focus, open Friends & Chat in Steam.");
    setGameInviteStatus("Steam chat requested. If it does not focus, open Friends & Chat in Steam.");
    return;
  }

  if (profileUrl) {
    await shell.openExternal(profileUrl);
  } else {
    await shell.openExternal(`https://steamcommunity.com/profiles/${steamid}`);
  }

  const fallbackMessage = friendsResult?.ok
    ? "Steam Friends opened, but direct chat did not respond. Pick the friend from Steam Friends & Chat."
    : "Steam chat did not respond, so GameVault opened the friend profile instead.";

  setFriendActionStatus(fallbackMessage);
  setGameInviteStatus(fallbackMessage);
};

window.inviteFriendToGame = async function(steamid, profileUrl = "", gameName = "") {
  setGameInviteStatus(`Opening Steam chat for ${gameName || "this game"}...`);

  await window.openSteamChat(steamid, profileUrl);
};

function getSteamGameCover(appid) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getGameAchievements(game) {
  return Array.isArray(game?.achievements) ? game.achievements : [];
}

function getGameImagePlaceholder(gameName = "GameVault") {
  const safeName = escapeHtml(gameName || "GameVault");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="616" height="353" viewBox="0 0 616 353">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#2a1a10"/>
          <stop offset="0.55" stop-color="#151520"/>
          <stop offset="1" stop-color="#0b0b10"/>
        </linearGradient>
        <radialGradient id="glow" cx="25%" cy="15%" r="75%">
          <stop offset="0" stop-color="#ff8a2a" stop-opacity="0.45"/>
          <stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="616" height="353" fill="url(#bg)"/>
      <rect width="616" height="353" fill="url(#glow)"/>
      <rect x="26" y="26" width="564" height="301" rx="18" fill="none" stroke="#ffbf69" stroke-opacity="0.3"/>
      <text x="44" y="156" fill="#ffbf69" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">GameVault</text>
      <text x="44" y="198" fill="#f4f4f4" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">${safeName}</text>
      <text x="44" y="238" fill="#b8b8c7" font-family="Arial, Helvetica, sans-serif" font-size="20">Steam banner unavailable</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getSafeImageMarkup(game, className = "") {
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : "";
  const altText = escapeHtml(game.name || game.game || "Game cover");
  const appid = escapeHtml(game.appid || "");
  const cover = escapeHtml(game.cover || game.image || (game.appid ? getSteamGameCover(game.appid) : getGameImagePlaceholder(game.name || game.game)));

  return `<img${classAttribute} src="${cover}" alt="${altText}" data-appid="${appid}" data-game-name="${altText}" data-fallback-index="0" onerror="handleGameImageError(this)">`;
}

window.handleGameImageError = function(img) {
  const appid = img.dataset.appid;
  const fallbackIndex = Number(img.dataset.fallbackIndex || 0);
  const nextFallback = GAME_IMAGE_FALLBACKS[fallbackIndex];

  if (appid && nextFallback) {
    const nextSrc = nextFallback(appid);

    img.dataset.fallbackIndex = String(fallbackIndex + 1);
    img.src = nextSrc;
    return;
  }

  img.onerror = null;
  img.src = getGameImagePlaceholder(img.dataset.gameName || img.alt);
  img.classList.add("game-image-placeholder");
  img.closest(".game-card, .hero, .achievement-game-header, .achievement-game-thumb, .trophy-card, .friend-game-card, .friend-game-hero")?.classList.add("missing-cover");
};

function mapSteamGame(game) {
  return {
    id: game.appid,
    appid: game.appid,
    source:"steam",
    name: game.name,
    hours: Math.round((game.playtime_forever || 0) / 60),
    recentHours: Math.round((game.playtime_2weeks || 0) / 60),
    completion: 0,
    lastPlayed: game.rtime_last_played ? game.rtime_last_played * 1000 : 0,
    cover: getSteamGameCover(game.appid),
    achievements: [],
    genres: [],
    backlogStatus: null,
    accessType: "owned"
  };
}

function mapFriendSteamGame(game) {
  return {
    id: game.appid,
    appid: game.appid,
    source:"steam",
    name: game.name,
    hours: Math.round((game.playtime_forever || 0) / 60),
    lastPlayed: game.rtime_last_played ? game.rtime_last_played * 1000 : 0,
    cover: getSteamGameCover(game.appid),
    genres: []
  };
}

function mapRecentSteamGame(game) {
  return {
    id: game.appid,
    appid: game.appid,
    name: game.name,
    hours: Math.round((game.playtime_forever || 0) / 60),
    recentHours: Math.round((game.playtime_2weeks || 0) / 60),
    lastPlayed: game.rtime_last_played ? game.rtime_last_played * 1000 : 0,
    cover: getSteamGameCover(game.appid),
    achievements: [],
    genres: [],
    backlogStatus: null,
    accessType: "familyOrFree"
  };
}

async function fetchSteamAchievements(appid) {
  try {
    const response = await fetch(getApiUrl(`/api/steam/achievements/${appid}`));

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      return {
        achievements:null,
        available:false,
        error:errorData.details || errorData.error || `Steam achievement request failed with status ${response.status}`
      };
    }

    const data = await response.json();

    return {
      achievements:data.achievements || [],
      available:true,
      error:""
    };
  } catch (error) {
    console.error(error);
    return {
      achievements:null,
      available:false,
      error:error.message
    };
  }
}

async function fetchSteamAchievementsForSteamId(steamid, appid) {
  try {
    const response = await fetch(getApiUrl(`/api/steam/friends/${steamid}/achievements/${appid}`));

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      return {
        achievements:null,
        available:false,
        error:errorData.details || errorData.error || `Steam achievement request failed with status ${response.status}`
      };
    }

    const data = await response.json();

    return {
      achievements:data.achievements || [],
      available:true,
      error:""
    };
  } catch (error) {
    console.error(error);

    return {
      achievements:null,
      available:false,
      error:error.message
    };
  }
}

async function fetchRecentlyPlayedSteamGames() {
  try {
    const response = await fetch(getApiUrl("/api/steam/recently-played"));

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return (data.games || [])
      .filter(game => game.appid && game.name)
      .map(mapRecentSteamGame);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function mergeSteamLibrarySources(ownedGames, recentGames) {
  const gamesByAppId = new Map();

  ownedGames.forEach(game => {
    gamesByAppId.set(String(game.appid), {
      ...game,
      accessType:"owned"
    });
  });

  recentGames.forEach(game => {
    const key = String(game.appid);
    const existingGame = gamesByAppId.get(key);

    if (existingGame) {
      existingGame.recentHours = Math.max(existingGame.recentHours || 0, game.recentHours || 0);
      existingGame.lastPlayed = Math.max(existingGame.lastPlayed || 0, game.lastPlayed || 0);
      existingGame.hours = Math.max(existingGame.hours || 0, game.hours || 0);
      return;
    }

    gamesByAppId.set(key, game);
  });

  return sortGamesAlphabetically([...gamesByAppId.values()]);
}

async function fetchSteamAppDetails(appid) {
  try {
    const response = await fetch(getApiUrl(`/api/steam/app/${appid}/details`));

    if (!response.ok) {
      return { genres:[], categories:[] };
    }

    return response.json();
  } catch (error) {
    console.error(error);
    return { genres:[], categories:[] };
  }
}

async function fillMissingGameGenres(games) {
  const gamesMissingGenres = games.filter(game => game.appid && (!game.genres || !game.genres.length));

  await Promise.all(gamesMissingGenres.slice(0, 30).map(async game => {
    const details = await fetchSteamAppDetails(game.appid);
    game.genres = details.genres || [];
    game.cover = details.headerImage || game.cover || getSteamGameCover(game.appid);
  }));

  if (gamesMissingGenres.length) {
    saveState();
  }
}

async function hydrateSteamAchievements(games) {
  const hydratedGames = [];
  const concurrency = 4;
  let index = 0;

  async function worker() {
    while (index < games.length) {
      const gameIndex = index;
      index += 1;

      const game = games[gameIndex];
      const [achievementResult, details] = await Promise.all([
        fetchSteamAchievements(game.appid),
        fetchSteamAppDetails(game.appid)
      ]);
      const achievements = achievementResult.available
        ? achievementResult.achievements
        : getGameAchievements(game);
      const unlocked = achievements.filter(achievement => achievement.unlocked).length;
      const completion = achievements.length
        ? Math.round((unlocked / achievements.length) * 100)
        : game.completion || 0;

      hydratedGames[gameIndex] = {
        ...game,
        achievements,
        completion,
        achievementSyncAvailable:achievementResult.available,
        achievementSyncError:achievementResult.error || "",
        cover: details.headerImage || game.cover || getSteamGameCover(game.appid),
        genres: details.genres || []
      };
    }
  }

  await Promise.all(
    Array.from({ length:Math.min(concurrency, games.length) }, worker)
  );

  return hydratedGames;
}

async function refreshRecentActivityData() {
  if (!state.steamProfile) return;

  const recentGames = await fetchRecentlyPlayedSteamGames();
  const gamesByAppId = new Map(state.games.filter(isSteamGame).map(game => [String(game.appid), game]));

  recentGames.forEach(recentGame => {
    const key = String(recentGame.appid);
    const existingGame = gamesByAppId.get(key);

    if (existingGame) {
      existingGame.recentHours = Math.max(existingGame.recentHours || 0, recentGame.recentHours || 0);
      existingGame.lastPlayed = Math.max(existingGame.lastPlayed || 0, recentGame.lastPlayed || 0);
      existingGame.hours = Math.max(existingGame.hours || 0, recentGame.hours || 0);
      return;
    }

    state.games.push(recentGame);
    gamesByAppId.set(key, recentGame);
  });

  const appIdsToRefresh = [
    state.steamProfile.currentGameId,
    ...recentGames.map(game => game.appid)
  ]
    .filter(Boolean)
    .map(appid => String(appid));
  const uniqueAppIds = [...new Set(appIdsToRefresh)].slice(0, 5);

  await Promise.all(uniqueAppIds.map(async appid => {
    const game = gamesByAppId.get(String(appid));

    if (!game) return;

    const achievementResult = await fetchSteamAchievements(appid);

    if (!achievementResult.available) {
      game.achievementSyncAvailable = false;
      game.achievementSyncError = achievementResult.error || "Achievement sync unavailable.";
      return;
    }

    const achievements = achievementResult.achievements;

    if (!achievements.length) {
      game.achievementSyncAvailable = true;
      game.achievementSyncError = "";
      return;
    }

    const unlocked = achievements.filter(achievement => achievement.unlocked).length;

    game.achievements = achievements;
    game.completion = Math.round((unlocked / achievements.length) * 100);
    game.achievementSyncAvailable = true;
    game.achievementSyncError = "";
  }));

  state.games = sortGamesAlphabetically(state.games);
  state.steamAchievementsSyncedAt = Date.now();
  state.achievementSyncVersion = ACHIEVEMENT_SYNC_SCHEMA_VERSION;
  saveState();
  refreshActivityPanels();
  renderQuickLaunchDock();
}

function mergeLibraryGames(existingGames, incomingGames, sourceFilter) {
  const sourceMatches = game => {
    if (Array.isArray(sourceFilter)) return sourceFilter.includes(game.source);
    return sourceFilter ? game.source === sourceFilter : true;
  };
  const preservedGames = existingGames.filter(game => !sourceMatches(game));
  const existingById = new Map(existingGames.map(game => [getGameId(game), game]));
  const mergedIncoming = incomingGames.map(game => {
    const existing = existingById.get(getGameId(game));

    return {
      ...(existing || {}),
      ...game,
      hours:existing?.hours || game.hours || 0,
      lastPlayed:existing?.lastPlayed || game.lastPlayed || 0,
      recentHours:game.recentHours || existing?.recentHours || 0,
      achievements:game.achievements || existing?.achievements || [],
      backlogStatus:existing?.backlogStatus || game.backlogStatus || null
    };
  });

  return sortGamesAlphabetically([...preservedGames, ...mergedIncoming]);
}

async function syncSteamLibrary({ silent = false } = {}) {
  if (!state.steamProfile) return false;

  try {
    const response = await fetch(getApiUrl("/api/steam/owned-games"));

    if (!response.ok) {
      throw new Error(`Steam library request failed with status ${response.status}`);
    }

    const [data, recentGames] = await Promise.all([
      response.json(),
      fetchRecentlyPlayedSteamGames()
    ]);
    const ownedGames = sortGamesAlphabetically((data.games || [])
      .filter(game => game.appid && game.name)
      .map(mapSteamGame));
    const importedGames = mergeSteamLibrarySources(ownedGames, recentGames);
    const hydratedGames = await hydrateSteamAchievements(importedGames);

    state.games = mergeLibraryGames(state.games, hydratedGames, "steam");
    state.currentGameId = state.games[0]?.id || null;
    state.steamLibrarySyncedAt = Date.now();
    state.steamAchievementsSyncedAt = Date.now();
    state.achievementSyncVersion = ACHIEVEMENT_SYNC_SCHEMA_VERSION;

    saveState();
    renderHome();
    renderQuickLaunchDock();
    await publishGameVaultProfile();

    return true;
  } catch (error) {
    console.error(error);

    if (!silent) {
      alert("Could not import your Steam library. Make sure your Steam game details are public, then try again.");
    }

    return false;
  }
}

async function syncLocalLibrarySources({ silent = false } = {}) {
  if (typeof shell.scanLocalLibrarySources !== "function") {
    if (!silent) alert("This GameVault build cannot scan local launchers.");
    return false;
  }

  try {
    const result = await shell.scanLocalLibrarySources();

    if (!result?.ok) {
      throw new Error(result?.error || "Local launcher scan failed.");
    }

    const localGames = (result.games || [])
      .filter(game => game.id && game.name)
      .map(game => ({
        ...game,
        achievements:Array.isArray(game.achievements) ? game.achievements : [],
        genres:Array.isArray(game.genres) ? game.genres : [],
        completion:Number(game.completion) || 0,
        hours:Number(game.hours) || 0,
        recentHours:Number(game.recentHours) || 0
      }));

    state.games = mergeLibraryGames(state.games, localGames, ["epic", "minecraft"]);
    state.localLibrarySyncedAt = Date.now();

    if (!state.currentGameId) {
      state.currentGameId = state.games[0]?.id || null;
    }

    saveState();
    renderLibrary();
    renderHome();
    renderQuickLaunchDock();
    await publishGameVaultProfile();

    if (!silent) {
      alert(`Imported ${localGames.length} Minecraft/Epic entries into GameVault.`);
    }

    return true;
  } catch (error) {
    console.error(error);

    if (!silent) {
      alert(`Could not import Minecraft/Epic games. ${error.message}`);
    }

    return false;
  }
}

function getGameVaultPublicProfile() {
  const levelData = getLevelData();

  return {
    level:levelData.level,
    xp:levelData.xp,
    title:getLevelTitle(levelData.level),
    totalHours:getTotalHours(),
    gamesOwned:state.games.length,
    achievementsUnlocked:getUnlockedAchievements(),
    achievementsTotal:getTotalAchievements(),
    libraryValue:state.steamExtras?.libraryValue?.currentValueCents || 0,
    playtimeMilestone:getPlaytimeMilestoneData().unlocked.at(-1)?.title || "",
    theme:state.selectedTheme,
    badge:getSelectedBadge().name,
    specialBadges:getProfileBadgeRailItems({ includeLevel:false }).map(badge => badge.label),
    isOwner:isOwnerAccount(),
    displayName:state.customDisplayName || state.steamProfile?.username || "",
    profileBio:state.profileBio,
    profileLayout:state.profileLayout
  };
}

async function publishGameVaultProfile() {
  if (!state.steamProfile) return;

  try {
    await fetch(getApiUrl("/api/gamevault/profile"), {
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body:JSON.stringify(getGameVaultPublicProfile())
    });
  } catch (error) {
    console.error("Could not publish GameVault profile:", error);
  }
}

async function fetchSteamExtras() {
  if (!state.steamProfile || steamExtrasInProgress) return;

  try {
    steamExtrasInProgress = true;

    if (activeViewName === "settings") {
      renderSettings();
    }

    const response = await fetch(getApiUrl("/api/steam/extras"));

    if (!response.ok) return;

    state.steamExtras = await response.json();
    saveState();
  } catch (error) {
    console.error("Could not fetch Steam extras:", error);
  } finally {
    steamExtrasInProgress = false;
  }
}

const views = {
  home: document.getElementById("homeView"),
  library: document.getElementById("libraryView"),
  game: document.getElementById("gameView"),
  achievements: document.getElementById("globalAchievementsView"),
  goals: document.getElementById("goalsView"),
  trophies: document.getElementById("trophiesView"),
  friends: document.getElementById("friendsView"),
  stats: document.getElementById("statsView"),
  settings: document.getElementById("settingsView"),
  appInfo: document.getElementById("appInfoView")
};

function hideAllViews() {
  Object.values(views).forEach(view => view.classList.add("hidden"));
}

function getNavigationSnapshot() {
  return {
    view:activeViewName,
    scrollTop:document.querySelector(".main")?.scrollTop || 0,
    currentGameId:state.currentGameId,
    libraryQuery:document.getElementById("librarySearchInput")?.value || "",
    libraryFilter:document.getElementById("libraryBacklogFilter")?.value || "all",
    selectedFriendSteamId:state.selectedFriendSteamId
  };
}

function pushNavigationSnapshot() {
  const snapshot = getNavigationSnapshot();
  const last = navigationHistory.at(-1);

  if (last && last.view === snapshot.view && last.currentGameId === snapshot.currentGameId) return;

  navigationHistory.push(snapshot);
  navigationHistory = navigationHistory.slice(-30);
  updateBackButton();
}

function updateBackButton() {
  const backButton = document.getElementById("backBtn");

  if (!backButton) return;

  backButton.disabled = navigationHistory.length === 0;
}

function restoreNavigationSnapshot(snapshot) {
  if (!snapshot) return;

  if (snapshot.view === "game" && snapshot.currentGameId) {
    openGame(snapshot.currentGameId, { push:false });
  } else {
    activateView(snapshot.view, { push:false });
  }

  if (snapshot.view === "library") {
    const searchInput = document.getElementById("librarySearchInput");
    const backlogFilter = document.getElementById("libraryBacklogFilter");

    if (searchInput) searchInput.value = snapshot.libraryQuery || "";
    if (backlogFilter) backlogFilter.value = snapshot.libraryFilter || "all";
    renderLibrary();
  }

  if (snapshot.view === "friends" && snapshot.selectedFriendSteamId) {
    renderFriendProfile(snapshot.selectedFriendSteamId);
  }

  requestAnimationFrame(() => {
    const main = document.querySelector(".main");

    if (main) main.scrollTop = snapshot.scrollTop || 0;
  });

  updateBackButton();
}

function goBack() {
  const snapshot = navigationHistory.pop();

  restoreNavigationSnapshot(snapshot);
}

function showView(name) {
  const nextView = views[name];

  if (!nextView) return;

  activeViewName = name;
  updateBackButton();

  if (!nextView.classList.contains("hidden")) return;

  triggerViewTransition();
  hideAllViews();
  nextView.classList.remove("hidden");
  nextView.classList.remove("view-entering");
  void nextView.offsetWidth;
  nextView.classList.add("view-entering");
}

function triggerViewTransition() {
  return;
}

function activateView(name, { push = true } = {}) {
  if (push && activeViewName !== name && views[name]) {
    pushNavigationSnapshot();
  }

  const actions = {
    home() {
      renderHome();
      showView("home");
    },
    library() {
      renderLibrary();
      showView("library");
    },
    achievements() {
      showView("achievements");
      renderAchievements();
    },
    goals() {
      populateGoalFilter();
      renderGoals();
      showView("goals");
    },
    trophies() {
      updateTrophyForm();
      renderTrophies();
      showView("trophies");
    },
    friends() {
      renderFriends();
      showView("friends");
    },
    stats() {
      renderInsights();
      showView("stats");
    },
    settings() {
      renderSettings();
      showView("settings");
    },
    appInfo() {
      renderAppInfo();
      showView("appInfo");
    }
  };

  actions[name]?.();
}

function renderActiveView() {
  const renderers = {
    home: renderHome,
    library: renderLibrary,
    achievements: renderAchievements,
    goals() {
      populateGoalFilter();
      renderGoals();
    },
    trophies() {
      updateTrophyForm();
      renderTrophies();
    },
    friends: renderFriends,
    stats: renderInsights,
    settings: renderSettings,
    appInfo: renderAppInfo
  };

  renderers[activeViewName]?.();
}

function isTypingInField(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function updateLoginGate({ redirectHome = false } = {}) {
  const loginView = document.getElementById("loginView");
  const appShell = document.getElementById("appShell");

  if (state.steamProfile) {
    const wasHidden = appShell.classList.contains("hidden");

    loginView.classList.add("hidden");
    appShell.classList.remove("hidden");

    if (redirectHome || wasHidden) {
      renderHome();
      showView("home");
    } else {
      renderActiveView();
    }

    renderQuickLaunchDock();
  } else {
    loginView.classList.remove("hidden");
    appShell.classList.add("hidden");
    renderQuickLaunchDock();
  }
}

function queueSteamLibrarySync({ silent = true } = {}) {
  if (librarySyncInProgress || !state.steamProfile) return;

  librarySyncInProgress = true;

  syncSteamLibrary({ silent })
    .then(() => {
      if (!views[activeViewName]?.classList.contains("hidden")) {
        renderActiveView();
      }
    })
    .finally(() => {
      librarySyncInProgress = false;
    });
}

async function refreshSteamProfile() {
  try {
    const response = await fetch(getApiUrl("/api/steam/profile"));
    const data = await response.json();

    if (data.connected) {
      const previousSteamId = state.steamProfile?.steamid;
      const nextSteamId = data.profile.steamid;

      if (previousSteamId && previousSteamId !== nextSteamId) {
        finishActiveSession();
        saveProfileScopedState(previousSteamId);
      }

      if (previousSteamId !== nextSteamId) {
        applyProfileScopedState(nextSteamId);
      }

      state.steamProfile = data.profile;
      applySelectedTheme();
      applySelectedUiStyle();
      updateCurrentSessionFromSteamProfile();

      if (
        previousSteamId !== nextSteamId ||
        !state.steamLibrarySyncedAt ||
        !state.steamAchievementsSyncedAt ||
        state.achievementSyncVersion !== ACHIEVEMENT_SYNC_SCHEMA_VERSION
      ) {
        queueSteamLibrarySync({ silent: true });
      }
    } else {
      if (state.steamProfile?.steamid) {
        saveProfileScopedState(state.steamProfile.steamid);
      }

      finishActiveSession();
      state.steamProfile = null;
      state.games = [];
      state.currentGameId = null;
      state.goals = [];
      state.activities = [];
      state.trophies = [];
      state.friends = [];
      state.selectedFriendSteamId = null;
      state.sessionHistory = [];
      state.pinnedAchievementIds = [];
      state.pinnedGameIds = [];
      state.steamLibrarySyncedAt = null;
      state.steamAchievementsSyncedAt = null;
      state.steamExtras = null;
    }

    saveState();
    updateLoginGate();

    if (state.steamProfile) {
      fetchSteamExtras().then(() => {
        if (activeViewName === "home") renderHome();
        if (activeViewName === "settings") renderSettings();
      });
      await publishGameVaultProfile();
    }

    return state.steamProfile;
  } catch (error) {
    console.error(error);
    updateLoginGate();
    return null;
  }
}

async function disconnectSteamProfile() {
  try {
    if (state.steamProfile?.steamid) {
      saveProfileScopedState(state.steamProfile.steamid);
    }

    await fetch(getApiUrl("/api/steam/logout"), {
      method:"POST"
    });

    state.steamProfile = null;
    state.games = [];
    state.currentGameId = null;
    state.goals = [];
    state.activities = [];
    state.trophies = [];
    state.friends = [];
    state.selectedFriendSteamId = null;
    state.activeSession = null;
    state.sessionHistory = [];
    state.pinnedAchievementIds = [];
    state.pinnedGameIds = [];
    state.steamExtras = null;
    state.steamLibrarySyncedAt = null;
    state.steamAchievementsSyncedAt = null;
    state.achievementSyncVersion = 0;

    saveState();
    updateLoginGate();
  } catch (error) {
    console.error(error);
    alert("Could not disconnect Steam right now.");
  }
}

function pollSteamLogin() {
  let attempts = 0;
  const loginStatus = document.getElementById("loginStatus");
  const loginButton = document.getElementById("loginSteamBtn");

  if (loginStatus) {
    loginStatus.textContent = "Waiting for Steam sign-in...";
  }

  if (loginButton) {
    loginButton.disabled = true;
    loginButton.textContent = "Checking Steam sign-in...";
  }

  const interval = setInterval(async () => {
    attempts += 1;

    const profile = await refreshSteamProfile();

    if (profile) {
      clearInterval(interval);

      if (loginStatus) {
        loginStatus.textContent = "Steam connected. Loading GameVault...";
      }

      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Sign in with Steam";
      }
      return;
    }

    if (loginStatus) {
      loginStatus.textContent = `Checking for Steam sign-in... ${Math.ceil((90 - attempts * 2) / 2)}s`;
    }

    if (attempts >= 45) {
      clearInterval(interval);

      if (loginStatus) {
        loginStatus.textContent = "Still not connected. Finish Steam sign-in, then click I already signed in.";
      }

      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Sign in with Steam";
      }
    }
  }, 2000);
}

function simulateLaunch(game) {
  game.lastPlayed = Date.now();
  startGameSession(game);

  saveState();
  renderHome();
  renderQuickLaunchDock();
  launchGame(game);
}

function renderQuickLaunchDock() {
  const dock = document.getElementById("quickLaunchDock");

  if (!dock) return;

  const games = getQuickLaunchGames();

  if (!state.steamProfile || !games.length) {
    dock.innerHTML = "";
    dock.classList.add("hidden");
    return;
  }

  dock.classList.remove("hidden");
  dock.innerHTML = `
    <div class="quick-launch-label">Quick Launch</div>

    <div class="quick-launch-games">
      ${games.map(game => `
        <button
          class="quick-launch-item ${isGamePinned(game) ? "pinned" : ""}"
          title="${escapeHtml(game.name)}"
          onclick="quickLaunchGame('${escapeHtml(getGameId(game))}')"
        >
          ${getSafeImageMarkup(game)}
          <span>${escapeHtml(game.name)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function togglePinnedGame(game) {
  const gameId = getGameId(game);

  if (!gameId) return;

  if (state.pinnedGameIds.includes(gameId)) {
    state.pinnedGameIds = state.pinnedGameIds.filter(id => id !== gameId);
  } else {
    state.pinnedGameIds.push(gameId);
  }

  saveState();
  renderQuickLaunchDock();
  openGame(game.id);
}

window.quickLaunchGame = function(gameId) {
  const game = state.games.find(item => getGameId(item) === String(gameId));

  if (!game) return;

  simulateLaunch(game);
};

function bindElement(id, eventName, handler) {
  const element = document.getElementById(id);

  if (!element) return null;

  element[eventName] = handler;
  return element;
}

function attachSettingsDropdowns() {
  document.querySelectorAll(".settings-toggle-btn").forEach(button => {
    button.onclick = () => {
      const panel = document.getElementById(button.dataset.settingsTarget);

      if (!panel) return;

      panel.classList.toggle("hidden");
      button.classList.toggle("open", !panel.classList.contains("hidden"));
    };
  });
}

function renderSettings() {
  const panel = document.getElementById("settingsPanel");
  const unlockedThemes = getUnlockedThemes();
  const unlockedBadges = getUnlockedBadges();
  const steamExtrasLabel = steamExtrasInProgress ? "loading Steam level and value estimate..." : "not loaded yet";

  if (!unlockedBadges.some(badge => badge.id === state.selectedBadge)) {
    state.selectedBadge = "none";
  }

  panel.innerHTML = `
    <div class="settings-dropdown">
      <button class="settings-toggle-btn open" data-settings-target="steamSettingsPanel">
        <span>
          <strong>Steam Account</strong>
          <small>${state.steamProfile ? `Connected as ${escapeHtml(state.steamProfile.username)}` : "Not connected"}</small>
        </span>
        <span class="achievement-chevron">v</span>
      </button>

      <div id="steamSettingsPanel" class="settings-panel">
        <p>${state.steamLibrarySyncedAt ? `Steam library and achievements imported ${new Date(state.steamLibrarySyncedAt).toLocaleString()}` : "Steam library has not been imported yet."}</p>
        <p>${state.localLibrarySyncedAt ? `Minecraft/Epic library imported ${new Date(state.localLibrarySyncedAt).toLocaleString()}` : "Minecraft and Epic Games have not been imported yet."}</p>
        <p>Steam level: ${state.steamExtras?.steamLevel || steamExtrasLabel}</p>
        <p>Library value: ${state.steamExtras?.libraryValue?.currentValueFormatted || steamExtrasLabel}${state.steamExtras?.libraryValue ? ` current sale value / ${state.steamExtras.libraryValue.fullValueFormatted} full value (${state.steamExtras.libraryValue.pricedGameCount}/${state.steamExtras.libraryValue.gameCount} priced)` : ""}</p>
        <p>Inventory: ${state.steamExtras?.inventoryValue ? `${state.steamExtras.inventoryValue.itemCount} items, ${state.steamExtras.inventoryValue.marketableItemCount} marketable - ${state.steamExtras.inventoryValue.formatted}` : steamExtrasLabel}</p>
        <p>${state.steamExtras?.valueNote || "Inventory value needs market-price support and is not shown yet."}</p>

        <button id="openSteamProfileBtn" class="primary-btn">
          Open Steam Profile
        </button>

        <button id="syncSteamLibraryBtn" class="primary-btn">
          Import Steam Library & Achievements
        </button>

        <button id="syncLocalLibrariesBtn" class="primary-btn">
          Import Minecraft & Epic Games
        </button>

        <button id="refreshSteamExtrasBtn" class="secondary-btn">
          Refresh Steam Level & Value
        </button>

        <button id="disconnectSteamBtn" class="primary-btn">
          Disconnect Steam
        </button>
      </div>
    </div>

    <div class="settings-dropdown">
      <button class="settings-toggle-btn" data-settings-target="profileSettingsPanel">
        <span>
          <strong>Profile Editing</strong>
          <small>Name, bio, avatar, background, and visible stats.</small>
        </span>
        <span class="achievement-chevron">v</span>
      </button>

      <div id="profileSettingsPanel" class="settings-panel hidden">
        <label for="displayNameInput">Display Name</label>
        <input id="displayNameInput" class="settings-input" type="text" value="${escapeHtml(state.customDisplayName)}" placeholder="Use Steam name" />

        <label for="profileBioInput">Profile Bio</label>
        <input id="profileBioInput" class="settings-input" type="text" value="${escapeHtml(state.profileBio)}" placeholder="Short profile line..." />

        <label for="avatarInputSettings">Custom Avatar</label>
        <input id="avatarInputSettings" class="settings-input" type="file" accept="image/*" />
        <button id="clearAvatarBtn" class="secondary-btn">Use Steam Avatar</button>

        <label for="profileBackgroundInput">Profile Background URL</label>
        <input id="profileBackgroundInput" class="settings-input" type="url" value="${escapeHtml(state.profileBackground)}" placeholder="https://..." />

        <label for="profileBackgroundPresetSelect">Background Preset</label>
        <select id="profileBackgroundPresetSelect" class="settings-select">
          ${profileBackgroundPresets.map(preset => `<option value="${preset.id}" ${state.profileBackgroundPreset === preset.id ? "selected" : ""}>${preset.name}</option>`).join("")}
        </select>

        <label for="profileLayoutSelect">Profile Layout</label>
        <select id="profileLayoutSelect" class="settings-select">
          ${profileLayouts.map(layout => `<option value="${layout.id}" ${state.profileLayout === layout.id ? "selected" : ""}>${layout.name}</option>`).join("")}
        </select>

        <div class="settings-toggle-grid">
          ${Object.entries(profileStatLabels).map(([key, label]) => `
            <label class="settings-toggle">
              <input type="checkbox" data-profile-stat="${key}" ${state.profileStatVisibility[key] ? "checked" : ""} />
              <span>${label}</span>
            </label>
          `).join("")}
        </div>

        <button id="resetProfileCustomizationBtn" class="secondary-btn">Reset Profile Customization</button>
      </div>
    </div>

    <div class="settings-dropdown">
      <button class="settings-toggle-btn" data-settings-target="themeSettingsPanel">
        <span>
          <strong>Theme & Style</strong>
          <small>Colors, UI style, and level badges.</small>
        </span>
        <span class="achievement-chevron">v</span>
      </button>

      <div id="themeSettingsPanel" class="settings-panel hidden">
        <p>Colors are free to choose. Level rewards now unlock badges instead.</p>

        <select id="themeSelect" class="settings-select">
          ${profileThemes.map(theme => {
            const unlocked = unlockedThemes.some(item => item.id === theme.id);
            const suffix = theme.special === "patreon" ? " - Patreon locked" : theme.special === "owner" ? " - Owner only" : "";

            return `<option value="${theme.id}" ${state.selectedTheme === theme.id ? "selected" : ""} ${unlocked ? "" : "disabled"}>${theme.name}${unlocked ? "" : suffix}</option>`;
          }).join("")}
        </select>

        <label for="uiStyleSelect">UI Style</label>
        <select id="uiStyleSelect" class="settings-select">
          ${uiStyles.map(style => `<option value="${style.id}" ${state.selectedUiStyle === style.id ? "selected" : ""}>${style.name}</option>`).join("")}
        </select>

        <label>Custom UI Colors</label>
        <div class="color-picker-row">
          <label>
            <span>Main shade</span>
            <input id="customAccentInput" type="color" value="${isValidHexColor(state.customAccent) ? state.customAccent : "#ff8a2a"}" />
          </label>
          <label>
            <span>Glow shade</span>
            <input id="customAccent2Input" type="color" value="${isValidHexColor(state.customAccent2) ? state.customAccent2 : "#ffbf69"}" />
          </label>
          <button id="saveCustomColorsBtn" class="primary-btn" type="button">Save Colors</button>
          <button id="clearCustomColorsBtn" class="secondary-btn" type="button">Use Theme Colors</button>
        </div>

        <div class="color-preset-grid">
          ${colorPresetIdeas.map(preset => `
            <button
              class="color-swatch-btn"
              type="button"
              data-accent="${preset.accent}"
              data-accent2="${preset.accent2}"
              title="${preset.name}"
              style="--swatch-a:${preset.accent};--swatch-b:${preset.accent2};"
            >
              <span></span>
              ${preset.name}
            </button>
          `).join("")}
        </div>

        <label for="badgeSelect">Display Badge</label>
        <select id="badgeSelect" class="settings-select">
          ${profileBadges.map(badge => {
            const unlocked = unlockedBadges.some(item => item.id === badge.id);
            const suffix = badge.special === "patreon" ? " - Patreon locked" : badge.special === "owner" ? " - Owner only" : ` - Lvl ${badge.level}`;

            return `<option value="${badge.id}" ${state.selectedBadge === badge.id ? "selected" : ""} ${unlocked ? "" : "disabled"}>${badge.name}${unlocked ? "" : suffix}</option>`;
          }).join("")}
        </select>

        <p class="settings-note">Patreon tiers are shown as shadow rewards for now. Later they can unlock exclusive colors, shoutouts on the GameVault page, and profile flair once Patreon is connected.</p>
      </div>
    </div>

    <div class="settings-dropdown">
      <button class="settings-toggle-btn" data-settings-target="keybindSettingsPanel">
        <span>
          <strong>Keybinds</strong>
          <small>Shortcuts for fullscreen and tabs.</small>
        </span>
        <span class="achievement-chevron">v</span>
      </button>

      <div id="keybindSettingsPanel" class="settings-panel hidden">
        <p>Click a shortcut, then press the key you want to use.</p>

        <div class="keybind-grid">
          ${Object.entries(keybindLabels).map(([action, label]) => `
            <label class="keybind-row">
              <span>${label}</span>
              <input class="keybind-input" data-action="${action}" value="${state.keybinds[action] || keybindDefaults[action]}" readonly />
            </label>
          `).join("")}
        </div>

        <button id="resetKeybindsBtn" class="primary-btn">Reset Keybinds</button>
      </div>
    </div>
  `;

  attachSettingsDropdowns();

  bindElement("openSteamProfileBtn", "onclick", () => {
    if (state.steamProfile?.profileUrl) {
      shell.openExternal(state.steamProfile.profileUrl);
    }
  });

  bindElement("disconnectSteamBtn", "onclick", () => {
    disconnectSteamProfile();
  });

  bindElement("syncSteamLibraryBtn", "onclick", async () => {
    await syncSteamLibrary();
    renderSettings();
  });

  bindElement("syncLocalLibrariesBtn", "onclick", async () => {
    await syncLocalLibrarySources();
    renderSettings();
  });

  bindElement("refreshSteamExtrasBtn", "onclick", async () => {
    state.steamExtras = null;
    saveState();
    await fetchSteamExtras();
    renderSettings();
    renderHome();
  });

  bindElement("themeSelect", "onchange", event => {
    state.selectedTheme = event.target.value;
    saveState();
    applySelectedTheme();
    renderHome();
    publishGameVaultProfile();
  });

  bindElement("uiStyleSelect", "onchange", event => {
    state.selectedUiStyle = event.target.value;
    saveState();
    applySelectedUiStyle();
  });

  bindElement("saveCustomColorsBtn", "onclick", () => {
    state.customAccent = document.getElementById("customAccentInput")?.value || "";
    state.customAccent2 = document.getElementById("customAccent2Input")?.value || "";
    saveState();
    applyCustomColors();
    renderHome();
    publishGameVaultProfile();
  });

  bindElement("clearCustomColorsBtn", "onclick", () => {
    state.customAccent = "";
    state.customAccent2 = "";
    saveState();
    applyCustomColors();
    if (document.getElementById("customAccentInput")) document.getElementById("customAccentInput").value = "#ff8a2a";
    if (document.getElementById("customAccent2Input")) document.getElementById("customAccent2Input").value = "#ffbf69";
    renderHome();
  });

  document.querySelectorAll(".color-swatch-btn").forEach(button => {
    button.onclick = () => {
      state.customAccent = button.dataset.accent;
      state.customAccent2 = button.dataset.accent2;
      saveState();
      applyCustomColors();
      if (document.getElementById("customAccentInput")) document.getElementById("customAccentInput").value = state.customAccent;
      if (document.getElementById("customAccent2Input")) document.getElementById("customAccent2Input").value = state.customAccent2;
      renderHome();
    };
  });

  bindElement("badgeSelect", "onchange", event => {
    state.selectedBadge = event.target.value;
    saveState();
    renderHome();
    publishGameVaultProfile();
  });

  ["displayNameInput", "profileBioInput", "profileBackgroundInput"].forEach(id => {
    bindElement(id, "oninput", event => {
      if (id === "displayNameInput") state.customDisplayName = event.target.value.trim();
      if (id === "profileBioInput") state.profileBio = event.target.value.trim();
      if (id === "profileBackgroundInput") state.profileBackground = event.target.value.trim();

      saveState();
      renderHome();
    });
  });

  bindElement("profileBackgroundPresetSelect", "onchange", event => {
    state.profileBackgroundPreset = event.target.value;
    saveState();
    renderHome();
  });

  bindElement("profileLayoutSelect", "onchange", event => {
    state.profileLayout = event.target.value;
    saveState();
    renderHome();
  });

  bindElement("clearAvatarBtn", "onclick", () => {
    state.customAvatar = "";
    saveState();
    renderHome();
  });

  bindElement("resetProfileCustomizationBtn", "onclick", () => {
    state.customDisplayName = "";
    state.customAvatar = "";
    state.profileBio = "";
    state.profileBackground = "";
    state.profileBackgroundPreset = "vault";
    state.profileLayout = "hero";
    state.profileStatVisibility = {
      totalHours:true,
      games:true,
      level:true,
      score:true,
      steamLevel:true,
      libraryValue:true
    };
    saveState();
    renderSettings();
    renderHome();
  });

  bindElement("avatarInputSettings", "onchange", event => {
    const file = event.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      state.customAvatar = String(reader.result || "");
      saveState();
      renderHome();
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll("[data-profile-stat]").forEach(input => {
    input.onchange = event => {
      state.profileStatVisibility[event.target.dataset.profileStat] = event.target.checked;
      saveState();
      renderHome();
    };
  });

  document.querySelectorAll(".keybind-input").forEach(input => {
    input.onfocus = () => {
      input.value = "Press a key...";
    };

    input.onkeydown = event => {
      event.preventDefault();

      const action = input.dataset.action;
      const keyName = normalizeKeyName(event.key);

      if (!keyName || keyName === "Escape") {
        input.value = state.keybinds[action] || keybindDefaults[action];
        input.blur();
        return;
      }

      state.keybinds[action] = keyName;
      input.value = keyName;

      saveState();
      input.blur();
    };

    input.onblur = () => {
      const action = input.dataset.action;
      input.value = state.keybinds[action] || keybindDefaults[action];
    };
  });

  bindElement("resetKeybindsBtn", "onclick", () => {
    state.keybinds = normalizeKeybinds({});
    saveState();
    renderSettings();
  });
}

function renderAppInfo() {
  const panel = document.getElementById("appInfoPanel");

  if (!panel) return;

  panel.innerHTML = `
    <div class="app-info-grid">
      <section class="app-info-card">
        <h2>Leveling</h2>
        <p>GameVault levels come from achievement XP. Each unlocked achievement adds score, and every level needs more XP than the last.</p>
        <strong>Your current title: ${escapeHtml(getLevelTitle(getLevelData().level))}</strong>
      </section>

      <section class="app-info-card">
        <h2>Achievement Hunting</h2>
        <p>Pin locked achievements from the Achievements tab to keep them in your hunting list. Rare and hard achievements use Steam global unlock percentages when Steam provides them.</p>
      </section>

      <section class="app-info-card">
        <h2>Trophies</h2>
        <p>Your showcase can hold up to ${MAX_SHOWCASE_TROPHIES} trophies. Completion trophies are limited to ${MAX_COMPLETED_TROPHIES}, so profiles stay varied.</p>
      </section>

      <section class="app-info-card">
        <h2>Quick Launch</h2>
        <p>The bottom dock shows pinned games and recent games. Pressing a dock game launches it through Steam directly.</p>
      </section>

      <section class="app-info-card">
        <h2>Playtime Milestones</h2>
        <p>Milestones reward longer play across your whole library, starting at 10 hours and continuing through 50,000 tracked hours.</p>
      </section>

      <section class="app-info-card">
        <h2>Supporter Perks</h2>
        <p>Patreon tiers are reserved as locked shadow rewards for future supporter colors, profile flair, and shoutouts. Owner perks are account-bound and appear automatically for the owner Steam account.</p>
      </section>

      <section class="app-info-card top-profiles-card">
        <h2>Top Vaults</h2>
        <div id="topProfilesList">
          <p>Loading saved GameVault profiles...</p>
        </div>
      </section>
    </div>
  `;

  loadTopGameVaultProfiles();
}

async function loadTopGameVaultProfiles() {
  const list = document.getElementById("topProfilesList");

  if (!list) return;

  try {
    const response = await fetch(getApiUrl("/api/gamevault/top-profiles"));

    if (!response.ok) throw new Error(`Top profiles failed with status ${response.status}`);

    const data = await response.json();
    const profiles = data.profiles || [];

    list.innerHTML = profiles.length
      ? profiles.map((profile, index) => `
        <div class="top-profile-row">
          <span>${index + 1}</span>
          <img src="${escapeHtml(profile.avatar || "")}" alt="">
          <strong>${escapeHtml(profile.displayName || profile.username || "Player")}</strong>
          <small>${profile.isOwner ? "Owner - " : ""}Lvl ${Number(profile.level) || 1}${profile.badge ? ` - ${escapeHtml(profile.badge)}` : ""}</small>
        </div>
      `).join("")
      : `<p>No public GameVault profiles saved yet.</p>`;
  } catch (error) {
    console.error(error);
    list.innerHTML = `<p>Could not load top profiles right now.</p>`;
  }
}

function renderProfile() {
  const levelData = getLevelData();

  const profileName = document.getElementById("profileName");
  const profileBadgeRail = document.getElementById("profileBadgeRail");
  const profileTagline = document.getElementById("profileTagline");
  const avatarImg = document.getElementById("avatarImg");
  const profileCommand = document.querySelector(".profile-command");
  const profileBg = document.querySelector(".profile-bg");
  const displayName = state.customDisplayName || state.steamProfile?.username || "Player";
  const tagline = state.profileBio || getLevelTitle(levelData.level);

  if (profileCommand) {
    profileCommand.dataset.layout = state.profileLayout || "hero";
  }

  if (profileBg) {
    profileBg.style.backgroundImage = getProfileBackgroundStyle();
  }

  if (state.steamProfile) {
    profileName.textContent = displayName;
    profileTagline.textContent = tagline;
    avatarImg.src = state.customAvatar || state.steamProfile.avatar;
  } else {
    profileName.textContent = displayName;
    profileTagline.textContent = tagline;
    avatarImg.src = state.customAvatar || "https://via.placeholder.com/100";
  }

  if (profileBadgeRail) {
    profileBadgeRail.innerHTML = renderProfileBadgeRail();
  }

  document.getElementById("totalHours").textContent = `${getTotalHours()}h`;
  document.getElementById("gamesOwned").textContent = state.games.length;
  document.getElementById("userLevel").textContent = `Lvl ${levelData.level}`;
  document.getElementById("achievementScore").textContent = getAchievementScore();
  document.getElementById("steamLevel").textContent = state.steamExtras?.steamLevel || "--";
  document.getElementById("libraryValue").textContent = state.steamExtras?.libraryValue?.currentValueFormatted || "--";
  [
    ["totalHours", "totalHours"],
    ["gamesOwned", "games"],
    ["userLevel", "level"],
    ["achievementScore", "score"],
    ["steamLevel", "steamLevel"],
    ["libraryValue", "libraryValue"]
  ].forEach(([elementId, statKey]) => {
    document.getElementById(elementId)?.closest(".stat-box")?.classList.toggle("hidden", !state.profileStatVisibility[statKey]);
  });
  document.getElementById("xpFill").style.width = `${levelData.percent}%`;
  document.getElementById("xpText").textContent = `${levelData.current}/${levelData.needed} XP to Level ${levelData.level + 1}`;
}

function renderShowcase() {
  const container = document.getElementById("showcaseGrid");

  if (!state.trophies.length) {
    container.innerHTML = `
      <div class="empty-trophies">
        No trophies selected yet.<br><br>
        Go to the Trophies page to create your showcase.
      </div>
    `;
    return;
  }

  container.innerHTML = state.trophies.map(trophy => `
    <div class="trophy-card">
      ${getSafeImageMarkup(trophy)}

      <div class="trophy-card-content">
        <div class="trophy-badge">${getTrophyTypeLabel(trophy.type)}</div>

        <div>
          <h3>${trophy.title}</h3>
          <p>${trophy.description}</p>
        </div>
      </div>
    </div>
  `).join("");
}

function renderPlaytimeMilestones() {
  const container = document.getElementById("playtimeMilestones");

  if (!container) return;

  container.innerHTML = "";
  container.classList.add("hidden");
}

function renderActivityFeed() {
  const container = document.getElementById("activityFeed");

  if (!container) return;

  const items = getActivityFeedItems();

  if (!items.length) {
    container.innerHTML = `
      <div class="activity-item">
        <span class="activity-icon">${ACTIVITY_ICONS.new}</span>

        <div>
          <strong>No recent activity yet</strong><br>
          <small>Play a game or unlock an achievement.</small>
        </div>
      </div>
    `;

    return;
  }

  container.innerHTML = items.map(item => `
    <div class="activity-item">
      ${renderActivityIconMarkup(item)}

      <div>
        <strong>${item.text}</strong><br>
        <small>${item.time}</small>
      </div>
    </div>
  `).join("");
}

function renderHome() {
  renderProfile();
  renderShowcase();
  renderPlaytimeMilestones();
  refreshActivityPanels();

  const game = getRecentGame();
  const container = document.getElementById("homeHero");

  if (!game) {
    container.innerHTML = `
      <div class="empty-library">
        No games imported yet. Import Steam, Minecraft, or Epic Games from Settings to start building your vault.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="hero" id="recentHero">
      ${getSafeImageMarkup(game)}

      <div class="hero-overlay">
        <div class="hero-top">
          <div>
            <h1>${game.name}</h1>

            <button class="play-btn" id="homePlayBtn">
               Play
            </button>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <strong>${game.hours}h</strong>
              <small>Hours</small>
            </div>

            <div class="stat-box">
              <strong>${game.completion}%</strong>
              <small>Complete</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("recentHero").onclick = () => {
    openGame(game.id);
  };

  document.getElementById("homePlayBtn").onclick = event => {
    event.stopPropagation();
    simulateLaunch(game);
  };
}

function renderLibrary() {
  const grid = document.getElementById("libraryGrid");
  const searchInput = document.getElementById("librarySearchInput");
  const backlogFilter = document.getElementById("libraryBacklogFilter");
  const query = searchInput?.value.trim().toLowerCase() || "";
  const filter = backlogFilter?.value || "all";
  const visibleGames = sortGamesAlphabetically(state.games)
    .filter(game => game.name.toLowerCase().includes(query))
    .filter(game => {
      if (filter === "all") return true;
      if (filter === "none") return !game.backlogStatus;
      return game.backlogStatus === filter;
    });

  grid.innerHTML = "";

  if (!state.games.length) {
    grid.innerHTML = `
      <div class="empty-library">
        No games imported yet. Import Steam, Minecraft, or Epic Games from Settings. Steam may hide your Steam library when your game details are private.
      </div>
    `;
    return;
  }

  if (!visibleGames.length) {
    grid.innerHTML = `
      <div class="empty-library">
        No games match that search.
      </div>
    `;
    return;
  }

  visibleGames.forEach(game => {
    const card = document.createElement("div");

    card.className = "game-card";

    card.innerHTML = `
      ${getSafeImageMarkup(game)}

      <div class="card-info">
        <strong>${game.name}</strong>
        <p>${game.hours}h - ${game.completion}%</p>
        <small>${getBacklogLabel(game.backlogStatus)}</small>
        <span class="library-source ${game.accessType === "owned" ? "" : "shared-source"}">${escapeHtml(game.localSourceLabel || getAccessTypeLabel(game.accessType))}</span>
      </div>
    `;

    card.onclick = () => openGame(game.id);

    grid.appendChild(card);
  });
}

function openGame(gameId, { push = true } = {}) {
  if (push) {
    pushNavigationSnapshot();
  }

  state.currentGameId = gameId;

  saveState();

  const game = getCurrentGame();

  if (!game) {
    renderLibrary();
    showView("library");
    return;
  }

  const hero = document.getElementById("gameHero");

  hero.innerHTML = `
    <div class="hero">
      ${getSafeImageMarkup(game)}

      <div class="hero-overlay">
        <div class="hero-top">
          <div>
            <h1>${game.name}</h1>

            <button class="play-btn" id="detailPlayBtn">
               Play
            </button>

            <button class="pin-game-btn ${isGamePinned(game) ? "active" : ""}" id="detailPinGameBtn">
              ${isGamePinned(game) ? "Pinned" : "Pin to Dock"}
            </button>

            <select id="detailBacklogSelect" class="backlog-select">
              <option value="">No Backlog Status</option>
              <option value="want">Want to Play</option>
              <option value="playing">Playing</option>
              <option value="hold">On Hold</option>
              <option value="finished">Finished</option>
              <option value="dropped">Dropped</option>
            </select>
          </div>

          <div class="hero-stats">
            <div class="stat-box">
              <strong>${game.hours}h</strong>
              <small>Hours</small>
            </div>

            <div class="stat-box">
              <strong>${game.completion}%</strong>
              <small>Complete</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("detailPlayBtn").onclick = () => simulateLaunch(game);
  document.getElementById("detailPinGameBtn").onclick = () => togglePinnedGame(game);
  document.getElementById("detailBacklogSelect").value = game.backlogStatus || "";
  document.getElementById("detailBacklogSelect").onchange = event => {
    game.backlogStatus = event.target.value || null;
    saveState();
    renderLibrary();
  };

  renderGameDropdowns();
  renderGameFriends(game);

  showView("game");
}

window.openGame = openGame;

function renderGameDropdowns() {
  const game = getCurrentGame();
  const searchWasFocused = document.activeElement?.id === "gameAchievementSearchInput";
  const query = document.getElementById("gameAchievementSearchInput")?.value.trim().toLowerCase() || "";
  const missingAchievements = game.achievements
    .filter(achievement => !achievement.unlocked)
    .filter(achievement => {
      if (!query) return true;

      return String(achievement.name || "").toLowerCase().includes(query) ||
        String(achievement.description || "").toLowerCase().includes(query);
    });

  const achievementMarkup = missingAchievements
    .sort((a, b) => {
      const aPinned = isAchievementPinned(game, a);
      const bPinned = isAchievementPinned(game, b);

      if (aPinned !== bPinned) return Number(bPinned) - Number(aPinned);

      return getAchievementRaritySortValue(a) - getAchievementRaritySortValue(b);
    })
    .map(achievement => `
      <div class="list-item achievement-mini-row${getAchievementRarityClass(achievement)}${isAchievementPinned(game, achievement) ? " pinned-achievement" : ""}">
        <span class="achievement-icon">${renderAchievementIcon(achievement)}</span>
        <span>
          <strong>${escapeHtml(achievement.name)}</strong>
          <small>${isAchievementPinned(game, achievement) ? "Pinned hunt - " : ""}${formatAchievementPercent(achievement)}</small>
        </span>
      </div>
    `)
    .join("");

  document.getElementById("achievementsPanel").innerHTML =
    game.achievements.length
      ? `
        <input
          id="gameAchievementSearchInput"
          class="achievement-search compact-search"
          type="search"
          placeholder="Search missing achievements..."
          value="${escapeHtml(query)}"
        />
        ${missingAchievements.length ? achievementMarkup : `<div class="list-item">${query ? "No missing achievements match that search." : "All tracked achievements completed."}</div>`}
      `
      : `<div class="list-item">Achievement sync is not available for this game yet.</div>`;

  const gameAchievementSearchInput = document.getElementById("gameAchievementSearchInput");

  if (gameAchievementSearchInput) {
    gameAchievementSearchInput.oninput = renderGameDropdowns;

    if (searchWasFocused) {
      gameAchievementSearchInput.focus();
      gameAchievementSearchInput.setSelectionRange(gameAchievementSearchInput.value.length, gameAchievementSearchInput.value.length);
    }
  }

  document.getElementById("goalsPanel").innerHTML =
    state.goals
      .filter(goal => String(goal.gameId) === String(game.id) && !goal.done)
      .map(goal => `<div class="list-item">Goal - ${goal.text}</div>`)
      .join("");
}

async function renderGameFriends(game) {
  const panel = document.getElementById("gameFriendsPanel");

  if (!panel || !game?.appid) return;

  panel.innerHTML = `
    <div class="game-friends-card">
      <div class="panel-title">
        <h2>Friends With This Game</h2>
        <p>Checking public Steam libraries...</p>
      </div>
    </div>
  `;

  try {
    const friendsWithGame = await ensureFriendsForGame(game);

    if (state.currentGameId !== game.id) return;

    panel.innerHTML = `
      <div class="game-friends-card">
        <div class="panel-title">
          <h2>Friends With This Game</h2>
          <p>${friendsWithGame.length ? "Invite someone through Steam chat." : "No public friend libraries show this game yet."}</p>
        </div>

        ${
          friendsWithGame.length
            ? `
              <div class="game-friends-list">
                ${friendsWithGame.slice(0, 12).map(friend => {
                  const friendGame = (friend.games || []).find(item => String(item.appid) === String(game.appid));

                  return `
                    <div class="game-friend-row">
                      <img src="${escapeHtml(friend.avatar)}" alt="${escapeHtml(friend.username)}">
                      <span>
                        <strong>${escapeHtml(friend.username)}</strong>
                        <small>${friend.currentGame ? `Playing ${escapeHtml(friend.currentGame)}` : `${friendGame?.hours || 0}h played - ${getPersonaStatusLabel(friend.status)}`}</small>
                      </span>
                      <button
                        class="steam-chat-btn game-invite-btn"
                        data-steamid="${escapeHtml(friend.steamid)}"
                        data-profile-url="${escapeHtml(friend.profileUrl)}"
                        data-game-name="${escapeHtml(game.name)}"
                      >
                        Message
                      </button>
                    </div>
                  `;
                }).join("")}
              </div>
              <small id="gameInviteStatus" class="friend-action-status"></small>
            `
            : `
              <div class="empty-library">
                Friends with private libraries cannot be checked. Steam does not allow third-party apps to send hidden game invites directly.
              </div>
            `
        }
      </div>
    `;
  } catch (error) {
    console.error(error);
    panel.innerHTML = `
      <div class="game-friends-card">
        <div class="empty-library">
          Could not check friends for this game right now.
        </div>
      </div>
    `;
  }
}

function renderAchievementsLegacy() {
  const container = document.getElementById("globalAchievementsContainer");

  container.innerHTML = "";

  if (!state.games.length) {
    container.innerHTML = `
      <div class="empty-library">
        Import your Steam library first to see achievement progress here. Local launcher games can still appear in your Library, but achievements depend on Steam data.
      </div>
    `;
    return;
  }

  state.games.forEach(game => {
    const total = game.achievements.length;
    const unlocked = game.achievements.filter(achievement => achievement.unlocked).length;
    const missing = game.achievements.filter(achievement => !achievement.unlocked);
    const percent = total ? Math.round((unlocked / total) * 100) : 0;

    const block = document.createElement("div");

    block.className = "achievement-game-card";

    block.innerHTML = `
      <div class="achievement-game-header">
        ${getSafeImageMarkup(game)}

        <div class="achievement-game-overlay">
          <div>
            <h2>${game.name}</h2>

            <p>
              ${missing.length} missing 
              ${percent}% complete
            </p>
          </div>

          <div class="achievement-progress">
            <div class="achievement-progress-bar">
              <div style="width:${percent}%"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="achievement-list">
        ${
          missing.length
            ? missing.map(achievement => `
              <div class="achievement-item locked">
                <div class="achievement-icon"></div>

                <div>
                  <strong>${achievement.name}</strong>
                  <p>${achievement.rarity || "common"} achievement</p>
                </div>
              </div>
            `).join("")
            : `
              <div class="achievement-complete">
                ${total ? " All achievements completed" : "Achievement sync is not available for this game yet."}
              </div>
            `
        }
      </div>
    `;

    container.appendChild(block);
  });
}

function renderAchievements() {
  const container = document.getElementById("globalAchievementsContainer");
  const searchInput = document.getElementById("achievementSearchInput");
  const query = searchInput?.value.trim().toLowerCase() || "";
  const visibleGames = sortGamesAlphabetically(state.games)
    .filter(game => {
      if (!query) return true;

      return String(game.name || "").toLowerCase().includes(query) ||
        getGameAchievements(game).some(achievement => {
          return String(achievement.name || "").toLowerCase().includes(query) ||
            String(achievement.description || "").toLowerCase().includes(query);
        });
    });

  container.innerHTML = "";

  if (!state.games.length) {
    container.innerHTML = `
      <div class="empty-library">
        Import your Steam library first to see achievement progress here. Local launcher games can still appear in your Library, but achievements depend on Steam data.
      </div>
    `;
    return;
  }

  container.innerHTML = renderAchievementHuntingPanel();

  if (!visibleGames.length) {
    container.innerHTML += `
      <div class="empty-library">
        No games match that search.
      </div>
    `;
    return;
  }

  visibleGames.forEach((game, index) => {
    const achievements = getGameAchievements(game);
    const total = achievements.length;
    const unlocked = achievements.filter(achievement => achievement.unlocked).length;
    const missing = achievements.filter(achievement => !achievement.unlocked);
    const percent = total ? Math.round((unlocked / total) * 100) : 0;
    const safeGameId = String(game.id ?? game.appid ?? index).replace(/[^a-zA-Z0-9_-]/g, "");
    const listId = `achievementList-${safeGameId || index}`;

    const achievementsForQuery = query
      ? achievements.filter(achievement => {
        return String(game.name || "").toLowerCase().includes(query) ||
          String(achievement.name || "").toLowerCase().includes(query) ||
          String(achievement.description || "").toLowerCase().includes(query);
      })
      : achievements;
    const sortedAchievements = [...achievementsForQuery].sort((a, b) => {
      const aRareMissing = !a.unlocked && isGameVaultRareAchievement(a);
      const bRareMissing = !b.unlocked && isGameVaultRareAchievement(b);

      if (aRareMissing !== bRareMissing) return Number(bRareMissing) - Number(aRareMissing);
      if (a.unlocked !== b.unlocked) return Number(a.unlocked) - Number(b.unlocked);

      return getAchievementRaritySortValue(a) - getAchievementRaritySortValue(b);
    });

    const achievementRows = total
      ? sortedAchievements.map(achievement => {
        const globalPercent = typeof achievement.globalPercent === "number"
          ? ` - ${achievement.globalPercent.toFixed(1)}% global`
          : "";
        const rarityLabel = getAchievementRarityLabel(achievement);
        const description = achievement.description ||
          `${rarityLabel} achievement${globalPercent}`;
        const huntBadge = getAchievementHuntBadge(achievement);
        const pinned = isAchievementPinned(game, achievement);

        return `
          <div class="achievement-item ${achievement.unlocked ? "unlocked" : "locked"}${getAchievementRarityClass(achievement)}${pinned ? " pinned-achievement" : ""}">
            <div class="achievement-icon">
              ${renderAchievementIcon(achievement)}
            </div>

            <div>
              <strong>${escapeHtml(achievement.name || "Unnamed achievement")}</strong>
              <p>${escapeHtml(description)}</p>
              ${huntBadge || pinned ? `<small class="achievement-hunt-badge">${pinned ? "Pinned hunt" : huntBadge} - ${formatAchievementPercent(achievement)}</small>` : ""}
            </div>

            <div class="achievement-actions">
              <span class="achievement-status">
                ${achievement.unlocked ? "Unlocked" : "Locked"}
              </span>

              ${achievement.unlocked ? "" : `
                <button class="achievement-pin-btn ${pinned ? "active" : ""}" onclick="toggleAchievementHunt('${escapeHtml(getAchievementId(game, achievement))}')">
                  ${pinned ? "Pinned" : "Pin"}
                </button>
              `}
            </div>
          </div>
        `;
      }).join("")
      : `
        <div class="achievement-complete">
          ${game.achievementSyncAvailable === false
            ? `Achievement sync is unavailable: ${escapeHtml(game.achievementSyncError || "Steam did not return achievement progress for this game.")}`
            : "Achievement sync is not available for this game yet."}
        </div>
      `;
    const syncNote = game.achievementSyncAvailable === false
      ? "Achievement sync unavailable"
      : `${unlocked}/${total} unlocked - ${missing.length} missing - ${percent}% complete`;

    const block = document.createElement("div");

    block.className = "achievement-dropdown";

    block.innerHTML = `
      <button class="achievement-game-toggle" onclick="toggleAchievementGame('${listId}')">
        <span class="achievement-game-thumb">
          ${getSafeImageMarkup(game)}
        </span>

        <span class="achievement-game-summary">
          <strong>${escapeHtml(game.name || "Unknown game")}</strong>
          <small>${syncNote}</small>
          <span class="achievement-progress-bar">
            <span style="width:${percent}%"></span>
          </span>
        </span>

        <span class="achievement-chevron">v</span>
      </button>

      <div id="${listId}" class="achievement-list hidden">
        ${achievementRows}
      </div>
    `;

    container.appendChild(block);
  });
}

function renderAchievementHuntingPanel() {
  const gamesWithAchievements = state.games.filter(game => getGameAchievements(game).length);
  const pinnedTargets = getPinnedAchievementTargets()
    .sort((a, b) => {
      if (a.achievement.unlocked !== b.achievement.unlocked) return Number(a.achievement.unlocked) - Number(b.achievement.unlocked);
      return getAchievementRaritySortValue(a.achievement) - getAchievementRaritySortValue(b.achievement);
    });
  const missingAchievementPool = gamesWithAchievements
    .flatMap(game => getGameAchievements(game)
      .filter(achievement => !achievement.unlocked)
      .map(achievement => ({ game, achievement })));
  const unlockedAchievementPool = gamesWithAchievements
    .flatMap(game => getGameAchievements(game)
      .filter(achievement => achievement.unlocked)
      .map(achievement => ({ game, achievement })));
  const closestGames = gamesWithAchievements
    .map(game => {
      const missing = getGameAchievements(game).filter(achievement => !achievement.unlocked);

      return { game, missing };
    })
    .filter(item => item.missing.length > 0)
    .sort((a, b) => {
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      return (Number(b.game.completion) || 0) - (Number(a.game.completion) || 0);
    })
    .slice(0, 3);
  const rareMissing = missingAchievementPool
    .filter(item => isGameVaultRareAchievement(item.achievement))
    .sort((a, b) => {
      const aHard = isHardAchievement(a.achievement) ? 0 : 1;
      const bHard = isHardAchievement(b.achievement) ? 0 : 1;

      if (aHard !== bHard) return aHard - bHard;
      return getAchievementRaritySortValue(a.achievement) - getAchievementRaritySortValue(b.achievement);
    })
    .slice(0, 8);
  const fallbackMissing = rareMissing.length ? [] : missingAchievementPool
    .sort((a, b) => getAchievementRaritySortValue(a.achievement) - getAchievementRaritySortValue(b.achievement))
    .slice(0, 8);
  const rareUnlocked = unlockedAchievementPool
    .filter(item => isGameVaultRareAchievement(item.achievement))
    .sort((a, b) => getAchievementRaritySortValue(a.achievement) - getAchievementRaritySortValue(b.achievement))
    .slice(0, 8);
  const fallbackUnlocked = rareUnlocked.length ? [] : unlockedAchievementPool
    .sort((a, b) => getAchievementRaritySortValue(a.achievement) - getAchievementRaritySortValue(b.achievement))
    .slice(0, 8);

  return `
    <div class="hunting-panel">
      <div class="panel-title">
        <h2>Achievement Hunting</h2>
        <p>Fast targets, rare misses, and rare wins.</p>
      </div>

      <div class="pinned-hunts">
        <strong>Pinned Hunts</strong>
        ${
          pinnedTargets.length
            ? pinnedTargets.map(item => renderAchievementTargetButton(item, { pinned:true })).join("")
            : `<p>Pin locked achievements from any game list to keep them here.</p>`
        }
      </div>

      <div class="hunting-grid">
        <div class="hunting-card">
          <strong>Closest to 100%</strong>
          ${closestGames.length ? closestGames.map(item => `
            <button onclick="openGame(${Number(item.game.id) || Number(item.game.appid) || 0})">
              ${escapeHtml(item.game.name || "Unknown game")}
              <small>${item.missing.length} missing</small>
            </button>
          `).join("") : `<p>No tracked achievement targets yet.</p>`}
        </div>

        ${renderExpandableHuntingCard({
          title:"Rarest Missing",
          panelKey:"rareMissing",
          items:rareMissing,
          fallbackItems:fallbackMissing,
          fallbackText:"Steam did not return rare missing data yet, so these are your next missing targets.",
          emptyText:"No missing achievements found."
        })}

        ${renderExpandableHuntingCard({
          title:"Rare Wins",
          panelKey:"rareWins",
          items:rareUnlocked,
          fallbackItems:fallbackUnlocked,
          fallbackText:"Steam did not return rare win data yet, so these are your latest unlocked targets.",
          emptyText:"No unlocked achievements yet."
        })}
      </div>
    </div>
  `;
}window.toggleAchievementGame = function(listId) {
  const list = document.getElementById(listId);
  const toggle = list?.previousElementSibling;

  if (!list) return;

  list.classList.toggle("hidden");
  toggle?.classList.toggle("open", !list.classList.contains("hidden"));
};

window.toggleAchievementHunt = function(achievementId) {
  if (state.pinnedAchievementIds.includes(achievementId)) {
    state.pinnedAchievementIds = state.pinnedAchievementIds.filter(id => id !== achievementId);
  } else {
    state.pinnedAchievementIds.push(achievementId);
  }

  saveState();
  renderAchievements();
};

window.toggleHuntingPanel = function(panelKey) {
  state.huntingExpanded = {
    rareMissing:false,
    rareWins:false,
    ...state.huntingExpanded,
    [panelKey]:!state.huntingExpanded?.[panelKey]
  };
  saveState();
  renderAchievements();
};

async function fetchSteamFriends() {
  const response = await fetch(getApiUrl("/api/steam/friends"));

  if (!response.ok) {
    throw new Error(`Steam friends request failed with status ${response.status}`);
  }

  const data = await response.json();

  state.friends = sortFriendsForDisplay(data.friends || []);

  saveState();
}

async function fetchFriendLibrary(friend) {
  const response = await fetch(getApiUrl(`/api/steam/friends/${friend.steamid}/library`));

  if (!response.ok) {
    friend.libraryPrivate = true;
    friend.games = [];
    return;
  }

  const data = await response.json();

  friend.games = sortGamesAlphabetically((data.games || []).map(mapFriendSteamGame));
  friend.libraryPrivate = false;
  saveState();
}

async function ensureFriendsForGame(game) {
  if (!state.friends.length) {
    await fetchSteamFriends();
  }

  const friendsToCheck = state.friends
    .filter(friend => !friend.libraryPrivate && !friend.games)
    .slice(0, 40);
  let index = 0;
  const concurrency = 4;

  async function worker() {
    while (index < friendsToCheck.length) {
      const friend = friendsToCheck[index];
      index += 1;

      try {
        await fetchFriendLibrary(friend);
      } catch (error) {
        friend.libraryPrivate = true;
        friend.games = [];
      }
    }
  }

  await Promise.all(Array.from({ length:Math.min(concurrency, friendsToCheck.length) }, worker));

  return state.friends.filter(friend => {
    return (friend.games || []).some(friendGame => String(friendGame.appid) === String(game.appid));
  });
}

async function fetchFriendRecentlyPlayed(friend) {
  const response = await fetch(getApiUrl(`/api/steam/friends/${friend.steamid}/recently-played`));

  if (!response.ok) {
    friend.recentGames = [];
    return;
  }

  const data = await response.json();

  friend.recentGames = (data.games || []).map(mapRecentSteamGame);
  saveState();
}

async function fetchFriendAchievements(friend) {
  if (!friend.games?.length || friend.achievementsSynced) return;

  const gamesToHydrate = [...friend.games]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20);

  let index = 0;
  const concurrency = 3;

  async function worker() {
    while (index < gamesToHydrate.length) {
      const game = gamesToHydrate[index];
      index += 1;

      try {
        const achievementResult = await fetchSteamAchievementsForSteamId(friend.steamid, game.appid);

        if (!achievementResult.available) continue;

        const achievements = achievementResult.achievements || [];
        const unlocked = achievements.filter(achievement => achievement.unlocked).length;

        game.achievements = achievements;
        game.completion = achievements.length ? Math.round((unlocked / achievements.length) * 100) : 0;
      } catch (error) {
        console.error(error);
      }
    }
  }

  await Promise.all(Array.from({ length:concurrency }, worker));

  friend.achievementsSynced = true;
  saveState();
}

function getPersonaStatusLabel(status) {
  const labels = {
    0: "Offline",
    1: "Online",
    2: "Busy",
    3: "Away",
    4: "Snooze",
    5: "Looking to trade",
    6: "Looking to play"
  };

  return labels[status] || "Unknown";
}

function isFriendActive(friend) {
  return friend.status && friend.status !== 0;
}

function sortFriendsForDisplay(friends) {
  return [...friends].sort((a, b) => {
    const activeDiff = Number(isFriendActive(b)) - Number(isFriendActive(a));

    if (activeDiff !== 0) return activeDiff;

    return a.username.localeCompare(b.username, undefined, {
      numeric:true,
      sensitivity:"base"
    });
  });
}

function getFriendStats(friend) {
  const games = friend.games || [];
  const totalHours = games.reduce((sum, game) => sum + game.hours, 0);
  const unlockedAchievements = games.reduce((sum, game) => {
    return sum + getGameAchievements(game).filter(achievement => achievement.unlocked).length;
  }, 0);
  const totalAchievements = games.reduce((sum, game) => sum + getGameAchievements(game).length, 0);
  const levelData = getLevelDataFromXp(unlockedAchievements * 10);
  const gameVaultLevel = Number(friend.gameVaultProfile?.level) || 0;
  const displayLevelData = gameVaultLevel
    ? {
      ...getLevelDataFromXp(Number(friend.gameVaultProfile?.xp) || 0),
      level:gameVaultLevel
    }
    : levelData;
  const recentGame = games.reduce((latest, game) => {
    if (!latest || game.lastPlayed > latest.lastPlayed) return game;
    return latest;
  }, null);
  const mostPlayed = [...games].sort((a, b) => b.hours - a.hours)[0];

  return {
    games,
    totalHours,
    unlockedAchievements,
    totalAchievements,
    levelData,
    displayLevelData,
    recentGame,
    mostPlayed
  };
}

function getSharedGameComparison(friend) {
  const friendGames = new Map((friend.games || []).map(game => [String(game.appid), game]));

  return state.games
    .filter(game => friendGames.has(String(game.appid)))
    .map(game => {
      const friendGame = friendGames.get(String(game.appid));

      return {
        game,
        friendGame,
        hourDifference:game.hours - friendGame.hours,
        completionDifference:(game.completion || 0) - (friendGame.completion || 0)
      };
    })
    .sort((a, b) => {
      const aTotal = a.game.hours + a.friendGame.hours;
      const bTotal = b.game.hours + b.friendGame.hours;

      return bTotal - aTotal;
    });
}

async function renderFriends() {
  const container = document.getElementById("friendsContainer");

  container.innerHTML = `
    <div class="empty-library">
      Loading Steam friends...
    </div>
  `;

  try {
    await fetchSteamFriends();
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <div class="empty-library">
        Could not load Steam friends. Make sure your Steam friends list is visible, then try again.
      </div>
    `;
    return;
  }

  if (!state.friends.length) {
    container.innerHTML = `
      <div class="empty-library">
        No Steam friends found.
      </div>
    `;
    return;
  }

  const selectedFriend = state.friends.find(friend => friend.steamid === state.selectedFriendSteamId) || state.friends[0];
  state.selectedFriendSteamId = selectedFriend.steamid;
  state.visibleFriendsCount = Math.max(8, Math.min(state.visibleFriendsCount || 8, state.friends.length));
  const visibleFriends = state.friends.slice(0, state.visibleFriendsCount);
  const hiddenFriendCount = state.friends.length - visibleFriends.length;

  container.innerHTML = `
    <div class="friends-list">
      ${visibleFriends.map(friend => `
        <button class="friend-row ${friend.steamid === selectedFriend.steamid ? "active" : ""}" onclick="openFriendProfile('${friend.steamid}')">
          <img src="${friend.avatar}" alt="${friend.username}">

          <span>
            <strong>${friend.username}</strong>
            <small>${friend.gameVaultProfile?.level ? `GameVault Lvl ${friend.gameVaultProfile.level} - ` : ""}${friend.currentGame ? `Playing ${friend.currentGame}` : getPersonaStatusLabel(friend.status)}</small>
          </span>
        </button>
      `).join("")}

      ${
        hiddenFriendCount > 0
          ? `<button class="show-more-btn" onclick="showMoreFriends()">Show ${Math.min(8, hiddenFriendCount)} more</button>`
          : state.friends.length > 8
            ? `<button class="show-more-btn" onclick="collapseFriends()">Show fewer</button>`
            : ""
      }
    </div>

    <div id="friendProfilePanel" class="friend-profile-panel"></div>
  `;

  await renderFriendProfile(selectedFriend.steamid);
}

async function renderFriendProfile(steamid) {
  const panel = document.getElementById("friendProfilePanel");
  const friend = state.friends.find(item => item.steamid === steamid);

  if (!friend || !panel) return;

  state.selectedFriendSteamId = steamid;
  saveState();

  panel.innerHTML = `
    <div class="empty-library">
      Loading ${friend.username}'s public library...
    </div>
  `;

  if (!friend.recentGames) {
    await fetchFriendRecentlyPlayed(friend);
  }

  if (!friend.games && !friend.libraryPrivate) {
    await fetchFriendLibrary(friend);
  }

  if (!friend.libraryPrivate && friend.games?.length && !friend.achievementsSynced) {
    panel.innerHTML = `
      <div class="empty-library">
        Building ${friend.username}'s level and game comparison...
      </div>
    `;

    await fetchFriendAchievements(friend);
  }

  const stats = getFriendStats(friend);
  const sharedGames = getSharedGameComparison(friend);
  const recentSteamGame = friend.currentGame
    ? {
      appid:friend.currentGameId,
      name:friend.currentGame,
      hours:0,
      recentHours:0,
      cover:getSteamGameCover(friend.currentGameId)
    }
    : friend.recentGames?.[0] || stats.recentGame;

  panel.innerHTML = `
    <div class="friend-profile-card">
      <div class="friend-profile-header">
        <img src="${friend.avatar}" alt="${friend.username}">

        <div>
          <h2>${friend.username}</h2>
          <p>${friend.currentGame ? `Playing ${friend.currentGame}` : getPersonaStatusLabel(friend.status)}</p>
          ${friend.gameVaultProfile?.level ? `<span class="gamevault-level-badge">GameVault Lvl ${friend.gameVaultProfile.level} - ${escapeHtml(friend.gameVaultProfile.title || getLevelTitle(friend.gameVaultProfile.level))}</span>` : ""}

          <div class="friend-profile-actions">
            <button
              class="steam-chat-btn friend-chat-btn"
              data-steamid="${escapeHtml(friend.steamid)}"
              data-profile-url="${escapeHtml(friend.profileUrl)}"
            >
              Message
            </button>

            <button
              class="steam-disconnect-btn friend-profile-btn"
              data-profile-url="${escapeHtml(friend.profileUrl)}"
            >
              Open Steam Profile
            </button>
          </div>

          <small id="friendActionStatus" class="friend-action-status"></small>
        </div>
      </div>

      <div class="friend-stat-grid">
        <div class="stat-box">
          <strong>${friend.libraryPrivate ? "--" : `${stats.totalHours}h`}</strong>
          <small>Total Hours</small>
        </div>

        <div class="stat-box">
          <strong>${friend.libraryPrivate ? "--" : stats.games.length}</strong>
          <small>Games</small>
        </div>

        <div class="stat-box">
          <strong>${stats.mostPlayed ? stats.mostPlayed.hours + "h" : "--"}</strong>
          <small>Most Played</small>
        </div>

        <div class="stat-box">
          <strong>${friend.gameVaultProfile?.level ? `Lvl ${stats.displayLevelData.level}` : friend.libraryPrivate || !stats.totalAchievements ? "--" : `Lvl ${stats.levelData.level}`}</strong>
          <small>${friend.gameVaultProfile?.level ? "GameVault Level" : "Public Level"}</small>
        </div>

        <div class="stat-box">
          <strong>${friend.libraryPrivate ? "--" : sharedGames.length}</strong>
          <small>Shared Games</small>
        </div>

        <div class="stat-box">
          <strong>${friend.libraryPrivate || !stats.totalAchievements ? "--" : `${stats.unlockedAchievements}/${stats.totalAchievements}`}</strong>
          <small>Achievements</small>
        </div>
      </div>

      ${
        friend.libraryPrivate
          ? `
            <div class="empty-library">
              This friend's library is private, so GameVault can only show their Steam profile.
            </div>
          `
          : `
            <div class="friend-home-section">
              <h3>Compare Shared Games</h3>
              ${
                sharedGames.length
                  ? `
                    <div class="friend-compare-list">
                      ${sharedGames.slice(0, 6).map(item => `
                        <div class="friend-compare-row">
                          ${getSafeImageMarkup(item.game)}
                          <div>
                            <strong>${escapeHtml(item.game.name)}</strong>
                            <small>You: ${item.game.hours}h - ${item.game.completion || 0}%</small>
                            <small>${escapeHtml(friend.username)}: ${item.friendGame.hours}h - ${item.friendGame.completion || 0}%</small>
                          </div>
                          <span>${item.hourDifference === 0 ? "Even hours" : item.hourDifference > 0 ? `You +${item.hourDifference}h` : `${escapeHtml(friend.username)} +${Math.abs(item.hourDifference)}h`}</span>
                        </div>
                      `).join("")}
                    </div>
                  `
                  : `<div class="empty-library">No shared public games found yet.</div>`
              }
            </div>

            <div class="friend-home-section">
              <h3>Recently Played</h3>
              ${
                recentSteamGame
                  ? `
                    <div class="friend-game-hero">
                      ${getSafeImageMarkup(recentSteamGame)}
                      <div>
                        <strong>${recentSteamGame.name}</strong>
                        <small>${friend.currentGame ? "Playing now" : `${recentSteamGame.recentHours || recentSteamGame.hours}h recent playtime`}</small>
                      </div>
                    </div>
                  `
                  : `<div class="empty-library">No recent games found.</div>`
              }
            </div>

            <div class="friend-home-section">
              <h3>Top Games</h3>
              <div class="friend-game-grid">
                ${(friend.recentGames?.length ? friend.recentGames : [...stats.games].sort((a, b) => b.hours - a.hours)).slice(0, 6).map(game => `
                  <div class="friend-game-card">
                    ${getSafeImageMarkup(game)}
                    <strong>${game.name}</strong>
                    <small>${game.recentHours ? `${game.recentHours}h recent` : `${game.hours}h total`}</small>
                  </div>
                `).join("")}
              </div>
            </div>
          `
      }
    </div>
  `;
}

window.openFriendProfile = function(steamid) {
  renderFriendProfile(steamid);

  document.querySelectorAll(".friend-row").forEach(row => {
    row.classList.toggle("active", row.getAttribute("onclick")?.includes(steamid));
  });
};

window.showMoreFriends = function() {
  state.visibleFriendsCount = Math.min(state.friends.length, (state.visibleFriendsCount || 8) + 8);
  saveState();
  renderFriends();
};

window.collapseFriends = function() {
  state.visibleFriendsCount = 8;
  saveState();
  renderFriends();
};

function getPeriodStart(period) {
  const now = new Date();
  const start = new Date(now);

  if (period === "weekly") {
    start.setDate(now.getDate() - 7);
  }

  if (period === "monthly") {
    start.setMonth(now.getMonth() - 1);
  }

  if (period === "yearly") {
    start.setFullYear(now.getFullYear() - 1);
  }

  start.setHours(0, 0, 0, 0);

  return start.getTime();
}

function getAchievementsInPeriod(startTime) {
  return state.games.flatMap(game => {
    return game.achievements
      .filter(achievement => achievement.unlocked && achievement.unlockTime && achievement.unlockTime * 1000 >= startTime)
      .map(achievement => ({
        ...achievement,
        gameName:game.name
      }));
  });
}

function getPopularGenre(games) {
  const counts = new Map();

  games.forEach(game => {
    (game.genres || []).forEach(genre => {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    });
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
}

function getSessionHoursInPeriod(startTime) {
  return (state.sessionHistory || [])
    .filter(session => session.endedAt >= startTime)
    .reduce((sum, session) => sum + session.durationMs, 0) / 3600000;
}

function getEstimatedHoursInPeriod(period, games, startTime) {
  const trackedHours = getSessionHoursInPeriod(startTime);

  if (trackedHours > 0) {
    return Math.round(trackedHours * 10) / 10;
  }

  if (period === "weekly") {
    return games.reduce((sum, game) => sum + (game.recentHours || 0), 0);
  }

  return 0;
}

function getWrapUpData(period) {
  const startTime = getPeriodStart(period);
  const games = state.games.filter(game => game.lastPlayed && game.lastPlayed >= startTime);
  const achievements = getAchievementsInPeriod(startTime);
  const topGames = [...games].sort((a, b) => {
    const aHours = period === "weekly" ? a.recentHours || 0 : a.hours;
    const bHours = period === "weekly" ? b.recentHours || 0 : b.hours;

    return bHours - aHours;
  });
  const totalHours = getEstimatedHoursInPeriod(period, games, startTime);

  return {
    period,
    totalHours,
    achievements,
    topGames,
    mostPlayedGame:topGames[0],
    popularGenre:getPopularGenre(games),
    gamesPlayed:games.length,
    usesTrackedSessions:getSessionHoursInPeriod(startTime) > 0,
    usesSteamRecentHours:period === "weekly" && getSessionHoursInPeriod(startTime) === 0
  };
}

function getWrapUpTitle(period) {
  const titles = {
    weekly: "Weekly Wrap-Up",
    monthly: "Monthly Wrap-Up",
    yearly: "Yearly Wrap-Up"
  };

  return titles[period];
}

async function renderInsights() {
  const container = document.getElementById("insightsContainer");
  const periods = ["weekly", "monthly", "yearly"];

  if (!state.games.length) {
    container.innerHTML = `
      <div class="empty-library">
        Import your libraries first to build insights. Steam provides the richest playtime and achievement data.
      </div>
    `;
    return;
  }

  if (state.games.some(game => !game.genres || !game.genres.length)) {
    container.innerHTML = `
      <div class="empty-library">
        Updating game genres...
      </div>
    `;

    await fillMissingGameGenres(state.games);
  }

  container.innerHTML = periods.map(period => {
    const wrap = getWrapUpData(period);
    const id = `insight-${period}`;

    return `
      <div class="insight-dropdown">
        <button class="insight-toggle" onclick="toggleInsight('${id}')">
          <span>
            <strong>${getWrapUpTitle(period)}</strong>
            <small>${wrap.achievements.length} achievements - ${wrap.totalHours}h${wrap.usesSteamRecentHours ? " recent" : ""} - ${wrap.mostPlayedGame?.name || "No games played"}</small>
          </span>

          <span class="achievement-chevron"></span>
        </button>

        <div id="${id}" class="insight-detail hidden">
          <div class="insight-stat-grid">
            <div class="stat-box">
              <strong>${wrap.totalHours}h</strong>
              <small>${wrap.usesSteamRecentHours ? "Steam Recent Hours" : "Tracked Hours"}</small>
            </div>

            <div class="stat-box">
              <strong>${wrap.achievements.length}</strong>
              <small>Achievements</small>
            </div>

            <div class="stat-box">
              <strong>${wrap.gamesPlayed}</strong>
              <small>Games Played</small>
            </div>

            <div class="stat-box">
              <strong>${wrap.popularGenre}</strong>
              <small>Top Genre</small>
            </div>
          </div>

          <div class="insight-columns">
            <div>
              <h3>Top Games</h3>
              ${
                wrap.topGames.length
                  ? wrap.topGames.slice(0, 3).map(game => `
                    <div class="insight-game-row">
                      ${getSafeImageMarkup(game)}
                      <span>
                        <strong>${game.name}</strong>
                        <small>${period === "weekly" && game.recentHours ? `${game.recentHours}h recent` : `${game.hours}h total`}</small>
                      </span>
                    </div>
                  `).join("")
                  : `<div class="empty-library">No games played in this period.</div>`
              }
            </div>

            <div>
              <h3>Recent Achievements</h3>
              ${
                wrap.achievements.length
                  ? wrap.achievements
                    .sort((a, b) => b.unlockTime - a.unlockTime)
                    .slice(0, 5)
                    .map(achievement => `
                      <div class="insight-achievement-row">
                        <strong>${achievement.name}</strong>
                        <small>${achievement.gameName}</small>
                      </div>
                    `).join("")
                  : `<div class="empty-library">No achievements unlocked in this period.</div>`
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

window.toggleInsight = function(id) {
  const detail = document.getElementById(id);
  const toggle = detail?.previousElementSibling;

  if (!detail) return;

  detail.classList.toggle("hidden");
  toggle?.classList.toggle("open", !detail.classList.contains("hidden"));
};

function populateGoalFilter() {
  const filter = document.getElementById("goalFilter");

  filter.innerHTML = `
    <option value="all">All Goals</option>
    <option value="global">Global</option>
  `;

  state.games.forEach(game => {
    const option = document.createElement("option");

    option.value = game.id;
    option.textContent = game.name;

    filter.appendChild(option);
  });
}

function renderGoals() {
  const list = document.getElementById("goalsList");
  const filter = document.getElementById("goalFilter").value;

  list.innerHTML = "";

  let visibleGoals = state.goals
    .map((goal, index) => ({ ...goal, index }))
    .filter(goal => !goal.done);

  if (filter === "global") {
    visibleGoals = visibleGoals.filter(goal => goal.gameId === null);
  }

  if (filter !== "all" && filter !== "global") {
    visibleGoals = visibleGoals.filter(goal => String(goal.gameId) === String(filter));
  }

  if (!visibleGoals.length) {
    list.innerHTML = `
      <div class="empty-goals">
        No active goals here.
      </div>
    `;

    return;
  }

  const groups = {};

  visibleGoals.forEach(goal => {
    const game = findGameById(goal.gameId);
    const groupName = goal.gameId ? game?.name || "Missing game" : "Global";

    if (!groups[groupName]) {
      groups[groupName] = [];
    }

    groups[groupName].push(goal);
  });

  Object.keys(groups).forEach(groupName => {
    const group = document.createElement("div");

    group.className = "goals-group";

    group.innerHTML = `
      <h3 class="goals-group-title">
        ${groupName}
      </h3>
    `;

    groups[groupName].forEach(goal => {
      const item = document.createElement("div");

      item.className = "goal-item";

      item.innerHTML = `
        <div class="goal-left">
          <div class="goal-checkbox" data-index="${goal.index}">
            
          </div>

          <div>
            <strong>${goal.text}</strong>

            <div class="goal-meta">
              ${groupName}
            </div>
          </div>
        </div>
      `;

      item.querySelector(".goal-checkbox").onclick = () => {
        state.goals[goal.index].done = true;

        saveState();

        renderGoals();
        renderHome();
      };

      group.appendChild(item);
    });

    list.appendChild(group);
  });
}

function populateTrophyGames() {
  const type = document.getElementById("trophyType").value;
  const select = document.getElementById("trophyGame");

  select.innerHTML = "";

  let gamesToShow = [...state.games];

  if (type === "completed") {
    gamesToShow = getCompletedGames();
  }

  if (type === "mostPlayed") {
    const mostPlayed = getMostPlayedGame();

    if (mostPlayed) {
      gamesToShow = [mostPlayed];
    }
  }

  if (type === "hardest") {
    gamesToShow = getGamesWithLegendaryAchievements();
  }

  if (type === "rarest") {
    const rarest = getRarestUnlockedAchievement();

    gamesToShow = rarest ? [rarest.game] : [];
  }

  if (type === "hiddenGem") {
    const hiddenGem = getHiddenGemGame();

    gamesToShow = hiddenGem ? [hiddenGem] : [];
  }

  if (type === "genreSpecialist") {
    const specialists = getGenreSpecialistOptions();

    if (!specialists.length) {
      gamesToShow = [];
    } else {
      specialists.forEach(specialist => {
        const option = document.createElement("option");

        option.value = `genre:${specialist.genre}`;
        option.textContent = `${specialist.genre} - ${specialist.games.length} games - ${specialist.hours} hours`;

        select.appendChild(option);
      });

      return;
    }
  }

  if (!gamesToShow.length) {
    const option = document.createElement("option");

    option.value = "";
    option.textContent = "No available games";

    select.appendChild(option);

    return;
  }

  gamesToShow.forEach(game => {
    const option = document.createElement("option");

    option.value = game.id;
    option.textContent = game.name;

    select.appendChild(option);
  });
}

function populateLegendaryAchievements() {
  const gameId = document.getElementById("trophyGame").value;
  const achievementSelect = document.getElementById("trophyAchievement");
  const game = findGameById(gameId);

  achievementSelect.innerHTML = "";

  if (!game) {
    const option = document.createElement("option");

    option.value = "";
    option.textContent = "No game selected";

    achievementSelect.appendChild(option);

    return;
  }

  const legendaryAchievements = getLegendaryAchievements(game);

  if (!legendaryAchievements.length) {
    const option = document.createElement("option");

    option.value = "";
    option.textContent = "No legendary achievements completed";

    achievementSelect.appendChild(option);

    return;
  }

  legendaryAchievements.forEach(achievement => {
    const option = document.createElement("option");

    option.value = achievement.name;
    option.textContent = achievement.globalPercent
      ? `${achievement.name} (${achievement.globalPercent.toFixed(1)}%)`
      : achievement.name;

    achievementSelect.appendChild(option);
  });
}

function getSelectedGenreSpecialist() {
  const value = document.getElementById("trophyGame").value;

  if (!value.startsWith("genre:")) return null;

  return getGenreSpecialistData(value.slice("genre:".length));
}

function updateTrophyForm() {
  const type = document.getElementById("trophyType").value;

  const helper = document.getElementById("trophyHelper");
  const gameField = document.getElementById("trophyGameField");
  const gameLabel = document.querySelector("label[for='trophyGame']");
  const achievementField = document.getElementById("trophyAchievementField");
  const titleField = document.getElementById("trophyTitleField");
  const descriptionField = document.getElementById("trophyDescriptionField");

  const titleInput = document.getElementById("trophyTitle");
  const descriptionInput = document.getElementById("trophyDescription");

  populateTrophyGames();

  gameField.classList.remove("hidden");
  gameLabel.textContent = "Game";
  achievementField.classList.add("hidden");
  titleField.classList.add("hidden");
  descriptionField.classList.add("hidden");

  titleInput.value = "";
  descriptionInput.value = "";

  if (type === "completed") {
    helper.textContent = "Choose from games you have completed. The trophy will generate itself.";

    const game = findGameById(document.getElementById("trophyGame").value);

    if (game) {
      titleInput.value = `${game.name} Completed`;
      descriptionInput.value = "100% completion achieved.";
    }

    return;
  }

  if (type === "mostPlayed") {
    helper.textContent = "This trophy is generated from the game with your highest playtime.";

    const game = getMostPlayedGame();

    if (game) {
      document.getElementById("trophyGame").value = game.id;
      titleInput.value = "Most Played Game";
      descriptionInput.value = `${game.name} - ${game.hours} hours played`;
    }

    return;
  }

  if (type === "hardest") {
    helper.textContent = "Choose a game where you have unlocked a Steam glowing achievement.";

    achievementField.classList.remove("hidden");

    populateLegendaryAchievements();
    syncAutoTrophyFields();

    return;
  }

  if (type === "rarest") {
    helper.textContent = "Generated from your rarest unlocked achievement, even if it is not legendary.";

    const rarest = getRarestUnlockedAchievement();

    if (rarest) {
      document.getElementById("trophyGame").value = rarest.game.id;
      titleInput.value = "Rarest Achievement";
      descriptionInput.value = `${rarest.achievement.name} - ${rarest.game.name} - ${formatAchievementPercent(rarest.achievement)}`;
    }

    return;
  }

  if (type === "hiddenGem") {
    helper.textContent = "Generated from a played game with unusually rare progress.";

    const hiddenGem = getHiddenGemGame();

    if (hiddenGem) {
      document.getElementById("trophyGame").value = hiddenGem.id;
      titleInput.value = "Hidden Gem";
      descriptionInput.value = hiddenGem.name;
    }

    return;
  }

  if (type === "genreSpecialist") {
    helper.textContent = "Choose from your strongest genres, sorted by games and hours played.";
    gameLabel.textContent = "Genre";

    const specialist = getSelectedGenreSpecialist();

    if (specialist) {
      titleInput.value = `${specialist.genre} Specialist`;
      descriptionInput.value = `${specialist.games.length} games - ${specialist.hours} hours`;
    }

    return;
  }

  if (type === "favorite") {
    helper.textContent = "Choose a game you want to feature as one of your favorites.";

    const game = findGameById(document.getElementById("trophyGame").value);

    if (game) {
      titleInput.value = "Favorite Game";
      descriptionInput.value = game.name;
    }
  }

  if (type === "rarest") {
    const rarest = getRarestUnlockedAchievement();

    if (!rarest) return;

    document.getElementById("trophyGame").value = rarest.game.id;
    document.getElementById("trophyTitle").value = "Rarest Achievement";
    document.getElementById("trophyDescription").value = `${rarest.achievement.name} - ${rarest.game.name} - ${formatAchievementPercent(rarest.achievement)}`;
  }

  if (type === "hiddenGem") {
    document.getElementById("trophyTitle").value = "Hidden Gem";
    document.getElementById("trophyDescription").value = game.name;
  }

  if (type === "genreSpecialist") {
    const specialist = getSelectedGenreSpecialist();

    if (!specialist) return;

    document.getElementById("trophyTitle").value = `${specialist.genre} Specialist`;
    document.getElementById("trophyDescription").value = `${specialist.games.length} games - ${specialist.hours} hours`;
  }
}

function syncAutoTrophyFields() {
  const type = document.getElementById("trophyType").value;
  const gameId = document.getElementById("trophyGame").value;
  const game = findGameById(gameId);

  if (type === "genreSpecialist") {
    const specialist = getSelectedGenreSpecialist();

    if (!specialist) return;

    document.getElementById("trophyTitle").value = `${specialist.genre} Specialist`;
    document.getElementById("trophyDescription").value = `${specialist.games.length} games - ${specialist.hours} hours`;
    return;
  }

  if (!game) return;

  if (type === "completed") {
    document.getElementById("trophyTitle").value = `${game.name} Completed`;
    document.getElementById("trophyDescription").value = "100% completion achieved.";
  }

  if (type === "hardest") {
    populateLegendaryAchievements();

    const achievementName = document.getElementById("trophyAchievement").value;

    document.getElementById("trophyTitle").value = "Hardest Achievement";
    document.getElementById("trophyDescription").value = achievementName
      ? `${achievementName} - ${game.name}`
      : `No rare achievement selected - ${game.name}`;
  }

  if (type === "favorite") {
    document.getElementById("trophyTitle").value = "Favorite Game";
    document.getElementById("trophyDescription").value = game.name;
  }
}

function renderTrophies() {
  const list = document.getElementById("trophyList");

  if (!state.trophies.length) {
    list.innerHTML = `
      <div class="empty-trophies">
        No trophies added yet.
      </div>
    `;

    return;
  }

  list.innerHTML = state.trophies.map((trophy, index) => `
    <div class="trophy-card">
      ${getSafeImageMarkup(trophy)}

      <div class="trophy-card-content">
        <div class="trophy-badge">
          ${getTrophyTypeLabel(trophy.type)}
        </div>

        <div>
          <h3>${trophy.title}</h3>
          <p>${trophy.description}</p>

          <button class="remove-trophy-btn" onclick="removeTrophy(${index})">
            Remove
          </button>
        </div>
      </div>
    </div>
  `).join("");
}

window.removeTrophy = function(index) {
  state.trophies.splice(index, 1);

  saveState();

  renderTrophies();
  renderHome();
};

document.getElementById("addTrophyBtn").onclick = () => {
  const type = document.getElementById("trophyType").value;
  const trophySelection = document.getElementById("trophyGame").value;
  const gameId = Number(trophySelection);

  let title = document.getElementById("trophyTitle").value.trim();
  let description = document.getElementById("trophyDescription").value.trim();

  if (state.trophies.length >= MAX_SHOWCASE_TROPHIES) {
    alert(`You can showcase up to ${MAX_SHOWCASE_TROPHIES} trophies.`);
    return;
  }

  if (type === "completed" && state.trophies.filter(trophy => trophy.type === "completed").length >= MAX_COMPLETED_TROPHIES) {
    alert(`You can showcase up to ${MAX_COMPLETED_TROPHIES} completed-game trophies.`);
    return;
  }

  if (type === "genreSpecialist") {
    const specialist = getSelectedGenreSpecialist();

    if (!specialist) return;

    title = `${specialist.genre} Specialist`;
    description = `${specialist.games.length} games - ${specialist.hours} hours`;

    if (state.trophies.some(trophy => trophy.type === type && trophy.game === specialist.genre)) {
      alert("That genre trophy is already in your showcase.");
      return;
    }

    const coverGame = specialist.games
      .filter(game => game.cover)
      .sort((a, b) => b.hours - a.hours)[0] || specialist.games[0];

    state.trophies.push({
      type,
      game: specialist.genre,
      appid: coverGame?.appid || "",
      cover: coverGame?.cover || "",
      title,
      description
    });

    saveState();

    renderTrophies();
    renderHome();
    updateTrophyForm();
    return;
  }

  if (!gameId) return;

  const game = findGameById(gameId);

  if (!game) return;

  if (state.trophies.some(trophy => trophy.type === type && trophy.game === game.name)) {
    alert("That trophy is already in your showcase.");
    return;
  }

  if (type === "completed") {
    if (game.completion !== 100) return;

    title = `${game.name} Completed`;
    description = "100% completion achieved.";
  }

  if (type === "mostPlayed") {
    const mostPlayed = getMostPlayedGame();

    if (!mostPlayed) return;

    title = "Most Played Game";
    description = `${mostPlayed.name} - ${mostPlayed.hours} hours played`;
  }

  if (type === "hardest") {
    const achievementName = document.getElementById("trophyAchievement").value;

    if (!achievementName) return;

    title = "Hardest Achievement";
    description = `${achievementName} - ${game.name}`;
  }

  if (type === "favorite") {
    title = "Favorite Game";
    description = game.name;
  }

  if (type === "rarest") {
    const rarest = getRarestUnlockedAchievement();

    if (!rarest) return;

    title = "Rarest Achievement";
    description = `${rarest.achievement.name} - ${rarest.game.name} - ${formatAchievementPercent(rarest.achievement)}`;
  }

  if (type === "hiddenGem") {
    title = "Hidden Gem";
    description = game.name;
  }

  if (!title || !description) return;

  state.trophies.push({
    type,
    game: game.name,
    appid: game.appid,
    cover: game.cover,
    title,
    description
  });

  saveState();

  renderTrophies();
  renderHome();
  updateTrophyForm();
};

document.getElementById("trophyType").onchange = () => {
  updateTrophyForm();
};

document.getElementById("trophyGame").onchange = () => {
  syncAutoTrophyFields();
};

document.getElementById("trophyAchievement").onchange = () => {
  syncAutoTrophyFields();
};

document.getElementById("openGoalModalBtn").onclick = () => {
  document.getElementById("goalModal").classList.remove("hidden");

  const select = document.getElementById("modalGoalGame");

  select.innerHTML = `<option value="global">Global Goal</option>`;

  state.games.forEach(game => {
    const opt = document.createElement("option");

    opt.value = game.id;
    opt.textContent = game.name;

    select.appendChild(opt);
  });
};

document.getElementById("closeGoalBtn").onclick = () => {
  document.getElementById("goalModal").classList.add("hidden");
};

document.getElementById("saveGoalBtn").onclick = () => {
  const text = document.getElementById("modalGoalInput").value.trim();
  const selected = document.getElementById("modalGoalGame").value;

  if (!text) return;

  state.goals.push({
    text,
    done:false,
    gameId:selected === "global" ? null : selected
  });

  document.getElementById("modalGoalInput").value = "";
  document.getElementById("goalModal").classList.add("hidden");

  saveState();

  renderGoals();
  renderHome();
};

document.getElementById("goalFilter").onchange = () => {
  renderGoals();
};

document.getElementById("loginSteamBtn").onclick = () => {
  shell.openExternal(getApiUrl("/auth/steam"));
  pollSteamLogin();
};

document.getElementById("loginRefreshBtn").onclick = () => {
  const loginStatus = document.getElementById("loginStatus");

  if (loginStatus) {
    loginStatus.textContent = "Checking Steam profile...";
  }

  refreshSteamProfile();
};

document.getElementById("backBtn").onclick = () => {
  goBack();
};

document.getElementById("homeBtn").onclick = () => {
  activateView("home");
};

document.getElementById("libraryBtn").onclick = () => {
  activateView("library");
};

document.getElementById("librarySearchInput").oninput = () => {
  renderLibrary();
};

document.getElementById("libraryBacklogFilter").onchange = () => {
  renderLibrary();
};

document.getElementById("achievementsBtn").onclick = () => {
  activateView("achievements");
};

document.getElementById("achievementSearchInput").oninput = () => {
  renderAchievements();
};

document.getElementById("goalsBtn").onclick = () => {
  activateView("goals");
};

document.getElementById("trophiesBtn").onclick = () => {
  activateView("trophies");
};

document.getElementById("friendsBtn").onclick = () => {
  activateView("friends");
};

document.getElementById("statsBtn").onclick = () => {
  activateView("stats");
};

document.getElementById("settingsBtn").onclick = () => {
  activateView("settings");
};

document.getElementById("appInfoBtn").onclick = () => {
  activateView("appInfo");
};

document.querySelectorAll(".dropdown-header")
  .forEach(btn => {
    btn.onclick = () => {
      const target = document.getElementById(btn.dataset.target);

      target.classList.toggle("hidden");
    };
  });

document.addEventListener("keydown", event => {
  if (isTypingInField(event.target)) return;

  const keyName = normalizeKeyName(event.key);
  const matchedAction = Object.entries(state.keybinds)
    .find(([, key]) => key === keyName)?.[0];

  if (!matchedAction) return;

  event.preventDefault();

  if (matchedAction === "toggleFullscreen") {
    shell.toggleFullscreen();
    return;
  }

  activateView(matchedAction);
});

document.addEventListener("click", event => {
  const pulseTarget = event.target.closest("button, .game-card, .trophy-card, .achievement-item, .friend-row, .friend-game-card, .insight-toggle, .quick-launch-item");

  if (pulseTarget && !pulseTarget.disabled) {
    pulseTarget.classList.remove("gv-pulse");
    void pulseTarget.offsetWidth;
    pulseTarget.classList.add("gv-pulse");
  }

  const inviteButton = event.target.closest(".game-invite-btn");

  if (inviteButton) {
    window.inviteFriendToGame(
      inviteButton.dataset.steamid,
      inviteButton.dataset.profileUrl,
      inviteButton.dataset.gameName
    );
    return;
  }

  const friendChatButton = event.target.closest(".friend-chat-btn");

  if (friendChatButton) {
    window.openSteamChat(
      friendChatButton.dataset.steamid,
      friendChatButton.dataset.profileUrl
    );
    return;
  }

  const friendProfileButton = event.target.closest(".friend-profile-btn");

  if (friendProfileButton) {
    window.openSteamProfileUrl(friendProfileButton.dataset.profileUrl);
  }
});

window.addEventListener("beforeunload", () => {
  finishActiveSession();
  saveState();
});

async function initializeApp() {
  if (!shell.apiBase && typeof shell.getAppConfig === "function") {
    const config = await shell.getAppConfig();

    if (config?.apiBase) {
      API_BASE = config.apiBase;
    }
  }

  loadState();

  applySelectedTheme();
  applySelectedUiStyle();

  refreshSteamProfile();

  updateLoginGate();

  setInterval(() => {
    refreshActivityPanels();
  }, SESSION_TICK_INTERVAL_MS);

  setInterval(async () => {
    await refreshSteamProfile();
    await refreshRecentActivityData();
    refreshActivityPanels();
  }, ACTIVITY_REFRESH_INTERVAL_MS);
}

initializeApp();


