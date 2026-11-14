/*
 * Service worker do Estudos Track.
 * - Deixa o site instalável e abre mesmo sem internet (rede primeiro, cache como reserva).
 * - Exibe notificações e foca o app quando o usuário clica nelas.
 * Não faz cache de outros domínios (ex.: Supabase), então login e sincronização não são afetados.
 */
const CACHE_NAME = "estudos-track-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./")))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const view = event.notification.data?.view || "revisao";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients[0];
      if (open) {
        open.postMessage({ type: "open-view", view });
        return open.focus();
      }
      return self.clients.openWindow("./");
    })
  );
});
