/* JatMed — registo de medições de campo, funciona sem rede.
 *
 * Fluxo: activação -> nome -> levantamento -> (ronda) -> planta -> formulário.
 * Tudo o que é gravado vai primeiro para o IndexedDB do aparelho e só depois
 * segue para o Apps Script. A hora guardada é a do aparelho no momento em que
 * o utilizador carrega em "Guardar e enviar", não a do envio.
 */
'use strict';

var CFG = window.JATMED_CONFIG || {};
var LOTE_ENVIO = 25;          // entradas por pedido HTTP
var INTERVALO_TENTATIVA = 60000;

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
    colunas: 'F–K',
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
    colunas: 'L–X',
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
          { chave: 'limboFoliar',      rotulo: 'Limbo foliar', tipo: 'num', unidade: 'cm' },
          { chave: 'peciolo',          rotulo: 'Pecíolo',      tipo: 'num', unidade: 'cm' },
          { chave: 'folhaComprimento', rotulo: 'Comprimento',  tipo: 'num', unidade: 'cm', par: true },
          { chave: 'folhaLargura',     rotulo: 'Largura',      tipo: 'num', unidade: 'cm', par: true },
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
  fileira: null,
  digitos: '',
  planta: null,
  modo: null,
  valores: {},
  aEnviar: false
};

var $ = function (id) { return document.getElementById(id); };

// ----------------------------------------------------------- armazenamento

var Def = {
  get: function (k, d) {
    try { var v = localStorage.getItem('jatmed.' + k); return v === null ? d : v; }
    catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem('jatmed.' + k, v); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem('jatmed.' + k); } catch (e) {} }
};

var DB = (function () {
  var bd = null;

  function abrir() {
    return new Promise(function (ok, mau) {
      if (bd) return ok(bd);
      var p = indexedDB.open('jatmed', 1);
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
  tempoBrinde = setTimeout(function () { el.hidden = true; }, 3200);
}

function mostrar(id) {
  var ecras = document.querySelectorAll('.ecra');
  for (var i = 0; i < ecras.length; i++) ecras[i].hidden = (ecras[i].id !== id);
  window.scrollTo(0, 0);
}

/** Aceita vírgula decimal (convenção portuguesa). */
function paraNumero(txt) {
  var s = String(txt || '').trim().replace(',', '.');
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

// -------------------------------------------------------------- barra de rede

function actualizarBarra(estado, texto) {
  var b = $('barraEstado');
  b.classList.remove('offline', 'enviando');
  if (estado) b.classList.add(estado);
  $('estadoTexto').textContent = texto;
}

function actualizarEstado() {
  DB.pendentes().then(function (p) {
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
  });
}

// ------------------------------------------------------------------- envio

function enviarFila() {
  if (S.aEnviar || !navigator.onLine) return Promise.resolve();
  var token = Def.get('token', '');
  if (!token || !CFG.ENDPOINT || CFG.ENDPOINT.indexOf('COLAR_AQUI') === 0) return Promise.resolve();

  S.aEnviar = true;
  actualizarEstado();

  return DB.pendentes().then(function (fila) {
    if (!fila.length) return;

    var lotes = [];
    for (var i = 0; i < fila.length; i += LOTE_ENVIO) lotes.push(fila.slice(i, i + LOTE_ENVIO));

    return lotes.reduce(function (cadeia, lote) {
      return cadeia.then(function () { return enviarLote(lote, token); });
    }, Promise.resolve());
  }).then(function () {
    S.aEnviar = false;
    actualizarEstado();
  }).catch(function () {
    S.aEnviar = false;
    actualizarEstado();
  });
}

function enviarLote(lote, token) {
  var corpo = JSON.stringify({
    token: token,
    entries: lote.map(function (e) {
      return {
        uuid: e.uuid, tsLocal: e.tsLocal, ts: e.tsIso,
        recorder: e.recorder, device: e.device,
        mode: e.mode, ronda: e.ronda,
        seq: e.seq, pid: e.pid, row: e.row,
        noFileira: e.noFileira, noFolha: e.noFolha, source: e.source,
        values: e.values
      };
    })
  });

  return fetch(CFG.ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // evita o preflight CORS
    body: corpo,
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
      } else {
        e.estado = 'erro';
        e.erro = r.erro || 'Erro desconhecido';
      }
      return DB.guardar(e);
    })).then(function () {
      var bons = lote.filter(function (e) { return e.estado === 'enviado'; }).length;
      var maus = lote.filter(function (e) { return e.estado === 'erro'; }).length;
      if (bons) brinde(bons + (bons === 1 ? ' registo enviado' : ' registos enviados'));
      if (maus) brinde(maus + ' registo(s) recusado(s) — ver a lista', true);
    });
  });
}

// ------------------------------------------------------------------ plantas

function carregarPlantas() {
  return fetch('plants.json').then(function (r) { return r.json(); }).then(function (j) {
    S.plantas = j.plantas;
    S.fileiras = j.fileiras;
    S.porFileira = {};
    j.plantas.forEach(function (p) {
      (S.porFileira[p.row] = S.porFileira[p.row] || [])[p.noFileira] = p;
    });
  });
}

function desenharFileiras() {
  var g = $('grelhaFileiras');
  g.innerHTML = '';
  S.fileiras.forEach(function (f) {
    var b = document.createElement('button');
    b.innerHTML = f.row + '<small>1–' + f.count + '</small>';
    b.className = (S.fileira === f.row) ? 'activo' : '';
    b.onclick = function () {
      S.fileira = f.row;
      desenharFileiras();
      resolverPlanta();
    };
    g.appendChild(b);
  });
}

function resolverPlanta() {
  var visor = $('visorNumero');
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
  cx.className = '';
  cx.innerHTML = '<b>' + p.pid + '</b><br>' +
    'Fileira ' + p.row + ', n.º ' + p.noFileira + ' &nbsp;·&nbsp; ' +
    'lote ' + p.source + ' (n.º ' + p.noFolha + ' na folha)';
  $('btnPlanta').disabled = false;
}

// --------------------------------------------------------------- formulário

function desenharFormulario() {
  var lev = LEVANTAMENTOS[S.modo];
  var alvo = $('camposForm');
  alvo.innerHTML = '';
  S.valores = {};

  $('tituloForm').textContent = S.planta.pid;
  $('subForm').textContent = lev.titulo + ' · fileira ' + S.planta.row +
    ', n.º ' + S.planta.noFileira + (S.modo === 'crescimento' ? ' · ' + Def.get('ronda', '') : '');

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
}

function controlo(c) {
  var env = document.createElement('div');

  if (c.tipo === 'cor' || c.tipo === 'habito') {
    var opcoes = (c.tipo === 'cor') ? CORES : HABITOS;
    env.innerHTML = '<label class="campo">' + c.rotulo + '</label>';
    var caixa = document.createElement('div');
    caixa.className = 'escolhas ' + (c.tipo === 'cor' ? 'cores' : 'duas');

    opcoes.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'escolha';
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

  var reg = {
    uuid: uuid(),
    criadoEm: t.ms,
    tsLocal: t.texto,
    tsIso: t.iso,
    estado: 'pendente',
    recorder: Def.get('nome', ''),
    device: Def.get('aparelho', ''),
    mode: S.modo,
    ronda: S.modo === 'crescimento' ? Def.get('ronda', '') : '',
    seq: S.planta.seq,
    pid: S.planta.pid,
    row: S.planta.row,
    noFileira: S.planta.noFileira,
    noFolha: S.planta.noFolha,
    source: S.planta.source,
    values: vals
  };

  return DB.guardar(reg).then(function () {
    brinde('Guardado: ' + reg.pid);
    actualizarEstado();
    enviarFila();

    // Avança para a planta seguinte da mesma fileira, se existir.
    var seguinte = (S.porFileira[S.planta.row] || [])[S.planta.noFileira + 1];
    S.digitos = seguinte ? String(seguinte.noFileira) : '';
    resolverPlanta();
    mostrar('ecraPlanta');
  });
}

// ---------------------------------------------------------------- registos

function desenharEnvios() {
  DB.todos().then(function (l) {
    l.sort(function (a, b) { return b.criadoEm - a.criadoEm; });
    var ul = $('listaEnvios');
    ul.innerHTML = '';

    var pend = l.filter(function (e) { return e.estado === 'pendente'; }).length;
    $('subEnvios').textContent = l.length + ' registo(s) neste aparelho · ' + pend + ' por enviar';

    if (!l.length) {
      ul.innerHTML = '<li class="vazio">Ainda não há registos.</li>';
      return;
    }

    l.slice(0, 80).forEach(function (e) {
      var marca = e.estado === 'enviado' ? '✅' : (e.estado === 'erro' ? '⚠️' : '⏳');
      var li = document.createElement('li');
      li.innerHTML = '<span class="marca">' + marca + '</span>' +
        '<span>' + e.pid + '<br><small style="color:#a8b09a">' +
        LEVANTAMENTOS[e.mode].titulo +
        (e.estado === 'erro' ? ' — ' + e.erro : '') + '</small></span>' +
        '<span class="quando">' + e.tsLocal.slice(0, 16) + '</span>';
      ul.appendChild(li);
    });
  });
}

// -------------------------------------------------------------------- ecrãs

function irParaEntrada() {
  $('inpNome').value = Def.get('nome', '');
  mostrar('ecraEntrada');
}

function irParaLevantamento() {
  $('ola').textContent = 'Olá, ' + Def.get('nome', '') + '.';
  mostrar('ecraLevantamento');
}

function arrancar() {
  if (!Def.get('aparelho', '')) Def.set('aparelho', uuid().slice(0, 8));

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

  $('ligDesactivar').onclick = function () {
    if (confirm('Apagar o código de activação deste aparelho? Os registos guardados não se perdem.')) {
      Def.del('token');
      mostrar('ecraActivacao');
    }
  };

  $('ligTrocarNome').onclick = irParaEntrada;
  $('ligVerEnvios').onclick = function () { desenharEnvios(); mostrar('ecraEnvios'); };
  $('btnForcarEnvio').onclick = function () {
    enviarFila().then(desenharEnvios);
  };

  var cartoes = document.querySelectorAll('.cartao[data-modo]');
  for (var i = 0; i < cartoes.length; i++) {
    (function (b) {
      b.onclick = function () {
        S.modo = b.getAttribute('data-modo');
        S.digitos = '';
        if (S.modo === 'crescimento') {
          $('inpRonda').value = Def.get('ronda', '');
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

  $('btnPlanta').onclick = function () {
    desenharFormulario();
    mostrar('ecraFormulario');
  };

  $('ligTrocarPlanta').onclick = function () { mostrar('ecraPlanta'); };

  $('btnEnviar').onclick = function () {
    var v = validarFormulario();
    if (v.maus.length) {
      brinde('Corrija: ' + v.maus.join(', '), true);
      return;
    }
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
      b.onclick = function () { mostrar(b.getAttribute('data-voltar')); };
    })(voltares[j]);
  }

  window.addEventListener('online', function () { actualizarEstado(); enviarFila(); });
  window.addEventListener('offline', actualizarEstado);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { actualizarEstado(); enviarFila(); }
  });
  setInterval(function () { enviarFila(); }, INTERVALO_TENTATIVA);
}

function abrirEcraPlanta() {
  $('subPlanta').textContent = LEVANTAMENTOS[S.modo].titulo + ' · colunas ' +
    LEVANTAMENTOS[S.modo].colunas;
  desenharFileiras();
  resolverPlanta();
  mostrar('ecraPlanta');
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
