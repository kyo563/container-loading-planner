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
- `STANDARD`（内寸あり）と `SPECIAL`（40OT/40FR/RFなど）を扱える構造
- 未指定時はアプリ内のデフォルト仕様（20GP/40GP/40HC/20OT/40OT/20FR/40FR/RF）を使用

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

### 4.1 入力仕様（Excel貼り付け・Excelアップロード対応）

本アプリの「パッキングリスト入力」は、以下3方式に対応します。

- CSVアップロード（UTF-8）
- Excel（`.xlsx`）アップロード（先頭シートを使用）
- Excelコピー貼り付け（TSV）またはCSV貼り付け

いずれの入力方式でも、列名は別名ヘッダ（例: `ItemID`, `CargoName`, `Gross`, `Style`）を受け付け、内部で標準カラムに正規化します。

### 4.2 判定仕様（回転/段積み、入口余裕、OW/OH算出）

積付けとOOG判定では、次のルールを適用します。

- 回転: `rotate_allowed` が真の場合、6方向の向きを候補化
- 段積み: `stackable` と `max_stack_load_kg` を考慮
- 入口余裕: 判定時に入口寸法マージンとして**幅1cm・高さ3cm**を確保
- OOG算出: 参照コンテナ（標準は40HC）との差分から超過量を計算
  - `OW(each)`: ピース単位の幅超過
  - `OH`: 高さ超過

### 4.3 コンテナ選定（40HC優先・40GP代替条件・20GP利用条件）

標準コンテナは以下の方針で選定します。

1. **40HC優先**: 収容可能な場合は40HCを第一候補
2. **40GP代替条件**: 高さ条件により40HCの優位がない場合、同等本数であれば40GPを代替候補として評価
3. **20GP利用条件**: 20GPは総重量・容積・荷姿制約を満たし、かつ運用上の分割積載が合理的な場合に採用

### 4.4 特殊コンテナ（起用条件、FR制約、インゲージ混載ルール）

特殊コンテナ判定は次の優先順位・制約で運用します。

1. 冷凍/冷蔵キーワード検出時は RF を優先
2. OW（L/W超過）がある場合は 40FR を候補化（20FR/40FRを貨物寸法で自動選択）
3. 高さ超過のみの場合は 40OT を基本とし、重量級（28t超）または大型重量物（実質1本占有かつ20t以上）は 40FR に切替（20OT/40OTを貨物寸法で自動選択）
4. 40FR制約
   - 40FR内は段積み禁止
   - 容積2m3以下は40FR候補から除外
5. 特殊コンテナ本数はまずOOG貨物のみで算出し、その後に余りスペースへインゲージ貨物を重量→体積順で混載

### 4.5 出力仕様（Excel帳票とKPI定義）

#### 画面表示
- 配置一覧（DataFrame）
- container KPI表（container_labelごとのF/T, M3, GROSS集計）
- 積載不可貨物一覧
- 2D散布図（上面）
- 3Dビュー（pydeck）
- 推定トータルグロスウェイト
- 陸送要件アドバイス

#### ダウンロード
- 配置CSV
- container KPI CSV
- 本数見積CSV / 確定本数CSV
- Excel帳票（`Summary` / `Placements` / `Layout` / `ContainerKPI`、図示含む）
- 簡易バンニングPDF（文字ベース、注記用途）

#### KPI定義（container_label単位）
- **合計F/T (Freight Ton)**: `max(重量トン, 容積トン)`
  - 重量トン = `total_gross_kg / 1000`
  - 容積トン = `total_m3`
- **合計M3**: `total_m3 = Σ m3`
- **合計GROSS**: `total_gross_kg = Σ weight_kg`
- **最大単体GROSS**: `max_single_gross_kg = max(weight_kg)`

> **注意**: 本アプリの判定は計画支援を目的とした目安です。法令適合（車両制限・道路通行条件等）は、最終的に実運用で必ず確認してください。

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

AIダブルチェック機能を使う場合は、起動前に以下を設定してください。

```bash
export OPENAI_API_KEY="<your-api-key>"
# 任意（未指定時は gpt-4o-mini）
export OPENAI_MODEL="gpt-4o-mini"
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

## 8. AIダブルチェック（使い方・制限・注意事項）

### 8.1 使い方
- サイドバーで「AIダブルチェックを有効化」をONにします。
- `OPENAI_API_KEY`（任意で `OPENAI_MODEL`）を設定してアプリを起動します。
- 実行後、集計結果と配置サマリに対するAIコメントを確認します。

### 8.2 制限
- APIキー未設定時は機能が無効化され、UIに案内が表示されます。
- AIに送信されるのは、判定に必要な**集計結果**と**配置サマリ**です（生データの全面送信を前提としません）。
- モデル応答には揺らぎがあるため、同一入力でも助言が変わる場合があります。

### 8.3 注意事項
- 外部API連携を伴うため、**個人情報・機密情報・契約上持ち出し禁止の情報**は入力しないでください。
- AIの出力は補助的な提案です。法令適合性や運用判断は必ず実務担当者が最終確認してください。

---

## 9. 補足ドキュメント

- 基本設計: `docs/basic_design.md`
- サンプル入力:
  - `data/cargo.sample.csv`（`id,desc,qty,L_cm,W_cm,H_cm,weight_kg` を含むCSV。寸法はcm、重量はkg。`qty` と寸法/重量は0より大きい値を想定）
  - `data/package_master.sample.csv`
  - `data/containers.sample.yaml`

---

## 10. 変更履歴

- 本READMEの「変更履歴」には、**PRごとに要約を1行以上追記**する運用とします。
- 記載フォーマット例: `- YYYY-MM-DD: #PR番号 変更要約（入力仕様更新 / 判定仕様更新 など）`
