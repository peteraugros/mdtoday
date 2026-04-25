// sw.js — MD Today v2 service worker.
//
// Strategy:
//   - HTML: network-first (new deploys propagate immediately)
//   - Static assets: stale-while-revalidate (instant paint, background refresh)
//   - Same-origin only. Cross-origin requests pass through untouched.
//
// Cache lifecycle:
//   CACHE_NAME encodes the app version. Bump in lockstep with footer version
//   strings in all HTML files.

const CACHE_NAME = 'mdtoday-v2.4.0';

const PRECACHE_URLS = [
  './',
  './index.html',
  './upcoming.html',
  './daysoff.html',
  './sports.html',
  './css/styles.css',
  './js/app.js',
  './js/format.js',
  './js/upcoming-view.js',
  './js/daysoff-view.js',
  './js/sports-view.js',
  './js/countdown.js',
  './js/data.js',
  './js/resolve.js',
  './js/schedule.js',
  './vendor/papaparse.esm.js',
  './vendor/ical.esm.js',
  './vendor/dexie.mjs',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/md-wordmark.png',
];

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    })
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name.startsWith('mdtoday-'))
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin: pass through
  if (url.origin !== self.location.origin) return;

  const isHTML =
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await networkFetch) || Promise.reject(new Error('No cache and network failed'));
}
