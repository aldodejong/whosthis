// Service worker: cache-first for same-origin app files, so the app works offline once loaded.
// Bump CACHE_VERSION whenever a shipped file changes, otherwise phones keep the old copy.
// When src/ or vendor/ files are added, list them in PRECACHE below.

const CACHE_VERSION = 'v9';
const CACHE_PREFIX = 'whosthis-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Paths are resolved against this file's location (the app root).
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './src/ui/patient.js',
  './src/ui/caregiver.js',
  './src/ui/test.js',
  './src/face.js',
  './src/camera.js',
  './src/matcher.js',
  './src/store.js',
  './src/caregiver-logic.js',
  './src/patient-logic.js',
  './src/speech.js',
  // Face library + models (about 12 MB, see vendor/README.md).
  './vendor/human/human.esm.js',
  './vendor/human/models/blazeface.json',
  './vendor/human/models/blazeface.bin',
  './vendor/human/models/facemesh.json',
  './vendor/human/models/facemesh.bin',
  './vendor/human/models/faceres.json',
  './vendor/human/models/faceres.bin',
  './vendor/tfjs-backend-wasm/tfjs-backend-wasm.wasm',
  './vendor/tfjs-backend-wasm/tfjs-backend-wasm-simd.wasm',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // same-origin only

  // Hash routes (#/caregiver etc.) share one document; ignore the fragment for cache lookups.
  url.hash = '';
  const key = url.href;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(key);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          cache.put(key, response.clone());
        }
        return response;
      } catch (err) {
        if (request.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })
  );
});
