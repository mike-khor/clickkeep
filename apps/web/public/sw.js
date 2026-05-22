// Service worker strategy:
//   - Navigations (HTML):     network-first, fall back to cached /index.html.
//   - Hashed /assets/* files: cache-first (Vite content-hashes the filenames).
//   - Other same-origin GETs: cache-first with network fill.
//   - Cross-origin + WebSocket upgrades: bypassed (sync worker lives there).

const DEBUG = false;
const CACHE_NAME = 'clickkeep-shell-v2';
const APP_SHELL = ['/', '/index.html', '/favicon.svg', '/icon.svg', '/icon-maskable.svg', '/manifest.webmanifest'];

const log = (...args) => {
  if (DEBUG) console.log('[sw]', ...args);
};

self.addEventListener('install', (event) => {
  log('install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  log('activate');
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Skip cross-origin (worker WS/HTTP traffic lives there). Skip WebSocket upgrades too.
  if (url.origin !== self.location.origin) return;
  if (req.headers.get('upgrade') === 'websocket') return;

  if (isNavigation(req)) {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

function isNavigation(req) {
  return req.mode === 'navigate' || req.destination === 'document';
}

async function networkFirstNavigation(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      // Refresh the app shell under a stable key so offline fallback stays current.
      cache.put('/index.html', res.clone()).catch((err) => log('shell put failed', err));
    }
    return res;
  } catch (err) {
    log('navigation offline, serving shell', req.url, err);
    const shell = (await cache.match('/index.html')) || (await cache.match('/'));
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) {
    log('hit', req.url);
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).catch((err) => log('put failed', err));
    }
    return res;
  } catch (err) {
    log('network fail', req.url, err);
    throw err;
  }
}
