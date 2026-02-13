# 基本設計（Python + Streamlit + GitHub）

## 1. 目的
- コンテナ積載計画の「見積り」と「収まり検証」をブラウザで実行できること。
- Python を中心に、Streamlit でシンプルなUIを提供すること。
- GitHub で継続開発できる最小限の運用ルールを持つこと。

## 2. 設計方針
- **UIと業務ロジックを分離**する。
  - `app.py`: 入力/表示/操作（プレゼンテーション層）
  - `container_planner/`: 計算・判定・変換（ドメイン層）
- **データモデルを明示**する。
  - `models.py` の dataclass を基準にデータを受け渡す。
- **入出力境界を固定**する。
  - CSV/YAML の読み込みは `io.py` に集約し、形式差分の影響を限定する。
- **小さく検証可能**な単位に保つ。
  - 計算ロジックは Streamlit 依存を持たず、テスト対象にしやすくする。

## 3. 論理アーキテクチャ

```text
[Streamlit UI: app.py]
   ├─ 入力: CSV/YAML/フォーム
   ├─ 出力: テーブル/警告/CSVダウンロード
   ▼
[Application/Domain: container_planner]
   ├─ io.py         入力正規化・パース
   ├─ planner.py    ユースケース実行（estimate/validate）
   ├─ packing.py    積載アルゴリズム
   ├─ oog.py        OOG 判定
   ├─ naccs.py      荷姿文字列マッピング
   ├─ reporting.py  表示用行データ生成
   └─ models.py     ドメインモデル
```

## 4. 非機能設計（最小）
- **可読性**: 1ファイルに責務を詰め込みすぎない。
- **再現性**: サンプルデータ（`data/`）で動作確認可能。
- **保守性**: CI で最低限のテストと構文チェックを自動化。

## 5. GitHub開発運用（提案）
- ブランチ戦略: `main` + feature branch
- PR テンプレート（将来追加）
  - 目的 / 変更点 / 確認方法 / 影響範囲
- Issue ラベル（将来追加）
  - `feature`, `bug`, `refactor`, `docs`

## 6. CI設計（今回の最小実装）
GitHub Actions で以下を実行:
1. 依存インストール（`requirements.txt`）
2. `unittest` の実行
3. `compileall` による構文チェック

これにより「最低限壊れていない状態」を PR 時に自動確認できる。

## 7. 今後の拡張候補
- `pytest` + パラメタライズテスト導入
- `ruff` / `black` / `mypy` の導入
- Streamlit のページ分割（見積り画面と検証画面）
- 主要アルゴリズムのベンチマーク整備
