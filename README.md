# NEON FOOTBALL — Render update

## Run locally
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Render Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Do not set a custom PORT; Render injects `PORT` automatically.
- The service serves `public/` and accepts WebSocket connections on the same HTTP server.
- `/health` returns a small health response.

## Fix included
- Fixes a runtime `ReferenceError` in `joinRoom`: team was referenced before initialization. This could crash the server when clicking Create Room and result in Render 502 errors.
- Shot charge bar: hold the Shoot/Pass button to build power; release to shoot. The direction follows the last facing direction.
- Server snapshot includes facing and tackle cooldown.

Rooms are in-memory and will reset when the server restarts. Supabase/SQL is not required for this build.
