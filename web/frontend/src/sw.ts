/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

const SHARE_CACHE = 'shared-audio-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get('audio');
    if (file instanceof File) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('pending-share', new Response(file, {
        headers: {
          'Content-Type': file.type || 'audio/mpeg',
          'X-File-Name': encodeURIComponent(file.name),
          'X-File-Size': String(file.size),
        }
      }));
    }
  } catch (e) {
    console.error('[SW] share-target error', e);
  }
  return Response.redirect('/?share=pending', 303);
}
