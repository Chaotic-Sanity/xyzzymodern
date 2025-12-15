"use strict";

const socket = io();

function qs(id){ return document.getElementById(id); }

const el = {
  phaseLabel: qs("phaseLabel"),
  timerPill: qs("timerPill"),
  roundMeta: qs("roundMeta"),

  playersMeta: qs("playersMeta"),
  playersList: qs("playersList"),
  adminBox: qs("adminBox"),
  adminHint: qs("adminHint"),

  btnStart: qs("btnStart"),
  btnNext: qs("btnNext"),
  btnPause: qs("btnPause"),
  btnReset: qs("btnReset"),
  btnClearChat: qs("btnClearChat"),

  blackCard: qs("blackCard"),
  submissionsWrap: qs("submissionsWrap"),
  submissionsList: qs("submissionsList"),
  subMeta: qs("subMeta"),

  handList: qs("handList"),
  handMeta: qs("handMeta"),

  chatLog: qs("chatLog"),
  chatInput: qs("chatInput"),
  chatSendBtn: qs("chatSendBtn"),

  nameInput: qs("nameInput"),
  adminKeyInput: qs("adminKeyInput"),
  saveIdentityBtn: qs("saveIdentityBtn"),
  identityHint: qs("identityHint")
};

const state = {
  phase: "lobby",
  roundNum: 0,
  judgeId: null,
  currentBlack: null,
  leaders: [],
  players: [],
  submissionsCount: 0,
  isAdmin: false,
  myId: null,
  myName: "",
  myHand: [],
  submissionsList: [],
  bots: { enabled:false, count:0 },
  timerEndTs: 0
};

function safeStr(v, max=64){
  return String(v ?? "").trim().replace(/\s+/g," ").slice(0,max);
}

function fmtTimeLeft(endTs){
  if (!endTs) return "--:--";
  const ms = endTs - Date.now();
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2,"0") + ":" + String(r).padStart(2,"0");
}

function setPhaseLabel(){
  const p = state.phase;
  let label = p;
  if (p === "play") label = "Play";
  if (p === "judge") label = "Judging";
  if (p === "results") label = "Results";
  if (p === "lobby") label = "Lobby";
  if (p === "paused") label = "Paused";
  if (p === "finished") label = "Finished";
  if (el.phaseLabel) el.phaseLabel.textContent = label;
}

function setRoundMeta(){
  if (el.roundMeta) el.roundMeta.textContent = "Round " + (state.roundNum || 0);
}

function setTimerPill(){
  if (!el.timerPill) return;
  el.timerPill.textContent = fmtTimeLeft(state.timerEndTs);
}

function renderBlackCard(){
  if (!el.blackCard) return;
  el.blackCard.textContent = state.currentBlack?.text ? state.currentBlack.text : "Waiting for round…";
}

function clearNode(n){
  if (!n) return;
  while (n.firstChild) n.removeChild(n.firstChild);
}

function badge(text, cls){
  const b = document.createElement("span");
  b.className = "badge" + (cls ? (" " + cls) : "");
  b.textContent = text;
  return b;
}

function renderPlayers(){
  if (!el.playersList) return;
  clearNode(el.playersList);

  const players = state.players || [];
  if (el.playersMeta) el.playersMeta.textContent = String(players.length);

  const leaders = new Set(state.leaders || []);
  const judgeId = state.judgeId;

  for (const p of players) {
    const row = document.createElement("div");
    row.className = "playerRow";

    const left = document.createElement("div");
    left.className = "playerLeft";

    const name = document.createElement("div");
    name.className = "playerName";
    name.textContent = p.name || "Player";

    const badges = document.createElement("div");
    badges.className = "playerBadges";

    // CZAR badge = current judge
    if (judgeId && p.id === judgeId) {
      badges.appendChild(badge("CZAR", "czar"));
    }

    // crown = leader(s)
    if (leaders.has(p.id)) {
      badges.appendChild(badge("👑 LEAD", "crown"));
    }

    if (p.isBot) badges.appendChild(badge("BOT", "bot"));
    if (p.connected === false) badges.appendChild(badge("OFF", ""));

    left.appendChild(name);
    left.appendChild(badges);

    const score = document.createElement("div");
    score.className = "playerScore";
    score.textContent = String(p.score ?? 0);

    row.appendChild(left);
    row.appendChild(score);

    el.playersList.appendChild(row);
  }
}

function renderHand(){
  if (!el.handList) return;
  clearNode(el.handList);

  const hand = state.myHand || [];
  if (el.handMeta) el.handMeta.textContent = String(hand.length);

  const isJudge = state.myId && state.judgeId && state.myId === state.judgeId;
  const canPlay = state.phase === "play" && !isJudge;

  for (const txt of hand) {
    const c = document.createElement("div");
    c.className = "cardWhite" + (canPlay ? "" : " disabled");
    c.textContent = txt;

    c.addEventListener("click", () => {
      if (!canPlay) return;
      socket.emit("submit_card", { text: txt });
    });

    el.handList.appendChild(c);
  }
}

function renderSubmissions(){
  if (!el.submissionsWrap || !el.submissionsList) return;

  const show = state.phase === "judge";
  el.submissionsWrap.style.display = show ? "" : "none";
  if (!show) return;

  const list = state.submissionsList || [];
  if (el.subMeta) el.subMeta.textContent = String(list.length);

  clearNode(el.submissionsList);

  const isJudge = state.myId && state.judgeId && state.myId === state.judgeId;

  for (const s of list) {
    const d = document.createElement("div");
    d.className = "subCard" + (isJudge ? "" : " disabled");
    d.textContent = s.text;

    d.addEventListener("click", () => {
      if (!isJudge) return;
      socket.emit("judge_pick", { winnerId: s.id });
    });

    el.submissionsList.appendChild(d);
  }
}

function addChatLine(entry){
  if (!el.chatLog) return;

  const line = document.createElement("div");
  line.className = "chatLine";

  if (entry.type === "system") {
    line.className += " chatSys";
    line.textContent = entry.text || "";
  } else {
    const name = document.createElement("span");
    name.className = "chatName";
    name.textContent = (entry.name || "??") + ": ";

    const text = document.createElement("span");
    text.className = "chatText";
    text.textContent = entry.text || "";

    line.appendChild(name);
    line.appendChild(text);
  }

  el.chatLog.appendChild(line);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function setAdminUI(){
  const show = state.isAdmin === true && !!el.adminBox;
  if (el.adminBox) el.adminBox.style.display = show ? "" : "none";

  if (el.adminHint && show) {
    const botTxt = state.bots?.enabled ? ("Bots ON (" + state.bots.count + ")") : "Bots OFF";
    el.adminHint.textContent = "Admin controls. " + botTxt + ".";
  }
}

function loadIdentityFromStorage(){
  const pid = localStorage.getItem("xm_player_id");
  if (!pid) {
    const newId = "p_" + Math.random().toString(16).slice(2) + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem("xm_player_id", newId);
  }

  state.myId = localStorage.getItem("xm_player_id");
  state.myName = localStorage.getItem("xm_name") || "";
  const key = localStorage.getItem("xm_admin_key") || "";

  if (el.nameInput) el.nameInput.value = state.myName;
  if (el.adminKeyInput) el.adminKeyInput.value = key;
}

function saveIdentityToStorage(){
  const nm = safeStr(el.nameInput ? el.nameInput.value : "", 24);
  const key = safeStr(el.adminKeyInput ? el.adminKeyInput.value : "", 64);
  localStorage.setItem("xm_name", nm);
  localStorage.setItem("xm_admin_key", key);
  state.myName = nm;
}

function sendIdentity(){
  const playerId = localStorage.getItem("xm_player_id");
  const name = localStorage.getItem("xm_name") || "Player";
  const adminKey = localStorage.getItem("xm_admin_key") || "";
  socket.emit("set_identity", { playerId, name, adminKey });
}

function wireUI(){
  if (el.chatSendBtn) {
    el.chatSendBtn.addEventListener("click", () => {
      const t = safeStr(el.chatInput ? el.chatInput.value : "", 220);
      if (!t) return;
      socket.emit("chat_send", { text: t });
      if (el.chatInput) el.chatInput.value = "";
    });
  }

  if (el.chatInput) {
    el.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (el.chatSendBtn) el.chatSendBtn.click();
      }
    });
  }

  if (el.saveIdentityBtn) {
    el.saveIdentityBtn.addEventListener("click", () => {
      saveIdentityToStorage();
      sendIdentity();
      if (el.identityHint) el.identityHint.textContent = "Saved. CZAR badge shows the judge.";
    });
  }

  // Admin controls (only visible when admin confirmed)
  if (el.btnStart) el.btnStart.addEventListener("click", () => socket.emit("admin_start_game"));
  if (el.btnNext) el.btnNext.addEventListener("click", () => socket.emit("admin_next_round"));
  if (el.btnPause) el.btnPause.addEventListener("click", () => socket.emit("admin_pause_toggle"));
  if (el.btnReset) el.btnReset.addEventListener("click", () => socket.emit("admin_reset_game"));
  if (el.btnClearChat) el.btnClearChat.addEventListener("click", () => socket.emit("admin_clear_chat"));
}

// =====================================================
// SOCKET EVENTS
// =====================================================
socket.on("server_hello", (payload) => {
  state.bots = payload?.bots || state.bots;
  setAdminUI();
});

socket.on("admin_status", ({ isAdmin }) => {
  state.isAdmin = !!isAdmin;
  setAdminUI();
});

socket.on("settings", ({ settings, bots }) => {
  if (bots) state.bots = bots;
  setAdminUI();
});

socket.on("phase_timer", ({ phase, endTs }) => {
  if (phase) state.phase = phase;
  state.timerEndTs = endTs || 0;
  setPhaseLabel();
  setTimerPill();
});

socket.on("state", (s) => {
  state.phase = s.phase || state.phase;
  state.roundNum = s.roundNum || 0;
  state.judgeId = s.judgeId || null;
  state.currentBlack = s.currentBlack || state.currentBlack;
  state.leaders = Array.isArray(s.leaders) ? s.leaders : [];
  state.players = Array.isArray(s.players) ? s.players : [];
  state.submissionsCount = s.submissionsCount || 0;
  state.bots = s.bots || state.bots;

  setPhaseLabel();
  setRoundMeta();
  renderBlackCard();
  renderPlayers();
  renderHand();
  renderSubmissions();
  setAdminUI();
});

socket.on("hand", ({ hand }) => {
  state.myHand = Array.isArray(hand) ? hand : [];
  renderHand();
});

socket.on("black_card", ({ card }) => {
  state.currentBlack = card || null;
  renderBlackCard();
});

socket.on("submissions_reveal", ({ list }) => {
  state.submissionsList = Array.isArray(list) ? list : [];
  renderSubmissions();
});

socket.on("round_result", (payload) => {
  const winnerName = payload?.winnerName || "Someone";
  addChatLine({ type:"system", text: `${winnerName} won the round.` });
  state.submissionsList = [];
  renderSubmissions();
});

socket.on("chat_history", ({ log }) => {
  if (!el.chatLog) return;
  el.chatLog.innerHTML = "";
  const arr = Array.isArray(log) ? log : [];
  for (const e of arr) addChatLine(e);
});

socket.on("chat_update", ({ entry }) => {
  if (entry) addChatLine(entry);
});

socket.on("error_msg", ({ msg }) => {
  addChatLine({ type:"system", text: "Error: " + (msg || "Unknown") });
});

socket.on("kicked", ({ msg }) => {
  addChatLine({ type:"system", text: msg || "You were kicked." });
});

// =====================================================
// BOOT
// =====================================================
(function boot(){
  loadIdentityFromStorage();
  wireUI();

  socket.on("connect", () => {
    // always re-send identity on connect so refresh re-joins
    sendIdentity();
    socket.emit("request_state");
  });

  // timer refresh tick for pill
  setInterval(setTimerPill, 500);
})();