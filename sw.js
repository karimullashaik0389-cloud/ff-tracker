/* Service worker: caches the APP SHELL ONLY (HTML, CSS, JS, fonts, icons).
 * It never touches API calls, POST requests, bills or anything cross-origin – data is always live. */
var VERSION = 'ff-tracker-shell-v4';
var SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'api.js', 'app.js', 'manifest.webmanifest',
  'fonts/inter.woff2', 'fonts/cormorant.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('ff-tracker-shell-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // never POST (all API calls are POST)
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // never cross-origin (Apps Script, Drive)
  var scope = new URL(self.registration.scope);
  var rel = url.pathname.slice(scope.pathname.length);
  if (req.mode === 'navigate') {                           // pages: network first, shell when offline
    e.respondWith(fetch(req).catch(function () { return caches.match('index.html'); }));
    return;
  }
  if (SHELL.indexOf(rel) < 0) return;                      // not a shell file -> straight to network
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
