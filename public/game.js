"use strict";

const socket = io();

function qs(id){ return document.getElementById(id); }

const el = {
  phaseLabel: qs("phaseLabel"),
  timerPill: qs("timerPill"),
  judgePill: qs("judgePill"),
  leadPill: qs("leadPill"),
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
  winnerId: null,
  winnerName: "",
  flipSubmissions: false,
  bots: { enabled:false, count:0 },
  timerEndTs: 0,
  pendingPickIndices: []
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

function getBlackPickCount(){
  const explicit = Number(state.currentBlack?.pick || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(3, explicit));
  const text = String(state.currentBlack?.text || "");
  if (/same\s+card\s+again/i.test(text)) return 1;
  const blanks = (text.match(/___/g) || []).length;
  return Math.max(1, Math.min(3, blanks || 1));
}

function setRoundMeta(){
  if (!el.roundMeta) return;
  const pick = getBlackPickCount();
  el.roundMeta.textContent = "Round " + (state.roundNum || 0) + " • Pick " + pick;
}

function setTimerPill(){
  if (!el.timerPill) return;
  el.timerPill.textContent = fmtTimeLeft(state.timerEndTs);
}

function setRolePills(){
  if (el.judgePill) {
    const judge = (state.players || []).find((p) => p.id === state.judgeId);
    el.judgePill.textContent = "Judge: " + (judge?.name || "--");
  }

  if (el.leadPill) {
    const leaderIds = new Set(state.leaders || []);
    const names = (state.players || [])
      .filter((p) => leaderIds.has(p.id))
      .map((p) => safeStr(p.name || "Player", 24));

    let leadText = "--";
    if (names.length === 1) leadText = names[0];
    if (names.length > 1) leadText = names[0] + " +" + (names.length - 1);

    el.leadPill.textContent = "Lead: " + leadText;
  }
}

function applyAdaptiveBlackCardSize(){
  if (!el.blackCard) return;

  const card = el.blackCard;
  card.classList.remove("blackCard--grow1", "blackCard--grow2");

  // Step up the black card only when content overflows.
  const overflows = () => card.scrollHeight > (card.clientHeight + 1) || card.scrollWidth > (card.clientWidth + 1);

  if (!overflows()) return;
  card.classList.add("blackCard--grow1");

  if (!overflows()) return;
  card.classList.add("blackCard--grow2");
}

function renderBlackCard(){
  if (!el.blackCard) return;
  const pickCount = getBlackPickCount();
  el.blackCard.textContent = state.currentBlack?.text ? state.currentBlack.text : "Waiting for round…";
  el.blackCard.setAttribute("data-pick", "Pick " + pickCount);
  requestAnimationFrame(applyAdaptiveBlackCardSize);
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
  const hostId = state.hostId;
  const inPlay = state.phase === "play";

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

    if (hostId && p.id === hostId) badges.appendChild(badge("HOST", "host"));
    if (judgeId && p.id === judgeId) badges.appendChild(badge("JUDGE", "judge"));

    if (inPlay && p.connected !== false && p.id !== judgeId && !p.submitted) {
      badges.appendChild(badge("SELECTING", "selecting"));
    }

    if (leaders.has(p.id)) badges.appendChild(badge("LEAD", "crown"));
    if (p.isBot) badges.appendChild(badge("BOT", "bot"));
    if (p.connected === false) badges.appendChild(badge("OFF", ""));

    left.appendChild(name);
    left.appendChild(badges);

    const right = document.createElement("div");
    right.className = "playerRight";

    const score = document.createElement("div");
    score.className = "playerScore";
    score.textContent = String(p.score ?? 0);
    right.appendChild(score);

    if (state.isAdmin && p.id !== state.myId && (!hostId || p.id !== hostId)) {
      const kickBtn = document.createElement("button");
      kickBtn.className = "btn ghost kickBtn";
      kickBtn.textContent = "Kick";
      kickBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("admin_kick", { playerId: p.id });
      });
      right.appendChild(kickBtn);
    }

    row.appendChild(left);
    row.appendChild(right);
    el.playersList.appendChild(row);
  }
}

function renderHand(){
  if (!el.handList) return;
  clearNode(el.handList);

  const rawHand = state.myHand || [];
  const hand = rawHand
    .map((card) => (typeof card === "string" ? card : (card && card.text ? card.text : "")))
    .filter(Boolean);

  const pickCount = getBlackPickCount();
  const isJudge = state.myId && state.judgeId && state.myId === state.judgeId;
  const canPlay = state.phase === "play" && !isJudge;

  state.pendingPickIndices = (state.pendingPickIndices || [])
    .filter((i) => Number.isInteger(i) && i >= 0 && i < hand.length)
    .slice(0, pickCount);

  if (el.handMeta) {
    const selected = state.pendingPickIndices.length;
    const pickLabel = "Pick " + pickCount;
    el.handMeta.textContent = String(hand.length) + " • " + pickLabel + (pickCount > 1 ? (" (" + selected + "/" + pickCount + ")") : "");
  }

  for (let i = 0; i < hand.length; i++) {
    const txt = hand[i];
    const selected = state.pendingPickIndices.includes(i);

    const d = document.createElement("div");
    d.className = "tpCard tpCard--white cardWhite" + (canPlay ? "" : " disabled") + (selected ? " selected" : "");
    d.textContent = txt;

    d.addEventListener("click", () => {
      if (!canPlay) return;

      if (pickCount <= 1) {
        socket.emit("submit_card", { text: txt });
        state.pendingPickIndices = [];
        return;
      }

      const next = (state.pendingPickIndices || []).slice();
      const at = next.indexOf(i);
      if (at >= 0) {
        next.splice(at, 1);
      } else if (next.length < pickCount) {
        next.push(i);
      }
      state.pendingPickIndices = next;
      renderHand();

      if (state.pendingPickIndices.length === pickCount) {
        const texts = state.pendingPickIndices.map((idx) => hand[idx]).filter(Boolean);
        socket.emit("submit_card", { texts });
        state.pendingPickIndices = [];
      }
    });

    el.handList.appendChild(d);
  }
}

function renderSubmissions(){
  if (!el.submissionsWrap || !el.submissionsList) return;

  const list = state.submissionsList || [];
  const inPlay = state.phase === "play";
  const revealMode = (state.phase === "judge" || state.phase === "results") && list.length > 0;
  const faceDownMode = inPlay && (state.submissionsCount || 0) > 0;
  const show = revealMode || faceDownMode;

  el.submissionsWrap.style.display = show ? "" : "none";
  if (!show) return;

  if (el.subMeta) {
    el.subMeta.textContent = faceDownMode ? (String(state.submissionsCount) + " face down") : String(list.length);
  }

  clearNode(el.submissionsList);

  if (faceDownMode) {
    for (let i = 0; i < state.submissionsCount; i++) {
      const d = document.createElement("div");
      d.className = "tpCard tpCard--back subCard";
      el.submissionsList.appendChild(d);
    }
    return;
  }

  const canJudgePick = state.phase === "judge" && state.myId && state.judgeId && state.myId === state.judgeId;

  for (let i = 0; i < list.length; i++) {
    const card = list[i] || {};
    const cardTexts = Array.isArray(card.cardTexts) && card.cardTexts.length
      ? card.cardTexts
      : (card.text ? [card.text] : []);

    const group = document.createElement("div");
    group.className = "subGroup" + (canJudgePick ? "" : " disabled");

    for (let k = 0; k < cardTexts.length; k++) {
      const d = document.createElement("div");
      d.className = "tpCard tpCard--white tpCard--submission subCard" + (canJudgePick ? "" : " disabled");
      d.textContent = cardTexts[k] || "";

      if (state.flipSubmissions) {
        d.classList.add("is-flipping");
        d.style.animationDelay = ((i * 70) + (k * 40)) + "ms";
      }

      group.appendChild(d);
    }

    if (state.phase === "results" && state.winnerId && card.id === state.winnerId) {
      group.classList.add("winner");
      const winnerTag = document.createElement("div");
      winnerTag.className = "winnerTag";
      winnerTag.textContent = "Winner: " + (state.winnerName || "Unknown");
      group.appendChild(winnerTag);
    }

    group.addEventListener("click", () => {
      if (!canJudgePick) return;
      socket.emit("judge_pick", { winnerId: card.id });
    });

    el.submissionsList.appendChild(group);
  }

  state.flipSubmissions = false;
}

function showWinnerSplash(name){
  const winner = safeStr(name || "Someone", 48) || "Someone";

  const existing = document.querySelector('.winnerSplash');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const wrap = document.createElement('div');
  wrap.className = 'winnerSplash';

  const card = document.createElement('div');
  card.className = 'winnerSplashCard';

  const label = document.createElement('div');
  label.className = 'winnerSplashLabel';
  label.textContent = 'Round Winner';

  const title = document.createElement('div');
  title.className = 'winnerSplashName';
  title.textContent = winner;

  const sub = document.createElement('div');
  sub.className = 'winnerSplashSub';
  sub.textContent = 'takes the point';

  card.appendChild(label);
  card.appendChild(title);
  card.appendChild(sub);
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  setTimeout(() => {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }, 3050);
}

function showJoinSplash(name){
  const joinedName = safeStr(name || "New player", 32) || "New player";

  const existing = document.querySelector(".joinSplash");
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const wrap = document.createElement("div");
  wrap.className = "joinSplash";

  const card = document.createElement("div");
  card.className = "joinSplashCard";

  const label = document.createElement("div");
  label.className = "joinSplashLabel";
  label.textContent = "Player Joined";

  const title = document.createElement("div");
  title.className = "joinSplashName";
  title.textContent = joinedName;

  card.appendChild(label);
  card.appendChild(title);
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  setTimeout(() => {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }, 2050);
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

function renderPauseOverlay(){
  let ov = document.getElementById("pauseOverlay");
  if (state.phase !== "paused") {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    return;
  }

  if (!ov) {
    ov = document.createElement("div");
    ov.id = "pauseOverlay";
    ov.className = "pauseOverlay";
    ov.innerHTML = '<div class="pauseOverlayCard"><div class="pauseTitle">Game Paused</div><div class="pauseSub">Waiting for host to resume…</div></div>';
    document.body.appendChild(ov);
  }
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
      if (el.identityHint) el.identityHint.textContent = "Saved.";
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
  if (state.phase !== "play") state.pendingPickIndices = [];
  state.leaders = Array.isArray(s.leaders) ? s.leaders : [];
  state.hostId = s.hostId || null;
  state.players = Array.isArray(s.players) ? s.players : [];
  state.submissionsCount = s.submissionsCount || 0;
  state.winnerId = s.winnerId || null;
  if (!state.winnerId) state.winnerName = "";
  state.bots = s.bots || state.bots;

  setPhaseLabel();
  setRoundMeta();
  renderBlackCard();
  renderPlayers();
  setRolePills();
  renderHand();
  renderSubmissions();
  setAdminUI();
});

socket.on("hand", ({ hand }) => {
  state.myHand = Array.isArray(hand) ? hand : [];
  state.pendingPickIndices = [];
  renderHand();
});

socket.on("black_card", ({ card }) => {
  state.currentBlack = card || null;
  state.pendingPickIndices = [];
  setRoundMeta();
  renderBlackCard();
  renderHand();
});

socket.on("submissions_reveal", ({ list }) => {
  state.submissionsList = Array.isArray(list) ? list : [];
  state.winnerId = null;
  state.winnerName = "";
  state.flipSubmissions = true;
  renderSubmissions();
});

socket.on("round_result", (payload) => {
  const winnerName = payload?.winnerName || "Someone";
  showWinnerSplash(winnerName);
  addChatLine({ type:"system", text: `${winnerName} won the round.` });

  state.phase = "results";
  state.winnerId = payload?.winnerId || null;
  state.winnerName = winnerName;
  state.submissionsList = Array.isArray(payload?.submissions) ? payload.submissions : [];
  state.flipSubmissions = false;

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

socket.on("player_joined", ({ playerId, name }) => {
  if (playerId && state.myId && playerId === state.myId) return;
  showJoinSplash(name || "New player");
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

  window.addEventListener("resize", () => {
    requestAnimationFrame(applyAdaptiveBlackCardSize);
  });
})();






