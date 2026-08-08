# -*- coding: utf-8 -*-
"""Gera os icones do JatMed: uma folha de Jatropha (5 lobos) sobre fundo escuro."""

import math
from pathlib import Path
from PIL import Image, ImageDraw

FUNDO = (18, 20, 15)
FOLHA = (124, 179, 66)
FOLHA_ESC = (85, 139, 47)
NERVURA = (35, 52, 20)
PECIOLO = (109, 138, 62)

SS = 4  # supersampling


def lobo(d, cx, cy, ang, comp, larg, cor):
    """Desenha um lobo (petala) como poligono simetrico em torno do angulo dado."""
    pts = []
    passos = 26
    for i in range(passos + 1):
        t = i / passos
        # largura maxima a ~40% do comprimento, ponta afilada
        w = larg * math.sin(math.pi * t) * (1.0 - 0.35 * t)
        r = comp * t
        px = cx + r * math.cos(ang) - w * math.sin(ang)
        py = cy + r * math.sin(ang) + w * math.cos(ang)
        pts.append((px, py))
    for i in range(passos, -1, -1):
        t = i / passos
        w = larg * math.sin(math.pi * t) * (1.0 - 0.35 * t)
        r = comp * t
        px = cx + r * math.cos(ang) + w * math.sin(ang)
        py = cy + r * math.sin(ang) - w * math.cos(ang)
        pts.append((px, py))
    d.polygon(pts, fill=cor)


def desenhar(tamanho, margem_rel=0.16, raio_rel=0.22, fundo=FUNDO):
    n = tamanho * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * raio_rel), fill=fundo)

    cx, cy = n / 2, n / 2 + n * 0.06
    comp = n * (0.5 - margem_rel)
    larg = comp * 0.30

    # peciolo
    d.line([(cx, cy), (cx, cy + n * 0.30)], fill=PECIOLO, width=int(n * 0.035))

    # 5 lobos, abertos para cima
    angulos = [-math.pi / 2 + a for a in (-1.30, -0.66, 0.0, 0.66, 1.30)]
    for i, a in enumerate(angulos):
        c = comp * (1.0 if i == 2 else (0.90 if i in (1, 3) else 0.74))
        lobo(d, cx, cy, a, c, larg * (1.0 if i == 2 else 0.88), FOLHA_ESC)

    for i, a in enumerate(angulos):
        c = comp * (1.0 if i == 2 else (0.90 if i in (1, 3) else 0.74))
        lobo(d, cx, cy, a, c * 0.93, larg * (0.92 if i == 2 else 0.80), FOLHA)

    # nervuras
    for i, a in enumerate(angulos):
        c = comp * (1.0 if i == 2 else (0.90 if i in (1, 3) else 0.74)) * 0.80
        d.line([(cx, cy), (cx + c * math.cos(a), cy + c * math.sin(a))],
               fill=NERVURA, width=max(1, int(n * 0.014)))

    return img.resize((tamanho, tamanho), Image.LANCZOS)


def main():
    saida = Path(__file__).resolve().parent.parent / 'docs'
    saida.mkdir(parents=True, exist_ok=True)

    for nome, tam, kw in [
        ('icon-192.png', 192, {}),
        ('icon-512.png', 512, {}),
        ('icon-180.png', 180, {'raio_rel': 0.0}),          # iOS aplica a mascara sozinho
        ('icon-512-maskable.png', 512, {'margem_rel': 0.28, 'raio_rel': 0.0}),
        ('favicon.png', 64, {}),
    ]:
        img = desenhar(tam, **kw)
        img.convert('RGB').save(saida / nome, 'PNG', optimize=True)
        print(f'  {nome:26s} {(saida / nome).stat().st_size:>7,} bytes')


if __name__ == '__main__':
    main()
