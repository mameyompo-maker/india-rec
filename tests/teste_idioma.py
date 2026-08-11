# -*- coding: utf-8 -*-
"""India Rec: troca de idioma (PT/EN/日本語) e sinal decimal.

O que se quer garantir:
  1. o ecra muda mesmo de lingua, e a escolha sobrevive a um recarregamento;
  2. o sinal decimal do ecra segue a lingua (1,5 em portugues / 1.5 nas outras);
  3. a leitura aceita sempre virgula E ponto, seja qual for a lingua;
  4. nada disto muda o que sai para o servidor — os valores continuam iguais.

Precisa do servidor mock a correr:
    Start-Process python -ArgumentList "tests\\servidor.py","<docs>","8765" -WindowStyle Hidden
    python tests\\teste_idioma.py
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765"
TOKEN = "TESTE-123456"
FALHAS = []

# lotes pela ordem da folha — o n.o de referencia e a posicao nesta lista
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


def idioma(pag, rotulo):
    """Carrega no botao de idioma. So existe nos ecras de entrada."""
    pag.locator(f'#idiomas button:has-text("{rotulo}")').click()
    pag.wait_for_timeout(120)


def entrar(pag, nome):
    pag.fill("#inpNome", nome)
    pag.click("#btnEntrar")
    pag.wait_for_selector("#ecraLevantamento:not([hidden])")


def escolher_seq(pag, seq):
    """Escolhe a planta pelo n.o de referencia e pelo numero dentro do lote."""
    acc = 0
    for nome, n in LOTES:
        if seq <= acc + n:
            curto, no = re.sub(r"^India\s*#\s*", "", nome), seq - acc
            break
        acc += n
    pag.locator(f'#grelhaFileiras button:has-text("{curto}")').first.click()
    pag.locator('#teclado button[data-tecla="limpar"]').click()
    for d in str(no):
        pag.locator(f'#teclado button[data-tecla="{d}"]').click()


def guardar(pag):
    pag.click("#btnEnviar")
    pag.wait_for_selector("#dlgIncompleto[open]")
    pag.click("#btnEnviarAssim")
    pag.wait_for_selector("#ecraPlanta:not([hidden])")
    pag.wait_for_timeout(900)


def ir_ao_formulario(pag, seq):
    pag.click('.cartao[data-modo="descritores"]')
    pag.wait_for_selector("#ecraPlanta:not([hidden])")
    escolher_seq(pag, seq)
    pag.click("#btnPlanta")
    pag.wait_for_selector("#ecraFormulario:not([hidden])")


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

        print("\n[1] os botoes de idioma estao no sitio certo")
        pag.goto(BASE + "/index.html")
        pag.wait_for_selector("#ecraActivacao:not([hidden])", timeout=10000)
        ok(pag.locator("#idiomas").is_visible(), "aparecem no ecra de activacao")
        ok(pag.locator('#idiomas button').count() == 3, "sao tres (PT / EN / 日本語)")
        ok("activo" in (pag.locator('#idiomas button').first.get_attribute("class") or ""),
           "o portugues comeca seleccionado")

        print("\n[2] a lingua muda mesmo")
        idioma(pag, "EN")
        ok(pag.inner_text("#ecraActivacao h1") == "Activate this phone", "activacao em ingles")
        ok(pag.get_attribute("html", "lang") == "en", "html lang=en (evita a traducao do Chrome)")
        idioma(pag, "日本語")
        ok(pag.inner_text("#ecraActivacao h1") == "この端末を有効にする", "activacao em japones")
        ok(pag.get_attribute("html", "lang") == "ja", "html lang=ja")
        idioma(pag, "PT")
        ok(pag.inner_text("#ecraActivacao h1") == "Activar aparelho", "volta ao portugues")

        print("\n[3] a escolha sobrevive ao recarregamento")
        idioma(pag, "EN")
        pag.fill("#inpCodigo", TOKEN)
        pag.click("#btnActivar")
        pag.wait_for_selector("#ecraEntrada:not([hidden])")
        ok(pag.inner_text('label[for="inpNome"]') == "Your name", "ecra de entrada em ingles")
        pag.reload()
        pag.wait_for_selector("#ecraEntrada:not([hidden])", timeout=10000)
        ok(pag.inner_text('label[for="inpNome"]') == "Your name", "continua em ingles apos recarregar")

        print("\n[4] o texto dinamico tambem muda")
        entrar(pag, "Cheia")
        ok(pag.inner_text("#ola") == "Hello, Cheia.", "saudacao em ingles")
        ok(pag.locator("#idiomas").is_visible(), "os botoes ainda aparecem no ecra do levantamento")
        idioma(pag, "日本語")
        ok(pag.inner_text("#ola") == "こんにちは、Cheiaさん。", "saudacao em japones sem sair do ecra")
        idioma(pag, "PT")
        ok(pag.inner_text("#ola") == "Olá, Cheia.", "saudacao em portugues")

        print("\n[5] os botoes desaparecem durante o trabalho")
        ir_ao_formulario(pag, 45)
        ok(pag.locator("#idiomas").is_hidden(), "escondidos no formulario")

        print("\n[6] portugues: virgula e ponto dao o mesmo numero")
        pag.fill("#campo_limboFoliar", "12,5")
        pag.fill("#campo_peciolo", "3.25")
        guardar(pag)
        reg = bater("/__estado")["log"]
        ok(len(reg) == 1, f"1 registo no servidor ({len(reg)})")
        ok(reg[0]["values"]["limboFoliar"] == 12.5, "12,5 -> 12.5")
        ok(reg[0]["values"]["peciolo"] == 3.25, "3.25 -> 3.25 (ponto aceite em portugues)")

        print("\n[7] o ecra mostra o sinal decimal da lingua")
        escolher_seq(pag, 45)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        ok(pag.input_value("#campo_limboFoliar") == "12,5", "portugues mostra 12,5")
        pag.click("#ligTrocarPlanta")
        pag.locator('.ecra:not([hidden]) [data-voltar]').first.click()
        pag.wait_for_selector("#ecraLevantamento:not([hidden])")
        idioma(pag, "EN")
        ir_ao_formulario(pag, 45)
        ok(pag.input_value("#campo_limboFoliar") == "12.5", "ingles mostra 12.5")
        ok(pag.inner_text('label[for="campo_limboFoliar"]').startswith("Leaf blade"),
           "as etiquetas dos campos tambem traduzem")

        print("\n[8] ingles/japones: a virgula continua a ser aceite")
        pag.fill("#campo_folhaComprimento", "7,75")
        guardar(pag)
        reg = bater("/__estado")["log"]
        ok(len(reg) == 2, f"2 registos no servidor ({len(reg)})")
        ok(reg[1]["values"]["folhaComprimento"] == 7.75, "7,75 -> 7.75 com o ecra em ingles")

        print("\n[9] em japones o valor que sai e o mesmo")
        pag.locator('.ecra:not([hidden]) [data-voltar]').first.click()
        pag.wait_for_selector("#ecraLevantamento:not([hidden])")
        idioma(pag, "日本語")
        ir_ao_formulario(pag, 77)
        ok(pag.inner_text('label[for="campo_limboFoliar"]').startswith("葉身"),
           "etiquetas em japones")
        pag.fill("#campo_limboFoliar", "8,5")
        pag.locator('.escolha:has-text("垂直")').click()
        guardar(pag)
        reg = bater("/__estado")["log"]
        ok(len(reg) == 3, f"3 registos no servidor ({len(reg)})")
        ok(reg[2]["values"]["limboFoliar"] == 8.5, "8,5 -> 8.5 com o ecra em japones")
        ok(reg[2]["values"]["habitoCrescimento"] == "vertical",
           f"a chave enviada continua em ingles ({reg[2]['values'].get('habitoCrescimento')})")

        print("\n[10] numeros de largura total (teclado japones)")
        escolher_seq(pag, 78)
        pag.click("#btnPlanta")
        pag.wait_for_selector("#ecraFormulario:not([hidden])")
        pag.fill("#campo_limboFoliar", "１，５")
        guardar(pag)
        reg = bater("/__estado")["log"]
        ok(reg[3]["values"]["limboFoliar"] == 1.5, "１，５ -> 1.5")

        print("\n[11] sem erros de JS")
        ok(not erros, f"sem erros de JS ({erros})")

        nav.close()

    print("\n" + "=" * 56)
    if FALHAS:
        print(f"{len(FALHAS)} falha(s):")
        for f in FALHAS:
            print("  -", f)
        sys.exit(1)
    print("Todos os testes de idioma passaram.")


if __name__ == "__main__":
    main()
