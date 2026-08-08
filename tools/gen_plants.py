# -*- coding: utf-8 -*-
"""Gera plants.json a partir da estrutura conhecida da folha 'Data'.

Estrutura verificada em 2026-08-08 lendo Data!A3:D400 (398 plantas, linhas 3..400):

  * Plant ID  : NBF(Tanheia)26-001 .. -398  (contiguo, linha da folha = 2 + n)
  * Coluna B  : etiqueta de fileira (r01..r15), preenchida so na 1a planta do bloco
  * Coluna C  : "No." -- reinicia a cada LOTE DE SEMENTE (coluna D), NAO a cada fileira
  * Coluna D  : Source / lote, preenchido so na 1a planta do bloco

Por isso (fileira, No. da folha) NAO e unico: 323 pares unicos para 398 plantas.
O app usa 'noFileira' = posicao dentro da fileira (1..N), que e unico por construcao,
e mostra tambem 'noFolha' + 'source' para o utilizador poder conferir no terreno.
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
FIRST_SHEET_ROW = 3
PLANT_ID_FMT = "NBF(Tanheia)26-{:03d}"


def expand(blocks):
    """[(rotulo, n), ...] -> [(rotulo, posicao_dentro_do_bloco), ...] de comprimento TOTAL."""
    out = []
    for label, n in blocks:
        for i in range(1, n + 1):
            out.append((label, i))
    return out


def main():
    rows = expand(ROW_BLOCKS)
    sources = expand(SOURCE_BLOCKS)

    assert len(rows) == TOTAL, f"fileiras somam {len(rows)}, esperado {TOTAL}"
    assert len(sources) == TOTAL, f"lotes somam {len(sources)}, esperado {TOTAL}"

    plants = []
    for idx in range(TOTAL):
        seq = idx + 1
        row_label, no_fileira = rows[idx]
        source, no_folha = sources[idx]
        plants.append({
            "seq": seq,                          # 1..398 (sufixo do Plant ID)
            "pid": PLANT_ID_FMT.format(seq),     # coluna A
            "sheetRow": FIRST_SHEET_ROW + idx,   # linha real na folha Data
            "row": row_label,                    # coluna B (preenchida por arrasto)
            "noFileira": no_fileira,             # posicao dentro da fileira -> chave do app
            "noFolha": no_folha,                 # coluna C tal como esta na folha
            "source": source,                    # coluna D (preenchida por arrasto)
        })

    # chave do app tem de ser unica
    keys = {(p["row"], p["noFileira"]) for p in plants}
    assert len(keys) == TOTAL, f"(fileira, noFileira) nao e unico: {len(keys)}/{TOTAL}"

    rows_meta = [{"row": label, "count": n} for label, n in ROW_BLOCKS]

    payload = {
        "geradoEm": "2026-08-08",
        "folha": "Data",
        "spreadsheetId": "1WSfQdkMdy_cton-Za6TGzRmpSi1cjycWqHfMCS_cDXQ",
        "total": TOTAL,
        "fileiras": rows_meta,
        "plantas": plants,
    }

    out = Path(__file__).resolve().parent.parent / "docs" / "plants.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"OK: {out}  ({out.stat().st_size:,} bytes, {TOTAL} plantas)")
    for p in (plants[0], plants[34], plants[35], plants[315], plants[-1]):
        print(f"  {p['pid']}  linha={p['sheetRow']}  {p['row']}/{p['noFileira']}"
              f"  (folha No.={p['noFolha']}, {p['source']})")


if __name__ == "__main__":
    main()
