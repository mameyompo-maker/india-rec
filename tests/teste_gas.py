# -*- coding: utf-8 -*-
"""Corre o Codigo.gs VERDADEIRO contra um stub da API do Apps Script.

O servidor de teste em Python re-implementa aquilo que eu ACHO que o Codigo.gs faz,
por isso nao apanha erros no proprio Codigo.gs (indices de coluna, formato da linha
do Log, leitura do indice, permissoes). Isto corre o ficheiro real.
"""

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
GS = AQUI.parent / "apps_script" / "Codigo.gs"

TOKEN = "tok-teste-123456"
ADMIN = "adm-teste"
FALHAS = []

# O que se escrevia na folha ate 2026-08-14. Nenhuma linha pode ficar assim
# depois de correr traduzirLogParaIngles().
ACCOES_PT = {"Registo", "Correcção", "Eliminação", "Planta morta", "Planta viva"}
MODOS_PT = {"Crescimento (G-M)", "Descritores (N-Z)"}


def ok(cond, msg, extra=""):
    print(("  OK   " if cond else "  FALHA") + "  " + msg + (("  | " + str(extra)) if not cond and extra else ""))
    if not cond:
        FALHAS.append(msg)


ARRANQUE = """
(() => {
  // folha Data: 2 linhas de cabecalho + 415 plantas (linhas 3..417), colunas A..Z
  // A..F sao identificacao (D = "No. in row", inserida em 2026-08-09),
  // G..M o 1.o bloco de ronda (com 'Branch'), N..Z os descritores.
  LIVRO.folhas['Data'] = criarFolha('Data', 440, 26);
  const d = LIVRO.folhas['Data'];
  d.getRange(1, 1, 1, 6).setValues([['Plant ID','Row','No.','No. in row','Source','1st Flwr']]);
  d.getRange(1, 7).setValue('5 month after planting (20260511)');
  const sub = ['Plant Hight','Cnp-1','Cnp-2','Branch','Fruit bunch','Flower bunch','Flower bud bunch'];
  d.getRange(2, 7, 1, 7).setValues([sub]);
  d.getRange(1, 14).setValue('Growth habit');
  d.getRange(1, 26).setValue('Seed width (cm)');
  for (let i = 0; i < 415; i++) {
    const seq = String(i + 1).padStart(3, '0');
    d.getRange(3 + i, 1).setValue('NBF(Tanheia)26-' + seq);
    // G..M ja preenchidas, como na folha real
    d.getRange(3 + i, 7, 1, 7).setValues([[1, 0.6, 0.7, 2, 0, 8, 16]]);
  }

  // folha Log so com a linha de cabecalho, como esta agora
  LIVRO.folhas['Log'] = criarFolha('Log', 200, 44);

  PROPS.TOKEN = TOKEN_JS;
  PROPS.ADMIN_PASSWORD = ADMIN_JS;
  return 'pronto';
})()
"""


SEM_MEDIDA_PY = "X"   # tem de ser igual ao SEM_MEDIDA do Codigo.gs


def envio(**kw):
    base = {
        "uuid": "u1", "tsLocal": "09/08/2026 10:00:00", "recorder": "Cheia",
        "device": "dev1", "mode": "descritores", "ronda": "", "substitui": "",
        "seq": 45, "pid": "NBF(Tanheia)26-045", "row": "r02",
        "noFileira": 10, "noFolha": 20, "source": "India #bag02",
        "values": {"limboFoliar": 12.5, "habitoCrescimento": "vertical", "corFruto": "vermelho"},
    }
    base.update(kw)
    return base


def post(pag, entries, admin=None):
    corpo = {"token": TOKEN, "entries": entries}
    if admin:
        corpo["adminPassword"] = admin
    return pag.evaluate(
        "c => JSON.parse(doPost({postData:{contents: c}}).getContent())",
        json.dumps(corpo))


def get(pag, params):
    params = dict(params)
    params.setdefault("token", TOKEN)
    return pag.evaluate("p => JSON.parse(doGet({parameter: p}).getContent())", params)


def main():
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page()
        erros = []
        pag.on("pageerror", lambda e: erros.append(str(e)))
        pag.goto("about:blank")

        print("\n[1] o Codigo.gs analisa sem erros de sintaxe")
        pag.add_script_tag(content=(AQUI / "gas_stub.js").read_text(encoding="utf-8"))
        try:
            pag.add_script_tag(content=GS.read_text(encoding="utf-8"))
            ok(True, "Codigo.gs carregado")
        except Exception as e:
            ok(False, "Codigo.gs carregado", e)
            nav.close()
            return

        pag.evaluate(ARRANQUE.replace("TOKEN_JS", json.dumps(TOKEN)).replace("ADMIN_JS", json.dumps(ADMIN)))
        ok(pag.evaluate("typeof doPost") == "function", "doPost existe")
        ok(pag.evaluate("typeof doGet") == "function", "doGet existe")

        print("\n[2] constantes de coluna do Log")
        n_cab = pag.evaluate("CABECALHO_LOG.length")
        ok(n_cab == 39, f"cabecalho tem 39 colunas ({n_cab})")
        ok(pag.evaluate("CABECALHO_LOG[COL_UUID-1]") == "Submission ID", "COL_UUID aponta para 'Submission ID'")
        ok(pag.evaluate("CABECALHO_LOG[COL_SUBSTITUI-1]") == "Replaces submission", "COL_SUBSTITUI certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_ESTADO-1]") == "Status", "COL_ESTADO certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_RECORDER-1]") == "Recorded by", "COL_RECORDER certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_ACCAO-1]") == "Action", "COL_ACCAO certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_LEVANTAMENTO-1]") == "Survey", "COL_LEVANTAMENTO certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_RONDA-1]") == "Round", "COL_RONDA certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_PID-1]") == "Plant ID", "COL_PID certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_PRIMEIRO_CAMPO-1]") == "Plant height (m)",
           "COL_PRIMEIRO_CAMPO aponta para o 1o campo")
        # as tres novas entraram DEPOIS de "Estado": o Log ja tem linhas gravadas
        # e mexer no meio deslocava o significado de tudo o que esta a direita
        ok(pag.evaluate("CABECALHO_LOG[COL_NOTAS-1]") == "Notes", "COL_NOTAS certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_ESTADO_PLANTA-1]") == "Plant status",
           "COL_ESTADO_PLANTA certo")
        ok(pag.evaluate("CABECALHO_LOG[COL_REF-1]") == "Reference no.", "COL_REF certo")
        ok(pag.evaluate("COL_ESTADO") == 36,
           "as colunas antigas nao se mexeram (Estado continua na 36)")

        somas = pag.evaluate("LOTES.reduce((a,l) => a + l.count, 0)")
        ok(pag.evaluate("LOTES.length") == 17 and somas == 415,
           f"17 lotes que somam 415 plantas ({pag.evaluate('LOTES.length')}, {somas})")
        ok(pag.evaluate("JSON.stringify(refDoSeq_(45))") ==
           '{"ref":2,"source":"India #bag02","noLote":15}',
           "planta 45 -> ref 2, n.o 15 (" + pag.evaluate("JSON.stringify(refDoSeq_(45))") + ")")
        ok(pag.evaluate("refDoSeq_(181).ref") == 8,
           "sem bag08: o India #bag09 e o n.o 8 de referencia")
        ok(pag.evaluate("refDoSeq_(415).ref") == 17, "a ultima planta e do n.o 17")

        print("\n[3] token e autorizacao")
        r = pag.evaluate("() => JSON.parse(doPost({postData:{contents: JSON.stringify("
                         "{token:'errado', entries:[]})}}).getContent())")
        ok(r["ok"] is False and "unauthorized" in r["erro"].lower(), "POST com token errado e recusado", r)
        ok(r.get("versao") == pag.evaluate("VERSAO_CODIGO"),
           f"POST recusado diz a versao ({r.get('versao')})")
        r = get(pag, {"token": "errado", "action": "estado"})
        ok(r["ok"] is False, "GET com token errado e recusado", r)
        # sem isto nao se distingue "colei mal" de "implantei a versao antiga"
        ok(r.get("versao") == pag.evaluate("VERSAO_CODIGO"),
           f"GET recusado diz a versao ({r.get('versao')})")

        print("\n[4] primeiro registo escreve em Data e no Log")
        r = post(pag, [envio()])
        res = r["resultados"][0]
        ok(r["ok"] and res["ok"], "aceite", res)
        ok(res["accao"] == "Record", f"accao=Record ({res.get('accao')})")
        ok(res["linha"] == 47, f"planta 45 -> linha 47 ({res.get('linha')})")
        ok(sorted(res["celulas"]) == ["N47", "O47", "V47"],
           f"escreveu so as celulas preenchidas ({res.get('celulas')})")

        lx = pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 14, 26)")
        ok(lx[0] == "Vertical", f"N47 = Vertical ({lx[0]})")
        ok(lx[1] == 12.5, f"O47 = 12.5 ({lx[1]})")
        ok(lx[8] == "Red", f"V47 = Red ({lx[8]})")
        ok(all(v == "" for i, v in enumerate(lx) if i not in (0, 1, 8)),
           "os campos nao preenchidos ficaram vazios")

        fk = pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 7, 13)")
        ok(fk == [1, 0.6, 0.7, 2, 0, 8, 16], f"G..M nao foi tocado ({fk})")

        cab = pag.evaluate("colunas(LIVRO.folhas['Log'], 1, 1, 39)")
        ok(cab[3] == "Action" and cab[35] == "Status", "o Log ganhou o cabecalho certo")
        l2 = pag.evaluate("colunas(LIVRO.folhas['Log'], 2, 1, 39)")
        ok(len(l2) == 39, "linha do Log com 39 colunas")
        ok(l2[2] == "Cheia", f"Registado por ({l2[2]})")
        ok(l2[3] == "Record", f"Action ({l2[3]})")
        ok(l2[4] == "Descriptors (N-Z)", f"Survey ({l2[4]})")
        ok(l2[6] == "NBF(Tanheia)26-045", f"Plant ID ({l2[6]})")
        ok(l2[11] == 47, f"Linha em Data ({l2[11]})")
        ok(l2[20] == 12.5, f"Limbo foliar no Log ({l2[20]})")
        ok(l2[19] == "Vertical", f"Habito no Log ({l2[19]})")
        ok(l2[32] == "u1", f"ID do envio ({l2[32]})")
        ok(l2[35] == "OK", f"Estado ({l2[35]})")
        ok(l2[38] == 2, f"N.º de referência calculado a partir do seq ({l2[38]})")

        print("\n[5] deduplicacao pelo ID do envio")
        r = post(pag, [envio()])
        ok(r["resultados"][0].get("duplicado") is True, "reenviar o mesmo uuid nao duplica")
        ok(pag.evaluate("LIVRO.folhas['Log'].getLastRow()") == 2, "o Log continua com 1 linha de dados")

        print("\n[6] correccao do proprio registo")
        r = post(pag, [envio(uuid="u2", substitui="u1", values={"limboFoliar": 14})])
        res = r["resultados"][0]
        ok(res["ok"] and res["accao"] == "Correction", f"marcada como Correction ({res.get('accao')})")
        lx = pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 14, 26)")
        ok(lx[1] == 14, f"M47 actualizado ({lx[1]})")
        ok(lx[0] == "Vertical", f"L47 preservado apesar de vir vazio ({lx[0]})")
        ok(lx[8] == "Red", f"T47 preservado ({lx[8]})")
        l3 = pag.evaluate("colunas(LIVRO.folhas['Log'], 3, 1, 39)")
        ok(l3[33] == "u1", f"Substitui o envio ({l3[33]})")

        print("\n[7] qualquer pessoa corrige (mudou em 2026-08-12)")
        r = post(pag, [envio(uuid="u3", recorder="Joana", values={"limboFoliar": 99})])
        res = r["resultados"][0]
        ok(res["ok"], "a Joana corrige o registo da Cheia sem ser administradora", res)
        ok(res["accao"] == "Correction", f"marcada como Correction ({res.get('accao')})")
        lx = pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 14, 26)")
        ok(lx[1] == 99, f"o valor da Joana ficou escrito ({lx[1]})")
        j = get(pag, {"action": "estado", "mode": "descritores"})
        ok(dict(j["feitas"]).get(45) == "Cheia",
           "o dono continua a ser quem criou o registo")

        print("\n[8] o administrador ja nao e preciso para escrever")
        r = post(pag, [envio(uuid="u4", recorder="Joana", values={"limboFoliar": 21})], admin=ADMIN)
        ok(r["resultados"][0]["ok"], "com a palavra-passe passa", r["resultados"][0])
        ok(pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 14, 26)")[1] == 21, "o valor foi corrigido")
        # a escrita deixou de depender do administrador: uma palavra-passe errada
        # ja nao bloqueia nada (mas o GET action=admin continua a verifica-la)
        r = post(pag, [envio(uuid="u5", recorder="Pedro", values={"limboFoliar": 22})], admin="errada")
        ok(r["resultados"][0]["ok"], "uma palavra-passe errada nao impede a correccao")
        j = get(pag, {"action": "estado", "mode": "descritores"})
        ok(dict(j["feitas"]).get(45) == "Cheia",
           "e mesmo depois de tres pessoas mexerem, a dona continua a ser a Cheia")

        print("\n[9] validacao dos valores")
        casos = [
            ({"lobulosFolha": 2.5}, "inteiro"),
            ({"limboFoliar": -1}, "negativo"),
            ({"limboFoliar": "abc"}, "nao numerico"),
            ({"corFruto": "azul"}, "cor invalida"),
            ({"habitoCrescimento": "diagonal"}, "habito invalido"),
        ]
        for i, (vals, nome) in enumerate(casos):
            r = post(pag, [envio(uuid="v%d" % i, seq=200, pid="NBF(Tanheia)26-200", values=vals)],
                     admin=ADMIN)
            ok(r["resultados"][0]["ok"] is False, "recusa " + nome + ": " + json.dumps(vals))
        r = post(pag, [envio(uuid="v9", seq=200, pid="NBF(Tanheia)26-200", values={})], admin=ADMIN)
        ok(r["resultados"][0]["ok"] is False, "recusa um envio sem valor nenhum")

        print("\n[10] Plant ID tem de bater certo com a folha")
        r = post(pag, [envio(uuid="w1", seq=45, pid="NBF(Tanheia)26-999")], admin=ADMIN)
        ok(r["resultados"][0]["ok"] is False, "seq e pid trocados sao recusados")
        r = post(pag, [envio(uuid="w2", seq=999)], admin=ADMIN)
        ok(r["resultados"][0]["ok"] is False, "planta fora do intervalo e recusada")

        print("\n[11] crescimento cria um bloco de ronda novo")
        antes = pag.evaluate("LIVRO.folhas['Data'].getLastColumn()")
        r = post(pag, [envio(uuid="c1", mode="crescimento", ronda="11 month (20261111)",
                             values={"alturaPlanta": 1.4, "cachosFrutos": 3})])
        res = r["resultados"][0]
        ok(res["ok"], "aceite", res)
        depois = pag.evaluate("LIVRO.folhas['Data'].getLastColumn()")
        ok(depois == antes + 7, f"acrescentou 7 colunas ({antes} -> {depois})")
        cab1 = pag.evaluate("colunas(LIVRO.folhas['Data'], 1, 27, 33)")
        cab2 = pag.evaluate("colunas(LIVRO.folhas['Data'], 2, 27, 33)")
        ok(cab1[0] == "11 month (20261111)", f"linha 1 com o nome da ronda ({cab1[0]})")
        ok(cab2[0] == "Plant height (m)" and cab2[4] == "Fruit bunches (no.)",
           f"linha 2 com os campos ({cab2})")
        novo = pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 27, 33)")
        ok(novo[0] == 1.4 and novo[4] == 3, f"valores no bloco novo ({novo})")
        fk = pag.evaluate("colunas(LIVRO.folhas['Data'], 47, 7, 13)")
        ok(fk == [1, 0.6, 0.7, 2, 0, 8, 16], f"a ronda antiga (G..M) continua intacta ({fk})")

        print("\n[12] a mesma ronda reutiliza o bloco")
        r = post(pag, [envio(uuid="c2", seq=46, pid="NBF(Tanheia)26-046", mode="crescimento",
                             ronda="11 month (20261111)", values={"alturaPlanta": 0.9})])
        ok(r["resultados"][0]["ok"], "aceite")
        ok(pag.evaluate("LIVRO.folhas['Data'].getLastColumn()") == depois, "nao criou outro bloco")
        ok(pag.evaluate("colunas(LIVRO.folhas['Data'], 48, 27, 33)")[0] == 0.9, "escreveu na linha certa")

        print("\n[13] crescimento sem ronda e recusado")
        r = post(pag, [envio(uuid="c3", mode="crescimento", ronda="",
                             values={"alturaPlanta": 1})])
        ok(r["resultados"][0]["ok"] is False, "falta a ronda -> recusado")

        print("\n[14] GET estado (progresso)")
        j = get(pag, {"action": "estado", "mode": "descritores"})
        ok(j["ok"], "estado responde")
        seqs = [f[0] for f in j["feitas"]]
        ok(45 in seqs, f"a planta 45 conta como feita ({seqs})")
        ok(200 not in seqs, "a planta 200 (so erros) nao conta como feita")
        donos = dict(j["feitas"])
        ok(donos.get(45) == "Cheia",
           f"o dono continua a ser quem criou, apesar das correccoes ({donos.get(45)})")
        ok("11 month (20261111)" in j["rondas"], f"lista as rondas ({j['rondas']})")
        ok(sorted(j["rondas"]) == ["11 month (20261111)", "5 month after planting (20260511)"],
           f"so rondas — nao apanha os cabecalhos dos descritores ({j['rondas']})")

        j = get(pag, {"action": "estado", "mode": "crescimento", "ronda": "11 month (20261111)"})
        ok(sorted(f[0] for f in j["feitas"]) == [45, 46], f"progresso por ronda ({j['feitas']})")
        j = get(pag, {"action": "estado", "mode": "crescimento", "ronda": "ronda que nao existe"})
        ok(j["feitas"] == [], "ronda desconhecida -> nada feito")

        print("\n[15] GET historico e registo")
        j = get(pag, {"action": "historico"})
        ok(j["ok"] and len(j["registos"]) == 3,
           f"3 registos distintos (descritores-45, crescimento-45, crescimento-46) ({len(j['registos'])})")
        d45 = [x for x in j["registos"] if x["mode"] == "descritores"][0]
        ok(d45["recorder"] == "Cheia", f"mostra o DONO, nao quem corrigiu ({d45['recorder']})")
        # o ultimo a mexer foi o Pedro, no bloco [8] — o dono e que nao muda
        ok(d45["ultimo"] == "Pedro", f"ultimo a mexer ({d45['ultimo']})")
        ok(d45["ref"] == 2 and d45["lote"] == "India #bag02" and d45["noLote"] == 15,
           f"o historico traz o n.o de referencia ({d45.get('ref')}, {d45.get('lote')}, {d45.get('noLote')})")
        ok(d45["accao"] == "Correction", f"mostra a accao ({d45['accao']})")

        # u1 foi o envio com habito + cor preenchidos
        j = get(pag, {"action": "registo", "uuid": "u1"})
        ok(j["ok"], "registo devolve o envio", j)
        v = j["registo"]["values"]
        ok(v.get("limboFoliar") == 12.5, f"valor numerico de volta ({v.get('limboFoliar')})")
        ok(v.get("habitoCrescimento") == "vertical",
           f"habito traduzido de volta para a chave do ecra ({v.get('habitoCrescimento')})")
        ok(v.get("corFruto") == "vermelho", f"cor traduzida de volta ({v.get('corFruto')})")
        ok("alturaPlanta" not in v, "nao mistura campos do outro levantamento")

        j = get(pag, {"action": "registo", "uuid": "nao-existe"})
        ok(j["ok"] is False, "uuid desconhecido -> erro limpo")

        print("\n[16] GET admin")
        ok(get(pag, {"action": "admin", "pw": ADMIN})["admin"] is True, "palavra-passe certa")
        ok(get(pag, {"action": "admin", "pw": "x"})["admin"] is False, "palavra-passe errada")

        print("\n[17] lote com varios envios")
        lote = [envio(uuid="b%d" % i, seq=300 + i, pid="NBF(Tanheia)26-%03d" % (300 + i),
                      recorder="Cheia", values={"limboFoliar": 5 + i}) for i in range(10)]
        r = post(pag, lote)
        ok(all(x["ok"] for x in r["resultados"]), "os 10 passaram")
        ok(pag.evaluate("colunas(LIVRO.folhas['Data'], 302, 14, 26)")[1] == 5, "primeiro do lote")
        ok(pag.evaluate("colunas(LIVRO.folhas['Data'], 311, 14, 26)")[1] == 14, "ultimo do lote")

        print("\n[18] eliminar um registo")
        # regista a planta 320 e confirma que ficou escrita
        post(pag, [envio(uuid="e0", seq=320, pid="NBF(Tanheia)26-320", recorder="Cheia",
                         values={"limboFoliar": 7.5, "corFruto": "vermelho"})])
        antes = pag.evaluate("colunas(LIVRO.folhas['Data'], 322, 14, 26)")
        ok(antes[1] == 7.5 and antes[8] == "Red", f"escrita antes de eliminar ({antes[1]}, {antes[8]})")

        # desde 2026-08-12 tambem quem nao registou pode eliminar
        r = post(pag, [envio(uuid="e2", seq=320, pid="NBF(Tanheia)26-320",
                             recorder="Joana", accao="eliminar", values={})])
        res = r["resultados"][0]
        ok(res["ok"], f"a Joana elimina o registo da Cheia ({res.get('erro')})")
        vazio = pag.evaluate("colunas(LIVRO.folhas['Data'], 322, 14, 26)")
        ok(all(v == "" for v in vazio), f"as celulas do levantamento ficaram vazias ({vazio})")

        # o Log guarda o que la estava
        n = pag.evaluate("LIVRO.folhas['Log'].getLastRow()")
        ult = pag.evaluate("colunas(LIVRO.folhas['Log'], %d, 1, 39)" % n)
        ok(ult[3] == "Deletion", f"Accao = Deletion ({ult[3]})")
        ok(ult[20] == 7.5, f"o Log guardou o valor apagado ({ult[20]})")
        ok(ult[35] == "OK", f"Estado OK ({ult[35]})")

        # deixa de contar como feita e volta a poder ser registada
        j = get(pag, {"action": "estado", "mode": "descritores"})
        ok(320 not in [f[0] for f in j["feitas"]], "deixa de contar como feita")
        r = post(pag, [envio(uuid="e3", seq=320, pid="NBF(Tanheia)26-320",
                             recorder="Joana", values={"limboFoliar": 3})])
        res = r["resultados"][0]
        ok(res["ok"] and res["accao"] == "Record",
           f"depois de eliminado volta a ser um Registo novo ({res.get('accao')})")

        # eliminar o que nao existe da erro limpo
        r = post(pag, [envio(uuid="e4", seq=321, pid="NBF(Tanheia)26-321",
                             recorder="Cheia", accao="eliminar", values={})])
        ok(r["resultados"][0]["ok"] is False and "delete" in r["resultados"][0]["erro"],
           f"eliminar sem registo da erro ({r['resultados'][0].get('erro')})")

        print("\n[18b] observacoes livres")
        r = post(pag, [envio(uuid="n1", seq=330, pid="NBF(Tanheia)26-330", recorder="Cheia",
                             notas="Partida pelo vento", values={"limboFoliar": 4})])
        ok(r["resultados"][0]["ok"], "registo com observacao aceite", r["resultados"][0])
        colN = pag.evaluate("procurarColunaExtra_(LIVRO.folhas['Data'], 'notasDescritores')")
        ok(colN > 26, f"a coluna das notas foi criada no fim da folha ({colN})")
        ok(pag.evaluate("LIVRO.folhas['Data'].getRange(332, %d).getValue()" % colN)
           == "Partida pelo vento", "a observacao ficou na linha da planta")
        n = pag.evaluate("LIVRO.folhas['Log'].getLastRow()")
        ok(pag.evaluate("colunas(LIVRO.folhas['Log'], %d, 1, 39)" % n)[36] == "Partida pelo vento",
           "e tambem no Log")

        # so a observacao, sem medida nenhuma, chega para gravar
        r = post(pag, [envio(uuid="n2", seq=331, pid="NBF(Tanheia)26-331", recorder="Cheia",
                             notas="Nao encontrada", values={})])
        ok(r["resultados"][0]["ok"], "uma observacao sozinha e um registo valido",
           r["resultados"][0])
        j = get(pag, {"action": "registo", "uuid": "n1"})
        ok(j["registo"].get("notas") == "Partida pelo vento",
           f"o GET registo devolve a observacao ({j['registo'].get('notas')})")

        # eliminar limpa tambem a observacao, mas o Log guarda-a
        r = post(pag, [envio(uuid="n3", seq=330, pid="NBF(Tanheia)26-330", recorder="Cheia",
                             accao="eliminar", values={})])
        ok(r["resultados"][0]["ok"], "eliminado", r["resultados"][0])
        ok(pag.evaluate("LIVRO.folhas['Data'].getRange(332, %d).getValue()" % colN) == "",
           "a observacao saiu da folha Data")
        n = pag.evaluate("LIVRO.folhas['Log'].getLastRow()")
        ok(pag.evaluate("colunas(LIVRO.folhas['Log'], %d, 1, 39)" % n)[36] == "Partida pelo vento",
           "mas fica guardada no Log")

        print("\n[18c] marcar uma planta como morta")
        r = post(pag, [envio(uuid="m1", seq=340, pid="NBF(Tanheia)26-340", recorder="Cheia",
                             accao="morta", values={})])
        res = r["resultados"][0]
        ok(res["ok"] and res["accao"] == "Dead plant",
           f"aceite ({res.get('accao')}, {res.get('erro')})")
        colE = pag.evaluate("procurarColunaExtra_(LIVRO.folhas['Data'], 'estadoPlanta')")
        ok(pag.evaluate("LIVRO.folhas['Data'].getRange(342, %d).getValue()" % colE) == "Dead",
           "escreveu Dead na coluna do estado da planta")
        j = get(pag, {"action": "estado", "mode": "descritores"})
        ok(j.get("mortas") == [340], f"o estado devolve a lista de mortas ({j.get('mortas')})")
        ok(340 not in [f[0] for f in j["feitas"]], "uma planta morta nao conta como registada")
        j2 = get(pag, {"action": "estado", "mode": "crescimento", "ronda": "11 month (20261111)"})
        ok(j2.get("mortas") == [340], "a marca vale para os dois levantamentos")

        r = post(pag, [envio(uuid="m2", seq=340, pid="NBF(Tanheia)26-340", recorder="Joana",
                             accao="viva", values={})])
        ok(r["resultados"][0]["ok"], "desmarcar tambem passa", r["resultados"][0])
        ok(pag.evaluate("LIVRO.folhas['Data'].getRange(342, %d).getValue()" % colE) == "",
           "a celula volta a ficar vazia")
        ok(get(pag, {"action": "estado", "mode": "descritores"}).get("mortas") == [],
           "e sai da lista de mortas")

        print("\n[18d] as colunas novas nao se confundem com rondas")
        j = get(pag, {"action": "estado", "mode": "descritores"})
        ok(sorted(j["rondas"]) == ["11 month (20261111)", "5 month after planting (20260511)"],
           f"'Notes'/'Plant status' nao aparecem como rondas ({j['rondas']})")
        antes_col = pag.evaluate("LIVRO.folhas['Data'].getLastColumn()")
        r = post(pag, [envio(uuid="z1", seq=350, pid="NBF(Tanheia)26-350", mode="crescimento",
                             ronda="11 month (20261111)", values={"alturaPlanta": 1.1})])
        ok(r["resultados"][0]["ok"], "a ronda existente continua a ser reaproveitada",
           r["resultados"][0])
        ok(pag.evaluate("LIVRO.folhas['Data'].getLastColumn()") == antes_col,
           "e nao se criou nenhum bloco por engano")
        ok(pag.evaluate("colunas(LIVRO.folhas['Data'], 352, 27, 33)")[0] == 1.1,
           "escreveu no bloco da ronda certa")

        print("\n[18e] as linhas escritas em portugues ate 2026-08-14 continuam a ser lidas")
        # O Log real tem 433 linhas com 'Registo'/'Descritores (N-Z)'/'Planta morta'.
        # Escreve-se uma de cada a mao, como se tivesse vindo da versao antiga.
        pag.evaluate("""() => {
          const log = LIVRO.folhas['Log'];
          const nova = (pid, accao, levant, uuid) => {
            const l = log.getLastRow() + 1;
            const linha = new Array(39).fill('');
            linha[2] = 'Felismino'; linha[3] = accao; linha[4] = levant;
            linha[6] = pid; linha[32] = uuid; linha[35] = 'OK';
            log.getRange(l, 1, 1, 39).setValues([linha]);
          };
          nova('NBF(Tanheia)26-360', 'Registo', 'Descritores (N-Z)', 'velho-1');
          nova('NBF(Tanheia)26-361', 'Registo', 'Descritores (N-Z)', 'velho-2');
          nova('NBF(Tanheia)26-361', 'Planta morta', 'Descritores (N-Z)', 'velho-3');
          nova('NBF(Tanheia)26-362', 'Registo', 'Descritores (N-Z)', 'velho-4');
          nova('NBF(Tanheia)26-362', 'Eliminação', 'Descritores (N-Z)', 'velho-5');
          nova('NBF(Tanheia)26-363', 'Registo', 'Crescimento (G-M)', 'velho-6');
        }""")
        j = get(pag, {"action": "estado", "mode": "descritores"})
        feitas = {f[0]: f[1] for f in j["feitas"]}
        ok(feitas.get(360) == "Felismino", f"'Registo' antigo conta como feito ({feitas.get(360)})")
        ok(361 in feitas, "'Planta morta' antiga nao apaga o registo que estava")
        ok(362 not in feitas, "'Eliminação' antiga continua a apagar o registo")
        ok(363 not in feitas, "'Crescimento (G-M)' antigo nao entra nos descritores")
        j2 = get(pag, {"action": "estado", "mode": "crescimento", "ronda": ""})
        ok(363 in [f[0] for f in j2["feitas"]], "'Crescimento (G-M)' antigo entra no crescimento")
        # reenviar um uuid antigo nao pode duplicar
        r = post(pag, [envio(uuid="velho-1", seq=360, pid="NBF(Tanheia)26-360")])
        ok(r["resultados"][0].get("duplicado") is True, "o uuid de uma linha antiga e reconhecido")
        # e uma medicao nova sobre uma planta ja registada em portugues e Correction
        r = post(pag, [envio(uuid="novo-1", seq=360, pid="NBF(Tanheia)26-360",
                             values={"limboFoliar": 8})])
        ok(r["resultados"][0].get("accao") == "Correction",
           f"por cima de um 'Registo' antigo vem Correction ({r['resultados'][0].get('accao')})")

        print("\n[18f] traduzirLogParaIngles() poe as linhas antigas em ingles")
        antes = pag.evaluate("LIVRO.folhas['Log'].getLastRow()")
        pag.evaluate("traduzirLogParaIngles()")
        depois = pag.evaluate("LIVRO.folhas['Log'].getLastRow()")
        ok(antes == depois, f"nao acrescenta nem apaga linhas ({antes} -> {depois})")
        col = pag.evaluate(
            "(() => { const l = LIVRO.folhas['Log'], n = l.getLastRow();"
            " return { accoes: l.getRange(2, COL_ACCAO, n-1, 1).getValues().map(r => r[0]),"
            "          modos: l.getRange(2, COL_LEVANTAMENTO, n-1, 1).getValues().map(r => r[0]) }; })()")
        ok(not [a for a in col["accoes"] if a in ACCOES_PT],
           f"nao sobrou nenhuma accao em portugues ({[a for a in col['accoes'] if a in ACCOES_PT]})")
        ok(not [m for m in col["modos"] if m in MODOS_PT],
           f"nao sobrou nenhum levantamento em portugues ({[m for m in col['modos'] if m in MODOS_PT]})")
        ok("Record" in col["accoes"] and "Dead plant" in col["accoes"],
           "as antigas ficaram traduzidas, nao apagadas")
        ok(any(n.startswith("Log_backup_") for n in pag.evaluate("Object.keys(LIVRO.folhas)")),
           "guardou uma copia de seguranca antes de escrever")
        # e o indice continua a dar o mesmo depois de traduzir
        j3 = get(pag, {"action": "estado", "mode": "descritores"})
        f3 = {f[0]: f[1] for f in j3["feitas"]}
        ok(360 in f3 and 361 in f3 and 362 not in f3,
           "o indice le o mesmo depois da traducao")

        print("\n[18g] campos por medir: 0 nas medidas, X nas escolhas")
        # O cliente ja nao manda campos em branco — manda o que se mediu e, no
        # resto, "estive la e nao havia". Uma celula vazia passa a querer dizer
        # so uma coisa: ninguem la foi.
        r = post(pag, [envio(uuid="u-semmedida", seq=411,
                             pid="NBF(Tanheia)26-411", row="r16", noFileira=7,
                             values={"limboFoliar": 4.5,
                                     "habitoCrescimento": SEM_MEDIDA_PY,
                                     "corFruto": SEM_MEDIDA_PY,
                                     "frutoComprimento": 0})])
        ok(r["resultados"][0]["ok"], "o servidor aceita o X e o 0",
           r["resultados"][0].get("erro"))

        # colunas N..Z do Data: habito, limbo, ... , comprimento e largura do fruto
        lx = pag.evaluate("colunas(LIVRO.folhas[Chr34DataChr34], 413, 14, 26)".replace("Chr34", chr(39)))
        ok(lx[0] == SEM_MEDIDA_PY, f"o habito ficou X na folha ({lx[0]!r})")
        ok(lx[1] == 4.5, f"o que se mediu ficou como foi medido ({lx[1]!r})")
        ok(lx[8] == SEM_MEDIDA_PY, f"a cor do fruto tambem ficou X ({lx[8]!r})")
        ok(lx[9] == 0, f"a medida por fazer ficou 0 ({lx[9]!r})")

        j = get(pag, {"action": "registo", "uuid": "u-semmedida"})
        ok(j["ok"], "o registo le-se de volta", j.get("erro"))
        ok("habitoCrescimento" not in j["registo"]["values"],
           "o X volta como nada escolhido, para o ecra nao inventar uma opcao")
        ok(j["registo"]["values"].get("frutoComprimento") == 0,
           "mas o 0 volta como 0 — foi medido e deu zero")

        r = post(pag, [envio(uuid="u-corinvalida", seq=412,
                             pid="NBF(Tanheia)26-412", row="r16", noFileira=8,
                             values={"corFruto": "arco-iris"})])
        ok(not r["resultados"][0]["ok"],
           "uma escolha que nao existe continua a ser recusada")

        print("\n[19] funcao diagnostico()")
        d = pag.evaluate("diagnostico()")
        ok("doGet definido     : true" in d, "confirma que o doGet existe", d)
        ok("colunas do Log     : 39" in d, "conta as colunas do Log", d)
        ok("toda a gente corrige/elimina : true" in d, "deteta se a versao e a actual", d)
        ok("17 lotes, 415 plantas (OK)" in d, "os lotes batem certo com o total", d)
        ok("Aba Data           : 417 linhas" in d, "chega a folha Data", d)
        ok('"ok":true' in d, "o doGet responde de verdade", d)
        print("  --- saida ---")
        for linha in d.split("\n"):
            print("    " + linha[:150])

        print("\n[20] erros de JS durante os testes")
        ok(not erros, f"nenhum ({erros[:2]})")

        nav.close()

    print("\n" + "=" * 60)
    if FALHAS:
        print(f"{len(FALHAS)} FALHA(S):")
        for f in FALHAS:
            print("  - " + f)
        sys.exit(1)
    print("Codigo.gs: todos os testes passaram.")


if __name__ == "__main__":
    main()
