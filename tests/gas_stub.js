/* Stub minimo da API do Apps Script, para correr o Codigo.gs verdadeiro no browser.
 * A folha e um array 2D de strings/numeros; '' = celula vazia. */

function criarFolha(nome, linhas, colunas) {
  var celulas = [];
  for (var r = 0; r < linhas; r++) {
    celulas.push(new Array(colunas).fill(''));
  }

  var folha = {
    nome: nome,
    celulas: celulas,
    frozen: 0,

    getName: function () { return nome; },

    getMaxColumns: function () { return celulas[0].length; },
    getMaxRows: function () { return celulas.length; },

    getLastRow: function () {
      for (var r = celulas.length - 1; r >= 0; r--) {
        for (var c = 0; c < celulas[r].length; c++) {
          if (celulas[r][c] !== '' && celulas[r][c] !== null) return r + 1;
        }
      }
      return 0;
    },

    getLastColumn: function () {
      var ult = 0;
      for (var r = 0; r < celulas.length; r++) {
        for (var c = 0; c < celulas[r].length; c++) {
          if (celulas[r][c] !== '' && celulas[r][c] !== null && c + 1 > ult) ult = c + 1;
        }
      }
      return ult;
    },

    insertColumnsAfter: function (depois, quantas) {
      for (var r = 0; r < celulas.length; r++) {
        for (var k = 0; k < quantas; k++) celulas[r].splice(depois + k, 0, '');
      }
      return folha;
    },

    setFrozenRows: function (n) { folha.frozen = n; return folha; },

    getRange: function (r, c, nr, nc) {
      nr = nr === undefined ? 1 : nr;
      nc = nc === undefined ? 1 : nc;
      if (r < 1 || c < 1) throw new Error('getRange fora de limites: r=' + r + ' c=' + c);
      if (r + nr - 1 > celulas.length) {
        throw new Error('getRange passa o fim da folha ' + nome +
                        ': pede ate a linha ' + (r + nr - 1) + ', existem ' + celulas.length);
      }
      if (c + nc - 1 > celulas[0].length) {
        throw new Error('getRange passa a ultima coluna da folha ' + nome +
                        ': pede ate ' + (c + nc - 1) + ', existem ' + celulas[0].length);
      }

      var range = {
        getValue: function () { return celulas[r - 1][c - 1]; },
        getValues: function () {
          var out = [];
          for (var i = 0; i < nr; i++) out.push(celulas[r - 1 + i].slice(c - 1, c - 1 + nc));
          return out;
        },
        setValue: function (v) { celulas[r - 1][c - 1] = v; return range; },
        setValues: function (vv) {
          if (vv.length !== nr) throw new Error('setValues: ' + vv.length + ' linhas para um range de ' + nr);
          for (var i = 0; i < nr; i++) {
            if (vv[i].length !== nc) {
              throw new Error('setValues: linha com ' + vv[i].length + ' valores para ' + nc + ' colunas');
            }
            for (var j = 0; j < nc; j++) celulas[r - 1 + i][c - 1 + j] = vv[i][j];
          }
          return range;
        },
        clearContent: function () {
          for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) celulas[r - 1 + i][c - 1 + j] = '';
          return range;
        },
        merge: function () { return range; },
        setFontWeight: function () { return range; }
      };
      return range;
    }
  };
  return folha;
}

var LIVRO = { folhas: {} };

var SpreadsheetApp = {
  openById: function () {
    return {
      getName: function () { return 'NBF(Tanheia)26 (falso)'; },
      getSheetByName: function (n) { return LIVRO.folhas[n] || null; },
      insertSheet: function (n) {
        LIVRO.folhas[n] = criarFolha(n, 200, 60);
        return LIVRO.folhas[n];
      }
    };
  },
  flush: function () {}
};

var PROPS = {};
var PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return k in PROPS ? PROPS[k] : null; },
      getProperties: function () { return JSON.parse(JSON.stringify(PROPS)); }
    };
  }
};

var LockService = {
  getScriptLock: function () {
    return { waitLock: function () {}, releaseLock: function () {} };
  }
};

var SAIDA = null;
var ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: function (s) {
    SAIDA = s;
    return { setMimeType: function () { return { getContent: function () { return s; } }; } };
  }
};

var Utilities = {
  formatDate: function () { return '2026-08-09 10:00:00'; }
};

var Logger = { log: function () {} };

/* ------------------------------------------------------------------ ajudas */

function lerSaida(res) {
  return JSON.parse(res.getContent ? res.getContent() : SAIDA);
}

function colunas(folha, linha, de, ate) {
  return folha.getRange(linha, de, 1, ate - de + 1).getValues()[0];
}
