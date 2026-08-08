# -*- coding: utf-8 -*-
"""Gera os icones do India Rec a partir do logotipo fornecido pelo Kaz.

O ficheiro de origem (`logo_source.png`) tem a marca em cima e o texto
"Seed Weight" em baixo. So a marca e aproveitada: o texto e cortado e a
marca e recentrada sobre o fundo escuro da aplicacao.
"""

from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / 'tools' / 'logo_source.png'
SAIDA = RAIZ / 'docs'

FUNDO = (18, 20, 15)          # --bg da aplicacao
LIMIAR = 28                   # acima disto deixa de ser "preto de fundo"
CORTE_TEXTO = 0.635           # fraccao da altura a partir da qual comeca "Seed Weight"
SS = 2                        # supersampling ao compor


def marca():
    """Devolve a marca recortada, em RGBA com fundo transparente."""
    img = Image.open(ORIGEM).convert('RGB')
    larg, alt = img.size
    topo = img.crop((0, 0, larg, int(alt * CORTE_TEXTO)))

    # mascara do que nao e fundo preto
    cinza = topo.convert('L')
    mascara = cinza.point(lambda v: 255 if v > LIMIAR else 0)
    caixa = mascara.getbbox()
    if caixa is None:
        raise SystemExit('nao encontrei a marca no logotipo')

    recorte = topo.crop(caixa)
    recorte.putalpha(mascara.crop(caixa))

    # quadrado, mantendo a proporcao
    lado = max(recorte.size)
    quadrado = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    quadrado.paste(recorte,
                   ((lado - recorte.width) // 2, (lado - recorte.height) // 2),
                   recorte)
    return quadrado


def compor(base, tamanho, margem=0.14, raio=0.22):
    n = tamanho * SS
    fundo = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(fundo)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * raio), fill=FUNDO + (255,))

    interior = int(n * (1 - 2 * margem))
    m = base.resize((interior, interior), Image.LANCZOS)
    desvio = (n - interior) // 2
    fundo.paste(m, (desvio, desvio), m)
    return fundo.resize((tamanho, tamanho), Image.LANCZOS)


def main():
    base = marca()
    print(f'  marca recortada: {base.size[0]}x{base.size[1]}')

    for nome, tam, kw in [
        ('icon-192.png', 192, {}),
        ('icon-512.png', 512, {}),
        ('icon-180.png', 180, {'raio': 0.0}),                    # o iOS aplica a mascara
        ('icon-512-maskable.png', 512, {'margem': 0.26, 'raio': 0.0}),
        ('favicon.png', 64, {'margem': 0.08}),
    ]:
        img = compor(base, tam, **kw)
        img.convert('RGB').save(SAIDA / nome, 'PNG', optimize=True)
        print(f'  {nome:26s} {(SAIDA / nome).stat().st_size:>7,} bytes')


if __name__ == '__main__':
    main()
