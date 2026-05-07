const express = require("express");
const passport = require("passport");
const session = require("express-session");
const SteamStrategy = require("passport-steam").Strategy;
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path:path.join(__dirname, ".env") });

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_REALM = process.env.STEAM_REALM;
const STEAM_RETURN_URL = process.env.STEAM_RETURN_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "gamevault-local-dev-secret";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DEFAULT_CLIENT_ID = "local";
const RECENT_AUTH_CLAIM_WINDOW_MS = 5 * 60 * 1000;

const steamSchemaCache = new Map();
const steamAppDetailsCache = new Map();
let recentSteamAuth = null;
const userDataPath = path.join(process.env.APPDATA || __dirname, "GameVault");
const savedProfilePath = path.join(userDataPath, "steam-profile.json");
const savedProfilesPath = path.join(userDataPath, "steam-profiles.json");

function loadSavedSteamProfiles() {
  try {
    if (fs.existsSync(savedProfilesPath)) {
      const savedProfiles = JSON.parse(fs.readFileSync(savedProfilesPath, "utf8"));

      return new Map(Object.entries(savedProfiles));
    }

    if (fs.existsSync(savedProfilePath)) {
      const legacyProfile = JSON.parse(fs.readFileSync(savedProfilePath, "utf8"));

      return new Map([[DEFAULT_CLIENT_ID, legacyProfile]]);
    }

    return new Map();
  } catch (error) {
    console.error("Could not load saved Steam profiles:", error.message);
    return new Map();
  }
}

const steamProfiles = loadSavedSteamProfiles();

function saveSteamProfiles() {
  try {
    fs.mkdirSync(userDataPath, { recursive:true });
    fs.writeFileSync(savedProfilesPath, JSON.stringify(Object.fromEntries(steamProfiles), null, 2));
  } catch (error) {
    console.error("Could not save Steam profiles:", error.message);
  }
}

function getClientId(req) {
  return req.query.clientId || req.get("x-gamevault-client-id") || req.session?.clientId || DEFAULT_CLIENT_ID;
}

function getSteamProfile(req) {
  const clientId = getClientId(req);

  return steamProfiles.get(clientId) || claimRecentSteamAuth(clientId);
}

function setSteamProfile(clientId, profile) {
  const resolvedClientId = clientId || DEFAULT_CLIENT_ID;

  steamProfiles.set(resolvedClientId, profile);
  recentSteamAuth = {
    clientId:resolvedClientId,
    profile,
    createdAt:Date.now()
  };
  saveSteamProfiles();
}

function claimRecentSteamAuth(clientId) {
  if (!clientId || clientId === DEFAULT_CLIENT_ID || !recentSteamAuth) return null;

  const isFresh = Date.now() - recentSteamAuth.createdAt <= RECENT_AUTH_CLAIM_WINDOW_MS;

  if (!isFresh) {
    recentSteamAuth = null;
    return null;
  }

  steamProfiles.set(clientId, recentSteamAuth.profile);
  recentSteamAuth = null;
  saveSteamProfiles();

  return steamProfiles.get(clientId);
}

function clearSteamProfile(req) {
  steamProfiles.delete(getClientId(req));
  saveSteamProfiles();
}

async function getSteamProfileSnapshot(req) {
  const clientId = getClientId(req);
  const steamProfile = steamProfiles.get(clientId);

  if (!steamProfile) return null;

  try {
    const response = await axios.get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/", {
      params:{
        key:STEAM_API_KEY,
        steamids:steamProfile.steamid
      }
    });
    const summary = response.data.response?.players?.[0];

    if (!summary) return steamProfile;

    const updatedProfile = {
      ...steamProfile,
      username:summary.personaname || steamProfile.username,
      avatar:summary.avatarfull || summary.avatarmedium || summary.avatar || steamProfile.avatar,
      profileUrl:summary.profileurl || steamProfile.profileUrl,
      status:summary.personastate || 0,
      currentGame:summary.gameextrainfo || "",
      currentGameId:summary.gameid || "",
      lastOnline:summary.lastlogoff || 0
    };

    setSteamProfile(clientId, updatedProfile);

    return updatedProfile;
  } catch (error) {
    console.error("Could not refresh Steam profile snapshot:", error.message);
    return steamProfile;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (CORS_ORIGIN === "*" || !origin) {
      callback(null, true);
      return;
    }

    const allowedOrigins = CORS_ORIGIN.split(",").map(item => item.trim());
    callback(null, allowedOrigins.includes(origin));
  }
}));

app.use(session({
  secret:SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{
    sameSite:"lax",
    secure:STEAM_RETURN_URL?.startsWith("https://") || false
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {
  res.json({
    name:"GameVault API",
    status:"ok",
    steamLoginConfigured:Boolean(STEAM_API_KEY && STEAM_REALM && STEAM_RETURN_URL),
    profileEndpoint:"/api/steam/profile",
    authEndpoint:"/auth/steam?clientId=YOUR_GAMEVAULT_CLIENT_ID"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status:"ok"
  });
});

app.get("/debug/auth", (req, res) => {
  const clientId = getClientId(req);

  res.json({
    clientId,
    connected:Boolean(steamProfiles.get(clientId)),
    storedProfiles:steamProfiles.size,
    recentAuthAvailable:Boolean(recentSteamAuth),
    recentAuthAgeSeconds:recentSteamAuth ? Math.round((Date.now() - recentSteamAuth.createdAt) / 1000) : null
  });
});

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(
  new SteamStrategy(
    {
      returnURL: STEAM_RETURN_URL,
      realm: STEAM_REALM,
      apiKey: STEAM_API_KEY
    },
    async (identifier, profile, done) => {
      const steamProfile = {
        steamid: profile.id,
        username: profile.displayName,
        avatar: profile.photos?.[2]?.value || profile.photos?.[0]?.value || "",
        profileUrl: profile._json?.profileurl || ""
      };

      return done(null, steamProfile);
    }
  )
);

app.get("/auth/steam", (req, res, next) => {
  req.session.clientId = getClientId(req);
  req.session.save(() => {
    passport.authenticate("steam")(req, res, next);
  });
});

app.get(
  "/auth/steam/return",
  passport.authenticate("steam", { failureRedirect: "/auth/failure" }),
  (req, res) => {
    setSteamProfile(req.session?.clientId || DEFAULT_CLIENT_ID, req.user);

    res.send(`
      <html>
        <body style="background:#0b0b10;color:white;font-family:Arial;text-align:center;padding-top:80px;">
          <h1>Steam connected!</h1>
          <p>You can close this window and return to GameVault.</p>
        </body>
      </html>
    `);
  }
);

app.get("/auth/failure", (req, res) => {
  res.status(401).send("Steam authentication failed.");
});

app.get("/api/steam/profile", async (req, res) => {
  if (!getSteamProfile(req)) {
    return res.json({ connected:false });
  }

  const profile = await getSteamProfileSnapshot(req);

  res.json({
    connected:true,
    profile
  });
});

app.post("/api/steam/logout", (req, res) => {
  clearSteamProfile(req);

  req.logout(() => {
    res.json({ success:true });
  });
});

app.get("/api/steam/owned-games", async (req, res) => {
  const steamProfile = getSteamProfile(req);

  if (!steamProfile) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  try {
    const response = await axios.get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/", {
      params:{
        key:STEAM_API_KEY,
        steamid:steamProfile.steamid,
        include_appinfo:true,
        include_played_free_games:true,
        format:"json"
      }
    });

    res.json(response.data.response);
  } catch (error) {
    res.status(500).json({
      error:"Failed to fetch owned games.",
      details:error.message
    });
  }
});

app.get("/api/steam/recently-played", async (req, res) => {
  const steamProfile = getSteamProfile(req);

  if (!steamProfile) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  try {
    const response = await axios.get("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/", {
      params:{
        key:STEAM_API_KEY,
        steamid:steamProfile.steamid,
        count:100,
        format:"json"
      }
    });

    res.json(response.data.response || { games:[] });
  } catch (error) {
    res.status(500).json({
      error:"Failed to fetch recently played Steam games.",
      details:error.message
    });
  }
});

app.get("/api/steam/achievements/:appid", async (req, res) => {
  const steamProfile = getSteamProfile(req);

  if (!steamProfile) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  const appid = req.params.appid;

  try {
    const achievements = await getPlayerAchievementsForApp(steamProfile.steamid, appid);

    res.json({
      appid:Number(appid),
      achievements
    });
  } catch (error) {
    res.status(404).json({
      error:"Achievements are not available for this game.",
      details:error.message
    });
  }
});

app.get("/api/steam/friends/:steamid/achievements/:appid", async (req, res) => {
  if (!getSteamProfile(req)) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  try {
    const achievements = await getPlayerAchievementsForApp(req.params.steamid, req.params.appid);

    res.json({
      appid:Number(req.params.appid),
      achievements
    });
  } catch (error) {
    res.status(404).json({
      error:"Achievements are not available for this friend or game.",
      details:error.message
    });
  }
});

app.get("/api/steam/app/:appid/details", async (req, res) => {
  const appid = req.params.appid;

  if (steamAppDetailsCache.has(appid)) {
    return res.json(steamAppDetailsCache.get(appid));
  }

  try {
    const response = await axios.get("https://store.steampowered.com/api/appdetails", {
      params:{
        appids:appid,
        filters:"basic,genres,categories"
      }
    });

    const details = response.data?.[appid]?.data || {};
    const payload = {
      appid:Number(appid),
      headerImage:details.header_image || "",
      genres:(details.genres || []).map(genre => genre.description),
      categories:(details.categories || []).map(category => category.description)
    };

    steamAppDetailsCache.set(appid, payload);
    res.json(payload);
  } catch (error) {
    res.status(404).json({
      error:"Could not fetch Steam app details.",
      details:error.message
    });
  }
});

async function getSteamAchievementPercentages(appid) {
  try {
    const response = await axios.get("https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/", {
      params:{
        gameid:appid,
        format:"json"
      }
    });

    return new Map(
      (response.data.achievementpercentages?.achievements || [])
        .map(achievement => [achievement.name, achievement.percent])
    );
  } catch (error) {
    return new Map();
  }
}

async function getPlayerAchievementsForApp(steamid, appid) {
  const [playerResponse, schema, globalPercentages] = await Promise.all([
    axios.get("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/", {
      params:{
        key:STEAM_API_KEY,
        steamid,
        appid,
        l:"en",
        format:"json"
      }
    }),
    getSteamGameSchema(appid),
    getSteamAchievementPercentages(appid)
  ]);

  const playerStats = playerResponse.data.playerstats || {};
  const unlockedByApiName = new Map(
    (playerStats.achievements || []).map(achievement => [
      achievement.apiname,
      {
        unlocked: achievement.achieved === 1,
        unlockTime: achievement.unlocktime || 0
      }
    ])
  );

  return (schema.availableGameStats?.achievements || [])
    .map(achievement => {
      const playerAchievement = unlockedByApiName.get(achievement.name);
      const globalPercent = globalPercentages.get(achievement.name) || null;

      return {
        apiName: achievement.name,
        name: achievement.displayName || achievement.name,
        description: achievement.description || "",
        icon: achievement.icon || "",
        iconGray: achievement.icongray || "",
        unlocked: playerAchievement?.unlocked || false,
        unlockTime: playerAchievement?.unlockTime || 0,
        globalPercent,
        rarity: getAchievementRarity(globalPercent)
      };
    });
}

function getAchievementRarity(percent) {
  if (typeof percent !== "number") return "common";
  if (percent < 2) return "hard";
  if (percent <= 25) return "legendary";
  if (percent <= 40) return "rare";

  return "common";
}

async function getSteamGameSchema(appid) {
  if (steamSchemaCache.has(appid)) {
    return steamSchemaCache.get(appid);
  }

  const response = await axios.get("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/", {
    params:{
      key:STEAM_API_KEY,
      appid,
      l:"en",
      format:"json"
    }
  });

  const schema = response.data.game || {};

  steamSchemaCache.set(appid, schema);

  return schema;
}

app.get("/api/steam/friends", async (req, res) => {
  const steamProfile = getSteamProfile(req);

  if (!steamProfile) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  try {
    const friendsResponse = await axios.get("https://api.steampowered.com/ISteamUser/GetFriendList/v0001/", {
      params:{
        key:STEAM_API_KEY,
        steamid:steamProfile.steamid,
        relationship:"friend"
      }
    });

    const friends = friendsResponse.data.friendslist?.friends || [];
    const steamIds = friends.map(friend => friend.steamid);

    if (!steamIds.length) {
      return res.json({ friends:[] });
    }

    const summaries = [];

    for (let i = 0; i < steamIds.length; i += 100) {
      const chunk = steamIds.slice(i, i + 100);
      const summaryResponse = await axios.get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/", {
        params:{
          key:STEAM_API_KEY,
          steamids:chunk.join(",")
        }
      });

      summaries.push(...(summaryResponse.data.response?.players || []));
    }

    res.json({
      friends:summaries.map(friend => ({
        steamid:friend.steamid,
        username:friend.personaname,
        avatar:friend.avatarfull || friend.avatarmedium || friend.avatar || "",
        profileUrl:friend.profileurl || "",
        status:friend.personastate || 0,
        currentGame:friend.gameextrainfo || "",
        currentGameId:friend.gameid || "",
        lastOnline:friend.lastlogoff || 0
      }))
    });
  } catch (error) {
    res.status(500).json({
      error:"Failed to fetch friends.",
      details:error.message
    });
  }
});

app.get("/api/steam/friends/:steamid/library", async (req, res) => {
  if (!getSteamProfile(req)) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  try {
    const response = await axios.get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/", {
      params:{
        key:STEAM_API_KEY,
        steamid:req.params.steamid,
        include_appinfo:true,
        include_played_free_games:true,
        format:"json"
      }
    });

    res.json(response.data.response || { games:[] });
  } catch (error) {
    res.status(404).json({
      error:"Could not fetch this friend's public library.",
      details:error.message
    });
  }
});

app.get("/api/steam/friends/:steamid/recently-played", async (req, res) => {
  if (!getSteamProfile(req)) {
    return res.status(401).json({ error:"No Steam account connected." });
  }

  try {
    const response = await axios.get("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/", {
      params:{
        key:STEAM_API_KEY,
        steamid:req.params.steamid,
        count:10,
        format:"json"
      }
    });

    res.json(response.data.response || { games:[] });
  } catch (error) {
    res.status(404).json({
      error:"Could not fetch this friend's recently played games.",
      details:error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`GameVault Steam server running on http://localhost:${PORT}`);
});
