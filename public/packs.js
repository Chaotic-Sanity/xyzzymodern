"use strict";

const socket = io();

function qs(id){ return document.getElementById(id); }

const els = {
  adminKeyInput: qs("adminKeyInput"),
  scoreLimitInput: qs("scoreLimitInput"),
  packsList: qs("packsList"),
  saveBtn: qs("saveBtn"),
  selectAllBtn: qs("selectAllBtn"),
  selectNoneBtn: qs("selectNoneBtn"),
  saveHint: qs("saveHint"),
  botsEnabled: qs("botsEnabled"),
  botsCount: qs("botsCount")
};

const state = {
  packs: [],
  enabledPacks: [],
  isAdmin: false,
  bots: { enabled: false, count: 0 }
};

function loadSaved(){
  els.adminKeyInput.value = localStorage.getItem("xm_admin_key") || "";
}

function saveAdminKey(){
  localStorage.setItem("xm_admin_key", (els.adminKeyInput.value || "").trim().slice(0,64));
}

function renderPacks(){
  els.packsList.innerHTML = "";

  const enabled = new Set(state.enabledPacks || []);

  for (const p of state.packs) {
    const row = document.createElement("div");
    row.className = "packRow";

    const left = document.createElement("div");
    left.className = "packLeft";

    const name = document.createElement("div");
    name.className = "packName";
    name.textContent = p.name;

    const meta = document.createElement("div");
    meta.className = "packMeta";
    meta.textContent = `id=${p.id}  black=${p.blackCount}  white=${p.whiteCount}`;

    left.appendChild(name);
    left.appendChild(meta);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "packToggle";
    toggle.checked = enabled.has(p.id);

    toggle.addEventListener("change", () => {
      const set = new Set(state.enabledPacks || []);
      if (toggle.checked) set.add(p.id);
      else set.delete(p.id);
      state.enabledPacks = Array.from(set);
    });

    row.appendChild(left);
    row.appendChild(toggle);
    els.packsList.appendChild(row);
  }
}

function setHint(text, bad){
  els.saveHint.textContent = text;
  els.saveHint.style.color = bad ? "rgba(255,70,70,0.90)" : "rgba(233,236,255,0.62)";
}

function sendIdentityAdminOnly(){
  const playerId = localStorage.getItem("xm_player_id") || ("p_" + Math.random().toString(16).slice(2));
  localStorage.setItem("xm_player_id", playerId);

  const name = (localStorage.getItem("xm_name") || "Admin").trim().slice(0,24);
  const adminKey = (localStorage.getItem("xm_admin_key") || "").trim().slice(0,64);

  socket.emit("set_identity", { playerId, name, adminKey });
}

function readBotsUI(){
  const enabled = !!els.botsEnabled.checked;
  let count = Number(els.botsCount.value || 0);
  if (!Number.isFinite(count)) count = 0;
  count = Math.max(0, Math.min(12, Math.floor(count)));
  return { enabled, count };
}

function applyBotsUI(bots){
  const enabled = !!bots?.enabled;
  const count = Number(bots?.count || 0);
  els.botsEnabled.checked = enabled;
  els.botsCount.value = String(Math.max(0, Math.min(12, Math.floor(count))));
}

socket.on("packs_list", ({ packs }) => {
  state.packs = packs || [];
  renderPacks();
});

socket.on("settings", ({ settings, bots }) => {
  state.bots = bots || state.bots;
  applyBotsUI(state.bots);

  state.enabledPacks = Array.isArray(settings.enabledPacks) ? settings.enabledPacks : [];
  els.scoreLimitInput.value = settings.scoreLimit || 7;

  if (!state.enabledPacks || state.enabledPacks.length === 0) {
    state.enabledPacks = (state.packs || []).map(p => p.id);
  }
  renderPacks();
});

socket.on("admin_status", ({ isAdmin }) => {
  state.isAdmin = !!isAdmin;
  if (!state.isAdmin) setHint("Not admin. Enter key and save settings.", true);
  else setHint("Admin confirmed. You can save settings.", false);
});

socket.on("error_msg", ({ msg }) => {
  setHint(msg || "Error", true);
});

els.saveBtn.addEventListener("click", () => {
  saveAdminKey();
  sendIdentityAdminOnly();

  const scoreLimit = Number(els.scoreLimitInput.value || 7);
  const bots = readBotsUI();

  socket.emit("admin_set_settings", {
    enabledPacks: state.enabledPacks || [],
    scoreLimit: scoreLimit
  });

  socket.emit("admin_set_bots", {
    enabled: bots.enabled,
    count: bots.count
  });

  setHint("Saving…", false);
});

els.selectAllBtn.addEventListener("click", () => {
  state.enabledPacks = (state.packs || []).map(p => p.id);
  renderPacks();
});

els.selectNoneBtn.addEventListener("click", () => {
  state.enabledPacks = [];
  renderPacks();
});

socket.on("connect", () => {
  loadSaved();
  sendIdentityAdminOnly();
  socket.emit("request_state");
});