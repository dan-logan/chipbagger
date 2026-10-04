// Keeps the admin shell available to the installed app. Network first so updates always win;
// only same-origin GETs are cached, so Firebase traffic (auth, Firestore, Storage) is never touched.
const CACHE = 'chipbagger-admin-v1';
const SHELL = ['./', 'admin.css', 'admin.js', '../css/style.css', '../js/firebase-config.js', '../images/brand/logo.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
