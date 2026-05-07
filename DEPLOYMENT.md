# GameVault Public Release Checklist

## 1. Host The Steam API

GameVault needs a private backend because the Steam Web API key must never ship inside the desktop installer.

Deploy `server.js` to a Node host such as Render, Railway, Fly.io, DigitalOcean, or your own VPS.

Required environment variables:

```text
STEAM_API_KEY=your_steam_web_api_key
STEAM_REALM=https://api.your-domain.example/
STEAM_RETURN_URL=https://api.your-domain.example/auth/steam/return
SESSION_SECRET=a_long_random_secret
CORS_ORIGIN=*
PORT=3000
```

`CORS_ORIGIN=*` is acceptable for the desktop app because GameVault uses a per-install client ID, not browser cookies, for API identity.

## 2. Register Steam Login Domain

In Steamworks / Steam Web API settings, set the domain to the backend domain you control.

Use this return URL:

```text
https://api.your-domain.example/auth/steam/return
```

The desktop app opens:

```text
https://api.your-domain.example/auth/steam?clientId=<app-install-id>
```

The backend stores the completed Steam login against that client ID, so multiple public users can sign in without overwriting each other.

## 3. Configure GitHub Releases

In the GitHub repository, add a repository variable:

```text
GAMEVAULT_API_BASE=https://api.your-domain.example
```

The included GitHub Actions workflow builds the Windows installer when you push a tag like:

```powershell
git tag v1.0.11
git push origin v1.0.11
```

The generated installer appears as a workflow artifact. Attach that `.exe` to a GitHub Release for users to download.

## 4. Local Development

For local development, keep `app.config.json` as:

```json
{
  "apiBase": "http://localhost:3000",
  "useLocalServer": true
}
```

Create a private `.env` from `.env.example`, then run:

```powershell
npm install
npm start
```

## 5. Release Build

To create a public installer locally:

```powershell
$env:GAMEVAULT_API_BASE="https://api.your-domain.example"
$env:GAMEVAULT_USE_LOCAL_SERVER="false"
npm run build:release
```

Confirm `dist/win-unpacked/resources/app.asar` does not contain `.env`. The package config intentionally excludes `.env`.
