# -*- coding: utf-8 -*-
"""Teste ponta-a-ponta do India Rec com Playwright (viewport de telemovel)."""

import json
import re
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765"
TOKEN = "TESTE-123456"
ADMIN_PW = "adm-2026"
FALHAS = []

# Lotes pela ordem da folha. O n.o de referencia e a posicao nesta lista: o
# 'India #bag01' e o 1 e o 'India#S-4' e o 17 (nao ha bag08).
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


def posicao(seq):
    """(n.o de referencia, nome curto do lote, n.o dentro do lote)."""
    acc = 0
    for i, (nome, n) in enumerate(LOTES):
        if seq <= acc + n:
            return i + 1, re.sub(r"^India\s*#\s*", "", nome), seq - acc
        acc += n
    raise ValueError(seq)


def voltar(pag, ate="#ecraLevantamento"):
    """Carrega no "Voltar" do ecra que esta visivel."""
    pag.locator('.ecra:not([hidden]) [data-voltar]').first.click()
    pag.wait_for_selector(ate + ":not([hidden])")


def entrar(pag, nome):
    pag.fill("#inpNome", nome)
    pag.click("#btnEntrar")
    pag.wait_for_selector("#ecraLevantamento:not([hidden])")


def escolher_seq(pag, seq):
    """Escolhe a planta pelo n.o de referencia e pelo numero dentro do lote."""
    _, curto, no = posicao(seq)
    pag.locator(f'#grelhaFileiras button:has-text("{curto}")').first.click()
    pag.locator('#teclado button[data-tecla="limpar"]').click()
    for d in str(no):
        pag.locator(f'#teclado button[data-tecla="{d}"]').click()


def guardar(pag, esperar_dialogo=True, destino="#ecraPlanta"):
    pag.click("#btnEnviar")
    if esperar_dialogo:
        pag.wait_for_selector("#dlgIncompleto[open]")
        pag.click("#btnEnviarAssim")
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

        print("\n[2] registo normal")
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        escolher_seq(pag, 45)                     # ref 2 (bag02), n.o 15
        alvo = pag.inner_text("#resolvidoPlanta")
        ok("NBF(Tanheia)26-045" in alvo, f"ref 2 / n.o 15 -> -045 ({alvo.splitlines()[0]})")
        ok("Fileira r02" in alvo, "a fileira aparece como informacao de apoio")
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.fill("#campo_limboFoliar", "12,5")
        pag.locator('.escolha:has-text("Vertical")').click()
        guardar(pag)

        reg = log_servidor()
        ok(len(reg) == 1, f"1 registo no servidor ({len(reg)})")
        ok(reg[0]["accao"] == "Registo", f"marcado como Registo ({reg[0]['accao']})")
        ok(reg[0]["values"]["limboFoliar"] == 12.5, "virgula decimal convertida")

        print("\n[3] progresso por n.o de referencia")
        ok("1/25" in pag.inner_text('#grelhaFileiras button:has-text("bag02")'),
           "contador do lote bag02 mostra 1/25")
        voltar(pag)
        pag.wait_for_timeout(300)
        ok("1 de 415" in pag.inner_text('[data-texto="descritores"]'),
           f"cartao mostra 1 de 415 (obtido: {pag.inner_text('[data-texto=descritores]')})")

        pag.click("#ligProgresso")
        pag.wait_for_selector("#ecraProgresso:not([hidden])")
        pag.wait_for_timeout(800)
        ok("1 / 415" in pag.inner_text("#totalProgresso"), "resumo total 1 / 415")
        ok("414 plantas por registar" in pag.inner_text("#totalProgresso"), "conta as que faltam")
        ok(pag.locator("#listaFileiras .linhaFileira").count() == 17, "17 barras, uma por lote")

        print("\n[4] correccao do proprio registo")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        escolher_seq(pag, 45)
        ok("pode corrigir" in pag.inner_text("#resolvidoPlanta"), "assinala que ja esta registada")
        ok(not pag.locator("#btnPlanta").is_disabled(), "o proprio pode abrir para corrigir")
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        ok(pag.locator("#avisoEdicao").is_visible(), "mostra o aviso de correccao")
        ok(pag.input_value("#campo_limboFoliar") == "12,5", "formulario abre preenchido")
        ok("activo" in (pag.locator('.escolha:has-text("Vertical")').first.get_attribute("class") or ""),
           "a escolha anterior aparece marcada")
        ok(pag.inner_text("#btnEnviar").strip() == "Guardar correcção", "botao muda para correccao")

        pag.fill("#campo_limboFoliar", "14")
        guardar(pag)
        reg = log_servidor()
        ok(len(reg) == 2, f"2 linhas no log ({len(reg)})")
        ok(reg[-1]["accao"] == "Correcção", f"segunda linha e Correccao ({reg[-1]['accao']})")
        ok(reg[-1]["substitui"], "guarda o ID do envio que substitui")
        ok(reg[-1]["values"]["limboFoliar"] == 14, "valor corrigido chegou")

        print("\n[5] o registo de outra pessoa tambem se pode corrigir")
        bater("/__semear", quem="Arlindo", pid="NBF(Tanheia)26-100", mode="descritores")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)        # deixa o progresso chegar do servidor
        escolher_seq(pag, 100)                    # ref 4 (bag04), n.o 20
        texto = pag.inner_text("#resolvidoPlanta")
        ok("NBF(Tanheia)26-100" in texto, "ref 4 / n.o 20 -> -100")
        ok("Arlindo" in texto, f"diz de quem e o registo ({texto.splitlines()[1][:60]})")
        ok("🔒" not in texto, "ja nao ha cadeado")
        ok(not pag.locator("#btnPlanta").is_disabled(),
           "o registo de outra pessoa abre sem modo administrador")

        print("\n[6] historico: neste aparelho vs todos")
        voltar(pag)
        pag.click("#ligHistorico")
        pag.wait_for_selector("#ecraHistorico:not([hidden])")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        ok(pag.locator("#listaHistorico li").count() == 2, "2 registos locais neste aparelho")
        ok("(India #bag02)" in pag.inner_text("#listaHistorico"),
           "a lista identifica pelo n.o de referencia")

        pag.click('.aba[data-aba="todos"]')
        pag.wait_for_timeout(1200)
        itens = pag.locator("#listaHistorico li")
        ok(itens.count() == 2, f"2 registos na folha ({itens.count()})")
        ok(pag.locator("#listaHistorico li:has-text('🔒')").count() == 0,
           "nenhum registo aparece trancado")

        print("\n[7] modo administrador")
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
        ok(pag.locator("#ligSairAdmin").is_visible(), "aparece a saida do modo administrador")

        entrar(pag, "Cheia")
        ok(pag.locator("#crachaAdmin").is_visible(),
           "o modo administrador mantem-se ao trocar de utilizador")

        print("\n[8] administrador corrige o registo de outra pessoa")
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)
        escolher_seq(pag, 100)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])", timeout=8000)
        pag.wait_for_timeout(600)
        ok(pag.input_value("#campo_limboFoliar") == "9,9",
           f"carrega os valores do servidor (obtido {pag.input_value('#campo_limboFoliar')})")
        pag.fill("#campo_limboFoliar", "10,1")
        guardar(pag)

        reg = log_servidor()
        ok(reg[-1]["estado"] == "OK", f"o servidor aceitou ({reg[-1]['estado'][:60]})")
        ok(reg[-1]["accao"] == "Correcção", "registada como correccao")
        ok(reg[-1]["recorder"] == "Cheia", "fica registado quem fez a correccao")

        print("\n[9] sem administrador a correccao alheia passa na mesma")
        voltar(pag)
        pag.click("#ligTrocarNome")
        pag.click("#ligSairAdmin")
        pag.wait_for_timeout(300)
        ok(pag.locator("#crachaAdmin").is_hidden(), "saiu do modo administrador")
        entrar(pag, "Joana")

        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)
        escolher_seq(pag, 45)               # registo da Cheia
        ok(not pag.locator("#btnPlanta").is_disabled(),
           "a Joana pode abrir o registo da Cheia")
        antes = len(log_servidor())
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])", timeout=8000)
        pag.wait_for_timeout(600)
        pag.fill("#campo_limboFoliar", "15")
        guardar(pag)
        reg = log_servidor()
        ok(len(reg) == antes + 1, "a correccao da Joana chegou ao servidor")
        ok(reg[-1]["estado"] == "OK", f"e foi aceite ({reg[-1]['estado'][:60]})")
        ok(reg[-1]["recorder"] == "Joana", "com o nome de quem corrigiu")

        print("\n[10] saltar para a proxima por fazer")
        # guardar ja tinha avancado sozinho para a seguinte do mesmo lote (-046)
        ok("26-046" in pag.inner_text("#resolvidoPlanta"),
           f"guardar avanca para a planta seguinte do lote ({pag.inner_text('#resolvidoPlanta').splitlines()[0]})")
        pag.click("#ligProximaPorFazer")
        pag.wait_for_timeout(300)
        alvo = pag.inner_text("#resolvidoPlanta")
        # procura a partir da planta actual (-046), por isso a seguinte por fazer e -047
        ok("26-047" in alvo, f"salta para a seguinte por registar ({alvo.splitlines()[0]})")
        ok("já registada" not in alvo, "a planta escolhida esta mesmo por registar")

        print("\n[11] offline: fila local e envio ao voltar a rede")
        antes = len(log_servidor())
        ctx.set_offline(True)
        pag.wait_for_timeout(300)
        ok("offline" in (pag.get_attribute("#barraEstado", "class") or ""), "barra em modo sem rede")

        for _ in range(3):
            pag.click("#btnPlanta")
            pag.wait_for_selector("#ecraFormulario:not([hidden])")
            pag.fill("#campo_limboFoliar", "11")
            pag.click("#btnEnviar")
            pag.wait_for_selector("#dlgIncompleto[open]")
            pag.click("#btnEnviarAssim")
            pag.wait_for_selector("#ecraPlanta:not([hidden])")
            pag.wait_for_timeout(250)
            pag.click("#ligProximaPorFazer")
            pag.wait_for_timeout(150)

        ok("3 por enviar" in pag.inner_text("#contadorFila"),
           f"3 pendentes (obtido {pag.inner_text('#contadorFila')})")
        ok(len(log_servidor()) == antes, "nada saiu enquanto esteve offline")

        ctx.set_offline(False)
        pag.evaluate("window.dispatchEvent(new Event('online'))")
        pag.wait_for_timeout(2500)
        ok(len(log_servidor()) == antes + 3, f"os 3 chegaram ({len(log_servidor()) - antes})")
        ok(pag.locator("#contadorFila").is_hidden(), "contador de pendentes limpo")

        print("\n[12] persistencia entre arranques")
        pag.reload()
        pag.wait_for_selector("#ecraLevantamento:not([hidden])", timeout=10000)
        ok(pag.locator("#crachaAdmin").is_hidden(), "administrador continua desligado apos recarregar")
        pag.click("#ligHistorico")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        ok(pag.locator("#listaHistorico li").count() >= 5, "historico local sobreviveu ao recarregar")

        print("\n[13] formulario em coluna unica e avanco campo a campo")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        escolher_seq(pag, 75)                     # ref 3 (bag03), n.o 20
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")

        ok(pag.locator("#camposForm .par").count() == 0, "nao ha campos lado a lado")
        largos = pag.evaluate(
            "() => { const c = document.querySelectorAll('#camposForm .linhaCampo');"
            " const t = new Set(); c.forEach(e => t.add(Math.round(e.getBoundingClientRect().left)));"
            " return t.size; }")
        ok(largos == 1, f"todos os campos comecam na mesma coluna ({largos} posicoes)")

        # Enter salta para o campo seguinte
        pag.focus("#campo_limboFoliar")
        pag.fill("#campo_limboFoliar", "11")
        pag.press("#campo_limboFoliar", "Enter")
        pag.wait_for_timeout(200)
        foco = pag.evaluate("() => document.activeElement && document.activeElement.id")
        ok(foco == "campo_peciolo", f"Enter passa ao campo seguinte ({foco})")

        # o botao ao lado faz o mesmo (o teclado numerico do telemovel nao tem Enter)
        pag.locator("#campo_peciolo ~ .seguinte, #campo_peciolo + .seguinte").first.click()
        pag.wait_for_timeout(200)
        foco = pag.evaluate("() => document.activeElement && document.activeElement.id")
        ok(foco == "campo_folhaComprimento", f"botao seguinte avanca ({foco})")

        # escolher uma cor tambem avanca
        pag.locator('#camposForm .escolhas.cores').first.locator('.escolha').first.click()
        pag.wait_for_timeout(200)
        foco = pag.evaluate("() => document.activeElement && document.activeElement.className")
        ok("escolha" in (foco or ""), f"escolher cor avanca para a cor seguinte ({foco})")

        # a caixa de observacoes fica fora da ordem de preenchimento
        ok(pag.locator("#campoNotas").count() == 1, "o formulario tem caixa de observacoes")

        # Enter no ultimo campo grava e envia
        antes = len(log_servidor())
        pag.fill("#campo_sementeLargura", "0,9")
        pag.press("#campo_sementeLargura", "Enter")
        pag.wait_for_selector("#dlgIncompleto[open]", timeout=4000)
        pag.click("#btnEnviarAssim")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        pag.wait_for_timeout(900)
        ok(len(log_servidor()) == antes + 1, "Enter no ultimo campo grava e envia")

        print("\n[14] n.os de referencia no ecra")
        botoes = pag.locator("#grelhaFileiras button")
        ok(botoes.count() == 17, f"17 n.os de referencia ({botoes.count()})")
        ok(botoes.first.inner_text().startswith("1"), "o primeiro e o n.o 1")
        ok("bag01" in botoes.first.inner_text(), "e diz que lote e")
        ok("S-4" in botoes.last.inner_text(), "o ultimo (17) e o India#S-4")
        escolher_seq(pag, 45)
        alvo = pag.inner_text("#resolvidoPlanta")
        ok("2 (India #bag02)" in alvo, f"mostra o n.o de referencia com o lote ({alvo})")
        ok("n.º 15" in alvo, "e o numero dentro do lote")
        ok("Fileira r02, n.º 10 na fileira" in alvo, f"a fileira vem por baixo ({alvo})")
        ok("n.º 1 à direita" in alvo, f"indica a ponta por onde comecar ({alvo})")

        print("\n[15] eliminar um registo, com confirmacao pelo meio")
        # a ref 3 / n.o 20 foi registada no bloco [13]; abre-a outra vez para a eliminar
        escolher_seq(pag, 75)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.wait_for_timeout(400)
        ok(pag.locator("#btnEliminar").is_visible(), "o botao de eliminar aparece num registo existente")

        pag.click("#btnEliminar")
        pag.wait_for_selector("#dlgEliminar[open]", timeout=4000)
        ok("NBF(Tanheia)26" in pag.inner_text("#textoEliminar"), "a confirmacao diz qual e a planta")
        ok(pag.locator("#listaEliminar li").count() >= 1, "a confirmacao lista o que vai desaparecer")

        # "Voltar" nao apaga nada
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
        alvo = pag.inner_text("#resolvidoPlanta")
        ok("já registada" not in alvo, f"a planta volta a contar como por registar ({alvo})")
        ok(pag.locator("#btnPlanta").is_enabled(), "e pode ser registada de novo")

        print("\n[16] observacoes livres")
        antes = len(log_servidor())
        escolher_seq(pag, 76)                     # ref 3 (bag03), n.o 21
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.fill("#campoNotas", "Partida pelo vento")
        pag.fill("#campo_limboFoliar", "9")
        guardar(pag)
        reg = log_servidor()
        ok(len(reg) == antes + 1, "o registo com observacao chegou")
        ok(reg[-1].get("notas") == "Partida pelo vento",
           f"a observacao viaja para o servidor ({reg[-1].get('notas')})")

        escolher_seq(pag, 76)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.wait_for_timeout(400)
        ok(pag.input_value("#campoNotas") == "Partida pelo vento",
           f"ao corrigir, a observacao anterior aparece ({pag.input_value('#campoNotas')})")
        pag.click("#ligTrocarPlanta")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")

        # so uma observacao, sem nenhuma medida, tambem e um registo valido
        antes = len(log_servidor())
        escolher_seq(pag, 77)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.fill("#campoNotas", "Nao encontrada no campo")
        guardar(pag)
        reg = log_servidor()
        ok(len(reg) == antes + 1 and reg[-1]["estado"] == "OK",
           "uma observacao sozinha chega para gravar")

        print("\n[17] marcar uma planta como morta")
        antes = len(log_servidor())
        escolher_seq(pag, 78)
        ok(pag.locator("#ligMorta").is_visible(), "o botao de planta morta aparece de lado")
        pag.click("#ligMorta")
        pag.wait_for_timeout(1200)
        reg = log_servidor()
        ok(len(reg) == antes + 1, "a marca chegou ao servidor")
        ok(reg[-1]["accao"] == "Planta morta", f"gravada como Planta morta ({reg[-1]['accao']})")
        ok("morta" in pag.inner_text("#resolvidoPlanta"), "o ecra assinala a planta morta")

        # nao conta como registo, mas tambem nao fica na lista do que falta fazer
        pag.click("#ligProximaPorFazer")
        pag.wait_for_timeout(300)
        ok("26-078" not in pag.inner_text("#resolvidoPlanta"),
           "a proxima por fazer salta as plantas mortas")

        escolher_seq(pag, 78)
        pag.click("#ligMorta")                    # desmarcar
        pag.wait_for_timeout(1200)
        reg = log_servidor()
        ok(reg[-1]["accao"] == "Planta viva", f"desmarcar fica registado ({reg[-1]['accao']})")
        ok("morta" not in pag.inner_text("#resolvidoPlanta"), "e a marca sai do ecra")

        print("\n[18] Voltar vai ao ecra anterior")
        voltar(pag)                                # planta -> levantamento
        pag.click("#ligHistorico")
        pag.wait_for_selector("#ecraHistorico:not([hidden])")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        pag.locator("#listaHistorico li.tocavel").first.click()
        pag.wait_for_selector("#ecraFormulario:not([hidden])", timeout=8000)
        pag.click("#ligTrocarPlanta")
        pag.wait_for_timeout(400)
        ok(pag.locator("#ecraHistorico").is_visible(),
           "quem abriu um registo pelo historico volta ao historico")

        # e guardar a correccao tambem devolve ao historico
        pag.locator("#listaHistorico li.tocavel").first.click()
        pag.wait_for_selector("#ecraFormulario:not([hidden])", timeout=8000)
        pag.wait_for_timeout(400)
        pag.fill("#campo_limboFoliar", "7")
        guardar(pag, esperar_dialogo=True, destino="#ecraHistorico")
        ok(pag.locator("#ecraHistorico").is_visible(),
           "depois de guardar a correccao volta ao historico")
        voltar(pag)

        print("\n[19] campos por preencher com o nome completo")
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        escolher_seq(pag, 79)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.fill("#campo_limboFoliar", "10")
        pag.click("#btnEnviar")
        pag.wait_for_selector("#dlgIncompleto[open]")
        lista = pag.inner_text("#listaVazios")
        ok("Comprimento da semente" in lista and "Largura do fruto" in lista,
           f"diz de que comprimento e de que largura se trata ({lista[:80]!r})")
        ok(lista.count("Comprimento\n") == 0, "nao ha 'Comprimento' solto na lista")
        pag.click("#btnVoltarPreencher")
        pag.wait_for_timeout(200)

        print("\n[20] um registo por enviar da versao ANTIGA nao se perde")
        # Isto e o caso que nao pode falhar: telemoveis que estiveram sem rede
        # tem na fila envios feitos pela versao anterior — sem 'notas', sem
        # 'accao' e com 'precisaAdmin: true', que era o que os prendia a espera
        # do modo administrador. Tem de sair na mesma, e sem administrador.
        antes = len(log_servidor())
        pag.evaluate("""() => new Promise((feito, mau) => {
          const p = indexedDB.open('indiarec', 1);
          p.onsuccess = () => {
            const tx = p.result.transaction('envios', 'readwrite');
            tx.objectStore('envios').put({
              uuid: 'antigo-1', criadoEm: 1, tsLocal: '11/08/2026 09:00:00',
              tsIso: '2026-08-11T09:00:00+02:00', estado: 'pendente',
              recorder: 'Colega', device: 'aparelho-antigo',
              mode: 'descritores', ronda: '', substitui: '',
              precisaAdmin: true,
              seq: 210, pid: 'NBF(Tanheia)26-210', row: 'r06',
              noFileira: 35, noFolha: 10, source: 'India #bag10',
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
        ok(reg[-1]["estado"] == "OK", f"e foi aceite ({reg[-1]['estado'][:60]})")
        ok(pag.locator("#contadorFila").is_hidden(), "a fila ficou vazia")

        print("\n[21] service worker e erros de JS")
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
