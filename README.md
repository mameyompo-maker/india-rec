# India Rec — NBF (Tanheia) 26 圃場測定アプリ

モザンビークの現場作業者がスマホで Jatropha の測定値を登録し、Google スプレッドシート
[NBF(Tanheia)26](https://docs.google.com/spreadsheets/d/1WSfQdkMdy_cton-Za6TGzRmpSi1cjycWqHfMCS_cDXQ/edit)
の `Data` シートに書き込むための **完全オフライン対応 PWA**。UI はすべてポルトガル語。

JatLog(Streamlit)とは別アプリ。Streamlit はサーバーとの常時接続が前提のため、
圏外では操作そのものが止まる。本アプリはその制約を回避するために静的 PWA として作った。

## 構成

```
端末(PWA / GitHub Pages)
  ├ Service Worker …… アプリ本体を端末にキャッシュ → 圏外でも起動する
  ├ IndexedDB     …… 送信待ちキュー + 送信済み履歴
  └ 端末時刻       …… 「保存」を押した瞬間の時刻を記録(送信時刻ではない)
        │  電波が来たら自動で POST
        ▼
Google Apps Script(ウェブアプリ)
  ├ 共有トークンで認証
  ├ 送信IDで重複排除(再送しても二重登録されない)
  ├ Data シートへ書込(空欄は書かない = 既存値を消さない)
  └ Log シートへ1行追記(誰が・いつ・何を)
```

## ファイル

| パス | 中身 |
|---|---|
| `docs/` | GitHub Pages で配信する PWA 一式 |
| `docs/config.js` | **Apps Script の URL をここに貼る** |
| `docs/plants.json` | 398株のマスタ(自動生成物) |
| `docs/sw.js` | Service Worker。**変更時は `CACHE` の値を上げる** |
| `apps_script/Codigo.gs` | スプレッドシート側に貼るコード |
| `tools/gen_plants.py` | `plants.json` の生成 |
| `tools/gen_icons.py` | アイコンの生成 |

---

## セットアップ手順

### 1. Apps Script を配置(Kaz さん作業)

1. スプレッドシートを開き **拡張機能 → Apps Script**
2. 既定の `Code.gs` の中身を全部消し、`apps_script/Codigo.gs` を貼り付けて保存
3. 左の歯車 **プロジェクトの設定 → スクリプト プロパティ** で2つ追加
   - `TOKEN` … 現場端末に入力する「Código de activação」。**未設定だと既定値 `jatropha`**
     (JatLog と共通、Kaz さん指定)。長い文字列に変えたい場合はここで上書きする
   - `ADMIN_PASSWORD` … 管理者モードのパスワード。**未設定だと既定値 `IndiaRec2026` になる**ので、
     必ず設定すること
4. 右上 **デプロイ → 新しいデプロイ → 種類:ウェブアプリ**
   - 説明: `India Rec v1`
   - **次のユーザーとして実行: 自分**
   - **アクセスできるユーザー: 全員**
   - デプロイ → 初回は権限の承認画面が出る(「詳細」→「安全ではないページに移動」で進む)
5. 表示される **ウェブアプリの URL**(`.../exec` で終わる)を控える

> ⚠ コードを直したときは「デプロイを管理 → 編集(鉛筆)→ バージョン:新バージョン → デプロイ」。
> 「新しいデプロイ」を選ぶと URL が変わってしまい、配布済みの端末が繋がらなくなる。

### 2. URL をアプリに設定

`docs/config.js` の `ENDPOINT` を、手順1で控えた URL に差し替える。

### 3. GitHub Pages で配信

リポジトリを作り、Settings → Pages → Source を `main` ブランチの `/docs` に設定。
発行された URL を現場のスマホで開く。

### 4. 端末ごとの初期設定(1回だけ)

1. スマホのブラウザで Pages の URL を開く
2. ブラウザメニューから **「ホーム画面に追加」**(これをしないとオフラインで起動しない)
3. 起動 → `Código de activação` に手順1の `TOKEN` を入力
4. 名前を入力して完了

以降は圏外でもホーム画面のアイコンから起動できる。

---

## 現場での使い方

1. **Que levantamento vai fazer?** — 調査の種類を選ぶ
   - **Crescimento** … 高さ・樹冠・cachos(F〜K列)。半年ごとの定期調査
   - **Descritores morfológicos** … 形態記載(L〜X列)
2. Crescimento の場合は **Ronda**(調査回)を入力。端末に記憶されるので毎回は不要
3. **Fileira**(r01〜r15)を選び、テンキーで **その列の中での番号** を打つ
   → Plant ID が画面に出るので現物と照合できる
4. 測定値を入力
   - 数値は小数点にカンマ `12,5` でもピリオド `12.5` でも可
   - 色は4色のタイルをタップ(もう一度タップで解除)
   - Hábito は Horizontal / Vertical の2択
5. **Guardar e enviar**
   - 空欄があれば「Faltam valores」と一覧を出して確認を求める(そのまま送信可)
   - 保存後は自動で同じ列の次の番号に進む

画面上部のバー:
- 緑 `Ligado — tudo enviado` … 全部送信済み
- 黄 `Por enviar` + 件数 … 送信待ちあり
- 赤 `Sem rede — guardado no telemóvel` … 圏外(入力は続けられる)
- `ADMIN` バッジ … 管理者モード中

## 進捗の見方

- **調査選択画面の各カード**に「19 de 398 plantas (5%)」とバーが出る
- **Ver progresso por fileira** で r01〜r15 ごとの棒グラフ。終わった列には ✓
- **株選択画面の列ボタン**にも `19/35` と出るので、どの列が残っているか一目で分かる
- **Saltar para a próxima por fazer** … 現在地の次の未登録株へジャンプ(端まで行くと先頭へ回る)
- 圏外のときは最後に取得した進捗をそのまま表示し、「actualizado …」に取得時刻が出る。
  この端末で入力してまだ送っていない分も進捗に加算される

## 権限と修正

JatLog と同じ考え方。

- **自分が登録した株**は上書き修正できる。株を選ぶと「✓ já registada por si — pode corrigir」と出て、
  フォームが**前回の値で埋まった状態**で開く。ボタンは `Guardar correcção` に変わる
- **他人が登録した株**は 🔒 が付き、選んでも先に進めない
- **管理者**はすべて修正できる。ログイン画面の「Modo administrador」にパスワードを入れる
  (サーバー側で照合するのでネット接続が必要)。`Trocar de utilizador` しても管理者のままで、
  抜けるのは「Sair do modo administrador」だけ。**12時間で自動的に切れる**
- **記録の持ち主は「最初に登録した人」で固定**される。管理者が他人の記録を直しても
  持ち主は移らないので、元の担当者はその後も自分で修正できる。
  誰が直したかは `Log` の各行に残り、一覧では「Cheia · corrigido por Joana」と表示される
- 権限の判定は**サーバー側でも行う**ので、画面をいじっても他人の記録は書き換えられない
- `Log` シートには毎回1行増え、`Ação` 列に `Registo` / `Correcção`、
  `Substitui o envio` 列に修正元の送信IDが入る

## 登録の一覧(Registos)

- **Neste aparelho** … この端末で入力した分。**圏外でも見られる**。⏳送信待ち / ✅送信済み / ⚠️エラー
- **Todos** … シートにある全登録。自分のものは ✏️、他人のものは 🔒。
  タップすると修正フォームが開く(🔒 は開かない)

---

## 設計上の判断(要確認・変更可)

### ⚠ 1. 「番号」の意味 — 要確認

`Data` シートの **C列「No.」は種子ロット(D列 Source)ごとにリセットされる**。
つまり列(Row)ごとの通し番号ではない。実際、r01 は 001〜035 の35株だが、
C列の No. は bag01 の 1〜30 と bag02 の 1〜5 が混在する。
**(Row, No.) の組は398株中323通りしか無く、75株が重複する。**

そのためアプリでは「**その列の中での位置(1〜35)**」を番号として使い、
シート上の C列の値と Source は確認用に画面表示している。

- 現場の株に付いている札の番号がどちらなのか、Kaz さんに確認してほしい
- 「列の中での位置」で合っていれば変更不要
- C列の No. の方が正しい場合は `tools/gen_plants.py` の対応表を作り直す(1箇所の変更で済む)

### 2. シートに書き込む値は英語

`Data` シートは英語のデータセットなので、選択肢は英語で保存する
(`Horizontal` / `Vertical`、`Light green` / `Medium green` / `Dark green` / `Red`)。
画面表示はポルトガル語。ポルトガル語で保存したい場合は `Codigo.gs` の
`VALOR_HABITO` / `VALOR_COR` の右辺を書き換える。

なお `Data!L2` の見出しは `Horizantal/Vertical` と綴りが誤っているが、
シートは触っていない。保存される値は正しい `Horizontal`。

### 3. Crescimento の新しいラウンド

F〜K の既存ブロック(`5 month after planting (20260511)`)は上書きしない。
新しい Ronda 名で送信すると、シートの**末尾に6列の新ブロックを自動追加**して
そこに書く。1行目にラウンド名、2行目に項目名が入る。

### 4. Data への書き込みは「最新が勝つ」

同じ株に2回送ると `Data` の値は上書きされる。ただし `Log` には毎回1行残るので、
履歴は全部追える。

### 5. Log シート

2026-08-08 に、旧44列ヘッダー(`Branch`, `Sepal Shape`, `Endocarp Rugosity` 等)を
**`Log_backup_20260808` タブに退避**したうえで、Data の F〜X に合わせた**35列**に置き換えた。
旧ヘッダーは行1のみでデータ行は無かったため、失われたデータは無い。

構成: `Data/hora (aparelho)` / `Data/hora (servidor)` / `Registado por` / `Ação` /
`Levantamento` / `Ronda` / `Plant ID` / `Fileira` / `N.º na fileira` / `N.º na folha` /
`Lote` / `Linha em Data` + F〜X の19項目 + `ID do envio` / `Substitui o envio` /
`Aparelho` / `Estado`。

`Ação` が `Correcção` の行は修正で、`Substitui o envio` に修正元の送信IDが入る。
`Estado` が `ERRO: …` の行は書き込みが拒否された記録(権限違反など)。

---

## 開発メモ

```powershell
# 株マスタ・アイコンの再生成
python tools\gen_plants.py
python tools\gen_icons.py
```

ローカル動作確認はモックサーバー + Playwright(`HANDOVER.md` 参照)。

**`docs/` の中身を変更したら必ず `docs/sw.js` の `CACHE` を上げること。**
上げないと、既にホーム画面に追加した端末は古いままになる。
