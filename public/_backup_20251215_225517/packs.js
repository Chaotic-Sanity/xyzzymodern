(() => {
  const $ = (id) => document.getElementById(id);

  const adminKeyEl = $("adminKey");
  const connectBtn = $("connectBtn");
  const refreshBtn = $("refreshBtn");
  const saveBtn = $("saveBtn");
  const selectAllBtn = $("selectAllBtn");
  const selectNoneBtn = $("selectNoneBtn");
  const scoreLimitEl = $("scoreLimit");
  const statusEl = $("status");
  const packsEl = $("packs");

  let socket = null;
  let packsMap = {};
  let active = new Set();

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.className = "status " + (ok === true ? "ok" : ok === false ? "bad" : "");
  }

  function render() {
    packsEl.innerHTML = "";
    Object.keys(packsMap).sort().forEach(k => {
      const div = document.createElement("div");
      div.className = "pack";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = active.has(k);

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

  function connect() {
    if (socket) socket.disconnect();
    socket = io();

    setStatus("Connecting...", null);

    socket.on("connect", () => {
      const tok = adminKeyEl.value || "";
      socket.emit("admin:hello", { token: tok });
      socket.emit("admin:getPacks");

      refreshBtn.disabled = false;
      saveBtn.disabled = false;
      selectAllBtn.disabled = false;
      selectNoneBtn.disabled = false;
      scoreLimitEl.disabled = false;
    });

    socket.on("admin:status", s => {
      setStatus(
        s?.isAdmin ? "Admin unlocked. Pick packs + score target." : "Wrong admin key.",
        !!s?.isAdmin
      );
    });

    socket.on("packs:list", p => {
      packsMap = p?.packs || {};
      active = new Set(p?.active || []);
      render();
    });

    socket.on("packs:active", p => {
      active = new Set(p?.active || []);
      setStatus("Packs saved: " + [...active].join(", "), true);
      render();
    });

    socket.on("packs:error", p => {
      setStatus(p?.message || "Pack error", false);
    });

    socket.on("disconnect", () => {
      setStatus("Disconnected.", false);
    });
  }

  connectBtn.onclick = connect;
  refreshBtn.onclick = () => socket && socket.emit("admin:getPacks");
  saveBtn.onclick = () => socket && socket.emit("admin:setPacks", { packs: [...active] });

  selectAllBtn.onclick = () => {
    active = new Set(Object.keys(packsMap));
    render();
    setStatus("All packs selected (not saved yet).", true);
  };

  selectNoneBtn.onclick = () => {
    active.clear();
    render();
    setStatus("No packs selected (core will be forced on save).", true);
  };

  scoreLimitEl.onchange = () => {
    if (!socket) return;
    const val = Number(scoreLimitEl.value || 0);
    socket.emit("admin:setScoreLimit", { scoreLimit: val });
    setStatus(val ? `Score to win set to ${val}.` : "Score limit disabled.", true);
  };

  adminKeyEl.value = "kmadmin";
})();
