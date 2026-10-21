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


## Mobile layout update (v5)
- Reworked the portrait fallback so the match scene uses the full rotated viewport rather than a half-width canvas.
- Repositioned the minimap, joystick, scoreboard, and round action buttons for the rotated landscape coordinate system.
- Added a dedicated native landscape layout for phones held horizontally.

For Render, replace the matching project files and deploy the latest commit. Test both portrait fallback and actual landscape orientation on the target phone.


## V6 mobile layout hotfix
- Keeps `.hidden` screens hidden so the initial create/join room menu is visible.
- Forces the active match canvas to fill the rotated landscape viewport.
- Places minimap at top-right and control overlays above the pitch.


## V7 mobile control/layout hotfix

- Removed the 90-degree DOM rotation on portrait phones; this was causing pointer-coordinate mismatch and HUD positions to rotate away from the physical screen corners.
- Match canvas now covers the complete viewport, with controls layered above the grass and minimap at the physical top-right.
- Joystick diameter increased to 142 CSS px (approximately double the old touch area), with a centered knob and pointer coordinates calculated against its actual bounding box.
- Sprint remains bottom-right; control, kick, and tackle are arranged along the surrounding circular arc.

Replace `public/client.js`, `public/style.css`, and `public/index.html` from this package in your GitHub repository, then deploy the latest commit on Render.

## V8 update — orientation notice, practice mode and low-end rendering
- Displays a dismissible first-entry notice asking players to unlock auto-rotate and hold their phone horizontally; includes `cre: Ng Duc Minh`.
- Adds a local solo practice mode using the same pitch, with movement, stamina, ball control, charged shooting, target scoring and an always-available exit button. Practice runs locally and does not need a multiplayer room.
- Reuses a cached pitch background, removes costly player/ball glow effects, updates the minimap at 10 Hz, pauses canvas drawing outside the match screen, and adapts the canvas backing resolution to the available screen size.
- Replace the three files inside `public/` with the included versions. The Node/WebSocket server protocol does not need to change.
