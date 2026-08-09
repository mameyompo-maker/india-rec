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


def voltar(pag):
    """Carrega no "Voltar" do ecra que esta visivel."""
    pag.locator('.ecra:not([hidden]) [data-voltar]').first.click()
    pag.wait_for_selector("#ecraLevantamento:not([hidden])")


def entrar(pag, nome):
    pag.fill("#inpNome", nome)
    pag.click("#btnEntrar")
    pag.wait_for_selector("#ecraLevantamento:not([hidden])")


def escolher_planta(pag, fileira, numero):
    pag.locator(f'#grelhaFileiras button:has-text("{fileira}")').first.click()
    pag.locator('#teclado button[data-t="limpar"]').click()
    for d in str(numero):
        pag.locator(f'#teclado button[data-t="{d}"]').click()


def guardar(pag, esperar_dialogo=True):
    pag.click("#btnEnviar")
    if esperar_dialogo:
        pag.wait_for_selector("#dlgIncompleto[open]")
        pag.click("#btnEnviarAssim")
    pag.wait_for_selector("#ecraPlanta:not([hidden])")
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
        escolher_planta(pag, "r02", 10)
        ok("NBF(Tanheia)26-045" in pag.inner_text("#resolvidoPlanta"), "r02/10 -> -045")
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.fill("#campo_limboFoliar", "12,5")
        pag.locator('.escolha:has-text("Vertical")').click()
        guardar(pag)

        reg = log_servidor()
        ok(len(reg) == 1, f"1 registo no servidor ({len(reg)})")
        ok(reg[0]["accao"] == "Registo", f"marcado como Registo ({reg[0]['accao']})")
        ok(reg[0]["values"]["limboFoliar"] == 12.5, "virgula decimal convertida")

        print("\n[3] progresso")
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
        ok(pag.locator("#listaFileiras .linhaFileira").count() == 16, "16 barras de fileira")

        print("\n[4] correccao do proprio registo")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        escolher_planta(pag, "r02", 10)
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

        print("\n[5] registo de outra pessoa fica bloqueado")
        bater("/__semear", quem="Arlindo", pid="NBF(Tanheia)26-100", mode="descritores")
        voltar(pag)
        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)        # deixa o progresso chegar do servidor
        escolher_planta(pag, "r03", 30)
        texto = pag.inner_text("#resolvidoPlanta")
        ok("NBF(Tanheia)26-100" in texto, "r03/30 -> -100")
        ok("Arlindo" in texto and "🔒" in texto, f"mostra o cadeado com o dono ({texto.splitlines()[1][:60]})")
        ok(pag.locator("#btnPlanta").is_disabled(), "botao bloqueado para registo de outra pessoa")

        print("\n[6] historico: neste aparelho vs todos")
        voltar(pag)
        pag.click("#ligHistorico")
        pag.wait_for_selector("#ecraHistorico:not([hidden])")
        pag.wait_for_selector("#listaHistorico li", timeout=5000)
        ok(pag.locator("#listaHistorico li").count() == 2, "2 registos locais neste aparelho")

        pag.click('.aba[data-aba="todos"]')
        pag.wait_for_timeout(1200)
        itens = pag.locator("#listaHistorico li")
        ok(itens.count() == 2, f"2 registos na folha ({itens.count()})")
        ok(pag.locator("#listaHistorico li:has-text('🔒')").count() == 1,
           "o registo do Arlindo aparece com cadeado")
        pag.locator("#listaHistorico li:has-text('🔒')").click()
        pag.wait_for_timeout(400)
        ok(pag.locator("#ecraHistorico").is_visible(), "tocar no cadeado nao abre o formulario")

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
        escolher_planta(pag, "r03", 30)
        ok(not pag.locator("#btnPlanta").is_disabled(), "administrador pode abrir o registo do Arlindo")
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

        print("\n[9] sem administrador a correccao alheia e recusada")
        voltar(pag)
        pag.click("#ligTrocarNome")
        pag.click("#ligSairAdmin")
        pag.wait_for_timeout(300)
        ok(pag.locator("#crachaAdmin").is_hidden(), "saiu do modo administrador")
        entrar(pag, "Joana")

        pag.click('.cartao[data-modo="descritores"]')
        pag.wait_for_timeout(1200)
        escolher_planta(pag, "r02", 10)     # registo da Cheia
        ok(pag.locator("#btnPlanta").is_disabled(), "a Joana nao pode mexer no registo da Cheia")

        print("\n[10] saltar para a proxima por fazer")
        pag.click("#ligProximaPorFazer")
        pag.wait_for_timeout(300)
        alvo = pag.inner_text("#resolvidoPlanta")
        # procura a partir da planta actual (-045), por isso a seguinte por fazer e -046
        ok("26-046" in alvo, f"salta para a seguinte por registar ({alvo.splitlines()[0]})")
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
        escolher_planta(pag, "r03", 5)
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

        # Enter no ultimo campo grava e envia
        antes = len(log_servidor())
        pag.fill("#campo_sementeLargura", "0,9")
        pag.press("#campo_sementeLargura", "Enter")
        pag.wait_for_selector("#dlgIncompleto[open]", timeout=4000)
        pag.click("#btnEnviarAssim")
        pag.wait_for_selector("#ecraPlanta:not([hidden])")
        pag.wait_for_timeout(900)
        ok(len(log_servidor()) == antes + 1, "Enter no ultimo campo grava e envia")

        print("\n[14] serpentina e textos em portugues")
        ok("→" in pag.inner_text('#grelhaFileiras button:has-text("r03")'),
           "fileira impar indica que o n.o 1 esta a esquerda")
        ok("←" in pag.inner_text('#grelhaFileiras button:has-text("r02")'),
           "fileira par indica que o n.o 1 esta a direita")
        ok(pag.locator('#grelhaFileiras button:has-text("r16")').count() == 1,
           "a fileira r16 existe")
        escolher_planta(pag, "r02", 10)
        alvo = pag.inner_text("#resolvidoPlanta")
        ok("Índia — saco" in alvo, f"nome do lote em portugues ({alvo})")
        ok("n.º 1 à direita" in alvo, f"indica a ponta por onde comecar ({alvo})")
        ok("India #bag" not in alvo, "nao sobra ingles no ecra da planta")

        print("\n[15] service worker e erros de JS")
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
