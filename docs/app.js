/* India Rec — registo de medições de campo, funciona sem rede.
 *
 * Fluxo: activação -> nome -> levantamento -> (ronda) -> planta -> formulário.
 * Tudo o que é gravado vai primeiro para o IndexedDB do aparelho e só depois
 * segue para o Apps Script. A hora guardada é a do aparelho no momento em que
 * o utilizador carrega em "Guardar e enviar", não a do envio.
 *
 * A planta escolhe-se pelo N.º DE REFERÊNCIA (o lote de semente, 1 a 17) e
 * pelo número dentro desse lote — é o que está escrito na etiqueta no campo.
 * A fileira aparece só como informação, por baixo.
 *
 * Permissões (2026-08-12): toda a gente corrige e elimina os registos, sejam
 * de quem forem. O rasto de quem fez o quê fica na folha Log.
 *
 * ⚠ Pode haver telemóveis com registos por enviar feitos pela versão anterior.
 * Nada aqui pode deitar fora um item da fila: os campos novos (notas, accao
 * 'morta'/'viva') são todos opcionais e a base de dados local não muda de
 * nome nem de versão.
 */
'use strict';

var CFG = window.INDIAREC_CONFIG || {};
var LOTE_ENVIO = 25;
var INTERVALO_TENTATIVA = 60000;
var VALIDADE_ADMIN = 12 * 3600 * 1000;   // o modo administrador expira ao fim de 12 h

// ------------------------------------------------------------------- campos

/* As etiquetas vivem no i18n.js. Aqui ficam só as chaves: 'verdeClaro' é o que
 * o aparelho guarda e envia, e é o Codigo.gs que o traduz para o inglês da
 * folha de cálculo ('Light green'). Mudar de idioma não muda nada disso. */
var CORES = [
  { chave: 'verdeClaro' },
  { chave: 'verdeMedio' },
  { chave: 'verdeEscuro' },
  { chave: 'vermelho' }
];

var HABITOS = [
  { chave: 'horizontal' },
  { chave: 'vertical' }
];

var LEVANTAMENTOS = {
  crescimento: {
    colunas: 'G–M',
    grupos: [
      {
        chave: 'porte',
        campos: [
          { chave: 'alturaPlanta', tipo: 'num', unidade: 'unid.m' },
          { chave: 'cnp1',         tipo: 'num', unidade: 'unid.m' },
          { chave: 'cnp2',         tipo: 'num', unidade: 'unid.m' },
          { chave: 'ramos',        tipo: 'int', unidade: 'unid.ramos' }
        ]
      },
      {
        chave: 'cachos',
        campos: [
          { chave: 'cachosFrutos', tipo: 'int', unidade: 'unid.cachos' },
          { chave: 'cachosFlores', tipo: 'int', unidade: 'unid.cachos' },
          { chave: 'cachosBotoes', tipo: 'int', unidade: 'unid.cachos' }
        ]
      }
    ]
  },
  descritores: {
    colunas: 'N–Z',
    grupos: [
      {
        chave: 'habito',
        campos: [
          { chave: 'habitoCrescimento', tipo: 'habito' }
        ]
      },
      {
        chave: 'folha',
        campos: [
          { chave: 'limboFoliar',      tipo: 'num', unidade: 'unid.cm' },
          { chave: 'peciolo',          tipo: 'num', unidade: 'unid.cm' },
          { chave: 'folhaComprimento', tipo: 'num', unidade: 'unid.cm' },
          { chave: 'folhaLargura',     tipo: 'num', unidade: 'unid.cm' },
          { chave: 'lobulosFolha',     tipo: 'int', unidade: 'unid.lobulos' }
        ]
      },
      {
        chave: 'cores',
        campos: [
          { chave: 'corInflorMasc', tipo: 'cor' },
          { chave: 'corInflorFem',  tipo: 'cor' },
          { chave: 'corFruto',      tipo: 'cor' }
        ]
      },
      {
        chave: 'fruto',
        campos: [
          { chave: 'frutoComprimento', tipo: 'num', unidade: 'unid.cm' },
          { chave: 'frutoLargura',     tipo: 'num', unidade: 'unid.cm' }
        ]
      },
      {
        chave: 'semente',
        campos: [
          { chave: 'sementeComprimento', tipo: 'num', unidade: 'unid.cm' },
          { chave: 'sementeLargura',     tipo: 'num', unidade: 'unid.cm' }
        ]
      }
    ]
  }
};

/**
 * O que a planta TEM, por oposição aos campos do formulário.
 *
 * Quando faltam o comprimento e a largura do fruto, o que isso quase sempre
 * quer dizer é que a planta não tem fruto — e é essa a pergunta útil antes de
 * gravar, não "faltam dois campos". Repare-se que a cor do fruto está aqui no
 * objecto 'fruto' e não no grupo 'cores' onde aparece no ecrã: são duas
 * arrumações diferentes da mesma lista, uma para preencher e outra para
 * perguntar.
 */
var OBJECTOS = {
  crescimento: [
    { chave: 'porte',  campos: ['alturaPlanta', 'cnp1', 'cnp2', 'ramos'] },
    { chave: 'cachos', campos: ['cachosFrutos', 'cachosFlores', 'cachosBotoes'] }
  ],
  descritores: [
    { chave: 'habito',   campos: ['habitoCrescimento'] },
    { chave: 'folha',    campos: ['limboFoliar', 'peciolo', 'folhaComprimento',
                                  'folhaLargura', 'lobulosFolha'] },
    { chave: 'florMasc', campos: ['corInflorMasc'] },
    { chave: 'florFem',  campos: ['corInflorFem'] },
    { chave: 'fruto',    campos: ['corFruto', 'frutoComprimento', 'frutoLargura'] },
    { chave: 'semente',  campos: ['sementeComprimento', 'sementeLargura'] }
  ]
};

function tituloLev(modo) { return t('lev.' + modo); }
function rotuloCampo(c) { return t('campo.' + c.chave); }
function rotuloOpcao(tipo, chave) { return t((tipo === 'cor' ? 'cor.' : 'habito.') + chave); }

/**
 * Nome do campo sem depender do grupo em que está.
 *
 * No formulário, "Comprimento" dentro do grupo "Semente" chega para se
 * perceber. Fora dele — na lista de campos por preencher, no aviso de valor
 * errado, na confirmação de eliminar — aparecia "Comprimento, Largura" quatro
 * vezes seguidas e ninguém sabia de qual se tratava. Quem tem nome comprido
 * em i18n usa-o aqui; os outros ficam com o curto.
 */
function rotuloCampoLongo(c) {
  var chave = 'campoLongo.' + c.chave;
  var s = t(chave);
  return s === chave ? rotuloCampo(c) : s;
}

/* A folha de cálculo é um conjunto de dados em inglês e o ecrã é em português,
 * mas o nome do lote é a excepção: é um código, tem de bater certo com o saco
 * de semente e com a folha, por isso vai tal e qual — como o Plant ID.
 * Traduzi-lo ('Índia — saco 01') só criava duas maneiras de dizer o mesmo. */
function loteDe(source) {
  for (var i = 0; i < S.lotes.length; i++) if (S.lotes[i].source === source) return S.lotes[i];
  return null;
}

/** N.º de referência de um lote: 1 (India #bag01) … 17 (India#S-4). */
function refDoLote(source) {
  var l = loteDe(source);
  return l ? l.ref : null;
}

/* Como o n.º de referência aparece no ecrã. O nome do lote vai tal e qual como
 * está na folha e no saco — é um código, não uma frase, e é por ele que se
 * confere no campo. */
function rotuloRef(source) {
  var r = refDoLote(source);
  return t('planta.ref', { ref: r === null ? '?' : r, lote: source });
}

/* O "India #" está em todos os 17 e não distingue nada: nos botões, onde o
 * espaço é pouco, fica só o que muda ('bag01', 'S-4'). */
function nomeCurtoLote(source) {
  return String(source || '').replace(/^India\s*#\s*/i, '');
}

function nomeRonda(bruto) {
  var s = String(bruto || '').trim();
  var m = /^(\d+)\s*(month|months|year|years)\s+after\s+planting\s*\((\d{4})(\d{2})(\d{2})\)$/i.exec(s);
  if (!m) return s;                       // ronda escrita à mão: fica como está
  var n = parseInt(m[1], 10);
  var u = /year/i.test(m[2]) ? (n === 1 ? t('ronda.ano') : t('ronda.anos'))
                             : (n === 1 ? t('ronda.mes') : t('ronda.meses'));
  return t('ronda.formato', {
    n: n, unidade: u, data: t('ronda.data', { a: m[3], m: m[4], d: m[5] })
  });
}

/* A plantação é em serpentina: numa fileira ímpar o n.º 1 está à esquerda do
 * talhão, numa fileira par está à direita. Sem isto, quem entra na fileira
 * pela ponta errada começa a contar ao contrário. Verificado contra a aba
 * 'layout' do ficheiro de campo — ver tools/gen_plants.py. */
function sentidoDaFileira(row) {
  for (var i = 0; i < S.fileiras.length; i++) {
    if (S.fileiras[i].row === row) return S.fileiras[i].sentido;
  }
  return null;
}

function textoSentido(row) {
  var s = sentidoDaFileira(row);
  if (s === 'esq') return t('planta.esq');
  if (s === 'dir') return t('planta.dir');
  return '';
}

function camposDe(modo) {
  var out = [];
  LEVANTAMENTOS[modo].grupos.forEach(function (g) {
    g.campos.forEach(function (c) { out.push(c); });
  });
  return out;
}

// ------------------------------------------------------------------- estado

var S = {
  idioma: 'pt',
  ecra: '',
  pilha: [],           // ecrãs por onde se passou, para o "Voltar" ir ao anterior
  plantas: null,
  total: 0,            // vem do plants.json; 0 até as plantas carregarem
  fileiras: [],
  lotes: [],           // n.º de referência 1..17, pela ordem da folha
  ordemCampos: [],     // controlos do formulário pela ordem em que se preenchem
  porFileira: {},
  porLote: {},
  porSeq: {},
  fileira: null,       // fileira escolhida (r01…r16)
  digitos: '',
  planta: null,
  modo: null,
  valores: {},
  notas: '',           // observação livre do registo que está aberto
  edicao: null,        // {uuid, recorder} quando se está a corrigir um registo
  feitas: {},          // seq -> nome de quem registou, do levantamento actual
  mortas: {},          // seq -> true; marca da planta, vale para os dois levantamentos
  feitasHora: '',
  aEnviar: false,
  /* O que aconteceu na última tentativa de envio: {hora, enviados, erro}.
   * Até 2026-08-14 as falhas eram engolidas por um .catch vazio e uma fila que
   * não subia não dava nenhuma pista a quem estava no campo. */
  ultimoEnvio: null,
  envio: { feitos: 0, total: 0 },   // progresso do envio a decorrer
  abaHistorico: 'aparelho',
  registosServidor: null
};

var $ = function (id) { return document.getElementById(id); };

// ------------------------------------------------------------------ idiomas

/** Texto na língua escolhida. {chave} nas frases é substituído por subs.chave. */
function t(chave, subs) {
  var tabela = TEXTOS[S.idioma] || TEXTOS.pt;
  var s = tabela[chave];
  if (s === undefined) s = (TEXTOS.pt[chave] !== undefined) ? TEXTOS.pt[chave] : chave;
  if (!subs) return s;
  return s.replace(/\{(\w+)\}/g, function (todo, k) {
    return (subs[k] === undefined) ? todo : String(subs[k]);
  });
}

function definirIdioma(cod) {
  if (!TEXTOS[cod]) cod = 'pt';
  S.idioma = cod;
  Def.set('idioma', cod);
  var info = IDIOMAS.filter(function (i) { return i.cod === cod; })[0];
  // dizer a verdade ao navegador evita que ele ofereça traduzir por cima
  document.documentElement.lang = (info && info.html) || cod;
  aplicarIdioma();
}

/** Reescreve tudo o que está marcado no HTML e volta a desenhar o que é dinâmico. */
function aplicarIdioma() {
  var fixos = document.querySelectorAll('[data-t]');
  for (var i = 0; i < fixos.length; i++) {
    fixos[i].innerHTML = t(fixos[i].getAttribute('data-t'));
  }
  var dicas = document.querySelectorAll('[data-tph]');
  for (var j = 0; j < dicas.length; j++) {
    dicas[j].setAttribute('placeholder', t(dicas[j].getAttribute('data-tph')));
  }
  pintarBotoesIdioma();
  redesenharEcra();
}

function pintarBotoesIdioma() {
  var caixa = $('idiomas');
  if (!caixa) return;
  caixa.innerHTML = '';
  IDIOMAS.forEach(function (i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = i.rotulo;
    b.className = (i.cod === S.idioma) ? 'activo' : '';
    b.onclick = function () { definirIdioma(i.cod); };
    caixa.appendChild(b);
  });
}

/** Volta a montar o ecrã actual, para o texto dinâmico mudar de língua também. */
function redesenharEcra() {
  actualizarEstado();
  pintarCartoes();
  if (S.ecra === 'ecraLevantamento') $('ola').textContent = t('lev.ola', { nome: Def.get('nome', '') });
  if (S.ecra === 'ecraRonda') {
    var campo = $('inpRonda');
    var bruto = campo.dataset.bruto || '';
    if (bruto) campo.value = nomeRonda(bruto);
    desenharRondasConhecidas();
  }
  if (S.ecra === 'ecraPlanta') {
    $('subPlanta').textContent = t('planta.sub', {
      titulo: tituloLev(S.modo), colunas: LEVANTAMENTOS[S.modo].colunas
    });
    desenharFileiras();
    resolverPlanta();
  }
  if (S.ecra === 'ecraFormulario' && S.planta) desenharFormulario();
  if (S.ecra === 'ecraProgresso') desenharEcraProgresso();
  if (S.ecra === 'ecraHistorico') desenharHistorico();
}

// ----------------------------------------------------------- armazenamento

var Def = {
  get: function (k, d) {
    try { var v = localStorage.getItem('indiarec.' + k); return v === null ? d : v; }
    catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem('indiarec.' + k, v); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem('indiarec.' + k); } catch (e) {} }
};

/**
 * A fila de envios.
 *
 * ⚠ A base tem de continuar a chamar-se 'indiarec' e a loja 'envios': há
 * telemóveis com registos por enviar feitos por versões anteriores, e mudar
 * qualquer um dos nomes deitava-os fora.
 *
 * Versão 2 (2026-08-14) acrescenta a loja 'config'. Uma subida de versão é
 * uma operação segura — o IndexedDB mantém as lojas que já existem — e é
 * precisa porque o service worker também envia a fila (sync em segundo plano)
 * e lá não há localStorage para ir buscar o código de activação.
 */
var DB = (function () {
  var bd = null;

  function abrir() {
    return new Promise(function (ok, mau) {
      if (bd) return ok(bd);
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
      p.onsuccess = function () { bd = p.result; ok(bd); };
      p.onerror = function () { mau(p.error); };
      p.onblocked = function () { mau(new Error('base de dados bloqueada')); };
    });
  }

  /* A transacção tem de ser criada e usada no mesmo bloco síncrono: assim que a
   * pilha volta ao ciclo de eventos ela deixa de estar activa. Por isso o pedido
   * é feito já dentro do callback, e só resolvemos quando a transacção completa
   * — o que garante que os dados ficaram mesmo gravados no disco. */
  function comStore(loja, modo, fn) {
    return abrir().then(function (d) {
      return new Promise(function (ok, mau) {
        var tx = d.transaction(loja, modo);
        var r = fn(tx.objectStore(loja));
        tx.oncomplete = function () { ok(r ? r.result : undefined); };
        tx.onerror = function () { mau(tx.error); };
        tx.onabort = function () { mau(tx.error); };
      });
    });
  }

  return {
    guardar: function (e) {
      return comStore('envios', 'readwrite', function (s) { return s.put(e); });
    },
    todos: function () {
      return comStore('envios', 'readonly', function (s) { return s.getAll(); });
    },
    pendentes: function () {
      return this.todos().then(function (l) {
        return l.filter(function (e) { return e.estado === 'pendente'; })
                .sort(function (a, b) { return a.criadoEm - b.criadoEm; });
      });
    },
    /* O service worker precisa de saber o URL e o código para poder enviar
     * sozinho. Fica aqui uma cópia, escrita sempre que muda. */
    guardarConfig: function (chave, valor) {
      return comStore('config', 'readwrite', function (s) {
        return s.put({ chave: chave, valor: valor });
      });
    }
  };
})();

/** Mantém a cópia que o service worker lê. Barato, e evita ficar desactualizada. */
function espelharConfig() {
  return Promise.all([
    DB.guardarConfig('endpoint', CFG.ENDPOINT || ''),
    DB.guardarConfig('token', Def.get('token', ''))
  ]).catch(function () {});
}

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

function pintarEcra(id) {
  S.ecra = id;
  var ecras = document.querySelectorAll('.ecra');
  for (var i = 0; i < ecras.length; i++) ecras[i].hidden = (ecras[i].id !== id);

  /* A escolha do idioma só aparece nos ecrãs de entrada: no meio do trabalho de
   * campo seria mais um alvo por onde tocar sem querer. */
  var caixa = $('idiomas');
  if (caixa) {
    caixa.hidden = ['ecraActivacao', 'ecraEntrada', 'ecraLevantamento'].indexOf(id) < 0;
  }
  window.scrollTo(0, 0);
}

/**
 * Vai para um ecrã e guarda de onde se veio, para o "Voltar" ir sempre ao ecrã
 * anterior — e não a um sítio fixo. Se o destino já estiver na pilha, corta-se
 * aí: assim andar em círculos (planta -> formulário -> planta -> …) não faz a
 * pilha crescer sem fim.
 */
function mostrar(id) {
  if (S.ecra && S.ecra !== id) {
    var i = S.pilha.indexOf(id);
    if (i >= 0) S.pilha.length = i;
    else S.pilha.push(S.ecra);
    if (S.pilha.length > 12) S.pilha.shift();
  }
  pintarEcra(id);
}

/** Ecrã de onde se veio, sem sair de lá. */
function ecraAnterior() {
  return S.pilha.length ? S.pilha[S.pilha.length - 1] : '';
}

/** Volta ao ecrã anterior e volta a desenhá-lo, para não mostrar dados velhos. */
function voltar(porOmissao) {
  var alvo = S.pilha.pop() || porOmissao || 'ecraLevantamento';
  pintarEcra(alvo);
  redesenharEcra();
}

/** Começa uma navegação do zero (entrada na aplicação, troca de utilizador). */
function reiniciarPilha() { S.pilha = []; }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Lê o número escrito pela pessoa, seja qual for o idioma do ecrã.
 *
 * Aceita sempre os dois sinais decimais: em português escreve-se 1,5 e em
 * inglês 1.5, e no campo há quem tenha o teclado numa língua e a aplicação
 * noutra. Regra: o último ponto ou vírgula é o sinal decimal; se o mesmo sinal
 * aparecer mais do que uma vez, é separador de milhares (1.234.567).
 * O NFKC trata dos algarismos e sinais de largura total dos teclados japoneses.
 *
 * Devolve null se estiver vazio e NaN se não for um número.
 */
function paraNumero(txt) {
  var s = String(txt === null || txt === undefined ? '' : txt);
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\s ']/g, '');
  if (s === '') return null;

  var p = s.lastIndexOf('.');
  var v = s.lastIndexOf(',');
  var corte = p > v ? p : v;

  if (corte >= 0) {
    var sinal = s.charAt(corte);
    if (s.indexOf(sinal) !== corte) {
      s = s.split('.').join('').split(',').join('');          // só milhares
    } else {
      s = s.slice(0, corte).split('.').join('').split(',').join('') + '.' + s.slice(corte + 1);
    }
  }

  if (!/^[+-]?\d*\.?\d*$/.test(s) || !/\d/.test(s)) return NaN;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

/** O mesmo número escrito com o sinal decimal do idioma escolhido. */
function mostrarNumero(v) {
  if (v === null || v === undefined || v === '') return '';
  var s = String(v);
  return t('num.separador') === ',' ? s.replace('.', ',') : s.replace(',', '.');
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
    c.textContent = t('rede.contador', { n: p.length });

    if (!navigator.onLine) {
      actualizarBarra('offline', p.length ? t('rede.semRedeFila') : t('rede.semRede'));
    } else if (S.aEnviar) {
      /* Com 100 registos à espera, "A enviar…" durante um minuto não diz se
       * está a andar. O contador mostra que está. */
      actualizarBarra('enviando', S.envio.total
        ? t('rede.aEnviarN', { n: S.envio.feitos, total: S.envio.total })
        : t('rede.aEnviar'));
    } else if (p.length) {
      actualizarBarra('enviando', t('rede.porEnviar'));
    } else {
      actualizarBarra(null, t('rede.ligado'));
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

/**
 * Manda a fila e, se não der, deixa o service worker encarregue de tentar
 * outra vez quando o telemóvel voltar a ter rede — mesmo com a aplicação
 * fechada. É isso que faz funcionar o "escrever 100 plantas sem rede e mandar
 * tudo à chegada": até aqui só se enviava enquanto a aplicação estava aberta.
 */
function agendarEnvio() {
  pedirSincronizacao();
  return enviarFila();
}

function pedirSincronizacao() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(function (reg) {
    if (reg.sync) return reg.sync.register('enviar-fila');
  }).catch(function () {});   // sem Background Sync (iOS) fica só o envio em primeiro plano
}

/**
 * "Tentar enviar agora". Manda a página tentar e, ao mesmo tempo, acorda o
 * service worker — se a página falhar por estar a meio de qualquer coisa, o
 * service worker leva-a até ao fim.
 */
function forcarEnvio() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    try { navigator.serviceWorker.controller.postMessage({ tipo: 'enviar' }); } catch (e) {}
  }
  pedirSincronizacao();
  return enviarFila();
}

function enviarFila() {
  if (S.aEnviar || !navigator.onLine || !configurado()) return Promise.resolve();
  var token = Def.get('token', '');
  if (!token) return Promise.resolve();

  S.aEnviar = true;
  S.envio = { feitos: 0, total: 0 };
  actualizarEstado();

  return DB.pendentes().then(function (fila) {
    if (!fila.length) return;

    /* Já não se retém nada à espera do modo administrador. Até 2026-08-12 as
     * correcções a registos de outra pessoa ficavam guardadas no telemóvel sem
     * nunca serem enviadas — e o servidor agora aceita-as de qualquer maneira.
     * ⚠ Itens antigos da fila ainda trazem `precisaAdmin: true`; se este filtro
     * voltasse, esses ficariam presos para sempre. */
    var adminPw = Admin.pw();

    S.envio.total = fila.length;
    var lotes = [];
    for (var i = 0; i < fila.length; i += LOTE_ENVIO) lotes.push(fila.slice(i, i + LOTE_ENVIO));

    /* Um lote de cada vez, e o seguinte só depois de o anterior estar gravado.
     * Assim, se a rede cair a meio dos 100, o que já passou fica marcado como
     * enviado e só o resto é que volta a ser tentado. */
    return lotes.reduce(function (cadeia, lote) {
      return cadeia.then(function () {
        return enviarLote(lote, token, adminPw).then(function () {
          S.envio.feitos += lote.length;
          return actualizarEstado();
        });
      });
    }, Promise.resolve());
  }).then(function () {
    S.aEnviar = false;
    S.envio = { feitos: 0, total: 0 };
    marcarTentativa(null);
    return actualizarEstado();
  }).catch(function (e) {
    S.aEnviar = false;
    S.envio = { feitos: 0, total: 0 };
    marcarTentativa(e);
    // ficou por enviar: o service worker que tente quando houver rede
    pedirSincronizacao();
    return actualizarEstado();
  });
}

/**
 * Guarda o resultado da última tentativa e põe-no no ecrã.
 *
 * A 13 de Agosto ficaram 13 registos por subir num telemóvel e não havia nada
 * na aplicação que dissesse porquê: o código de activação estava errado, o
 * servidor respondia "Não autorizado" e o `.catch` deitava isso fora. Agora a
 * razão fica escrita no ecrã do histórico, ao lado do botão de enviar.
 */
function marcarTentativa(erro) {
  S.ultimoEnvio = {
    hora: Date.now(),
    erro: erro ? (erro.message || String(erro)) : ''
  };
  pintarAvisoEnvio();
}

function pintarAvisoEnvio() {
  var el = $('avisoEnvio');
  if (!el) return;
  var u = S.ultimoEnvio;
  if (!u) { el.hidden = true; return; }

  el.hidden = false;
  el.className = 'aviso' + (u.erro ? ' erro' : '');
  var quando = horaCurta(u.hora);
  el.textContent = u.erro
    ? t('rede.falhouAs', { hora: quando, motivo: traduzirErro(u.erro) })
    : t('rede.okAs', { hora: quando });
}

function horaCurta(ms) {
  var d = new Date(ms);
  return dois(d.getHours()) + ':' + dois(d.getMinutes());
}

/** As mensagens que valem a pena explicar; o resto passa como veio do servidor. */
function traduzirErro(msg) {
  if (/sem rede|failed to fetch|networkerror|load failed/i.test(msg)) return t('rede.erroSemRede');
  if (/não autorizado|nao autorizado|unauthorized/i.test(msg)) return t('rede.erroCodigo');
  return msg;
}

function enviarLote(lote, token, adminPw) {
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
        /* Campos de 2026-08-12. Os itens que já estavam na fila não os têm —
         * daí o valor por omissão em vez de os assumir presentes. */
        notas: e.notas || '',
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
        /* Campo separado de propósito: `accao` é a intenção do aparelho
         * ('eliminar' ou vazio) e o progresso local depende dela. Escrever
         * aqui o resultado do servidor apagava essa intenção, e as eliminações
         * já enviadas voltavam a contar como registos. */
        e.accaoServidor = r.accao || '';
      } else {
        e.estado = 'erro';
        e.erro = r.erro || 'Erro desconhecido';
      }
      return DB.guardar(e);
    })).then(function () {
      var bons = lote.filter(function (e) { return e.estado === 'enviado'; }).length;
      var maus = lote.filter(function (e) { return e.estado === 'erro'; }).length;
      if (bons) brinde(bons === 1 ? t('rede.enviado') : t('rede.enviados', { n: bons }));
      if (maus) brinde(t('rede.recusados', { n: maus }), true);
      if (bons) carregarProgresso();
    });
  });
}

// ---------------------------------------------------------------- progresso

/** Junta o que o servidor sabe com o que ainda está na fila deste aparelho. */
function aplicarFeitas(lista, hora, mortas) {
  var m = {};
  (lista || []).forEach(function (par) { m[par[0]] = par[1]; });
  S.feitas = m;
  S.feitasHora = hora || '';

  var mm = {};
  (mortas || []).forEach(function (seq) { mm[seq] = true; });
  S.mortas = mm;

  return DB.todos().then(function (l) {
    var ronda = Def.get('ronda', '');
    /* Por ordem de criação: se a mesma planta foi registada e depois eliminada,
     * o que vale é a última coisa que se fez. */
    l.sort(function (a, b) { return a.criadoEm - b.criadoEm; });
    l.forEach(function (e) {
      if (e.estado === 'erro') return;

      /* Morta/viva é marca da planta e não de um levantamento: conta-se antes
       * do filtro do modo, senão marcar uma planta durante os descritores não
       * aparecia no crescimento. */
      if (e.accao === 'morta') { S.mortas[e.seq] = true; return; }
      if (e.accao === 'viva') { delete S.mortas[e.seq]; return; }

      if (e.mode !== S.modo) return;
      if (S.modo === 'crescimento' && e.ronda !== ronda) return;
      if (e.accao === 'eliminar') { delete S.feitas[e.seq]; return; }   // desconta, não soma
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
    ? aplicarFeitas(guardado.feitas, guardado.hora, guardado.mortas)
    : Promise.resolve();

  return usarCache.then(function () {
    pintarProgresso();
    return pedirGet({ action: 'estado', mode: S.modo, ronda: Def.get('ronda', '') });
  }).then(function (j) {
    Def.set(chave, JSON.stringify({ feitas: j.feitas, hora: j.hora, mortas: j.mortas || [] }));
    if (j.rondas) Def.set('rondasConhecidas', JSON.stringify(j.rondas));
    return aplicarFeitas(j.feitas, j.hora, j.mortas);
  }).then(function () {
    pintarProgresso();
  }).catch(function () {
    if (guardado) {
      return aplicarFeitas(guardado.feitas, guardado.hora, guardado.mortas).then(pintarProgresso);
    }
    return aplicarFeitas([], '', []).then(pintarProgresso);
  });
}

/**
 * Contagem de uma fileira. As plantas mortas contam como tratadas — senão a
 * fileira nunca ficava completa e quem lá anda ficava sem saber se ainda
 * faltava alguma coisa.
 */
function contarFileira(row) {
  return contarLista(S.porFileira[row]);
}

function contarLote(source) {
  return contarLista(S.porLote[source]);
}

function contarLista(lista) {
  lista = lista || [];
  var feitas = 0, mortas = 0, total = 0;
  for (var i = 1; i < lista.length; i++) {
    if (!lista[i]) continue;
    total++;
    if (S.feitas[lista[i].seq]) feitas++;
    else if (S.mortas[lista[i].seq]) mortas++;
  }
  return { feitas: feitas, mortas: mortas, tratadas: feitas + mortas, total: total };
}

function totalFeitas() {
  var n = 0;
  for (var k in S.feitas) n++;
  return n;
}

function totalMortas() {
  var n = 0;
  for (var k in S.mortas) if (!S.feitas[k]) n++;
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
    var pc = Math.round(n / S.total * 100);
    var barra = document.querySelector('[data-barra="' + modo + '"] i');
    var texto = document.querySelector('[data-texto="' + modo + '"]');
    if (barra) barra.style.width = pc + '%';
    if (texto) {
      texto.textContent = g
        ? t(pc >= 1 ? 'lev.contagemPc' : 'lev.contagem', { n: n, total: S.total, pc: pc })
        : t('lev.semProgresso');
    }
  });
}

function desenharEcraProgresso() {
  var n = totalFeitas();
  var mortas = totalMortas();
  var pc = Math.round((n + mortas) / S.total * 100);

  $('subProgresso').textContent = tituloLev(S.modo) +
    (S.modo === 'crescimento' ? ' · ' + nomeRonda(Def.get('ronda', '')) : '') +
    (S.feitasHora ? t('prog.actualizado', { hora: S.feitasHora }) : t('prog.semActualizacao'));

  $('totalProgresso').innerHTML =
    '<div class="resumo"><div class="grande">' + n + ' / ' + S.total + '</div>' +
    '<div class="peq">' + esc(t('prog.porRegistar', { n: S.total - n - mortas })) +
    (mortas ? ' · ' + esc(t('prog.mortas', { n: mortas })) : '') + '</div>' +
    '<span class="minibarra"><i style="width:' + pc + '%"></i></span></div>';

  /* Duas leituras da mesma coisa: por fileira, que é como se anda no terreno,
   * e por linhagem, que é como a folha de dados e o mapa estão organizados. */
  var alvo = $('listaFileiras');
  alvo.innerHTML = '';

  alvo.appendChild(cabecalhoLista(t('prog.porFileira')));
  S.fileiras.forEach(function (f) {
    alvo.appendChild(linhaProgresso(f.row, '', contarFileira(f.row)));
  });

  alvo.appendChild(cabecalhoLista(t('prog.porLinhagem')));
  S.lotes.forEach(function (l) {
    alvo.appendChild(linhaProgresso(l.ref, nomeCurtoLote(l.source), contarLote(l.source)));
  });
}

function cabecalhoLista(texto) {
  var h = document.createElement('h2');
  h.textContent = texto;
  return h;
}

function linhaProgresso(nome, sub, c) {
  var p = c.total ? Math.round(c.tratadas / c.total * 100) : 0;
  var d = document.createElement('div');
  d.className = 'linhaFileira' + (c.tratadas === c.total ? ' completa' : '');
  d.innerHTML = '<span class="nome">' + esc(nome) + '</span>' +
    (sub ? '<span class="lote">' + esc(sub) + '</span>' : '') +
    '<span class="minibarra"><i style="width:' + p + '%"></i></span>' +
    '<span class="cont">' + c.feitas + '/' + c.total +
    (c.mortas ? ' <small>†' + c.mortas + '</small>' : '') + '</span>';
  return d;
}

// ------------------------------------------------------------------ plantas

/* O plants.json só traz os dois blocos (fileiras e lotes); as 415 plantas são
 * expandidas aqui. Poupa ~48 kB de transferência e de espaço no telemóvel. */
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

    S.total = j.total;
    S.fileiras = j.fileiras;
    /* O n.º de referência é a posição do lote nesta lista: o primeiro lote é o
     * 1 e o último é o 17. Não há bag08, por isso o 'India #bag09' é o n.º 8. */
    S.lotes = j.lotes.map(function (l, i) {
      return { source: l.source, count: l.count, ref: i + 1 };
    });
    S.porFileira = {};
    S.porLote = {};
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
      (S.porLote[p.source] = S.porLote[p.source] || [])[p.noFolha] = p;
      S.porSeq[seq] = p;
    }
  });
}

/**
 * Grelha das fileiras. Escolher pela fileira é o que bate certo com o terreno,
 * e é assim desde o início — a passagem pelo n.º de referência (2026-08-12)
 * foi desfeita no dia 14. O que ficou dessa ideia é o ECRÃ: a linhagem e a
 * posição dentro dela aparecem em destaque no cartão da planta, porque é
 * assim que a folha de dados e o mapa do talhão estão organizados.
 */
function desenharFileiras() {
  var g = $('grelhaFileiras');
  if (!g) return;
  g.innerHTML = '';
  S.fileiras.forEach(function (f) {
    var c = contarFileira(f.row);
    var b = document.createElement('button');
    b.innerHTML = f.row + '<span class="feito">' + c.feitas + '/' + c.total + '</span>';
    b.className = (S.fileira === f.row ? 'activo' : '') +
      (c.tratadas === c.total ? ' completa' : '');
    /* Carregar na fileira já põe o n.º 1: é sempre por aí que se começa, e
     * poupa duas toques a quem tem o telemóvel numa mão e a fita na outra. */
    b.onclick = function () {
      S.fileira = f.row;
      S.digitos = '1';
      desenharFileiras();
      resolverPlanta();
    };
    g.appendChild(b);
  });
}

/* Desde 2026-08-12 toda a gente corrige e elimina tudo — a função fica porque
 * há sítios que perguntam, e para se poder voltar a fechar num só sítio. */
function podeEditar() { return true; }

function resolverPlanta() {
  var visor = $('visorNumero');
  if (!visor) return;
  /* Vazio, a caixa diz para que serve. Assim não é preciso um título por cima
   * dela — e o ecrã inteiro cabe sem se ter de arrastar para ver o Continuar. */
  visor.textContent = S.digitos || t('planta.numero');
  visor.classList.toggle('vazio', !S.digitos);

  var cx = $('resolvidoPlanta');
  S.planta = null;

  if (!S.fileira || !S.digitos) {
    cx.hidden = true;
    $('btnPlanta').disabled = true;
    pintarBotaoMorta();
    return;
  }

  var n = parseInt(S.digitos, 10);
  var p = (S.porFileira[S.fileira] || [])[n];
  cx.hidden = false;

  if (!p) {
    var max = (S.fileiras.filter(function (f) { return f.row === S.fileira; })[0] || {}).count;
    cx.className = 'erro';
    cx.textContent = t('planta.soTem', { row: S.fileira, max: max });
    $('btnPlanta').disabled = true;
    pintarBotaoMorta();
    return;
  }

  S.planta = p;
  cx.className = '';
  cx.innerHTML = cartaoPlanta(p);
  $('btnPlanta').disabled = false;
  pintarBotaoMorta();
}

/**
 * O cartão da planta. A LINHAGEM vem em primeiro e em grande, porque a folha
 * de dados e o mapa do talhão estão organizados por linhagem: quem vai a
 * andar pela fileira precisa de saber, sem contas, em que linhagem está e em
 * que planta dessa linhagem. O Plant ID e a posição na fileira vêm a seguir,
 * para se conferir com a etiqueta.
 */
function cartaoPlanta(p) {
  var avisos = '';
  if (S.mortas[p.seq]) {
    avisos += '<div class="marcaMorta">' + esc(t('planta.morta')) + '</div>';
  }
  var quem = S.feitas[p.seq];
  if (quem) {
    avisos += '<div class="jaFeita">' +
      (quem === Def.get('nome', '')
        ? esc(t('planta.jaFeitaPorSi'))
        : esc(t('planta.jaFeitaPor', { quem: quem }))) + '</div>';
  }
  // primeira planta da linhagem: é onde é fácil perder a conta
  var inicio = (p.noFolha === 1) ? ' <span class="inicioLote">' + esc(t('planta.inicioLote')) + '</span>' : '';

  return '<div class="linhagem">' + esc(rotuloRef(p.source)) +
    '<b>' + esc(t('planta.noLote', { no: p.noFolha })) + '</b>' + inicio + '</div>' +
    '<div class="idPlanta">' + esc(p.pid) + '</div>' +
    '<div class="posFileira">' + t('planta.detalhe', { row: p.row, no: p.noFileira }) +
    ' &nbsp;·&nbsp; <span class="sentido">' + esc(textoSentido(p.row)) + '</span></div>' +
    avisos;
}

/** Primeira planta ainda sem registo, a partir da posição actual. */
function proximaPorFazer() {
  var inicio = S.planta ? S.planta.seq + 1 : 1;
  for (var s = inicio; s <= S.total; s++) if (porFazer(s)) return S.porSeq[s];
  for (var u = 1; u < inicio; u++) if (porFazer(u)) return S.porSeq[u];
  return null;
}

/** Uma planta morta não está por fazer: saltar para ela seria mandar lá alguém. */
function porFazer(seq) { return !S.feitas[seq] && !S.mortas[seq]; }

function irParaPlanta(p) {
  if (!p) { brinde(t('planta.semMais')); return; }
  S.fileira = p.row;
  S.digitos = String(p.noFileira);
  desenharFileiras();
  resolverPlanta();
}

/** A planta seguinte da mesma fileira, ou null no fim da fileira. */
function seguinteNaFileira() {
  if (!S.planta) return null;
  return (S.porFileira[S.planta.row] || [])[S.planta.noFileira + 1] || null;
}

// ------------------------------------------------------------ planta morta

/**
 * Marca (ou desmarca) a planta como morta.
 *
 * Das 415 plantas há algumas que já morreram e essas nunca hão-de ter medidas.
 * Sem isto ficavam para sempre na lista do que falta fazer. É marca da planta
 * e não do levantamento: vale para o crescimento e para os descritores.
 *
 * O botão fica de lado e discreto — é o caso raro, não pode roubar o sítio ao
 * que se faz sempre.
 */
function pintarBotaoMorta() {
  var b = $('ligMorta');
  if (!b) return;
  var p = S.planta;
  b.hidden = !p;
  if (!p) return;
  var morta = !!S.mortas[p.seq];
  b.textContent = morta ? t('planta.desmarcarMorta') : t('planta.marcarMorta');
  b.classList.toggle('activo', morta);
}

function marcarMorta(morta) {
  var p = S.planta;
  if (!p) return Promise.resolve();

  var agora = agoraLocal();
  var reg = {
    uuid: uuid(),
    criadoEm: agora.ms,
    tsLocal: agora.texto,
    tsIso: agora.iso,
    estado: 'pendente',
    recorder: Def.get('nome', ''),
    device: Def.get('aparelho', ''),
    mode: S.modo || 'descritores',
    ronda: S.modo === 'crescimento' ? Def.get('ronda', '') : '',
    substitui: '',
    accao: morta ? 'morta' : 'viva',
    seq: p.seq,
    pid: p.pid,
    row: p.row,
    noFileira: p.noFileira,
    noFolha: p.noFolha,
    source: p.source,
    notas: '',
    values: {}
  };

  return DB.guardar(reg).then(function () {
    if (morta) S.mortas[p.seq] = true; else delete S.mortas[p.seq];
    brinde(t(morta ? 'planta.marcada' : 'planta.desmarcada', { pid: p.pid }));
    actualizarEstado();
    agendarEnvio();
    desenharFileiras();
    resolverPlanta();
  });
}

// --------------------------------------------------------------- formulário

function desenharFormulario() {
  var lev = LEVANTAMENTOS[S.modo];
  var alvo = $('camposForm');
  alvo.innerHTML = '';
  S.ordemCampos = [];

  $('linhagemForm').textContent = rotuloRef(S.planta.source) + '  ' +
    t('planta.noLote', { no: S.planta.noFolha });
  $('tituloForm').textContent = S.planta.pid;
  $('subForm').textContent = t('form.sub', {
    titulo: tituloLev(S.modo), row: S.planta.row, noFileira: S.planta.noFileira
  }) + (S.modo === 'crescimento' ? ' · ' + nomeRonda(Def.get('ronda', '')) : '');

  var av = $('avisoEdicao');
  if (S.edicao) {
    av.hidden = false;
    av.className = 'aviso';
    av.textContent = t('form.aCorrigir', {
      quem: S.edicao.recorder === Def.get('nome', '') ? t('form.siProprio') : S.edicao.recorder
    });
  } else {
    av.hidden = true;
  }

  lev.grupos.forEach(function (g) {
    var box = document.createElement('div');
    box.className = 'grupo';
    box.innerHTML = '<h3>' + esc(t('grupo.' + g.chave)) + '</h3>';

    /* Um campo por linha. Ter dois lado a lado poupava altura mas obrigava a
     * acertar em alvos estreitos com o telemóvel na mão e sol em cima. */
    g.campos.forEach(function (c) { box.appendChild(controlo(c)); });
    alvo.appendChild(box);
  });

  /* No último campo numérico o ▼ passa a ✓: quem chega ao fim da lista já não
   * tem para onde avançar, e o gesto seguinte é sempre gravar. */
  var ult = S.ordemCampos[S.ordemCampos.length - 1];
  if (ult && ult.botao) {
    ult.botao.textContent = '✓';
    ult.botao.classList.add('ultimo');
    ult.botao.setAttribute('aria-label', t('form.guardar'));
    ult.entrada.setAttribute('enterkeyhint', 'send');
  }

  alvo.appendChild(caixaNotas());

  $('btnEnviar').textContent = S.edicao ? t('form.guardarCorreccao') : t('form.guardar');

  /* Eliminar faz sentido para tudo o que já esteja na folha ou na fila deste
   * aparelho. Até 2026-08-12 o botão dependia do progresso já ter chegado do
   * servidor, e por isso desaparecia quando se abria um registo pelo
   * histórico — que é justamente onde as pessoas o iam procurar. */
  $('btnEliminar').hidden = !(S.edicao || S.feitas[S.planta.seq]);
}

/**
 * Observações. Fica no fim, fora da ordem de preenchimento: escreve-se poucas
 * vezes e não deve entrar no caminho do ▼ que salta de medida em medida.
 */
function caixaNotas() {
  var box = document.createElement('div');
  box.className = 'grupo';
  box.innerHTML = '<h3>' + esc(t('grupo.notas')) + '</h3>' +
    '<label class="campo" for="campoNotas">' + esc(t('campo.notas')) + '</label>' +
    '<textarea id="campoNotas" rows="3" autocomplete="off"></textarea>';
  var ta = box.querySelector('textarea');
  ta.placeholder = t('campo.notasExemplo');
  ta.value = S.notas || '';
  ta.addEventListener('input', function () { S.notas = ta.value; });
  return box;
}

/**
 * Anula um registo: os valores deste levantamento saem da folha e a planta
 * volta a contar como por fazer. Serve para quando se mediu a planta errada.
 * Vai pela mesma fila que os registos, por isso também funciona sem rede.
 */
function eliminarRegisto() {
  var agora = agoraLocal();

  var reg = {
    uuid: uuid(),
    criadoEm: agora.ms,
    tsLocal: agora.texto,
    tsIso: agora.iso,
    estado: 'pendente',
    recorder: Def.get('nome', ''),
    device: Def.get('aparelho', ''),
    mode: S.modo,
    ronda: S.modo === 'crescimento' ? Def.get('ronda', '') : '',
    substitui: S.edicao ? S.edicao.uuid : '',
    accao: 'eliminar',
    seq: S.planta.seq,
    pid: S.planta.pid,
    row: S.planta.row,
    noFileira: S.planta.noFileira,
    noFolha: S.planta.noFolha,
    source: S.planta.source,
    notas: '',
    values: {}
  };

  return DB.guardar(reg).then(function () {
    brinde(t('form.eliminado', { pid: reg.pid }));
    delete S.feitas[reg.seq];
    S.edicao = null;
    S.notas = '';
    actualizarEstado();
    agendarEnvio();
    if (ecraAnterior() !== 'ecraHistorico') S.digitos = '';
    desenharFileiras();
    resolverPlanta();
    voltar('ecraPlanta');
  });
}

/** Mostra o que vai desaparecer antes de perguntar se é mesmo para eliminar. */
function perguntarEliminar() {
  $('textoEliminar').textContent =
    S.planta.pid + ' — ' + tituloLev(S.modo) +
    (S.modo === 'crescimento' ? ' · ' + nomeRonda(Def.get('ronda', '')) : '');

  var ul = $('listaEliminar');
  ul.innerHTML = '';
  camposDe(S.modo).forEach(function (c) {
    var v = S.valores[c.chave];
    if (v === undefined || v === '') return;
    var texto = (c.tipo === 'cor' || c.tipo === 'habito')
      ? rotuloOpcao(c.tipo, v)
      : mostrarNumero(v);
    var li = document.createElement('li');
    li.textContent = rotuloCampoLongo(c) + ': ' + texto;
    ul.appendChild(li);
  });
  if (S.notas) {
    var liN = document.createElement('li');
    liN.textContent = t('campo.notas') + ': ' + S.notas;
    ul.appendChild(liN);
  }
  if (!ul.children.length) {
    var li0 = document.createElement('li');
    li0.textContent = t('dlg.semValores');
    ul.appendChild(li0);
  }

  $('dlgEliminar').showModal();
}

/**
 * Passa para o campo seguinte. No último, grava e envia — assim quem está no
 * campo faz a linha toda sem tirar o polegar do sítio.
 */
function avancarPara(i) {
  var prox = S.ordemCampos[i + 1];
  if (prox) { prox.focar(); return; }
  $('btnEnviar').click();
}

function controlo(c) {
  var env = document.createElement('div');
  var actual = S.valores[c.chave];
  var idx = S.ordemCampos.length;

  if (c.tipo === 'cor' || c.tipo === 'habito') {
    var opcoes = (c.tipo === 'cor') ? CORES : HABITOS;
    env.innerHTML = '<label class="campo">' + esc(rotuloCampo(c)) + '</label>';
    var caixa = document.createElement('div');
    caixa.className = 'escolhas ' + (c.tipo === 'cor' ? 'cores' : 'duas');

    opcoes.forEach(function (o) {
      var b = document.createElement('button');
      var rot = esc(rotuloOpcao(c.tipo, o.chave));
      b.type = 'button';
      b.className = 'escolha' + (actual === o.chave ? ' activo' : '');
      b.innerHTML = (c.tipo === 'cor')
        ? '<span class="amostra ' + o.chave + '"></span><span>' + rot + '</span>'
        : '<span class="icoHabito ' + o.chave + '"><i></i></span><span>' + rot + '</span>';
      b.onclick = function () {
        var jaEstava = S.valores[c.chave] === o.chave;
        S.valores[c.chave] = jaEstava ? undefined : o.chave;   // tocar outra vez desmarca
        var irmaos = caixa.querySelectorAll('.escolha');
        for (var k = 0; k < irmaos.length; k++) irmaos[k].classList.remove('activo');
        if (!jaEstava) { b.classList.add('activo'); avancarPara(idx); }
      };
      caixa.appendChild(b);
    });
    env.appendChild(caixa);
    S.ordemCampos.push({
      chave: c.chave,
      focar: function () {
        env.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var p = caixa.querySelector('.escolha');
        if (p) p.focus({ preventScroll: true });
      }
    });
    return env;
  }

  var id = 'campo_' + c.chave;
  env.innerHTML =
    '<label class="campo" for="' + id + '">' + esc(rotuloCampo(c)) +
    ' <span class="unidade">(' + esc(t(c.unidade)) + ')</span></label>' +
    '<div class="linhaCampo">' +
    '<input type="text" id="' + id + '" inputmode="' +
    (c.tipo === 'int' ? 'numeric' : 'decimal') + '" autocomplete="off" enterkeyhint="next">' +
    '<button type="button" class="seguinte" aria-label="' + esc(t('form.campoSeguinte')) + '">▼</button>' +
    '</div>';

  var inp = env.querySelector('input');
  var btn = env.querySelector('.seguinte');
  if (actual !== undefined) inp.value = mostrarNumero(actual);
  inp.addEventListener('input', function () {
    var n = paraNumero(inp.value);
    var mau = (n !== null) && (isNaN(n) || n < 0 || (c.tipo === 'int' && Math.round(n) !== n));
    inp.classList.toggle('invalido', mau);
    S.valores[c.chave] = (n === null || isNaN(n)) ? undefined : n;
  });
  /* O teclado numérico do iOS não tem tecla de confirmação, por isso o botão ▼
   * ao lado do campo tem de existir — o Enter sozinho não chegava no telemóvel. */
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); avancarPara(idx); }
  });
  btn.onclick = function () { avancarPara(idx); };

  S.ordemCampos.push({
    chave: c.chave,
    entrada: inp,
    botao: btn,
    focar: function () {
      inp.focus({ preventScroll: true });
      inp.select();
      env.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
  return env;
}

/** Devolve os campos (não as etiquetas) por preencher e os com valor errado. */
function validarFormulario() {
  var maus = [], vazios = [], preenchidos = [];
  camposDe(S.modo).forEach(function (c) {
    var v = S.valores[c.chave];
    if (v === undefined || v === '') { vazios.push(c); return; }
    preenchidos.push(c);
    if ((c.tipo === 'num' || c.tipo === 'int') && (isNaN(v) || v < 0)) maus.push(c);
    else if (c.tipo === 'int' && Math.round(v) !== v) maus.push(c);
  });
  return { maus: maus, vazios: vazios, preenchidos: preenchidos };
}

function valorLegivel(c) {
  var v = S.valores[c.chave];
  if (v === undefined || v === '') return '';
  return (c.tipo === 'cor' || c.tipo === 'habito') ? rotuloOpcao(c.tipo, v) : mostrarNumero(v);
}

/** Objectos deste levantamento sem um único campo preenchido. */
function objectosVazios() {
  var vazios = {};
  validarFormulario().vazios.forEach(function (c) { vazios[c.chave] = true; });
  return (OBJECTOS[S.modo] || []).filter(function (o) {
    return o.campos.every(function (k) { return vazios[k]; });
  });
}

/**
 * Confirmação antes de gravar. Aparece sempre — é o único sítio onde se vê,
 * de uma vez, para que planta se está a registar e o que vai ser gravado.
 * A parte de cima pergunta pelo que a planta não tem ("não há fruto?"), que
 * é a pergunta que quem está no campo consegue responder de cabeça; a lista
 * de campos por preencher fica fechada por baixo.
 */
function abrirConfirmacao() {
  var v = validarFormulario();

  $('alvoConfirmar').innerHTML =
    '<span class="linhagem">' + esc(rotuloRef(S.planta.source)) + ' ' +
    esc(t('planta.noLote', { no: S.planta.noFolha })) + '</span>' +
    '<span class="idPlanta">' + esc(S.planta.pid) + '</span>' +
    '<span class="posFileira">' + tituloLev(S.modo) + ' · ' +
    t('planta.detalhe', { row: S.planta.row, no: S.planta.noFileira }) + '</span>';

  var sem = $('semObjectos');
  sem.innerHTML = '';
  objectosVazios().forEach(function (o) {
    var d = document.createElement('div');
    d.className = 'semObjecto';
    d.textContent = t('dlg.semObjecto', { objecto: t('objecto.' + o.chave) });
    sem.appendChild(d);
  });

  var resumo = $('resumoValores');
  resumo.innerHTML = '';
  var ul = document.createElement('ul');
  ul.className = 'valoresConfirmar';
  v.preenchidos.forEach(function (c) {
    var li = document.createElement('li');
    li.innerHTML = '<span>' + esc(rotuloCampoLongo(c)) + '</span>' +
      '<b>' + esc(valorLegivel(c)) + '</b>';
    ul.appendChild(li);
  });
  if (S.notas) {
    var liN = document.createElement('li');
    liN.innerHTML = '<span>' + esc(t('campo.notas')) + '</span><b>' + esc(S.notas) + '</b>';
    ul.appendChild(liN);
  }
  if (!ul.children.length) {
    resumo.innerHTML = '<div class="semObjecto">' + esc(t('dlg.nadaPreenchido')) + '</div>';
  } else {
    resumo.appendChild(ul);
  }

  var det = $('detalheVazios');
  var lista = $('listaVazios');
  lista.innerHTML = '';
  v.vazios.forEach(function (c) {
    var li = document.createElement('li');
    li.textContent = rotuloCampoLongo(c);
    lista.appendChild(li);
  });
  det.hidden = !v.vazios.length;
  det.open = false;

  $('dlgIncompleto').showModal();
}

function gravarRegisto() {
  var agora = agoraLocal();
  var vals = {};
  camposDe(S.modo).forEach(function (c) {
    if (S.valores[c.chave] !== undefined) vals[c.chave] = S.valores[c.chave];
  });

  var eu = Def.get('nome', '');
  var doHistorico = ecraAnterior() === 'ecraHistorico';

  var reg = {
    uuid: uuid(),
    criadoEm: agora.ms,
    tsLocal: agora.texto,
    tsIso: agora.iso,
    estado: 'pendente',
    recorder: eu,
    device: Def.get('aparelho', ''),
    mode: S.modo,
    ronda: S.modo === 'crescimento' ? Def.get('ronda', '') : '',
    substitui: S.edicao ? S.edicao.uuid : '',
    seq: S.planta.seq,
    pid: S.planta.pid,
    row: S.planta.row,
    noFileira: S.planta.noFileira,
    noFolha: S.planta.noFolha,
    source: S.planta.source,
    notas: (S.notas || '').trim(),
    values: vals
  };

  return DB.guardar(reg).then(function () {
    brinde(t(S.edicao ? 'form.correccaoGuardada' : 'form.guardado', { pid: reg.pid }));
    S.feitas[reg.seq] = eu;
    S.edicao = null;
    S.notas = '';
    actualizarEstado();
    agendarEnvio();

    // quem veio do histórico corrigir um registo quer voltar ao histórico
    if (doHistorico) { voltar('ecraPlanta'); return; }

    /* Quem está a medir vai a andar pela fileira: entra-se logo no formulário
     * da planta seguinte, sem passar pelo ecrã de escolha. Poupa um toque em
     * cada planta — 415 vezes. O cabeçalho do formulário diz qual é e serve
     * de botão para a trocar, se for preciso saltar alguma. */
    var seguinte = seguinteNaFileira();
    if (seguinte) {
      abrirFormulario(seguinte);
    } else {
      // fim da fileira: volta-se ao ecrã da escolha para se apanhar a próxima
      S.digitos = '';
      desenharFileiras();
      resolverPlanta();
      brinde(t('planta.fimFileira', { row: reg.row }));
      voltar('ecraPlanta');
    }
  });
}

/**
 * Abre o formulário limpo para uma planta. Se essa planta já tiver registo,
 * o aviso de correcção aparece — mas não se vai buscar nada ao servidor: quem
 * está a andar pela fileira não pode ficar à espera da rede a cada planta.
 */
function abrirFormulario(p) {
  S.planta = p;
  S.fileira = p.row;
  S.digitos = String(p.noFileira);
  S.valores = {};
  S.notas = '';
  S.edicao = null;
  var quem = S.feitas[p.seq];
  if (quem) S.edicao = { uuid: '', recorder: quem };
  desenharFileiras();
  desenharFormulario();
  mostrar('ecraFormulario');
}

// ---------------------------------------------------------------- registos

function desenharHistorico() {
  var ul = $('listaHistorico');
  var eu = Def.get('nome', '');
  pintarAvisoEnvio();

  if (S.abaHistorico === 'aparelho') {
    DB.todos().then(function (l) {
      l.sort(function (a, b) { return b.criadoEm - a.criadoEm; });
      var pend = l.filter(function (e) { return e.estado === 'pendente'; }).length;
      $('subHistorico').textContent = t('hist.resumoAparelho', { n: l.length, p: pend });

      ul.innerHTML = '';
      if (!l.length) {
        ul.innerHTML = '<li class="vazio">' + esc(t('hist.vazio')) + '</li>';
        return;
      }
      l.slice(0, 120).forEach(function (e) {
        ul.appendChild(itemHistorico({
          marca: e.estado === 'enviado' ? '✅' : (e.estado === 'erro' ? '⚠️' : '⏳'),
          pid: tituloRegisto(e),
          linha2: tituloLev(e.mode) + rotuloAccao(e.accao) +
                  (e.substitui ? t('hist.correccao') : '') +
                  (e.estado === 'erro' ? ' — ' + e.erro : ''),
          quando: e.tsLocal.slice(0, 16),
          podeAbrir: !e.accao,        // marcas de morta/eliminação não se abrem
          abrir: function () { abrirLocal(e); }
        }));
      });
    });
    return;
  }

  // aba "Todos" — precisa do servidor
  ul.innerHTML = '<li class="vazio">' + esc(t('hist.aCarregar')) + '</li>';
  var mostrarLista = function (registos, hora) {
    S.registosServidor = registos;
    $('subHistorico').textContent = hora
      ? t('hist.resumoFolhaHora', { n: registos.length, hora: hora })
      : t('hist.resumoFolha', { n: registos.length });
    ul.innerHTML = '';
    if (!registos.length) {
      ul.innerHTML = '<li class="vazio">' + esc(t('hist.vazioFolha')) + '</li>';
      return;
    }
    registos.forEach(function (r) {
      ul.appendChild(itemHistorico({
        marca: '✏️',
        pid: tituloRegisto(r),
        linha2: (LEVANTAMENTOS[r.mode] ? tituloLev(r.mode) : r.mode) + ' · ' + r.recorder +
                (r.ultimo && r.ultimo !== r.recorder ? t('hist.corrigidoPor', { quem: r.ultimo }) : ''),
        quando: String(r.ts).slice(0, 16),
        podeAbrir: true,
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
      mostrarLista(g.registos, g.hora + t('hist.semRede'));
    } else {
      ul.innerHTML = '<li class="vazio">' + esc(t('hist.semCopia')) + '</li>';
      $('subHistorico').textContent = '';
    }
  });
}

/**
 * Como um registo se apresenta na lista: pelo n.º de referência, que é o que
 * está na etiqueta da planta. O Plant ID vai a seguir, mais pequeno.
 */
function tituloRegisto(r) {
  // os registos deste aparelho trazem o seq; os do servidor só o Plant ID
  var seq = r.seq || numeroDoPid(r.pid);
  var p = seq ? S.porSeq[seq] : null;
  var source = r.source || (p && p.source);
  var noLote = r.noFolha || r.noLote || (p && p.noFolha);
  if (!source) return String(r.pid || '');
  return rotuloRef(source) + ' · ' + t('planta.noLote', { no: noLote }) + '  ' + r.pid;
}

function numeroDoPid(pid) {
  var m = /-(\d{3})$/.exec(String(pid || ''));
  return m ? parseInt(m[1], 10) : 0;
}

function rotuloAccao(accao) {
  if (accao === 'eliminar') return ' · ' + t('hist.eliminacao');
  if (accao === 'morta') return ' · ' + t('hist.morta');
  if (accao === 'viva') return ' · ' + t('hist.viva');
  return '';
}

function itemHistorico(o) {
  var li = document.createElement('li');
  if (o.podeAbrir) li.className = 'tocavel';
  li.innerHTML = '<span class="marca">' + o.marca + '</span>' +
    '<span>' + esc(o.pid) + '<br><small style="color:#a8b09a">' + esc(o.linha2) + '</small></span>' +
    '<span class="quando">' + esc(o.quando) + '</span>';
  if (o.podeAbrir) li.onclick = o.abrir;
  return li;
}

function prepararEdicao(modo, ronda, planta, valores, dono, uuidOriginal, notas) {
  S.modo = modo;
  if (modo === 'crescimento' && ronda) Def.set('ronda', ronda);
  S.planta = planta;
  S.fileira = planta.row;
  S.digitos = String(planta.noFileira);
  S.valores = {};
  camposDe(modo).forEach(function (c) {
    if (valores[c.chave] !== undefined) S.valores[c.chave] = valores[c.chave];
  });
  S.notas = notas || '';
  S.edicao = { uuid: uuidOriginal, recorder: dono || Def.get('nome', '') };
  desenharFormulario();
  mostrar('ecraFormulario');
}

function abrirLocal(e) {
  var p = S.porSeq[e.seq];
  if (!p) { brinde(t('planta.desconhecida'), true); return; }
  prepararEdicao(e.mode, e.ronda, p, e.values || {}, e.recorder, e.uuid, e.notas);
}

function abrirDoServidor(r) {
  var p = S.porSeq[numeroDoPid(r.pid)];
  if (!p) { brinde(t('planta.desconhecida'), true); return; }

  brinde(t('hist.aCarregarRegisto'));
  pedirGet({ action: 'registo', uuid: r.uuid }).then(function (j) {
    prepararEdicao(j.registo.mode, j.registo.ronda, p, j.registo.values,
                   j.registo.recorder, r.uuid, j.registo.notas);
  }).catch(function () {
    brinde(t('hist.naoCarregou'), true);
  });
}

// -------------------------------------------------------------------- ecrãs

function irParaEntrada() {
  $('inpNome').value = Def.get('nome', '');
  pintarAdmin();
  reiniciarPilha();
  mostrar('ecraEntrada');
}

function irParaLevantamento() {
  $('ola').textContent = t('lev.ola', { nome: Def.get('nome', '') });
  pintarCartoes();
  reiniciarPilha();
  mostrar('ecraLevantamento');
}

function abrirEcraPlanta() {
  $('subPlanta').textContent = t('planta.sub', {
    titulo: tituloLev(S.modo), colunas: LEVANTAMENTOS[S.modo].colunas
  });
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
    b.textContent = nomeRonda(r);
    /* O nome da ronda é o cabeçalho da coluna na folha e tem de ir tal e qual.
     * No ecrã mostra-se a versão traduzida e guarda-se o original ao lado. */
    b.onclick = function () {
      $('inpRonda').value = nomeRonda(r);
      $('inpRonda').dataset.bruto = r;
    };
    alvo.appendChild(b);
  });
}

function arrancar() {
  if (!Def.get('aparelho', '')) Def.set('aparelho', uuid().slice(0, 8));
  definirIdioma(Def.get('idioma', 'pt'));
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
      av.textContent = t('activacao.curto');
      return;
    }
    Def.set('token', v);
    espelharConfig();          // para o service worker poder enviar sozinho
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
    av.textContent = t('entrada.aVerificar');

    pedirGet({ action: 'admin', pw: pw }).then(function (j) {
      if (!j.admin) throw new Error('errada');
      Admin.entrar(pw);
      $('inpAdmin').value = '';
      av.hidden = true;
      brinde(t('entrada.adminLigado'));
    }).catch(function (e) {
      av.className = 'aviso erro';
      av.textContent = (e && e.message === 'sem rede')
        ? t('entrada.precisaRede')
        : t('entrada.senhaErrada');
    });
  };

  $('ligSairAdmin').onclick = function () {
    Admin.sair();
    brinde(t('entrada.saiuAdmin'));
  };

  $('ligDesactivar').onclick = function () {
    if (confirm(t('entrada.confirmarDesactivar'))) {
      Def.del('token');
      mostrar('ecraActivacao');
    }
  };

  $('ligTrocarNome').onclick = irParaEntrada;   // o modo administrador mantém-se

  $('ligHistorico').onclick = function () {
    mostrar('ecraHistorico');
    desenharHistorico();
  };

  $('ligProgresso').onclick = function () {
    if (!S.modo) S.modo = 'descritores';
    mostrar('ecraProgresso');
    desenharEcraProgresso();
    carregarProgresso(true);
  };

  $('btnActualizarProgresso').onclick = function () {
    brinde(t('prog.aActualizar'));
    carregarProgresso(true);
  };

  $('btnForcarEnvio').onclick = function () {
    forcarEnvio().then(desenharHistorico);
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
          $('inpRonda').value = nomeRonda(Def.get('ronda', ''));
          $('inpRonda').dataset.bruto = Def.get('ronda', '');
          desenharRondasConhecidas();
          mostrar('ecraRonda');
        } else {
          abrirEcraPlanta();
        }
      };
    })(cartoes[i]);
  }

  $('btnRonda').onclick = function () {
    var campo = $('inpRonda');
    var v = campo.value.trim();
    if (!v) { campo.classList.add('invalido'); return; }
    campo.classList.remove('invalido');
    // se o texto ainda é a tradução da ronda escolhida, grava-se o nome original
    var bruto = campo.dataset.bruto || '';
    Def.set('ronda', (bruto && v === nomeRonda(bruto)) ? bruto : v);
    abrirEcraPlanta();
  };

  var teclas = $('teclado').querySelectorAll('button');
  for (var k = 0; k < teclas.length; k++) {
    (function (b) {
      b.onclick = function () {
        var tec = b.getAttribute('data-tecla');
        if (tec === 'limpar') S.digitos = '';
        else if (tec === 'apagar') S.digitos = S.digitos.slice(0, -1);
        else if (S.digitos.length < 2) S.digitos = (S.digitos === '0' ? '' : S.digitos) + tec;
        resolverPlanta();
      };
    })(teclas[k]);
  }

  $('ligProximaPorFazer').onclick = function () { irParaPlanta(proximaPorFazer()); };

  $('ligMorta').onclick = function () {
    if (!S.planta) return;
    marcarMorta(!S.mortas[S.planta.seq]);
  };

  $('btnPlanta').onclick = function () {
    var quem = S.feitas[S.planta.seq];
    S.valores = {};
    S.notas = '';
    S.edicao = null;

    if (quem) {
      // já existe registo: abrir em modo correcção, com os valores actuais
      DB.todos().then(function (l) {
        var ronda = Def.get('ronda', '');
        var meus = l.filter(function (e) {
          return e.seq === S.planta.seq && e.mode === S.modo && e.estado !== 'erro' &&
                 !e.accao &&
                 (S.modo !== 'crescimento' || e.ronda === ronda);
        }).sort(function (a, b) { return b.criadoEm - a.criadoEm; });

        if (meus.length) {
          prepararEdicao(S.modo, meus[0].ronda, S.planta, meus[0].values || {},
                         meus[0].recorder, meus[0].uuid, meus[0].notas);
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

  $('ligTrocarPlanta').onclick = function () { S.edicao = null; S.notas = ''; voltar('ecraPlanta'); };

  // o cabeçalho do formulário é o botão para acertar a planta
  $('cabecalhoPlanta').onclick = function () {
    desenharFileiras();
    resolverPlanta();
    mostrar('ecraPlanta');
  };

  $('btnEnviar').onclick = function () {
    var v = validarFormulario();
    if (v.maus.length) {
      brinde(t('form.corrija', {
        lista: v.maus.map(rotuloCampoLongo).join(', ')
      }), true);
      return;
    }
    // uma observação sozinha já chega para valer a pena gravar
    if (v.vazios.length === camposDe(S.modo).length && !(S.notas || '').trim()) {
      brinde(t('form.peloMenosUm'), true);
      return;
    }
    // a confirmação aparece sempre, esteja tudo preenchido ou não
    abrirConfirmacao();
  };

  $('btnVoltarPreencher').onclick = function () { $('dlgIncompleto').close(); };
  $('btnEnviarAssim').onclick = function () { $('dlgIncompleto').close(); gravarRegisto(); };
  // fechar pelo botão do telemóvel é o mesmo que "corrigir": não grava nada
  $('dlgIncompleto').addEventListener('cancel', function () { $('dlgIncompleto').close(); });

  $('btnEliminar').onclick = perguntarEliminar;
  $('btnNaoEliminar').onclick = function () { $('dlgEliminar').close(); };
  $('btnConfirmarEliminar').onclick = function () {
    $('dlgEliminar').close();
    eliminarRegisto();
  };

  /* Todos os "Voltar" vão ao ecrã anterior. O valor de data-voltar é só o
   * destino de recurso, para quando não há por onde recuar (por exemplo depois
   * de recarregar a página). */
  var voltares = document.querySelectorAll('[data-voltar]');
  for (var j = 0; j < voltares.length; j++) {
    (function (b) {
      b.onclick = function () { voltar(b.getAttribute('data-voltar')); pintarCartoes(); };
    })(voltares[j]);
  }

  window.addEventListener('online', function () { actualizarEstado(); agendarEnvio(); });
  window.addEventListener('offline', actualizarEstado);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { actualizarEstado(); agendarEnvio(); }
  });
  /* De minuto a minuto, enquanto houver fila. O pedido de sincronização é
   * repetido de propósito: o Android consome o registo assim que corre o evento
   * uma vez, e se essa corrida não esvaziou a fila (por exemplo por ainda não
   * haver código de activação) ficava sem ninguém a tentar outra vez. */
  setInterval(function () {
    DB.pendentes().then(function (p) {
      if (!p.length) return;
      pedirSincronizacao();
      return enviarFila();
    }).catch(function () {});
  }, INTERVALO_TENTATIVA);

  /* O service worker também envia. Quando o faz, avisa: sem isto a lista e o
   * contador ficavam a dizer "por enviar" com a fila já vazia. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (!e.data || e.data.tipo !== 'fila') return;
      S.envio = e.data.fim ? { feitos: 0, total: 0 }
                           : { feitos: e.data.enviados, total: e.data.total };
      S.aEnviar = !e.data.fim;
      actualizarEstado();
      if (e.data.fim) {
        /* O envio em segundo plano acontece com a aplicação fechada. Se
         * falhou, a razão só se pode ver aqui, quando se volta a abrir. */
        marcarTentativa(e.data.erro ? new Error(e.data.erro) : null);
        if (e.data.enviados) brinde(t('rede.enviados', { n: e.data.enviados }));
        if (S.ecra === 'ecraHistorico') desenharHistorico();
        carregarProgresso();
      }
    });
  }
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
  espelharConfig();     // o service worker precisa do URL e do código para enviar sozinho
  agendarEnvio();
}).catch(function () {
  /* Ainda não se sabe o idioma escolhido (o arranque falhou antes disso), por
   * isso vai-se buscá-lo directamente ao armazenamento. */
  S.idioma = Def.get('idioma', 'pt');
  document.querySelector('main').innerHTML =
    '<div class="aviso erro">' + esc(t('erro.plantas')) + '</div>';
});
