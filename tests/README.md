# Testes

Nada aqui toca na folha de cálculo real.

## 1. `teste_gas.py` — o Apps Script verdadeiro

Carrega `apps_script/Codigo.gs` num Chromium com um **stub da API do Apps Script**
(`gas_stub.js`: `SpreadsheetApp`, `PropertiesService`, `LockService`, `ContentService`,
`Utilities`) e chama `doPost` / `doGet` como o servidor faria.

Serve para apanhar o que o servidor mock em Python **não** consegue apanhar — ele
re-implementa o que se julga que o `Codigo.gs` faz, e por isso repete os mesmos
enganos. Este corre o ficheiro real: índices de coluna, formato da linha do `Log`,
leitura do índice, permissões, criação de blocos de ronda.

```powershell
python tests\teste_gas.py
```

## 2. `teste.py` — a aplicação no telemóvel

`servidor.py` serve `docs/` e imita o endpoint em `/exec`; devolve um `config.js`
com `ENDPOINT='/exec'`. `teste.py` conduz a página com o Playwright num viewport
de 390x844.

```powershell
Start-Process python -ArgumentList "tests\servidor.py","<caminho absoluto de docs>","8765" -WindowStyle Hidden
python tests\teste.py
```

Endpoints auxiliares do `servidor.py`:

| | |
|---|---|
| `/__reset` | limpa o estado — **chamar sempre antes de correr os testes** |
| `/__estado` | devolve o log em memória |
| `/__semear?quem=&pid=&mode=` | cria um registo de outra pessoa (para testar o cadeado) |
| `/__falhar=1` | faz o endpoint responder 503 |

Ao escrever testes novos: `[data-voltar]` existe em vários ecrãs, por isso use
sempre `.ecra:not([hidden]) [data-voltar]`.

## 3. `probe.py` — diagnóstico do endpoint publicado

Bate no Apps Script a sério com um token errado. Se a implantação estiver correcta
devolve `{"ok":false,"erro":"Não autorizado."}`; se devolver
`Função de script não encontrada: doGet` ou `Success`, foi implantado o projecto errado.
