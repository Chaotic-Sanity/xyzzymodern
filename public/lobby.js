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