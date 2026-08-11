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
var TOTAL_PLANTAS = 415;

/**
 * Versao deste ficheiro. Vai em TODAS as respostas, inclusive nas de token errado,
 * para se poder ver de fora qual e a versao que esta mesmo implantada — sem isto
 * nao se distingue "colei mal" de "implantei a versao antiga".
 * Subir sempre que o Codigo.gs for alterado.
 */
var VERSAO_CODIGO = '2026-08-12a';

/**
 * COMPATIBILIDADE (2026-08-12) — LER ANTES DE MEXER.
 *
 * Ha telemoveis no campo com a versao anterior da aplicacao e com registos
 * ainda por enviar na fila. Esses envios chegam aqui SEM os campos novos
 * (notas, accao 'morta'/'viva', refNo). Tudo o que e novo tem de ser
 * OPCIONAL: nenhum campo novo pode ser obrigatorio e nenhuma coluna antiga
 * pode mudar de sitio. As colunas novas entram sempre no FIM (na folha Log e
 * a direita de tudo na folha Data), para as linhas ja gravadas nao deslizarem.
 */

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

/* Colunas da folha Data.
 *   2026-08-09  entra a coluna D ("No. in row"):  F..X  ->  G..Y
 *   2026-08-10  entra "Branch" no bloco da ronda: G..L  ->  G..M  e  M..Y -> N..Z
 * REVERSAO: se o campo "Branch" for retirado da folha, apagar a linha de 'ramos',
 * baixar 1 em cada col abaixo dela, e por ROTULO_MODO de volta a (G-L)/(M-Y). */
var CAMPOS_CRESCIMENTO = [
  { chave: 'alturaPlanta',  col: 7,  rotulo: 'Altura da planta (m)',            tipo: 'num' },
  { chave: 'cnp1',          col: 8,  rotulo: 'Cnp-1 (m)',                       tipo: 'num' },
  { chave: 'cnp2',          col: 9,  rotulo: 'Cnp-2 (m)',                       tipo: 'num' },
  { chave: 'ramos',         col: 10, rotulo: 'Ramos (n.º)',                     tipo: 'int' },
  { chave: 'cachosFrutos',  col: 11, rotulo: 'Cachos de frutos (n.º)',          tipo: 'int' },
  { chave: 'cachosFlores',  col: 12, rotulo: 'Cachos de flores (n.º)',          tipo: 'int' },
  { chave: 'cachosBotoes',  col: 13, rotulo: 'Cachos de botões florais (n.º)',  tipo: 'int' }
];

var CAMPOS_DESCRITORES = [
  { chave: 'habitoCrescimento',  col: 14, rotulo: 'Hábito de crescimento',              tipo: 'habito' },
  { chave: 'limboFoliar',        col: 15, rotulo: 'Limbo foliar (cm)',                  tipo: 'num' },
  { chave: 'peciolo',            col: 16, rotulo: 'Pecíolo (cm)',                       tipo: 'num' },
  { chave: 'folhaComprimento',   col: 17, rotulo: 'Folha - comprimento (cm)',           tipo: 'num' },
  { chave: 'folhaLargura',       col: 18, rotulo: 'Folha - largura (cm)',               tipo: 'num' },
  { chave: 'lobulosFolha',       col: 19, rotulo: 'Lóbulos da folha (n.º)',             tipo: 'int' },
  { chave: 'corInflorMasc',      col: 20, rotulo: 'Cor da inflorescência - masculina',  tipo: 'cor' },
  { chave: 'corInflorFem',       col: 21, rotulo: 'Cor da inflorescência - feminina',   tipo: 'cor' },
  { chave: 'corFruto',           col: 22, rotulo: 'Cor do fruto',                       tipo: 'cor' },
  { chave: 'frutoComprimento',   col: 23, rotulo: 'Comprimento do fruto (cm)',          tipo: 'num' },
  { chave: 'frutoLargura',       col: 24, rotulo: 'Largura do fruto (cm)',              tipo: 'num' },
  { chave: 'sementeComprimento', col: 25, rotulo: 'Comprimento da semente (cm)',        tipo: 'num' },
  { chave: 'sementeLargura',     col: 26, rotulo: 'Largura da semente (cm)',            tipo: 'num' }
];

/** Primeira coluna do 1.º bloco de ronda em Data (G). A..F sao identificacao. */
var COL_PRIMEIRO_BLOCO_RONDA = 7;

/**
 * Lotes de semente pela ordem em que aparecem na folha Data. O "n.º de
 * referencia" que o campo usa desde 2026-08-12 e a POSICAO nesta lista: o
 * primeiro lote e o 1 e o ultimo e o 17. Note-se que nao ha bag08, por isso
 * o 'India #bag09' e o n.º 8 — e mesmo assim que foi pedido.
 *
 * As contagens tem de bater certo com docs/plants.json (415 no total).
 */
var LOTES = [
  { source: 'India #bag01', count: 30 }, { source: 'India #bag02', count: 25 },
  { source: 'India #bag03', count: 25 }, { source: 'India #bag04', count: 35 },
  { source: 'India #bag05', count: 15 }, { source: 'India #bag06', count: 25 },
  { source: 'India #bag07', count: 25 }, { source: 'India #bag09', count: 20 },
  { source: 'India #bag10', count: 25 }, { source: 'India #bag11', count: 15 },
  { source: 'India #bag12', count: 25 }, { source: 'India #bag13', count: 35 },
  { source: 'India #bag14', count: 25 }, { source: 'India #bag15', count: 35 },
  { source: 'India#S-2A', count: 20 },   { source: 'India#S-2B', count: 15 },
  { source: 'India#S-4', count: 20 }
];

/**
 * N.º de referencia (1..17) e n.º dentro do lote, a partir do n.º da planta.
 * Deriva-se do seq e nao do texto enviado pelo telemovel, para os envios
 * antigos — que nao trazem nada disto — ficarem tambem com o n.º certo.
 */
function refDoSeq_(seq) {
  var n = Number(seq);
  if (!(n >= 1)) return null;
  var acc = 0;
  for (var i = 0; i < LOTES.length; i++) {
    if (n <= acc + LOTES[i].count) {
      return { ref: i + 1, source: LOTES[i].source, noLote: n - acc };
    }
    acc += LOTES[i].count;
  }
  return null;
}

/**
 * Colunas acrescentadas em 2026-08-12. Vivem SEMPRE no fim da folha Data e sao
 * encontradas pelo nome do cabecalho, nunca por uma letra fixa — assim nada do
 * que ja la esta se mexe e um bloco de ronda novo pode aparecer depois delas.
 */
var COL_EXTRA_DEF = [
  { chave: 'notasCrescimento', rotulo: 'Notes (growth)' },
  { chave: 'notasDescritores', rotulo: 'Notes (descriptors)' },
  { chave: 'estadoPlanta',     rotulo: 'Plant status' }
];

/** O que fica gravado em "Plant status" quando a planta esta morta. */
var VALOR_MORTA = 'Dead';

function rotuloExtra_(chave) {
  for (var i = 0; i < COL_EXTRA_DEF.length; i++) {
    if (COL_EXTRA_DEF[i].chave === chave) return COL_EXTRA_DEF[i].rotulo;
  }
  return '';
}

function ehRotuloExtra_(texto) {
  var s = String(texto == null ? '' : texto).trim();
  if (!s) return false;
  for (var i = 0; i < COL_EXTRA_DEF.length; i++) {
    if (COL_EXTRA_DEF[i].rotulo === s) return true;
  }
  return false;
}

/**
 * A linha 1 da folha Data tem cabecalhos de quatro tipos: identificacao (A..F),
 * blocos de ronda (G..M e tudo o que for acrescentado a direita), o bloco dos
 * descritores (N..Z) e as colunas extra. So os do segundo tipo sao nomes de
 * ronda — sem este filtro, "Growth habit" ou "Notes (growth)" apareciam na
 * lista de rondas.
 */
function ehColunaDeRonda_(c, texto) {
  var pri = CAMPOS_DESCRITORES[0].col;
  var ult = CAMPOS_DESCRITORES[CAMPOS_DESCRITORES.length - 1].col;
  if (c < COL_PRIMEIRO_BLOCO_RONDA) return false;
  if (c >= pri && c <= ult) return false;
  return !ehRotuloExtra_(texto);
}

var TODOS_CAMPOS = CAMPOS_CRESCIMENTO.concat(CAMPOS_DESCRITORES);

/**
 * Cabecalho da folha Log (A..AM = 39 colunas). A ordem manda em montarLinhaLog_().
 *
 * ⚠ As tres ultimas colunas entraram em 2026-08-12. Foram postas DEPOIS de
 * "Estado" — e nao ao pe dos valores, que era onde ficavam melhor — porque a
 * folha ja tem linhas gravadas: acrescentar no meio mudava o significado de
 * tudo o que estava a direita nessas linhas. Colunas novas so no fim.
 */
var CABECALHO_LOG = [
  'Data/hora (aparelho)', 'Data/hora (servidor)', 'Registado por', 'Acção',
  'Levantamento', 'Ronda', 'Plant ID', 'Fileira', 'N.º na fileira', 'N.º na folha',
  'Lote', 'Linha em Data'
].concat(
  TODOS_CAMPOS.map(function (c) { return c.rotulo; }),
  ['ID do envio', 'Substitui o envio', 'Aparelho', 'Estado',
   'Notas', 'Estado da planta', 'N.º de referência']
);

// indices 1-based dentro da folha Log
var COL_RECORDER = 3;
var COL_ACCAO = 4;
var COL_LEVANTAMENTO = 5;
var COL_RONDA = 6;
var COL_PID = 7;
var COL_PRIMEIRO_CAMPO = 13;                       // M
var COL_UUID = 12 + TODOS_CAMPOS.length + 1;       // AG = 33
var COL_SUBSTITUI = COL_UUID + 1;                  // AH = 34
var COL_ESTADO = COL_UUID + 3;                     // AJ = 36
var COL_NOTAS = COL_ESTADO + 1;                    // AK = 37
var COL_ESTADO_PLANTA = COL_ESTADO + 2;            // AL = 38
var COL_REF = COL_ESTADO + 3;                      // AM = 39

var ROTULO_MODO = { crescimento: 'Crescimento (G-M)', descritores: 'Descritores (N-Z)' };

/** Acção gravada no Log quando alguém anula um registo. */
var ACCAO_ELIMINAR = 'Eliminação';

/* Marcas de planta morta/viva. Nao sao registos de levantamento: ficam no Log e
 * na coluna "Plant status" da Data, mas nao entram no indice de registos. */
var ACCAO_MORTA = 'Planta morta';
var ACCAO_VIVA = 'Planta viva';

/**
 * Le o modo a partir do texto gravado na coluna Levantamento do Log.
 * Compara so o prefixo: as letras das colunas ja mudaram uma vez (F-K -> G-L) e
 * podem voltar a mudar, e as linhas antigas do Log tem de continuar a ser lidas.
 */
function modoDoRotulo_(levant) {
  return String(levant || '').indexOf('Crescimento') === 0 ? 'crescimento' : 'descritores';
}

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

/** N.º da planta a partir do Plant ID ('NBF(Tanheia)26-007' -> 7). */
function seqDoPid_(pid) {
  var m = /-(\d{3})$/.exec(String(pid || ''));
  return m ? parseInt(m[1], 10) : 0;
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
    // nunca escrever por cima dos descritores nem das colunas extra
    if (!ehColunaDeRonda_(i + 1, linha1[i])) continue;
    if (String(linha1[i]).trim() !== '' && String(linha1[i]).trim() === ronda) return i + 1;
  }

  // a largura do bloco e o numero de campos — estava fixa em 6 e partiu-se
  // quando a folha ganhou a coluna "Branch"
  var largura = CAMPOS_CRESCIMENTO.length;
  var inicio = ultima + 1;
  var precisa = inicio + largura - 1;
  if (folha.getMaxColumns() < precisa) {
    folha.insertColumnsAfter(folha.getMaxColumns(), precisa - folha.getMaxColumns());
  }
  folha.getRange(1, inicio).setValue(ronda);
  folha.getRange(1, inicio, 1, largura).merge();
  folha.getRange(2, inicio, 1, largura).setValues([
    CAMPOS_CRESCIMENTO.map(function (c) { return c.rotulo; })
  ]);
  folha.getRange(1, inicio, 2, largura).setFontWeight('bold');
  return inicio;
}

// -------------------------------------------------------- colunas extra (Data)

/* Um lote de 25 envios procuraria a mesma coluna 25 vezes. A cache dura o que
 * durar o pedido — cada execucao do Apps Script comeca do zero. */
var CACHE_EXTRA = {};

/**
 * Procura uma das colunas extra pelo cabecalho. Devolve 0 se ainda nao existir.
 * Le a linha 1 e a linha 2 porque a folha tem cabecalho em dois andares.
 */
function procurarColunaExtra_(folha, chave) {
  if (CACHE_EXTRA[chave]) return CACHE_EXTRA[chave];

  var rotulo = rotuloExtra_(chave);
  if (!rotulo) return 0;
  var ultima = folha.getLastColumn();
  if (ultima < 1) return 0;
  var duas = folha.getRange(1, 1, 2, ultima).getValues();
  for (var i = 0; i < ultima; i++) {
    if (String(duas[0][i]).trim() === rotulo || String(duas[1][i]).trim() === rotulo) {
      CACHE_EXTRA[chave] = i + 1;
      return i + 1;
    }
  }
  return 0;
}

/**
 * O mesmo, mas cria a coluna no fim da folha se ainda nao existir. So se chama
 * a escrever (doPost): um GET nunca deve alterar a folha.
 */
function colunaExtra_(folha, chave) {
  var ja = procurarColunaExtra_(folha, chave);
  if (ja) return ja;

  var rotulo = rotuloExtra_(chave);
  var col = folha.getLastColumn() + 1;
  if (folha.getMaxColumns() < col) {
    folha.insertColumnsAfter(folha.getMaxColumns(), col - folha.getMaxColumns());
  }
  // o mesmo texto nas duas linhas de cabecalho: assim le-se de qualquer uma
  folha.getRange(1, col, 2, 1).setValues([[rotulo], [rotulo]]).setFontWeight('bold');
  CACHE_EXTRA[chave] = col;
  return col;
}

/** Chave da coluna de notas do levantamento indicado. */
function chaveNotas_(modo) {
  return modo === 'crescimento' ? 'notasCrescimento' : 'notasDescritores';
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

    var modo = modoDoRotulo_(levant);
    var k = chave_(modo, ronda, pid);
    var acc = String(meta[i][1]).trim();

    /* Marcar a planta como morta (ou desmarcar) nao e um registo de medicao:
     * fica no Log e na coluna "Plant status", mas nao entra no indice nem
     * mexe em quem e o dono do registo. */
    if (acc === ACCAO_MORTA || acc === ACCAO_VIVA) continue;

    /* Uma eliminacao apaga o registo do indice: a planta volta a contar como
     * por fazer e deixa de aparecer no historico. Se depois alguem a registar
     * outra vez, e essa pessoa que passa a ser dona. */
    if (acc === ACCAO_ELIMINAR) { delete idx.porChave[k]; continue; }

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
  CACHE_EXTRA = {};
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
      return jsonOut_({ ok: false, erro: 'Não autorizado.', versao: VERSAO_CODIGO });
    }

    /* Desde 2026-08-12 o modo administrador ja nao decide nada na escrita —
     * toda a gente pode corrigir e eliminar. Continua a ser calculado e
     * passado adiante para nao partir quem o use e para poder voltar a
     * mandar aqui se um dia for preciso. */
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

    var pedida = String(ent.accao || '');
    var eliminar = pedida === 'eliminar';
    var morta = pedida === 'morta';
    var viva = pedida === 'viva';

    // a ronda so faz falta para escrever no bloco do crescimento
    if (modo === 'crescimento' && !ronda && !morta && !viva) {
      throw new Error('Falta a ronda do levantamento.');
    }

    /* ------------------------------------------------ planta morta / viva --
     * Marca da PLANTA, nao do levantamento: escreve-se numa coluna propria e
     * nao conta como registo (nao entra no indice, nao muda donos). */
    if (morta || viva) {
      var colEstado = colunaExtra_(dados, 'estadoPlanta');
      var valorEstado = morta ? VALOR_MORTA : '';
      dados.getRange(linha, colEstado).setValue(valorEstado);

      linhasLog.push(montarLinhaLog_(ent, uuid, linha,
                                     morta ? ACCAO_MORTA : ACCAO_VIVA, 'OK', valorEstado));
      idx.uuids[uuid] = true;
      return {
        ok: true, uuid: uuid, linha: linha, accao: morta ? ACCAO_MORTA : ACCAO_VIVA,
        celulas: [letraColuna_(colEstado) + linha]
      };
    }

    var anterior = idx.porChave[chave_(modo, ronda, pidFolha)];
    var accao = eliminar ? ACCAO_ELIMINAR : (anterior ? 'Correcção' : 'Registo');
    if (eliminar && !anterior) {
      throw new Error('Não há nenhum registo desta planta para eliminar.');
    }

    /* PERMISSOES (2026-08-12) — a partir daqui NAO se recusa nada por causa de
     * quem registou. Ate esta data so o dono (ou um administrador) podia
     * corrigir ou eliminar, e no campo isso deixava as pessoas sem forma de
     * desfazer um engano proprio quando trocavam de nome ou de telemovel.
     * Decisao do Kaz-san: toda a gente pode corrigir e eliminar. O rasto de
     * quem fez o que continua todo na folha Log. */

    // As colunas de cada levantamento sao contiguas (G..M ou N..Z), por isso
    // trata-se o bloco todo de uma vez: uma leitura e uma escrita por planta,
    // em vez de ate 19 chamadas soltas. Com lotes de 25 envios a diferenca e
    // entre umas centenas de chamadas e umas dezenas.
    var colInicio = (modo === 'crescimento') ? colunaBlocoRonda_(dados, ronda) : campos[0].col;
    var bloco = dados.getRange(linha, colInicio, 1, campos.length);
    var actuais = bloco.getValues()[0];

    var notas = String(ent.notas === null || ent.notas === undefined ? '' : ent.notas).trim();

    if (eliminar) {
      /* Guarda no Log o que estava la antes de limpar. Sem isto, uma eliminacao
       * feita por engano nao deixava rasto nenhum do que se perdeu. */
      var antigos = {};
      var limpas = [];
      for (var j = 0; j < campos.length; j++) {
        var d = desnormalizar_(campos[j], actuais[j]);
        if (d !== undefined) antigos[campos[j].chave] = d;
        if (String(actuais[j]).trim() !== '') limpas.push(colInicio + j);
        actuais[j] = '';
      }
      bloco.setValues([actuais]);

      /* A coluna das notas so existe se alguem ja tiver escrito alguma:
       * eliminar nao e motivo para a criar. */
      var colNotasEl = procurarColunaExtra_(dados, chaveNotas_(modo));
      var notasAntigas = colNotasEl
        ? String(dados.getRange(linha, colNotasEl).getValue() || '').trim() : '';
      if (notasAntigas) {
        dados.getRange(linha, colNotasEl).setValue('');
        limpas.push(colNotasEl);
      }

      ent.values = antigos;
      ent.notas = notasAntigas;
      linhasLog.push(montarLinhaLog_(ent, uuid, linha, ACCAO_ELIMINAR, 'OK', ''));
      idx.uuids[uuid] = true;
      delete idx.porChave[chave_(modo, ronda, pidFolha)];

      return {
        ok: true, uuid: uuid, linha: linha, accao: ACCAO_ELIMINAR,
        celulas: limpas.map(function (col) { return letraColuna_(col) + linha; })
      };
    }

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
    // uma observacao sozinha ja e motivo suficiente para gravar o registo
    if (!escritas.length && !notas) throw new Error('Nenhum valor preenchido.');

    bloco.setValues([actuais]);
    if (notas) {
      var colNotas = colunaExtra_(dados, chaveNotas_(modo));
      dados.getRange(linha, colNotas).setValue(notas);
      escritas.push(colNotas);
    }

    linhasLog.push(montarLinhaLog_(ent, uuid, linha, accao, 'OK', ''));
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
    var pedidaErro = String(ent.accao || '');
    var tentada = 'Registo';
    if (pedidaErro === 'eliminar') tentada = ACCAO_ELIMINAR;
    else if (pedidaErro === 'morta') tentada = ACCAO_MORTA;
    else if (pedidaErro === 'viva') tentada = ACCAO_VIVA;
    linhasLog.push(montarLinhaLog_(ent, uuid, '', tentada, 'ERRO: ' + msg, ''));
    return { ok: false, uuid: uuid, erro: msg };
  }
}

function montarLinhaLog_(ent, uuid, linhaDados, accao, estado, estadoPlanta) {
  var v = ent.values || {};
  var ref = refDoSeq_(ent.seq);
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

  /* O n.º de referencia sai do n.º da planta e nao do que o telemovel manda:
   * assim os envios antigos, feitos antes de isto existir, ficam na mesma com
   * o n.º certo na folha. */
  linha.push(uuid, ent.substitui || '', ent.device || '', estado,
             String(ent.notas === null || ent.notas === undefined ? '' : ent.notas),
             estadoPlanta || '',
             ref ? ref.ref : '');
  return linha;
}

// ---------------------------------------------------------------- doGet

function doGet(e) {
  CACHE_EXTRA = {};
  var p = (e && e.parameter) || {};
  if (!getToken() || p.token !== getToken()) {
    return jsonOut_({ ok: false, erro: 'Não autorizado.', versao: VERSAO_CODIGO });
  }

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
  for (var i = COL_PRIMEIRO_BLOCO_RONDA - 1; i < linha1.length; i++) {
    if (!ehColunaDeRonda_(i + 1, linha1[i])) continue;
    var s = String(linha1[i]).trim();
    if (s) rondas.push(s);
  }

  return {
    ok: true, hora: agora_(), mode: modo, ronda: ronda,
    feitas: feitas, rondas: rondas, mortas: mortas_(dados)
  };
}

/**
 * N.os das plantas marcadas como mortas. E uma marca da planta, nao do
 * levantamento, por isso vale para os dois. Nunca cria a coluna: se ainda
 * ninguem marcou nenhuma planta, a coluna nao existe e a lista vem vazia.
 */
function mortas_(dados) {
  var col = procurarColunaExtra_(dados, 'estadoPlanta');
  if (!col) return [];
  var v = dados.getRange(LINHA_PRIMEIRA_PLANTA, col, TOTAL_PLANTAS, 1).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() !== '') out.push(i + 1);
  }
  return out;
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
    // ate a coluna 12 para trazer tambem fileira/lote — o ecra dos registos
    // mostra o n.º de referencia, nao so o Plant ID
    var meta = log.getRange(e.linha, 1, 1, 12).getValues()[0];
    var ref = refDoSeq_(seqDoPid_(e.pid));
    return {
      uuid: e.uuid,
      ts: String(meta[0]),
      recorder: e.dono,                          // quem fez o registo original
      ultimo: e.recorder,                        // quem mexeu por ultimo
      accao: String(meta[COL_ACCAO - 1]),
      mode: e.modo,
      ronda: e.ronda,
      pid: e.pid,
      row: String(meta[7]),
      noFileira: meta[8],
      noLote: ref ? ref.noLote : meta[9],
      lote: String(meta[10]),
      ref: ref ? ref.ref : ''
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
    var tudo = log.getRange(l, 1, 1, CABECALHO_LOG.length).getValues()[0];
    var levant = String(tudo[COL_LEVANTAMENTO - 1]).trim();
    var modo = modoDoRotulo_(levant);

    var values = {};
    for (var j = 0; j < TODOS_CAMPOS.length; j++) {
      var v = desnormalizar_(TODOS_CAMPOS[j], tudo[COL_PRIMEIRO_CAMPO - 1 + j]);
      if (v !== undefined) values[TODOS_CAMPOS[j].chave] = v;
    }

    return {
      ok: true,
      registo: {
        uuid: uuid,
        ts: String(tudo[0]),
        recorder: String(tudo[COL_RECORDER - 1]),
        mode: modo,
        ronda: String(tudo[COL_RONDA - 1]),
        pid: String(tudo[COL_PID - 1]),
        notas: String(tudo[COL_NOTAS - 1] || ''),
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
  l.push('versao do Codigo   : ' + VERSAO_CODIGO);
  l.push('doGet definido     : ' + (typeof doGet === 'function'));
  l.push('doPost definido    : ' + (typeof doPost === 'function'));
  l.push('colunas do Log     : ' + CABECALHO_LOG.length +
         ' (12 + ' + TODOS_CAMPOS.length + ' campos + 7)');
  l.push('toda a gente corrige/elimina : ' +
         (String(processarEntrada_).indexOf('Só essa pessoa') < 0));

  var somaLotes = 0;
  for (var i = 0; i < LOTES.length; i++) somaLotes += LOTES[i].count;
  l.push('lotes / n.os de ref: ' + LOTES.length + ' lotes, ' + somaLotes +
         ' plantas ' + (somaLotes === TOTAL_PLANTAS ? '(OK)' : '(NAO BATE CERTO!)'));

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
