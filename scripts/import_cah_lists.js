const fs = require("fs");
const path = require("path");

const srcDir = "C:/Users/tiliq/OneDrive/Documents/CAH Card lists";
const outDir = path.resolve("packs");

const files = fs.readdirSync(srcDir)
  .filter((f) => /\.txt$/i.test(f))
  .sort((a, b) => a.localeCompare(b));

const globalBlack = new Set();
const globalWhite = new Set();
const report = [];

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function keyOf(s) {
  return normSpace(s).toLowerCase();
}

function cleanLine(line) {
  let s = normSpace(line);
  if (!s) return "";
  s = s.replace(/^[-*•]\s+/, "");
  s = s.replace(/^\d+[\)\].:-]?\s+/, "");
  s = normSpace(s);
  if (!s) return "";

  const upper = s.toUpperCase();
  if (
    upper === "BLACK CARDS" ||
    upper === "WHITE CARDS" ||
    upper === "BLACK CARD" ||
    upper === "WHITE CARD" ||
    upper === "CARDS" ||
    upper === "CARD LIST" ||
    upper === "BLACK CARDS LIST" ||
    upper === "WHITE CARDS LIST"
  ) return "";

  if (/^page\s+\d+/i.test(s)) return "";
  if (/^https?:\/\//i.test(s)) return "";

  return s;
}

function isLikelyBlack(s) {
  return s.includes("___") || /\?$/.test(s);
}

function ensureBlackShape(s) {
  if (s.includes("___") || /\?$/.test(s)) return s;
  return s.replace(/[.!]?$/, "") + " ___.";
}

function titleFromBase(base) {
  return normSpace(base.replace(/[_-]+/g, " "));
}

function slugify(base) {
  return base
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

for (const file of files) {
  const full = path.join(srcDir, file);
  const raw = fs.readFileSync(full, "utf8");
  const lines = raw.split(/\r?\n/);

  const base = file.replace(/\.txt$/i, "");
  const packName = titleFromBase(base);
  const outName = `cah_import_${slugify(base)}.json`;
  const outPath = path.join(outDir, outName);

  let mode = null;
  if (/black/i.test(file) && !/white/i.test(file)) mode = "black";
  if (/white/i.test(file) && !/black/i.test(file)) mode = "white";

  const localBlack = [];
  const localWhite = [];
  const localBlackSet = new Set();
  const localWhiteSet = new Set();

  for (const line of lines) {
    const trimmed = normSpace(line);
    if (!trimmed) continue;

    if (/^black cards?\b/i.test(trimmed)) { mode = "black"; continue; }
    if (/^white cards?\b/i.test(trimmed)) { mode = "white"; continue; }

    const s = cleanLine(trimmed);
    if (!s) continue;
    if (s.length < 3) continue;

    let target = mode;
    if (!target) target = isLikelyBlack(s) ? "black" : "white";

    if (target === "black") {
      const card = ensureBlackShape(s);
      const k = keyOf(card);
      if (localBlackSet.has(k) || globalBlack.has(k)) continue;
      localBlackSet.add(k);
      globalBlack.add(k);
      localBlack.push(card);
    } else {
      const card = normSpace(s);
      const k = keyOf(card);
      if (localWhiteSet.has(k) || globalWhite.has(k)) continue;
      localWhiteSet.add(k);
      globalWhite.add(k);
      localWhite.push(card);
    }
  }

  if (localBlack.length === 0 && localWhite.length === 0) {
    report.push({ file, out: null, black: 0, white: 0, skipped: true });
    continue;
  }

  const payload = {
    name: packName,
    blackCards: localBlack,
    whiteCards: localWhite
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  report.push({ file, out: outName, black: localBlack.length, white: localWhite.length, skipped: false });
}

const reportPath = path.resolve("packs", "cah_import_report.json");
fs.writeFileSync(reportPath, JSON.stringify({ source: srcDir, totalTxtFiles: files.length, report }, null, 2) + "\n", "utf8");

const created = report.filter((r) => !r.skipped).length;
const totalBlack = report.reduce((n, r) => n + (r.black || 0), 0);
const totalWhite = report.reduce((n, r) => n + (r.white || 0), 0);
console.log(JSON.stringify({ created, totalBlack, totalWhite, reportPath }, null, 2));
