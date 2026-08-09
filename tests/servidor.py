# -*- coding: utf-8 -*-
"""Servidor de teste: serve docs/ e imita o endpoint do Apps Script.

Reproduz a logica do Codigo.gs que interessa testar:
  - token obrigatorio; ADMIN_PASSWORD separado
  - deduplicacao por uuid
  - so escreve campos preenchidos
  - so o dono (ou um admin) corrige um registo ja existente
  - GET action=estado / historico / registo / admin
"""

import json
import sys
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

DOCS = Path(sys.argv[1]).resolve()
PORTA = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
TOKEN = "TESTE-123456"
ADMIN_PW = "adm-2026"

COLS_CRESC = ["alturaPlanta", "cnp1", "cnp2", "cachosFrutos", "cachosFlores", "cachosBotoes"]
COLS_DESCR = ["habitoCrescimento", "limboFoliar", "peciolo", "folhaComprimento",
              "folhaLargura", "lobulosFolha", "corInflorMasc", "corInflorFem",
              "corFruto", "frutoComprimento", "frutoLargura", "sementeComprimento",
              "sementeLargura"]
BASE_DESCR = 12  # coluna L
ROTULO = {"crescimento": "Crescimento (G-L)", "descritores": "Descritores (M-Y)"}

E = {"log": [], "uuids": set(), "falhar": False, "lock": threading.Lock()}


def letra(n):
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def chave(modo, ronda, pid):
    return f"{modo}|{ronda if modo == 'crescimento' else ''}|{pid}"


def por_chave():
    """Ultimo registo valido de cada planta/levantamento/ronda.

    'dono' e quem CRIOU (nao muda quando um admin corrige); 'recorder' e quem
    mexeu por ultimo. As permissoes olham para o dono.
    """
    out = {}
    for r in E["log"]:
        if not r["estado"].startswith("OK"):
            continue
        k = chave(r["mode"], r.get("ronda", ""), r["pid"])
        ja = out.get(k)
        out[k] = {**r, "dono": ja["dono"] if ja else r["recorder"]}
    return out


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DOCS), **kw)

    def log_message(self, *a):
        pass

    def _json(self, obj, codigo=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(corpo)

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}

        if u.path.startswith("/config.js"):
            corpo = b"window.INDIAREC_CONFIG={ENDPOINT:'/exec',VERSAO:'teste'};"
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)
            return

        if u.path.startswith("/__reset"):
            with E["lock"]:
                E["log"] = []
                E["uuids"] = set()
                E["falhar"] = False
            self._json({"ok": True})
            return
        if u.path.startswith("/__estado"):
            with E["lock"]:
                self._json({"log": E["log"]})
            return
        if u.path.startswith("/__semear"):
            # cria um registo de outra pessoa, para testar o cadeado
            with E["lock"]:
                E["log"].append({
                    "uuid": "semeado-1", "tsLocal": "01/08/2026 08:00:00",
                    "recorder": q.get("quem", "Outra Pessoa"), "accao": "Registo",
                    "mode": q.get("mode", "descritores"), "ronda": q.get("ronda", ""),
                    "pid": q.get("pid", "NBF(Tanheia)26-100"),
                    "values": {"limboFoliar": 9.9}, "estado": "OK",
                })
            self._json({"ok": True})
            return

        if not u.path.startswith("/exec"):
            super().do_GET()
            return

        if q.get("token") != TOKEN:
            self._json({"ok": False, "erro": "Não autorizado."})
            return

        accao = q.get("action", "estado")

        if accao == "admin":
            self._json({"ok": True, "admin": q.get("pw") == ADMIN_PW})
            return

        with E["lock"]:
            if accao == "estado":
                modo = q.get("mode", "descritores")
                ronda = q.get("ronda", "")
                feitas = []
                for k, r in por_chave().items():
                    if r["mode"] != modo:
                        continue
                    if modo == "crescimento" and r.get("ronda", "") != ronda:
                        continue
                    feitas.append([int(r["pid"][-3:]), r["dono"]])
                feitas.sort()
                self._json({"ok": True, "hora": "2026-08-08 12:00:00", "mode": modo,
                            "ronda": ronda, "feitas": feitas,
                            "rondas": ["5 month after planting (20260511)"]})
                return

            if accao == "historico":
                regs = list(por_chave().values())
                regs.reverse()
                self._json({"ok": True, "hora": "2026-08-08 12:00:00", "registos": [
                    {"uuid": r["uuid"], "ts": r["tsLocal"], "recorder": r["dono"],
                     "ultimo": r["recorder"], "accao": r["accao"], "mode": r["mode"],
                     "ronda": r.get("ronda", ""), "pid": r["pid"]}
                    for r in regs[:200]]})
                return

            if accao == "registo":
                for r in reversed(E["log"]):
                    if r["uuid"] == q.get("uuid"):
                        self._json({"ok": True, "registo": {
                            "uuid": r["uuid"], "ts": r["tsLocal"], "recorder": r["recorder"],
                            "mode": r["mode"], "ronda": r.get("ronda", ""), "pid": r["pid"],
                            "values": r["values"]}})
                        return
                self._json({"ok": False, "erro": "Registo não encontrado."})
                return

        self._json({"ok": False, "erro": "Acção desconhecida: " + accao})

    # ----------------------------------------------------------------- POST
    def do_POST(self):
        if not self.path.startswith("/exec"):
            self.send_error(404)
            return
        if E["falhar"]:
            self.send_error(503, "indisponivel")
            return

        n = int(self.headers.get("Content-Length", 0))
        try:
            pedido = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            self._json({"ok": False, "erro": "JSON inválido"})
            return

        if pedido.get("token") != TOKEN:
            self._json({"ok": False, "erro": "Não autorizado."})
            return

        admin = pedido.get("adminPassword") == ADMIN_PW
        resultados = []

        with E["lock"]:
            for ent in pedido.get("entries", []):
                resultados.append(self._entrada(ent, admin))

        self._json({"ok": True, "resultados": resultados})

    def _entrada(self, ent, admin):
        uuid = ent.get("uuid", "")
        if uuid in E["uuids"]:
            return {"uuid": uuid, "ok": True, "duplicado": True}

        seq = ent.get("seq")
        if not isinstance(seq, int) or not (1 <= seq <= 415):
            return {"uuid": uuid, "ok": False, "erro": "seq inválido"}

        modo = ent.get("mode")
        ronda = ent.get("ronda", "")
        pid = ent.get("pid", "")
        anterior = por_chave().get(chave(modo, ronda, pid))
        accao = "Correcção" if anterior else "Registo"

        if anterior and not admin:
            dono = anterior["recorder"]
            if dono and dono != ent.get("recorder", ""):
                erro = (f"Esta planta foi registada por {dono}. "
                        "Só essa pessoa (ou um administrador) a pode corrigir.")
                E["log"].append({**ent, "accao": "Registo", "estado": "ERRO: " + erro})
                return {"uuid": uuid, "ok": False, "erro": erro}

        chaves = COLS_CRESC if modo == "crescimento" else COLS_DESCR
        vals = ent.get("values", {})
        celulas = []
        for i, ch in enumerate(chaves):
            if ch in vals and vals[ch] not in (None, ""):
                col = (6 + i) if modo == "crescimento" else (BASE_DESCR + i)
                celulas.append(f"{letra(col)}{2 + seq}")

        if not celulas:
            return {"uuid": uuid, "ok": False, "erro": "Nenhum valor preenchido."}

        E["uuids"].add(uuid)
        E["log"].append({**ent, "accao": accao, "estado": "OK"})
        return {"uuid": uuid, "ok": True, "linha": 2 + seq, "accao": accao, "celulas": celulas}


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORTA), H)
    print(f"a servir {DOCS} em http://127.0.0.1:{PORTA}", flush=True)
    srv.serve_forever()
