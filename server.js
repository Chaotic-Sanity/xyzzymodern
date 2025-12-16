"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// =====================================================
// CONFIG
// =====================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_KEY = "kmadmin";

const SETTINGS_PATH = path.join(__dirname, "settings.json");
const PACKS_DIR = path.join(__dirname, "packs");

const PHASES = {
  LOBBY: "lobby",
  PLAY: "play",
  JUDGE: "judge",
  RESULTS: "results",
  PAUSED: "paused",
  FINISHED: "finished"
};

const DEFAULT_SETTINGS = {
  enabledPacks: [],
  scoreLimit: 7,
  playSeconds: 35,
  judgeSeconds: 25,
  resultsSeconds: 10,
  handSize: 10
};

// =====================================================
// UTILS
// =====================================================
function nowTs() { return Date.now(); }

function safeStr(v, max = 32) {
  return String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, obj) {
  const txt = JSON.stringify(obj, null, 2);
  fs.writeFileSync(filePath, txt, { encoding: "utf8" });
}

function systemMsg(text) { return { type: "system", text, ts: nowTs() }; }
function chatMsg(name, text) { return { type: "chat", name, text, ts: nowTs() }; }
function isAdminSocket(socket) { return socket?.data?.isAdmin === true; }

function clampInt(n, min, max, def) {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  return Math.min(max, Math.max(min, Math.floor(x)));
}

function randPick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[(Math.random() * arr.length) | 0];
}

// =====================================================
// PACKS
// =====================================================
function listPackFiles() {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs.readdirSync(PACKS_DIR)
    .filter(f => f.toLowerCase().endsWith(".json"))
    .map(f => path.join(PACKS_DIR, f));
}

function loadAllPacks() {
  const files = listPackFiles();
  const packs = [];
  for (const file of files) {
    const data = readJsonSafe(file, null);
    if (!data) continue;

    const id = path.basename(file, ".json");
    const name = safeStr(data.name || id, 64);

    const blackCards = Array.isArray(data.blackCards) ? data.blackCards : [];
    const whiteCards = Array.isArray(data.whiteCards) ? data.whiteCards : [];

    const cleanedBlack = blackCards
      .map(c => ({ text: safeStr(c?.text, 220), pick: 1 }))
      .filter(c => c.text.length > 0);

    const cleanedWhite = whiteCards
      .map(t => safeStr(t, 220))
      .filter(t => t.length > 0);

    packs.push({
      id, name,
      blackCount: cleanedBlack.length,
      whiteCount: cleanedWhite.length,
      blackCards: cleanedBlack,
      whiteCards: cleanedWhite
    });
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  return packs;
}

// =====================================================
// SETTINGS
// =====================================================
function loadSettings() {
  const s = readJsonSafe(SETTINGS_PATH, null);
  if (!s) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    enabledPacks: Array.isArray(s.enabledPacks) ? s.enabledPacks : DEFAULT_SETTINGS.enabledPacks
  };
}

function saveSettings(settings) {
  writeJsonSafe(SETTINGS_PATH, settings);
}

// =====================================================
// GAME STATE
// =====================================================
const playersById = new Map();      // playerId -> player
const socketToPlayerId = new Map(); // socket.id -> playerId

let packsCache = loadAllPacks();
let settings = loadSettings();

// decks
let blackDeck = [];
let whiteDeck = [];
let usedBlack = [];
let usedWhite = [];

// round state
let phase = PHASES.LOBBY;
let phaseBeforePause = PHASES.LOBBY;

let roundNum = 0;
let judgeId = null;
let currentBlack = null;
let submissions = new Map(); // playerId -> { cardText, fromAuto }
let winnerId = null;

let phaseEndTs = 0;
let phaseTimer = null;
let tickTimer = null;

// chat
const CHAT_MAX = 200;
const chatLog = [];

// bots
const BOT_PREFIX = "bot_";
const BOT_NAMES = [
  "Botman", "CardGoblin", "PunSplicer", "NeonLlama", "ChaosGremlin",
  "MemeEngine", "TrashWizard", "SpookyCPU", "GigaGoose", "ByteBanshee",
  "SnarkSprite", "DiceGobbo", "TinfoilOracle", "LagDragon", "WiredWitch"
];

const botConfig = {
  enabled: false,
  count: 0
};

// =====================================================
// DECKS
// =====================================================
function getEnabledPacks(packs, enabledIds) {
  if (!enabledIds || enabledIds.length === 0) return packs;
  const set = new Set(enabledIds);
  return packs.filter(p => set.has(p.id));
}

function rebuildDecks() {
  packsCache = loadAllPacks();
  const enabled = getEnabledPacks(packsCache, settings.enabledPacks);

  const allBlack = [];
  const allWhite = [];

  for (const p of enabled) {
    for (const b of p.blackCards) allBlack.push({ text: b.text, pick: 1, packId: p.id });
    for (const w of p.whiteCards) allWhite.push({ text: w, packId: p.id });
  }

  blackDeck = shuffle(allBlack.slice());
  whiteDeck = shuffle(allWhite.slice());
  usedBlack = [];
  usedWhite = [];
}

function drawBlack() {
  if (blackDeck.length === 0) {
    if (usedBlack.length === 0) return null;
    blackDeck = shuffle(usedBlack.slice());
    usedBlack = [];
  }
  const c = blackDeck.pop();
  usedBlack.push(c);
  return c;
}

function drawWhite() {
  if (whiteDeck.length === 0) {
    if (usedWhite.length === 0) return null;
    whiteDeck = shuffle(usedWhite.slice());
    usedWhite = [];
  }
  const c = whiteDeck.pop();
  usedWhite.push(c);
  return c;
}

function topLeaders() {
  let top = -Infinity;
  for (const p of playersById.values()) {
    if (p.score > top) top = p.score;
  }
  if (top === -Infinity) return [];
  const leaders = [];
  for (const p of playersById.values()) {
    if (p.score === top && top > 0) leaders.push(p.id);
  }
  return leaders;
}

function ensureHands() {
  for (const p of playersById.values()) {
    if (!Array.isArray(p.hand)) p.hand = [];
    while (p.hand.length < settings.handSize) {
      const w = drawWhite();
      if (!w) break;
      p.hand.push(w.text);
    }
  }
}

function rotateJudge() {
  const ordered = Array.from(playersById.keys());
  if (ordered.length === 0) { judgeId = null; return; }

  if (!judgeId || !ordered.includes(judgeId)) {
    judgeId = ordered[0];
    return;
  }

  const idx = ordered.indexOf(judgeId);
  judgeId = ordered[(idx + 1) % ordered.length];
}

function clearTimers() {
  if (phaseTimer) clearTimeout(phaseTimer);
  if (tickTimer) clearInterval(tickTimer);
  phaseTimer = null;
  tickTimer = null;
}

function setPhase(newPhase, seconds) {
  phase = newPhase;
  phaseEndTs = seconds > 0 ? nowTs() + seconds * 1000 : 0;

  clearTimers();

  if (seconds > 0) {
    phaseTimer = setTimeout(() => onPhaseTimeout(newPhase), seconds * 1000);
    tickTimer = setInterval(() => {
      io.emit("phase_timer", { phase, endTs: phaseEndTs });
    }, 1000);
  }

  io.emit("phase_timer", { phase, endTs: phaseEndTs });
}

function broadcastState() {
  const players = Array.from(playersById.values()).map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isAdmin: p.isAdmin === true,
    isBot: p.isBot === true
  }));

  io.emit("state", {
    phase,
    roundNum,
    judgeId,
    currentBlack: currentBlack ? { text: currentBlack.text, pick: 1 } : null,
    submissionsCount: submissions.size,
    winnerId,
    scoreLimit: settings.scoreLimit,
    leaders: topLeaders(),
    players,
    bots: { enabled: botConfig.enabled, count: botConfig.count }
  });
}

function broadcastHandsToEachPlayer() {
  for (const p of playersById.values()) {
    if (!p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) continue;
    sock.emit("hand", { hand: p.hand.slice() });
  }
}

function addChat(entry) {
  chatLog.push(entry);
  while (chatLog.length > CHAT_MAX) chatLog.shift();
  io.emit("chat_update", { entry });
}

function sendChatHistory(socket) {
  socket.emit("chat_history", { log: chatLog.slice() });
}

// =====================================================
// BOTS
// =====================================================
function botId(i) {
  return BOT_PREFIX + String(i).padStart(2, "0");
}

function botName(i) {
  const base = BOT_NAMES[i % BOT_NAMES.length];
  return base + " #" + (i + 1);
}

function addBot(i) {
  const id = botId(i);
  if (playersById.has(id)) return;

  const p = {
    id,
    name: botName(i),
    score: 0,
    hand: [],
    connected: true,
    socketId: null,
    isAdmin: false,
    isBot: true
  };

  playersById.set(id, p);
  ensureHands();
  addChat(systemMsg(`${p.name} joined (bot).`));
}

function removeAllBots() {
  const ids = Array.from(playersById.keys()).filter(id => id.startsWith(BOT_PREFIX));
  for (const id of ids) {
    const p = playersById.get(id);
    if (p) addChat(systemMsg(`${p.name} left (bot).`));
    playersById.delete(id);
  }
}

function setBotsEnabled(enabled, count) {
  botConfig.enabled = !!enabled;
  botConfig.count = clampInt(count, 0, 12, 0);

  if (!botConfig.enabled || botConfig.count === 0) {
    removeAllBots();
    botConfig.enabled = false;
    botConfig.count = 0;
    broadcastState();
    return;
  }

  // Ensure exactly count bots exist
  // Add missing
  for (let i = 0; i < botConfig.count; i++) addBot(i);

  // Remove extra
  const botIds = Array.from(playersById.keys()).filter(id => id.startsWith(BOT_PREFIX)).sort();
  for (let i = botConfig.count; i < botIds.length; i++) {
    const id = botIds[i];
    const p = playersById.get(id);
    if (p) addChat(systemMsg(`${p.name} left (bot).`));
    playersById.delete(id);
  }

  ensureHands();
  broadcastState();
}

function botSubmitIfNeeded() {
  if (phase !== PHASES.PLAY) return;
  if (!botConfig.enabled || botConfig.count === 0) return;

  for (const p of playersById.values()) {
    if (!p.isBot) continue;
    if (p.id === judgeId) continue;
    if (submissions.has(p.id)) continue;
    if (!p.hand || p.hand.length === 0) continue;

    const pick = randPick(p.hand);
    if (!pick) continue;

    const idx = p.hand.indexOf(pick);
    if (idx >= 0) p.hand.splice(idx, 1);

    submissions.set(p.id, { cardText: pick, fromAuto: true });
    addChat(systemMsg(`${p.name} submitted.`));
  }

  ensureHands();
  broadcastHandsToEachPlayer();
  broadcastState();
}

function botJudgePickIfNeeded() {
  if (phase !== PHASES.JUDGE) return;
  if (!botConfig.enabled || botConfig.count === 0) return;

  const judge = playersById.get(judgeId);
  if (!judge || !judge.isBot) return;

  const ids = Array.from(submissions.keys());
  const pick = randPick(ids);
  if (pick) {
    addChat(systemMsg(`${judge.name} (bot judge) picked a winner.`));
    pickWinner(pick);
  }
}

// =====================================================
// ROUND FLOW
// =====================================================
function startNewRound() {
  if (playersById.size < 2) {
    addChat(systemMsg("Need at least 2 players to start rounds."));
    setPhase(PHASES.LOBBY, 0);
    broadcastState();
    return;
  }

  roundNum += 1;
  submissions = new Map();
  winnerId = null;

  rotateJudge();
  ensureHands();

  currentBlack = drawBlack();
  if (!currentBlack) {
    addChat(systemMsg("No black cards available. Check enabled packs."));
    setPhase(PHASES.LOBBY, 0);
    broadcastState();
    return;
  }

  addChat(systemMsg(`Round ${roundNum} started. Judge: ${playersById.get(judgeId)?.name ?? "?"}`));

  setPhase(PHASES.PLAY, settings.playSeconds);
  broadcastState();
  broadcastHandsToEachPlayer();

  io.emit("black_card", { card: { text: currentBlack.text, pick: 1 } });

  // bots may insta-submit a little later
  setTimeout(botSubmitIfNeeded, 600);
}

function finishPlayPhaseToJudging() {
  // auto-submit for any non-judge player missing
  for (const p of playersById.values()) {
    if (p.id === judgeId) continue;
    if (!p.hand || p.hand.length === 0) continue;
    if (submissions.has(p.id)) continue;

    const pick = randPick(p.hand);
    if (pick) {
      const idx = p.hand.indexOf(pick);
      if (idx >= 0) p.hand.splice(idx, 1);
      submissions.set(p.id, { cardText: pick, fromAuto: true });
      addChat(systemMsg(`${p.name} auto-submitted.`));
    }
  }

  if (submissions.size === 0) {
    addChat(systemMsg("No submissions. Skipping round."));
    setPhase(PHASES.RESULTS, settings.resultsSeconds);
    winnerId = null;
    broadcastState();
    broadcastHandsToEachPlayer();
    io.emit("submissions_reveal", { list: [] });
    return;
  }

  setPhase(PHASES.JUDGE, settings.judgeSeconds);
  broadcastState();

  const list = Array.from(submissions.entries()).map(([pid, s]) => ({
    id: pid,
    text: s.cardText
  }));
  shuffle(list);
  io.emit("submissions_reveal", { list });

  // bot judge pick after a short delay
  setTimeout(botJudgePickIfNeeded, 900);
}

function pickWinner(pid) {
  if (!submissions.has(pid)) return false;

  winnerId = pid;
  const winner = playersById.get(pid);
  if (winner) winner.score += 1;

  addChat(systemMsg(`${winner ? winner.name : "Someone"} won the round.`));

  const limit = settings.scoreLimit;
  if (limit > 0 && winner && winner.score >= limit) {
    addChat(systemMsg(`${winner.name} reached ${limit} points and wins the game!`));
    setPhase(PHASES.FINISHED, 0);
    broadcastState();
    broadcastHandsToEachPlayer();
    io.emit("round_result", {
      winnerId,
      winnerName: winner.name,
      submissions: Array.from(submissions.entries()).map(([id, s]) => ({ id, text: s.cardText })),
      black: currentBlack ? currentBlack.text : ""
    });
    return true;
  }

  setPhase(PHASES.RESULTS, settings.resultsSeconds);
  broadcastState();
  broadcastHandsToEachPlayer();

  io.emit("round_result", {
    winnerId,
    winnerName: winner ? winner.name : "",
    submissions: Array.from(submissions.entries()).map(([id, s]) => ({ id, text: s.cardText })),
    black: currentBlack ? currentBlack.text : ""
  });

  return true;
}

function onPhaseTimeout(whichPhase) {
  if (phase === PHASES.PAUSED) return;

  if (whichPhase === PHASES.PLAY && phase === PHASES.PLAY) {
    finishPlayPhaseToJudging();
    return;
  }

  if (whichPhase === PHASES.JUDGE && phase === PHASES.JUDGE) {
    const judge = playersById.get(judgeId);
    if (judge && judge.isBot) {
      botJudgePickIfNeeded();
      return;
    }

    const ids = Array.from(submissions.keys());
    const auto = randPick(ids);
    if (auto) {
      addChat(systemMsg("Judge timed out. Auto-picking winner."));
      pickWinner(auto);
    } else {
      setPhase(PHASES.RESULTS, settings.resultsSeconds);
      broadcastState();
    }
    return;
  }

  if (whichPhase === PHASES.RESULTS && phase === PHASES.RESULTS) {
    startNewRound();
    return;
  }
}

// =====================================================
// SERVER
// =====================================================
 httpServer = http.createServer(app);
app.get('/health', (req, res) => res.status(200).send('ok'));
const server = http.createServer(app);
const io = new Server(httpServer);

rebuildDecks();

function emitPacksTo(socket) {
  const packs = packsCache.map(p => ({
    id: p.id,
    name: p.name,
    blackCount: p.blackCount,
    whiteCount: p.whiteCount
  }));
  socket.emit("packs_list", { packs });
}

function currentSettingsPublic() {
  return {
    enabledPacks: settings.enabledPacks.slice(),
    scoreLimit: settings.scoreLimit,
    playSeconds: settings.playSeconds,
    judgeSeconds: settings.judgeSeconds,
    resultsSeconds: settings.resultsSeconds,
    handSize: settings.handSize
  };
}

// =====================================================
// SOCKETS
// =====================================================
io.on("connection", (socket) => {
  socket.emit("server_hello", {
    phase,
    roundNum,
    settings: currentSettingsPublic(),
    bots: { enabled: botConfig.enabled, count: botConfig.count }
  });

  emitPacksTo(socket);
  sendChatHistory(socket);
  broadcastState();
  socket.emit("phase_timer", { phase, endTs: phaseEndTs });

  socket.on("set_identity", (payload) => {
    const playerId = safeStr(payload?.playerId, 64);
    const name = safeStr(payload?.name, 24);
    const adminKey = safeStr(payload?.adminKey, 64);

    if (!playerId || !name) {
      socket.emit("error_msg", { msg: "Missing name or playerId." });
      return;
    }

    // Prevent user from impersonating bot ids
    if (playerId.startsWith(BOT_PREFIX)) {
      socket.emit("error_msg", { msg: "Invalid playerId." });
      return;
    }

    socketToPlayerId.set(socket.id, playerId);
    socket.data.playerId = playerId;

    let p = playersById.get(playerId);
    if (!p) {
      p = {
        id: playerId,
        name,
        score: 0,
        hand: [],
        connected: true,
        socketId: socket.id,
        isAdmin: adminKey === ADMIN_KEY,
        isBot: false
      };
      playersById.set(playerId, p);
      addChat(systemMsg(`${p.name} joined.`));
    } else {
      const oldName = p.name;
      p.name = name || p.name;
      p.connected = true;
      p.socketId = socket.id;
      if (adminKey === ADMIN_KEY) p.isAdmin = true;
      if (oldName !== p.name) addChat(systemMsg(`${oldName} is now ${p.name}.`));
      else addChat(systemMsg(`${p.name} rejoined.`));
    }

    socket.data.isAdmin = p.isAdmin === true;

    socket.emit("admin_status", { isAdmin: socket.data.isAdmin === true });
    socket.emit("settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    socket.emit("hand", { hand: p.hand.slice() });

    ensureHands();
    broadcastHandsToEachPlayer();
    broadcastState();
  });

  socket.on("chat_send", (payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    const text = safeStr(payload?.text, 220);
    if (!text) return;

    addChat(chatMsg(p.name, text));
  });

  // -------------------------
  // ADMIN SETTINGS
  // -------------------------
  socket.on("admin_set_settings", (payload) => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    const enabledPacks = Array.isArray(payload?.enabledPacks)
      ? payload.enabledPacks.map(x => safeStr(x, 64)).filter(Boolean)
      : settings.enabledPacks;

    const scoreLimit = clampInt(payload?.scoreLimit, 1, 50, settings.scoreLimit);

    const playSeconds = clampInt(payload?.playSeconds, 10, 120, settings.playSeconds);
    const judgeSeconds = clampInt(payload?.judgeSeconds, 10, 120, settings.judgeSeconds);
    const resultsSeconds = clampInt(payload?.resultsSeconds, 5, 60, settings.resultsSeconds);
    const handSize = clampInt(payload?.handSize, 5, 15, settings.handSize);

    settings.enabledPacks = enabledPacks;
    settings.scoreLimit = scoreLimit;
    settings.playSeconds = playSeconds;
    settings.judgeSeconds = judgeSeconds;
    settings.resultsSeconds = resultsSeconds;
    settings.handSize = handSize;

    saveSettings(settings);

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();

    addChat(systemMsg("Admin updated settings."));
    io.emit("settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    broadcastState();
  });

  // BOTS TOGGLE
  socket.on("admin_set_bots", (payload) => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    const enabled = !!payload?.enabled;
    const count = clampInt(payload?.count, 0, 12, 0);

    setBotsEnabled(enabled, count);

    addChat(systemMsg(`Bots ${botConfig.enabled ? "enabled" : "disabled"} (${botConfig.count}).`));
    io.emit("settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    broadcastState();
  });

  socket.on("admin_clear_chat", () => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }
    chatLog.length = 0;
    io.emit("chat_history", { log: [] });
    addChat(systemMsg("Chat cleared by admin."));
  });

  socket.on("admin_kick", (payload) => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    const targetId = safeStr(payload?.playerId, 64);
    if (!targetId) return;

    const p = playersById.get(targetId);
    if (!p) return;

    if (p.isBot) {
      playersById.delete(targetId);
      addChat(systemMsg(`${p.name} was removed (bot).`));
      broadcastState();
      return;
    }

    if (p.socketId) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) {
        s.emit("kicked", { msg: "You were kicked by admin." });
        s.disconnect(true);
      }
    }

    playersById.delete(targetId);
    addChat(systemMsg(`${p.name} was kicked by admin.`));
    broadcastState();
  });

  socket.on("admin_reset_game", () => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    clearTimers();

    phase = PHASES.LOBBY;
    phaseBeforePause = PHASES.LOBBY;
    phaseEndTs = 0;

    roundNum = 0;
    judgeId = null;
    currentBlack = null;
    submissions = new Map();
    winnerId = null;

    for (const p of playersById.values()) {
      p.score = 0;
      p.hand = [];
    }

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();

    addChat(systemMsg("Game reset by admin."));
    broadcastState();
    io.emit("phase_timer", { phase, endTs: phaseEndTs });
  });

  socket.on("admin_pause_toggle", () => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    if (phase === PHASES.PAUSED) {
      // resume with fresh full duration
      const back = phaseBeforePause;
      if (back === PHASES.PLAY) setPhase(PHASES.PLAY, settings.playSeconds);
      else if (back === PHASES.JUDGE) setPhase(PHASES.JUDGE, settings.judgeSeconds);
      else if (back === PHASES.RESULTS) setPhase(PHASES.RESULTS, settings.resultsSeconds);
      else setPhase(back, 0);

      addChat(systemMsg("Game resumed by admin."));
      broadcastState();
      return;
    }

    phaseBeforePause = phase;
    clearTimers();
    phase = PHASES.PAUSED;
    phaseEndTs = 0;
    io.emit("phase_timer", { phase, endTs: 0 });
    addChat(systemMsg("Game paused by admin."));
    broadcastState();
  });

  // -------------------------
  // GAME CONTROL (ADMIN ONLY)
  // -------------------------
  socket.on("admin_start_game", () => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    if (phase !== PHASES.LOBBY && phase !== PHASES.FINISHED) {
      socket.emit("error_msg", { msg: "Game already running." });
      return;
    }

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();

    addChat(systemMsg("Game started by admin."));
    startNewRound();
  });

  socket.on("admin_next_round", () => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }
    if (phase === PHASES.PAUSED) { socket.emit("error_msg", { msg: "Cannot next round while paused." }); return; }

    addChat(systemMsg("Admin forced next round."));
    startNewRound();
  });

  // -------------------------
  // PLAYER ACTIONS
  // -------------------------
  socket.on("submit_card", (payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    if (phase !== PHASES.PLAY) { socket.emit("error_msg", { msg: "Not in play phase." }); return; }
    if (pid === judgeId) { socket.emit("error_msg", { msg: "Judge cannot submit." }); return; }

    const text = safeStr(payload?.text, 220);
    if (!text) return;

    const idx = p.hand.indexOf(text);
    if (idx < 0) { socket.emit("error_msg", { msg: "Card not in hand." }); return; }
    if (submissions.has(pid)) { socket.emit("error_msg", { msg: "Already submitted." }); return; }

    p.hand.splice(idx, 1);
    submissions.set(pid, { cardText: text, fromAuto: false });

    addChat(systemMsg(`${p.name} submitted.`));

    ensureHands();
    broadcastHandsToEachPlayer();
    broadcastState();

    // bots will also submit if needed
    setTimeout(botSubmitIfNeeded, 350);

    // if all non-judge players submitted, advance
    const nonJudge = Array.from(playersById.values()).filter(x => x.id !== judgeId);
    const needed = nonJudge.length;
    if (needed > 0 && submissions.size >= needed) {
      addChat(systemMsg("All submissions in. Moving to judging."));
      finishPlayPhaseToJudging();
    }
  });

  socket.on("judge_pick", (payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    if (phase !== PHASES.JUDGE) { socket.emit("error_msg", { msg: "Not in judging phase." }); return; }
    if (pid !== judgeId) { socket.emit("error_msg", { msg: "Only judge can pick." }); return; }

    const winnerPick = safeStr(payload?.winnerId, 64);
    if (!winnerPick) return;

    const ok = pickWinner(winnerPick);
    if (!ok) socket.emit("error_msg", { msg: "Invalid winner pick." });
  });

  socket.on("request_state", () => {
    broadcastState();
    socket.emit("settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    socket.emit("phase_timer", { phase, endTs: phaseEndTs });

    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (p) socket.emit("hand", { hand: p.hand.slice() });
  });

  socket.on("disconnect", () => {
    const pid = socketToPlayerId.get(socket.id);
    socketToPlayerId.delete(socket.id);

    if (!pid) return;
    const p = playersById.get(pid);
    if (!p) return;

    p.connected = false;
    p.socketId = null;

    addChat(systemMsg(`${p.name} left.`));
    broadcastState();
  });
});

// =====================================================
// START
// =====================================================

// deploy bump: 2025-12-16 14:41:17


httpServer.listen(PORT, HOST, () => {
  console.log('XyzzyModern running at http://' + HOST + ':' + PORT + '/');
});
