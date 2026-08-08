/**
 * JatMed — endpoint de escrita para a folha de calculo NBF(Tanheia) 26.
 *
 * Implanta como: Implementar > Nova implementacao > Aplicacao web
 *   - Executar como      : Eu (dono da folha)
 *   - Quem tem acesso    : Qualquer pessoa
 * O segredo partilhado (TOKEN) e o que impede escritas de estranhos.
 *
 * O cliente envia POST com Content-Type: text/plain para evitar o preflight CORS
 * (o Apps Script nao responde a OPTIONS). O corpo e JSON.
 */

// ---------------------------------------------------------------- configuracao

var SPREADSHEET_ID = '1WSfQdkMdy_cton-Za6TGzRmpSi1cjycWqHfMCS_cDXQ';
var FOLHA_DADOS = 'Data';
var FOLHA_LOG = 'Log';

/** Definido em Definicoes do projeto > Propriedades do script > TOKEN. */
function getToken() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN') || '';
}

var LINHA_PRIMEIRA_PLANTA = 3;   // Data!A3 = NBF(Tanheia)26-001
var TOTAL_PLANTAS = 398;

/**
 * Como os valores de escolha ficam gravados na folha.
 * A folha e um conjunto de dados em ingles (cabecalhos em ingles), por isso
 * gravamos em ingles e mostramos portugues no ecra. Para gravar em portugues,
 * troque os valores da direita.
 */
var VALOR_HABITO = {
  horizontal: 'Horizontal',
  vertical: 'Vertical'
};
var VALOR_COR = {
  verdeClaro: 'Light green',
  verdeMedio: 'Medium green',
  verdeEscuro: 'Dark green',
  vermelho: 'Red'
};

/** Campos do levantamento de crescimento -> coluna na folha Data. */
var CAMPOS_CRESCIMENTO = [
  { chave: 'alturaPlanta',  col: 6,  rotulo: 'Altura da planta (m)',            tipo: 'num' },
  { chave: 'cnp1',          col: 7,  rotulo: 'Cnp-1 (m)',                       tipo: 'num' },
  { chave: 'cnp2',          col: 8,  rotulo: 'Cnp-2 (m)',                       tipo: 'num' },
  { chave: 'cachosFrutos',  col: 9,  rotulo: 'Cachos de frutos (n.º)',          tipo: 'int' },
  { chave: 'cachosFlores',  col: 10, rotulo: 'Cachos de flores (n.º)',          tipo: 'int' },
  { chave: 'cachosBotoes',  col: 11, rotulo: 'Cachos de botões florais (n.º)',  tipo: 'int' }
];

/** Campos dos descritores morfologicos -> coluna na folha Data (L..X). */
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

/** Cabecalho da folha Log (A..AG). A ordem TEM de bater certo com montarLinhaLog_(). */
var CABECALHO_LOG = [
  'Data/hora (aparelho)', 'Data/hora (servidor)', 'Registado por', 'Levantamento', 'Ronda',
  'Plant ID', 'Fileira', 'N.º na fileira', 'N.º na folha', 'Lote', 'Linha em Data'
].concat(
  CAMPOS_CRESCIMENTO.map(function (c) { return c.rotulo; }),
  CAMPOS_DESCRITORES.map(function (c) { return c.rotulo; }),
  ['ID do envio', 'Aparelho', 'Estado']
);

var COL_LOG_UUID = CABECALHO_LOG.length - 2;   // 1-based: ver escreverLog_

// ---------------------------------------------------------------- utilitarios

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
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

/** Converte o valor bruto do cliente no valor a gravar. null = nao escrever. */
function normalizar_(campo, bruto) {
  if (bruto === null || bruto === undefined) return null;
  var s = String(bruto).trim();
  if (s === '') return null;

  if (campo.tipo === 'num' || campo.tipo === 'int') {
    var n = Number(s.replace(',', '.'));
    if (!isFinite(n)) throw new Error('Valor nao numerico em "' + campo.rotulo + '": ' + s);
    if (campo.tipo === 'int' && Math.round(n) !== n) {
      throw new Error('"' + campo.rotulo + '" tem de ser um numero inteiro: ' + s);
    }
    if (n < 0) throw new Error('"' + campo.rotulo + '" nao pode ser negativo: ' + s);
    return n;
  }
  if (campo.tipo === 'habito') {
    if (!VALOR_HABITO.hasOwnProperty(s)) throw new Error('Habito invalido: ' + s);
    return VALOR_HABITO[s];
  }
  if (campo.tipo === 'cor') {
    if (!VALOR_COR.hasOwnProperty(s)) throw new Error('Cor invalida: ' + s);
    return VALOR_COR[s];
  }
  return s;
}

// ---------------------------------------------------------- blocos de ronda

/**
 * Devolve a coluna inicial (1-based) do bloco de 6 colunas do levantamento de
 * crescimento para a ronda indicada. Procura o rotulo na linha 1; se nao existir,
 * acrescenta um bloco novo no fim da folha com o cabecalho de 2 linhas.
 */
function colunaBlocoRonda_(folha, ronda) {
  var ultima = folha.getLastColumn();
  var linha1 = folha.getRange(1, 1, 1, ultima).getValues()[0];

  for (var i = 0; i < linha1.length; i++) {
    if (String(linha1[i]).trim() !== '' && String(linha1[i]).trim() === ronda) {
      return i + 1;
    }
  }

  // Bloco novo: 6 colunas a seguir a ultima coluna usada.
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
    log.getRange(1, 1, 1, CABECALHO_LOG.length).setValues([CABECALHO_LOG]);
    log.getRange(1, 1, 1, CABECALHO_LOG.length).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  return log;
}

function uuidsJaGravados_(log) {
  var n = log.getLastRow();
  var set = {};
  if (n < 2) return set;
  var vals = log.getRange(2, COL_LOG_UUID, n - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0]).trim();
    if (v) set[v] = true;
  }
  return set;
}

// ---------------------------------------------------------------- doPost

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut_({ ok: false, erro: 'Servidor ocupado, tente novamente.' });
  }

  try {
    var pedido;
    try {
      pedido = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut_({ ok: false, erro: 'JSON invalido.' });
    }

    var token = getToken();
    if (!token || pedido.token !== token) {
      return jsonOut_({ ok: false, erro: 'Nao autorizado.' });
    }

    var entradas = pedido.entries || [];
    if (!entradas.length) return jsonOut_({ ok: true, resultados: [] });

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var dados = ss.getSheetByName(FOLHA_DADOS);
    var log = garantirLog_(ss);
    var jaGravados = uuidsJaGravados_(log);

    var linhasLog = [];
    var resultados = [];

    for (var i = 0; i < entradas.length; i++) {
      var r = processarEntrada_(dados, entradas[i], jaGravados, linhasLog);
      resultados.push(r);
      if (r.ok && r.uuid) jaGravados[r.uuid] = true;
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

function processarEntrada_(dados, ent, jaGravados, linhasLog) {
  var uuid = String(ent.uuid || '').trim();
  if (!uuid) return { ok: false, uuid: '', erro: 'Falta o ID do envio.' };
  if (jaGravados[uuid]) return { ok: true, uuid: uuid, duplicado: true };

  try {
    var seq = Number(ent.seq);
    if (!(seq >= 1 && seq <= TOTAL_PLANTAS)) throw new Error('Planta fora do intervalo: ' + ent.seq);

    var linha = LINHA_PRIMEIRA_PLANTA + seq - 1;
    var pidFolha = String(dados.getRange(linha, 1).getValue()).trim();
    if (ent.pid && pidFolha && pidFolha !== String(ent.pid).trim()) {
      throw new Error('Plant ID nao corresponde (folha: ' + pidFolha + ', envio: ' + ent.pid + ').');
    }

    var modo = String(ent.mode || '');
    var campos, colBase;
    if (modo === 'crescimento') {
      campos = CAMPOS_CRESCIMENTO;
      var ronda = String(ent.ronda || '').trim();
      if (!ronda) throw new Error('Falta a ronda do levantamento.');
      colBase = colunaBlocoRonda_(dados, ronda);
    } else if (modo === 'descritores') {
      campos = CAMPOS_DESCRITORES;
      colBase = null;   // colunas fixas L..X
    } else {
      throw new Error('Levantamento desconhecido: ' + modo);
    }

    // Normaliza tudo antes de escrever, para nao deixar escritas a meio.
    var valores = ent.values || {};
    var escritas = [];
    for (var i = 0; i < campos.length; i++) {
      var c = campos[i];
      var v = normalizar_(c, valores[c.chave]);
      if (v !== null) {
        var col = (colBase === null) ? c.col : (colBase + i);
        escritas.push({ col: col, valor: v, chave: c.chave });
      }
    }
    if (!escritas.length) throw new Error('Nenhum valor preenchido.');

    for (var j = 0; j < escritas.length; j++) {
      dados.getRange(linha, escritas[j].col).setValue(escritas[j].valor);
    }

    linhasLog.push(montarLinhaLog_(ent, uuid, linha, 'OK'));
    return {
      ok: true,
      uuid: uuid,
      linha: linha,
      celulas: escritas.map(function (x) { return letraColuna_(x.col) + linha; })
    };
  } catch (err) {
    var msg = String(err && err.message || err);
    linhasLog.push(montarLinhaLog_(ent, uuid, '', 'ERRO: ' + msg));
    return { ok: false, uuid: uuid, erro: msg };
  }
}

function montarLinhaLog_(ent, uuid, linhaDados, estado) {
  var v = ent.values || {};
  var linha = [
    ent.tsLocal || '',
    Utilities.formatDate(new Date(), 'Africa/Maputo', 'yyyy-MM-dd HH:mm:ss'),
    ent.recorder || '',
    ent.mode === 'crescimento' ? 'Crescimento (F-K)' : 'Descritores (L-X)',
    ent.ronda || '',
    ent.pid || '',
    ent.row || '',
    ent.noFileira || '',
    ent.noFolha || '',
    ent.source || '',
    linhaDados
  ];

  // Os 19 campos, sempre pela mesma ordem; em branco os que nao pertencem ao modo.
  var todos = CAMPOS_CRESCIMENTO.concat(CAMPOS_DESCRITORES);
  for (var i = 0; i < todos.length; i++) {
    var c = todos[i];
    var bruto = v[c.chave];
    var saida = '';
    if (bruto !== null && bruto !== undefined && String(bruto).trim() !== '') {
      try {
        saida = normalizar_(c, bruto);
      } catch (err) {
        saida = String(bruto);
      }
    }
    linha.push(saida);
  }

  linha.push(uuid, ent.device || '', estado);
  return linha;
}

// ---------------------------------------------------------------- doGet

/** Verificacao de saude / lista de rondas ja existentes na folha Data. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== getToken()) return jsonOut_({ ok: false, erro: 'Nao autorizado.' });

  var dados = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(FOLHA_DADOS);
  var linha1 = dados.getRange(1, 1, 1, dados.getLastColumn()).getValues()[0];
  var rondas = [];
  for (var i = 5; i < linha1.length; i++) {          // a partir da coluna F
    var s = String(linha1[i]).trim();
    if (s) rondas.push({ rotulo: s, col: letraColuna_(i + 1) });
  }
  return jsonOut_({
    ok: true,
    hora: Utilities.formatDate(new Date(), 'Africa/Maputo', 'yyyy-MM-dd HH:mm:ss'),
    rondas: rondas
  });
}

// ------------------------------------------------- utilitario manual (uma vez)

/**
 * Executar UMA VEZ a partir do editor para reconstruir o cabecalho da folha Log.
 * Guarda primeiro o cabecalho antigo numa folha nova, sem apagar nada.
 */
function reconstruirCabecalhoLog() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var log = ss.getSheetByName(FOLHA_LOG);

  if (log && log.getLastRow() >= 1) {
    var nome = 'Log_backup_' + Utilities.formatDate(new Date(), 'Africa/Maputo', 'yyyyMMdd_HHmmss');
    var copia = ss.insertSheet(nome);
    var largura = Math.max(log.getLastColumn(), 1);
    var altura = Math.max(log.getLastRow(), 1);
    copia.getRange(1, 1, altura, largura)
         .setValues(log.getRange(1, 1, altura, largura).getValues());
    Logger.log('Copia de seguranca criada: ' + nome);
  }

  // Limpa so a linha de cabecalho antiga (a folha Log nao tem dados).
  if (log) log.getRange(1, 1, 1, log.getMaxColumns()).clearContent();
  garantirLog_(ss);
  Logger.log('Cabecalho da folha Log reconstruido (' + CABECALHO_LOG.length + ' colunas).');
}
