const fs = require('fs');
const path = require('path');

const src = 'C:/Users/tiliq/OneDrive/Documents/CAH Card lists/HorriblePack_Cards_Against_Horror.txt';
const outPath = path.resolve('packs/cah_import_horriblepack_cards_against_horror.json');
const packsDir = path.resolve('packs');

function norm(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
function key(s){ return norm(s).toLowerCase(); }

const existingBlack = new Set();
const existingWhite = new Set();
for (const f of fs.readdirSync(packsDir)) {
  if (!f.toLowerCase().endsWith('.json')) continue;
  const p = path.join(packsDir, f);
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const b of (j.blackCards||[])) {
      const t = typeof b === 'string' ? b : b?.text;
      if (norm(t)) existingBlack.add(key(t));
    }
    for (const w of (j.whiteCards||[])) {
      if (norm(w)) existingWhite.add(key(w));
    }
  } catch {}
}

const raw = fs.readFileSync(src,'utf8');
let lines = raw.split(/\r?\n/).map(norm).filter(Boolean);

// Remove obvious OCR artifacts/header tokens
lines = lines
  .filter((l) => !/^®?$/.test(l))
  .filter((l) => !/^ee\b/i.test(l))
  .filter((l) => !/^HORRIBLEMAKER\b/i.test(l))
  .filter((l) => !/CARDS AGAINST HORROR/i.test(l));

const black = [];
const white = [];
const localB = new Set();
const localW = new Set();

function pushBlack(t){
  let s = norm(t);
  if (!s) return;
  // normalize pick-2 OCR fragment
  if (/^pick\s*2/i.test(s)) {
    s = 'PICK 2 - The last thing I Googled before being eaten by ___ was ___.';
  }
  if (/make a haiku\.?$/i.test(s)) return; // requested removal style
  if (!s.includes('___')) {
    if (/\?$/.test(s)) s = s.replace(/\?$/, ' ___?');
    else if (/:\s*$/.test(s)) s = s + ' ___.';
    else s = s.replace(/[.!]?$/, '') + ' ___.';
  }
  const k = key(s);
  if (localB.has(k) || existingBlack.has(k)) return;
  localB.add(k);
  black.push(s);
}

function pushWhite(t){
  const s = norm(t).replace(/[.]$/, '');
  if (!s || s.length < 3) return;
  if (/^pick\s*2/i.test(s)) return;
  const k = key(s);
  if (localW.has(k) || existingWhite.has(k)) return;
  localW.add(k);
  white.push(s);
}

// Build candidate phrases from lines.
for (const l of lines) {
  if (/pick\s*2/i.test(l) || /\?$/.test(l) || /:\s*$/.test(l) || /ouija/i.test(l)) {
    pushBlack(l);
  } else {
    pushWhite(l);
  }
}

// Try to recover multi-line black prompt present in OCR body.
const body = norm(lines.join(' '));
if (/ouija board spelled/i.test(body)) {
  pushBlack('After the Ouija board spelled "HELP", the real monster showed up: ___.');
}
if (/last thing i googled/i.test(body) && /before being eaten by/i.test(body)) {
  pushBlack('PICK 2 - The last thing I Googled before being eaten by ___ was ___.');
}

const payload = {
  name: 'HorriblePack Cards Against Horror',
  blackCards: black,
  whiteCards: white
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ outPath, black: black.length, white: white.length }, null, 2));
