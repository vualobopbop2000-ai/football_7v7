(() => {
  const $ = id => document.getElementById(id);
  const screens = ["menuScreen", "lobbyScreen", "gameScreen", "resultScreen"];
  const state = {
    ws: null, connected: false, id: null, name: "", room: null, rooms: [],
    ready: false, isHost: false, field: { width: 1200, height: 700, goalHeight: 190, margin: 34 },
    snapshot: null, countdown: null, kickHeld: false, kickStart: 0,
    input: { x: 0, y: 0, sprint: false, kick: false, kickPower: 0, control: false },
    joystickPointer: null, joystickOrigin: null, toastTimer: null
  };
  function showScreen(id) { screens.forEach(s => $(s).classList.toggle("hidden", s !== id)); }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.remove("hidden");
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
  }
  function send(type, extra = {}) {
    if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type, ...extra }));
    else toast("Chưa kết nối được máy chủ.");
  }
  function connect() {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    state.ws = new WebSocket(`${scheme}//${location.host}`);
    state.ws.addEventListener("open", () => {
      state.connected = true; $("connectionDot").classList.add("online"); $("connectionText").textContent = "ĐÃ KẾT NỐI";
      send("setName", { name: $("playerName").value.trim() });
    });
    state.ws.addEventListener("close", () => {
      state.connected = false; $("connectionDot").classList.remove("online"); $("connectionText").textContent = "MẤT KẾT NỐI";
      toast("Mất kết nối máy chủ. Tải lại trang để kết nối lại.");
    });
    state.ws.addEventListener("error", () => { $("connectionText").textContent = "LỖI KẾT NỐI"; });
    state.ws.addEventListener("message", ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      handleMessage(msg);
    });
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
        state.snapshot = msg; updateHud(msg); break;
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
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    state.input.x = dx / max; state.input.y = dy / max;
  }
  function resetJoystick() {
    state.joystickPointer = null; state.input.x = 0; state.input.y = 0; knob.style.transform = "translate(0,0)";
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
  holdButton("kickBtn", () => { state.kickHeld = true; state.kickStart = performance.now(); state.input.kick = true; }, () => {
    state.input.kickPower = Math.min(1, .2 + (performance.now() - state.kickStart) / 900);
    state.input.kick = false; state.kickHeld = false;
    send("input", { input: { ...state.input, kick: true } });
    setTimeout(() => { state.input.kickPower = 0; }, 50);
  });
  window.addEventListener("keydown", e => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") state.input.y = -1;
    if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") state.input.y = 1;
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") state.input.x = -1;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") state.input.x = 1;
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
      state.input.kickPower = Math.min(1, .2 + (performance.now() - state.kickStart) / 900);
      send("input", { input: { ...state.input, kick: true } });
      state.kickHeld = false; state.input.kickPower = 0;
    }
  });

  // Send latest input at 30 Hz; server simulates at 60 Hz.
  setInterval(() => {
    if (state.room && state.room.status === "playing") {
      send("input", { input: { ...state.input, kick: false, kickPower: state.input.kickPower } });
    }
  }, 1000 / 30);

  const canvas = $("gameCanvas"), ctx = canvas.getContext("2d");
  function drawField() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0a493b"; ctx.fillRect(0, 0, w, h);
    const stripe = 75;
    for (let x = 0; x < w; x += stripe * 2) { ctx.fillStyle = "#ffffff08"; ctx.fillRect(x, 0, stripe, h); }
    ctx.strokeStyle = "#d4f7e5a8"; ctx.lineWidth = 3;
    ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.beginPath(); ctx.moveTo(w / 2, 34); ctx.lineTo(w / 2, h - 34); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 92, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2); ctx.fillStyle = "#d4f7e5"; ctx.fill();
    const gh = 190, boxW = 135, boxH = 320;
    ctx.strokeRect(34, h / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(w - 34 - boxW, h / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(34, h / 2 - gh / 2, 22, gh);
    ctx.strokeRect(w - 56, h / 2 - gh / 2, 22, gh);
    ctx.fillStyle = "#d4f7e522";
    ctx.fillRect(0, h / 2 - gh / 2, 18, gh);
    ctx.fillRect(w - 18, h / 2 - gh / 2, 18, gh);
  }
  function draw() {
    drawField();
    const s = state.snapshot;
    if (s) {
      s.players.forEach(p => {
        const color = p.team === "red" ? "#ff4d62" : "#448cff";
        ctx.save();
        ctx.shadowColor = color; ctx.shadowBlur = 13;
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 17, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = "#ffffffcc"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 14px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.id === state.id ? "★" : p.name.slice(0, 1).toUpperCase(), p.x, p.y);
        ctx.fillStyle = "#e8f4ff"; ctx.font = "12px Inter"; ctx.textBaseline = "bottom";
        ctx.fillText(p.name, p.x, p.y - 23);
        ctx.fillStyle = "#07111c"; ctx.fillRect(p.x - 19, p.y + 22, 38, 4);
        ctx.fillStyle = "#39e6d0"; ctx.fillRect(p.x - 19, p.y + 22, 38 * p.stamina / 100, 4);
        ctx.restore();
      });
      const b = s.ball;
      ctx.save(); ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; ctx.fillStyle = "#f4f8ff";
      ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = "#122433"; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fillStyle = "#122433"; ctx.fill(); ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  connect();
})();