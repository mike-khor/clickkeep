// Cache-first for same-origin GETs. Cross-origin (sync worker) bypasses the cache.

const DEBUG = false;
const CACHE_NAME = 'clickkeep-shell-v1';
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

  event.respondWith(handle(req));
});

async function handle(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) {
    log('hit', req.url);
    return cached;
  }
  try {
    const res = await fetch(req);
    // Only cache successful, basic (same-origin) responses.
    if (res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).catch((err) => log('put failed', err));
    }
    return res;
  } catch (err) {
    log('network fail', req.url, err);
    // For SPA navigations, fall back to the cached app shell so the router can take over.
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
