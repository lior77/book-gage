/* Measures the read path and writes the measurement down — one file per release.
 *
 *     python3 -m http.server 8123          # from porto/
 *     node scripts/measure_readpath.js [--n 100] [--url http://…]
 *
 * Why this exists.  Until 2026-09-17 nobody knew what the app costs to open.
 * The bundle is 3MB and every sentence about "fast enough" was an opinion.
 * INFORMATION-PLAN.md puts this first, before the moves that ADD data, for one
 * reason: a move that costs 40ms cannot be noticed without a number from
 * before it landed.
 *
 * Three decisions here are not arbitrary, and all three come out of chapter 2
 * of Designing Data-Intensive Applications:
 *
 *  1. A response time is a DISTRIBUTION, not a number.  So percentiles, and no
 *     mean anywhere in this file.
 *  2. Percentiles cannot be averaged.  The right way to combine measurements
 *     is to add their HISTOGRAMS, so the histogram is what gets stored and the
 *     percentiles are derived from it — two releases can be pooled by adding
 *     counts, which averaging their p95s would quietly corrupt.
 *  3. A percentile needs enough samples to exist at all.  p99 out of 40 runs
 *     is the largest of 40 numbers wearing a name it has not earned, so a
 *     percentile with fewer than 1/(1-p) samples is written as null and the
 *     reader is told "אין נתון" — rule 2 of the accuracy contract applies to
 *     our own numbers too.
 *
 * What this is NOT: a phone.  It runs headless Chromium in a container, which
 * is faster than the mid-range Android the app is for.  The file records
 * `device` and `device_class` so a number from here is never mistaken for a
 * number from a phone; docs/ARCHITECTURE.md §8 says what the numbers cover and
 * docs/HANDOFF.md carries "not measured on a phone" as open work.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.dirname(__dirname);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const N = Number(arg('n', 100));
const URL = arg('url', 'http://127.0.0.1:8123/index.html');
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();

/* ---------------------------------------------------------------- histogram */
/* Bucket edges, fine where the values are and coarse where they are not: 1ms
   up to 20ms, then 2, 10, 25 and 100.  Every derived percentile is the UPPER
   edge of the bucket the rank falls in, so a reported number is a bound the
   measurement supports and never an interpolation between two buckets that
   were never observed. */
function edges() {
  const e = [];
  for (let v = 0; v < 20; v += 1) e.push(v + 1);
  for (let v = 20; v < 100; v += 2) e.push(v + 2);
  for (let v = 100; v < 500; v += 10) e.push(v + 10);
  for (let v = 500; v < 2000; v += 25) e.push(v + 25);
  for (let v = 2000; v < 10000; v += 100) e.push(v + 100);
  return e;
}
const EDGES = edges();

function hist() { return { edges: EDGES, counts: new Array(EDGES.length + 1).fill(0) }; }

function add(h, ms) {
  let i = 0;
  while (i < h.edges.length && ms > h.edges[i]) i += 1;
  h.counts[i] += 1;                     // the last slot is the overflow: > 10s
}

/* The rank-th smallest sample, by the nearest-rank definition: rank =
   ceil(p*n), walk the counts, report the bucket's upper edge.  The overflow
   slot has no upper edge, so it reports null rather than a made-up ceiling. */
function pct(h, p) {
  const n = h.counts.reduce((a, b) => a + b, 0);
  if (n < Math.ceil(1 / (1 - p))) return null;   // not enough samples to name it
  const rank = Math.ceil(p * n);
  let seen = 0;
  for (let i = 0; i < h.counts.length; i += 1) {
    seen += h.counts[i];
    if (seen >= rank) return i < h.edges.length ? h.edges[i] : null;
  }
  return null;
}

const summary = h => ({
  n: h.counts.reduce((a, b) => a + b, 0),
  p50_ms: pct(h, 0.50), p95_ms: pct(h, 0.95), p99_ms: pct(h, 0.99),
  histogram: { edges: h.edges, counts: h.counts },
});

/* ------------------------------------------------------------------ measure */
/* Stamp the moment the boot overlay leaves the DOM, from inside the page.
   Polling from node would add up to a frame of its own latency to every
   sample, and a frame is 16ms on a number whose p50 is in the hundreds. */
/* `document`, not `document.documentElement`: an init script runs before the
   parser has produced an <html> element, so observing documentElement observes
   null and the stamp never fires.  The first cut of this file did exactly that
   and every sample timed out at 30s. */
const STAMP = `
  new MutationObserver((recs, obs) => {
    if (!document.getElementById('boot')) { window.__ready = performance.now(); obs.disconnect(); }
  }).observe(document, { childList: true, subtree: true });
`;

/* A 1x1 PNG for the street background.  The tiles come from the network and
   the network is not what is being measured; left unanswered they fail slowly
   with a certificate error and add their latency to a number about local data.
   Answered instantly, the measurement is of the read path the app owns. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  + 'IQAAAABJRU5ErkJggg==', 'base64');
const TILES = '**://tile.openstreetmap.org/**';

/* serviceWorkers: 'block' — the worker exists to serve the app from its own
   cache, which is right on a phone and fatal here: the second cold open would
   be served from the first one's cache and report a number nobody waits. */
const CONTEXT = { viewport: { width: 412, height: 900 }, locale: 'he-IL',
                  serviceWorkers: 'block' };

async function tiles(page) {
  await page.route(TILES, r => r.fulfill({ contentType: 'image/png', body: TILE_PNG,
                                           headers: { 'access-control-allow-origin': '*' } }));
}

async function firstPaint(browser, h) {
  /* A fresh context per sample, because the thing being measured is the cold
     open: the same context would serve the second sample from memory cache and
     report a number no user ever waits. */
  for (let i = 0; i < N; i += 1) {
    const ctx = await browser.newContext(CONTEXT);
    const page = await ctx.newPage();
    await page.addInitScript(STAMP);
    await tiles(page);
    await page.goto(URL, { waitUntil: 'commit' });
    await page.waitForFunction('window.__ready !== undefined', null, { timeout: 30000 });
    add(h, await page.evaluate(() => window.__ready));
    await ctx.close();
    if ((i + 1) % 10 === 0) process.stdout.write(`  first_paint ${i + 1}/${N}\n`);
  }
}

async function warmPage(browser) {
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.addInitScript(STAMP);
  await tiles(page);
  await page.goto(URL);
  await page.waitForFunction('window.__ready !== undefined', null, { timeout: 30000 });
  return { ctx, page };
}

async function levelSwitch(page, h) {
  /* A real click on the real row, through the real handler.  Cycling the
     municipalities rather than tapping one of them N times, for two reasons:
     a second tap on the same unit is a different gesture in this app (it opens
     Google Maps), and the eighteen differ by a factor of five in how many
     parishes the level-2 document has to draw — which is exactly the spread a
     p95 is for. */
  const nums = await page.evaluate(() => D.mun.map(m => m.num));
  for (let i = 0; i < N; i += 1) {
    const num = nums[i % nums.length];
    const ms = await page.evaluate(n => {
      const btn = document.querySelector(`#doc .row[data-mun="${n}"]`);
      if (!btn) return null;
      const t0 = performance.now();
      btn.click();
      /* Forces style and layout on the document that was just replaced, so the
         number covers the work the user waits for and not just the JavaScript
         that scheduled it.  The compositor frame after this is not included,
         and docs/ARCHITECTURE.md §8 says so. */
      void document.getElementById('doc').offsetHeight;
      return performance.now() - t0;
    }, num);
    if (ms === null) throw new Error('no municipality row at the district level');
    add(h, ms);
    await page.click('#homeBtn');
    await page.waitForFunction('S.level === "district"');
  }
}

async function search(page, h) {
  await page.evaluate(() => { goDistrict(); openSearch(); });
  await page.waitForSelector('#q');
  /* Four-letter queries taken from the data itself, cycled, so no single term
     measures a lucky path through the scan. */
  const terms = await page.evaluate(() =>
    D.mun.map(m => (m.he || m.pt).slice(0, 4)).filter(s => s.length >= 2));
  for (let i = 0; i < N; i += 1) {
    const term = terms[i % terms.length];
    const ms = await page.evaluate(q => {
      const el = document.getElementById('q');
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = q;
      const t0 = performance.now();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      void document.getElementById('qres').offsetHeight;
      return performance.now() - t0;
    }, term);
    add(h, ms);
  }
}

/* ------------------------------------------------------------------- what it
   costs to ship, measured beside what it costs to open, because the two are
   the same question asked twice. */
function bytes() {
  const one = rel => { try { return fs.statSync(path.join(ROOT, rel)).size; } catch (e) { return null; } };
  const proc = fs.readdirSync(path.join(ROOT, 'data', 'processed'))
    .reduce((a, f) => a + fs.statSync(path.join(ROOT, 'data', 'processed', f)).size, 0);
  return {
    index_html: one('index.html'), app_js: one('app.js'), app_css: one('app.css'),
    data_processed: proc, standalone_html: one('porto-standalone.html'),
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const h = { first_paint: hist(), level_switch: hist(), search: hist() };

  await firstPaint(browser, h.first_paint);
  const { ctx, page } = await warmPage(browser);
  page.on('pageerror', e => { console.log('  PAGE ERROR ' + e.message); process.exitCode = 1; });
  await levelSwitch(page, h.level_switch);
  console.log(`  level_switch ${N}/${N}`);
  await search(page, h.search);
  console.log(`  search ${N}/${N}`);
  await ctx.close();
  await browser.close();

  const out = {
    version: VERSION,
    measured_at: new Date().toISOString().slice(0, 10),
    /* Named, not inferred: a reader who finds a 300ms p95 here has to be able
       to see immediately that it was not measured on a phone. */
    device: 'headless Chromium 1194, container, 412×900 viewport',
    device_class: 'headless-container',
    phone_measured: false,
    url: URL,
    bytes: bytes(),
    note_he: 'מסלול הקריאה, באחוזונים. לא נמדד על טלפון — ראו docs/ARCHITECTURE.md §8.',
    operations: {
      first_paint: summary(h.first_paint),
      level_switch: summary(h.level_switch),
      search: summary(h.search),
    },
  };
  const dest = path.join(ROOT, 'data', 'readpath', VERSION + '.json');
  /* Indented, except the histograms: one bucket per line turned a 2.5KB file
     into 14KB, and there is one of these per release for as long as the
     project lives.  The collapse only touches arrays that hold nothing but
     numbers, which is every array in this file. */
  const text = JSON.stringify(out, null, 1)
    .replace(/\[\n\s*((?:-?[\d.]+,\n\s*)*-?[\d.]+)\n\s*\]/g,
             (m, body) => '[' + body.replace(/\s+/g, '') + ']');
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(out))
    throw new Error('the array collapse changed the measurement');
  fs.writeFileSync(dest, text + '\n', 'utf8');

  for (const [k, v] of Object.entries(out.operations)) {
    const s = x => (x === null ? 'אין נתון' : x + 'ms');
    console.log(`${k.padEnd(13)} n=${v.n}  p50 ${s(v.p50_ms)}  p95 ${s(v.p95_ms)}  p99 ${s(v.p99_ms)}`);
  }
  console.log('wrote data/readpath/' + VERSION + '.json');
})();
