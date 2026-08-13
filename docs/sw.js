/* India Rec — service worker.
 *
 * Faz duas coisas: guarda os ficheiros da aplicação para ela abrir sem rede,
 * e — desde 2026-08-14 — ENVIA A FILA sozinho quando o telemóvel volta a ter
 * rede, mesmo com a aplicação fechada (Background Sync; existe no Chrome do
 * Android, que é o que se usa no campo).
 *
 * Sem isto, escrever 100 plantas sem rede e depois voltar à povoação não
 * chegava: só se enviava enquanto a aplicação estivesse aberta em primeiro
 * plano, e bastava fechá-la para tudo ficar parado.
 *
 * IMPORTANTE: subir CACHE sempre que se altera qualquer ficheiro em docs/,
 * caso contrário os telemóveis continuam a usar a versão antiga.
 */
var CACHE = 'indiarec-v14';

var FICHEIROS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './i18n.js',
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

/* ------------------------------------------------------- envio em segundo plano
 *
 * ⚠ Isto é uma segunda cópia da lógica de envio que está no app.js. Não há
 * como partilhar código entre a página e o service worker sem um passo de
 * compilação, e este projecto não tem nenhum. Se mudar o formato do que se
 * manda ao Apps Script, mude nos DOIS sítios.
 *
 * O que vai para o servidor tem de continuar a ser aceite pelas versões
 * antigas do Codigo.gs, por isso nada aqui é obrigatório.
 */
var LOTE_ENVIO = 25;

function abrirBase() {
  return new Promise(function (ok, mau) {
    var p = indexedDB.open('indiarec', 2);
    p.onupgradeneeded = function () {
      var d = p.result;
      if (!d.objectStoreNames.contains('envios')) {
        var s = d.createObjectStore('envios', { keyPath: 'uuid' });
        s.createIndex('estado', 'estado');
      }
      if (!d.objectStoreNames.contains('config')) {
        d.createObjectStore('config', { keyPath: 'chave' });
      }
    };
    p.onsuccess = function () { ok(p.result); };
    p.onerror = function () { mau(p.error); };
  });
}

function comLoja(bd, loja, modo, fn) {
  return new Promise(function (ok, mau) {
    var tx = bd.transaction(loja, modo);
    var r = fn(tx.objectStore(loja));
    tx.oncomplete = function () { ok(r ? r.result : undefined); };
    tx.onerror = function () { mau(tx.error); };
    tx.onabort = function () { mau(tx.error); };
  });
}

function lerConfig(bd, chave) {
  return comLoja(bd, 'config', 'readonly', function (s) { return s.get(chave); })
    .then(function (r) { return r ? r.valor : ''; });
}

function avisarPaginas(dados) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage(dados); });
  });
}

/** Manda tudo o que estiver pendente. Rejeita se ficar alguma coisa por enviar,
 *  para o Background Sync voltar a chamar mais tarde. */
function enviarFilaSW() {
  var bd, endpoint, token;
  return abrirBase().then(function (d) {
    bd = d;
    return Promise.all([lerConfig(bd, 'endpoint'), lerConfig(bd, 'token')]);
  }).then(function (cfg) {
    endpoint = cfg[0];
    token = cfg[1];
    if (!endpoint || !token) return null;   // nada a fazer: não há para onde enviar
    return comLoja(bd, 'envios', 'readonly', function (s) { return s.getAll(); });
  }).then(function (todos) {
    if (!todos) return;
    var fila = todos.filter(function (e) { return e.estado === 'pendente'; })
                    .sort(function (a, b) { return a.criadoEm - b.criadoEm; });
    if (!fila.length) return;

    var lotes = [];
    for (var i = 0; i < fila.length; i += LOTE_ENVIO) lotes.push(fila.slice(i, i + LOTE_ENVIO));

    var enviados = 0;
    return lotes.reduce(function (cadeia, lote) {
      return cadeia.then(function () {
        return enviarLoteSW(bd, endpoint, token, lote).then(function (n) {
          enviados += n;
          return avisarPaginas({ tipo: 'fila', enviados: enviados, total: fila.length });
        });
      });
    }, Promise.resolve()).then(function () {
      return avisarPaginas({ tipo: 'fila', fim: true, enviados: enviados, total: fila.length });
    });
  });
}

function enviarLoteSW(bd, endpoint, token, lote) {
  var corpo = {
    token: token,
    entries: lote.map(function (e) {
      return {
        uuid: e.uuid, tsLocal: e.tsLocal, ts: e.tsIso,
        recorder: e.recorder, device: e.device,
        mode: e.mode, ronda: e.ronda, substitui: e.substitui || '',
        accao: e.accao || '',
        seq: e.seq, pid: e.pid, row: e.row,
        noFileira: e.noFileira, noFolha: e.noFolha, source: e.source,
        notas: e.notas || '',
        values: e.values
      };
    })
  };

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // evita o preflight CORS
    body: JSON.stringify(corpo),
    redirect: 'follow'
  }).then(function (r) {
    return r.json();
  }).then(function (resp) {
    if (!resp.ok) throw new Error(resp.erro || 'erro do servidor');

    var porUuid = {};
    (resp.resultados || []).forEach(function (x) { porUuid[x.uuid] = x; });

    var bons = 0;
    return comLoja(bd, 'envios', 'readwrite', function (s) {
      lote.forEach(function (e) {
        var r2 = porUuid[e.uuid];
        if (!r2) return;
        if (r2.ok) {
          e.estado = 'enviado';
          e.enviadoEm = Date.now();
          e.celulas = r2.celulas || [];
          e.accaoServidor = r2.accao || '';
          bons++;
        } else {
          e.estado = 'erro';
          e.erro = r2.erro || 'erro desconhecido';
        }
        s.put(e);
      });
      return null;
    }).then(function () { return bons; });
  });
}

self.addEventListener('sync', function (e) {
  // waitUntil com uma promessa rejeitada faz o browser voltar a tentar sozinho
  if (e.tag === 'enviar-fila') e.waitUntil(enviarFilaSW());
});

/* A página pede o envio quando volta a primeiro plano ou quando o utilizador
 * carrega em "tentar enviar agora" e o Background Sync não existe. */
self.addEventListener('message', function (e) {
  if (e.data && e.data.tipo === 'enviar') e.waitUntil(enviarFilaSW());
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
