$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$root = $PWD
$publicDir = Join-Path $root "public"
$packsDir  = Join-Path $root "packs"

if (!(Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir | Out-Null }
if (!(Test-Path $packsDir))  { New-Item -ItemType Directory -Path $packsDir  | Out-Null }

# ============================================================
# server.js (FULL)
# ============================================================
$serverJs = @"
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// =====================================================
// CONFIG
// =====================================================
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ADMIN_KEY = "kmadmin"; // fixed admin key (locked)

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
  enabledPacks: [],     // empty => all packs enabled
  scoreLimit: 7,
  playSeconds: 35,
  judgeSeconds: 25,
  resultsSeconds: 10,
  handSize: 10
};

// =====================================================
// UTILS
// =====================================================
function nowTs(){ return Date.now(); }

function safeStr(v, max = 32){
  return String(v ?? "").trim().replace(/\\s+/g, " ").slice(0, max);
}

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function readJsonSafe(filePath, fallback){
  try{
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, obj){
  const txt = JSON.stringify(obj, null, 2);
  fs.writeFileSync(filePath, txt, { encoding: "utf8" });
}

function systemMsg(text){ return { type: "system", text, ts: nowTs() }; }
function chatMsg(name, text){ return { type: "chat", name, text, ts: nowTs() }; }

function isAdminSocket(socket){ return socket?.data?.isAdmin === true; }

function clampInt(n, min, max, def){
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  return Math.min(max, Math.max(min, Math.floor(x)));
}

function randPick(arr){
  if (!arr || arr.length === 0) return null;
  return arr[(Math.random() * arr.length) | 0];
}

// =====================================================
// PACKS
// =====================================================
function listPackFiles(){
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs.readdirSync(PACKS_DIR)
    .filter(f => f.toLowerCase().endsWith(".json"))
    .map(f => path.join(PACKS_DIR, f));
}

function loadAllPacks(){
  const files = listPackFiles();
  const packs = [];
  for (const file of files){
    const data = readJsonSafe(file, null);
    if (!data) continue;

    const id = path.basename(file, ".json");
    const name = safeStr(data.name || id, 64);

    const blackCards = Array.isArray(data.blackCards) ? data.blackCards : [];
    const whiteCards = Array.isArray(data.whiteCards) ? data.whiteCards : [];

    // locked rules: pick 1 only, no blanks
    const cleanedBlack = blackCards
      .map(c => ({ text: safeStr(c?.text, 220), pick: 1 }))
      .filter(c => c.text.length > 0);

    const cleanedWhite = whiteCards
      .map(t => safeStr(t, 220))
      .filter(t => t.length > 0);

    packs.push({
      id,
      name,
      blackCount: cleanedBlack.length,
      whiteCount: cleanedWhite.length,
      blackCards: cleanedBlack,
      whiteCards: cleanedWhite
    });
  }
  packs.sort((a,b) => a.name.localeCompare(b.name));
  return packs;
}

// =====================================================
// SETTINGS
// =====================================================
function loadSettings(){
  const s = readJsonSafe(SETTINGS_PATH, null);
  if (!s) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    enabledPacks: Array.isArray(s.enabledPacks) ? s.enabledPacks : DEFAULT_SETTINGS.enabledPacks
  };
}

function saveSettings(settings){
  writeJsonSafe(SETTINGS_PATH, settings);
}

// =====================================================
// GAME STATE
// =====================================================
const playersById = new Map();     // playerId -> { id, name, score, hand, connected, socketId, isAdmin }
const socketToPlayerId = new Map(); // socket.id -> playerId

let packsCache = loadAllPacks();
let settings = loadSettings();

// decks
let blackDeck = [];
let whiteDeck = [];
let usedBlack = [];
let usedWhite = [];

// round
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

// =====================================================
// DECKS
// =====================================================
function getEnabledPacks(packs, enabledIds){
  if (!enabledIds || enabledIds.length === 0) return packs;
  const set = new Set(enabledIds);
  return packs.filter(p => set.has(p.id));
}

function rebuildDecks(){
  packsCache = loadAllPacks();
  const enabled = getEnabledPacks(packsCache, settings.enabledPacks);

  const allBlack = [];
  const allWhite = [];

  for (const p of enabled){
    for (const b of p.blackCards) allBlack.push({ text: b.text, pick: 1, packId: p.id });
    for (const w of p.whiteCards) allWhite.push({ text: w, packId: p.id });
  }

  blackDeck = shuffle(allBlack.slice());
  whiteDeck = shuffle(allWhite.slice());
  usedBlack = [];
  usedWhite = [];
}

function drawBlack(){
  if (blackDeck.length === 0){
    if (usedBlack.length === 0) return null;
    blackDeck = shuffle(usedBlack.slice());
    usedBlack = [];
  }
  const c = blackDeck.pop();
  usedBlack.push(c);
  return c;
}

function drawWhite(){
  if (whiteDeck.length === 0){
    if (usedWhite.length === 0) return null;
    whiteDeck = shuffle(usedWhite.slice());
    usedWhite = [];
  }
  const c = whiteDeck.pop();
  usedWhite.push(c);
  return c;
}

function ensureHands(){
  for (const p of playersById.values()){
    if (!Array.isArray(p.hand)) p.hand = [];
    while (p.hand.length < settings.handSize){
      const w = drawWhite();
      if (!w) break;
      p.hand.push(w.text);
    }
  }
}

function topLeaders(){
  let top = -Infinity;
  for (const p of playersById.values()){
    if (p.score > top) top = p.score;
  }
  if (top <= 0) return [];
  const leaders = [];
  for (const p of playersById.values()){
    if (p.score === top) leaders.push(p.id);
  }
  return leaders;
}

function rotateJudge(){
  const ordered = Array.from(playersById.keys());
  if (ordered.length === 0){
    judgeId = null;
    return;
  }
  if (!judgeId || !ordered.includes(judgeId)){
    judgeId = ordered[0];
    return;
  }
  const idx = ordered.indexOf(judgeId);
  judgeId = ordered[(idx + 1) % ordered.length];
}

function clearTimers(){
  if (phaseTimer) clearTimeout(phaseTimer);
  if (tickTimer) clearInterval(tickTimer);
  phaseTimer = null;
  tickTimer = null;
}

function setPhase(newPhase, seconds){
  phase = newPhase;
  phaseEndTs = seconds > 0 ? nowTs() + seconds * 1000 : 0;

  clearTimers();

  if (seconds > 0){
    phaseTimer = setTimeout(() => onPhaseTimeout(newPhase), seconds * 1000);
    tickTimer = setInterval(() => {
      io.emit("phase_timer", { phase, endTs: phaseEndTs });
    }, 1000);
  }

  io.emit("phase_timer", { phase, endTs: phaseEndTs });
}

function broadcastState(){
  const players = Array.from(playersById.values()).map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isAdmin: p.isAdmin === true
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
    players
  });
}

function broadcastHandsToEachPlayer(){
  for (const p of playersById.values()){
    if (!p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) continue;
    sock.emit("hand", { hand: p.hand.slice() });
  }
}

function addChat(entry){
  chatLog.push(entry);
  while (chatLog.length > CHAT_MAX) chatLog.shift();
  io.emit("chat_update", { entry });
}

function sendChatHistory(socket){
  socket.emit("chat_history", { log: chatLog.slice() });
}

// =====================================================
// ROUND FLOW
// =====================================================
function startNewRound(){
  if (playersById.size < 2){
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
  if (!currentBlack){
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
}

function finishPlayPhaseToJudging(){
  // auto-submit for all non-judge missing submissions
  for (const p of playersById.values()){
    if (p.id === judgeId) continue;
    if (!p.hand || p.hand.length === 0) continue;
    if (submissions.has(p.id)) continue;

    const pick = randPick(p.hand);
    if (pick){
      const idx = p.hand.indexOf(pick);
      if (idx >= 0) p.hand.splice(idx, 1);
      submissions.set(p.id, { cardText: pick, fromAuto: true });
      addChat(systemMsg(`${p.name} auto-submitted.`));
    }
  }

  if (submissions.size === 0){
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

  const list = Array.from(submissions.entries()).map(([pid, s]) => ({ id: pid, text: s.cardText }));
  shuffle(list);
  io.emit("submissions_reveal", { list });
}

function pickWinner(pid){
  if (!submissions.has(pid)) return false;

  winnerId = pid;
  const winner = playersById.get(pid);
  if (winner) winner.score += 1;

  addChat(systemMsg(`${winner ? winner.name : "Someone"} won the round.`));

  const limit = settings.scoreLimit;
  if (limit > 0 && winner && winner.score >= limit){
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

function onPhaseTimeout(whichPhase){
  if (phase === PHASES.PAUSED) return;

  if (whichPhase === PHASES.PLAY && phase === PHASES.PLAY){
    finishPlayPhaseToJudging();
    return;
  }

  if (whichPhase === PHASES.JUDGE && phase === PHASES.JUDGE){
    const ids = Array.from(submissions.keys());
    const auto = randPick(ids);
    if (auto){
      addChat(systemMsg("Judge timed out. Auto-picking winner."));
      pickWinner(auto);
    } else {
      setPhase(PHASES.RESULTS, settings.resultsSeconds);
      broadcastState();
    }
    return;
  }

  if (whichPhase === PHASES.RESULTS && phase === PHASES.RESULTS){
    startNewRound();
    return;
  }
}

// =====================================================
// SERVER SETUP
// =====================================================
const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server);

rebuildDecks();

function emitPacksTo(socket){
  const packs = packsCache.map(p => ({
    id: p.id,
    name: p.name,
    blackCount: p.blackCount,
    whiteCount: p.whiteCount
  }));
  socket.emit("packs_list", { packs });
}

function currentSettingsPublic(){
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
// SOCKET
// =====================================================
io.on("connection", (socket) => {
  socket.emit("server_hello", { phase, roundNum, settings: currentSettingsPublic() });

  emitPacksTo(socket);
  sendChatHistory(socket);

  broadcastState();
  socket.emit("phase_timer", { phase, endTs: phaseEndTs });

  socket.on("set_identity", (payload) => {
    const playerId = safeStr(payload?.playerId, 64);
    const name = safeStr(payload?.name, 24);
    const adminKey = safeStr(payload?.adminKey, 64);

    if (!playerId || !name){
      socket.emit("error_msg", { msg: "Missing name or playerId." });
      return;
    }

    socketToPlayerId.set(socket.id, playerId);
    socket.data.playerId = playerId;

    let p = playersById.get(playerId);
    if (!p){
      p = { id: playerId, name, score: 0, hand: [], connected: true, socketId: socket.id, isAdmin: adminKey === ADMIN_KEY };
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
    socket.emit("settings", { settings: currentSettingsPublic() });
    socket.emit("hand", { hand: p.hand.slice() });

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

  // ADMIN SETTINGS
  socket.on("admin_set_settings", (payload) => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", { msg: "Admin only." });

    const enabledPacks = Array.isArray(payload?.enabledPacks)
      ? payload.enabledPacks.map(x => safeStr(x, 64)).filter(Boolean)
      : settings.enabledPacks;

    const scoreLimit = clampInt(payload?.scoreLimit, 1, 50, settings.scoreLimit);

    settings.enabledPacks = enabledPacks;
    settings.scoreLimit = scoreLimit;

    saveSettings(settings);

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();

    addChat(systemMsg("Admin updated settings."));
    io.emit("settings", { settings: currentSettingsPublic() });
    broadcastState();
  });

  socket.on("admin_clear_chat", () => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", { msg: "Admin only." });
    chatLog.length = 0;
    io.emit("chat_history", { log: [] });
    addChat(systemMsg("Chat cleared by admin."));
  });

  socket.on("admin_reset_game", () => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", { msg: "Admin only." });

    clearTimers();
    phase = PHASES.LOBBY;
    phaseBeforePause = PHASES.LOBBY;
    phaseEndTs = 0;

    roundNum = 0;
    judgeId = null;
    currentBlack = null;
    submissions = new Map();
    winnerId = null;

    for (const p of playersById.values()){
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
    if (!isAdminSocket(socket)) return socket.emit("error_msg", { msg: "Admin only." });

    if (phase === PHASES.PAUSED){
      // resume to a fresh full phase timer
      if (phaseBeforePause === PHASES.PLAY) setPhase(PHASES.PLAY, settings.playSeconds);
      else if (phaseBeforePause === PHASES.JUDGE) setPhase(PHASES.JUDGE, settings.judgeSeconds);
      else if (phaseBeforePause === PHASES.RESULTS) setPhase(PHASES.RESULTS, settings.resultsSeconds);
      else setPhase(phaseBeforePause, 0);

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

  // GAME CONTROL (ADMIN ONLY)
  socket.on("admin_start_game", () => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", { msg: "Admin only." });

    if (phase !== PHASES.LOBBY && phase !== PHASES.FINISHED){
      return socket.emit("error_msg", { msg: "Game already running." });
    }

    rebuildDecks();
    ensureHands();
    broadcastHandsToEachPlayer();
    addChat(systemMsg("Game started by admin."));
    startNewRound();
  });

  socket.on("admin_next_round", () => {
    if (!isAdminSocket(socket)) return socket.emit("error_msg", { msg: "Admin only." });
    if (phase === PHASES.PAUSED) return socket.emit("error_msg", { msg: "Cannot next round while paused." });

    addChat(systemMsg("Admin forced next round."));
    startNewRound();
  });

  // PLAYER SUBMIT
  socket.on("submit_card", (payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    if (phase !== PHASES.PLAY) return socket.emit("error_msg", { msg: "Not in play phase." });
    if (pid === judgeId) return socket.emit("error_msg", { msg: "Judge cannot submit." });

    const text = safeStr(payload?.text, 220);
    if (!text) return;

    const idx = p.hand.indexOf(text);
    if (idx < 0) return socket.emit("error_msg", { msg: "Card not in hand." });
    if (submissions.has(pid)) return socket.emit("error_msg", { msg: "Already submitted." });

    p.hand.splice(idx, 1);
    submissions.set(pid, { cardText: text, fromAuto: false });

    addChat(systemMsg(`${p.name} submitted.`));
    ensureHands();
    broadcastHandsToEachPlayer();
    broadcastState();

    const nonJudge = Array.from(playersById.values()).filter(x => x.id !== judgeId);
    if (nonJudge.length > 0 && submissions.size >= nonJudge.length){
      addChat(systemMsg("All submissions in. Moving to judging."));
      finishPlayPhaseToJudging();
    }
  });

  // JUDGE PICK
  socket.on("judge_pick", (payload) => {
    const pid = socket.data.playerId;
    const p = pid ? playersById.get(pid) : null;
    if (!p) return;

    if (phase !== PHASES.JUDGE) return socket.emit("error_msg", { msg: "Not in judging phase." });
    if (pid !== judgeId) return socket.emit("error_msg", { msg: "Only judge can pick." });

    const pickId = safeStr(payload?.winnerId, 64);
    if (!pickId) return;

    if (!pickWinner(pickId)) socket.emit("error_msg", { msg: "Invalid winner pick." });
  });

  socket.on("request_state", () => {
    broadcastState();
    socket.emit("settings", { settings: currentSettingsPublic() });
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
server.listen(PORT, "127.0.0.1", () => {
  console.log(`XyzzyModern running at http://127.0.0.1:${PORT}/`);
});
"@
Write-Utf8NoBom -Path (Join-Path $root "server.js") -Content $serverJs

# ============================================================
# public files (FULL) - small set for working run
# ============================================================
$gameCss = @"
:root{--bg0:#07080c;--bg1:#0d1020;--glass:rgba(255,255,255,0.06);--stroke:rgba(255,255,255,0.10);--text:#e9ecff;--muted:rgba(233,236,255,0.70);--green:rgba(34,255,72,0.85);--purple:rgba(140,64,255,0.75);--shadow:0 10px 40px rgba(0,0,0,0.45);}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--text);background:radial-gradient(1200px 800px at 10% 10%, rgba(140,64,255,0.12), transparent 60%),radial-gradient(900px 700px at 90% 20%, rgba(34,255,72,0.10), transparent 60%),linear-gradient(180deg,var(--bg0),var(--bg1));}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--stroke);background:rgba(0,0,0,0.20);backdrop-filter:blur(10px);position:sticky;top:0;z-index:10}
.brand{display:flex;align-items:center;gap:12px}.logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:900;letter-spacing:.08em;background:radial-gradient(circle at 20% 20%, rgba(34,255,72,0.35), transparent 55%),radial-gradient(circle at 80% 80%, rgba(140,64,255,0.35), transparent 55%),rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);box-shadow:var(--shadow)}
.h1{font-weight:900;letter-spacing:.03em}.h2{font-size:.85rem;color:var(--muted);margin-top:2px}
.right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.pill{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(233,236,255,0.85);font-size:.85rem}
.btn{appearance:none;border:1px solid rgba(34,255,72,0.55);background:radial-gradient(circle at 0 0, rgba(34,255,72,0.35), rgba(140,64,255,0.35));color:rgba(0,0,0,0.85);font-weight:900;letter-spacing:.08em;padding:10px 14px;border-radius:999px;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,0.35)}
.btn.ghost{background:rgba(255,255,255,0.06);color:rgba(233,236,255,0.88);border:1px solid rgba(255,255,255,0.16)}
.input{width:100%;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);color:var(--text);outline:none}
.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;padding:14px;max-width:1200px;margin:0 auto}
.card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:26px;padding:14px;box-shadow:var(--shadow);backdrop-filter:blur(10px)}
.cardTitle{font-weight:900;letter-spacing:.06em;margin-bottom:10px;color:rgba(233,236,255,0.90);display:flex;align-items:center;justify-content:space-between}
.blackCard{font-size:1.25rem;font-weight:900;line-height:1.25;padding:14px;border-radius:18px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.10)}
.players{display:flex;flex-direction:column;gap:8px}.playerRow{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.10)}
.playerName{font-weight:900}.playerMeta{color:rgba(233,236,255,0.70);font-size:.85rem}
.hand{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.whiteCard{padding:12px;border-radius:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);cursor:pointer;user-select:none;min-height:64px;display:flex;align-items:center;font-weight:800;line-height:1.2}
.whiteCard.disabled{opacity:.45;cursor:not-allowed}
.whiteCard:hover{border-color:rgba(34,255,72,0.55)}
.judgeBox{display:flex;flex-direction:column;gap:10px}
.judgePick{padding:12px;border-radius:18px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.12);cursor:pointer;font-weight:900}
.judgePick.disabled{opacity:.55;cursor:not-allowed}
.chatLog{height:260px;overflow:auto;padding:10px;border-radius:18px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.10);font-family:ui-monospace,Consolas,monospace;font-size:.88rem}
.chatLine{padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.08)}.chatSys{color:rgba(233,236,255,0.70)}.chatName{color:rgba(34,255,72,0.85);font-weight:900}
.chatRow{display:flex;gap:10px;margin-top:10px}
.footer{max-width:1200px;margin:0 auto;padding:18px 14px 28px;color:rgba(233,236,255,0.70);display:flex;align-items:center;justify-content:center;gap:10px}
@media(max-width:980px){.grid{grid-template-columns:1fr}.hand{grid-template-columns:1fr}}
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "game.css") -Content $gameCss

$indexHtml = @"
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>XyzzyModern</title><link rel="stylesheet" href="/game.css"/></head>
<body>
<header class="topbar"><div class="brand"><div class="logo">XM</div><div class="titles"><div class="h1">XyzzyModern</div><div class="h2">Full Game UI</div></div></div>
<div class="right"><div class="pill" id="phasePill">Phase: --</div><div class="pill" id="timerPill">Timer: --</div><div id="adminControls"><button class="btn ghost" id="pauseBtn">Pause</button><button class="btn ghost" id="resetBtn">Reset</button><button class="btn" id="startGameBtn">Start</button><button class="btn" id="nextRoundBtn">Next Round</button></div></div></header>
<main class="grid">
<section class="card"><div class="cardTitle">Black Card</div><div class="blackCard" id="blackCard">Waiting…</div><div class="playerMeta" id="judgeLine">Judge: --</div><div class="playerMeta" id="roundLine">Round: 0</div></section>
<section class="card"><div class="cardTitle">Players</div><div class="players" id="players"></div></section>
<section class="card"><div class="cardTitle">Your Hand</div><div class="hand" id="hand"></div></section>
<section class="card"><div class="cardTitle">Judging</div><div class="judgeBox" id="judgeBox"></div></section>
<section class="card" style="grid-column:1/-1"><div class="cardTitle">Chat <button class="btn ghost" id="clearChatBtn">Clear</button></div><div class="chatLog" id="chatLog"></div><div class="chatRow"><input class="input" id="chatInput" placeholder="Say something…" maxlength="220"/><button class="btn" id="chatSendBtn">Send</button></div></section>
</main>
<footer class="footer"><a href="/lobby.html">Lobby</a> • <a href="/game.html">Minimal</a> • <a href="/packs.html">Packs</a></footer>
<script src="/socket.io/socket.io.js"></script><script src="/game.js"></script></body></html>
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "index.html") -Content $indexHtml

$gameHtml = @"
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>XyzzyModern - Minimal</title><link rel="stylesheet" href="/game.css"/></head>
<body>
<header class="topbar"><div class="brand"><div class="logo">XM</div><div class="titles"><div class="h1">XyzzyModern</div><div class="h2">Minimal UI</div></div></div>
<div class="right"><div class="pill" id="phasePill">Phase: --</div><div class="pill" id="timerPill">Timer: --</div><div id="adminControls"><button class="btn" id="startGameBtn">Start</button><button class="btn" id="nextRoundBtn">Next</button></div></div></header>
<main class="grid" style="grid-template-columns:1fr"><section class="card"><div class="cardTitle">Black Card</div><div class="blackCard" id="blackCard">Waiting…</div><div class="playerMeta" id="judgeLine">Judge: --</div><div class="playerMeta" id="roundLine">Round: 0</div></section>
<section class="card"><div class="cardTitle">Hand</div><div class="hand" id="hand"></div></section>
<section class="card"><div class="cardTitle">Judging</div><div class="judgeBox" id="judgeBox"></div></section></main>
<footer class="footer"><a href="/lobby.html">Lobby</a> • <a href="/">Full</a> • <a href="/packs.html">Packs</a></footer>
<script src="/socket.io/socket.io.js"></script><script src="/game.js"></script></body></html>
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "game.html") -Content $gameHtml

$lobbyHtml = @"
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>XyzzyModern - Lobby</title><link rel="stylesheet" href="/game.css"/></head>
<body>
<header class="topbar"><div class="brand"><div class="logo">XM</div><div class="titles"><div class="h1">XyzzyModern</div><div class="h2">Lobby</div></div></div>
<div class="right"><a href="/">Full</a> • <a href="/game.html">Minimal</a> • <a href="/packs.html">Packs</a></div></header>
<main class="grid" style="grid-template-columns:1fr 1fr;max-width:1100px">
<section class="card"><div class="cardTitle">Join</div><div class="playerMeta">Player name</div><input class="input" id="nameInput" maxlength="24" placeholder="Joker92"/>
<div class="playerMeta" style="margin-top:10px">Admin key (optional)</div><input class="input" id="adminKeyInput" maxlength="64" placeholder="kmadmin"/>
<div class="chatRow" style="margin-top:12px"><button class="btn" id="joinBtn">Join</button><button class="btn ghost" id="goFullBtn">Go Full</button></div>
<div class="playerMeta" style="margin-top:10px">Refresh keeps your name & score.</div></section>
<section class="card"><div class="cardTitle">Status</div><div class="pill" id="statusPill">Connecting…</div><div class="playerMeta" id="phaseLine">Phase: --</div><div class="playerMeta" id="roundLine">Round: --</div><div class="playerMeta" id="playersLine">Players: --</div><div class="playerMeta" id="leadersLine">Leaders: --</div></section>
<section class="card" style="grid-column:1/-1"><div class="cardTitle">Chat Preview</div><div class="chatLog" id="chatLog"></div></section>
</main>
<script src="/socket.io/socket.io.js"></script><script src="/lobby.js"></script></body></html>
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "lobby.html") -Content $lobbyHtml

$packsHtml = @"
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>XyzzyModern - Packs</title><link rel="stylesheet" href="/game.css"/></head>
<body>
<header class="topbar"><div class="brand"><div class="logo">XM</div><div class="titles"><div class="h1">XyzzyModern</div><div class="h2">Packs (Admin)</div></div></div>
<div class="right"><a href="/lobby.html">Lobby</a> • <a href="/">Full</a></div></header>
<main class="grid" style="grid-template-columns:360px 1fr;max-width:1200px">
<section class="card"><div class="cardTitle">Admin</div><div class="playerMeta">Admin key</div><input class="input" id="adminKeyInput" maxlength="64" placeholder="kmadmin"/>
<div class="playerMeta" style="margin-top:10px">Score limit</div><input class="input" id="scoreLimitInput" type="number" min="1" max="50" value="7"/>
<div class="chatRow" style="margin-top:12px;flex-wrap:wrap"><button class="btn" id="saveBtn">Save</button><button class="btn ghost" id="selectAllBtn">Select All</button><button class="btn ghost" id="selectNoneBtn">Select None</button></div>
<div class="playerMeta" id="saveHint" style="margin-top:10px">Settings save to settings.json</div></section>
<section class="card"><div class="cardTitle">Packs</div><div id="packsList"></div></section>
</main>
<script src="/socket.io/socket.io.js"></script><script src="/packs.js"></script></body></html>
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "packs.html") -Content $packsHtml

# ============================================================
# JS (FULL) - game.js, lobby.js, packs.js
# ============================================================
$gameJs = @"
"use strict";
const socket = io();
function qs(id){ return document.getElementById(id); }

const els = {
  phasePill: qs("phasePill"),
  timerPill: qs("timerPill"),
  blackCard: qs("blackCard"),
  judgeLine: qs("judgeLine"),
  roundLine: qs("roundLine"),
  players: qs("players"),
  hand: qs("hand"),
  judgeBox: qs("judgeBox"),
  chatLog: qs("chatLog"),
  chatInput: qs("chatInput"),
  chatSendBtn: qs("chatSendBtn"),
  clearChatBtn: qs("clearChatBtn"),
  adminControls: qs("adminControls"),
  startGameBtn: qs("startGameBtn"),
  nextRoundBtn: qs("nextRoundBtn"),
  resetBtn: qs("resetBtn"),
  pauseBtn: qs("pauseBtn"),
};

const state = {
  playerId: null,
  name: null,
  adminKey: null,
  isAdmin: false,
  phase: "lobby",
  endTs: 0,
  roundNum: 0,
  judgeId: null,
  currentBlack: null,
  players: [],
  leaders: [],
  hand: [],
  submissionsList: []
};

function getOrCreatePlayerId(){
  const k = "xm_player_id";
  let v = localStorage.getItem(k);
  if (!v){
    v = "p_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
    localStorage.setItem(k, v);
  }
  return v;
}
function getSavedName(){ return localStorage.getItem("xm_name") || ""; }
function setSavedName(name){ localStorage.setItem("xm_name", name); }
function getSavedAdminKey(){ return localStorage.getItem("xm_admin_key") || ""; }

function ensureIdentity(){
  state.playerId = getOrCreatePlayerId();

  if (!getSavedName()){
    const n = prompt("Enter your player name (max 24):") || "";
    const nm = n.trim().slice(0,24);
    if (nm) setSavedName(nm);
  }

  state.name = getSavedName().trim().slice(0,24);
  if (!state.name){
    state.name = "Player" + Math.floor(Math.random()*1000);
    setSavedName(state.name);
  }

  state.adminKey = getSavedAdminKey().trim().slice(0,64);

  socket.emit("set_identity", {
    playerId: state.playerId,
    name: state.name,
    adminKey: state.adminKey
  });
}

function findPlayerName(pid){
  const p = state.players.find(x => x.id === pid);
  return p ? p.name : "--";
}

function fmtSecondsLeft(){
  if (!state.endTs || state.endTs <= 0) return "--";
  const ms = state.endTs - Date.now();
  return String(Math.max(0, Math.ceil(ms / 1000)));
}

function renderTimer(){
  if (!els.timerPill) return;
  if (!state.endTs || state.endTs <= 0) els.timerPill.textContent = "Timer: --";
  else els.timerPill.textContent = "Timer: " + fmtSecondsLeft() + "s";
}

function renderPhase(){
  if (els.phasePill) els.phasePill.textContent = "Phase: " + (state.phase || "--");
}

function renderBlack(){
  if (els.blackCard) els.blackCard.textContent = state.currentBlack?.text || "Waiting…";
}

function renderMeta(){
  if (els.judgeLine) els.judgeLine.textContent = "Judge: " + (state.judgeId ? findPlayerName(state.judgeId) : "--");
  if (els.roundLine) els.roundLine.textContent = "Round: " + (state.roundNum || 0);
}

function renderPlayers(){
  if (!els.players) return;
  els.players.innerHTML = "";
  const leaders = new Set(state.leaders || []);
  for (const p of state.players){
    const row = document.createElement("div");
    row.className = "playerRow";
    const left = document.createElement("div");
    left.className = "playerName";
    left.textContent = p.name + (leaders.has(p.id) ? " 👑" : "");
    const right = document.createElement("div");
    right.className = "playerMeta";
    right.textContent = "score " + p.score + (p.connected ? "" : " (off)");
    row.appendChild(left);
    row.appendChild(right);
    els.players.appendChild(row);
  }
}

function canSubmit(){
  if (state.phase !== "play") return false;
  if (!state.playerId) return false;
  if (state.playerId === state.judgeId) return false;
  return true;
}

function renderHand(){
  if (!els.hand) return;
  els.hand.innerHTML = "";
  const allow = canSubmit();
  for (const text of state.hand){
    const card = document.createElement("div");
    card.className = "whiteCard" + (allow ? "" : " disabled");
    card.textContent = text;
    if (allow){
      card.addEventListener("click", () => socket.emit("submit_card", { text }));
    }
    els.hand.appendChild(card);
  }
}

function canJudgePick(){
  return state.phase === "judge" && state.playerId === state.judgeId;
}

function renderJudgeBox(){
  if (!els.judgeBox) return;
  els.judgeBox.innerHTML = "";
  if (state.phase !== "judge" && state.phase !== "results" && state.phase !== "finished"){
    els.judgeBox.textContent = "Waiting for judging…";
    return;
  }
  if (!state.submissionsList || state.submissionsList.length === 0){
    els.judgeBox.textContent = "No submissions.";
    return;
  }
  const allow = canJudgePick();
  for (const s of state.submissionsList){
    const pick = document.createElement("div");
    pick.className = "judgePick" + (allow ? "" : " disabled");
    pick.textContent = s.text;
    if (allow){
      pick.addEventListener("click", () => socket.emit("judge_pick", { winnerId: s.id }));
    }
    els.judgeBox.appendChild(pick);
  }
}

function appendChatLine(entry){
  if (!els.chatLog) return;
  const line = document.createElement("div");
  line.className = "chatLine";
  if (entry.type === "system"){
    line.classList.add("chatSys");
    line.textContent = "[" + new Date(entry.ts).toLocaleTimeString() + "] " + entry.text;
  } else {
    const name = document.createElement("span");
    name.className = "chatName";
    name.textContent = entry.name + ": ";
    const text = document.createElement("span");
    text.textContent = entry.text;
    line.appendChild(name);
    line.appendChild(text);
  }
  els.chatLog.appendChild(line);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function setAdminUI(){
  if (!els.adminControls) return;
  els.adminControls.style.display = state.isAdmin ? "" : "none";
  if (els.clearChatBtn) els.clearChatBtn.style.display = state.isAdmin ? "" : "none";
}

function hookChat(){
  if (els.chatSendBtn && els.chatInput){
    els.chatSendBtn.addEventListener("click", () => {
      const t = (els.chatInput.value || "").trim().slice(0,220);
      if (!t) return;
      socket.emit("chat_send", { text: t });
      els.chatInput.value = "";
      els.chatInput.focus();
    });
    els.chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") els.chatSendBtn.click(); });
  }
  if (els.clearChatBtn){
    els.clearChatBtn.addEventListener("click", () => socket.emit("admin_clear_chat"));
  }
}

function hookAdminButtons(){
  if (els.startGameBtn) els.startGameBtn.addEventListener("click", () => socket.emit("admin_start_game"));
  if (els.nextRoundBtn) els.nextRoundBtn.addEventListener("click", () => socket.emit("admin_next_round"));
  if (els.resetBtn) els.resetBtn.addEventListener("click", () => socket.emit("admin_reset_game"));
  if (els.pauseBtn) els.pauseBtn.addEventListener("click", () => socket.emit("admin_pause_toggle"));
}

socket.on("connect", () => {
  ensureIdentity();
  socket.emit("request_state");
});

socket.on("admin_status", ({ isAdmin }) => {
  state.isAdmin = !!isAdmin;
  setAdminUI();
});

socket.on("phase_timer", ({ phase, endTs }) => {
  state.phase = phase;
  state.endTs = endTs || 0;
  renderPhase();
  renderTimer();
  renderHand();
  renderJudgeBox();
});

socket.on("state", (payload) => {
  state.phase = payload.phase;
  state.roundNum = payload.roundNum;
  state.judgeId = payload.judgeId;
  state.currentBlack = payload.currentBlack;
  state.players = payload.players || [];
  state.leaders = payload.leaders || [];
  renderPhase(); renderBlack(); renderMeta(); renderPlayers(); renderHand(); renderJudgeBox();
});

socket.on("black_card", ({ card }) => { state.currentBlack = card; renderBlack(); });

socket.on("hand", ({ hand }) => { state.hand = Array.isArray(hand) ? hand : []; renderHand(); });

socket.on("chat_history", ({ log }) => {
  if (!els.chatLog) return;
  els.chatLog.innerHTML = "";
  for (const entry of (log || [])) appendChatLine(entry);
});

socket.on("chat_update", ({ entry }) => appendChatLine(entry));

socket.on("submissions_reveal", ({ list }) => {
  state.submissionsList = Array.isArray(list) ? list : [];
  renderJudgeBox();
});

socket.on("round_result", (payload) => {
  state.submissionsList = Array.isArray(payload?.submissions)
    ? payload.submissions.map(x => ({ id: x.id, text: x.text }))
    : state.submissionsList;
  renderJudgeBox();
});

socket.on("error_msg", ({ msg }) => console.log("Server:", msg));

hookChat();
hookAdminButtons();
setAdminUI();
setInterval(renderTimer, 1000);
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "game.js") -Content $gameJs

$lobbyJs = @"
"use strict";
const socket = io();
function qs(id){ return document.getElementById(id); }

const els = {
  nameInput: qs("nameInput"),
  adminKeyInput: qs("adminKeyInput"),
  joinBtn: qs("joinBtn"),
  goFullBtn: qs("goFullBtn"),
  statusPill: qs("statusPill"),
  phaseLine: qs("phaseLine"),
  roundLine: qs("roundLine"),
  playersLine: qs("playersLine"),
  leadersLine: qs("leadersLine"),
  chatLog: qs("chatLog")
};

const state = { playerId:null, players:[], leaders:[], phase:"lobby", roundNum:0 };

function getOrCreatePlayerId(){
  const k="xm_player_id";
  let v=localStorage.getItem(k);
  if(!v){ v="p_"+Math.random().toString(16).slice(2)+"_"+Date.now().toString(16); localStorage.setItem(k,v); }
  return v;
}

function loadSaved(){
  els.nameInput.value = localStorage.getItem("xm_name") || "";
  els.adminKeyInput.value = localStorage.getItem("xm_admin_key") || "";
}

function save(){
  localStorage.setItem("xm_name", (els.nameInput.value||"").trim().slice(0,24));
  localStorage.setItem("xm_admin_key", (els.adminKeyInput.value||"").trim().slice(0,64));
}

function join(){
  save();
  state.playerId = getOrCreatePlayerId();
  const name = (localStorage.getItem("xm_name")||"").trim().slice(0,24);
  const adminKey = (localStorage.getItem("xm_admin_key")||"").trim().slice(0,64);
  if(!name){ alert("Enter a name."); return; }
  socket.emit("set_identity", { playerId: state.playerId, name, adminKey });
  els.statusPill.textContent = "Joined as " + name;
}

function renderStatus(){
  els.phaseLine.textContent = "Phase: " + state.phase;
  els.roundLine.textContent = "Round: " + state.roundNum;
  els.playersLine.textContent = "Players: " + (state.players?.length||0);
  const leaders = (state.leaders||[]).map(id => {
    const p = state.players.find(x => x.id === id);
    return p ? p.name : id;
  });
  els.leadersLine.textContent = "Leaders: " + (leaders.length ? leaders.join(", ") : "--");
}

function appendChat(entry){
  const line=document.createElement("div");
  line.className="chatLine";
  if(entry.type==="system"){ line.classList.add("chatSys"); line.textContent="[" + new Date(entry.ts).toLocaleTimeString() + "] " + entry.text; }
  else { const n=document.createElement("span"); n.className="chatName"; n.textContent=entry.name + ": "; const t=document.createElement("span"); t.textContent=entry.text; line.appendChild(n); line.appendChild(t); }
  els.chatLog.appendChild(line);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

socket.on("connect", () => { els.statusPill.textContent="Connected"; });
socket.on("disconnect", () => { els.statusPill.textContent="Disconnected"; });

socket.on("state", (payload) => {
  state.phase = payload.phase;
  state.roundNum = payload.roundNum;
  state.players = payload.players || [];
  state.leaders = payload.leaders || [];
  renderStatus();
});

socket.on("chat_history", ({ log }) => {
  els.chatLog.innerHTML="";
  for(const entry of (log||[])) appendChat(entry);
});
socket.on("chat_update", ({ entry }) => appendChat(entry));

els.joinBtn.addEventListener("click", join);
els.goFullBtn.addEventListener("click", () => window.location.href="/");
els.nameInput.addEventListener("keydown", (e) => { if(e.key==="Enter") join(); });
els.adminKeyInput.addEventListener("keydown", (e) => { if(e.key==="Enter") join(); });

loadSaved();
renderStatus();
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "lobby.js") -Content $lobbyJs

$packsJs = @"
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
  saveHint: qs("saveHint")
};

const state = { packs:[], enabledPacks:[], isAdmin:false };

function loadSaved(){ els.adminKeyInput.value = localStorage.getItem("xm_admin_key") || ""; }
function saveAdminKey(){ localStorage.setItem("xm_admin_key", (els.adminKeyInput.value||"").trim().slice(0,64)); }

function sendIdentity(){
  const playerId = localStorage.getItem("xm_player_id") || ("p_" + Math.random().toString(16).slice(2));
  localStorage.setItem("xm_player_id", playerId);
  const name = (localStorage.getItem("xm_name") || "Admin").trim().slice(0,24);
  const adminKey = (localStorage.getItem("xm_admin_key") || "").trim().slice(0,64);
  socket.emit("set_identity", { playerId, name, adminKey });
}

function setHint(t,bad){
  els.saveHint.textContent = t;
  els.saveHint.style.color = bad ? "rgba(255,70,70,0.90)" : "rgba(233,236,255,0.70)";
}

function renderPacks(){
  els.packsList.innerHTML="";
  const enabled = new Set(state.enabledPacks || []);
  for(const p of state.packs){
    const row = document.createElement("div");
    row.className = "playerRow";
    const left = document.createElement("div");
    left.className = "playerName";
    left.textContent = p.name + " (" + p.blackCount + "/" + p.whiteCount + ")";
    const toggle = document.createElement("input");
    toggle.type="checkbox";
    toggle.checked = enabled.has(p.id);
    toggle.addEventListener("change", () => {
      const set = new Set(state.enabledPacks || []);
      if(toggle.checked) set.add(p.id); else set.delete(p.id);
      state.enabledPacks = Array.from(set);
    });
    row.appendChild(left);
    row.appendChild(toggle);
    els.packsList.appendChild(row);
  }
}

socket.on("packs_list", ({ packs }) => { state.packs = packs || []; renderPacks(); });

socket.on("settings", ({ settings }) => {
  state.enabledPacks = Array.isArray(settings.enabledPacks) ? settings.enabledPacks : [];
  els.scoreLimitInput.value = settings.scoreLimit || 7;
  if(!state.enabledPacks || state.enabledPacks.length === 0){
    state.enabledPacks = (state.packs || []).map(p => p.id);
  }
  renderPacks();
});

socket.on("admin_status", ({ isAdmin }) => {
  state.isAdmin = !!isAdmin;
  setHint(state.isAdmin ? "Admin confirmed." : "Not admin. Enter key and Save.", !state.isAdmin);
});

socket.on("error_msg", ({ msg }) => setHint(msg || "Error", true));

els.saveBtn.addEventListener("click", () => {
  saveAdminKey();
  sendIdentity();
  const scoreLimit = Number(els.scoreLimitInput.value || 7);
  socket.emit("admin_set_settings", { enabledPacks: state.enabledPacks || [], scoreLimit });
  setHint("Saving…", false);
});

els.selectAllBtn.addEventListener("click", () => { state.enabledPacks = (state.packs || []).map(p => p.id); renderPacks(); });
els.selectNoneBtn.addEventListener("click", () => { state.enabledPacks = []; renderPacks(); });

socket.on("connect", () => { loadSaved(); sendIdentity(); socket.emit("request_state"); });
"@
Write-Utf8NoBom -Path (Join-Path $publicDir "packs.js") -Content $packsJs

# ============================================================
# Settings + package.json (FULL)
# ============================================================
$settingsJson = @"
{
  "enabledPacks": [],
  "scoreLimit": 7,
  "playSeconds": 35,
  "judgeSeconds": 25,
  "resultsSeconds": 10,
  "handSize": 10
}
"@
Write-Utf8NoBom -Path (Join-Path $root "settings.json") -Content $settingsJson

$packageJson = @"
{
  "name": "xyzzymodern",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  }
}
"@
Write-Utf8NoBom -Path (Join-Path $root "package.json") -Content $packageJson

# ============================================================
# Packs (FULL) - safe placeholder packs
# ============================================================
$corePack = @"
{
  "name": "Core Clean",
  "blackCards": [
    { "text": "I never leave home without ____.", "pick": 1 },
    { "text": "My secret talent is ____.", "pick": 1 },
    { "text": "The worst thing to hear at 3am is ____.", "pick": 1 }
  ],
  "whiteCards": [
    "a suspiciously warm toaster",
    "ten kilos of spaghetti",
    "an emotional support cactus",
    "a haunted Bluetooth speaker"
  ]
}
"@
Write-Utf8NoBom -Path (Join-Path $packsDir "core_clean.json") -Content $corePack

$horrorPack = @"
{
  "name": "Horror (Non-Sexual)",
  "blackCards": [
    { "text": "The note on the fridge said: ____.", "pick": 1 },
    { "text": "I opened the closet and found ____ staring back.", "pick": 1 }
  ],
  "whiteCards": [
    "a smile in the dark",
    "footsteps above the ceiling",
    "a door that wasn't there yesterday",
    "the attic whispering my name"
  ]
}
"@
Write-Utf8NoBom -Path (Join-Path $packsDir "horror_clean.json") -Content $horrorPack

Write-Host "`n✅ APPLY-ALL-PS7 complete."
Write-Host "Next:"
Write-Host "  npm install"
Write-Host "  node .\server.js"
Write-Host "Open:"
Write-Host "  Lobby: http://127.0.0.1:3000/lobby.html"
Write-Host "  Full:  http://127.0.0.1:3000/"
Write-Host "  Mini:  http://127.0.0.1:3000/game.html"
Write-Host "  Packs: http://127.0.0.1:3000/packs.html"