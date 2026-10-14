# NEON FOOTBALL — Render Web Service

## IMPORTANT: Render service type
This game requires a **Render Web Service**, not a Static Site, because the Node.js process hosts both the HTTP frontend and the WebSocket multiplayer server.

## Deploy
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Do not hard-code `PORT`; Render injects it automatically.
- The app binds to `0.0.0.0` and serves `public/` from the same server that accepts WebSocket connections.

`render.yaml` is included for Render Blueprint deployment. If you already deployed this repository as a **Static Site**, create a new **Web Service** from the repository; changing JavaScript alone cannot add a Node/WebSocket server to a Static Site.

## Troubleshooting connection errors
1. Open `https://YOUR-SERVICE.onrender.com/health`. It must return JSON like `{"ok":true,"rooms":0}`.
2. In Render Logs, look for `Football 2D listening on port ...` and check for `Exited with status` or dependency errors.
3. Confirm Build Command is `npm install`, Start Command is `npm start`, and the service is a Web Service.
4. Hard refresh the browser after deployment. Frontend reconnects automatically if the socket drops.

## Included
- Server-side authoritative match and room logic.
- 16:9 field rendering, camera, minimap and fixed mobile controls.
- Persistent facing, charged shot/pass, reduced ball bounce while controlling, sprint stamina, tackle with server-side 2-second cooldown.

Rooms are stored in memory and reset when the process restarts. Supabase/SQL is not required for this build.
