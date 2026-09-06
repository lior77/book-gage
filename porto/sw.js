/* Service worker: the whole app and all of its data are precached, so the phone
   works with no network at all.  OSM tiles are the one thing that cannot be
   precached (there are millions of them) — tiles you have already looked at are
   kept in a small runtime cache, and without a connection the map simply falls
   back to the vector boundaries, which are local. */
const VERSION = 'porto-2026-09-06';
const SHELL = VERSION + '-shell';
const TILES = VERSION + '-tiles';
const TILE_LIMIT = 400;

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/images/marker-icon.png',
  './vendor/images/marker-icon-2x.png',
  './vendor/images/marker-shadow.png',
  './vendor/images/layers.png',
  './vendor/images/layers-2x.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png',
  './icons/icon-maskable-512.png',
  './data/sources.json',
  './data/processed/indicators.json',
  './data/processed/municipios.json',
  './data/processed/freguesias.json',
  './data/processed/porto_city.json',
  './data/processed/boundaries_municipios.geojson',
  './data/processed/boundaries_belts.geojson',
  './data/processed/boundaries_freguesias.geojson',
  './data/processed/boundaries_porto_city.geojson',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // addAll is all-or-nothing; add one by one so a single miss (say the PDF)
    // cannot leave the app without an offline copy of everything else.
    await Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > TILE_LIMIT) {
    await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map(k => c.delete(k)));
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // App shell and data: cache first, then refresh in the background.
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { net; return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await c.match('./index.html');
      if (shell) return shell;
    }
    return new Response('offline', { status: 504 });
  })());
});
