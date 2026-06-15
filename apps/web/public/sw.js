// ChatApp service worker (§5 state D — Web Push). Plain JS, served from the web
// root at /sw.js so it controls the whole origin. Renders push payloads sent by
// the server's push dispatcher and routes notification clicks to the right
// conversation. The payload shape mirrors `PushPayload` in @chatapp/shared:
// { title, body, conversationId }.

// Take over as soon as an updated worker is installed, instead of waiting for
// every tab to close. Without this, a shipped change to this file (e.g. the
// suppress-the-open-conversation logic below) keeps running the *old* worker
// until the user happens to close all tabs — so the fix appears not to work
// "unless I refresh".
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// The conversation currently open in a visible tab, reported by the page via
// postMessage (see NotificationsProvider). This is the reliable signal for
// "don't notify the chat I'm looking at": WindowClient.url can lag behind
// in-app (history.pushState) navigation, so matching on it alone misses until a
// full reload. Null when nothing is focused. Lost if the worker is evicted —
// the clients.matchAll check below is the fallback in that case.
let focusedConversationId = null;

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'focus-state') {
    focusedConversationId = data.conversationId || null;
  }
});

// True when `conversationId` is open in a visible tab. Prefers the page's
// postMessage signal (robust to in-app navigation); falls back to matching a
// visible client's URL in case the worker restarted and lost that state.
async function isConversationFocused(conversationId) {
  if (focusedConversationId === conversationId) return true;
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const target = '/conversations/' + conversationId;
  return clients.some(
    (c) => c.visibilityState === 'visible' && new URL(c.url).pathname === target,
  );
}

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
      // Don't double-notify the conversation you're already reading: if it's
      // focused in a visible tab, the in-app live view (and badge) already
      // surface the message, so suppress the OS notification. The server pushes
      // to every device and can't know which chat is open, so this decision
      // lives here. Other conversations still notify.
      if (conversationId && (await isConversationFocused(conversationId))) {
        return;
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
