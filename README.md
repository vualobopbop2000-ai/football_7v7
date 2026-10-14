# NEON FOOTBALL — performance-tuned build

## Structure
- `public/index.html`, `public/style.css`, `public/client.js`: browser frontend
- `server.js`, `package.json`: Node.js HTTP + WebSocket game server

## Run
- Install: `npm install`
- Start: `npm start`

This project requires a Node.js host that supports persistent WebSocket connections (for example Render Web Service or another Node host). Netlify Static Hosting alone cannot run `server.js` or host this game's authoritative WebSocket server.

## Performance changes
- Server simulation stays at 60 ticks/second; snapshots are sent at up to 30 per second.
- Canvas backing resolution is capped at 1.25x on mobile and 1.5x on desktop to reduce GPU/fill-rate load.
- Canvas dimensions are updated on resize rather than queried and recalculated every animation frame.
- Removed expensive canvas shadow blur from players and ball.
- Minimap redraws only when a new server snapshot arrives.

These changes reduce rendering and network overhead, but actual FPS and latency still depend on device, browser, network, and server CPU.
