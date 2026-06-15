// ChatApp service worker (§5 state D — Web Push). Plain JS, served from the web
// root at /sw.js so it controls the whole origin. Renders push payloads sent by
// the server's push dispatcher and routes notification clicks to the right
// conversation. The payload shape mirrors `PushPayload` in @chatapp/shared:
// { title, body, conversationId }.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = {};
  }

  const title = payload.title || 'ChatApp';
  const body = payload.body || 'New message';
  const conversationId = payload.conversationId || null;
  const url = conversationId ? '/conversations/' + conversationId : '/';

  event.waitUntil(
    (async () => {
      // Don't double-notify the conversation you're already reading: if a
      // visible tab is on this conversation, the in-app live view (and badge)
      // already surface the message, so suppress the OS notification. Mirrors
      // the in-tab notifier, which skips the focused+visible conversation. The
      // server pushes to every device and can't know which chat is open, so
      // this decision has to live here. Other conversations still notify.
      if (conversationId) {
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        const target = '/conversations/' + conversationId;
        const beingViewed = clients.some(
          (c) => c.visibilityState === 'visible' && new URL(c.url).pathname === target,
        );
        if (beingViewed) return;
      }

      await self.registration.showNotification(title, {
        body,
        tag: conversationId || undefined,
        data: { url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab and route it, rather than opening a duplicate.
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(url);
            return undefined;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return undefined;
      }),
  );
});
