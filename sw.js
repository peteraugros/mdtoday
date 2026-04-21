// sw.js
//
// MD Today service worker.
//
// Strategy (see claude.md → Failure mode 7):
//   - HTML (index.html, schedule.html): network-first. On success, update cache
//     and serve fresh; on failure, serve from cache. Ensures new deploys
//     propagate on first online load while keeping offline reads working.
//   - Static assets (CSS, JS, icons, manifest): stale-while-revalidate. Serve
//     from cache immediately (instant paint), fetch in background, update
//     cache for next load.
//   - Same-origin only. Cross-origin requests (corsproxy.io, docs.google.com)
//     pass through untouched. data.js owns its own caching via localStorage;
//     doubling up here would create stale-overlapping-stale bugs.
//
// Cache lifecycle:
//   - CACHE_NAME encodes the app version. A new deploy bumps this constant,
//     which causes activate() to delete old caches. This is Failure mode 7's
//     defense against "bad deploy cached, now stuck".
//   - Bump CACHE_NAME in lockstep with the footer version string in each HTML
//     file. Manual discipline; a constants-file refactor is v2.

const CACHE_NAME = 'mdtoday-v1.0.3';

// Files the app shell needs to render the Now view offline from a cold cache.
// On install we precache these. Anything not listed here is cached lazily on
// first fetch. Keep this list tight — every entry is a fetch on install.
const PRECACHE_URLS = [
  './',
  './index.html',
  './schedule.html',
  './daysoff.html',
  './css/styles.css',
  './js/app.js',
  './js/schedule-view.js',
  './js/daysoff-view.js',
  './js/countdown.js',
  './js/data.js',
  './js/resolve.js',
  './js/schedule.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/md-wordmark.png',
];

// ---------------------------------------------------------------------------
// Install — precache the shell
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use { cache: 'reload' } to bypass the browser HTTP cache on install,
      // so a new SW version doesn't precache stale bytes from a prior deploy's
      // 304-response window.
      return cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    })
  );
  // Activate the new SW immediately instead of waiting for all tabs to close.
  // Paired with clients.claim() in activate.
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — clean up old caches
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
// Fetch — routing
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET. Everything else (POST, etc. — shouldn't happen in this
  // app but be safe) passes through.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin: let the network handle it. data.js caches these in
  // localStorage; we don't touch them here.
  if (url.origin !== self.location.origin) return;

  // HTML documents: network-first.
  // Detect by Accept header (reliable) and/or pathname extension.
  const isHTML =
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * Network-first. Try network, fall back to cache. Update cache on success.
 * On total failure (network dead + no cache entry) the browser gets a
 * standard network error, which is what we want — the caller will see the
 * fetch fail and data.js will fall back to its localStorage cache.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Clone before caching — response body is a stream, can only be read once.
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Stale-while-revalidate. Serve cache if present, fetch in background to
 * refresh the cache for next time. If no cache and fetch succeeds, return the
 * fetched response; if both fail, throw.
 */
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
    .catch(() => null); // Swallow background-fetch errors; cache serves the request.

  return cached || (await networkFetch) || Promise.reject(new Error('No cache and network failed'));
}
