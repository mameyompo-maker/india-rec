/* India Rec — service worker.
 *
 * IMPORTANTE: subir CACHE sempre que se altera qualquer ficheiro em docs/,
 * caso contrário os telemóveis continuam a usar a versão antiga.
 */
var CACHE = 'indiarec-v1';

var FICHEIROS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './plants.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FICHEIROS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (chaves) {
      return Promise.all(chaves.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // POSTs vão sempre à rede
  if (new URL(req.url).origin !== self.location.origin) return;

  // cache-first: o que está instalado tem de arrancar sem rede nenhuma
  e.respondWith(
    caches.match(req).then(function (guardado) {
      if (guardado) {
        // actualiza em segundo plano para a próxima abertura
        fetch(req).then(function (r) {
          if (r && r.ok) caches.open(CACHE).then(function (c) { c.put(req, r.clone()); });
        }).catch(function () {});
        return guardado;
      }
      return fetch(req).then(function (r) {
        if (r && r.ok) {
          var copia = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return r;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
