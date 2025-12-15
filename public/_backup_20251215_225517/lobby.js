(() => {
  const $ = (id) => document.getElementById(id);

  const nameInput = $("nameInput");
  const setNameBtn = $("setNameBtn");

  const adminKey = $("adminKey");
  const adminBtn = $("adminBtn");
  const startBtn = $("startBtn");
  const goGameBtn = $("goGameBtn");

  const scoreLimit = $("scoreLimit");
  const selectAllBtn = $("selectAllBtn");
  const selectNoneBtn = $("selectNoneBtn");
  const savePacksBtn = $("savePacksBtn");
  const refreshBtn = $("refreshBtn");

  const statusEl = $("status");
  const packsEl = $("packs");

  let socket = io();
  let isAdmin = false;

  let packsMap = {};
  let active = new Set();

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.className = "status " + (ok === true ? "ok" : ok === false ? "bad" : "");
  }

  function renderPacks() {
    packsEl.innerHTML = "";
    Object.keys(packsMap).sort().forEach(k => {
      const div = document.createElement("div");
      div.className = "pack";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = active.has(k);
      cb.disabled = !isAdmin;

      cb.onchange = () => {
        if (cb.checked) active.add(k);
        else active.delete(k);
      };

      const info = document.createElement("div");
      const lab = document.createElement("label");
      lab.textContent = k;

      const meta = document.createElement("div");
      meta.className = "muted";
      meta.textContent = packsMap[k];

      info.appendChild(lab);
      info.appendChild(meta);

      div.appendChild(cb);
      div.appendChild(info);
      packsEl.appendChild(div);
    });
  }

  function setAdminUI(on) {
    isAdmin = !!on;
    startBtn.disabled = !isAdmin;
    scoreLimit.disabled = !isAdmin;
    selectAllBtn.disabled = !isAdmin;
    selectNoneBtn.disabled = !isAdmin;
    savePacksBtn.disabled = !isAdmin;
    refreshBtn.disabled = !isAdmin;
    renderPacks();
  }

  socket.on("connect", () => {
    setStatus("Connected. Set your name. Admin can unlock settings.", null);

    const savedName = localStorage.getItem("xyzzy_name") || "";
    if (savedName) nameInput.value = savedName;

    const savedToken = localStorage.getItem("xyzzy_token") || "";
    if (!savedToken) {
      const t = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("xyzzy_token", t);
    }
    socket.emit("player:hello", { token: localStorage.getItem("xyzzy_token") });
  });

  socket.on("admin:status", (s) => {
    setAdminUI(!!s?.isAdmin);
    setStatus(s?.isAdmin ? "Admin unlocked. Choose packs + settings." : "Not admin (wrong key).", !!s?.isAdmin);
    if (s?.isAdmin) socket.emit("admin:getPacks");
  });

  socket.on("packs:list", (p) => {
    packsMap = p?.packs || {};
    active = new Set(p?.active || []);
    renderPacks();
  });

  socket.on("packs:active", (p) => {
    active = new Set(p?.active || []);
    setStatus("Packs saved: " + [...active].join(", "), true);
    renderPacks();
  });

  socket.on("packs:error", (p) => setStatus(p?.message || "Pack error", false));

  socket.on("nav:goto", (p) => {
    if (p?.path) window.location.href = p.path;
  });

  setNameBtn.onclick = () => {
    const n = (nameInput.value || "").trim().slice(0, 20);
    if (!n) return;
    localStorage.setItem("xyzzy_name", n);
    socket.emit("player:setName", n);
    setStatus("Name set: " + n, true);
  };

  adminBtn.onclick = () => {
    socket.emit("admin:hello", { token: adminKey.value || "" });
  };

  refreshBtn.onclick = () => socket.emit("admin:getPacks");

  savePacksBtn.onclick = () => socket.emit("admin:setPacks", { packs: [...active] });

  selectAllBtn.onclick = () => {
    active = new Set(Object.keys(packsMap));
    renderPacks();
    setStatus("Selected all (click Save packs).", true);
  };

  selectNoneBtn.onclick = () => {
    active.clear();
    renderPacks();
    setStatus("Selected none (core will be forced on save).", true);
  };

  scoreLimit.onchange = () => {
    const v = Number(scoreLimit.value || 0);
    socket.emit("admin:setScoreLimit", { scoreLimit: v });
    setStatus(v ? `Score to win: ${v}` : "Score limit disabled.", true);
  };

  startBtn.onclick = () => {
    // start round on server and send everyone to /game.html
    socket.emit("game:start");
    socket.emit("admin:gotoGame");
  };

  goGameBtn.onclick = () => {
    window.location.href = "/game.html";
  };

  adminKey.value = "kmadmin";
})();
