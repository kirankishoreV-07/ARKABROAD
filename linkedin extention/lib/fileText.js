'use strict';

// fileText.js — read text out of a resume file, entirely on this device (no upload, no AI).
//   • PDF  — inflates content streams and decodes text operators, using each font's
//            ToUnicode map (how Word, Google Docs, Canva and Chrome export text).
//   • DOCX — unzips word/document.xml and strips the markup.
//   • TXT  — as is.
// Scanned/image-only PDFs have no text layer; for those the caller falls back to Claude.

(function (root) {

  async function inflate(bytes, format) {
    const ds = new DecompressionStream(format || 'deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflateSafe(bytes) {
    try { return await inflate(bytes, 'deflate'); }
    catch (_) { try { return await inflate(bytes, 'deflate-raw'); } catch (__) { return null; } }
  }
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const toBytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

  // ── PDF ─────────────────────────────────────────────────────────────────────
  async function pdfText(u8) {
    const src = latin1(u8);
    const objs = new Map();   // num → { dict, data }

    // 1. Plain objects
    const objRe = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj/g;
    let m;
    while ((m = objRe.exec(src))) {
      const num = +m[1];
      let body = m[2];
      const si = body.search(/\bstream\r?\n/);
      let dict = body, data = null;
      if (si >= 0) {
        dict = body.slice(0, si);
        const start = si + body.slice(si).match(/^stream\r?\n/)[0].length;
        let end = body.lastIndexOf('endstream');
        let raw = body.slice(start, end).replace(/\r?\n$/, '');
        if (/\/FlateDecode/.test(dict)) {
          const out = await inflateSafe(toBytes(raw));
          data = out ? latin1(out) : '';
        } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)/.test(dict)) {
          data = raw;
        }
      }
      objs.set(num, { dict, data });
    }

    // 2. Objects packed inside object streams (/Type /ObjStm)
    for (const [, o] of [...objs]) {
      if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.data) continue;
      const n = +(o.dict.match(/\/N\s+(\d+)/) || [])[1] || 0;
      const first = +(o.dict.match(/\/First\s+(\d+)/) || [])[1] || 0;
      const header = o.data.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const num = header[i * 2], off = header[i * 2 + 1];
        const next = i + 1 < n ? header[(i + 1) * 2 + 1] : o.data.length - first;
        if (!objs.has(num)) objs.set(num, { dict: o.data.slice(first + off, first + next), data: null });
      }
    }

    const ref = (s) => { const r = String(s || '').match(/(\d+)\s+\d+\s+R/); return r ? objs.get(+r[1]) : null; };
    const dictOf = (s) => { const r = String(s || '').match(/^\s*(\d+)\s+\d+\s+R/); return r ? (objs.get(+r[1]) || {}).dict || '' : s; };

    // 3. Fonts → ToUnicode maps
    const cmapCache = new Map();
    function parseCMap(text) {
      const map = new Map();
      let bytes = 1;
      const cs = text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
      if (cs) bytes = Math.max(1, cs[1].length / 2);
      const hexToStr = (h) => { let s = ''; for (let i = 0; i + 3 < h.length + 1; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return s; };
      for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
        for (const p of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(p[1], 16), hexToStr(p[2]));
      }
      for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
        for (const p of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
          const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
          if (p[3][0] === '<') {
            const base = parseInt(p[3].slice(1, -1), 16);
            for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + (c - lo)));
          } else {
            const items = [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x => hexToStr(x[1]));
            items.forEach((s, i) => map.set(lo + i, s));
          }
        }
      }
      return { map, bytes };
    }
    function fontInfo(fontDict) {
      if (cmapCache.has(fontDict)) return cmapCache.get(fontDict);
      let info = { map: null, bytes: /\/Identity-H|\/Type0/.test(fontDict) ? 2 : 1 };
      const tu = ref((fontDict.match(/\/ToUnicode\s+(\d+\s+\d+\s+R)/) || [])[1]);
      if (tu && tu.data) { const c = parseCMap(tu.data); info = { map: c.map, bytes: c.bytes || info.bytes }; }
      cmapCache.set(fontDict, info);
      return info;
    }

    // 4. Pages in document order (follow the page tree from the catalog)
    const pages = [];
    const visit = (o, depth) => {
      if (!o || depth > 30) return;
      if (/\/Type\s*\/Page\b/.test(o.dict)) { pages.push(o); return; }
      const kids = (o.dict.match(/\/Kids\s*\[([^\]]*)\]/) || [])[1] || '';
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) visit(objs.get(+k[1]), depth + 1);
    };
    const catalog = [...objs.values()].find(o => /\/Type\s*\/Catalog/.test(o.dict));
    if (catalog) visit(ref((catalog.dict.match(/\/Pages\s+(\d+\s+\d+\s+R)/) || [])[1]), 0);
    if (!pages.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o);

    // 5. Decode each page's content stream
    const out = [];
    for (const page of pages) {
      let res = (page.dict.match(/\/Resources\s*(\d+\s+\d+\s+R|<<[\s\S]*)/) || [])[1] || '';
      res = dictOf(res);
      let fontsDict = (res.match(/\/Font\s*(\d+\s+\d+\s+R|<<[^>]*>>)/) || [])[1] || '';
      fontsDict = dictOf(fontsDict);
      const fonts = {};
      for (const f of fontsDict.matchAll(/\/([\w.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
        const fo = objs.get(+f[2]);
        if (fo) fonts[f[1]] = fontInfo(fo.dict);
      }
      const contentsSpec = (page.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/) || [])[1] || '';
      let content = '';
      for (const c of contentsSpec.matchAll(/(\d+)\s+\d+\s+R/g)) {
        const co = objs.get(+c[1]);
        if (co && co.data) content += co.data + '\n';
        else if (co && /^\s*\[/.test(co.dict)) for (const cc of co.dict.matchAll(/(\d+)\s+\d+\s+R/g)) { const x = objs.get(+cc[1]); if (x && x.data) content += x.data + '\n'; }
      }
      out.push(decodeContent(content, fonts));
    }
    return out.join('\n');
  }

  function decodeLiteral(s) {
    return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (m, c) => {
      if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8));
      return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? '';
    });
  }

  function decodeContent(content, fonts) {
    let font = null, text = '', lastY = null;
    const show = (raw) => {
      if (!font || !font.map) { text += raw.replace(/[^\x20-\x7E -ÿ\n]/g, ''); return; }
      const bytes = font.bytes || 1;
      for (let i = 0; i + bytes <= raw.length; i += bytes) {
        let code = 0;
        for (let b = 0; b < bytes; b++) code = (code << 8) | (raw.charCodeAt(i + b) & 255);
        const ch = font.map.get(code);
        if (ch != null) text += ch;
      }
    };
    const tok = /\/([\w.+-]+)\s+[-\d.]+\s+Tf|\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]*)>\s*Tj|\[((?:\\.|[^\]])*?)\]\s*TJ|([-\d.]+)\s+([-\d.]+)\s+T[dD]|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+Tm|T\*|ET/g;
    let m;
    while ((m = tok.exec(content))) {
      const t = m[0];
      if (m[1]) { font = fonts[m[1]] || null; continue; }
      if (t.startsWith('(')) {
        const lit = t.match(/^\(((?:\\.|[^\\)])*)\)/)[1];
        if (/'\s*$|"\s*$/.test(t)) text += '\n';
        show(decodeLiteral(lit));
      } else if (m[2] != null) {
        const hex = m[2].replace(/\s+/g, '');
        let raw = '';
        for (let i = 0; i < hex.length; i += 2) raw += String.fromCharCode(parseInt(hex.substr(i, 2).padEnd(2, '0'), 16));
        show(raw);
      } else if (m[3] != null) {
        for (const part of m[3].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]*)>|(-?[\d.]+)/g)) {
          if (part[1] != null) show(decodeLiteral(part[1]));
          else if (part[2] != null) {
            const hex = part[2].replace(/\s+/g, ''); let raw = '';
            for (let i = 0; i < hex.length; i += 2) raw += String.fromCharCode(parseInt(hex.substr(i, 2).padEnd(2, '0'), 16));
            show(raw);
          } else if (parseFloat(part[3]) < -180) text += ' ';
        }
      } else if (m[5] != null) {
        // Same-line moves are kerning/positioning (e.g. "T" + "amil"), not word breaks.
        if (Math.abs(parseFloat(m[5])) > 1) text += '\n';  // spaces come through as real glyphs
      } else if (m[6] != null) {
        const y = parseFloat(m[6]);
        if (lastY !== null && Math.abs(y - lastY) > 1) text += '\n';
        lastY = y;
      } else if (t === 'T*') text += '\n';
      else if (t === 'ET') { if (!/\n$/.test(text)) text += '\n'; }
    }
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }

  // ── DOCX ────────────────────────────────────────────────────────────────────
  async function docxText(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a valid .docx file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      if (name === 'word/document.xml') {
        const lnlen = dv.getUint16(local + 26, true), lelen = dv.getUint16(local + 28, true);
        const start = local + 30 + lnlen + lelen;
        const raw = u8.subarray(start, start + csize);
        const xmlBytes = method === 8 ? await inflate(raw, 'deflate-raw') : raw;
        const xml = new TextDecoder().decode(xmlBytes);
        return xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, '\n\n').trim();
      }
      p += 46 + nlen + elen + clen;
    }
    throw new Error('No document text found in .docx');
  }

  // ── Entry point ─────────────────────────────────────────────────────────────
  async function extract(file) {
    const name = String(file.name || '').toLowerCase();
    const u8 = new Uint8Array(await file.arrayBuffer());
    let text = '', kind = 'txt';
    if (name.endsWith('.pdf') || file.type === 'application/pdf') { kind = 'pdf'; text = await pdfText(u8); }
    else if (name.endsWith('.docx')) { kind = 'docx'; text = await docxText(u8); }
    else if (name.endsWith('.txt') || /^text\//.test(file.type || '')) text = new TextDecoder().decode(u8);
    else throw new Error('Please upload a PDF, DOCX or TXT file.');
    text = text.replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ').trim();
    const words = (text.match(/[A-Za-z]{2,}/g) || []).length;
    return { text, kind, words, readable: words >= 40 };
  }

  const api = { extract, pdfText, docxText };
  root.ArkFileText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
