/* Why did this photo not place its point on the map?
 *
 *     node scripts/diagnose_photo.js <file> [...]
 *
 * The app decides a photo's position in four steps, and any one of them can
 * end with "no usable location" while the photo looks fine in a gallery.  This
 * walks the same four steps in the same order and says which one stopped, so
 * the answer is a fact about the file rather than a guess about the code.
 *
 * The reader is lifted out of app.js as text and run as-is — the same trick
 * scripts/test_exif.js uses — so this cannot drift from what ships, and it
 * cannot accidentally test a second, kinder implementation.  That distinction
 * is the one section 11 of the architecture document was written about.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(APP, 'utf8');
const from = src.indexOf('function readExif(');
const to = src.indexOf('/* ---- making the stored copy ---- */');
if (from < 0 || to < 0 || to < from) throw new Error('cannot find the Exif reader in app.js');
const readExif = new Function(src.slice(from, to) + '\nreturn readExif;')();

const HEAD = 512 * 1024;          // app.js reads only this much: file.slice(0, 512*1024)

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/diagnose_photo.js <file> [...]');
  process.exit(2);
}

/* What the first bytes say the container is.  The app accepts image/* but the
   reader only understands JPEG, so this is the first thing worth knowing. */
function sniff(b) {
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'JPEG';
  if (b.length >= 12 && b.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.slice(8, 12).toString('latin1');
    if (/^(heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand)) return 'HEIC/HEIF (' + brand + ')';
    if (/^avif|avis$/.test(brand)) return 'AVIF (' + brand + ')';
    return 'ISO-BMFF (' + brand + ')';
  }
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF'
      && b.slice(8, 12).toString('latin1') === 'WEBP') return 'WebP';
  if (b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'PNG';
  if (b.length >= 4 && (b.slice(0, 4).toString('latin1') === 'II*\0' || b.slice(0, 4).toString('latin1') === 'MM\0*')) return 'TIFF';
  return 'unknown';
}

/* Walk the JPEG segments the way readExif does, but report instead of
   returning null, so a file that ends the walk early says where and why. */
function segments(b) {
  const out = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) { out.push({ at: i, note: `expected 0xFF, found 0x${b[i].toString(16)} — walk stops here` }); break; }
    const m = b[i + 1];
    if (m === 0xDA || m === 0xD9) { out.push({ at: i, marker: m, name: m === 0xDA ? 'SOS' : 'EOI', note: 'pixel data — no Exif before it' }); break; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) { out.push({ at: i, marker: m, note: `segment length ${len} is invalid — walk stops here` }); break; }
    const tag = b.slice(i + 4, i + 4 + 6).toString('latin1').replace(/\0/g, '.');
    out.push({ at: i, marker: m, name: markerName(m), len, tag });
    i += 2 + len;
    if (i > b.length) out.push({ at: i, note: `next segment starts at ${i}, past the ${b.length} bytes available — walk stops here` });
  }
  return out;
}
function markerName(m) {
  if (m >= 0xE0 && m <= 0xEF) return 'APP' + (m - 0xE0);
  return { 0xDB: 'DQT', 0xC0: 'SOF0', 0xC2: 'SOF2', 0xC4: 'DHT', 0xFE: 'COM' }[m] || '0x' + m.toString(16);
}

/* The exact shape gpsFrom() refuses, spelled out.  A phone with location
   tagging off does not omit GPSInfo — it writes the IFD in full with blank
   refs and 0/0 rationals, which reads naively as 0°N 0°E. */
function whyNoGps(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // find the APP1 Exif TIFF header the same way readExif does
  let i = 2, t = -1;
  while (i + 4 <= v.byteLength) {
    if (v.getUint8(i) !== 0xFF) break;
    const m = v.getUint8(i + 1);
    if (m === 0xDA || m === 0xD9) break;
    const len = v.getUint16(i + 2);
    if (len < 2) break;
    if (m === 0xE1 && i + 10 <= v.byteLength && v.getUint32(i + 4) === 0x45786966) { t = i + 10; break; }
    i += 2 + len;
  }
  if (t < 0) return 'no APP1 Exif segment in the bytes read';
  const le = v.getUint16(t) === 0x4949;
  const n0 = v.getUint16(t + v.getUint32(t + 4, le), le);
  const base = t + v.getUint32(t + 4, le);
  let gpsOff = 0;
  for (let k = 0; k < n0; k++) {
    const e = base + 2 + k * 12;
    if (e + 12 > v.byteLength) break;
    if (v.getUint16(e, le) === 0x8825) gpsOff = v.getUint32(e + 8, le);
  }
  if (!gpsOff) return 'IFD0 carries no GPSInfo pointer (tag 0x8825) — the camera wrote no GPS at all';
  const g = t + gpsOff;
  if (g + 2 > v.byteLength) return 'GPSInfo pointer lands outside the bytes read';
  const n = v.getUint16(g, le);
  const tags = {};
  for (let k = 0; k < n; k++) {
    const e = g + 2 + k * 12;
    if (e + 12 > v.byteLength) break;
    tags[v.getUint16(e, le)] = { type: v.getUint16(e + 2, le), count: v.getUint32(e + 4, le), at: e + 8 };
  }
  const rd = tag => {
    const f = tags[tag]; if (!f) return null;
    if (f.type === 2) {
      const off = f.count > 4 ? t + v.getUint32(f.at, le) : f.at;
      let s = ''; for (let k = 0; k < f.count && off + k < v.byteLength; k++) {
        const c = v.getUint8(off + k); if (!c) break; s += String.fromCharCode(c);
      } return s;
    }
    if (f.type === 5) {
      const off = t + v.getUint32(f.at, le);
      const parts = [];
      for (let k = 0; k < Math.min(f.count, 3); k++) {
        if (off + k * 8 + 8 > v.byteLength) break;
        parts.push(v.getUint32(off + k * 8, le) + '/' + v.getUint32(off + k * 8 + 4, le));
      }
      return parts.join(', ');
    }
    return '(type ' + f.type + ')';
  };
  return `GPSInfo IFD present with ${n} entries — ` +
    `LatRef=${JSON.stringify(rd(1))} Lat=[${rd(2)}] ` +
    `LonRef=${JSON.stringify(rd(3))} Lon=[${rd(4)}]`;
}

let bad = 0;
for (const f of files) {
  const full = fs.statSync(f).size;
  const all = fs.readFileSync(f);
  const head = all.slice(0, Math.min(full, HEAD));

  console.log('\n' + '─'.repeat(74));
  console.log(f);
  console.log('─'.repeat(74));
  console.log(`  size            ${full.toLocaleString()} bytes` +
              (full > HEAD ? `  (the app reads only the first ${HEAD.toLocaleString()})` : ''));
  console.log(`  container       ${sniff(all)}`);

  const segs = segments(head);
  const app1 = segs.find(s => s.tag && s.tag.startsWith('Exif'));
  console.log(`  segments read   ${segs.filter(s => s.marker).map(s => s.name + (s.len ? '/' + s.len : '')).join(' ') || '(none)'}`);
  for (const s of segs) if (s.note) console.log(`  ⚠ at ${s.at}      ${s.note}`);
  console.log(`  Exif APP1       ${app1 ? 'yes, at byte ' + app1.at + ', ' + app1.len + ' bytes' : 'NOT FOUND in the bytes read'}`);

  // step 4: the shipped reader, verbatim
  let ex = null, threw = null;
  try { ex = readExif(head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength)); }
  catch (e) { threw = e; }

  if (threw) { console.log(`  readExif()      THREW ${threw.message}`); bad++; continue; }
  if (!ex) {
    console.log('  readExif()      returned null → the app shows "no usable location"');
    console.log('  why             ' + (sniff(all) === 'JPEG' ? whyNoGps(head) : 'not a JPEG — the reader only understands JPEG'));
    bad++; continue;
  }
  console.log(`  readExif()      ok   orientation=${ex.orientation}  taken=${ex.taken || '(none)'}`);
  if (!ex.gps) {
    console.log('  gps             null → the app keeps the pin where it was dropped');
    console.log('  why             ' + whyNoGps(head));
    bad++; continue;
  }
  console.log(`  gps             ✓ ${ex.gps.ll[0].toFixed(6)}, ${ex.gps.ll[1].toFixed(6)}` +
              (ex.gps.alt != null ? `  alt ${ex.gps.alt}` : ''));
  const [la, lo] = ex.gps.ll;
  const inPorto = la > 40.9 && la < 41.6 && lo > -8.9 && lo < -7.6;
  console.log(`  plausibility    ${inPorto ? '✓ inside the Porto district bounding box' : '⚠ OUTSIDE the Porto district — check before trusting it'}`);
  console.log('  verdict         this photo WOULD place its point on the map');
}

console.log('\n' + (bad ? `${bad} of ${files.length} would not place a point.` : 'all would place a point.'));
