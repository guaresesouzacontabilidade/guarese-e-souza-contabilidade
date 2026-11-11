// Service worker do App da Lelé: abre sem internet e se atualiza sozinho.
// A lista ASSETS e a VERSION são geradas por `npm run precache` — não edite à mão.

const VERSION = 'ad40e0c8ac39';
const ASSETS = [
  './',
  './assets/fonts/fraunces-italic.woff2',
  './assets/fonts/fraunces.woff2',
  './assets/fonts/nunito.woff2',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon.svg',
  './assets/icons/maskable-512.png',
  './css/app.css',
  './index.html',
  './js/config.js',
  './js/core/cloze.js',
  './js/core/dates.js',
  './js/core/importer.js',
  './js/core/notes.js',
  './js/core/queue.js',
  './js/core/rich.js',
  './js/core/srs.js',
  './js/core/stats.js',
  './js/data/actions.js',
  './js/data/backup.js',
  './js/data/idb.js',
  './js/data/packs.js',
  './js/data/store.js',
  './js/main.js',
  './js/personal.js',
  './js/services/fx.js',
  './js/services/image.js',
  './js/services/install.js',
  './js/services/sync.js',
  './js/ui/app.js',
  './js/ui/components.js',
  './js/ui/sheets/deckForm.js',
  './js/ui/sheets/editor.js',
  './js/ui/sheets/import.js',
  './js/ui/sheets/loveNote.js',
  './js/ui/sheets/search.js',
  './js/ui/state.js',
  './js/ui/summary.js',
  './js/ui/views/deck.js',
  './js/ui/views/home.js',
  './js/ui/views/settings.js',
  './js/ui/views/stats.js',
  './js/ui/views/study.js',
  './js/ui/views/welcome.js',
  './js/vendor/icons.js',
  './js/vendor/preact.js',
  './manifest.webmanifest',
  './packs/bemvinda.json',
  './packs/index.json'
];

const CACHE = `lele-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('lele-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Só arquivos do próprio app; a nuvem (Supabase) nunca passa pelo cache.
  if (url.origin !== self.location.origin) return;

  // Baralhos prontos: tenta a internet primeiro para receber os novos.
  if (url.pathname.includes('/packs/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(request, { cache: 'no-cache' });
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return (await cache.match(request, { ignoreSearch: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match('./index.html');
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return Response.error();
      }
    })(),
  );
});
