const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const crypto = require("crypto");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const FIELD = { width: 2400, height: 1400, goalHeight: 190, margin: 50 };
const MATCH_SECONDS = 5 * 60;
const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
const clients = new Map();
let nextPlayerId = 1;

const uid = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const send = (ws, data) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
};
function publicRoom(room) {
  return {
    id: room.id, hostId: room.hostId, status: room.status,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, ready: p.ready, isHost: p.id === room.hostId
    }))
  };
}
function broadcastRoom(room) {
  const payload = { type: "roomUpdate", room: publicRoom(room) };
  for (const p of room.players.values()) send(p.ws, payload);
}
function lobbyList() {
  return [...rooms.values()].filter(r => r.status !== "finished").map(r => ({
    id: r.id, status: r.status, count: r.players.size,
    red: [...r.players.values()].filter(p => p.team === "red").length,
    blue: [...r.players.values()].filter(p => p.team === "blue").length
  }));
}
function broadcastRooms() {
  const payload = { type: "rooms", rooms: lobbyList() };
  for (const ws of wss.clients) send(ws, payload);
}
function teamCounts(room) {
  let red = 0, blue = 0;
  for (const p of room.players.values()) p.team === "red" ? red++ : blue++;
  return { red, blue };
}
function assignTeam(room) {
  const { red, blue } = teamCounts(room);
  if (red < blue) return "red";
  if (blue < red) return "blue";
  const team = room.nextTeam;
  room.nextTeam = team === "red" ? "blue" : "red";
  return team;
}
function createRoom(host) {
  const id = uid();
  const room = {
    id, hostId: host.id, players: new Map(), status: "waiting",
    nextTeam: "red", countdownEnds: 0, countdownTimer: null,
    goalCountdownTimer: null, isGoalPausing: false,
    state: null, loop: null, lastTick: Date.now(), startedAt: 0
  };
  rooms.set(id, room);
  joinRoom(host, room, true);
  return room;
}
function joinRoom(client, room, isHost = false) {
  if (room.status !== "waiting") return send(client.ws, { type: "error", message: "Phòng đã bắt đầu hoặc đã kết thúc." });
  if (room.players.size >= 14) return send(client.ws, { type: "error", message: "Phòng đã đủ 14 người." });
  if (client.roomId) leaveRoom(client, false);
  const team = assignTeam(room);
  const initialFacing = { x: team === "red" ? 1 : -1, y: 0 };
  const player = {
    id: client.id, name: client.name, team, ready: false, isHost,
    ws: client.ws, x: 0, y: 0, vx: 0, vy: 0, stamina: 100,
    input: { x: 0, y: 0, sprint: false, kick: false, kickPower: 0, control: false, tackle: false, facing: initialFacing },
    facing: initialFacing, pendingKick: null,
    tackleUntil: 0, tackleCooldownUntil: 0, radius: 17, stunnedUntil: 0, goals: 0, saves: 0
  };
  room.players.set(player.id, player);
  client.roomId = room.id;
  send(client.ws, { type: "joined", playerId: player.id, roomId: room.id });
  broadcastRoom(room);
  broadcastRooms();
}
function stopCountdown(room) {
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  room.countdownTimer = null;
  room.countdownEnds = 0;
  if (room.goalCountdownTimer) clearInterval(room.goalCountdownTimer);
  room.goalCountdownTimer = null;
  room.isGoalPausing = false;
}
function leaveRoom(client, disconnecting = true) {
  const room = rooms.get(client.roomId);
  if (!room) { client.roomId = null; return; }
  const player = room.players.get(client.id);
  room.players.delete(client.id);
  client.roomId = null;
  if (room.status === "countdown") {
    stopCountdown(room);
    room.status = "waiting";
    for (const p of room.players.values()) send(p.ws, { type: "notice", message: "Đếm ngược bị hủy vì đội hình thay đổi." });
  }
  if (room.players.size === 0) {
    stopCountdown(room);
    if (room.loop) clearInterval(room.loop);
    rooms.delete(room.id);
  } else {
    if (room.hostId === client.id) {
      const nextHost = room.players.values().next().value;
      room.hostId = nextHost.id;
      send(nextHost.ws, { type: "notice", message: "Bạn được chuyển quyền quản lý phòng." });
    }
    if (player && room.status === "playing" && room.players.size === 0) room.status = "finished";
    broadcastRoom(room);
  }
  if (disconnecting) send(client.ws, { type: "leftRoom" });
  broadcastRooms();
}
function allReadyAndBalanced(room) {
  if (room.players.size < 2) return false;
  const { red, blue } = teamCounts(room);
  return red > 0 && red === blue && [...room.players.values()].every(p => p.ready);
}
function requestStart(room, requesterId) {
  if (requesterId !== room.hostId) return send(room.players.get(requesterId)?.ws, { type: "error", message: "Chỉ Host mới có thể bắt đầu trận." });
  if (room.status !== "waiting") return;
  if (!allReadyAndBalanced(room)) return send(room.players.get(requesterId)?.ws, { type: "error", message: "Cần hai đội có số người bằng nhau (ít nhất 1 người/đội) và tất cả người chơi phải sẵn sàng." });
  room.status = "countdown";
  room.countdownEnds = Date.now() + 3000;
  broadcastRoom(room);
  let n = 3;
  for (const p of room.players.values()) send(p.ws, { type: "countdown", value: n, text: "TRẬN ĐẤU BẮT ĐẦU" });
  room.countdownTimer = setInterval(() => {
    n--;
    if (n > 0) {
      for (const p of room.players.values()) send(p.ws, { type: "countdown", value: n, text: "TRẬN ĐẤU BẮT ĐẦU" });
    } else {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      if (!allReadyAndBalanced(room) || room.status !== "countdown") {
        room.status = "waiting"; broadcastRoom(room); return;
      }
      startMatch(room);
    }
  }, 1000);
}
function spawnPlayers(room) {
  const reds = [...room.players.values()].filter(p => p.team === "red");
  const blues = [...room.players.values()].filter(p => p.team === "blue");
  for (const [team, list] of [["red", reds], ["blue", blues]]) {
    list.forEach((p, i) => {
      const xBase = team === "red" ? FIELD.width * 0.25 : FIELD.width * 0.75;
      const rows = Math.ceil(Math.sqrt(list.length));
      p.x = xBase + (i % rows - (rows - 1) / 2) * 55;
      p.y = FIELD.height / 2 + (Math.floor(i / rows) - (rows - 1) / 2) * 55;
      p.vx = p.vy = 0; p.stamina = 100; p.tackleUntil = 0; p.tackleCooldownUntil = 0; p.facing = { x: team === "red" ? 1 : -1, y: 0 };
    });
  }
}
function startMatch(room) {
  room.status = "playing";
  room.startedAt = Date.now();
  room.isGoalPausing = false;
  room.state = {
    ball: { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, r: 10, ownerId: null, lastTouchId: null },
    score: { red: 0, blue: 0 }, remaining: MATCH_SECONDS,
    players: []
  };
  spawnPlayers(room);
  room.lastTick = Date.now();
  for (const p of room.players.values()) send(p.ws, { type: "matchStarted", field: FIELD, duration: MATCH_SECONDS });
  room.loop = setInterval(() => tick(room), 1000 / TICK_RATE);
  broadcastRoom(room);
}
function resetAfterGoal(room) {
  const b = room.state.ball;
  b.x = FIELD.width / 2; b.y = FIELD.height / 2; b.vx = b.vy = 0; b.ownerId = null; b.lastTouchId = null;
  spawnPlayers(room);
}

function handleGoal(room, goalTeam) {
  const state = room.state;
  if (!state || room.isGoalPausing) return;

  state.score[goalTeam]++;

  let scorerName = "";
  if (state.ball.lastTouchId) {
    const p = room.players.get(state.ball.lastTouchId);
    if (p && p.team === goalTeam) {
      p.goals = (p.goals || 0) + 1;
      scorerName = p.name;
    }
  }

  const teamName = goalTeam === "red" ? "ĐỘI ĐỎ" : "ĐỘI XANH";
  const goalMsg = scorerName
    ? `⚽ VÀO OOO! ${scorerName} ghi bàn cho ${teamName}!`
    : `⚽ VÀO OOO! Bàn thắng cho ${teamName}!`;

  for (const p of room.players.values()) {
    send(p.ws, { type: "notice", message: goalMsg });
  }

  resetAfterGoal(room);

  room.isGoalPausing = true;
  let count = 3;

  for (const p of room.players.values()) {
    send(p.ws, { type: "countdown", value: count, text: "VÀO! TIẾP TỤC SAU..." });
  }

  room.goalCountdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      for (const p of room.players.values()) {
        send(p.ws, { type: "countdown", value: count, text: "VÀO! TIẾP TỤC SAU..." });
      }
    } else {
      clearInterval(room.goalCountdownTimer);
      room.goalCountdownTimer = null;
      room.isGoalPausing = false;
      for (const p of room.players.values()) {
        send(p.ws, { type: "matchResumed" });
        send(p.ws, { type: "countdown", value: 0 });
      }
    }
  }, 1000);
}

function tick(room) {
  if (room.status !== "playing" || !room.state) return;
  const now = Date.now();
  const state = room.state;

  if (room.isGoalPausing) {
    room.startedAt += (now - room.lastTick);
    room.lastTick = now;
    const players = [...room.players.values()];
    const snapshot = {
      type: "snapshot", time: now, remaining: state.remaining, score: state.score,
      ball: { x: state.ball.x, y: state.ball.y, vx: 0, vy: 0, ownerId: null },
      players: players.map(p => ({
        id: p.id, name: p.name, team: p.team, x: p.x, y: p.y, stamina: p.stamina,
        ready: p.ready, facing: p.facing, tackling: false, tackleCooldown: 0
      }))
    };
    for (const p of players) send(p.ws, snapshot);
    return;
  }

  room.lastTick = now;
  state.remaining = Math.max(0, MATCH_SECONDS - (now - room.startedAt) / 1000);
  const players = [...room.players.values()];
  const ball = state.ball;

  for (const p of players) {
    const input = p.input;
    let ix = input.x, iy = input.y;
    const mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; }

    const suppliedFacing = input.facing || {};
    const fm = Math.hypot(Number(suppliedFacing.x) || 0, Number(suppliedFacing.y) || 0);
    if (mag > 0.18) p.facing = { x: ix / (mag || 1), y: iy / (mag || 1) };
    else if (fm > 0.1) p.facing = { x: Number(suppliedFacing.x) / fm, y: Number(suppliedFacing.y) / fm };
    const stunned = now < p.stunnedUntil;
    let speed = 185;

    if (input.sprint && p.stamina > 0 && !stunned) {
      speed *= 1.7;
      p.stamina = Math.max(0, p.stamina - 40.8 * DT);
    } else {
      p.stamina = Math.min(100, p.stamina + 18 * DT);
    }
    if (stunned) ix = iy = 0;

    if (now < p.tackleUntil && !stunned) {
      p.vx = p.facing.x * 430;
      p.vy = p.facing.y * 430;
    } else {
      p.vx = ix * speed; p.vy = iy * speed;
    }
    p.x = clamp(p.x + p.vx * DT, FIELD.margin + p.radius, FIELD.width - FIELD.margin - p.radius);
    p.y = clamp(p.y + p.vy * DT, FIELD.margin + p.radius, FIELD.height - FIELD.margin - p.radius);

    // XỬ LÝ SÚT BÓNG (NẾU ĐẠT CỰC ĐẠI: VẬN TỐC TĂNG GẤP 1.5 LẦN)
    if (p.pendingKick && ball.ownerId === p.id) {
      const kick = p.pendingKick;
      p.pendingKick = null;
      const angle = Math.atan2(kick.y, kick.x);
      const power = clamp(kick.power || 0.65, 0.15, 1);
      ball.ownerId = null;
      ball.lastTouchId = p.id;

      // Khi ghì đè nút sút đạt cực đại (power >= 0.98), nhân thêm 1.5 lần
      const isMaxPower = power >= 0.98;
      const kickSpeed = (330 + power * 420) * (isMaxPower ? 1.5 : 1.0);

      ball.vx = Math.cos(angle) * kickSpeed;
      ball.vy = Math.sin(angle) * kickSpeed;
    } else if (p.pendingKick) {
      p.pendingKick = null;
    }
  }

  // Va chạm cầu thủ
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
    const min = a.radius + b.radius;
    if (d < min) {
      const overlap = (min - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * overlap; a.y -= ny * overlap;
      b.x += nx * overlap; b.y += ny * overlap;
    }
  }

  // Xoạc bóng
  for (const p of players) {
    if (now >= p.tackleUntil) continue;
    const dx = ball.x - p.x, dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const dot = (dx / dist) * p.facing.x + (dy / dist) * p.facing.y;
    if (dist <= p.radius + ball.r + 25 && dot > 0.15) {
      ball.ownerId = p.id;
      ball.lastTouchId = p.id;
      ball.vx = ball.vy = 0;
      p.tackleUntil = 0;
      break;
    }
  }

  if (ball.ownerId) {
    const owner = room.players.get(ball.ownerId);
    if (owner) {
      const dir = Math.atan2(owner.facing.y, owner.facing.x);
      ball.x = owner.x + Math.cos(dir) * (owner.radius + ball.r + 3);
      ball.y = owner.y + Math.sin(dir) * (owner.radius + ball.r + 3);
      ball.vx = owner.vx * 0.45; ball.vy = owner.vy * 0.45;
    } else ball.ownerId = null;
  } else {
    ball.x += ball.vx * DT; ball.y += ball.vy * DT;
    const friction = Math.pow(0.985, DT * 60);
    ball.vx *= friction; ball.vy *= friction;
    if (Math.hypot(ball.vx, ball.vy) < 8) ball.vx = ball.vy = 0;

    const inGoal = Math.abs(ball.y - FIELD.height / 2) < FIELD.goalHeight / 2;
    let goalTeam = null;
    if (ball.x <= FIELD.margin + ball.r && inGoal && ball.vx < 0) {
      goalTeam = "blue";
    } else if (ball.x >= FIELD.width - FIELD.margin - ball.r && inGoal && ball.vx > 0) {
      goalTeam = "red";
    }

    if (goalTeam) {
      handleGoal(room, goalTeam);
      return;
    } else {
      if (ball.x < FIELD.margin + ball.r || ball.x > FIELD.width - FIELD.margin - ball.r) ball.vx *= -0.82;
      if (ball.y < FIELD.margin + ball.r || ball.y > FIELD.height - FIELD.margin - ball.r) ball.vy *= -0.82;
      ball.x = clamp(ball.x, FIELD.margin + ball.r, FIELD.width - FIELD.margin - ball.r);
      ball.y = clamp(ball.y, FIELD.margin + ball.r, FIELD.height - FIELD.margin - ball.r);
    }

    for (const p of players) {
      const d = Math.hypot(ball.x - p.x, ball.y - p.y);
      if (d <= p.radius + ball.r + 2) {
        if (Math.hypot(ball.vx, ball.vy) < 230) {
          ball.ownerId = p.id;
          ball.lastTouchId = p.id;
          ball.vx = ball.vy = 0;
        } else if (p.input.control) {
          ball.vx *= 0.2; ball.vy *= 0.2;
          if (Math.hypot(ball.vx, ball.vy) < 100) {
            ball.ownerId = p.id;
            ball.lastTouchId = p.id;
          }
        } else {
          const dx = ball.x - p.x, dy = ball.y - p.y, mag = Math.hypot(dx, dy) || 1;
          ball.vx = Math.abs(ball.vx) * dx / mag + p.vx * 0.25;
          ball.vy = Math.abs(ball.vy) * dy / mag + p.vy * 0.25;
          ball.lastTouchId = p.id;
          p.stunnedUntil = now + 180;
        }
      }
    }
  }

  if (state.remaining <= 0) {
    room.status = "finished";
    clearInterval(room.loop); room.loop = null;
    stopCountdown(room);
    for (const p of players) send(p.ws, { type: "gameOver", score: state.score, stats: players.map(q => ({ id: q.id, name: q.name, team: q.team, goals: q.goals, saves: q.saves })) });
    broadcastRoom(room); broadcastRooms(); return;
  }
  const snapshot = {
    type: "snapshot", time: now, remaining: state.remaining, score: state.score,
    ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, ownerId: ball.ownerId },
    players: players.map(p => ({ id: p.id, name: p.name, team: p.team, x: p.x, y: p.y, stamina: p.stamina, ready: p.ready, facing: p.facing, tackling: now < p.tackleUntil, tackleCooldown: Math.max(0, p.tackleCooldownUntil - now) }))
  };
  for (const p of players) send(p.ws, snapshot);
}

wss.on("connection", ws => {
  const client = { id: `p${nextPlayerId++}`, name: `Guest_${Math.floor(1000 + Math.random() * 9000)}`, ws, roomId: null };
  clients.set(ws, client);
  send(ws, { type: "welcome", id: client.id, name: client.name });
  send(ws, { type: "rooms", rooms: lobbyList() });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "setName") {
      client.name = String(msg.name || "").trim().slice(0, 18) || client.name;
      const room = rooms.get(client.roomId);
      if (room?.players.has(client.id)) { room.players.get(client.id).name = client.name; broadcastRoom(room); }
    }
    if (msg.type === "createRoom") {
      if (client.roomId) leaveRoom(client, false);
      createRoom(client); broadcastRooms();
    }
    if (msg.type === "joinRoom") {
      const room = rooms.get(String(msg.roomId || "").toUpperCase());
      if (!room) return send(ws, { type: "error", message: "Không tìm thấy phòng." });
      joinRoom(client, room); broadcastRooms();
    }
    if (msg.type === "leaveRoom") leaveRoom(client);
    if (msg.type === "ready") {
      const room = rooms.get(client.roomId);
      const p = room?.players.get(client.id);
      if (!p || room.status !== "waiting") return;
      p.ready = Boolean(msg.ready);
      broadcastRoom(room);
      if (!allReadyAndBalanced(room) && room.status === "countdown") {
        stopCountdown(room); room.status = "waiting"; broadcastRoom(room);
      }
    }
    if (msg.type === "start") {
      const room = rooms.get(client.roomId);
      if (room) requestStart(room, client.id);
    }
    if (msg.type === "input") {
      const room = rooms.get(client.roomId);
      const p = room?.players.get(client.id);
      if (!p || room.status !== "playing") return;
      const i = msg.input || {};
      p.input = {
        x: clamp(Number(i.x) || 0, -1, 1), y: clamp(Number(i.y) || 0, -1, 1),
        sprint: Boolean(i.sprint), kick: false,
        kickPower: clamp(Number(i.kickPower) || 0, 0, 1), control: Boolean(i.control),
        tackle: Boolean(i.tackle),
        facing: (() => { const f = i.facing || p.facing; const m = Math.hypot(Number(f.x) || 0, Number(f.y) || 0); return m > 0.1 ? { x: Number(f.x)/m, y: Number(f.y)/m } : p.facing; })()
      };
      if (p.input.tackle && !p._tackleInputHeld && Date.now() >= p.tackleCooldownUntil) {
        p.tackleUntil = Date.now() + 260;
        p.tackleCooldownUntil = Date.now() + 2000;
      }
      p._tackleInputHeld = p.input.tackle;
      if (i.kick) {
        const shotFacing = p.input.facing || p.facing || { x: p.team === "red" ? 1 : -1, y: 0 };
        const shotMagnitude = Math.hypot(shotFacing.x, shotFacing.y) || 1;
        p.pendingKick = {
          x: shotFacing.x / shotMagnitude, y: shotFacing.y / shotMagnitude,
          power: clamp(Number(i.kickPower) || 0.2, 0.15, 1)
        };
      }
    }
    if (msg.type === "playAgain") {
      const room = rooms.get(client.roomId);
      if (!room || room.status !== "finished") return;
      stopCountdown(room);
      room.status = "waiting"; room.state = null;
      for (const p of room.players.values()) { p.ready = false; p.input = { x:0,y:0,sprint:false,kick:false,kickPower:0,control:false,tackle:false,facing:p.facing }; p._tackleInputHeld = false; p.tackleUntil = 0; p.tackleCooldownUntil = 0; }
      broadcastRoom(room);
    }
  });
  ws.on("close", () => {
    leaveRoom(client, false);
    clients.delete(ws);
    broadcastRooms();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Football 2D listening on port ${PORT}`));