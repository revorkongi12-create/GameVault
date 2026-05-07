const fs = require("fs");
const path = require("path");

const apiBase = process.env.GAMEVAULT_API_BASE || "http://localhost:3000";
const useLocalServer = process.env.GAMEVAULT_USE_LOCAL_SERVER
  ? process.env.GAMEVAULT_USE_LOCAL_SERVER !== "false"
  : apiBase.includes("localhost") || apiBase.includes("127.0.0.1");

const config = {
  apiBase,
  useLocalServer
};

fs.writeFileSync(
  path.join(__dirname, "..", "app.config.json"),
  `${JSON.stringify(config, null, 2)}\n`
);

console.log(`Wrote app.config.json for ${apiBase}`);
