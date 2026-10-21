(() => {
  const $ = id => document.getElementById(id);
  const screens = ["menuScreen", "lobbyScreen", "gameScreen", "resultScreen"];
  const state = {
    ws: null, connected: false, id: null, name: "", room: null, rooms: [],
    ready: false, isHost: false, training: false, practice: null,
    field: { width: 1200, height: 700, goalHeight: 190, margin: 34 },
    snapshot: null, countdown: null, kickHeld: false, kickStart: 0, kickChargeFrame: 0,
    input: { x: 0, y: 0, sprint: false, kick: false, kickPower: 0, control: false, tackle: false },
    facing: { x: 1, y: 0 }, tackleReadyAt: 0,
    joystickPointer: null, joystickOrigin: null, toastTimer: null, reconnectTimer: null, reconnectDelay: 1000, pendingMessages: []
  };
  function showScreen(id) { screens.forEach(s => $(s).classList.toggle("hidden", s !== id)); }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.remove("hidden");
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
  }
  function send(type, extra = {}) {
    const payload = JSON.stringify({ type, ...extra });
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(payload);
      return true;
    }
    // Keep lobby actions made during a brief reconnect; flush them after the socket opens.
    if (type !== "input" && type !== "ready" && type !== "start" && type !== "leaveRoom" && type !== "playAgain") {
      state.pendingMessages.push(payload);
      if (state.pendingMessages.length > 20) state.pendingMessages.shift();
    }
    const status = state.ws?.readyState === WebSocket.CONNECTING ? "Đang kết nối máy chủ, vui lòng đợi một chút…" : "Chưa kết nối được máy chủ. Đang thử kết nối lại…";
    toast(status);
    return false;
  }
  function connect() {
    if (state.ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.ws.readyState)) return;
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = `${scheme}//${location.host}`;
    state.connected = false;
    $("connectionDot").classList.remove("online");
    $("connectionText").textContent = "ĐANG KẾT NỐI…";
    let ws;
    try { ws = new WebSocket(socketUrl); state.ws = ws; }
    catch (err) {
      $("connectionText").textContent = "KHÔNG KẾT NỐI ĐƯỢC";
      scheduleReconnect(); return;
    }
    ws.addEventListener("open", () => {
      if (state.ws !== ws) return;
      state.connected = true; state.reconnectDelay = 1000;
      $("connectionDot").classList.add("online"); $("connectionText").textContent = "ĐÃ KẾT NỐI";
      ws.send(JSON.stringify({ type: "setName", name: $("playerName").value.trim() }));
      const queued = state.pendingMessages.splice(0);
      queued.forEach(payload => { if (ws.readyState === WebSocket.OPEN) ws.send(payload); });
    });
    ws.addEventListener("close", () => {
      if (state.ws !== ws) return;
      state.connected = false; $("connectionDot").classList.remove("online");
      $("connectionText").textContent = "MẤT KẾT NỐI — ĐANG THỬ LẠI";
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      if (state.ws === ws) $("connectionText").textContent = "LỖI WEBSOCKET";
      // Browsers hide the detailed handshake error; close triggers reconnect.
    });
    ws.addEventListener("message", ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    });
  }
  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(15000, Math.round(state.reconnectDelay * 1.8));
    state.reconnectTimer = setTimeout(() => { state.reconnectTimer = null; connect(); }, delay);
  }
  function handleMessage(msg) {
    switch (msg.type) {
      case "welcome":
        state.id = msg.id; state.name = msg.name;
        if (!$("playerName").value) $("playerName").value = msg.name;
        break;
      case "rooms": state.rooms = msg.rooms || []; renderRooms(); break;
      case "joined": state.roomId = msg.roomId; break;
      case "roomUpdate":
        state.room = msg.room;
        state.ready = !!state.room.players.find(p => p.id === state.id)?.ready;
        state.isHost = state.room.hostId === state.id;
        renderLobby();
        if (state.room.status === "waiting" || state.room.status === "countdown") showScreen("lobbyScreen");
        if (state.room.status === "finished") showScreen("resultScreen");
        break;
      case "countdown":
        state.countdown = msg.value;
        $("countdownNumber").textContent = msg.value;
        $("countdownOverlay").classList.remove("hidden");
        showScreen("gameScreen");
        break;
      case "matchStarted":
        state.field = msg.field; state.snapshot = null;
        $("countdownOverlay").classList.add("hidden");
        showScreen("gameScreen"); break;
      case "snapshot":
        if (state.training) break;
        state.snapshot = msg;
        { const me = (msg.players || []).find(p => p.id === state.id); if (me && me.facing && Math.hypot(me.facing.x, me.facing.y) > 0.1) state.facing = { x: me.facing.x, y: me.facing.y }; }
        updateHud(msg); break;
      case "gameOver":
        $("finalRed").textContent = msg.score.red;
        $("finalBlue").textContent = msg.score.blue;
        renderStats(msg.stats || []);
        $("countdownOverlay").classList.add("hidden");
        showScreen("resultScreen"); break;
      case "notice": toast(msg.message); break;
      case "error": toast(msg.message); break;
      case "leftRoom":
        state.room = null; state.ready = false; state.isHost = false; showScreen("menuScreen"); break;
    }
  }
  function renderRooms() {
    const list = $("roomList"); $("roomCount").textContent = `${state.rooms.length} PHÒNG`;
    if (!state.rooms.length) { list.innerHTML = '<div class="empty-state">Chưa có phòng nào. Hãy tạo phòng mới!</div>'; return; }
    list.innerHTML = "";
    state.rooms.forEach(room => {
      const row = document.createElement("div"); row.className = "room-row";
      const info = document.createElement("div"); info.innerHTML = `<div class="room-id">#${escapeHtml(room.id)}</div><div class="room-meta">${room.count}/14 người · Đỏ ${room.red} — Xanh ${room.blue}</div>`;
      const btn = document.createElement("button"); btn.className = "btn btn-secondary"; btn.textContent = "THAM GIA";
      btn.disabled = room.status !== "waiting" || room.count >= 14;
      btn.addEventListener("click", () => { send("setName", { name: $("playerName").value.trim() }); send("joinRoom", { roomId: room.id }); });
      row.append(info, btn); list.appendChild(row);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function renderLobby() {
    if (!state.room) return;
    $("roomCode").textContent = state.room.id;
    $("lobbyStatus").textContent = state.room.status === "countdown" ? "Đang đếm ngược…" : "Đang chờ người chơi";
    const red = state.room.players.filter(p => p.team === "red");
    const blue = state.room.players.filter(p => p.team === "blue");
    $("redCount").textContent = red.length; $("blueCount").textContent = blue.length;
    $("readyCount").textContent = `${state.room.players.filter(p => p.ready).length}/${state.room.players.length}`;
    renderPlayerList("redPlayers", red); renderPlayerList("bluePlayers", blue);
    $("readyBtn").textContent = state.ready ? "✓ ĐÃ SẴN SÀNG" : "✓ SẴN SÀNG";
    $("readyBtn").classList.toggle("active", state.ready);
    $("readyBtn").disabled = state.room.status !== "waiting";
    const balanced = red.length > 0 && red.length === blue.length;
    const allReady = state.room.players.length > 1 && state.room.players.every(p => p.ready);
    $("startBtn").disabled = !state.isHost || !balanced || !allReady || state.room.status !== "waiting";
    $("startBtn").textContent = state.isHost ? "BẮT ĐẦU TRẬN" : "CHỜ HOST BẮT ĐẦU";
  }
  function renderPlayerList(id, players) {
    const el = $(id); el.innerHTML = "";
    if (!players.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Đang chờ cầu thủ…</div>'; return; }
    players.forEach(p => {
      const chip = document.createElement("div"); chip.className = "player-chip";
      const initials = escapeHtml(p.name.slice(0, 1).toUpperCase());
      chip.innerHTML = `<span class="avatar">${initials}</span><span class="p-name">${escapeHtml(p.name)}</span>${p.isHost ? '<span class="host-tag">HOST</span>' : ""}${p.ready ? '<span class="ready-mark">✓</span>' : ""}`;
      el.appendChild(chip);
    });
  }
  function updateHud(s) {
    $("redScore").textContent = s.score.red; $("blueScore").textContent = s.score.blue;
    if (state.training) {
      $("redTeamLabel").textContent = "BẠN";
      $("blueTeamLabel").textContent = "MỤC TIÊU";
      $("matchClock").textContent = "LUYỆN TẬP";
      return;
    }
    $("redTeamLabel").textContent = "ĐỎ";
    $("blueTeamLabel").textContent = "XANH";
    const sec = Math.ceil(s.remaining); $("matchClock").textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  }
  function renderStats(stats) {
    const el = $("statsList"); el.innerHTML = "";
    if (!stats.length) { el.innerHTML = '<p class="muted">Không có thống kê.</p>'; return; }
    stats.forEach(p => {
      const row = document.createElement("div"); row.className = "stat-row";
      row.innerHTML = `<span><span style="color:${p.team === "red" ? "var(--red)" : "var(--blue)"}">●</span> ${escapeHtml(p.name)}</span><strong>${p.goals || 0} bàn</strong>`;
      el.appendChild(row);
    });
  }

  $("orientationCloseBtn").addEventListener("click", () => {
    $("orientationModal").classList.add("hidden");
  });

  function resetGameInput() {
    state.input.x = 0; state.input.y = 0; state.input.sprint = false;
    state.input.kick = false; state.input.kickPower = 0; state.input.control = false; state.input.tackle = false;
    state.kickHeld = false;
    cancelAnimationFrame(state.kickChargeFrame);
    if (knob) knob.style.transform = "translate(-50%,-50%)";
    if (typeof resetJoystick === "function") resetJoystick();
    document.querySelectorAll(".control-btn.pressed").forEach(el => el.classList.remove("pressed"));
  }

  function startPractice() {
    resetGameInput();
    state.training = true;
    state.room = null;
    state.roomId = null;
    state.field = { width: 2400, height: 1400, goalHeight: 190, margin: 50 };
    state.facing = { x: 1, y: 0 };
    state.tackleReadyAt = 0;
    const px = state.field.width * 0.25, py = state.field.height * 0.5;
    const player = {
      id: "practice-player", name: ($("playerName").value.trim() || state.name || "Bạn").slice(0, 18),
      team: "red", x: px, y: py, vx: 0, vy: 0, stamina: 100,
      facing: { x: 1, y: 0 }, tackling: false, tackleCooldown: 0, radius: 17
    };
    state.practice = {
      player, ball: { x: px + 52, y: py, vx: 0, vy: 0, r: 10, ownerId: null },
      score: { red: 0, blue: 0 }, lastHudAt: 0, tackleUntil: 0, tackleCooldownUntil: 0
    };
    state.snapshot = {
      type: "snapshot", remaining: 300, score: state.practice.score,
      ball: state.practice.ball, players: [player]
    };
    $("countdownOverlay").classList.add("hidden");
    $("exitPracticeBtn").classList.remove("hidden");
    $("redTeamLabel").textContent = "BẠN";
    $("blueTeamLabel").textContent = "MỤC TIÊU";
    updateHud(state.snapshot);
    showScreen("gameScreen");
    toast("Chế độ luyện tập: di chuyển, giữ bóng và sút vào khung thành bên phải.");
  }

  function exitPractice() {
    state.training = false;
    state.practice = null;
    state.snapshot = null;
    resetGameInput();
    $("exitPracticeBtn").classList.add("hidden");
    $("redTeamLabel").textContent = "ĐỎ";
    $("blueTeamLabel").textContent = "XANH";
    $("matchClock").textContent = "05:00";
    showScreen("menuScreen");
  }

  function practiceKick(power) {
    const practice = state.practice;
    if (!state.training || !practice) return;
    const p = practice.player, b = practice.ball;
    const distance = Math.hypot(b.x - p.x, b.y - p.y);
    if (b.ownerId !== p.id && distance <= p.radius + (b.r || 10) + 5 && Math.hypot(b.vx, b.vy) < 230) {
      b.ownerId = p.id; b.vx = b.vy = 0;
    }
    if (b.ownerId !== p.id) {
      toast("Hãy tiến sát bóng để khống chế trước khi sút.");
      return;
    }
    const facing = state.facing;
    const mag = Math.hypot(facing.x, facing.y) || 1;
    b.ownerId = null;
    b.vx = facing.x / mag * (330 + Math.max(.15, Math.min(1, power)) * 420);
    b.vy = facing.y / mag * (330 + Math.max(.15, Math.min(1, power)) * 420);
  }

  function dispatchKick(power) {
    if (state.training) {
      practiceKick(power);
      return;
    }
    send("input", { input: { ...state.input, facing: { ...state.facing }, x: state.facing.x, y: state.facing.y, kick: true, kickPower: power } });
  }

  $("practiceBtn").addEventListener("click", startPractice);
  $("exitPracticeBtn").addEventListener("click", exitPractice);

  $("createRoomBtn").addEventListener("click", () => {
    send("setName", { name: $("playerName").value.trim() }); send("createRoom");
  });
  $("playerName").addEventListener("change", () => send("setName", { name: $("playerName").value.trim() }));
  $("leaveRoomBtn").addEventListener("click", () => send("leaveRoom"));
  $("readyBtn").addEventListener("click", () => { state.ready = !state.ready; send("ready", { ready: state.ready }); });
  $("startBtn").addEventListener("click", () => send("start"));
  $("playAgainBtn").addEventListener("click", () => send("playAgain"));
  $("resultLeaveBtn").addEventListener("click", () => send("leaveRoom"));

  // Touch/mouse joystick.
  const joy = $("joystick"), knob = $("joystickKnob");
  function joystickMove(clientX, clientY) {
    const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const max = r.width * .32, len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    state.input.x = dx / max; state.input.y = dy / max;
    if (Math.hypot(state.input.x, state.input.y) > .18) { const n = Math.hypot(state.input.x, state.input.y); state.facing.x = state.input.x / n; state.facing.y = state.input.y / n; }
  }
  function resetJoystick() {
    state.joystickPointer = null; state.input.x = 0; state.input.y = 0; knob.style.transform = "translate(-50%,-50%)";
  }
  joy.addEventListener("pointerdown", e => { e.preventDefault(); state.joystickPointer = e.pointerId; joy.setPointerCapture(e.pointerId); joystickMove(e.clientX, e.clientY); });
  joy.addEventListener("pointermove", e => { if (state.joystickPointer === e.pointerId) { e.preventDefault(); joystickMove(e.clientX, e.clientY); } });
  joy.addEventListener("pointerup", e => { if (state.joystickPointer === e.pointerId) resetJoystick(); });
  joy.addEventListener("pointercancel", resetJoystick);

  function holdButton(id, onDown, onUp) {
    const el = $(id);
    const down = e => { e.preventDefault(); el.classList.add("pressed"); onDown(); };
    const up = e => { e.preventDefault(); el.classList.remove("pressed"); onUp(); };
    el.addEventListener("pointerdown", down);
    ["pointerup", "pointercancel", "pointerleave"].forEach(ev => el.addEventListener(ev, e => { if (el.classList.contains("pressed")) up(e); }));
  }
  holdButton("sprintBtn", () => state.input.sprint = true, () => state.input.sprint = false);
  holdButton("controlBtn", () => state.input.control = true, () => state.input.control = false);
  holdButton("tackleBtn", () => {
    const now = performance.now();
    if (now < state.tackleReadyAt) { toast(`Xoạc bóng hồi chiêu ${Math.ceil((state.tackleReadyAt-now)/1000)}s`); return; }
    state.tackleReadyAt = now + 2000; state.input.tackle = true;
    if (state.training && state.practice) {
      state.practice.tackleUntil = now + 260;
      state.practice.tackleCooldownUntil = now + 2000;
      state.practice.player.tackling = true;
      const b = state.practice.ball;
      if (Math.hypot(b.x - state.practice.player.x, b.y - state.practice.player.y) < 72) {
        b.ownerId = state.practice.player.id; b.vx = b.vy = 0;
      }
    } else {
      send("input", { input: { ...state.input, tackle: true, facing: { ...state.facing } } });
    }
    setTimeout(() => { state.input.tackle = false; if (state.practice) state.practice.player.tackling = false; }, 120);
  }, () => {});
  function updateKickCharge() {
    const fill = $("kickChargeFill");
    if (fill) {
      const power = state.kickHeld ? Math.min(1, .15 + (performance.now() - state.kickStart) / 1400) : 0;
      fill.style.width = `${power * 100}%`;
      fill.parentElement?.setAttribute("aria-valuenow", String(Math.round(power * 100)));
    }
    if (state.kickHeld) state.kickChargeFrame = requestAnimationFrame(updateKickCharge);
  }
  holdButton("kickBtn", () => {
    if (state.kickHeld) return;
    state.kickHeld = true; state.kickStart = performance.now(); state.input.kick = false;
    cancelAnimationFrame(state.kickChargeFrame); updateKickCharge();
  }, () => {
    if (!state.kickHeld) return;
    const heldMs = performance.now() - state.kickStart;
    const power = Math.max(.15, Math.min(1, .15 + heldMs / 1400));
    state.input.kickPower = power; state.kickHeld = false; state.input.kick = false;
    cancelAnimationFrame(state.kickChargeFrame);
    const fill = $("kickChargeFill"); if (fill) fill.style.width = "0%";
    dispatchKick(power);
    setTimeout(() => { state.input.kickPower = 0; }, 80);
  });
  window.addEventListener("keydown", e => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") state.input.y = -1;
    if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") state.input.y = 1;
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") state.input.x = -1;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") state.input.x = 1;
    if (Math.hypot(state.input.x, state.input.y) > .18) { const n = Math.hypot(state.input.x, state.input.y); state.facing = { x: state.input.x/n, y: state.input.y/n }; }
    if (e.key === "Shift") state.input.sprint = true;
    if (e.key.toLowerCase() === "e") state.input.control = true;
    if (e.key === " ") { state.kickHeld = true; state.kickStart = performance.now(); }
  });
  window.addEventListener("keyup", e => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") state.input.y = state.input.y === -1 ? 0 : state.input.y;
    if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") state.input.y = state.input.y === 1 ? 0 : state.input.y;
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") state.input.x = state.input.x === -1 ? 0 : state.input.x;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") state.input.x = state.input.x === 1 ? 0 : state.input.x;
    if (e.key === "Shift") state.input.sprint = false;
    if (e.key.toLowerCase() === "e") state.input.control = false;
    if (e.key === " " && state.kickHeld) {
      state.input.kickPower = Math.max(.15, Math.min(1, .15 + (performance.now() - state.kickStart) / 1400));
      dispatchKick(state.input.kickPower);
      state.kickHeld = false; state.input.kickPower = 0;
    }
  });

  // Send latest input at 30 Hz; server simulates at 60 Hz.
  setInterval(() => {
    if (!state.training && state.room && state.room.status === "playing") {
      send("input", { input: { ...state.input, facing: { ...state.facing }, kick: false, kickPower: state.input.kickPower } });
    }
  }, 1000 / 30);

  const canvas = $("gameCanvas"), ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const minimap = $("minimapCanvas"), mctx = minimap ? minimap.getContext("2d", { alpha: false, desynchronized: true }) : null;
  const pitchCache = document.createElement("canvas");
  const pitchCtx = pitchCache.getContext("2d", { alpha: false });
  let pitchCacheKey = "", lastMinimapDraw = 0, lastFrameTime = 0, canvasSizeKey = "";

  function resizeCanvasForDevice() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    // Cap the backing buffer at 1280×720 and DPR 1.25 to reduce GPU fill cost on phones.
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    const scale = Math.min(dpr, 1280 / rect.width, 720 / rect.height);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const key = `${width}x${height}`;
    if (canvasSizeKey === key) return;
    canvasSizeKey = key;
    canvas.width = width;
    canvas.height = height;
  }

  function ensurePitchCache(fw, fh) {
    const key = `${fw}x${fh}`;
    if (pitchCacheKey === key) return;
    pitchCacheKey = key;
    pitchCache.width = fw; pitchCache.height = fh;
    pitchCtx.fillStyle = "#0a493b"; pitchCtx.fillRect(0, 0, fw, fh);
    const stripe = 150;
    pitchCtx.fillStyle = "#ffffff08";
    for (let x = 0; x < fw; x += stripe * 2) pitchCtx.fillRect(x, 0, stripe, fh);
    pitchCtx.strokeStyle = "#d4f7e5a8"; pitchCtx.lineWidth = 3;
    pitchCtx.strokeRect(34, 34, fw - 68, fh - 68);
    pitchCtx.beginPath(); pitchCtx.moveTo(fw / 2, 34); pitchCtx.lineTo(fw / 2, fh - 34); pitchCtx.stroke();
    pitchCtx.beginPath(); pitchCtx.arc(fw / 2, fh / 2, 92, 0, Math.PI * 2); pitchCtx.stroke();
    pitchCtx.beginPath(); pitchCtx.arc(fw / 2, fh / 2, 4, 0, Math.PI * 2); pitchCtx.fillStyle = "#d4f7e5"; pitchCtx.fill();
    const gh = 190, boxW = 135, boxH = 320;
    pitchCtx.strokeRect(34, fh / 2 - boxH / 2, boxW, boxH);
    pitchCtx.strokeRect(fw - 34 - boxW, fh / 2 - boxH / 2, boxW, boxH);
    pitchCtx.strokeRect(34, fh / 2 - gh / 2, 22, gh);
    pitchCtx.strokeRect(fw - 56, fh / 2 - gh / 2, 22, gh);
    pitchCtx.fillStyle = "#d4f7e522";
    pitchCtx.fillRect(0, fh / 2 - gh / 2, 18, gh);
    pitchCtx.fillRect(fw - 18, fh / 2 - gh / 2, 18, gh);
  }

  function drawMinimap(s, now) {
    if (!mctx || !s || now - lastMinimapDraw < 100) return;
    lastMinimapDraw = now;
    const w = minimap.width, h = minimap.height, fw = state.field.width || 1200, fh = state.field.height || 700;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = "rgba(255,255,255,.72)"; mctx.fillRect(0, 0, w, h);
    mctx.strokeStyle = "rgba(12,65,53,.65)"; mctx.lineWidth = 1; mctx.strokeRect(2, 2, w - 4, h - 4);
    mctx.beginPath(); mctx.moveTo(w / 2, 2); mctx.lineTo(w / 2, h - 2); mctx.stroke();
    const localId = state.training ? "practice-player" : state.id;
    for (const p of (s.players || [])) {
      mctx.fillStyle = p.team === "red" ? "#ff4059" : "#2878ef";
      mctx.beginPath(); mctx.arc(p.x / fw * w, p.y / fh * h, p.id === localId ? 3.5 : 2.7, 0, Math.PI * 2); mctx.fill();
    }
    if (s.ball) { mctx.fillStyle = "#111"; mctx.beginPath(); mctx.arc(s.ball.x / fw * w, s.ball.y / fh * h, 2, 0, Math.PI * 2); mctx.fill(); }
  }

  function stepPractice(dt, now) {
    const game = state.practice;
    if (!game) return;
    const p = game.player, b = game.ball, f = state.field;
    let ix = Number(state.input.x) || 0, iy = Number(state.input.y) || 0;
    const mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; }
    if (mag > .18) {
      const n = Math.hypot(ix, iy) || 1;
      state.facing.x = ix / n; state.facing.y = iy / n;
    }
    p.facing = { x: state.facing.x, y: state.facing.y };
    const sprinting = state.input.sprint && p.stamina > 0;
    const speed = sprinting ? 314.5 : 185;
    p.stamina = sprinting ? Math.max(0, p.stamina - 40.8 * dt) : Math.min(100, p.stamina + 18 * dt);
    if (now < game.tackleUntil) {
      p.vx = p.facing.x * 430; p.vy = p.facing.y * 430; p.tackling = true;
    } else {
      p.vx = ix * speed; p.vy = iy * speed; p.tackling = false;
    }
    p.x = Math.max(f.margin + p.radius, Math.min(f.width - f.margin - p.radius, p.x + p.vx * dt));
    p.y = Math.max(f.margin + p.radius, Math.min(f.height - f.margin - p.radius, p.y + p.vy * dt));

    if (b.ownerId === p.id) {
      const dirX = p.facing.x, dirY = p.facing.y;
      b.x = p.x + dirX * (p.radius + (b.r || 10) + 3);
      b.y = p.y + dirY * (p.radius + (b.r || 10) + 3);
      b.vx = p.vx * .45; b.vy = p.vy * .45;
    } else {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const friction = Math.pow(.985, dt * 60);
      b.vx *= friction; b.vy *= friction;
      if (Math.hypot(b.vx, b.vy) < 8) b.vx = b.vy = 0;
      const inGoal = Math.abs(b.y - f.height / 2) < f.goalHeight / 2;
      if (b.x >= f.width - f.margin - (b.r || 10) && inGoal && b.vx > 0) {
        game.score.red++;
        p.x = f.width * .25; p.y = f.height * .5; p.vx = p.vy = 0;
        b.x = p.x + 52; b.y = p.y; b.vx = b.vy = 0; b.ownerId = null;
        toast("VÀO LƯỚI! Bạn đã ghi bàn trong chế độ luyện tập.");
      } else if (b.x <= f.margin + (b.r || 10) && inGoal && b.vx < 0) {
        b.x = f.width * .25 + 52; b.y = f.height * .5; b.vx = b.vy = 0; b.ownerId = null;
      } else {
        if (b.x < f.margin + (b.r || 10) || b.x > f.width - f.margin - (b.r || 10)) b.vx *= -.82;
        if (b.y < f.margin + (b.r || 10) || b.y > f.height - f.margin - (b.r || 10)) b.vy *= -.82;
        b.x = Math.max(f.margin + (b.r || 10), Math.min(f.width - f.margin - (b.r || 10), b.x));
        b.y = Math.max(f.margin + (b.r || 10), Math.min(f.height - f.margin - (b.r || 10), b.y));
      }
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d <= p.radius + (b.r || 10) + 2) {
        if (Math.hypot(b.vx, b.vy) < 230 || state.input.control) {
          b.ownerId = p.id; b.vx = b.vy = 0;
        } else {
          const norm = d || 1;
          b.vx = Math.abs(b.vx) * (b.x - p.x) / norm + p.vx * .25;
          b.vy = Math.abs(b.vy) * (b.y - p.y) / norm + p.vy * .25;
        }
      }
    }
    state.snapshot = { type: "snapshot", remaining: 300, score: game.score, ball: b, players: [p] };
    if (now - game.lastHudAt > 200) {
      updateHud(state.snapshot);
      game.lastHudAt = now;
    }
  }

  function draw(frameTime) {
    requestAnimationFrame(draw);
    if ($("gameScreen").classList.contains("hidden")) { lastFrameTime = frameTime; return; }
    resizeCanvasForDevice();
    const now = performance.now();
    const dt = lastFrameTime ? Math.max(0, Math.min(.05, (frameTime - lastFrameTime) / 1000)) : 1 / 60;
    lastFrameTime = frameTime;
    if (state.training) stepPractice(dt, now);
    const s = state.snapshot;
    const vw = canvas.width, vh = canvas.height;
    const fw = state.field.width || 1200, fh = state.field.height || 700;
    ensurePitchCache(fw, fh);
    ctx.fillStyle = "#0a493b"; ctx.fillRect(0, 0, vw, vh);
    // The pitch is drawn once into a cache. Each frame only blits the cached field and moving entities.
    const localId = state.training ? "practice-player" : state.id;
    const me = s && s.players ? s.players.find(p => p.id === localId) : null;
    const zoom = Math.min(1.18, vw / 920, vh / 520);
    const worldViewW = vw / zoom, worldViewH = vh / zoom;
    let camX = me ? me.x : fw / 2, camY = me ? me.y : fh / 2;
    camX = worldViewW >= fw ? fw / 2 : Math.max(worldViewW / 2, Math.min(fw - worldViewW / 2, camX));
    camY = worldViewH >= fh ? fh / 2 : Math.max(worldViewH / 2, Math.min(fh - worldViewH / 2, camY));
    ctx.save();
    ctx.translate(vw / 2, vh / 2); ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);
    ctx.drawImage(pitchCache, 0, 0);
    if (s) {
      for (const p of s.players || []) {
        const color = p.team === "red" ? "#ff4d62" : "#448cff";
        // Flat, glow-free sprites avoid the expensive per-entity shadowBlur path on low-end phones.
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 17, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffffffcc"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 14px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.id === localId ? "★" : String(p.name || "?").slice(0, 1).toUpperCase(), p.x, p.y);
        ctx.fillStyle = "#e8f4ff"; ctx.font = "12px system-ui"; ctx.textBaseline = "bottom"; ctx.fillText(p.name || "", p.x, p.y - 23);
        ctx.fillStyle = "#07111c"; ctx.fillRect(p.x - 19, p.y + 22, 38, 4);
        ctx.fillStyle = "#39e6d0"; ctx.fillRect(p.x - 19, p.y + 22, 38 * Math.max(0, p.stamina || 0) / 100, 4);
        if (p.id === localId) {
          const fx = state.facing.x, fy = state.facing.y;
          ctx.strokeStyle = "#ffffff"; ctx.fillStyle = "#ffffff"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(p.x + fx * 10, p.y + fy * 10); ctx.lineTo(p.x + fx * 34, p.y + fy * 34); ctx.stroke();
          const a = Math.atan2(fy, fx), tipX = p.x + fx * 36, tipY = p.y + fy * 36;
          ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - 10 * Math.cos(a - .48), tipY - 10 * Math.sin(a - .48)); ctx.lineTo(tipX - 10 * Math.cos(a + .48), tipY - 10 * Math.sin(a + .48)); ctx.closePath(); ctx.fill();
        }
      }
      const b = s.ball;
      if (b) {
        ctx.fillStyle = "#f4f8ff"; ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#122433"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fillStyle = "#122433"; ctx.fill();
      }
      const meNow = (s.players || []).find(p => p.id === localId);
      if (!state.training && meNow && typeof meNow.tackleCooldown === "number" && meNow.tackleCooldown > 0) state.tackleReadyAt = performance.now() + meNow.tackleCooldown;
      drawMinimap(s, now);
    }
    ctx.restore();
  }
  requestAnimationFrame(draw);
  connect();
})();