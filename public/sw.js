// AVALON PWA: network-only mode. Never cache gameplay, player identity or votes.
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101927"><body style="background:#101927;color:#f1deb4;font-family:sans-serif;text-align:center;padding:3rem"><h2>인터넷 연결이 필요합니다</h2><p>아발론은 실시간 온라인 연결이 필요해요.</p><button onclick="location.reload()">다시 연결</button></body></html>', {headers:{'Content-Type':'text/html; charset=utf-8'}})));
  }
});
