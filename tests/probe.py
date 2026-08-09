# -*- coding: utf-8 -*-
import json
import re
import urllib.request

EXEC = ("https://script.google.com/macros/s/"
        "AKfycbwPZ8bF1-MHgM9l1ikrZ5HgqjrrtbcTNTkaiAgrqN9ZaY0wC_o1obagT8gcI3EufWwg/exec")


def olhar(rotulo, req):
    print("=" * 60)
    print(rotulo)
    try:
        r = urllib.request.urlopen(req, timeout=60)
        b = r.read().decode("utf-8", "replace")
    except Exception as e:
        print("  EXCEPCAO:", e)
        return
    print("  url final:", r.url[:110])
    print("  status:", r.status, "| content-type:", r.headers.get("Content-Type"))
    print("  tamanho:", len(b))
    t = re.search(r"<title>(.*?)</title>", b, re.S)
    if t:
        print("  title:", t.group(1).strip()[:120])
    if b.lstrip().startswith("{"):
        print("  JSON:", json.dumps(json.loads(b), ensure_ascii=False)[:300])
    else:
        for kw in ["Sign in", "Iniciar sess", "authoriz", "autoriza", "permission",
                   "not found", "Erro", "Error", "requires"]:
            if kw.lower() in b.lower():
                print("  contem:", kw)
        print("  inicio:", b[:200].replace("\n", " "))


olhar("GET com token errado", EXEC + "?token=errado")

corpo = json.dumps({"token": "errado", "entries": []}).encode()
olhar("POST text/plain", urllib.request.Request(
    EXEC, data=corpo, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"))
