# container-loading-planner

Python + Streamlit で動く、コンテナ積載計画（Vanning Plan）作成アプリです。  
貨物CSVとコンテナ仕様（YAML）を入力すると、**必要本数の見積り**と**本数固定での積載検証**を実行し、配置結果・OOG判定・偏荷重警告を確認できます。

---

## 1. 目的

このアプリの主目的は、以下を1画面で実行できるようにすることです。

- コンテナ本数が未確定な段階での**本数見積り（Estimate）**
- コンテナ本数が確定している段階での**収まり検証（Validate / Loading）**
- OOG（Out Of Gauge）判定や偏荷重確認など、実務上の注意点の可視化

UI は Streamlit、業務ロジックは `container_planner/` に分離されており、運用・保守・テストをしやすい構成です。

---

## 2. 構成要件

### 2.1 実行環境

- Python 3.11
- 主要ライブラリ
  - Streamlit（UI）
  - pandas（CSV処理・表形式データ）
  - PyYAML（コンテナ仕様YAMLの読み込み）
  - pydeck（3D表示）

### 2.2 入力データ要件

#### 貨物CSV（必須）
必須カラム:

- `id`
- `desc`
- `qty`
- `L_cm`
- `W_cm`
- `H_cm`
- `weight_kg`

任意カラム:

- `package_text`
- `rotate_allowed`
- `stackable`
- `max_stack_load_kg`
- `incompatible_with_ids`

ヘッダは別名入力（例: `ItemID`, `CargoName`, `Gross`, `Style` など）にも対応し、内部で標準カラムに正規化されます。

#### コンテナ仕様YAML（任意）
- `containers:` 配下にコンテナ仕様を定義
- `STANDARD`（内寸あり）と `SPECIAL`（OT/FR/RFなど）を扱える構造
- 未指定時はアプリ内のデフォルト仕様（20GP/40GP/40HC/OT/FR/RF）を使用

#### 荷姿マスタCSV（任意）
- `alias, code` 形式で定義
- `package_text` から NACCS 用コードへのマッピングに使用

---

## 3. アプリ構成（アーキテクチャ）

```text
.
├── app.py                      # Streamlit UI（入力/表示/操作）
├── container_planner/
│   ├── models.py               # ドメインモデル（CargoRow, Piece, ContainerSpec, Placement 等）
│   ├── io.py                   # CSV読込・列名正規化・入力バリデーション・qty展開
│   ├── oog.py                  # OOG判定・向き選定
│   ├── packing.py              # Shelfベース積付けロジック
│   ├── planner.py              # estimate/validate のユースケース実行
│   ├── advisory.py             # 特殊コンテナ推奨・陸送要件アドバイス
│   ├── naccs.py                # 荷姿マスタ読込・荷姿コード変換
│   ├── reporting.py            # 画面/CSV出力用の配置行データ作成
│   ├── excel_export.py         # Excel帳票（Summary/Placements/Layout）出力
│   └── pdf_export.py           # 簡易PDF（テキストベース）出力
├── data/                       # サンプルCSV/YAML、CSVテンプレート
├── docs/basic_design.md        # 基本設計
└── tests/                      # smoke/feature テスト
```

---

## 4. 仕様

### 4.1 主要ユースケース

#### A. コンテナ本数を見積もる（Estimate）
- OOG貨物を分離して判定
- In-gauge貨物を対象に積付け
- 既定優先順（20GP→40GP→40HC）で、同数なら小さい優先順位を採用
- 結果として、推奨本数・配置・積載不可貨物を表示

#### B. コンテナ本数を確定して検証する（Validate / Loading）
- ユーザーがコンテナ種別ごとの本数を指定
- 指定本数内で積付けを実行
- 収まり/未積載/OOG/偏荷重を確認

### 4.2 積付けロジック（概要）

- Shelf型アルゴリズム（行・層を進めながら配置）
- 回転許可時は6方向の向きを検討
- 以下制約を考慮:
  - コンテナ内寸
  - 最大積載重量（payload）
  - 上載せ可否（`stackable`）
  - 上載せ荷重上限（`max_stack_load_kg`）
  - 非混載指定（`incompatible_with_ids`）
  - 重心偏差制約（`max_cg_offset_x_pct`, `max_cg_offset_y_pct`）

### 4.3 OOG判定仕様（概要）

- 参照コンテナ（標準では 40HC）内寸と比較し、L/W/Hの超過を算出
- もっとも超過合計が小さい向きを採用
- 超過方向に応じて候補を提示
  - 長さ/幅超過: FR
  - 高さのみ超過: OT
- OOG結果から `OW(each)`（pieceごとの幅超過）と `OH`（高さ超過）を集計して表示

### 4.3.1 特殊コンテナ判定ルール（優先順位・例外）

1. 冷凍/冷蔵キーワード検出時は RF を優先
2. OW（L/W超過）がある場合は FR を候補化
3. 高さ超過のみの場合は OT を基本とし、重量級（28t超）または大型重量物（実質1本占有かつ20t以上）は FR に切替
4. FRの例外条件
   - FR内は段積み禁止
   - 容積2m3以下はFR候補から除外
5. 特殊コンテナが必要な貨物がある場合のみ特殊コンテナ案を作成し、余りスペースにはインゲージ貨物を重量→体積順で投入
6. 基本容器の選定は 40HC を優先

### 4.4 偏荷重評価

- コンテナ内の重心位置から X/Y 偏差率を算出
- 前後差・左右差も算出
- 閾値超過時に `bias_warn` と理由コードを付与

### 4.5 出力仕様

- 画面表示
  - 配置一覧（DataFrame）
  - 積載不可貨物一覧
  - 2D散布図（上面）
  - 3Dビュー（pydeck）
  - 推定トータルグロスウェイト
  - 陸送要件アドバイス
- ダウンロード
  - 配置CSV
  - 本数見積CSV / 確定本数CSV
  - Excel帳票（主帳票: Summary / Placements / Layout）
  - 簡易バンニングPDF（文字ベース、注記用途）

> **注意**: 本アプリの判定は計画支援を目的とした目安です。法令適合（車両制限・道路通行条件等）は、最終的に実運用で必ず確認してください。

---

## 5. このアプリで「できること」

- 貨物CSVを読み込み、数量展開したピース単位で積載計算
- コンテナ仕様をYAMLで差し替えてシミュレーション
- 2つの運用モードを使い分け
  - 見積りモード（本数自動算出）
  - 検証モード（本数固定）
- OOG判定結果の確認（超過寸法・推奨特殊コンテナ）
- 偏荷重や重心偏差の確認
- 荷姿マスタで package text を NACCSコードにマッピング
- 配置結果を CSV/Excel（主帳票）/PDF（注記用途）として出力

---

## 6. クイックスタート

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

起動後、以下の順で操作すると確認しやすいです。

1. 「データメンテナンス」でサンプル荷姿マスタ/コンテナ仕様を反映
2. 「計画作成」でサンプル貨物を読み込む
3. 「パッキングリスト入力」で以下のいずれかを入力
   - CSVアップロード（UTF-8）
   - Excel（`.xlsx`）アップロード（先頭シートを読み込み）
   - Excelコピー貼り付け（TSV）またはCSV貼り付け
4. 見積りモード or 本数固定モードで実行
5. 配置結果とダウンロードファイルを確認

---

## 7. テスト・品質確認

```bash
python -m unittest discover -s tests
python -m compileall app.py container_planner
```

---

## 8. 補足ドキュメント

- 基本設計: `docs/basic_design.md`
- サンプル入力:
  - `data/cargo.sample.csv`
  - `data/package_master.sample.csv`
  - `data/containers.sample.yaml`
