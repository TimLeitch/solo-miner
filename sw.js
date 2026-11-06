/* Solo Miner service worker: caches the game so it loads and plays with no connection.
 * Bump CACHE when shipping changes so phones pick up the new files. */
const CACHE = 'solominer-v13';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/data.js', './js/state.js', './js/audio.js', './js/sortie.js', './js/ui.js', './js/cloud-config.js', './js/cloud.js', './js/main.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first (so updates show up when online), cache fallback when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // never cache cloud save / sign-in calls
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
