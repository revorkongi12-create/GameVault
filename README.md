# GameVault

GameVault is an Electron desktop app that turns a Steam account into a themed game library, achievement tracker, profile showcase, friends view, and play-session activity hub.

## Features

- Steam sign-in with remembered profile
- Steam library import, including played free games and recently played shared/free entries
- Achievement sync with rarity tiers, hunting tools, and trophy showcases
- Friends tab with active friends first, Steam chat launch, friend profile summaries, and shared-game comparison
- Game inspection view with friends who own the selected game
- Recent activity with live session length and lightweight Steam refreshes
- Unlockable profile themes, backlog labels, insights, keybinds, and fullscreen support

## Local Setup

1. Install dependencies:

```powershell
npm install
```

2. Create `.env` from `.env.example` and fill in your Steam Web API settings.

3. Start the app:

```powershell
npm start
```

4. Build a Windows installer:

```powershell
npm run build
```

For a public installer, set the hosted API URL before building:

```powershell
$env:GAMEVAULT_API_BASE="https://api.your-domain.example"
$env:GAMEVAULT_USE_LOCAL_SERVER="false"
npm run build:release
```

## Steam Setup

For local development, the Steam return URL should point at the local server:

```text
http://localhost:3000/auth/steam/return
```

For a public release, host the API on your own domain, register that domain/return URL in Steam, and build the packaged app with:

```text
GAMEVAULT_API_BASE=https://your-domain.example
GAMEVAULT_USE_LOCAL_SERVER=false
```

The app uses a per-install client ID during Steam login, so a hosted backend can support multiple public users at once.

Never publish your real `.env` or Steam Web API key. The `.gitignore` keeps local secrets, installers, and dependencies out of GitHub, and the desktop package intentionally excludes `.env`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full GitHub release and hosted-backend checklist.

When the backend is deployed, opening its root URL should show a JSON health response. `/api/steam/profile` should return `connected:false` until a GameVault install signs in.

## Release Notes

This project is currently packaged as a Windows NSIS installer through Electron Builder. GitHub Actions can build the installer from tags once `GAMEVAULT_API_BASE` is configured as a repository variable.
