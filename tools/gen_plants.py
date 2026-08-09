# -*- coding: utf-8 -*-
"""Gera plants.json a partir da estrutura conhecida da folha 'Data'.

Estrutura verificada em 2026-08-08, actualizada em 2026-08-09 (398 plantas, linhas 3..400):

  * Plant ID  : NBF(Tanheia)26-001 .. -398  (contiguo, linha da folha = 2 + n)
  * Coluna B  : etiqueta de fileira (r01..r15), preenchida so na 1a planta do bloco
  * Coluna C  : "No." -- reinicia a cada LOTE DE SEMENTE, NAO a cada fileira
  * Coluna D  : "No. in row" -- posicao dentro da fileira. Inserida em 2026-08-09
                a pedido do Kaz-san; e exactamente o 'noFileira' que este script gera
  * Coluna E  : Source / lote, preenchido so na 1a planta do bloco

(fileira, No. da coluna C) NAO e unico: 323 pares unicos para 398 plantas.
O app usa 'noFileira' = posicao dentro da fileira (1..N), que e unico por construcao,
e mostra tambem 'noFolha' (coluna C) + 'source' para conferir no terreno.

ATENCAO: a insercao da coluna D empurrou as colunas de medicao de F..X para G..Y.
Este script nao escreve nessas colunas, mas o Codigo.gs sim — ver README.

O ficheiro gerado guarda so os DOIS blocos (fileiras e lotes). O app expande-os em
memoria no arranque -- 398 objectos escritos a mao ocupavam 47 kB, isto ocupa <1 kB.
"""

import json
from pathlib import Path

# (etiqueta, numero de plantas) -- soma = 398
ROW_BLOCKS = [
    ("r01", 35), ("r02", 35), ("r03", 35), ("r04", 35), ("r05", 35),
    ("r06", 35), ("r07", 35), ("r08", 35), ("r09", 35),
    ("r10", 20), ("r11", 20), ("r12", 20),
    ("r13", 10), ("r14", 10),
    ("r15", 3),
]

# (rotulo do lote, numero de plantas) -- soma = 398. Nota: nao existe "bag08".
SOURCE_BLOCKS = [
    ("India #bag01", 30), ("India #bag02", 25), ("India #bag03", 25),
    ("India #bag04", 35), ("India #bag05", 15), ("India #bag06", 25),
    ("India #bag07", 25), ("India #bag09", 20), ("India #bag10", 25),
    ("India #bag11", 15), ("India #bag12", 25), ("India #bag13", 35),
    ("India #bag14", 25), ("India #bag15", 35),
    ("India#S-2A", 20), ("India#S-2B", 15), ("India#S-4", 3),
]

TOTAL = 398
PRIMEIRA_LINHA = 3
PREFIXO = "NBF(Tanheia)26-"


def verificar():
    """Confirma que os blocos batem certo e que a chave do app e unica."""
    assert sum(n for _, n in ROW_BLOCKS) == TOTAL, "as fileiras nao somam 398"
    assert sum(n for _, n in SOURCE_BLOCKS) == TOTAL, "os lotes nao somam 398"

    chaves = set()
    seq = 0
    for label, n in ROW_BLOCKS:
        for i in range(1, n + 1):
            seq += 1
            chaves.add((label, i))
    assert len(chaves) == TOTAL, "(fileira, noFileira) nao e unico"
    return seq


def main():
    seq = verificar()
    assert seq == TOTAL

    payload = {
        "geradoEm": "2026-08-08",
        "folha": "Data",
        "spreadsheetId": "1WSfQdkMdy_cton-Za6TGzRmpSi1cjycWqHfMCS_cDXQ",
        "total": TOTAL,
        "prefixo": PREFIXO,
        "primeiraLinha": PRIMEIRA_LINHA,
        "fileiras": [{"row": r, "count": n} for r, n in ROW_BLOCKS],
        "lotes": [{"source": s, "count": n} for s, n in SOURCE_BLOCKS],
    }

    out = Path(__file__).resolve().parent.parent / "docs" / "plants.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"OK: {out}  ({out.stat().st_size:,} bytes, {TOTAL} plantas em "
          f"{len(ROW_BLOCKS)} fileiras e {len(SOURCE_BLOCKS)} lotes)")


if __name__ == "__main__":
    main()
