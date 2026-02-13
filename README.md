# container-loading-planner

Python + Streamlit で動くコンテナ積載計画アプリです。  
GitHub 上で継続的に開発しやすいよう、最小構成の設計と CI を整備しています。

## 技術スタック
- Python 3.11
- Streamlit（フロントエンド）
- pandas / PyYAML（データ処理）

## ディレクトリ構成
```text
.
├── app.py                      # Streamlit エントリーポイント
├── container_planner/          # ドメインロジック
│   ├── models.py               # データモデル
│   ├── io.py                   # 入出力・パース
│   ├── planner.py              # 見積り/検証オーケストレーション
│   ├── packing.py              # 積付け計算
│   ├── oog.py                  # OOG判定
│   ├── naccs.py                # 荷姿マッピング
│   └── reporting.py            # 表示用データ生成
├── data/                       # サンプル入力
├── docs/basic_design.md        # 基本設計
├── tests/                      # 最小テスト
└── .github/workflows/ci.yml    # GitHub Actions CI
```

## ローカル実行
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

## 品質チェック
```bash
python -m unittest discover -s tests
python -m compileall app.py container_planner
```

## 開発フロー（基本）
1. GitHub Issue で要件を整理
2. 小さな単位でブランチ作成・実装
3. Pull Request でレビュー
4. GitHub Actions CI（テスト/構文チェック）通過後にマージ

詳細設計は `docs/basic_design.md` を参照してください。
