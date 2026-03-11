const fs = require('fs');
const zlib = require('zlib');

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('usage: node scripts/extract_pdf_stream_text.js <pdf>'); process.exit(1); }

const buf = fs.readFileSync(pdfPath);
const text = buf.toString('binary');

const out = [];

function decodePdfString(s){
  return s
    .replace(/\\\\/g,'\\')
    .replace(/\\\(/g,'(')
    .replace(/\\\)/g,')')
    .replace(/\\r/g,'\r')
    .replace(/\\n/g,'\n')
    .replace(/\\t/g,'\t')
    .replace(/\\b/g,'\b')
    .replace(/\\f/g,'\f');
}

const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let m;
while ((m = streamRe.exec(text)) !== null) {
  const raw = Buffer.from(m[1], 'binary');
  const candidates = [raw];
  try { candidates.push(zlib.inflateSync(raw)); } catch {}
  try { candidates.push(zlib.inflateRawSync(raw)); } catch {}

  for (const c of candidates) {
    const s = c.toString('latin1');
    // simple PDF text operands (...) Tj and arrays for TJ
    const re1 = /\(([^()]|\\\(|\\\)|\\\\)*\)\s*Tj/g;
    let a;
    while ((a = re1.exec(s)) !== null) {
      const inner = a[0].replace(/\)\s*Tj$/,'').slice(1);
      const d = decodePdfString(inner).trim();
      if (d) out.push(d);
    }

    const re2 = /\[(.*?)\]\s*TJ/g;
    let b;
    while ((b = re2.exec(s)) !== null) {
      const arr = b[1];
      const parts = [];
      const pRe = /\(([^()]|\\\(|\\\)|\\\\)*\)/g;
      let p;
      while ((p = pRe.exec(arr)) !== null) {
        const d = decodePdfString(p[0].slice(1,-1));
        if (d) parts.push(d);
      }
      const joined = parts.join('').trim();
      if (joined) out.push(joined);
    }
  }
}

const uniq = Array.from(new Set(out.map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)));
for (const line of uniq) console.log(line);
