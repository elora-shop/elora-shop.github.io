/* ELORA — يجعل المتجر يفتح بسرعة ويعمل حتى مع ضعف الإنترنت.
 * الصفحة والبيانات: من الشبكة أولًا (حتى تظهر تحديثاتك فورًا)، ومن الذاكرة عند انقطاع الاتصال.
 * الصور: من الذاكرة فورًا، مع تحديثها في الخلفية.
 */
const CACHE = 'elora-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;

  if (/\.(webp|jpe?g|png|gif|avif)$/i.test(u.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
