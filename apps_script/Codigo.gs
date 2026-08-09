/**
 * India Rec — endpoint de leitura/escrita para a folha de calculo NBF(Tanheia) 26.
 *
 * Implanta como: Implementar > Nova implementacao > Aplicacao web
 *   - Executar como      : Eu (dono da folha)
 *   - Quem tem acesso    : Qualquer pessoa
 *
 * Propriedades do script (Definicoes do projeto > Propriedades do script):
 *   TOKEN           — codigo de activacao que cada telemovel escreve uma vez
 *                     (sem esta propriedade vale 'jatropha')
 *   ADMIN_PASSWORD  — palavra-passe do modo administrador
 *
 * O cliente envia POST com Content-Type: text/plain para evitar o preflight CORS
 * (o Apps Script nao responde a OPTIONS). O corpo e JSON.
 */

// ---------------------------------------------------------------- configuracao

var SPREADSHEET_ID = '1WSfQdkMdy_cton-Za6TGzRmpSi1cjycWqHfMCS_cDXQ';
var FOLHA_DADOS = 'Data';
var FOLHA_LOG = 'Log';
var FUSO = 'Africa/Maputo';

var LINHA_PRIMEIRA_PLANTA = 3;   // Data!A3 = NBF(Tanheia)26-001
var TOTAL_PLANTAS = 398;

function prop_(nome, porOmissao) {
  var v = PropertiesService.getScriptProperties().getProperty(nome);
  return (v === null || v === '') ? porOmissao : v;
}
function getToken() { return prop_('TOKEN', 'jatropha'); }
function getAdminPassword() { return prop_('ADMIN_PASSWORD', 'IndiaRec2026'); }

/**
 * Como os valores de escolha ficam gravados na folha. A folha e um conjunto de
 * dados em ingles, por isso gravamos em ingles e mostramos portugues no ecra.
 */
var VALOR_HABITO = { horizontal: 'Horizontal', vertical: 'Vertical' };
var VALOR_COR = {
  verdeClaro: 'Light green',
  verdeMedio: 'Medium green',
  verdeEscuro: 'Dark green',
  vermelho: 'Red'
};

var CAMPOS_CRESCIMENTO = [
  { chave: 'alturaPlanta',  col: 6,  rotulo: 'Altura da planta (m)',            tipo: 'num' },
  { chave: 'cnp1',          col: 7,  rotulo: 'Cnp-1 (m)',                       tipo: 'num' },
  { chave: 'cnp2',          col: 8,  rotulo: 'Cnp-2 (m)',                       tipo: 'num' },
  { chave: 'cachosFrutos',  col: 9,  rotulo: 'Cachos de frutos (n.º)',          tipo: 'int' },
  { chave: 'cachosFlores',  col: 10, rotulo: 'Cachos de flores (n.º)',          tipo: 'int' },
  { chave: 'cachosBotoes',  col: 11, rotulo: 'Cachos de botões florais (n.º)',  tipo: 'int' }
];

var CAMPOS_DESCRITORES = [
  { chave: 'habitoCrescimento',  col: 12, rotulo: 'Hábito de crescimento',              tipo: 'habito' },
  { chave: 'limboFoliar',        col: 13, rotulo: 'Limbo foliar (cm)',                  tipo: 'num' },
  { chave: 'peciolo',            col: 14, rotulo: 'Pecíolo (cm)',                       tipo: 'num' },
  { chave: 'folhaComprimento',   col: 15, rotulo: 'Folha - comprimento (cm)',           tipo: 'num' },
  { chave: 'folhaLargura',       col: 16, rotulo: 'Folha - largura (cm)',               tipo: 'num' },
  { chave: 'lobulosFolha',       col: 17, rotulo: 'Lóbulos da folha (n.º)',             tipo: 'int' },
  { chave: 'corInflorMasc',      col: 18, rotulo: 'Cor da inflorescência - masculina',  tipo: 'cor' },
  { chave: 'corInflorFem',       col: 19, rotulo: 'Cor da inflorescência - feminina',   tipo: 'cor' },
  { chave: 'corFruto',           col: 20, rotulo: 'Cor do fruto',                       tipo: 'cor' },
  { chave: 'frutoComprimento',   col: 21, rotulo: 'Comprimento do fruto (cm)',          tipo: 'num' },
  { chave: 'frutoLargura',       col: 22, rotulo: 'Largura do fruto (cm)',              tipo: 'num' },
  { chave: 'sementeComprimento', col: 23, rotulo: 'Comprimento da semente (cm)',        tipo: 'num' },
  { chave: 'sementeLargura',     col: 24, rotulo: 'Largura da semente (cm)',            tipo: 'num' }
];

var TODOS_CAMPOS = CAMPOS_CRESCIMENTO.concat(CAMPOS_DESCRITORES);

/** Cabecalho da folha Log (A..AI = 35 colunas). A ordem manda em montarLinhaLog_(). */
var CABECALHO_LOG = [
  'Data/hora (aparelho)', 'Data/hora (servidor)', 'Registado por', 'Acção',
  'Levantamento', 'Ronda', 'Plant ID', 'Fileira', 'N.º na fileira', 'N.º na folha',
  'Lote', 'Linha em Data'
].concat(
  TODOS_CAMPOS.map(function (c) { return c.rotulo; }),
  ['ID do envio', 'Substitui o envio', 'Aparelho', 'Estado']
);

// indices 1-based dentro da folha Log
var COL_RECORDER = 3;
var COL_ACCAO = 4;
var COL_LEVANTAMENTO = 5;
var COL_RONDA = 6;
var COL_PID = 7;
var COL_PRIMEIRO_CAMPO = 13;                       // M
var COL_UUID = 12 + TODOS_CAMPOS.length + 1;       // AF = 32
var COL_SUBSTITUI = COL_UUID + 1;                  // AG
var COL_ESTADO = COL_UUID + 3;                     // AI

var ROTULO_MODO = { crescimento: 'Crescimento (F-K)', descritores: 'Descritores (L-X)' };

// ---------------------------------------------------------------- utilitarios

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function letraColuna_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function agora_() { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm:ss'); }

function camposDoModo_(modo) {
  return modo === 'crescimento' ? CAMPOS_CRESCIMENTO : CAMPOS_DESCRITORES;
}

/** Chave que identifica um registo: mesmo levantamento + ronda + planta. */
function chave_(modo, ronda, pid) {
  return modo + '|' + (modo === 'crescimento' ? String(ronda || '') : '') + '|' + pid;
}

/** Converte o valor bruto do cliente no valor a gravar. null = nao escrever. */
function normalizar_(campo, bruto) {
  if (bruto === null || bruto === undefined) return null;
  var s = String(bruto).trim();
  if (s === '') return null;

  if (campo.tipo === 'num' || campo.tipo === 'int') {
    var n = Number(s.replace(',', '.'));
    if (!isFinite(n)) throw new Error('Valor não numérico em "' + campo.rotulo + '": ' + s);
    if (campo.tipo === 'int' && Math.round(n) !== n) {
      throw new Error('"' + campo.rotulo + '" tem de ser um número inteiro: ' + s);
    }
    if (n < 0) throw new Error('"' + campo.rotulo + '" não pode ser negativo: ' + s);
    return n;
  }
  if (campo.tipo === 'habito') {
    if (!VALOR_HABITO.hasOwnProperty(s)) throw new Error('Hábito inválido: ' + s);
    return VALOR_HABITO[s];
  }
  if (campo.tipo === 'cor') {
    if (!VALOR_COR.hasOwnProperty(s)) throw new Error('Cor inválida: ' + s);
    return VALOR_COR[s];
  }
  return s;
}

/** Caminho inverso: valor da folha -> chave usada no ecra. */
function desnormalizar_(campo, valor) {
  if (valor === '' || valor === null || valor === undefined) return undefined;
  if (campo.tipo === 'habito' || campo.tipo === 'cor') {
    var mapa = campo.tipo === 'habito' ? VALOR_HABITO : VALOR_COR;
    for (var k in mapa) if (mapa[k] === String(valor)) return k;
    return undefined;
  }
  var n = Number(valor);
  return isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------- blocos de ronda

function colunaBlocoRonda_(folha, ronda) {
  var ultima = folha.getLastColumn();
  var linha1 = folha.getRange(1, 1, 1, ultima).getValues()[0];

  for (var i = 0; i < linha1.length; i++) {
    if (String(linha1[i]).trim() !== '' && String(linha1[i]).trim() === ronda) return i + 1;
  }

  var inicio = ultima + 1;
  var precisa = inicio + 5;
  if (folha.getMaxColumns() < precisa) {
    folha.insertColumnsAfter(folha.getMaxColumns(), precisa - folha.getMaxColumns());
  }
  folha.getRange(1, inicio).setValue(ronda);
  folha.getRange(1, inicio, 1, 6).merge();
  folha.getRange(2, inicio, 1, 6).setValues([
    CAMPOS_CRESCIMENTO.map(function (c) { return c.rotulo; })
  ]);
  folha.getRange(1, inicio, 2, 6).setFontWeight('bold');
  return inicio;
}

// ---------------------------------------------------------------- folha Log

function garantirLog_(ss) {
  var log = ss.getSheetByName(FOLHA_LOG);
  if (!log) log = ss.insertSheet(FOLHA_LOG);
  if (log.getMaxColumns() < CABECALHO_LOG.length) {
    log.insertColumnsAfter(log.getMaxColumns(), CABECALHO_LOG.length - log.getMaxColumns());
  }
  var atual = log.getRange(1, 1, 1, CABECALHO_LOG.length).getValues()[0];
  var igual = atual.every(function (v, i) { return String(v) === CABECALHO_LOG[i]; });
  if (!igual) {
    log.getRange(1, 1, 1, CABECALHO_LOG.length).setValues([CABECALHO_LOG]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  return log;
}

/**
 * Le a folha Log uma so vez e devolve:
 *   uuids     — todos os IDs de envio ja gravados (deduplicacao)
 *   porChave  — ultimo registo valido de cada planta/levantamento/ronda
 */
function lerIndice_(log) {
  var n = log.getLastRow();
  var idx = { uuids: {}, porChave: {} };
  if (n < 2) return idx;

  var meta = log.getRange(2, COL_RECORDER, n - 1, COL_PID - COL_RECORDER + 1).getValues();
  var ids = log.getRange(2, COL_UUID, n - 1, 1).getValues();
  var estados = log.getRange(2, COL_ESTADO, n - 1, 1).getValues();

  for (var i = 0; i < meta.length; i++) {
    var uuid = String(ids[i][0]).trim();
    if (uuid) idx.uuids[uuid] = true;

    if (String(estados[i][0]).indexOf('OK') !== 0) continue;   // linhas de erro nao contam

    var recorder = String(meta[i][0]).trim();
    var levant = String(meta[i][2]).trim();
    var ronda = String(meta[i][3]).trim();
    var pid = String(meta[i][4]).trim();
    if (!pid) continue;

    var modo = (levant === ROTULO_MODO.crescimento) ? 'crescimento' : 'descritores';
    var k = chave_(modo, ronda, pid);
    var ja = idx.porChave[k];

    /* As linhas vem por ordem, por isso a primeira que aparece e a criacao.
     * O DONO e quem criou — nao muda quando um administrador corrige, senao a
     * pessoa que fez a medicao deixava de poder mexer no proprio registo. */
    idx.porChave[k] = {
      dono: ja ? ja.dono : recorder,
      recorder: recorder,              // quem fez a alteracao mais recente
      uuid: uuid, linha: i + 2, modo: modo, ronda: ronda, pid: pid
    };
  }
  return idx;
}

// ---------------------------------------------------------------- doPost

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut_({ ok: false, erro: 'Servidor ocupado, tente outra vez.' });
  }

  try {
    var pedido;
    try {
      pedido = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut_({ ok: false, erro: 'JSON inválido.' });
    }

    if (!getToken() || pedido.token !== getToken()) {
      return jsonOut_({ ok: false, erro: 'Não autorizado.' });
    }

    var admin = pedido.adminPassword && pedido.adminPassword === getAdminPassword();
    var entradas = pedido.entries || [];
    if (!entradas.length) return jsonOut_({ ok: true, resultados: [] });

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var dados = ss.getSheetByName(FOLHA_DADOS);
    var log = garantirLog_(ss);
    var idx = lerIndice_(log);

    var linhasLog = [];
    var resultados = [];

    for (var i = 0; i < entradas.length; i++) {
      var r = processarEntrada_(dados, entradas[i], idx, admin, linhasLog);
      resultados.push(r);
    }

    if (linhasLog.length) {
      log.getRange(log.getLastRow() + 1, 1, linhasLog.length, CABECALHO_LOG.length)
         .setValues(linhasLog);
    }
    SpreadsheetApp.flush();

    return jsonOut_({ ok: true, resultados: resultados });
  } catch (err) {
    return jsonOut_({ ok: false, erro: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function processarEntrada_(dados, ent, idx, admin, linhasLog) {
  var uuid = String(ent.uuid || '').trim();
  if (!uuid) return { ok: false, uuid: '', erro: 'Falta o ID do envio.' };
  if (idx.uuids[uuid]) return { ok: true, uuid: uuid, duplicado: true };

  try {
    var seq = Number(ent.seq);
    if (!(seq >= 1 && seq <= TOTAL_PLANTAS)) throw new Error('Planta fora do intervalo: ' + ent.seq);

    var linha = LINHA_PRIMEIRA_PLANTA + seq - 1;
    var pidFolha = String(dados.getRange(linha, 1).getValue()).trim();
    if (ent.pid && pidFolha && pidFolha !== String(ent.pid).trim()) {
      throw new Error('Plant ID não corresponde (folha: ' + pidFolha + ', envio: ' + ent.pid + ').');
    }

    var modo = String(ent.mode || '');
    if (modo !== 'crescimento' && modo !== 'descritores') {
      throw new Error('Levantamento desconhecido: ' + modo);
    }
    var campos = camposDoModo_(modo);
    var ronda = String(ent.ronda || '').trim();
    if (modo === 'crescimento' && !ronda) throw new Error('Falta a ronda do levantamento.');

    // quem e o dono do registo actual desta planta?
    var anterior = idx.porChave[chave_(modo, ronda, pidFolha)];
    var accao = anterior ? 'Correcção' : 'Registo';
    if (anterior && !admin) {
      var meu = String(ent.recorder || '').trim();
      if (anterior.dono && anterior.dono !== meu) {
        throw new Error('Esta planta foi registada por ' + anterior.dono +
                        '. Só essa pessoa (ou um administrador) a pode corrigir.');
      }
    }

    // As colunas de cada levantamento sao contiguas (F..K ou L..X), por isso
    // trata-se o bloco todo de uma vez: uma leitura e uma escrita por planta,
    // em vez de ate 19 chamadas soltas. Com lotes de 25 envios a diferenca e
    // entre umas centenas de chamadas e umas dezenas.
    var colInicio = (modo === 'crescimento') ? colunaBlocoRonda_(dados, ronda) : campos[0].col;
    var bloco = dados.getRange(linha, colInicio, 1, campos.length);
    var actuais = bloco.getValues()[0];

    // normaliza tudo antes de escrever, para nao deixar escritas a meio
    var valores = ent.values || {};
    var escritas = [];
    for (var i = 0; i < campos.length; i++) {
      var v = normalizar_(campos[i], valores[campos[i].chave]);
      if (v !== null) {
        actuais[i] = v;                       // campo vazio nao apaga o que la esta
        escritas.push(colInicio + i);
      }
    }
    if (!escritas.length) throw new Error('Nenhum valor preenchido.');

    bloco.setValues([actuais]);

    linhasLog.push(montarLinhaLog_(ent, uuid, linha, accao, 'OK'));
    idx.uuids[uuid] = true;
    var quem = String(ent.recorder || '').trim();
    idx.porChave[chave_(modo, ronda, pidFolha)] = {
      dono: anterior ? anterior.dono : quem,
      recorder: quem, uuid: uuid, modo: modo, ronda: ronda, pid: pidFolha
    };

    return {
      ok: true, uuid: uuid, linha: linha, accao: accao,
      celulas: escritas.map(function (col) { return letraColuna_(col) + linha; })
    };
  } catch (err) {
    var msg = String(err && err.message || err);
    linhasLog.push(montarLinhaLog_(ent, uuid, '', 'Registo', 'ERRO: ' + msg));
    return { ok: false, uuid: uuid, erro: msg };
  }
}

function montarLinhaLog_(ent, uuid, linhaDados, accao, estado) {
  var v = ent.values || {};
  var linha = [
    ent.tsLocal || '',
    agora_(),
    ent.recorder || '',
    accao,
    ROTULO_MODO[ent.mode] || String(ent.mode || ''),
    ent.ronda || '',
    ent.pid || '',
    ent.row || '',
    ent.noFileira || '',
    ent.noFolha || '',
    ent.source || '',
    linhaDados
  ];

  for (var i = 0; i < TODOS_CAMPOS.length; i++) {
    var c = TODOS_CAMPOS[i];
    var bruto = v[c.chave];
    var saida = '';
    if (bruto !== null && bruto !== undefined && String(bruto).trim() !== '') {
      try { saida = normalizar_(c, bruto); } catch (err) { saida = String(bruto); }
    }
    linha.push(saida);
  }

  linha.push(uuid, ent.substitui || '', ent.device || '', estado);
  return linha;
}

// ---------------------------------------------------------------- doGet

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!getToken() || p.token !== getToken()) return jsonOut_({ ok: false, erro: 'Não autorizado.' });

  try {
    var accao = p.action || 'estado';
    if (accao === 'admin') {
      return jsonOut_({ ok: true, admin: String(p.pw || '') === getAdminPassword() });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var log = garantirLog_(ss);

    if (accao === 'estado') return jsonOut_(estado_(ss, log, p));
    if (accao === 'historico') return jsonOut_(historico_(log, p));
    if (accao === 'registo') return jsonOut_(registo_(log, p));
    return jsonOut_({ ok: false, erro: 'Acção desconhecida: ' + accao });
  } catch (err) {
    return jsonOut_({ ok: false, erro: String(err && err.message || err) });
  }
}

/** Progresso: que plantas ja estao feitas e por quem. */
function estado_(ss, log, p) {
  var modo = p.mode === 'crescimento' ? 'crescimento' : 'descritores';
  var ronda = String(p.ronda || '').trim();
  var idx = lerIndice_(log);

  var feitas = [];
  for (var k in idx.porChave) {
    var r = idx.porChave[k];
    if (r.modo !== modo) continue;
    if (modo === 'crescimento' && r.ronda !== ronda) continue;
    var m = /-(\d{3})$/.exec(r.pid);
    if (m) feitas.push([parseInt(m[1], 10), r.dono]);   // o dono e quem pode corrigir
  }
  feitas.sort(function (a, b) { return a[0] - b[0]; });

  var dados = ss.getSheetByName(FOLHA_DADOS);
  var linha1 = dados.getRange(1, 1, 1, dados.getLastColumn()).getValues()[0];
  var rondas = [];
  for (var i = 5; i < linha1.length; i++) {
    var s = String(linha1[i]).trim();
    if (s) rondas.push(s);
  }

  return { ok: true, hora: agora_(), mode: modo, ronda: ronda, feitas: feitas, rondas: rondas };
}

/** Lista compacta dos registos (o mais recente de cada planta), sem os valores. */
function historico_(log, p) {
  var limite = Math.min(parseInt(p.limite, 10) || 200, 400);
  var idx = lerIndice_(log);
  var n = log.getLastRow();
  if (n < 2) return { ok: true, hora: agora_(), registos: [] };

  var entradas = [];
  for (var k in idx.porChave) entradas.push(idx.porChave[k]);
  entradas.sort(function (a, b) { return b.linha - a.linha; });
  entradas = entradas.slice(0, limite);

  var registos = entradas.map(function (e) {
    var meta = log.getRange(e.linha, 1, 1, COL_PID).getValues()[0];
    return {
      uuid: e.uuid,
      ts: String(meta[0]),
      recorder: e.dono,                          // quem manda nas permissoes
      ultimo: e.recorder,                        // quem mexeu por ultimo
      accao: String(meta[COL_ACCAO - 1]),
      mode: e.modo,
      ronda: e.ronda,
      pid: e.pid
    };
  });

  return { ok: true, hora: agora_(), registos: registos };
}

/** Valores completos de um registo, para poder abrir o formulario ja preenchido. */
function registo_(log, p) {
  var uuid = String(p.uuid || '').trim();
  if (!uuid) return { ok: false, erro: 'Falta o ID do envio.' };

  var n = log.getLastRow();
  if (n < 2) return { ok: false, erro: 'Registo não encontrado.' };

  var ids = log.getRange(2, COL_UUID, n - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).trim() !== uuid) continue;

    var l = i + 2;
    var meta = log.getRange(l, 1, 1, COL_PID).getValues()[0];
    var brutos = log.getRange(l, COL_PRIMEIRO_CAMPO, 1, TODOS_CAMPOS.length).getValues()[0];
    var levant = String(meta[COL_LEVANTAMENTO - 1]).trim();
    var modo = levant === ROTULO_MODO.crescimento ? 'crescimento' : 'descritores';

    var values = {};
    for (var j = 0; j < TODOS_CAMPOS.length; j++) {
      var v = desnormalizar_(TODOS_CAMPOS[j], brutos[j]);
      if (v !== undefined) values[TODOS_CAMPOS[j].chave] = v;
    }

    return {
      ok: true,
      registo: {
        uuid: uuid,
        ts: String(meta[0]),
        recorder: String(meta[COL_RECORDER - 1]),
        mode: modo,
        ronda: String(meta[COL_RONDA - 1]),
        pid: String(meta[COL_PID - 1]),
        values: values
      }
    };
  }
  return { ok: false, erro: 'Registo não encontrado.' };
}

// ------------------------------------------------------------- diagnostico

/**
 * Executar a partir do editor (escolher "diagnostico" e carregar em Executar) e
 * abrir o registo de execucao. Diz se ESTE projecto e o certo, sem ser preciso
 * implantar nada — serve para separar "a cola correu mal" de "implantei o
 * projecto errado".
 */
function diagnostico() {
  var l = [];
  l.push('doGet definido     : ' + (typeof doGet === 'function'));
  l.push('doPost definido    : ' + (typeof doPost === 'function'));
  l.push('colunas do Log     : ' + CABECALHO_LOG.length + ' (tem de ser 35)');
  l.push('tem a correccao do dono : ' + (String(processarEntrada_).indexOf('anterior.dono') >= 0));

  var props = PropertiesService.getScriptProperties().getProperties();
  l.push('TOKEN definido     : ' + (props.TOKEN ? 'sim' : 'NAO — fica "' + getToken() + '"'));
  l.push('ADMIN_PASSWORD     : ' + (props.ADMIN_PASSWORD ? 'sim' : 'NAO — fica o valor por omissao'));

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    l.push('Folha de calculo   : ' + ss.getName());
    var d = ss.getSheetByName(FOLHA_DADOS);
    l.push('Aba Data           : ' + (d ? d.getLastRow() + ' linhas' : 'NAO ENCONTRADA'));
    var lg = ss.getSheetByName(FOLHA_LOG);
    l.push('Aba Log            : ' + (lg ? lg.getLastRow() + ' linhas' : 'NAO ENCONTRADA'));
  } catch (err) {
    l.push('ERRO a abrir a folha: ' + (err && err.message));
  }

  try {
    var r = doGet({ parameter: { token: getToken(), action: 'estado', mode: 'descritores' } });
    l.push('doGet responde     : ' + String(r.getContent()).slice(0, 200));
  } catch (err2) {
    l.push('ERRO no doGet      : ' + (err2 && err2.message));
  }

  var texto = l.join('\n');
  Logger.log(texto);
  return texto;
}

// ------------------------------------------------- utilitario manual (uma vez)

/**
 * Executar UMA VEZ a partir do editor para reconstruir o cabecalho da folha Log.
 * Guarda primeiro o cabecalho antigo numa folha nova, sem apagar dados.
 */
function reconstruirCabecalhoLog() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var log = ss.getSheetByName(FOLHA_LOG);

  if (log && log.getLastRow() >= 1) {
    var nome = 'Log_backup_' + Utilities.formatDate(new Date(), FUSO, 'yyyyMMdd_HHmmss');
    var copia = ss.insertSheet(nome);
    var largura = Math.max(log.getLastColumn(), 1);
    var altura = Math.max(log.getLastRow(), 1);
    copia.getRange(1, 1, altura, largura)
         .setValues(log.getRange(1, 1, altura, largura).getValues());
    Logger.log('Cópia de segurança criada: ' + nome);
  }

  if (log) log.getRange(1, 1, 1, log.getMaxColumns()).clearContent();
  garantirLog_(ss);
  Logger.log('Cabeçalho da folha Log reconstruído (' + CABECALHO_LOG.length + ' colunas).');
}
