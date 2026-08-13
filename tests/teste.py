# -*- coding: utf-8 -*-
"""Teste ponta-a-ponta do India Rec com Playwright (viewport de telemovel)."""

import json
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765"
TOKEN = "TESTE-123456"
ADMIN_PW = "adm-2026"
FALHAS = []

# blocos de fileira, pela ordem do Data: r01..r09 = 35, r10..r12 = 20, r13..r16 = 10
FILEIRAS = ([("r%02d" % i, 35) for i in range(1, 10)] +
            [("r%02d" % i, 20) for i in range(10, 13)] +
            [("r%02d" % i, 10) for i in range(13, 17)])

# lotes (linhagens) pela ordem do Data — o n.o de referencia e a posicao aqui
LOTES = [("India #bag01", 30), ("India #bag02", 25), ("India #bag03", 25),
         ("India #bag04", 35), ("India #bag05", 15), ("India #bag06", 25),
         ("India #bag07", 25), ("India #bag09", 20), ("India #bag10", 25),
         ("India #bag11", 15), ("India #bag12", 25), ("India #bag13", 35),
         ("India #bag14", 25), ("India #bag15", 35), ("India#S-2A", 20),
         ("India#S-2B", 15), ("India#S-4", 20)]


def ok(cond, msg):
    print(("  OK   " if cond else "  FALHA") + "  " + msg)
    if not cond:
        FALHAS.append(msg)


def bater(caminho, **q):
    u = BASE + caminho + ("?" + urllib.parse.urlencode(q) if q else "")
    with urllib.request.urlopen(u) as r:
        return json.loads(r.read().decode())


def log_servidor():
    return bater("/__estado")["log"]


def _posicao(blocos, seq):
    acc = 0
    for nome, n in blocos:
        if seq <= acc + n:
            return nome, seq - acc
        acc += n
    raise ValueError(seq)


def fileira_de(seq):
    """(fileira, n.o na fileira)."""
    return _posicao(FILEIRAS, seq)


def linhagem_de(seq):
    """(n.o de referencia, nome do lote, n.o dentro do lote)."""
    nome, no = _posicao(LOTES, seq)
    return [x[0] for x in LOTES].index(nome) + 1, nome, no


def pid(seq):
    return "NBF(Tanheia)26-%03d" % seq


def voltar(pag, ate="#ecraLevantamento"):
    """Carrega no "Voltar" do ecra que esta visivel."""
    pag.locator('.ecra:not([hidden]) [data-voltar]').first.click()
    pag.wait_for_selector(ate + ":not([hidden])")


def entrar(pag, nome):
    pag.fill("#inpNome", nome)
    pag.click("#btnEntrar")
    pag.wait_for_selector("#ecraLevantamento:not([hidden])")


def escolher_seq(pag, seq):
    """Escolhe a planta pela fileira e pelo numero dentro dela."""
    fila, no = fileira_de(seq)
    pag.locator(f'#grelhaFileiras button:has-text("{fila}")').first.click()
    pag.locator('#teclado button[data-tecla="limpar"]').click()
    for d in str(no):
        pag.locator(f'#teclado button[data-tecla="{d}"]').click()


def abrir_form(pag, seq):
    escolher_seq(pag, seq)
    pag.click("#btnPlanta")
    pag.wait_for_selector("#ecraFormulario:not([hidden])")
    pag.wait_for_timeout(200)


def confirmar(pag):
    """Carrega em Guardar e passa pela confirmacao, que aparece sempre."""
    pag.click("#btnEnviar")
    pag.wait_for_selector("#dlgIncompleto[open]")
    pag.click("#btnEnviarAssim")


def guardar_ate(pag, seq_seguinte=None, destino=None):
    """Guarda e espera pelo sitio onde se deve ficar."""
    confirmar(pag)
    if seq_seguinte:
        # entra-se logo no formulario da planta seguinte da fileira
        pag.wait_for_function("p => document.getElementById('tituloForm').textContent === p",
                              arg=pid(seq_seguinte), timeout=6000)
    elif destino:
        pag.wait_for_selector(destino + ":not([hidden])")
    pag.wait_for_timeout(900)


def main():
    bater("/__reset")

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 390, "height": 844},
                              is_mobile=True, has_touch=True)
        pag = ctx.new_page()
        erros = []
        pag.on("pageerror", lambda e: erros.append(str(e)))
        pag.on("console", lambda m: erros.append("console: " + m.text) if m.type == "error" else None)

        print("\n[1] activacao e entrada")
        pag.goto(BASE + "/index.html")
        pag.wait_for_selector("#ecraActivacao:not([hidden])", timeout=10000)
        pag.fill("#inpCodigo", TOKEN)
        pag.click("#btnActivar")
        pag.wait_for_selector("#ecraEntrada:not([hidden])")
        ok(pag.locator("#blocoAdmin").is_visible(), "ecra de entrada tem o bloco de administrador")
        ok(pag.locator("#ligSairAdmin").is_hidden(), "sem sessao de administrador ao inicio")
        entrar(pag, "Cheia")
        ok("Olá, Cheia." in pag.inner_text("#ola"), "saudacao com o nome")

        print("\n[2] escolher a planta: fileira + n.o, com o 1 já posto")
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        pag.locator('#grelhaFileiras button:has-text("r02")').first.click()
        pag.wait_for_timeout(200)
        ok(pag.inner_text("#visorNumero").strip() == "1",
           f"carregar na fileira já põe o n.º 1 ({pag.inner_text('#visorNumero')!r})")
        ok(pid(36) in pag.inner_text("#resolvidoPlanta"), "r02 n.º 1 -> -036")

        escolher_seq(pag, 45)
        alvo = pag.inner_text("#resolvidoPlanta")
        ok(pid(45) in alvo, f"r02 n.º 10 -> -045 ({alvo.splitlines()[0]})")
        ok("2 (India #bag02)" in alvo, f"a linhagem aparece em destaque ({alvo!r})")
        ok("n.º 15" in alvo, "e o número dentro da linhagem")
        ok("Fileira r02, n.º 10" in alvo, "a posição na fileira também")

        print("\n[3] registo normal, com confirmação pelo meio")
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        ok("2 (India #bag02)" in pag.inner_text("#linhagemForm"),
           "o formulário também diz a linhagem")
        pag.fill("#campo_limboFoliar", "12,5")
        pag.locator('.escolha:has-text("Vertical")').click()

        pag.click("#btnEnviar")
        pag.wait_for_selector("#dlgIncompleto[open]")
        ok(pid(45) in pag.inner_text("#alvoConfirmar"), "a confirmação diz para que planta é")
        ok("12,5" in pag.inner_text("#resumoValores"), "e mostra o que vai ser gravado")
        pag.click("#btnEnviarAssim")
        pag.wait_for_function("p => document.getElementById('tituloForm').textContent === p",
                              arg=pid(46), timeout=6000)
        pag.wait_for_timeout(900)
        ok(True, "guardar entra logo no formulário da planta seguinte")

        reg = log_servidor()
        ok(len(reg) == 1, f"1 registo no servidor ({len(reg)})")
        ok(reg[0]["accao"] == "Registo", f"marcado como Registo ({reg[0]['accao']})")
        ok(reg[0]["values"]["limboFoliar"] == 12.5, "virgula decimal convertida")

        print("\n[4] progresso")
        pag.click("#ligTrocarPlanta")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        ok("1/35" in pag.inner_text('#grelhaFileiras button:has-text("r02")'),
           "contador da fileira r02 mostra 1/35")
        voltar(pag)
        pag.wait_for_timeout(300)
        ok("1 de 415" in pag.inner_text('[data-texto="descritores"]'),
           f"cartao mostra 1 de 415 (obtido: {pag.inner_text('[data-texto=descritores]')})")

        pag.click("#ligProgresso")
        pag.wait_for_selector("#ecraProgresso:not([hidden])")
        pag.wait_for_timeout(800)
        ok("1 / 415" in pag.inner_text("#totalProgresso"), "resumo total 1 / 415")
        ok("414 plantas por registar" in pag.inner_text("#totalProgresso"), "conta as que faltam")
        ok(pag.locator("#listaFileiras .linhaFileira").count() == 33,
           "16 barras por fileira + 17 por linhagem")

        print("\n[5] correccao do proprio registo")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        escolher_seq(pag, 45)
        ok("pode corrigir" in pag.inner_text("#resolvidoPlanta"), "assinala que ja esta registada")
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        ok(pag.locator("#avisoEdicao").is_visible(), "mostra o aviso de correccao")
        ok(pag.input_value("#campo_limboFoliar") == "12,5", "formulario abre preenchido")
        ok("activo" in (pag.locator('.escolha:has-text("Vertical")').first.get_attribute("class") or ""),
           "a escolha anterior aparece marcada")
        ok(pag.inner_text("#btnEnviar").strip() == "Guardar correcção", "botao muda para correccao")

        pag.fill("#campo_limboFoliar", "14")
        guardar_ate(pag, seq_seguinte=46)
        reg = log_servidor()
        ok(len(reg) == 2, f"2 linhas no log ({len(reg)})")
        ok(reg[-1]["accao"] == "Correcção", f"segunda linha e Correccao ({reg[-1]['accao']})")
        ok(reg[-1]["substitui"], "guarda o ID do envio que substitui")
        ok(reg[-1]["values"]["limboFoliar"] == 14, "valor corrigido chegou")

        print("\n[6] o registo de outra pessoa tambem se pode corrigir")
        bater("/__semear", quem="Arlindo", pid=pid(100), mode="descritores")
        pag.click("#ligTrocarPlanta")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)        # deixa o progresso chegar do servidor
        escolher_seq(pag, 100)
        texto = pag.inner_text("#resolvidoPlanta")
        ok(pid(100) in texto, "r03 n.º 30 -> -100")
        ok("Arlindo" in texto, f"diz de quem e o registo ({texto!r})")
        ok("🔒" not in texto, "ja nao ha cadeado")
        ok(not pag.locator("#btnPlanta").is_disabled(),
           "o registo de outra pessoa abre sem modo administrador")

        print("\n[7] historico: neste aparelho vs todos")
        voltar(pag)
        pag.click("#ligHistorico")
        pag.wait_for_selector("#ecraHistorico:not([hidden])")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        ok(pag.locator("#listaHistorico li").count() == 2, "2 registos locais neste aparelho")
        ok("(India #bag02)" in pag.inner_text("#listaHistorico"),
           "a lista identifica pela linhagem")

        pag.click('.aba[data-aba="todos"]')
        pag.wait_for_timeout(1200)
        ok(pag.locator("#listaHistorico li").count() == 2, "2 registos na folha")
        ok(pag.locator("#listaHistorico li:has-text('🔒')").count() == 0,
           "nenhum registo aparece trancado")

        print("\n[8] modo administrador")
        voltar(pag)
        pag.click("#ligTrocarNome")
        pag.wait_for_selector("#ecraEntrada:not([hidden])")
        pag.locator("#blocoAdmin summary").click()
        pag.fill("#inpAdmin", "errada")
        pag.click("#btnAdmin")
        pag.wait_for_timeout(1000)
        ok("errada" in pag.inner_text("#avisoAdmin").lower(), "recusa a palavra-passe errada")

        pag.fill("#inpAdmin", ADMIN_PW)
        pag.click("#btnAdmin")
        pag.wait_for_timeout(1200)
        ok(pag.locator("#crachaAdmin").is_visible(), "cracha ADMIN aparece na barra")
        entrar(pag, "Cheia")
        ok(pag.locator("#crachaAdmin").is_visible(),
           "o modo administrador mantem-se ao trocar de utilizador")

        print("\n[9] administrador corrige o registo de outra pessoa")
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)
        abrir_form(pag, 100)
        pag.wait_for_timeout(600)
        ok(pag.input_value("#campo_limboFoliar") == "9,9",
           f"carrega os valores do servidor (obtido {pag.input_value('#campo_limboFoliar')})")
        pag.fill("#campo_limboFoliar", "10,1")
        guardar_ate(pag, seq_seguinte=101)

        reg = log_servidor()
        ok(reg[-1]["estado"] == "OK", f"o servidor aceitou ({reg[-1]['estado'][:60]})")
        ok(reg[-1]["accao"] == "Correcção", "registada como correccao")
        ok(reg[-1]["recorder"] == "Cheia", "fica registado quem fez a correccao")

        print("\n[10] sem administrador a correccao alheia passa na mesma")
        pag.click("#ligTrocarPlanta")
        voltar(pag)
        pag.click("#ligTrocarNome")
        pag.click("#ligSairAdmin")
        pag.wait_for_timeout(300)
        ok(pag.locator("#crachaAdmin").is_hidden(), "saiu do modo administrador")
        entrar(pag, "Joana")

        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)
        antes = len(log_servidor())
        abrir_form(pag, 45)                 # registo da Cheia
        pag.wait_for_timeout(600)
        pag.fill("#campo_limboFoliar", "15")
        guardar_ate(pag, seq_seguinte=46)
        reg = log_servidor()
        ok(len(reg) == antes + 1, "a correccao da Joana chegou ao servidor")
        ok(reg[-1]["estado"] == "OK", f"e foi aceite ({reg[-1]['estado'][:60]})")
        ok(reg[-1]["recorder"] == "Joana", "com o nome de quem corrigiu")

        print("\n[11] andar pela fileira sem voltar ao ecra da escolha")
        # está-se no formulário de -046; grava-se e deve entrar em -047
        pag.fill("#campo_limboFoliar", "9")
        guardar_ate(pag, seq_seguinte=47)
        ok(pag.locator("#ecraFormulario").is_visible(), "continua no formulário")
        ok("2 (India #bag02)" in pag.inner_text("#linhagemForm"),
           "e a linhagem acompanha a planta")

        print("\n[12] fim da fileira volta ao ecra da escolha")
        pag.click("#ligTrocarPlanta")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        abrir_form(pag, 70)                 # r02 n.º 35, a última da fileira
        pag.fill("#campo_limboFoliar", "8")
        guardar_ate(pag, destino="#ecraPlanta")
        ok(pag.locator("#ecraPlanta").is_visible(), "no fim da fileira volta-se a escolher")

        print("\n[13] offline: fila local e envio ao voltar a rede")
        antes = len(log_servidor())
        ctx.set_offline(True)
        pag.wait_for_timeout(300)
        ok("offline" in (pag.get_attribute("#barraEstado", "class") or ""), "barra em modo sem rede")

        abrir_form(pag, 200)                # r06, longe do resto
        for i in range(3):
            pag.fill("#campo_limboFoliar", "11")
            guardar_ate(pag, seq_seguinte=201 + i)

        ok("3 por enviar" in pag.inner_text("#contadorFila"),
           f"3 pendentes (obtido {pag.inner_text('#contadorFila')})")
        ok(len(log_servidor()) == antes, "nada saiu enquanto esteve offline")

        ctx.set_offline(False)
        pag.evaluate("window.dispatchEvent(new Event('online'))")
        pag.wait_for_timeout(2500)
        ok(len(log_servidor()) == antes + 3, f"os 3 chegaram ({len(log_servidor()) - antes})")
        ok(pag.locator("#contadorFila").is_hidden(), "contador de pendentes limpo")

        print("\n[14] persistencia entre arranques")
        pag.reload()
        pag.wait_for_selector("#ecraLevantamento:not([hidden])", timeout=10000)
        ok(pag.locator("#crachaAdmin").is_hidden(), "administrador continua desligado apos recarregar")
        pag.click("#ligHistorico")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        ok(pag.locator("#listaHistorico li").count() >= 5, "historico local sobreviveu ao recarregar")

        print("\n[15] formulario em coluna unica e avanco campo a campo")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        abrir_form(pag, 75)

        ok(pag.locator("#camposForm .par").count() == 0, "nao ha campos lado a lado")
        largos = pag.evaluate(
            "() => { const c = document.querySelectorAll('#camposForm .linhaCampo');"
            " const t = new Set(); c.forEach(e => t.add(Math.round(e.getBoundingClientRect().left)));"
            " return t.size; }")
        ok(largos == 1, f"todos os campos comecam na mesma coluna ({largos} posicoes)")

        pag.focus("#campo_limboFoliar")
        pag.fill("#campo_limboFoliar", "11")
        pag.press("#campo_limboFoliar", "Enter")
        pag.wait_for_timeout(200)
        foco = pag.evaluate("() => document.activeElement && document.activeElement.id")
        ok(foco == "campo_peciolo", f"Enter passa ao campo seguinte ({foco})")

        pag.locator("#campo_peciolo ~ .seguinte, #campo_peciolo + .seguinte").first.click()
        pag.wait_for_timeout(200)
        foco = pag.evaluate("() => document.activeElement && document.activeElement.id")
        ok(foco == "campo_folhaComprimento", f"botao seguinte avanca ({foco})")

        pag.locator('#camposForm .escolhas.cores').first.locator('.escolha').first.click()
        pag.wait_for_timeout(200)
        foco = pag.evaluate("() => document.activeElement && document.activeElement.className")
        ok("escolha" in (foco or ""), f"escolher cor avanca para a cor seguinte ({foco})")
        ok(pag.locator("#campoNotas").count() == 1, "o formulario tem caixa de observacoes")

        antes = len(log_servidor())
        pag.fill("#campo_sementeLargura", "0,9")
        pag.press("#campo_sementeLargura", "Enter")
        pag.wait_for_selector("#dlgIncompleto[open]", timeout=4000)
        pag.click("#btnEnviarAssim")
        pag.wait_for_timeout(900)
        ok(len(log_servidor()) == antes + 1, "Enter no ultimo campo grava e envia")

        print("\n[16] o ecra da planta cabe todo sem rolar")
        pag.click("#ligTrocarPlanta")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        pag.wait_for_timeout(300)
        rola = pag.evaluate("() => document.documentElement.scrollHeight - window.innerHeight")
        ok(rola <= 0, f"nada por baixo da dobra ({rola} px a mais)")
        ok(pag.locator("#btnPlanta").is_visible(), "o Continuar está à vista sem arrastar")
        ok(pag.locator("#grelhaFileiras button").count() == 16, "16 fileiras na grelha")

        print("\n[17] eliminar um registo, com confirmacao pelo meio")
        abrir_form(pag, 75)
        ok(pag.locator("#btnEliminar").is_visible(), "o botao de eliminar aparece num registo existente")
        pag.click("#btnEliminar")
        pag.wait_for_selector("#dlgEliminar[open]", timeout=4000)
        ok("NBF(Tanheia)26" in pag.inner_text("#textoEliminar"), "a confirmacao diz qual e a planta")
        ok(pag.locator("#listaEliminar li").count() >= 1, "a confirmacao lista o que vai desaparecer")

        antes = len(log_servidor())
        pag.click("#btnNaoEliminar")
        pag.wait_for_timeout(400)
        ok(len(log_servidor()) == antes, "carregar em Voltar nao envia nada")

        pag.click("#btnEliminar")
        pag.wait_for_selector("#dlgEliminar[open]")
        pag.click("#btnConfirmarEliminar")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        pag.wait_for_timeout(1000)
        reg = log_servidor()
        ok(len(reg) == antes + 1, f"a eliminacao chegou ao servidor ({len(reg)})")
        ok(reg[-1]["accao"] == "Eliminação", f"gravada como Eliminação ({reg[-1]['accao']})")
        escolher_seq(pag, 75)
        ok("já registada" not in pag.inner_text("#resolvidoPlanta"),
           "a planta volta a contar como por registar")

        print("\n[18] observacoes livres")
        antes = len(log_servidor())
        abrir_form(pag, 76)
        pag.fill("#campoNotas", "Partida pelo vento")
        pag.fill("#campo_limboFoliar", "9")
        guardar_ate(pag, seq_seguinte=77)
        reg = log_servidor()
        ok(len(reg) == antes + 1, "o registo com observacao chegou")
        ok(reg[-1].get("notas") == "Partida pelo vento",
           f"a observacao viaja para o servidor ({reg[-1].get('notas')})")

        pag.click("#ligTrocarPlanta")
        abrir_form(pag, 76)
        ok(pag.input_value("#campoNotas") == "Partida pelo vento",
           f"ao corrigir, a observacao anterior aparece ({pag.input_value('#campoNotas')})")

        antes = len(log_servidor())
        pag.fill("#campoNotas", "Nao encontrada no campo")
        guardar_ate(pag, seq_seguinte=77)
        reg = log_servidor()
        ok(len(reg) == antes + 1 and reg[-1]["estado"] == "OK",
           "uma observacao sozinha chega para gravar")

        print("\n[19] a confirmacao pergunta primeiro pelo que a planta nao tem")
        pag.fill("#campo_limboFoliar", "10")
        pag.click("#btnEnviar")
        pag.wait_for_selector("#dlgIncompleto[open]")
        sem = pag.inner_text("#semObjectos")
        ok("fruto" in sem, f"pergunta se a planta não tem fruto ({sem!r})")
        ok("semente" in sem, "e se não tem semente")
        ok("flor masculina" in sem and "flor feminina" in sem, "e pelas flores, separadamente")
        ok("folha" not in sem, "a folha, que foi medida, não aparece na pergunta")
        # a lista dos campos fica recolhida: primeiro a pergunta, o detalhe só a pedido
        ok(pag.locator("#listaVazios").is_hidden(), "a lista dos campos começa fechada")
        pag.locator("#detalheVazios summary").click()
        lista = pag.inner_text("#listaVazios")
        ok("Comprimento da semente" in lista and "Largura do fruto" in lista,
           f"e ao abrir traz o nome completo de cada campo ({lista[:60]!r})")
        pag.click("#btnVoltarPreencher")
        pag.wait_for_timeout(200)
        ok(pag.locator("#ecraFormulario").is_visible(), "Corrigir volta ao formulário sem gravar")

        print("\n[20] marcar uma planta como morta")
        pag.click("#ligTrocarPlanta")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        antes = len(log_servidor())
        escolher_seq(pag, 78)
        ok(pag.locator("#ligMorta").is_visible(), "o botao de planta morta aparece de lado")
        pag.click("#ligMorta")
        pag.wait_for_timeout(1200)
        reg = log_servidor()
        ok(len(reg) == antes + 1, "a marca chegou ao servidor")
        ok(reg[-1]["accao"] == "Planta morta", f"gravada como Planta morta ({reg[-1]['accao']})")
        ok("morta" in pag.inner_text("#resolvidoPlanta"), "o ecra assinala a planta morta")

        pag.click("#ligProximaPorFazer")
        pag.wait_for_timeout(300)
        ok(pid(78) not in pag.inner_text("#resolvidoPlanta"),
           "a proxima por fazer salta as plantas mortas")

        escolher_seq(pag, 78)
        pag.click("#ligMorta")
        pag.wait_for_timeout(1200)
        reg = log_servidor()
        ok(reg[-1]["accao"] == "Planta viva", f"desmarcar fica registado ({reg[-1]['accao']})")

        print("\n[21] Voltar vai ao ecra anterior")
        voltar(pag)
        pag.click("#ligHistorico")
        pag.wait_for_selector("#ecraHistorico:not([hidden])")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        pag.locator("#listaHistorico li.tocavel").first.click()
        pag.wait_for_selector("#ecraFormulario:not([hidden])", timeout=8000)
        pag.click("#ligTrocarPlanta")
        pag.wait_for_timeout(400)
        ok(pag.locator("#ecraHistorico").is_visible(),
           "quem abriu um registo pelo historico volta ao historico")

        pag.locator("#listaHistorico li.tocavel").first.click()
        pag.wait_for_selector("#ecraFormulario:not([hidden])", timeout=8000)
        pag.wait_for_timeout(400)
        pag.fill("#campo_limboFoliar", "7")
        guardar_ate(pag, destino="#ecraHistorico")
        ok(pag.locator("#ecraHistorico").is_visible(),
           "depois de guardar a correccao volta ao historico")

        print("\n[22] um registo por enviar da versao ANTIGA nao se perde")
        # Telemoveis que estiveram sem rede tem na fila envios da versao
        # anterior — sem 'notas', sem 'accao' e com 'precisaAdmin: true', que
        # era o que os prendia a espera do modo administrador.
        antes = len(log_servidor())
        pag.evaluate("""() => new Promise((feito, mau) => {
          const p = indexedDB.open('indiarec', 2);
          p.onsuccess = () => {
            const tx = p.result.transaction('envios', 'readwrite');
            tx.objectStore('envios').put({
              uuid: 'antigo-1', criadoEm: 1, tsLocal: '11/08/2026 09:00:00',
              tsIso: '2026-08-11T09:00:00+02:00', estado: 'pendente',
              recorder: 'Colega', device: 'aparelho-antigo',
              mode: 'descritores', ronda: '', substitui: '',
              precisaAdmin: true,
              seq: 310, pid: 'NBF(Tanheia)26-310', row: 'r09',
              noFileira: 30, noFolha: 10, source: 'India #bag13',
              values: { limboFoliar: 6.5 }
            });
            tx.oncomplete = () => feito(1);
            tx.onerror = () => mau(tx.error);
          };
          p.onerror = () => mau(p.error);
        })""")
        ok(pag.locator("#crachaAdmin").is_hidden(), "e isto sem modo administrador ligado")
        pag.evaluate("enviarFila()")
        pag.wait_for_timeout(2500)
        reg = log_servidor()
        ok(len(reg) == antes + 1, f"o envio antigo chegou ao servidor ({len(reg) - antes})")
        ok(reg[-1]["uuid"] == "antigo-1" and reg[-1]["recorder"] == "Colega",
           f"com os dados que tinha ({reg[-1]['uuid']}, {reg[-1]['recorder']})")
        ok(pag.locator("#contadorFila").is_hidden(), "a fila ficou vazia")

        print("\n[23] o service worker sabe enviar sozinho")
        # o que faz funcionar "100 plantas sem rede e mandar tudo a chegada":
        # a configuracao tem de estar na base para o SW a poder ler
        cfg = pag.evaluate("""() => new Promise(feito => {
          const p = indexedDB.open('indiarec', 2);
          p.onsuccess = () => {
            const tx = p.result.transaction('config', 'readonly');
            const r = tx.objectStore('config').getAll();
            tx.oncomplete = () => feito(r.result.map(x => x.chave).sort());
          };
        })""")
        ok(cfg == ["endpoint", "token"], f"endpoint e codigo guardados para o SW ({cfg})")
        ok(pag.evaluate("() => 'sync' in window.ServiceWorkerRegistration.prototype") is True,
           "o browser tem Background Sync")

        # O envio no service worker e uma SEGUNDA copia da logica do app.js.
        # Aqui poe-se um registo na fila e acorda-se so o service worker: se
        # chegar ao servidor, e porque foi ele a manda-lo.
        antes = len(log_servidor())
        pag.evaluate("""() => new Promise((feito, mau) => {
          const p = indexedDB.open('indiarec', 2);
          p.onsuccess = () => {
            const tx = p.result.transaction('envios', 'readwrite');
            tx.objectStore('envios').put({
              uuid: 'so-pelo-sw', criadoEm: 2, tsLocal: '14/08/2026 07:00:00',
              tsIso: '2026-08-14T07:00:00+02:00', estado: 'pendente',
              recorder: 'Cheia', device: 'aparelho-sw',
              mode: 'descritores', ronda: '', substitui: '', accao: '',
              seq: 260, pid: 'NBF(Tanheia)26-260', row: 'r08',
              noFileira: 15, noFolha: 20, source: 'India #bag12',
              notas: 'enviado pelo service worker',
              values: { limboFoliar: 4.25 }
            });
            tx.oncomplete = () => feito(1);
            tx.onerror = () => mau(tx.error);
          };
          p.onerror = () => mau(p.error);
        })""")
        pag.evaluate("() => navigator.serviceWorker.controller.postMessage({tipo: 'enviar'})")
        pag.wait_for_timeout(3000)
        reg = log_servidor()
        ok(len(reg) == antes + 1, f"o service worker enviou sozinho ({len(reg) - antes})")
        ok(reg[-1]["uuid"] == "so-pelo-sw" and reg[-1].get("notas") == "enviado pelo service worker",
           f"com tudo o que o registo tinha ({reg[-1]['uuid']}, {reg[-1].get('notas')!r})")
        marcado = pag.evaluate("""() => new Promise(feito => {
          const p = indexedDB.open('indiarec', 2);
          p.onsuccess = () => {
            const tx = p.result.transaction('envios', 'readonly');
            const r = tx.objectStore('envios').get('so-pelo-sw');
            tx.oncomplete = () => feito(r.result && r.result.estado);
          };
        })""")
        ok(marcado == "enviado", f"e marcou-o como enviado na fila ({marcado})")

        print("\n[24] quando a fila nao sobe, o ecra diz porque")
        # O caso de 13 de Agosto: o codigo de activacao estava errado, o
        # servidor respondia "Nao autorizado" e a aplicacao nao dizia nada —
        # 13 registos ficaram parados sem ninguem perceber porque.
        antes = len(log_servidor())
        pag.evaluate("""() => new Promise((feito, mau) => {
          const p = indexedDB.open('indiarec', 2);
          p.onsuccess = () => {
            const tx = p.result.transaction('envios', 'readwrite');
            tx.objectStore('envios').put({
              uuid: 'com-codigo-errado', criadoEm: 3, tsLocal: '14/08/2026 09:00:00',
              tsIso: '2026-08-14T09:00:00+02:00', estado: 'pendente',
              recorder: 'Cheia', device: 'aparelho-1',
              mode: 'descritores', ronda: '', substitui: '', accao: '',
              seq: 300, pid: 'NBF(Tanheia)26-300', row: 'r09',
              noFileira: 20, noFolha: 15, source: 'India #bag13',
              values: { limboFoliar: 5.5 }
            });
            tx.oncomplete = () => feito(1);
            tx.onerror = () => mau(tx.error);
          };
          p.onerror = () => mau(p.error);
        })""")
        certo = pag.evaluate("() => Def.get('token', '')")
        pag.evaluate("() => Def.set('token', 'CODIGO-ERRADO')")
        pag.evaluate("enviarFila()")
        pag.wait_for_timeout(2500)
        ok(len(log_servidor()) == antes, "o servidor recusou e nada foi gravado")

        pag.evaluate("irParaLevantamento()")
        pag.wait_for_selector("#ecraLevantamento:not([hidden])")
        pag.click("#ligHistorico")
        pag.wait_for_selector("#ecraHistorico:not([hidden])")
        ok(not pag.locator("#avisoEnvio").is_hidden(), "o aviso do envio aparece")
        aviso = pag.inner_text("#avisoEnvio")
        ok("código de activação" in aviso, f"e diz que o problema e o codigo ({aviso!r})")

        pag.evaluate("(t) => Def.set('token', t)", certo)
        pag.evaluate("forcarEnvio()")
        pag.wait_for_timeout(2500)
        ok(len(log_servidor()) == antes + 1, "com o codigo certo o registo sobe")
        pag.evaluate("desenharHistorico()")
        desapareceu = pag.inner_text("#avisoEnvio")
        ok("código de activação" not in desapareceu,
           f"e o aviso deixa de acusar o codigo ({desapareceu!r})")
        voltar(pag)

        print("\n[25] service worker e erros de JS")
        ok(pag.evaluate("navigator.serviceWorker.controller ? 1 : 0") == 1, "service worker activo")
        reais = [e for e in erros if "favicon" not in e.lower()]
        ok(not reais, f"sem erros de JS ({reais[:3]})")

        nav.close()

    print("\n" + "=" * 56)
    if FALHAS:
        print(f"{len(FALHAS)} FALHA(S):")
        for f in FALHAS:
            print("  - " + f)
        sys.exit(1)
    print("Todos os testes passaram.")


if __name__ == "__main__":
    main()
