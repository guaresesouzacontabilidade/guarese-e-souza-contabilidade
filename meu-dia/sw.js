// Service worker do Meu Dia: abre sem internet e atualiza com segurança.
// A lista ASSETS e a VERSION são geradas por `npm run precache` — não edite à mão.

const VERSION = '83ffcbee2df9';
const ASSETS = [
  './',
  './assets/fonts/manrope.woff2',
  './assets/fonts/sora.woff2',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/badge-96.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon.svg',
  './assets/icons/maskable-512.png',
  './css/app.css',
  './index.html',
  './js/config.js',
  './js/core/agenda.js',
  './js/core/assistant.js',
  './js/core/bills.js',
  './js/core/categories.js',
  './js/core/dates.js',
  './js/core/finance.js',
  './js/core/money.js',
  './js/core/recurrence.js',
  './js/core/reminders.js',
  './js/core/reports.js',
  './js/core/text.js',
  './js/data/backup.js',
  './js/data/storage.js',
  './js/data/store.js',
  './js/main.js',
  './js/services/cloud.js',
  './js/services/install.js',
  './js/services/notifications.js',
  './js/ui/app.js',
  './js/ui/components.js',
  './js/ui/forms/add.js',
  './js/ui/forms/bill.js',
  './js/ui/forms/event.js',
  './js/ui/forms/transaction.js',
  './js/ui/forms/wallet.js',
  './js/ui/layers.js',
  './js/ui/rows.js',
  './js/ui/state.js',
  './js/ui/views/agenda.js',
  './js/ui/views/assistant.js',
  './js/ui/views/auth.js',
  './js/ui/views/bills.js',
  './js/ui/views/finance.js',
  './js/ui/views/home.js',
  './js/ui/views/reports.js',
  './js/ui/views/settings.js',
  './js/ui/views/welcome.js',
  './js/vendor/icons.js',
  './js/vendor/preact.js',
  './js/vendor/supabase.js',
  './manifest.webmanifest'
];

const CACHE = `meu-dia-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('meu-dia-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Só arquivos do próprio app; a nuvem (Supabase) nunca passa pelo cache.
  if (url.origin !== self.location.origin) return;

  // Telas: usa a versão instalada (rápida e offline); a atualização chega pelo aviso "Nova versão".
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route || '#/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if (client.url.startsWith(self.registration.scope)) {
          await client.focus();
          client.navigate?.(new URL(route, self.registration.scope).href);
          return;
        }
      }
      await self.clients.openWindow(new URL(route, self.registration.scope).href);
    })(),
  );
});
