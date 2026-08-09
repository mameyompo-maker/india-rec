/* India Rec — service worker.
 *
 * IMPORTANTE: subir CACHE sempre que se altera qualquer ficheiro em docs/,
 * caso contrário os telemóveis continuam a usar a versão antiga.
 */
var CACHE = 'indiarec-v8';

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
  './icon-180.png',
  './favicon.png'
];

/* Só estes é que podem sair da cache. Tudo o resto — em especial as chamadas ao
 * Apps Script — tem de ir sempre à rede, senão a aplicação passa a ver dados
 * congelados (progresso, histórico) sem dar por isso. */
var CACHEAVEIS = FICHEIROS.map(function (f) {
  return new URL(f, self.registration.scope).pathname;
});

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
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // o endpoint vive noutro domínio

  var navegacao = req.mode === 'navigate';
  if (!navegacao && CACHEAVEIS.indexOf(url.pathname) === -1) return;   // API: sempre rede

  e.respondWith(
    caches.match(navegacao ? './index.html' : req).then(function (guardado) {
      if (guardado) {
        // actualiza em segundo plano, para a próxima abertura
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
