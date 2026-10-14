(() => {
  const $ = id => document.getElementById(id);
  const screens = ["menuScreen", "lobbyScreen", "gameScreen", "resultScreen"];
  const state = {
    ws: null, connected: false, id: null, name: "", room: null, rooms: [],
    ready: false, isHost: false,
    // Đồng bộ chuẩn xác theo FIELD trên server.js
    field: { width: 2400, height: 1400, goalHeight: 190, margin: 50 },
    snapshot: null, countdown: null, kickHeld: false, kickStart: 0, kickChargeFrame: 0,
    input: { x: 0, y: 0, sprint: false, kick: false, kickPower: 0, control: false, tackle: false },
    facing: { x: 1, y: 0 }, tackleReadyAt: 0,
    joystickPointer: null, toastTimer: null, reconnectTimer: null, reconnectDelay: 1000, pendingMessages: []
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
    if (type !== "input" && type !== "ready" && type !== "start" && type !== "leaveRoom" && type !== "playAgain") {
      state.pendingMessages.push(payload);
      if (state.pendingMessages.length > 20) state.pendingMessages.shift();
    }
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
    catch (err) { $("connectionText").textContent = "KHÔNG KẾT NỐI ĐƯỢC"; scheduleReconnect(); return; }

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
        if (msg.field) state.field = msg.field;
        state.snapshot = null;
        $("countdownOverlay").classList.add("hidden");
        showScreen("gameScreen");
        break;
      case "snapshot":
        state.snapshot = msg;
        {
          const me = (msg.players || []).find(p => p.id === state.id);
          if (me && me.facing && Math.hypot(me.facing.x, me.facing.y) > 0.1) {
            state.facing = { x: me.facing.x, y: me.facing.y };
          }
        }
        updateHud(msg);
        break;
      case "gameOver":
        $("finalRed").textContent = msg.score.red;
        $("finalBlue").textContent = msg.score.blue;
        renderStats(msg.stats || []);
        $("countdownOverlay").classList.add("hidden");
        showScreen("resultScreen");
        break;
      case "notice": toast(msg.message); break;
      case "error": toast(msg.message); break;
      case "leftRoom":
        state.room = null; state.ready = false; state.isHost = false; showScreen("menuScreen"); break;
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

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

  // ==========================================
  // XỬ LÝ JOYSTICK ĐÃ ĐƯỢC FIX TOẠ ĐỘ XOAY 90°
  // ==========================================
  const joy = $("joystick"), knob = $("joystickKnob");
  function joystickMove(clientX, clientY) {
    const r = joy.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const screenDx = clientX - cx;
    const screenDy = clientY - cy;

    // Kiểm tra xem màn hình có đang bị xoay 90 độ bởi CSS fallback portrait hay không
    const isPortraitRotated = window.innerWidth <= 768 && window.innerHeight > window.innerWidth;

    let localDx, localDy;
    if (isPortraitRotated) {
      // Khi container xoay 90deg theo chiều kim đồng hồ:
      // X của container tương ứng với Y của màn hình
      // Y của container tương ứng với -X của màn hình
      localDx = screenDy;
      localDy = -screenDx;
    } else {
      localDx = screenDx;
      localDy = screenDy;
    }

    const max = r.width * 0.36;
    const len = Math.hypot(localDx, localDy);
    let clampedX = localDx, clampedY = localDy;
    if (len > max) {
      clampedX = (localDx / len) * max;
      clampedY = (localDy / len) * max;
    }

    // Nút kéo sẽ di chuyển chính xác theo ngón tay trên màn hình
    knob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    state.input.x = clampedX / max;
    state.input.y = clampedY / max;

    if (Math.hypot(state.input.x, state.input.y) > 0.18) {
      const n = Math.hypot(state.input.x, state.input.y);
      state.facing.x = state.input.x / n;
      state.facing.y = state.input.y / n;
    }
  }

  function resetJoystick() {
    state.joystickPointer = null;
    state.input.x = 0;
    state.input.y = 0;
    knob.style.transform = "translate(0, 0)";
  }

  joy.addEventListener("pointerdown", e => {
    e.preventDefault();
    state.joystickPointer = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    joystickMove(e.clientX, e.clientY);
  });
  joy.addEventListener("pointermove", e => {
    if (state.joystickPointer === e.pointerId) {
      e.preventDefault();
      joystickMove(e.clientX, e.clientY);
    }
  });
  joy.addEventListener("pointerup", e => { if (state.joystickPointer === e.pointerId) resetJoystick(); });
  joy.addEventListener("pointercancel", resetJoystick);

  // ==========================================
  // XỬ LÝ CÁC NÚT BẤM THAO TÁC
  // ==========================================
  function holdButton(id, onDown, onUp) {
    const el = $(id);
    if (!el) return;
    const down = e => { e.preventDefault(); el.classList.add("pressed"); onDown(); };
    const up = e => { e.preventDefault(); el.classList.remove("pressed"); onUp(); };
    el.addEventListener("pointerdown", down);
    ["pointerup", "pointercancel", "pointerleave"].forEach(ev => el.addEventListener(ev, e => {
      if (el.classList.contains("pressed")) up(e);
    }));
  }

  holdButton("sprintBtn", () => state.input.sprint = true, () => state.input.sprint = false);
  holdButton("controlBtn", () => state.input.control = true, () => state.input.control = false);
  holdButton("tackleBtn", () => {
    const now = performance.now();
    if (now < state.tackleReadyAt) {
      toast(`Xoạc bóng hồi chiêu ${Math.ceil((state.tackleReadyAt - now) / 1000)}s`);
      return;
    }
    state.tackleReadyAt = now + 2000;
    state.input.tackle = true;
    send("input", { input: { ...state.input, tackle: true, facing: { ...state.facing } } });
    setTimeout(() => { state.input.tackle = false; }, 120);
  }, () => {});

  function updateKickCharge() {
    const fill = $("kickChargeFill");
    if (fill) {
      const power = state.kickHeld ? Math.min(1, 0.15 + (performance.now() - state.kickStart) / 1400) : 0;
      fill.style.width = `${power * 100}%`;
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
    const power = Math.max(0.15, Math.min(1, 0.15 + heldMs / 1400));
    state.input.kickPower = power; state.kickHeld = false; state.input.kick = false;
    cancelAnimationFrame(state.kickChargeFrame);
    const fill = $("kickChargeFill"); if (fill) fill.style.width = "0%";
    send("input", { input: { ...state.input, facing: { ...state.facing }, x: state.facing.x, y: state.facing.y, kick: true, kickPower: power } });
    setTimeout(() => { state.input.kickPower = 0; }, 80);
  });

  // Bàn phím máy tính
  window.addEventListener("keydown", e => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") state.input.y = -1;
    if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") state.input.y = 1;
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") state.input.x = -1;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") state.input.x = 1;
    if (Math.hypot(state.input.x, state.input.y) > 0.18) {
      const n = Math.hypot(state.input.x, state.input.y);
      state.facing = { x: state.input.x / n, y: state.input.y / n };
    }
    if (e.key === "Shift") state.input.sprint = true;
    if (e.key.toLowerCase() === "e") state.input.control = true;
    if (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "f") {
      const now = performance.now();
      if (now >= state.tackleReadyAt) {
        state.tackleReadyAt = now + 2000;
        send("input", { input: { ...state.input, tackle: true, facing: { ...state.facing } } });
      }
    }
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
      state.input.kickPower = Math.max(0.15, Math.min(1, 0.15 + (performance.now() - state.kickStart) / 1400));
      send("input", { input: { ...state.input, facing: { ...state.facing }, x: state.facing.x, y: state.facing.y, kick: true } });
      state.kickHeld = false; state.input.kickPower = 0;
    }
  });

  setInterval(() => {
    if (state.room && state.room.status === "playing") {
      send("input", { input: { ...state.input, facing: { ...state.facing }, kick: false, kickPower: state.input.kickPower } });
    }
  }, 1000 / 30);

  // ==========================================
  // RENDER SÂN CỎ VÀ CẦU THỦ (LUÔN CĂN GIỮA)
  // ==========================================
  const canvas = $("gameCanvas"), ctx = canvas.getContext("2d");
  const minimap = $("minimapCanvas"), mctx = minimap ? minimap.getContext("2d") : null;

  function drawMinimap(s) {
    if (!mctx || !s) return;
    const w = minimap.width, h = minimap.height;
    const fw = state.field.width || 2400, fh = state.field.height || 1400;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = "rgba(7, 35, 27, 0.78)";
    mctx.fillRect(0, 0, w, h);
    mctx.strokeStyle = "rgba(212, 247, 229, 0.55)";
    mctx.lineWidth = 1;
    mctx.strokeRect(2, 2, w - 4, h - 4);
    mctx.beginPath();
    mctx.moveTo(w / 2, 2);
    mctx.lineTo(w / 2, h - 2);
    mctx.stroke();

    for (const p of (s.players || [])) {
      mctx.fillStyle = p.team === "red" ? "#ff4059" : "#2878ef";
      mctx.beginPath();
      mctx.arc((p.x / fw) * w, (p.y / fh) * h, p.id === state.id ? 3.5 : 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
    if (s.ball) {
      mctx.fillStyle = "#fff";
      mctx.beginPath();
      mctx.arc((s.ball.x / fw) * w, (s.ball.y / fh) * h, 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  function draw() {
    const s = state.snapshot;
    // Tự động căn chỉnh độ phân giải canvas thật theo pixel màn hình
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const dw = Math.round(rect.width * dpr);
      const dh = Math.round(rect.height * dpr);
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw;
        canvas.height = dh;
      }
    }

    const vw = canvas.width, vh = canvas.height;
    ctx.clearRect(0, 0, vw, vh);

    const fw = state.field.width || 2400, fh = state.field.height || 1400;
    const me = s && s.players ? s.players.find(p => p.id === state.id) : null;

    // CAMERA: Cầu thủ người chơi LUÔN nằm ngay chính giữa màn hình (vw/2, vh/2)
    const camX = me ? me.x : fw / 2;
    const camY = me ? me.y : fh / 2;
    const zoom = Math.min(vw / 1100, vh / 680);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    // Vẽ nền cỏ bao bọc xung quanh sân (đảm bảo không bao giờ bị cắt cụt hay hở viền đen)
    ctx.fillStyle = "#074837";
    ctx.fillRect(-1000, -1000, fw + 2000, fh + 2000);

    // Mặt cỏ chính
    ctx.fillStyle = "#0a493b";
    ctx.fillRect(0, 0, fw, fh);

    // Sọc cỏ xen kẽ
    const stripe = 90;
    for (let x = 0; x < fw; x += stripe * 2) {
      ctx.fillStyle = "#ffffff09";
      ctx.fillRect(x, 0, stripe, fh);
    }

    // Vạch biên (margin = 50)
    const m = state.field.margin || 50;
    ctx.strokeStyle = "#d4f7e5b5";
    ctx.lineWidth = 4;
    ctx.strokeRect(m, m, fw - m * 2, fh - m * 2);

    // Đường giữa sân và vòng tròn trung tâm
    ctx.beginPath();
    ctx.moveTo(fw / 2, m);
    ctx.lineTo(fw / 2, fh - m);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(fw / 2, fh / 2, 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fw / 2, fh / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#d4f7e5";
    ctx.fill();

    // Vòng cấm và khung thành 2 bên
    const gh = state.field.goalHeight || 190;
    const boxW = 180, boxH = 400;
    ctx.strokeRect(m, fh / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(fw - m - boxW, fh / 2 - boxH / 2, boxW, boxH);

    // Lưới khung thành
    ctx.fillStyle = "#d4f7e522";
    ctx.fillRect(m - 35, fh / 2 - gh / 2, 35, gh);
    ctx.strokeRect(m - 35, fh / 2 - gh / 2, 35, gh);
    ctx.fillRect(fw - m, fh / 2 - gh / 2, 35, gh);
    ctx.strokeRect(fw - m, fh / 2 - gh / 2, 35, gh);

    // Vẽ Cầu thủ và Bóng
    if (s) {
      s.players.forEach(p => {
        const color = p.team === "red" ? "#ff4d62" : "#448cff";
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#ffffffdd";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px Inter";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.id === state.id ? "★" : p.name.slice(0, 1).toUpperCase(), p.x, p.y);

        ctx.fillStyle = "#e8f4ff";
        ctx.font = "12px Inter";
        ctx.textBaseline = "bottom";
        ctx.fillText(p.name, p.x, p.y - 23);

        // Thanh thể lực
        ctx.fillStyle = "#07111c";
        ctx.fillRect(p.x - 19, p.y + 22, 38, 4);
        ctx.fillStyle = "#39e6d0";
        ctx.fillRect(p.x - 19, p.y + 22, (38 * Math.max(0, p.stamina || 0)) / 100, 4);

        // Mũi tên định hướng cho chính người chơi
        if (p.id === state.id) {
          const fx = state.facing.x, fy = state.facing.y;
          ctx.strokeStyle = "#ffffff";
          ctx.fillStyle = "#ffffff";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(p.x + fx * 10, p.y + fy * 10);
          ctx.lineTo(p.x + fx * 34, p.y + fy * 34);
          ctx.stroke();
          const a = Math.atan2(fy, fx), tipX = p.x + fx * 36, tipY = p.y + fy * 36;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - 10 * Math.cos(a - 0.48), tipY - 10 * Math.sin(a - 0.48));
          ctx.lineTo(tipX - 10 * Math.cos(a + 0.48), tipY - 10 * Math.sin(a + 0.48));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      });

      // Quả bóng
      const b = s.ball;
      ctx.save();
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#f4f8ff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#122433";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#122433";
      ctx.fill();
      ctx.restore();

      const meNow = s.players.find(p => p.id === state.id);
      if (meNow && typeof meNow.tackleCooldown === "number" && meNow.tackleCooldown > 0) {
        state.tackleReadyAt = performance.now() + meNow.tackleCooldown;
      }
      drawMinimap(s);
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
  connect();
})();