/*
 * Portal Guarese's ON — avisos no aparelho (Web Push).
 * Este service worker só exibe as notificações enviadas pelo servidor do
 * portal e abre a página correspondente ao toque. Não guarda páginas nem
 * dados em cache.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

function caminhoSeguro(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/notificacoes";
}

self.addEventListener("push", (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch {
    dados = { corpo: evento.data ? evento.data.text() : "" };
  }
  const titulo = typeof dados.titulo === "string" && dados.titulo ? dados.titulo : "Portal Guarese's ON";
  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: typeof dados.corpo === "string" ? dados.corpo : "",
      tag: typeof dados.tag === "string" ? dados.tag : undefined,
      icon: "/marca/icone-192.png",
      badge: "/marca/selo-96.png",
      lang: "pt-BR",
      timestamp: typeof dados.quando === "number" ? dados.quando : Date.now(),
      data: { url: caminhoSeguro(dados.url) },
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = new URL(caminhoSeguro(evento.notification.data && evento.notification.data.url), self.location.origin).href;
  evento.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        if (new URL(janela.url).origin === self.location.origin && "focus" in janela) {
          await janela.focus();
          if ("navigate" in janela) await janela.navigate(destino).catch(() => self.clients.openWindow(destino));
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});
