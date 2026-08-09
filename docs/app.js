/* India Rec — registo de medições de campo, funciona sem rede.
 *
 * Fluxo: activação -> nome -> levantamento -> (ronda) -> planta -> formulário.
 * Tudo o que é gravado vai primeiro para o IndexedDB do aparelho e só depois
 * segue para o Apps Script. A hora guardada é a do aparelho no momento em que
 * o utilizador carrega em "Guardar e enviar", não a do envio.
 *
 * Permissões: cada pessoa só corrige os registos que fez. O administrador
 * corrige tudo. Quem manda nisso é o servidor — aqui só se esconde o botão.
 */
'use strict';

var CFG = window.INDIAREC_CONFIG || {};
var LOTE_ENVIO = 25;
var INTERVALO_TENTATIVA = 60000;
var VALIDADE_ADMIN = 12 * 3600 * 1000;   // o modo administrador expira ao fim de 12 h

// ------------------------------------------------------------------- campos

var CORES = [
  { chave: 'verdeClaro',  rotulo: 'Verde claro' },
  { chave: 'verdeMedio',  rotulo: 'Verde médio' },
  { chave: 'verdeEscuro', rotulo: 'Verde escuro' },
  { chave: 'vermelho',    rotulo: 'Vermelho' }
];

var HABITOS = [
  { chave: 'horizontal', rotulo: 'Horizontal' },
  { chave: 'vertical',   rotulo: 'Vertical' }
];

var LEVANTAMENTOS = {
  crescimento: {
    titulo: 'Crescimento',
    colunas: 'G–L',
    grupos: [
      {
        nome: 'Porte da planta',
        campos: [
          { chave: 'alturaPlanta', rotulo: 'Altura da planta', tipo: 'num', unidade: 'm' },
          { chave: 'cnp1',         rotulo: 'Cnp-1',            tipo: 'num', unidade: 'm', par: true },
          { chave: 'cnp2',         rotulo: 'Cnp-2',            tipo: 'num', unidade: 'm', par: true }
        ]
      },
      {
        nome: 'Cachos',
        campos: [
          { chave: 'cachosFrutos', rotulo: 'Cachos de frutos',         tipo: 'int', unidade: 'n.º' },
          { chave: 'cachosFlores', rotulo: 'Cachos de flores',         tipo: 'int', unidade: 'n.º' },
          { chave: 'cachosBotoes', rotulo: 'Cachos de botões florais', tipo: 'int', unidade: 'n.º' }
        ]
      }
    ]
  },
  descritores: {
    titulo: 'Descritores morfológicos',
    colunas: 'M–Y',
    grupos: [
      {
        nome: 'Hábito',
        campos: [
          { chave: 'habitoCrescimento', rotulo: 'Hábito de crescimento', tipo: 'habito' }
        ]
      },
      {
        nome: 'Folha',
        campos: [
          { chave: 'limboFoliar',      rotulo: 'Limbo foliar',     tipo: 'num', unidade: 'cm' },
          { chave: 'peciolo',          rotulo: 'Pecíolo',          tipo: 'num', unidade: 'cm' },
          { chave: 'folhaComprimento', rotulo: 'Comprimento',      tipo: 'num', unidade: 'cm', par: true },
          { chave: 'folhaLargura',     rotulo: 'Largura',          tipo: 'num', unidade: 'cm', par: true },
          { chave: 'lobulosFolha',     rotulo: 'Lóbulos da folha', tipo: 'int', unidade: 'n.º' }
        ]
      },
      {
        nome: 'Cores',
        campos: [
          { chave: 'corInflorMasc', rotulo: 'Cor da inflorescência — masculina', tipo: 'cor' },
          { chave: 'corInflorFem',  rotulo: 'Cor da inflorescência — feminina',  tipo: 'cor' },
          { chave: 'corFruto',      rotulo: 'Cor do fruto',                      tipo: 'cor' }
        ]
      },
      {
        nome: 'Fruto',
        campos: [
          { chave: 'frutoComprimento', rotulo: 'Comprimento', tipo: 'num', unidade: 'cm', par: true },
          { chave: 'frutoLargura',     rotulo: 'Largura',     tipo: 'num', unidade: 'cm', par: true }
        ]
      },
      {
        nome: 'Semente',
        campos: [
          { chave: 'sementeComprimento', rotulo: 'Comprimento', tipo: 'num', unidade: 'cm', par: true },
          { chave: 'sementeLargura',     rotulo: 'Largura',     tipo: 'num', unidade: 'cm', par: true }
        ]
      }
    ]
  }
};

function camposDe(modo) {
  var out = [];
  LEVANTAMENTOS[modo].grupos.forEach(function (g) {
    g.campos.forEach(function (c) { out.push(c); });
  });
  return out;
}

// ------------------------------------------------------------------- estado

var S = {
  plantas: null,
  fileiras: [],
  porFileira: {},
  porSeq: {},
  fileira: null,
  digitos: '',
  planta: null,
  modo: null,
  valores: {},
  edicao: null,        // {uuid, recorder} quando se está a corrigir um registo
  feitas: {},          // seq -> nome de quem registou, do levantamento actual
  feitasHora: '',
  aEnviar: false,
  abaHistorico: 'aparelho',
  registosServidor: null
};

var $ = function (id) { return document.getElementById(id); };

// ----------------------------------------------------------- armazenamento

var Def = {
  get: function (k, d) {
    try { var v = localStorage.getItem('indiarec.' + k); return v === null ? d : v; }
    catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem('indiarec.' + k, v); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem('indiarec.' + k); } catch (e) {} }
};

var DB = (function () {
  var bd = null;

  function abrir() {
    return new Promise(function (ok, mau) {
      if (bd) return ok(bd);
      var p = indexedDB.open('indiarec', 1);
      p.onupgradeneeded = function () {
        var d = p.result;
        if (!d.objectStoreNames.contains('envios')) {
          var s = d.createObjectStore('envios', { keyPath: 'uuid' });
          s.createIndex('estado', 'estado');
        }
      };
      p.onsuccess = function () { bd = p.result; ok(bd); };
      p.onerror = function () { mau(p.error); };
    });
  }

  /* A transacção tem de ser criada e usada no mesmo bloco síncrono: assim que a
   * pilha volta ao ciclo de eventos ela deixa de estar activa. Por isso o pedido
   * é feito já dentro do callback, e só resolvemos quando a transacção completa
   * — o que garante que os dados ficaram mesmo gravados no disco. */
  function comStore(modo, fn) {
    return abrir().then(function (d) {
      return new Promise(function (ok, mau) {
        var t = d.transaction('envios', modo);
        var r = fn(t.objectStore('envios'));
        t.oncomplete = function () { ok(r.result); };
        t.onerror = function () { mau(t.error); };
        t.onabort = function () { mau(t.error); };
      });
    });
  }

  return {
    guardar: function (e) { return comStore('readwrite', function (s) { return s.put(e); }); },
    todos: function () { return comStore('readonly', function (s) { return s.getAll(); }); },
    pendentes: function () {
      return this.todos().then(function (l) {
        return l.filter(function (e) { return e.estado === 'pendente'; })
                .sort(function (a, b) { return a.criadoEm - b.criadoEm; });
      });
    }
  };
})();

// ------------------------------------------------------------ administrador

var Admin = {
  pw: function () {
    var v = Def.get('adminPw', '');
    if (!v) return '';
    if (Date.now() > Number(Def.get('adminAte', 0))) { Admin.sair(); return ''; }
    return v;
  },
  activo: function () { return !!Admin.pw(); },
  entrar: function (pw) {
    Def.set('adminPw', pw);
    Def.set('adminAte', String(Date.now() + VALIDADE_ADMIN));
    pintarAdmin();
  },
  sair: function () { Def.del('adminPw'); Def.del('adminAte'); pintarAdmin(); }
};

function pintarAdmin() {
  var on = Admin.activo();
  $('crachaAdmin').hidden = !on;
  $('ligSairAdmin').hidden = !on;
  $('blocoAdmin').hidden = on;
}

// ----------------------------------------------------------------- ajudantes

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

function dois(n) { return (n < 10 ? '0' : '') + n; }

/** Data/hora local do aparelho, formatada e em ISO com fuso. */
function agoraLocal() {
  var d = new Date();
  var o = -d.getTimezoneOffset();
  var sinal = o >= 0 ? '+' : '-';
  var oa = Math.abs(o);
  return {
    texto: dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear() +
           ' ' + dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()),
    iso: d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate()) +
         'T' + dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()) +
         sinal + dois(Math.floor(oa / 60)) + ':' + dois(oa % 60),
    ms: d.getTime()
  };
}

var tempoBrinde = null;
function brinde(msg, mau) {
  var el = $('brinde');
  el.textContent = msg;
  el.classList.toggle('mau', !!mau);
  el.hidden = false;
  clearTimeout(tempoBrinde);
  tempoBrinde = setTimeout(function () { el.hidden = true; }, 3600);
}

function mostrar(id) {
  var ecras = document.querySelectorAll('.ecra');
  for (var i = 0; i < ecras.length; i++) ecras[i].hidden = (ecras[i].id !== id);
  window.scrollTo(0, 0);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Aceita vírgula decimal (convenção portuguesa). */
function paraNumero(txt) {
  var s = String(txt || '').trim().replace(',', '.');
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

function configurado() {
  return CFG.ENDPOINT && CFG.ENDPOINT.indexOf('COLAR_AQUI') !== 0;
}

/** Chave do cache de progresso: um por levantamento (e por ronda, no crescimento). */
function chaveEstado(modo) {
  return 'estado.' + modo + (modo === 'crescimento' ? '.' + Def.get('ronda', '') : '');
}

// -------------------------------------------------------------- barra de rede

function actualizarBarra(estado, texto) {
  var b = $('barraEstado');
  b.classList.remove('offline', 'enviando');
  if (estado) b.classList.add(estado);
  $('estadoTexto').textContent = texto;
}

function actualizarEstado() {
  return DB.pendentes().then(function (p) {
    var c = $('contadorFila');
    c.hidden = p.length === 0;
    c.textContent = p.length + ' por enviar';

    if (!navigator.onLine) {
      actualizarBarra('offline', p.length ? 'Sem rede — guardado no telemóvel' : 'Sem rede');
    } else if (S.aEnviar) {
      actualizarBarra('enviando', 'A enviar…');
    } else if (p.length) {
      actualizarBarra('enviando', 'Por enviar');
    } else {
      actualizarBarra(null, 'Ligado — tudo enviado');
    }
    return p;
  });
}

// ------------------------------------------------------------------- rede

function pedirGet(params) {
  if (!navigator.onLine || !configurado()) return Promise.reject(new Error('sem rede'));
  var token = Def.get('token', '');
  if (!token) return Promise.reject(new Error('sem código'));

  var q = ['token=' + encodeURIComponent(token)];
  for (var k in params) q.push(k + '=' + encodeURIComponent(params[k]));

  return fetch(CFG.ENDPOINT + '?' + q.join('&'), { redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.ok) throw new Error(j.erro || 'Erro do servidor');
      return j;
    });
}

function enviarFila() {
  if (S.aEnviar || !navigator.onLine || !configurado()) return Promise.resolve();
  var token = Def.get('token', '');
  if (!token) return Promise.resolve();

  S.aEnviar = true;
  actualizarEstado();

  return DB.pendentes().then(function (fila) {
    if (!fila.length) return;

    // correcções a registos de outra pessoa só passam com o administrador ligado
    var adminPw = Admin.pw();
    var retidos = 0;
    if (!adminPw) {
      var antes = fila.length;
      fila = fila.filter(function (e) { return !e.precisaAdmin; });
      retidos = antes - fila.length;
    }
    if (retidos) {
      brinde(retidos + ' correcção(ões) à espera do modo administrador', true);
    }
    if (!fila.length) return;

    var lotes = [];
    for (var i = 0; i < fila.length; i += LOTE_ENVIO) lotes.push(fila.slice(i, i + LOTE_ENVIO));

    return lotes.reduce(function (cadeia, lote) {
      return cadeia.then(function () { return enviarLote(lote, token, adminPw); });
    }, Promise.resolve());
  }).then(function () {
    S.aEnviar = false;
    return actualizarEstado();
  }).catch(function () {
    S.aEnviar = false;
    return actualizarEstado();
  });
}

function enviarLote(lote, token, adminPw) {
  var corpo = {
    token: token,
    entries: lote.map(function (e) {
      return {
        uuid: e.uuid, tsLocal: e.tsLocal, ts: e.tsIso,
        recorder: e.recorder, device: e.device,
        mode: e.mode, ronda: e.ronda, substitui: e.substitui || '',
        seq: e.seq, pid: e.pid, row: e.row,
        noFileira: e.noFileira, noFolha: e.noFolha, source: e.source,
        values: e.values
      };
    })
  };
  if (adminPw) corpo.adminPassword = adminPw;

  return fetch(CFG.ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // evita o preflight CORS
    body: JSON.stringify(corpo),
    redirect: 'follow'
  }).then(function (r) {
    return r.json();
  }).then(function (resp) {
    if (!resp.ok) throw new Error(resp.erro || 'Erro do servidor');

    var porUuid = {};
    (resp.resultados || []).forEach(function (r) { porUuid[r.uuid] = r; });

    return Promise.all(lote.map(function (e) {
      var r = porUuid[e.uuid];
      if (!r) return Promise.resolve();
      if (r.ok) {
        e.estado = 'enviado';
        e.enviadoEm = Date.now();
        e.celulas = r.celulas || [];
        e.accao = r.accao || '';
      } else {
        e.estado = 'erro';
        e.erro = r.erro || 'Erro desconhecido';
      }
      return DB.guardar(e);
    })).then(function () {
      var bons = lote.filter(function (e) { return e.estado === 'enviado'; }).length;
      var maus = lote.filter(function (e) { return e.estado === 'erro'; }).length;
      if (bons) brinde(bons + (bons === 1 ? ' registo enviado' : ' registos enviados'));
      if (maus) brinde(maus + ' registo(s) recusado(s) — ver em Registos', true);
      if (bons) carregarProgresso();
    });
  });
}

// ---------------------------------------------------------------- progresso

/** Junta o que o servidor sabe com o que ainda está na fila deste aparelho. */
function aplicarFeitas(lista, hora) {
  var m = {};
  (lista || []).forEach(function (par) { m[par[0]] = par[1]; });
  S.feitas = m;
  S.feitasHora = hora || '';
  return DB.todos().then(function (l) {
    var ronda = Def.get('ronda', '');
    l.forEach(function (e) {
      if (e.estado === 'erro' || e.mode !== S.modo) return;
      if (S.modo === 'crescimento' && e.ronda !== ronda) return;
      if (!S.feitas[e.seq]) S.feitas[e.seq] = e.recorder;
    });
  });
}

function carregarProgresso(forcar) {
  if (!S.modo) return Promise.resolve();
  var chave = chaveEstado(S.modo);

  var guardado = null;
  try { guardado = JSON.parse(Def.get(chave, 'null')); } catch (e) {}

  var usarCache = guardado && !forcar
    ? aplicarFeitas(guardado.feitas, guardado.hora)
    : Promise.resolve();

  return usarCache.then(function () {
    pintarProgresso();
    return pedirGet({ action: 'estado', mode: S.modo, ronda: Def.get('ronda', '') });
  }).then(function (j) {
    Def.set(chave, JSON.stringify({ feitas: j.feitas, hora: j.hora }));
    if (j.rondas) Def.set('rondasConhecidas', JSON.stringify(j.rondas));
    return aplicarFeitas(j.feitas, j.hora);
  }).then(function () {
    pintarProgresso();
  }).catch(function () {
    if (guardado) return aplicarFeitas(guardado.feitas, guardado.hora).then(pintarProgresso);
    return aplicarFeitas([], '').then(pintarProgresso);
  });
}

function contarFileira(row) {
  var lista = S.porFileira[row] || [];
  var feitas = 0, total = 0;
  for (var i = 1; i < lista.length; i++) {
    if (!lista[i]) continue;
    total++;
    if (S.feitas[lista[i].seq]) feitas++;
  }
  return { feitas: feitas, total: total };
}

function totalFeitas() {
  var n = 0;
  for (var k in S.feitas) n++;
  return n;
}

function pintarProgresso() {
  desenharFileiras();
  resolverPlanta();
  pintarCartoes();
  if (!$('ecraProgresso').hidden) desenharEcraProgresso();
}

/** Barras nos dois cartões do ecrã inicial (uma leitura por levantamento). */
function pintarCartoes() {
  ['crescimento', 'descritores'].forEach(function (modo) {
    var g = null;
    try { g = JSON.parse(Def.get(chaveEstado(modo), 'null')); } catch (e) {}
    var n = g && g.feitas ? g.feitas.length : 0;
    var pc = Math.round(n / 398 * 100);
    var barra = document.querySelector('[data-barra="' + modo + '"] i');
    var texto = document.querySelector('[data-texto="' + modo + '"]');
    if (barra) barra.style.width = pc + '%';
    if (texto) {
      texto.textContent = g
        ? n + ' de 398 plantas' + (pc >= 1 ? ' (' + pc + '%)' : '')
        : 'Progresso ainda não carregado';
    }
  });
}

function desenharEcraProgresso() {
  var lev = LEVANTAMENTOS[S.modo];
  var n = totalFeitas();
  var pc = Math.round(n / 398 * 100);

  $('subProgresso').textContent = lev.titulo +
    (S.modo === 'crescimento' ? ' · ' + Def.get('ronda', '') : '') +
    (S.feitasHora ? ' · actualizado ' + S.feitasHora : ' · sem actualização do servidor');

  $('totalProgresso').innerHTML =
    '<div class="resumo"><div class="grande">' + n + ' / 398</div>' +
    '<div class="peq">' + (398 - n) + ' plantas por registar</div>' +
    '<span class="minibarra"><i style="width:' + pc + '%"></i></span></div>';

  var alvo = $('listaFileiras');
  alvo.innerHTML = '';
  S.fileiras.forEach(function (f) {
    var c = contarFileira(f.row);
    var p = c.total ? Math.round(c.feitas / c.total * 100) : 0;
    var d = document.createElement('div');
    d.className = 'linhaFileira' + (c.feitas === c.total ? ' completa' : '');
    d.innerHTML = '<span class="nome">' + f.row + '</span>' +
      '<span class="minibarra"><i style="width:' + p + '%"></i></span>' +
      '<span class="cont">' + c.feitas + '/' + c.total + '</span>';
    alvo.appendChild(d);
  });
}

// ------------------------------------------------------------------ plantas

/* O plants.json só traz os dois blocos (fileiras e lotes); as 398 plantas são
 * expandidas aqui. Poupa ~46 kB de transferência e de espaço no telemóvel. */
function carregarPlantas() {
  return fetch('plants.json').then(function (r) { return r.json(); }).then(function (j) {
    function expandir(blocos, campo) {
      var out = [];
      blocos.forEach(function (b) {
        for (var i = 1; i <= b.count; i++) out.push([b[campo], i]);
      });
      return out;
    }

    var fil = expandir(j.fileiras, 'row');
    var lot = expandir(j.lotes, 'source');
    if (fil.length !== j.total || lot.length !== j.total) {
      throw new Error('plants.json inconsistente');
    }

    S.fileiras = j.fileiras;
    S.porFileira = {};
    S.porSeq = {};

    for (var k = 0; k < j.total; k++) {
      var seq = k + 1;
      var p = {
        seq: seq,
        pid: j.prefixo + ('00' + seq).slice(-3),
        sheetRow: j.primeiraLinha + k,
        row: fil[k][0],
        noFileira: fil[k][1],
        source: lot[k][0],
        noFolha: lot[k][1]
      };
      (S.porFileira[p.row] = S.porFileira[p.row] || [])[p.noFileira] = p;
      S.porSeq[seq] = p;
    }
  });
}

function desenharFileiras() {
  var g = $('grelhaFileiras');
  if (!g) return;
  g.innerHTML = '';
  S.fileiras.forEach(function (f) {
    var c = contarFileira(f.row);
    var b = document.createElement('button');
    b.innerHTML = f.row + '<small>1–' + f.count + '</small>' +
      '<span class="feito">' + c.feitas + '/' + c.total + '</span>';
    b.className = (S.fileira === f.row ? 'activo' : '') +
      (c.feitas === c.total ? ' completa' : '');
    b.onclick = function () {
      S.fileira = f.row;
      desenharFileiras();
      resolverPlanta();
    };
    g.appendChild(b);
  });
}

function podeEditar(quem) {
  return Admin.activo() || !quem || quem === Def.get('nome', '');
}

function resolverPlanta() {
  var visor = $('visorNumero');
  if (!visor) return;
  visor.textContent = S.digitos || '—';
  visor.classList.toggle('vazio', !S.digitos);

  var cx = $('resolvidoPlanta');
  S.planta = null;

  if (!S.fileira || !S.digitos) {
    cx.hidden = true;
    $('btnPlanta').disabled = true;
    return;
  }

  var n = parseInt(S.digitos, 10);
  var p = (S.porFileira[S.fileira] || [])[n];
  cx.hidden = false;

  if (!p) {
    var max = (S.fileiras.filter(function (f) { return f.row === S.fileira; })[0] || {}).count;
    cx.className = 'erro';
    cx.textContent = 'A fileira ' + S.fileira + ' só tem ' + max + ' plantas.';
    $('btnPlanta').disabled = true;
    return;
  }

  S.planta = p;
  var quem = S.feitas[p.seq];
  var extra = '';
  if (quem) {
    extra = podeEditar(quem)
      ? '<br><span style="color:var(--acento)">✓ já registada' +
        (quem === Def.get('nome', '') ? ' por si' : ' por ' + esc(quem)) + ' — pode corrigir</span>'
      : '<br><span style="color:var(--aviso)">🔒 registada por ' + esc(quem) +
        ' — só essa pessoa ou um administrador pode corrigir</span>';
  }

  cx.className = '';
  cx.innerHTML = '<b>' + esc(p.pid) + '</b>' + extra + '<br>' +
    'Fileira ' + p.row + ', n.º ' + p.noFileira + ' &nbsp;·&nbsp; lote ' + esc(p.source) +
    ' (n.º ' + p.noFolha + ' no lote)';
  $('btnPlanta').disabled = !!(quem && !podeEditar(quem));
}

/** Primeira planta ainda sem registo, a partir da posição actual. */
function proximaPorFazer() {
  var inicio = S.planta ? S.planta.seq + 1 : 1;
  for (var s = inicio; s <= 398; s++) if (!S.feitas[s]) return S.porSeq[s];
  for (var t = 1; t < inicio; t++) if (!S.feitas[t]) return S.porSeq[t];
  return null;
}

function irParaPlanta(p) {
  if (!p) { brinde('Não há mais plantas por registar.'); return; }
  S.fileira = p.row;
  S.digitos = String(p.noFileira);
  desenharFileiras();
  resolverPlanta();
}

// --------------------------------------------------------------- formulário

function desenharFormulario() {
  var lev = LEVANTAMENTOS[S.modo];
  var alvo = $('camposForm');
  alvo.innerHTML = '';

  $('tituloForm').textContent = S.planta.pid;
  $('subForm').textContent = lev.titulo + ' · fileira ' + S.planta.row +
    ', n.º ' + S.planta.noFileira + (S.modo === 'crescimento' ? ' · ' + Def.get('ronda', '') : '');

  var av = $('avisoEdicao');
  if (S.edicao) {
    av.hidden = false;
    av.className = 'aviso';
    av.textContent = 'A corrigir o registo de ' +
      (S.edicao.recorder === Def.get('nome', '') ? 'si próprio' : S.edicao.recorder) +
      '. Os valores que deixar em branco não apagam o que já está na folha.';
  } else {
    av.hidden = true;
  }

  lev.grupos.forEach(function (g) {
    var box = document.createElement('div');
    box.className = 'grupo';
    box.innerHTML = '<h3>' + g.nome + '</h3>';

    var i = 0;
    while (i < g.campos.length) {
      var c = g.campos[i];
      if (c.par && g.campos[i + 1] && g.campos[i + 1].par) {
        var d = document.createElement('div');
        d.className = 'par';
        d.appendChild(controlo(g.campos[i]));
        d.appendChild(controlo(g.campos[i + 1]));
        box.appendChild(d);
        i += 2;
      } else {
        box.appendChild(controlo(c));
        i += 1;
      }
    }
    alvo.appendChild(box);
  });

  $('btnEnviar').textContent = S.edicao ? 'Guardar correcção' : 'Guardar e enviar';
}

function controlo(c) {
  var env = document.createElement('div');
  var actual = S.valores[c.chave];

  if (c.tipo === 'cor' || c.tipo === 'habito') {
    var opcoes = (c.tipo === 'cor') ? CORES : HABITOS;
    env.innerHTML = '<label class="campo">' + c.rotulo + '</label>';
    var caixa = document.createElement('div');
    caixa.className = 'escolhas ' + (c.tipo === 'cor' ? 'cores' : 'duas');

    opcoes.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'escolha' + (actual === o.chave ? ' activo' : '');
      b.innerHTML = (c.tipo === 'cor')
        ? '<span class="amostra ' + o.chave + '"></span><span>' + o.rotulo + '</span>'
        : '<span class="icoHabito ' + o.chave + '"><i></i></span><span>' + o.rotulo + '</span>';
      b.onclick = function () {
        var jaEstava = S.valores[c.chave] === o.chave;
        S.valores[c.chave] = jaEstava ? undefined : o.chave;   // tocar outra vez desmarca
        var irmaos = caixa.querySelectorAll('.escolha');
        for (var k = 0; k < irmaos.length; k++) irmaos[k].classList.remove('activo');
        if (!jaEstava) b.classList.add('activo');
      };
      caixa.appendChild(b);
    });
    env.appendChild(caixa);
    return env;
  }

  var id = 'campo_' + c.chave;
  env.innerHTML =
    '<label class="campo" for="' + id + '">' + c.rotulo +
    ' <span class="unidade">(' + c.unidade + ')</span></label>' +
    '<input type="text" id="' + id + '" inputmode="' +
    (c.tipo === 'int' ? 'numeric' : 'decimal') + '" autocomplete="off">';

  var inp = env.querySelector('input');
  if (actual !== undefined) inp.value = String(actual).replace('.', ',');
  inp.addEventListener('input', function () {
    var n = paraNumero(inp.value);
    var mau = (n !== null) && (isNaN(n) || n < 0 || (c.tipo === 'int' && Math.round(n) !== n));
    inp.classList.toggle('invalido', mau);
    S.valores[c.chave] = (n === null || isNaN(n)) ? undefined : n;
  });
  return env;
}

function validarFormulario() {
  var maus = [], vazios = [];
  camposDe(S.modo).forEach(function (c) {
    var v = S.valores[c.chave];
    if (v === undefined || v === '') { vazios.push(c.rotulo); return; }
    if ((c.tipo === 'num' || c.tipo === 'int') && (isNaN(v) || v < 0)) maus.push(c.rotulo);
    if (c.tipo === 'int' && Math.round(v) !== v) maus.push(c.rotulo);
  });
  return { maus: maus, vazios: vazios };
}

function gravarRegisto() {
  var t = agoraLocal();
  var vals = {};
  camposDe(S.modo).forEach(function (c) {
    if (S.valores[c.chave] !== undefined) vals[c.chave] = S.valores[c.chave];
  });

  var eu = Def.get('nome', '');
  var dono = S.edicao ? S.edicao.recorder : S.feitas[S.planta.seq];

  var reg = {
    uuid: uuid(),
    criadoEm: t.ms,
    tsLocal: t.texto,
    tsIso: t.iso,
    estado: 'pendente',
    recorder: eu,
    device: Def.get('aparelho', ''),
    mode: S.modo,
    ronda: S.modo === 'crescimento' ? Def.get('ronda', '') : '',
    substitui: S.edicao ? S.edicao.uuid : '',
    precisaAdmin: !!(dono && dono !== eu),
    seq: S.planta.seq,
    pid: S.planta.pid,
    row: S.planta.row,
    noFileira: S.planta.noFileira,
    noFolha: S.planta.noFolha,
    source: S.planta.source,
    values: vals
  };

  return DB.guardar(reg).then(function () {
    brinde((S.edicao ? 'Correcção guardada: ' : 'Guardado: ') + reg.pid);
    S.feitas[reg.seq] = eu;
    S.edicao = null;
    actualizarEstado();
    enviarFila();

    var seguinte = proximaPorFazer();
    if (seguinte && seguinte.row === S.planta.row) {
      irParaPlanta(seguinte);
    } else {
      S.digitos = '';
      desenharFileiras();
      resolverPlanta();
    }
    mostrar('ecraPlanta');
  });
}

// ---------------------------------------------------------------- registos

function desenharHistorico() {
  var ul = $('listaHistorico');
  var eu = Def.get('nome', '');

  if (S.abaHistorico === 'aparelho') {
    DB.todos().then(function (l) {
      l.sort(function (a, b) { return b.criadoEm - a.criadoEm; });
      var pend = l.filter(function (e) { return e.estado === 'pendente'; }).length;
      $('subHistorico').textContent =
        l.length + ' registo(s) feito(s) neste aparelho · ' + pend + ' por enviar';

      ul.innerHTML = '';
      if (!l.length) {
        ul.innerHTML = '<li class="vazio">Ainda não há registos.</li>';
        return;
      }
      l.slice(0, 120).forEach(function (e) {
        ul.appendChild(itemHistorico({
          marca: e.estado === 'enviado' ? '✅' : (e.estado === 'erro' ? '⚠️' : '⏳'),
          pid: e.pid,
          linha2: LEVANTAMENTOS[e.mode].titulo +
                  (e.substitui ? ' · correcção' : '') +
                  (e.estado === 'erro' ? ' — ' + e.erro : ''),
          quando: e.tsLocal.slice(0, 16),
          podeAbrir: true,
          abrir: function () { abrirLocal(e); }
        }));
      });
    });
    return;
  }

  // aba "Todos" — precisa do servidor
  ul.innerHTML = '<li class="vazio">A carregar…</li>';
  var mostrarLista = function (registos, hora) {
    S.registosServidor = registos;
    $('subHistorico').textContent = registos.length + ' registo(s) na folha' +
      (hora ? ' · actualizado ' + hora : '');
    ul.innerHTML = '';
    if (!registos.length) {
      ul.innerHTML = '<li class="vazio">Ainda não há registos na folha.</li>';
      return;
    }
    registos.forEach(function (r) {
      var meu = podeEditar(r.recorder);
      ul.appendChild(itemHistorico({
        marca: meu ? '✏️' : '🔒',
        cadeado: !meu,
        pid: r.pid,
        linha2: (LEVANTAMENTOS[r.mode] || {}).titulo + ' · ' + r.recorder +
                (r.ultimo && r.ultimo !== r.recorder ? ' · corrigido por ' + r.ultimo : ''),
        quando: String(r.ts).slice(0, 16),
        podeAbrir: meu,
        abrir: function () { abrirDoServidor(r); }
      }));
    });
  };

  pedirGet({ action: 'historico', limite: 200 }).then(function (j) {
    Def.set('historicoCache', JSON.stringify({ registos: j.registos, hora: j.hora }));
    mostrarLista(j.registos, j.hora);
  }).catch(function () {
    var g = null;
    try { g = JSON.parse(Def.get('historicoCache', 'null')); } catch (e) {}
    if (g) {
      mostrarLista(g.registos, g.hora + ' (sem rede)');
    } else {
      ul.innerHTML = '<li class="vazio">Sem rede e sem cópia guardada. ' +
                     'Ligue-se à rede uma vez para ver todos os registos.</li>';
      $('subHistorico').textContent = '';
    }
  });
}

function itemHistorico(o) {
  var li = document.createElement('li');
  if (o.podeAbrir) li.className = 'tocavel';
  if (o.cadeado) li.classList.add('cadeado');
  li.innerHTML = '<span class="marca">' + o.marca + '</span>' +
    '<span>' + esc(o.pid) + '<br><small style="color:#a8b09a">' + esc(o.linha2) + '</small></span>' +
    '<span class="quando">' + esc(o.quando) + '</span>';
  if (o.podeAbrir) {
    li.onclick = o.abrir;
  } else {
    li.onclick = function () { brinde('Registo de outra pessoa — só o administrador o corrige.', true); };
  }
  return li;
}

function prepararEdicao(modo, ronda, planta, valores, dono, uuidOriginal) {
  S.modo = modo;
  if (modo === 'crescimento' && ronda) Def.set('ronda', ronda);
  S.planta = planta;
  S.fileira = planta.row;
  S.digitos = String(planta.noFileira);
  S.valores = {};
  camposDe(modo).forEach(function (c) {
    if (valores[c.chave] !== undefined) S.valores[c.chave] = valores[c.chave];
  });
  S.edicao = { uuid: uuidOriginal, recorder: dono || Def.get('nome', '') };
  desenharFormulario();
  mostrar('ecraFormulario');
}

function abrirLocal(e) {
  var p = S.porSeq[e.seq];
  if (!p) { brinde('Planta desconhecida.', true); return; }
  prepararEdicao(e.mode, e.ronda, p, e.values || {}, e.recorder, e.uuid);
}

function abrirDoServidor(r) {
  var m = /-(\d{3})$/.exec(r.pid);
  var p = m ? S.porSeq[parseInt(m[1], 10)] : null;
  if (!p) { brinde('Planta desconhecida.', true); return; }

  brinde('A carregar o registo…');
  pedirGet({ action: 'registo', uuid: r.uuid }).then(function (j) {
    prepararEdicao(j.registo.mode, j.registo.ronda, p, j.registo.values, j.registo.recorder, r.uuid);
  }).catch(function () {
    brinde('Não foi possível carregar. Precisa de rede.', true);
  });
}

// -------------------------------------------------------------------- ecrãs

function irParaEntrada() {
  $('inpNome').value = Def.get('nome', '');
  pintarAdmin();
  mostrar('ecraEntrada');
}

function irParaLevantamento() {
  $('ola').textContent = 'Olá, ' + Def.get('nome', '') + '.';
  pintarCartoes();
  mostrar('ecraLevantamento');
}

function abrirEcraPlanta() {
  $('subPlanta').textContent = LEVANTAMENTOS[S.modo].titulo + ' · colunas ' +
    LEVANTAMENTOS[S.modo].colunas;
  desenharFileiras();
  resolverPlanta();
  mostrar('ecraPlanta');
  carregarProgresso();
}

function desenharRondasConhecidas() {
  var alvo = $('rondasConhecidas');
  alvo.innerHTML = '';
  var lista = [];
  try { lista = JSON.parse(Def.get('rondasConhecidas', '[]')); } catch (e) {}
  lista.forEach(function (r) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = r;
    b.onclick = function () { $('inpRonda').value = r; };
    alvo.appendChild(b);
  });
}

function arrancar() {
  if (!Def.get('aparelho', '')) Def.set('aparelho', uuid().slice(0, 8));
  pintarAdmin();
  if (!Def.get('token', '')) { mostrar('ecraActivacao'); return; }
  if (!Def.get('nome', '')) { irParaEntrada(); return; }
  irParaLevantamento();
}

// ------------------------------------------------------------------ ligações

function ligarEventos() {
  $('btnActivar').onclick = function () {
    var v = $('inpCodigo').value.trim();
    var av = $('avisoActivacao');
    if (v.length < 6) {
      av.hidden = false;
      av.className = 'aviso erro';
      av.textContent = 'Código demasiado curto.';
      return;
    }
    Def.set('token', v);
    $('inpCodigo').value = '';
    av.hidden = true;
    irParaEntrada();
  };

  $('btnEntrar').onclick = function () {
    var v = $('inpNome').value.trim();
    if (!v) { $('inpNome').classList.add('invalido'); return; }
    $('inpNome').classList.remove('invalido');
    Def.set('nome', v);
    irParaLevantamento();
  };

  $('btnAdmin').onclick = function () {
    var pw = $('inpAdmin').value;
    var av = $('avisoAdmin');
    if (!pw) return;
    av.hidden = false;
    av.className = 'aviso';
    av.textContent = 'A verificar…';

    pedirGet({ action: 'admin', pw: pw }).then(function (j) {
      if (!j.admin) throw new Error('errada');
      Admin.entrar(pw);
      $('inpAdmin').value = '';
      av.hidden = true;
      brinde('Modo administrador ligado');
    }).catch(function (e) {
      av.className = 'aviso erro';
      av.textContent = (e && e.message === 'sem rede')
        ? 'Precisa de rede para entrar como administrador.'
        : 'Palavra-passe errada.';
    });
  };

  $('ligSairAdmin').onclick = function () {
    Admin.sair();
    brinde('Saiu do modo administrador');
  };

  $('ligDesactivar').onclick = function () {
    if (confirm('Apagar o código de activação deste aparelho? Os registos guardados não se perdem.')) {
      Def.del('token');
      mostrar('ecraActivacao');
    }
  };

  $('ligTrocarNome').onclick = irParaEntrada;   // o modo administrador mantém-se

  $('ligHistorico').onclick = function () {
    desenharHistorico();
    mostrar('ecraHistorico');
  };

  $('ligProgresso').onclick = function () {
    if (!S.modo) S.modo = 'descritores';
    desenharEcraProgresso();
    mostrar('ecraProgresso');
    carregarProgresso(true);
  };

  $('btnActualizarProgresso').onclick = function () {
    brinde('A actualizar…');
    carregarProgresso(true);
  };

  $('btnForcarEnvio').onclick = function () {
    enviarFila().then(desenharHistorico);
  };

  var abas = $('abasHistorico').querySelectorAll('.aba');
  for (var a = 0; a < abas.length; a++) {
    (function (b) {
      b.onclick = function () {
        S.abaHistorico = b.getAttribute('data-aba');
        for (var i = 0; i < abas.length; i++) abas[i].classList.remove('activo');
        b.classList.add('activo');
        desenharHistorico();
      };
    })(abas[a]);
  }

  var cartoes = document.querySelectorAll('.cartao[data-modo]');
  for (var i = 0; i < cartoes.length; i++) {
    (function (b) {
      b.onclick = function () {
        S.modo = b.getAttribute('data-modo');
        S.digitos = '';
        S.edicao = null;
        if (S.modo === 'crescimento') {
          $('inpRonda').value = Def.get('ronda', '');
          desenharRondasConhecidas();
          mostrar('ecraRonda');
        } else {
          abrirEcraPlanta();
        }
      };
    })(cartoes[i]);
  }

  $('btnRonda').onclick = function () {
    var v = $('inpRonda').value.trim();
    if (!v) { $('inpRonda').classList.add('invalido'); return; }
    $('inpRonda').classList.remove('invalido');
    Def.set('ronda', v);
    abrirEcraPlanta();
  };

  var teclas = $('teclado').querySelectorAll('button');
  for (var k = 0; k < teclas.length; k++) {
    (function (b) {
      b.onclick = function () {
        var t = b.getAttribute('data-t');
        if (t === 'limpar') S.digitos = '';
        else if (t === 'apagar') S.digitos = S.digitos.slice(0, -1);
        else if (S.digitos.length < 2) S.digitos = (S.digitos === '0' ? '' : S.digitos) + t;
        resolverPlanta();
      };
    })(teclas[k]);
  }

  $('ligProximaPorFazer').onclick = function () { irParaPlanta(proximaPorFazer()); };

  $('btnPlanta').onclick = function () {
    var quem = S.feitas[S.planta.seq];
    S.valores = {};
    S.edicao = null;

    if (quem) {
      // já existe registo: abrir em modo correcção, com os valores actuais
      DB.todos().then(function (l) {
        var ronda = Def.get('ronda', '');
        var meus = l.filter(function (e) {
          return e.seq === S.planta.seq && e.mode === S.modo && e.estado !== 'erro' &&
                 (S.modo !== 'crescimento' || e.ronda === ronda);
        }).sort(function (a, b) { return b.criadoEm - a.criadoEm; });

        if (meus.length) {
          prepararEdicao(S.modo, meus[0].ronda, S.planta, meus[0].values || {},
                         meus[0].recorder, meus[0].uuid);
          return;
        }
        var r = (S.registosServidor || []).filter(function (x) {
          return x.pid === S.planta.pid && x.mode === S.modo;
        })[0];
        if (r) { abrirDoServidor(r); return; }

        S.edicao = { uuid: '', recorder: quem };
        desenharFormulario();
        mostrar('ecraFormulario');
      });
      return;
    }

    desenharFormulario();
    mostrar('ecraFormulario');
  };

  $('ligTrocarPlanta').onclick = function () { S.edicao = null; mostrar('ecraPlanta'); };

  $('btnEnviar').onclick = function () {
    var v = validarFormulario();
    if (v.maus.length) { brinde('Corrija: ' + v.maus.join(', '), true); return; }
    if (v.vazios.length === camposDe(S.modo).length) {
      brinde('Preencha pelo menos um valor.', true);
      return;
    }
    if (v.vazios.length) {
      var ul = $('listaVazios');
      ul.innerHTML = '';
      v.vazios.forEach(function (r) {
        var li = document.createElement('li');
        li.textContent = r;
        ul.appendChild(li);
      });
      $('dlgIncompleto').showModal();
      return;
    }
    gravarRegisto();
  };

  $('btnVoltarPreencher').onclick = function () { $('dlgIncompleto').close(); };
  $('btnEnviarAssim').onclick = function () { $('dlgIncompleto').close(); gravarRegisto(); };

  var voltares = document.querySelectorAll('[data-voltar]');
  for (var j = 0; j < voltares.length; j++) {
    (function (b) {
      b.onclick = function () { mostrar(b.getAttribute('data-voltar')); pintarCartoes(); };
    })(voltares[j]);
  }

  window.addEventListener('online', function () { actualizarEstado(); enviarFila(); });
  window.addEventListener('offline', actualizarEstado);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { actualizarEstado(); enviarFila(); }
  });
  setInterval(function () { enviarFila(); }, INTERVALO_TENTATIVA);
}

// ------------------------------------------------------------------ arranque

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

carregarPlantas().then(function () {
  ligarEventos();
  arrancar();
  actualizarEstado();
  enviarFila();
}).catch(function () {
  document.querySelector('main').innerHTML =
    '<div class="aviso erro">Não foi possível carregar a lista de plantas. ' +
    'Abra a aplicação uma vez com rede para a instalar no telemóvel.</div>';
});
