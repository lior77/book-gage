/* Tests for the Exif reader in app.js.
 *
 *     node scripts/test_exif.js
 *
 * The reader is lifted out of app.js as text and run as-is, so this cannot
 * drift from what ships.  The JPEGs are built here rather than committed,
 * which keeps the repository free of anyone's photographs and lets a case be
 * described exactly: this file says what is in each one.
 *
 * The case worth having a test for is the empty GPS block.  A phone with
 * location tagging switched off does not leave GPSInfo out — it writes the
 * whole IFD with blank refs and 0/0 rationals.  Read naively that is 0°N 0°E,
 * a point in the Atlantic south of Ghana, and a photo taken in Porto would
 * place its marker there without any error to notice.  The photo this was
 * written against, a Galaxy A56, is exactly that case.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(APP, 'utf8');
const from = src.indexOf('function readExif(');
const to = src.indexOf('/* ---- making the stored copy ---- */');
if (from < 0 || to < 0 || to < from) throw new Error('cannot find the Exif reader in app.js');
const readExif = new Function(src.slice(from, to) + '\nreturn readExif;')();

/* ---------------------------------------------------------- a JPEG maker --- */
/* Only what the reader looks at: SOI, one APP1 holding a little-endian TIFF,
   EOI.  No pixels — the reader stops at the start of image data anyway. */
function u16(n) { return [n & 255, (n >> 8) & 255]; }
function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }

function makeJpeg(opts) {
  const o = opts || {};
  // three IFDs are laid out one after another, then the values they point at
  const ifd0 = [], exif = [];
  const entry = (list, tag, type, count, valueBytes) =>
    list.push({ tag, type, count, valueBytes });

  entry(ifd0, 0x0112, 3, 1, u16(o.orientation || 1).concat([0, 0]));   // Orientation
  const ifd0Count = ifd0.length + 1 + (o.gps === undefined ? 0 : 1);   // + Exif ptr
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  const ifd0Off = 8;
  const exifOff = ifd0Off + 2 + ifd0Count * 12 + 4;
  const taken = (o.taken || '2026:09:07 15:50:41') + '\0';
  const exifCount = 1;
  const gpsOff = exifOff + 2 + exifCount * 12 + 4;
  const gpsList = o.gps === undefined ? [] : gpsEntries(o.gps);
  const gpsCount = gpsList.length;
  const valuesOff = gpsOff + 2 + gpsCount * 12 + 4;

  const values = [];
  const push = bytes => {
    const where = valuesOff + values.length;
    values.push(...bytes);
    return where;
  };

  const takenAt = push(Array.from(Buffer.from(taken, 'latin1')));
  entry(exif, 0x9003, 2, taken.length, u32(takenAt));

  const gpsEntriesOut = [];
  for (const g of gpsList) {
    const total = sizes[g.type] * g.count;
    gpsEntriesOut.push({ tag: g.tag, type: g.type, count: g.count,
      valueBytes: total <= 4 ? g.bytes.concat([0, 0, 0, 0]).slice(0, 4) : u32(push(g.bytes)) });
  }

  entry(ifd0, 0x8769, 4, 1, u32(exifOff));
  if (o.gps !== undefined) entry(ifd0, 0x8825, 4, 1, u32(gpsOff));

  const dir = list => {
    const out = [].concat(u16(list.length));
    for (const e of list) out.push(...u16(e.tag), ...u16(e.type), ...u32(e.count), ...e.valueBytes);
    return out.concat(u32(0));
  };

  const tiff = [0x49, 0x49, 42, 0, ...u32(8)]
    .concat(dir(ifd0), dir(exif), dir(gpsEntriesOut), values);
  const app1 = Array.from(Buffer.from('Exif\0\0', 'latin1')).concat(tiff);
  const len = app1.length + 2;
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, (len >> 8) & 255, len & 255]
    .concat(app1, [0xFF, 0xD9]));
}

function rational(n, d) { return u32(n).concat(u32(d)); }

function gpsEntries(g) {
  // g: { latRef, lat:[d,m,s] or null-for-zero, lonRef, lon }
  const dms = v => v === null
    ? rational(0, 0).concat(rational(0, 0), rational(0, 0))
    : rational(Math.round(v[0]), 1)
        .concat(rational(Math.round(v[1]), 1), rational(Math.round(v[2] * 1000), 1000));
  const ref = c => Array.from(Buffer.from((c || '') + '\0', 'latin1'));
  return [
    { tag: 1, type: 2, count: 2, bytes: ref(g.latRef) },
    { tag: 2, type: 5, count: 3, bytes: dms(g.lat) },
    { tag: 3, type: 2, count: 2, bytes: ref(g.lonRef) },
    { tag: 4, type: 5, count: 3, bytes: dms(g.lon) },
  ];
}

const buf = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

/* --------------------------------------------------------------- checks --- */
let fails = 0;
function ok(name, cond, extra) {
  if (!cond) fails++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra === undefined ? '' : '  — ' + extra));
}
function near(name, got, want) {
  const good = got !== null && got !== undefined && Math.abs(got - want) < 1e-5;
  if (!good) fails++;
  console.log((good ? 'ok   ' : 'FAIL ') + name + '  ' +
    (got === null || got === undefined ? String(got) : got.toFixed(6)) + ' (want ' + want + ')');
}

// a fix in the northern and western hemisphere: Porto
let r = readExif(buf(makeJpeg({ gps: { latRef: 'N', lat: [41, 9, 7.2],
                                       lonRef: 'W', lon: [8, 40, 12] } })));
ok('a normal photo is read', !!r && !!r.gps);
near('  latitude', r.gps.ll[0], 41.152);
near('  longitude', r.gps.ll[1], -8.67);
ok('  DateTimeOriginal comes through', r.taken === '2026:09:07 15:50:41', r.taken);

// south and east, so both refs have to be applied and not assumed
r = readExif(buf(makeJpeg({ gps: { latRef: 'S', lat: [33, 52, 7.68],
                                   lonRef: 'E', lon: [151, 12, 39.6] } })));
near('southern latitude is negative', r.gps.ll[0], -33.8688);
near('eastern longitude is positive', r.gps.ll[1], 151.211);

// THE case: the block is there, and it says nothing.  Must not decode to 0,0.
r = readExif(buf(makeJpeg({ gps: { latRef: '', lat: null, lonRef: '', lon: null } })));
ok('an empty GPS block is rejected, not read as 0°,0°', r && r.gps === null,
   r && JSON.stringify(r.gps));

// refs present but the numbers absent, and the reverse
r = readExif(buf(makeJpeg({ gps: { latRef: 'N', lat: null, lonRef: 'W', lon: null } })));
ok('zero denominators are rejected even with real refs', r.gps === null);
r = readExif(buf(makeJpeg({ gps: { latRef: '', lat: [41, 9, 7.2], lonRef: '', lon: [8, 40, 12] } })));
ok('real numbers with blank refs are rejected', r.gps === null);
r = readExif(buf(makeJpeg({ gps: { latRef: 'X', lat: [41, 9, 7.2], lonRef: 'Q', lon: [8, 40, 12] } })));
ok('a ref that is not N/S/E/W is rejected', r.gps === null);

// a real zero is still refused: it is never where a photo was taken, and it is
// what a half-filled block looks like
r = readExif(buf(makeJpeg({ gps: { latRef: 'N', lat: [0, 0, 0], lonRef: 'E', lon: [0, 0, 0] } })));
ok('0°N 0°E is refused', r.gps === null);

// out of range
r = readExif(buf(makeJpeg({ gps: { latRef: 'N', lat: [95, 0, 0], lonRef: 'E', lon: [8, 0, 0] } })));
ok('a latitude past the pole is refused', r.gps === null);

// no GPS IFD at all
r = readExif(buf(makeJpeg({})));
ok('a photo with no GPS IFD reads, with gps null', !!r && r.gps === null);
ok('  and still gives orientation', r.orientation === 1, r.orientation);
r = readExif(buf(makeJpeg({ orientation: 6 })));
ok('orientation is read when it is not 1', r.orientation === 6, r.orientation);

// things that are not a photo with Exif
ok('a non-JPEG returns null', readExif(buf(Buffer.from('hello world'))) === null);
ok('an empty buffer returns null', readExif(new ArrayBuffer(0)) === null);
ok('a JPEG with no APP1 returns null',
   readExif(buf(Buffer.from([0xFF, 0xD8, 0xFF, 0xDA, 0, 2]))) === null);

// the app hands the reader only the head of the file; a cut mid-structure must
// come back empty-handed rather than throw
const whole = makeJpeg({ gps: { latRef: 'N', lat: [41, 9, 7.2], lonRef: 'W', lon: [8, 40, 12] } });
let threw = false;
for (let n = 1; n < whole.length; n++) {
  try { readExif(buf(whole.slice(0, n))); } catch (e) { threw = true; break; }
}
ok('no truncation of the file throws', !threw);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
