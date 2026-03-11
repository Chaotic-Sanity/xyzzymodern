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
const ADMIN_KEY = process.env.ADMIN_KEY || "kmadmin";
const AUTO_TEST_BOTS = 2;
const BOT_JUDGE_PICK_DELAY_MS = 10000;

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

function envInt(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function envList(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return [];
  return raw.split(",").map((v) => safeStr(v, 64).toLowerCase()).filter(Boolean);
}

const DEFAULT_SETTINGS = {
  enabledPacks: envList("ENABLED_PACKS"),
  scoreLimit: envInt("SCORE_LIMIT", 7, 1, 50),
  playSeconds: envInt("PLAY_SECONDS", 60, 10, 120),
  judgeSeconds: envInt("JUDGE_SECONDS", 25, 10, 120),
  resultsSeconds: envInt("RESULTS_SECONDS", 10, 5, 60),
  handSize: envInt("HAND_SIZE", 10, 5, 15)
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
    .filter((f) => {
      const lower = f.toLowerCase();
      if (!lower.endsWith(".json")) return false;
      // Ignore local backup snapshots so they do not appear as playable packs.
      if (lower.includes(".backup.")) return false;
      return true;
    })
    .map(f => path.join(PACKS_DIR, f));
}

function blackPickCount(text) {
  const t = safeStr(text, 220);
  if (/same\s+card\s+again/i.test(t)) return 1;
  const blanks = (t.match(/___/g) || []).length;
  if (blanks <= 1) return 1;
  return Math.min(3, blanks);
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
      .map((c) => (typeof c === "string" ? c : c?.text))
      .map((text) => safeStr(text, 220))
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0 && (text.includes("___") || text.endsWith("?")))
      .map((text) => ({ text, pick: blackPickCount(text) }));

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
const CHAT_MAX = 200;
const BOT_PREFIX = "bot_";
const BOT_NAMES = [
  "Alex", "Jordan", "Taylor", "Casey", "Morgan",
  "Riley", "Avery", "Jamie", "Sam", "Quinn",
  "Dylan", "Cameron", "Harper", "Parker", "Rowan"
];

let packsCache = loadAllPacks();
const baseSettings = loadSettings();

const gamesById = new Map();
let activeGameId = "main";

let playersById;
let socketToPlayerId;
let settings;
let blackDeck;
let whiteDeck;
let usedBlack;
let usedWhite;
let phase;
let phaseBeforePause;
let roundNum;
let judgeId;
let currentBlack;
let submissions;
let winnerId;
let phaseEndTs;
let phaseTimer;
let tickTimer;
let chatLog;
let gameOwnerId;
let botConfig;

function makeGameState(id) {
  return {
    id,
    playersById: new Map(),
    socketToPlayerId: new Map(),
    settings: { ...baseSettings },
    blackDeck: [],
    whiteDeck: [],
    usedBlack: [],
    usedWhite: [],
    phase: PHASES.LOBBY,
    phaseBeforePause: PHASES.LOBBY,
    roundNum: 0,
    judgeId: null,
    currentBlack: null,
    submissions: new Map(),
    winnerId: null,
    phaseEndTs: 0,
    phaseTimer: null,
    tickTimer: null,
    chatLog: [],
    ownerId: null,
    botConfig: { enabled: false, count: 0 }
  };
}

function getOrCreateGame(gameId) {
  const id = safeStr(gameId || "main", 24).toLowerCase() || "main";
  if (!gamesById.has(id)) gamesById.set(id, makeGameState(id));
  return gamesById.get(id);
}

function bindGame(gameId) {
  const g = getOrCreateGame(gameId);
  activeGameId = g.id;
  playersById = g.playersById;
  socketToPlayerId = g.socketToPlayerId;
  settings = g.settings;
  blackDeck = g.blackDeck;
  whiteDeck = g.whiteDeck;
  usedBlack = g.usedBlack;
  usedWhite = g.usedWhite;
  phase = g.phase;
  phaseBeforePause = g.phaseBeforePause;
  roundNum = g.roundNum;
  judgeId = g.judgeId;
  currentBlack = g.currentBlack;
  submissions = g.submissions;
  winnerId = g.winnerId;
  phaseEndTs = g.phaseEndTs;
  phaseTimer = g.phaseTimer;
  tickTimer = g.tickTimer;
  chatLog = g.chatLog;
  gameOwnerId = g.ownerId;
  botConfig = g.botConfig;
  return g;
}

function persistGame(gameId) {
  const g = getOrCreateGame(gameId);
  g.playersById = playersById;
  g.socketToPlayerId = socketToPlayerId;
  g.settings = settings;
  g.blackDeck = blackDeck;
  g.whiteDeck = whiteDeck;
  g.usedBlack = usedBlack;
  g.usedWhite = usedWhite;
  g.phase = phase;
  g.phaseBeforePause = phaseBeforePause;
  g.roundNum = roundNum;
  g.judgeId = judgeId;
  g.currentBlack = currentBlack;
  g.submissions = submissions;
  g.winnerId = winnerId;
  g.phaseEndTs = phaseEndTs;
  g.phaseTimer = phaseTimer;
  g.tickTimer = tickTimer;
  g.chatLog = chatLog;
  g.ownerId = gameOwnerId;
  g.botConfig = botConfig;
}

function withGame(gameId, fn) {
  const id = safeStr(gameId || "main", 24).toLowerCase() || "main";
  bindGame(id);
  try {
    return fn(id);
  } finally {
    persistGame(id);
  }
}

function roomOf(gameId) {
  return "game:" + gameId;
}

function emitGame(gameId, event, payload) {
  io.to(roomOf(gameId)).emit(event, payload);
}

function listGamesSummary() {
  const out = [];
  for (const [id, g] of gamesById.entries()) {
    const connected = Array.from(g.playersById.values()).filter(p => p.connected === true).length;
    out.push({
      id,
      phase: g.phase,
      roundNum: g.roundNum,
      players: connected,
      hasOwner: !!g.ownerId
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function maybeCleanupGame(gameId) {
  const id = safeStr(gameId || "", 24).toLowerCase();
  if (!id || id === "main") return;
  const g = gamesById.get(id);
  if (!g) return;
  const hasConnected = Array.from(g.playersById.values()).some(p => p.connected === true);
  if (hasConnected) return;
  if (g.phaseTimer) clearTimeout(g.phaseTimer);
  if (g.tickTimer) clearInterval(g.tickTimer);
  gamesById.delete(id);
}
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
  const seenBlack = new Set();
  const seenWhite = new Set();

  for (const p of enabled) {
    for (const b of p.blackCards) {
      const t = safeStr(b?.text, 220);
      if (!t) continue;
      const k = t.toLowerCase();
      if (seenBlack.has(k)) continue;
      seenBlack.add(k);
      allBlack.push({ text: t, pick: b.pick || blackPickCount(t), packId: p.id });
    }
    for (const w of p.whiteCards) {
      const t = safeStr(w, 220);
      if (!t) continue;
      const k = t.toLowerCase();
      if (seenWhite.has(k)) continue;
      seenWhite.add(k);
      allWhite.push({ text: t, packId: p.id });
    }
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
  return whiteDeck.pop();
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
function findWhitePackForText(text) {
  const t = safeStr(text, 220);
  if (!t) return { packId: "", packName: "Unknown pack" };

  const enabled = getEnabledPacks(packsCache, settings.enabledPacks);
  for (const p of enabled) {
    if (Array.isArray(p.whiteCards) && p.whiteCards.includes(t)) {
      return { packId: p.id, packName: p.name };
    }
  }

  for (const p of packsCache) {
    if (Array.isArray(p.whiteCards) && p.whiteCards.includes(t)) {
      return { packId: p.id, packName: p.name };
    }
  }

  return { packId: "", packName: "Unknown pack" };
}

function addWhiteToDiscard(text) {
  const t = safeStr(text, 220);
  if (!t) return;
  const src = findWhitePackForText(t);
  usedWhite.push({ text: t, packId: src.packId || "" });
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
    const gameIdForTimer = activeGameId;
    phaseTimer = setTimeout(() => withGame(gameIdForTimer, () => onPhaseTimeout(newPhase)), seconds * 1000);
    tickTimer = setInterval(() => {
      emitGame(activeGameId, "phase_timer", { phase, endTs: phaseEndTs });
    }, 1000);
  }

  emitGame(activeGameId, "phase_timer", { phase, endTs: phaseEndTs });
}

function broadcastState() {
  const players = Array.from(playersById.values()).map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isAdmin: p.isAdmin === true,
    isBot: p.isBot === true,
    submitted: submissions.has(p.id)
  }));

  emitGame(activeGameId, "state", {
    phase,
    roundNum,
    judgeId,
    currentBlack: currentBlack ? { text: currentBlack.text, pick: currentBlack.pick || blackPickCount(currentBlack.text) } : null,
    submissionsCount: submissions.size,
    winnerId,
    scoreLimit: settings.scoreLimit,
    leaders: topLeaders(),
    players,
    hostId: gameOwnerId || null,
    bots: { enabled: botConfig.enabled, count: botConfig.count }
  });
}

function broadcastHandsToEachPlayer() {
  for (const p of playersById.values()) {
    if (!p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) continue;
    const hand = (p.hand || []).map((text) => {
      const src = findWhitePackForText(text);
      return { text, packId: src.packId, packName: src.packName };
    });
    sock.emit("hand", { hand });
  }
}

function addChat(entry) {
  chatLog.push(entry);
  while (chatLog.length > CHAT_MAX) chatLog.shift();
  emitGame(activeGameId, "chat_update", { entry });
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
  return BOT_NAMES[i % BOT_NAMES.length];
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

function pickCardsFromHand(hand, pickCount) {
  const need = Math.max(1, Math.min(3, Number(pickCount) || 1));
  const pool = Array.isArray(hand) ? hand.slice() : [];
  const out = [];
  while (out.length < need && pool.length > 0) {
    const pick = randPick(pool);
    if (!pick) break;
    const idx = pool.indexOf(pick);
    if (idx >= 0) pool.splice(idx, 1);
    out.push(pick);
  }
  return out;
}

function botSubmitIfNeeded() {
  if (phase !== PHASES.PLAY) return;
  if (!botConfig.enabled || botConfig.count === 0) return;

  const pickCount = currentBlack ? (currentBlack.pick || blackPickCount(currentBlack.text)) : 1;

  for (const p of playersById.values()) {
    if (!p.isBot) continue;
    if (p.id === judgeId) continue;
    if (submissions.has(p.id)) continue;
    if (!p.hand || p.hand.length < pickCount) continue;

    const picks = pickCardsFromHand(p.hand, pickCount);
    if (picks.length !== pickCount) continue;

    for (const pick of picks) {
      const idx = p.hand.indexOf(pick);
      if (idx >= 0) p.hand.splice(idx, 1);
      addWhiteToDiscard(pick);
    }

    const src = findWhitePackForText(picks[0]);
    submissions.set(p.id, {
      cardText: picks.join(" / "),
      cardTexts: picks.slice(),
      packId: src.packId,
      packName: src.packName,
      fromAuto: true
    });
    addChat(systemMsg(`${p.name} submitted.`));
  }

  ensureHands();
  broadcastHandsToEachPlayer();
  broadcastState();

  maybeAdvanceToJudging();
}

function requiredSubmitters() {
  return Array.from(playersById.values()).filter((p) => {
    if (!p) return false;
    if (p.id === judgeId) return false;
    if (p.connected === false) return false;
    return true;
  });
}

function maybeAdvanceToJudging() {
  if (phase !== PHASES.PLAY) return false;
  const required = requiredSubmitters();
  if (required.length === 0) return false;
  if (submissions.size < required.length) return false;
  addChat(systemMsg("All submissions in. Moving to judging."));
  finishPlayPhaseToJudging();
  return true;
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

  emitGame(activeGameId, "black_card", { card: { text: currentBlack.text, pick: currentBlack.pick || blackPickCount(currentBlack.text) } });

  // bots may insta-submit a little later
  { const gid = activeGameId; setTimeout(() => withGame(gid, () => botSubmitIfNeeded()), 600); }
}

function finishPlayPhaseToJudging() {
  // auto-submit for any non-judge player missing
  const pickCount = currentBlack ? (currentBlack.pick || blackPickCount(currentBlack.text)) : 1;
  for (const p of playersById.values()) {
    if (p.id === judgeId) continue;
    if (!p.hand || p.hand.length < pickCount) continue;
    if (submissions.has(p.id)) continue;

    const picks = pickCardsFromHand(p.hand, pickCount);
    if (picks.length === pickCount) {
      for (const pick of picks) {
        const idx = p.hand.indexOf(pick);
        if (idx >= 0) p.hand.splice(idx, 1);
        addWhiteToDiscard(pick);
      }
      const src = findWhitePackForText(picks[0]);
      submissions.set(p.id, { cardText: picks.join(" / "), cardTexts: picks.slice(), packId: src.packId, packName: src.packName, fromAuto: true });
      addChat(systemMsg(`${p.name} auto-submitted.`));
    }
  }

  if (submissions.size === 0) {
    addChat(systemMsg("No submissions. Skipping round."));
    setPhase(PHASES.RESULTS, settings.resultsSeconds);
    winnerId = null;
    broadcastState();
    broadcastHandsToEachPlayer();
    emitGame(activeGameId, "submissions_reveal", { list: [] });
    return;
  }

  setPhase(PHASES.JUDGE, settings.judgeSeconds);
  broadcastState();

  const list = Array.from(submissions.entries()).map(([pid, s]) => ({
    id: pid,
    text: s.cardText,
    cardTexts: Array.isArray(s.cardTexts) ? s.cardTexts : [s.cardText],
    packId: s.packId,
    packName: s.packName
  }));
  shuffle(list);
  emitGame(activeGameId, "submissions_reveal", { list });

  // bot judge pick after a short delay
  { const gid = activeGameId; setTimeout(() => withGame(gid, () => botJudgePickIfNeeded()), BOT_JUDGE_PICK_DELAY_MS); }
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
    emitGame(activeGameId, "round_result", {
      winnerId,
      winnerName: winner.name,
      submissions: Array.from(submissions.entries()).map(([id, s]) => ({ id, text: s.cardText, cardTexts: Array.isArray(s.cardTexts) ? s.cardTexts : [s.cardText], packId: s.packId, packName: s.packName })), 
      black: currentBlack ? currentBlack.text : ""
    });
    return true;
  }

  setPhase(PHASES.RESULTS, settings.resultsSeconds);
  broadcastState();
  broadcastHandsToEachPlayer();

  emitGame(activeGameId, "round_result", {
    winnerId,
    winnerName: winner ? winner.name : "",
    submissions: Array.from(submissions.entries()).map(([id, s]) => ({ id, text: s.cardText, cardTexts: Array.isArray(s.cardTexts) ? s.cardTexts : [s.cardText], packId: s.packId, packName: s.packName })), 
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

function emitPacksTo(socket) {
  // Reload pack files so UI counts reflect latest edits without server restart.
  packsCache = loadAllPacks();
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

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});
// =====================================================
// SOCKETS
// =====================================================
const server = http.createServer(app);
const io = new Server(server);

function normalizeGameId(v) {
  const id = safeStr(v || "", 24).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return id || "main";
}

withGame("main", () => {
  rebuildDecks();
});

io.on("connection", (socket) => {
  socket.data.gameId = null;
  socket.data.playerId = null;
  socket.data.isAdmin = false;

  socket.emit("server_hello", {
    phase: PHASES.LOBBY,
    roundNum: 0,
    settings: { ...baseSettings },
    bots: { enabled: false, count: 0 }
  });

  emitPacksTo(socket);
  socket.emit("games_list", { games: listGamesSummary() });

  socket.on("games_list_request", () => {
    socket.emit("games_list", { games: listGamesSummary() });
  });

  socket.on("game_create", (payload) => {
    const requested = normalizeGameId(payload?.gameId || payload?.name || "");
    const creatorPlayerId = safeStr(payload?.creatorPlayerId, 64);
    const creatorName = safeStr(payload?.creatorName, 24);
    if (gamesById.has(requested)) {
      socket.emit("error_msg", { msg: "Game id already exists." });
      return;
    }

    withGame(requested, () => {
      rebuildDecks();
      if (creatorPlayerId) {
        gameOwnerId = creatorPlayerId;
        addChat(systemMsg((creatorName || "Host") + " created this game and is reserved as host."));
      }
    });

    socket.emit("game_created", { gameId: requested });
    io.emit("games_list", { games: listGamesSummary() });
  });

  function runInSocketGame(fn) {
    return (payload) => {
      const gid = normalizeGameId(socket.data.gameId);
      if (!socket.data.gameId) {
        socket.emit("error_msg", { msg: "Join a game first." });
        return;
      }
      withGame(gid, () => fn(payload, gid));
      io.emit("games_list", { games: listGamesSummary() });
    };
  }

  function leaveGame(gameId) {
    const gid = normalizeGameId(gameId);
    withGame(gid, () => {
      const pid = socketToPlayerId.get(socket.id);
      socketToPlayerId.delete(socket.id);
      if (!pid) return;
      const p = playersById.get(pid);
      if (!p) return;
      p.connected = false;
      p.socketId = null;
      addChat(systemMsg(`${p.name} left.`));
      broadcastState();
      maybeAdvanceToJudging();
            if (gameOwnerId && pid === gameOwnerId) {
        gameOwnerId = null;
        p.isAdmin = false;

        for (const pl of playersById.values()) pl.isAdmin = false;

        const nextHost = Array.from(playersById.values()).find((pl) => !pl.isBot && pl.connected === true && pl.id !== pid);
        if (nextHost) {
          gameOwnerId = nextHost.id;
          nextHost.isAdmin = true;
          addChat(systemMsg(`${nextHost.name} is now host.`));

          if (nextHost.socketId) {
            const hostSocket = io.sockets.sockets.get(nextHost.socketId);
            if (hostSocket) {
              hostSocket.data.isAdmin = true;
              hostSocket.emit("admin_status", { isAdmin: true });
            }
          }
        } else {
          addChat(systemMsg("Host left. No active host right now."));
        }
      }
    });
    socket.leave(roomOf(gid));
    maybeCleanupGame(gid);
  }

  socket.on("set_identity", (payload) => {
    const playerId = safeStr(payload?.playerId, 64);
    const name = safeStr(payload?.name, 24);
    const adminKey = safeStr(payload?.adminKey, 64);
    const gameId = normalizeGameId(payload?.gameId);

    if (!playerId || !name) {
      socket.emit("error_msg", { msg: "Missing name or playerId." });
      return;
    }

    if (playerId.startsWith(BOT_PREFIX)) {
      socket.emit("error_msg", { msg: "Invalid playerId." });
      return;
    }

    if (socket.data.gameId && socket.data.gameId !== gameId) {
      leaveGame(socket.data.gameId);
      socket.data.isAdmin = false;
    }

    socket.join(roomOf(gameId));
    socket.data.gameId = gameId;

    withGame(gameId, () => {
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
          isAdmin: false,
          isBot: false
        };
        playersById.set(playerId, p);
        addChat(systemMsg(`${p.name} joined.`));
        emitGame(gameId, "player_joined", { playerId: p.id, name: p.name });
      } else {
        const oldName = p.name;
        p.name = name || p.name;
        p.connected = true;
        p.socketId = socket.id;
        if (oldName !== p.name) addChat(systemMsg(`${oldName} is now ${p.name}.`));
        else addChat(systemMsg(`${p.name} rejoined.`));
      }

      const hasAdminKey = adminKey === ADMIN_KEY;
      if (hasAdminKey) {
        if (gameOwnerId !== p.id) addChat(systemMsg(`${p.name} claimed host via admin key.`));
        gameOwnerId = p.id;
        for (const pl of playersById.values()) pl.isAdmin = false;
      }

      if (!gameOwnerId) {
        gameOwnerId = p.id;
        addChat(systemMsg(`${p.name} became game host.`));
      }

      p.isAdmin = !!gameOwnerId && p.id === gameOwnerId;
      socket.data.isAdmin = p.isAdmin === true;

      if ((botConfig.count || 0) === 0 && AUTO_TEST_BOTS > 0) {
        setBotsEnabled(true, AUTO_TEST_BOTS);
        addChat(systemMsg("Auto-test bots enabled (" + AUTO_TEST_BOTS + ")."));
      }

      sendChatHistory(socket);
      socket.emit("admin_status", { isAdmin: socket.data.isAdmin === true });
      socket.emit("settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });

      ensureHands();
      const hand = (p.hand || []).map((text) => {
        const src = findWhitePackForText(text);
        return { text, packId: src.packId, packName: src.packName };
      });
      socket.emit("hand", { hand });
      socket.emit("identity_assigned", { playerId, gameId });
      socket.emit("phase_timer", { phase, endTs: phaseEndTs });

      broadcastHandsToEachPlayer();
      broadcastState();
    });

    io.emit("games_list", { games: listGamesSummary() });
  });

  socket.on("chat_send", runInSocketGame((payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    const text = safeStr(payload?.text, 220);
    if (!text) return;

    addChat(chatMsg(p.name, text));
  }));

  socket.on("admin_set_settings", runInSocketGame((payload) => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    const enabledPacks = Array.isArray(payload?.enabledPacks)
      ? payload.enabledPacks.map(x => safeStr(x, 64)).filter(Boolean)
      : settings.enabledPacks;

    settings.enabledPacks = enabledPacks;
    settings.scoreLimit = clampInt(payload?.scoreLimit, 1, 50, settings.scoreLimit);
    settings.playSeconds = clampInt(payload?.playSeconds, 10, 120, settings.playSeconds);
    settings.judgeSeconds = clampInt(payload?.judgeSeconds, 10, 120, settings.judgeSeconds);
    settings.resultsSeconds = clampInt(payload?.resultsSeconds, 5, 60, settings.resultsSeconds);
    settings.handSize = clampInt(payload?.handSize, 5, 15, settings.handSize);

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();

    addChat(systemMsg("Admin updated settings."));
    emitGame(activeGameId, "settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    broadcastState();
  }));

  socket.on("admin_set_bots", runInSocketGame((payload) => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }
    setBotsEnabled(!!payload?.enabled, clampInt(payload?.count, 0, 12, 0));
    addChat(systemMsg(`Bots ${botConfig.enabled ? "enabled" : "disabled"} (${botConfig.count}).`));
    emitGame(activeGameId, "settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    broadcastState();
  }));

  socket.on("admin_clear_chat", runInSocketGame(() => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }
    chatLog.length = 0;
    emitGame(activeGameId, "chat_history", { log: [] });
    addChat(systemMsg("Chat cleared by admin."));
  }));

  socket.on("admin_kick", runInSocketGame((payload) => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    const targetId = safeStr(payload?.playerId, 64);
    if (!targetId) return;

    const p = playersById.get(targetId);
    if (!p) return;

    if (gameOwnerId && targetId === gameOwnerId) gameOwnerId = null;

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
  }));

  socket.on("admin_reset_game", runInSocketGame(() => {
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
    emitGame(activeGameId, "phase_timer", { phase, endTs: phaseEndTs });
  }));

  socket.on("admin_pause_toggle", runInSocketGame(() => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }

    if (phase === PHASES.PAUSED) {
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
    emitGame(activeGameId, "phase_timer", { phase, endTs: 0 });
    addChat(systemMsg("Game paused by admin."));
    broadcastState();
  }));

  socket.on("admin_start_game", runInSocketGame(() => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) { socket.emit("error_msg", { msg: "Join first." }); return; }

    if (!gameOwnerId) {
      gameOwnerId = pid;
      p.isAdmin = true;
      socket.data.isAdmin = true;
      addChat(systemMsg(`${p.name} became game host.`));
      socket.emit("admin_status", { isAdmin: true });
      broadcastState();
    }

    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Only host can start." }); return; }

    if (phase !== PHASES.LOBBY && phase !== PHASES.FINISHED) {
      socket.emit("error_msg", { msg: "Game already running." });
      return;
    }

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();

    addChat(systemMsg("Game started by host."));
    startNewRound();
  }));

  socket.on("admin_next_round", runInSocketGame(() => {
    if (!isAdminSocket(socket)) { socket.emit("error_msg", { msg: "Admin only." }); return; }
    if (phase === PHASES.PAUSED) { socket.emit("error_msg", { msg: "Cannot next round while paused." }); return; }
    addChat(systemMsg("Admin forced next round."));
    startNewRound();
  }));

  socket.on("submit_card", runInSocketGame((payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    if (phase !== PHASES.PLAY) { socket.emit("error_msg", { msg: "Not in play phase." }); return; }
    if (pid === judgeId) { socket.emit("error_msg", { msg: "Judge cannot submit." }); return; }
    if (submissions.has(pid)) { socket.emit("error_msg", { msg: "Already submitted." }); return; }

    const pickCount = currentBlack ? (currentBlack.pick || blackPickCount(currentBlack.text)) : 1;

    let picks = [];
    if (Array.isArray(payload?.texts)) {
      picks = payload.texts.map((t) => safeStr(t, 220)).filter(Boolean);
    } else {
      const single = safeStr(payload?.text, 220);
      if (single) picks = [single];
    }

    if (picks.length !== pickCount) {
      socket.emit("error_msg", { msg: `This card needs ${pickCount} white card${pickCount > 1 ? "s" : ""}.` });
      return;
    }

    const nextHand = Array.isArray(p.hand) ? p.hand.slice() : [];
    for (const text of picks) {
      const idx = nextHand.indexOf(text);
      if (idx < 0) { socket.emit("error_msg", { msg: "Card not in hand." }); return; }
      nextHand.splice(idx, 1);
    }

    p.hand = nextHand;
    for (const text of picks) addWhiteToDiscard(text);
    const src = findWhitePackForText(picks[0]);
    submissions.set(pid, {
      cardText: picks.join(" / "),
      cardTexts: picks.slice(),
      packId: src.packId,
      packName: src.packName,
      fromAuto: false
    });

    addChat(systemMsg(`${p.name} submitted.`));

    ensureHands();
    broadcastHandsToEachPlayer();
    broadcastState();

    { const gid = activeGameId; setTimeout(() => withGame(gid, () => botSubmitIfNeeded()), 350); }

    maybeAdvanceToJudging();
  }));

  socket.on("judge_pick", runInSocketGame((payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    if (phase !== PHASES.JUDGE) { socket.emit("error_msg", { msg: "Not in judging phase." }); return; }
    if (pid !== judgeId) { socket.emit("error_msg", { msg: "Only judge can pick." }); return; }

    const winnerPick = safeStr(payload?.winnerId, 64);
    if (!winnerPick) return;

    const ok = pickWinner(winnerPick);
    if (!ok) socket.emit("error_msg", { msg: "Invalid winner pick." });
  }));

  socket.on("request_state", runInSocketGame(() => {
    broadcastState();
    socket.emit("settings", { settings: currentSettingsPublic(), bots: { enabled: botConfig.enabled, count: botConfig.count } });
    socket.emit("phase_timer", { phase, endTs: phaseEndTs });

    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (p) {
      const hand = (p.hand || []).map((text) => {
        const src = findWhitePackForText(text);
        return { text, packId: src.packId, packName: src.packName };
      });
      socket.emit("hand", { hand });
    }
  }));

  socket.on("disconnect", () => {
    if (!socket.data.gameId) return;
    leaveGame(socket.data.gameId);
    io.emit("games_list", { games: listGamesSummary() });
  });
});
// =====================================================
// START
// =====================================================
server.listen(PORT, HOST, () => {
  console.log('Terrible People running at http://' + HOST + ':' + PORT + '/');
});




























