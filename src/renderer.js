const shell = window.gameVault || {
  apiBase:"http://localhost:3000",
  openExternal(url) {
    window.open(url, "_blank");
    return Promise.resolve({ ok:true });
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
const STEAM_LEGENDARY_PERCENT = 10;
const ACTIVITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_TICK_INTERVAL_MS = 30 * 1000;
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
  steamProfile: null,
  steamLibrarySyncedAt: null,
  steamAchievementsSyncedAt: null,
  keybinds: {}
};

function saveState() {
  localStorage.setItem("gameVault", JSON.stringify(state));
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
    if (!("steamProfile" in state)) state.steamProfile = null;
    if (!("steamLibrarySyncedAt" in state)) state.steamLibrarySyncedAt = null;
    if (!("steamAchievementsSyncedAt" in state)) state.steamAchievementsSyncedAt = null;
    if (!state.keybinds) state.keybinds = {};
    state.keybinds = normalizeKeybinds(state.keybinds);

    if (!state.steamLibrarySyncedAt && isOldPlaceholderLibrary(state.games)) {
      state.games = [];
      state.currentGameId = null;
    }

    state.games.forEach(game => {
      if (!game.lastPlayed) game.lastPlayed = 0;
      if (!game.achievements) game.achievements = [];
      if (!game.genres) game.genres = [];
      if (!("backlogStatus" in game)) game.backlogStatus = null;
      if (!game.accessType) game.accessType = "owned";

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
    state.steamProfile = null;
    state.steamLibrarySyncedAt = null;
    state.steamAchievementsSyncedAt = null;
    state.keybinds = normalizeKeybinds({});

    saveState();
  }
}

function getCurrentGame() {
  return state.games.find(game => game.id === state.currentGameId);
}

function getRecentGame() {
  return state.games.reduce((latest, game) => {
    if (!latest || game.lastPlayed > latest.lastPlayed) return game;
    return latest;
  }, null);
}

function getTotalHours() {
  return state.games.reduce((sum, game) => sum + game.hours, 0);
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
  { id:"default", name:"Amber Vault", level:1 },
  { id:"blue", name:"Vault Blue", level:5 },
  { id:"green", name:"Vault Green", level:10 },
  { id:"red", name:"Vault Red", level:20 },
  { id:"gold", name:"Vault Gold", level:30 },
  { id:"royal", name:"Royal Blue", level:40 }
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
    rare:"royal"
  };

  return legacyThemes[themeId] || themeId || "default";
}

function getUnlockedThemes() {
  const level = getLevelData().level;

  return profileThemes.filter(theme => level >= theme.level);
}

function applySelectedTheme() {
  state.selectedTheme = normalizeThemeId(state.selectedTheme);
  document.body.dataset.theme = state.selectedTheme || "default";
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
  if (percent !== null && percent <= 25) return "rare";

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

function formatAchievementPercent(achievement) {
  const percent = getAchievementPercent(achievement);

  return percent !== null ? `${percent.toFixed(1)}%` : "No global rarity";
}

function getLegendaryAchievements(game) {
  return getGameAchievements(game).filter(achievement => {
    return achievement.unlocked && isSteamLegendaryAchievement(achievement);
  });
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
    familyOrFree:"Shared / Free / Recently Played"
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
  renderLiveSessionPanel();
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
  const cover = escapeHtml(game.cover || getSteamGameCover(game.appid || ""));

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
      return [];
    }

    const data = await response.json();

    return data.achievements || [];
  } catch (error) {
    console.error(error);
    return [];
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
      const [achievements, details] = await Promise.all([
        fetchSteamAchievements(game.appid),
        fetchSteamAppDetails(game.appid)
      ]);
      const unlocked = achievements.filter(achievement => achievement.unlocked).length;
      const completion = achievements.length
        ? Math.round((unlocked / achievements.length) * 100)
        : 0;

      hydratedGames[gameIndex] = {
        ...game,
        achievements,
        completion,
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
  const gamesByAppId = new Map(state.games.map(game => [String(game.appid), game]));

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

    const achievements = await fetchSteamAchievements(appid);

    if (!achievements.length) return;

    const unlocked = achievements.filter(achievement => achievement.unlocked).length;

    game.achievements = achievements;
    game.completion = Math.round((unlocked / achievements.length) * 100);
  }));

  state.games = sortGamesAlphabetically(state.games);
  state.steamAchievementsSyncedAt = Date.now();
  saveState();
  refreshActivityPanels();
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

    state.games = sortGamesAlphabetically(hydratedGames);
    state.currentGameId = state.games[0]?.id || null;
    state.steamLibrarySyncedAt = Date.now();
    state.steamAchievementsSyncedAt = Date.now();

    saveState();
    renderHome();

    return true;
  } catch (error) {
    console.error(error);

    if (!silent) {
      alert("Could not import your Steam library. Make sure your Steam game details are public, then try again.");
    }

    return false;
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
  settings: document.getElementById("settingsView")
};

function hideAllViews() {
  Object.values(views).forEach(view => view.classList.add("hidden"));
}

function showView(name) {
  const nextView = views[name];

  if (!nextView || !nextView.classList.contains("hidden")) return;

  triggerViewTransition();
  hideAllViews();
  nextView.classList.remove("hidden");
  nextView.classList.remove("view-entering");
  void nextView.offsetWidth;
  nextView.classList.add("view-entering");
}

function triggerViewTransition() {
  const main = document.querySelector(".main");

  if (!main) return;

  main.classList.remove("view-transitioning");
  void main.offsetWidth;
  main.classList.add("view-transitioning");
}

function activateView(name) {
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
    }
  };

  actions[name]?.();
}

function isTypingInField(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function updateLoginGate() {
  const loginView = document.getElementById("loginView");
  const appShell = document.getElementById("appShell");

  if (state.steamProfile) {
    loginView.classList.add("hidden");
    appShell.classList.remove("hidden");
    renderHome();
    showView("home");
  } else {
    loginView.classList.remove("hidden");
    appShell.classList.add("hidden");
  }
}

async function refreshSteamProfile() {
  try {
    const response = await fetch(getApiUrl("/api/steam/profile"));
    const data = await response.json();

    if (data.connected) {
      const previousSteamId = state.steamProfile?.steamid;
      state.steamProfile = data.profile;
      updateCurrentSessionFromSteamProfile();

      if (previousSteamId !== data.profile.steamid || !state.steamLibrarySyncedAt || !state.steamAchievementsSyncedAt) {
        await syncSteamLibrary({ silent: true });
      }
    } else {
      finishActiveSession();
      state.steamProfile = null;
      state.games = [];
      state.currentGameId = null;
      state.friends = [];
      state.selectedFriendSteamId = null;
      state.steamLibrarySyncedAt = null;
      state.steamAchievementsSyncedAt = null;
    }

    saveState();
    updateLoginGate();

    return state.steamProfile;
  } catch (error) {
    console.error(error);
    updateLoginGate();
    return null;
  }
}

async function disconnectSteamProfile() {
  try {
    await fetch(getApiUrl("/api/steam/logout"), {
      method:"POST"
    });

    state.steamProfile = null;
    state.games = [];
    state.currentGameId = null;
    state.friends = [];
    state.selectedFriendSteamId = null;
    state.activeSession = null;
    state.steamLibrarySyncedAt = null;
    state.steamAchievementsSyncedAt = null;

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
  launchSteamGame(game);
}

function renderSettings() {
  const panel = document.getElementById("settingsPanel");
  const unlockedThemes = getUnlockedThemes();

  panel.innerHTML = `
    <div class="placeholder-card">
      <h1>Steam Account</h1>
      <p>${state.steamProfile ? `Connected as ${state.steamProfile.username}` : "Not connected"}</p>
      <p>${state.steamLibrarySyncedAt ? `Library and achievements imported ${new Date(state.steamLibrarySyncedAt).toLocaleString()}` : "Library has not been imported yet."}</p>

      <button id="openSteamProfileBtn" class="primary-btn">
        Open Steam Profile
      </button>

      <button id="syncSteamLibraryBtn" class="primary-btn">
        Import Steam Library & Achievements
      </button>

      <button id="disconnectSteamBtn" class="primary-btn">
        Disconnect Steam
      </button>
    </div>

    <div class="placeholder-card settings-card">
      <h1>Profile Theme</h1>
      <p>Unlocked themes come from your GameVault level.</p>

      <select id="themeSelect" class="settings-select">
        ${profileThemes.map(theme => {
          const unlocked = unlockedThemes.some(item => item.id === theme.id);

          return `<option value="${theme.id}" ${state.selectedTheme === theme.id ? "selected" : ""} ${unlocked ? "" : "disabled"}>${theme.name}${unlocked ? "" : ` - Lvl ${theme.level}`}</option>`;
        }).join("")}
      </select>
    </div>

    <div class="placeholder-card settings-card">
      <h1>Keybinds</h1>
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
  `;

  document.getElementById("openSteamProfileBtn").onclick = () => {
    if (state.steamProfile?.profileUrl) {
      shell.openExternal(state.steamProfile.profileUrl);
    }
  };

  document.getElementById("disconnectSteamBtn").onclick = () => {
    disconnectSteamProfile();
  };

  document.getElementById("syncSteamLibraryBtn").onclick = async () => {
    await syncSteamLibrary();
    renderSettings();
  };

  document.getElementById("themeSelect").onchange = event => {
    state.selectedTheme = event.target.value;
    saveState();
    applySelectedTheme();
    renderHome();
  };

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

  document.getElementById("resetKeybindsBtn").onclick = () => {
    state.keybinds = normalizeKeybinds({});
    saveState();
    renderSettings();
  };
}

function renderProfile() {
  const levelData = getLevelData();

  const profileName = document.getElementById("profileName");
  const profileTagline = document.getElementById("profileTagline");
  const avatarImg = document.getElementById("avatarImg");

  if (state.steamProfile) {
    profileName.textContent = state.steamProfile.username;
    profileTagline.textContent = getLevelTitle(levelData.level);
    avatarImg.src = state.steamProfile.avatar;
  } else {
    profileName.textContent = "Player";
    profileTagline.textContent = getLevelTitle(levelData.level);
    avatarImg.src = "https://via.placeholder.com/100";
  }

  document.getElementById("totalHours").textContent = `${getTotalHours()}h`;
  document.getElementById("gamesOwned").textContent = state.games.length;
  document.getElementById("userLevel").textContent = `Lvl ${levelData.level}`;
  document.getElementById("achievementScore").textContent = getAchievementScore();
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
      <span class="activity-icon">${getActivityIcon(item)}</span>

      <div>
        <strong>${item.text}</strong><br>
        <small>${item.time}</small>
      </div>
    </div>
  `).join("");
}

function renderLiveSessionPanel() {
  const panel = document.getElementById("sessionLivePanel");

  if (!panel) return;

  if (state.activeSession) {
    panel.innerHTML = `
      <div class="session-live-card active">
        <span>Live</span>
        <div>
          <strong>${escapeHtml(state.activeSession.gameName)}</strong>
          <small>Current session length: ${formatDuration(Date.now() - state.activeSession.startedAt)}</small>
        </div>
      </div>
    `;
    return;
  }

  const latestSession = getLatestFinishedSession();

  panel.innerHTML = latestSession
    ? `
      <div class="session-live-card">
        <span>Last</span>
        <div>
          <strong>${escapeHtml(latestSession.gameName)}</strong>
          <small>Recent session length: ${formatDuration(latestSession.durationMs)}</small>
        </div>
      </div>
    `
    : "";
}

function renderHome() {
  renderProfile();
  renderShowcase();
  refreshActivityPanels();

  const game = getRecentGame();
  const container = document.getElementById("homeHero");

  if (!game) {
    container.innerHTML = `
      <div class="empty-library">
        No Steam games imported yet. If your library is missing, check that your Steam game details are public, then import again from Settings.
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
        No games imported yet. Steam may hide your library when your game details are private.
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
        <span class="library-source ${game.accessType === "owned" ? "" : "shared-source"}">${getAccessTypeLabel(game.accessType)}</span>
      </div>
    `;

    card.onclick = () => openGame(game.id);

    grid.appendChild(card);
  });
}

function openGame(gameId) {
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

  document.getElementById("achievementsPanel").innerHTML =
    game.achievements.length
      ? game.achievements
        .filter(achievement => !achievement.unlocked)
        .map(achievement => `<div class="list-item">Locked - ${achievement.name}</div>`)
        .join("") || `<div class="list-item">All tracked achievements completed.</div>`
      : `<div class="list-item">Achievement sync is not available for this game yet.</div>`;

  document.getElementById("goalsPanel").innerHTML =
    state.goals
      .filter(goal => goal.gameId === game.id && !goal.done)
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
        Import your Steam library first to see achievement progress here.
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
    .filter(game => String(game.name || "").toLowerCase().includes(query));

  container.innerHTML = "";

  if (!state.games.length) {
    container.innerHTML = `
      <div class="empty-library">
        Import your Steam library first to see achievement progress here.
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

    const achievementRows = total
      ? achievements.map(achievement => {
        const icon = achievement.unlocked
          ? achievement.icon
          : achievement.iconGray || achievement.icon;
        const globalPercent = typeof achievement.globalPercent === "number"
          ? ` - ${achievement.globalPercent.toFixed(1)}% global`
          : "";
        const description = achievement.description ||
          `${achievement.rarity || "common"} achievement${globalPercent}`;

        return `
          <div class="achievement-item ${achievement.unlocked ? "unlocked" : "locked"}">
            <div class="achievement-icon">
              ${icon ? `<img src="${escapeHtml(icon)}" alt="">` : achievement.unlocked ? "Done" : "Lock"}
            </div>

            <div>
              <strong>${escapeHtml(achievement.name || "Unnamed achievement")}</strong>
              <p>${escapeHtml(description)}</p>
            </div>

            <span class="achievement-status">
              ${achievement.unlocked ? "Unlocked" : "Locked"}
            </span>
          </div>
        `;
      }).join("")
      : `
        <div class="achievement-complete">
          Achievement sync is not available for this game yet.
        </div>
      `;

    const block = document.createElement("div");

    block.className = "achievement-dropdown";

    block.innerHTML = `
      <button class="achievement-game-toggle" onclick="toggleAchievementGame('${listId}')">
        <span class="achievement-game-thumb">
          ${getSafeImageMarkup(game)}
        </span>

        <span class="achievement-game-summary">
          <strong>${escapeHtml(game.name || "Unknown game")}</strong>
          <small>${unlocked}/${total} unlocked - ${missing.length} missing - ${percent}% complete</small>
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
  const rareMissing = gamesWithAchievements
    .flatMap(game => getGameAchievements(game)
      .filter(achievement => !achievement.unlocked && getAchievementPercent(achievement) !== null)
      .map(achievement => ({ game, achievement })))
    .filter(item => isSteamLegendaryAchievement(item.achievement) || isHardAchievement(item.achievement))
    .sort((a, b) => {
      const aHard = isHardAchievement(a.achievement) ? 0 : 1;
      const bHard = isHardAchievement(b.achievement) ? 0 : 1;

      if (aHard !== bHard) return aHard - bHard;
      return getAchievementPercent(a.achievement) - getAchievementPercent(b.achievement);
    })
    .slice(0, 3);
  const rareUnlocked = gamesWithAchievements
    .flatMap(game => getLegendaryAchievements(game).map(achievement => ({ game, achievement })))
    .sort((a, b) => (a.achievement.globalPercent || 100) - (b.achievement.globalPercent || 100))
    .slice(0, 3);

  return `
    <div class="hunting-panel">
      <div class="panel-title">
        <h2>Achievement Hunting</h2>
        <p>Fast targets, rare misses, and rare wins.</p>
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

        <div class="hunting-card">
          <strong>Rarest Missing</strong>
          ${rareMissing.length ? rareMissing.map(item => `
            <button onclick="openGame(${Number(item.game.id) || Number(item.game.appid) || 0})">
              ${escapeHtml(item.achievement.name || "Unnamed achievement")}
              <small>${escapeHtml(item.game.name || "Unknown game")} - ${formatAchievementPercent(item.achievement)}</small>
            </button>
          `).join("") : `<p>No rare missing achievements found.</p>`}
        </div>

        <div class="hunting-card">
          <strong>Rare Wins</strong>
          ${rareUnlocked.length ? rareUnlocked.map(item => `
            <button onclick="openGame(${Number(item.game.id) || Number(item.game.appid) || 0})">
              ${escapeHtml(item.achievement.name || "Unnamed achievement")}
              <small>${escapeHtml(item.game.name || "Unknown game")} - ${formatAchievementPercent(item.achievement)}</small>
            </button>
          `).join("") : `<p>No rare unlocked achievements yet.</p>`}
        </div>
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
        const response = await fetch(getApiUrl(`/api/steam/friends/${friend.steamid}/achievements/${game.appid}`));

        if (!response.ok) continue;

        const data = await response.json();
        const achievements = data.achievements || [];
        const unlocked = achievements.filter(achievement => achievement.unlocked).length;

        game.achievements = achievements;
        game.completion = achievements.length ? Math.round((unlocked / achievements.length) * 100) : 0;
      } catch (error) {
        game.achievements = [];
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
            <small>${friend.currentGame ? `Playing ${friend.currentGame}` : getPersonaStatusLabel(friend.status)}</small>
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
          <strong>${friend.libraryPrivate || !stats.totalAchievements ? "--" : `Lvl ${stats.levelData.level}`}</strong>
          <small>Public Level</small>
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
        Import your Steam library first to build insights.
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
    visibleGoals = visibleGoals.filter(goal => goal.gameId === Number(filter));
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
    const game = state.games.find(item => item.id === goal.gameId);
    const groupName = goal.gameId ? game.name : "Global";

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
  const gameId = Number(document.getElementById("trophyGame").value);
  const achievementSelect = document.getElementById("trophyAchievement");
  const game = state.games.find(item => item.id === gameId);

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

    const game = state.games.find(item => item.id === Number(document.getElementById("trophyGame").value));

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

    const game = state.games.find(item => item.id === Number(document.getElementById("trophyGame").value));

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
  const gameId = Number(document.getElementById("trophyGame").value);
  const game = state.games.find(item => item.id === gameId);

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

  const game = state.games.find(item => item.id === gameId);

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
    gameId:selected === "global" ? null : Number(selected)
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


