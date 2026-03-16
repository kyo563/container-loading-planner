from __future__ import annotations

from decimal import Decimal
from pathlib import Path
import io

import pandas as pd
from pandas.errors import EmptyDataError
import pydeck as pdk
import streamlit as st
import yaml

from container_planner import (
    CargoInputError,
    build_container_kpi_rows,
    build_loading_plan_rows,
    build_placement_rows,
    estimate,
    expand_pieces,
    load_cargo_csv,
    load_cargo_dataframe,
    load_package_master,
    map_package_text,
    normalize_cargo_rows,
    validate,
)
from container_planner.advisory import (
    estimate_gross_weight_by_container,
    suggest_truck_requirement,
    summarize_special_container_needs,
)
from container_planner.ai_review import build_ai_review_prompt, load_ai_review_config, request_ai_review
from container_planner.models import ContainerSpec, PackingConstraints
from container_planner.oog import evaluate_oog, summarize_oog_overages
from container_planner.excel_export import build_excel_report
from container_planner.pdf_export import build_text_pdf

st.set_page_config(page_title="コンテナ詰め算出アプリ", layout="wide")
st.title("コンテナ詰め算出アプリ")
st.caption("入力ガイドを見ながら、見積り（Estimate）と計画検証（Validate）を一画面で実行できます。")

# 一般的な海上コンテナ仕様の代表値（運送会社公開スペックでよく使われる値を採用）
DEFAULT_CONTAINERS_YAML = """
containers:
  - type: 20GP
    category: STANDARD
    inner_L_cm: 589
    inner_W_cm: 235
    inner_H_cm: 239
    door_W_cm: 234
    door_H_cm: 228
    max_payload_kg: 28200
    cost: 7.0
  - type: 40GP
    category: STANDARD
    inner_L_cm: 1203
    inner_W_cm: 235
    inner_H_cm: 239
    door_W_cm: 234
    door_H_cm: 228
    max_payload_kg: 26700
    cost: 6.0
  - type: 40HC
    category: STANDARD
    inner_L_cm: 1203
    inner_W_cm: 235
    inner_H_cm: 269
    door_W_cm: 234
    door_H_cm: 258
    max_payload_kg: 26600
    cost: 6.0
  - type: 20OT
    category: SPECIAL
    inner_L_cm: 589
    inner_W_cm: 235
    inner_H_cm: 400
    deck_L_cm: 589
    deck_W_cm: 235
    max_payload_kg: 28200
    cost: 4.0
  - type: 40OT
    category: SPECIAL
    inner_L_cm: 1203
    inner_W_cm: 235
    inner_H_cm: 400
    deck_L_cm: 1203
    deck_W_cm: 235
    max_payload_kg: 28000
    cost: 3.0
  - type: 20FR
    category: SPECIAL
    inner_L_cm: 589
    inner_W_cm: 240
    inner_H_cm: 260
    deck_L_cm: 589
    deck_W_cm: 240
    max_payload_kg: 30000
    cost: 2.0
  - type: 40FR
    category: SPECIAL
    inner_L_cm: 1160
    inner_W_cm: 240
    inner_H_cm: 260
    deck_L_cm: 1160
    deck_W_cm: 240
    max_payload_kg: 34000
    cost: 1.0
  - type: RF
    category: SPECIAL
    inner_L_cm: 1150
    inner_W_cm: 228
    inner_H_cm: 220
    door_W_cm: 228
    door_H_cm: 218
    max_payload_kg: 27500
""".strip()

REQUIRED_COLUMNS = ["id", "desc", "qty", "L_cm", "W_cm", "H_cm", "weight_kg"]
OPTIONAL_COLUMNS = ["package_text", "rotate_allowed", "stackable", "max_stack_load_kg", "incompatible_with_ids"]
ALL_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS
CARGO_STRING_COLUMNS = ["id", "desc", "package_text", "incompatible_with_ids"]
CARGO_FLOAT_COLUMNS = ["L_cm", "W_cm", "H_cm", "weight_kg", "max_stack_load_kg"]


TEMPLATE_JA_COLUMNS = [
    "アイテム番号",
    "貨物名",
    "数量",
    "長さ(cm)",
    "幅(cm)",
    "高さ(cm)",
    "重量(kg)",
    "荷姿",
    "回転可否(TRUE/FALSE)",
    "積み重ね可否(TRUE/FALSE)",
    "上積み許容(kg)",
    "混載不可アイテム番号",
]


def _build_blank_cargo_template_df() -> pd.DataFrame:
    rows = []
    for item_no in range(1, 151):
        rows.append(
            {
                "アイテム番号": item_no,
                "貨物名": "",
                "数量": "",
                "長さ(cm)": "",
                "幅(cm)": "",
                "高さ(cm)": "",
                "重量(kg)": "",
                "荷姿": "",
                "回転可否(TRUE/FALSE)": "",
                "積み重ね可否(TRUE/FALSE)": "",
                "上積み許容(kg)": "",
                "混載不可アイテム番号": "",
            }
        )
    return pd.DataFrame(rows, columns=TEMPLATE_JA_COLUMNS)


def _build_blank_cargo_template_xlsx(df: pd.DataFrame) -> bytes:
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="cargo_template")
    return output.getvalue()


def _to_decimal(value):
    if value is None:
        return None
    return Decimal(str(value))


def _parse_container_specs(containers_yaml: str):
    specs = []
    data = yaml.safe_load(containers_yaml) or {}
    for item in data.get("containers", []):
        specs.append(
            ContainerSpec(
                type=item.get("type"),
                category=item.get("category"),
                inner_L_cm=_to_decimal(item.get("inner_L_cm")),
                inner_W_cm=_to_decimal(item.get("inner_W_cm")),
                inner_H_cm=_to_decimal(item.get("inner_H_cm")),
                door_W_cm=_to_decimal(item.get("door_W_cm")),
                door_H_cm=_to_decimal(item.get("door_H_cm")),
                deck_L_cm=_to_decimal(item.get("deck_L_cm")),
                deck_W_cm=_to_decimal(item.get("deck_W_cm")),
                max_payload_kg=_to_decimal(item.get("max_payload_kg")),
                cost=_to_decimal(item.get("cost")),
            )
        )
    return specs


def _convert_dimension_to_cm(value: float, unit: str) -> Decimal:
    factor_map = {"mm": Decimal("0.1"), "cm": Decimal("1"), "m": Decimal("100")}
    return Decimal(str(value)) * factor_map.get(unit, Decimal("1"))


def _empty_cargo_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "id": pd.Series(dtype="string"),
            "desc": pd.Series(dtype="string"),
            "qty": pd.Series(dtype="Int64"),
            "L_cm": pd.Series(dtype="Float64"),
            "W_cm": pd.Series(dtype="Float64"),
            "H_cm": pd.Series(dtype="Float64"),
            "weight_kg": pd.Series(dtype="Float64"),
            "package_text": pd.Series(dtype="string"),
            "rotate_allowed": pd.Series(dtype="boolean"),
            "stackable": pd.Series(dtype="boolean"),
            "max_stack_load_kg": pd.Series(dtype="Float64"),
            "incompatible_with_ids": pd.Series(dtype="string"),
        }
    )[ALL_COLUMNS]


def _coerce_bool_series(series: pd.Series) -> pd.Series:
    lowered = series.astype("string").str.strip().str.lower()
    true_values = {"true", "1", "t", "yes", "y", "on"}
    false_values = {"false", "0", "f", "no", "n", "off"}
    coerced = pd.Series(pd.NA, index=series.index, dtype="boolean")
    coerced = coerced.mask(lowered.isin(true_values), True)
    coerced = coerced.mask(lowered.isin(false_values), False)
    return coerced


def _normalize_cargo_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in ALL_COLUMNS:
        if col not in out.columns:
            out[col] = pd.NA
    out = out[ALL_COLUMNS]
    if out.empty:
        return _empty_cargo_df()

    for col in CARGO_STRING_COLUMNS:
        out[col] = out[col].astype("string")

    qty_numeric = pd.to_numeric(out["qty"], errors="coerce")
    qty_numeric = qty_numeric.where(qty_numeric.isna() | (qty_numeric % 1 == 0))
    out["qty"] = qty_numeric.astype("Int64")

    for col in CARGO_FLOAT_COLUMNS:
        out[col] = pd.to_numeric(out[col], errors="coerce").astype("Float64")

    out["rotate_allowed"] = _coerce_bool_series(out["rotate_allowed"]).fillna(True).astype("boolean")
    out["stackable"] = _coerce_bool_series(out["stackable"]).fillna(True).astype("boolean")
    out["incompatible_with_ids"] = out["incompatible_with_ids"].fillna("").astype("string")
    return out


def _coerce_for_data_editor(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    selected = None
    if "selected" in out.columns:
        selected = _coerce_bool_series(out["selected"]).fillna(False).astype(bool)
        out = out.drop(columns=["selected"])
    out = _normalize_cargo_dataframe(out)
    if selected is not None:
        out.insert(0, "selected", selected)
    return out


def _read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _coerce_cargo_df(df: pd.DataFrame) -> pd.DataFrame:
    normalized = load_cargo_dataframe(df)
    return _normalize_cargo_dataframe(normalized)


def _read_cargo_text_input(text: str) -> pd.DataFrame:
    stripped = text.strip()
    if not stripped:
        raise CargoInputError("CSV/TSVテキストを入力してください。")

    delimiter = "\t" if "\t" in stripped else ","
    data = pd.read_csv(io.StringIO(stripped), sep=delimiter)
    return _coerce_cargo_df(data)


def _format_cargo_input_error(exc: Exception) -> str:
    if isinstance(exc, EmptyDataError):
        if "No columns to parse from file" in str(exc):
            return "ファイルが空です。ヘッダー行を含むCSVを指定してください。"
        return "ヘッダ不一致またはデータ空: 列ヘッダ/データ行を確認してください。"

    if isinstance(exc, CargoInputError):
        msg = str(exc)
        if "必須カラム" in msg:
            return f"ヘッダ不一致: {msg}"
        return msg

    if isinstance(exc, UnicodeDecodeError):
        return "文字コード不正: UTF-8のCSVを指定してください。"

    if isinstance(exc, ValueError):
        return f"シート空または形式不正: {exc}"

    return f"入力の読み込みに失敗しました: {exc}"


def _format_container_type_label(container_type: str) -> str:
    return container_type


def _read_cargo_uploaded_file(uploaded_file) -> pd.DataFrame:
    suffix = Path(uploaded_file.name).suffix.lower()
    content = uploaded_file.getvalue()

    if suffix == ".xlsx":
        excel_df = pd.read_excel(io.BytesIO(content))
        if excel_df.empty and len(excel_df.columns) == 0:
            raise CargoInputError("シート空: Excelシートにデータがありません。")
        return _coerce_cargo_df(excel_df)

    if suffix == ".csv":
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CargoInputError("文字コード不正: UTF-8のCSVを指定してください。") from exc
        return _normalize_cargo_dataframe(load_cargo_csv(text))

    raise CargoInputError("未対応の拡張子です。csv または xlsx を指定してください。")


def _render_result_block(result, order_map, package_lookup, title_prefix: str):
    special_counts, special_reasons = summarize_special_container_needs(result.oog_results)
    decision_reasons = getattr(result, "decision_reasons", [])
    oog_lookup = {piece.piece_id: oog for piece, oog in result.oog_results}
    df = build_placement_rows(
        result.placements,
        oog_lookup,
        result.bias_by_container,
        order_map,
        package_lookup,
        getattr(result, "special_reason_by_piece", special_reasons),
        getattr(result, "weight_audit_by_container", {}),
    )
    container_kpi_df = build_container_kpi_rows(df)

    st.subheader(f"{title_prefix} 配置一覧")
    if decision_reasons:
        st.markdown("**判定根拠**")
        for reason in decision_reasons:
            st.write(f"- {reason}")
    st.dataframe(df, use_container_width=True)
    st.download_button(
        f"{title_prefix} 配置CSVダウンロード",
        data=df.to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{title_prefix.lower()}_placements.csv",
        use_container_width=True,
    )

    loading_plan_df = build_loading_plan_rows(df)
    st.subheader(f"{title_prefix} 積み付けプラン（手順）")
    st.dataframe(loading_plan_df, use_container_width=True)
    st.download_button(
        f"{title_prefix} 積み付けプランCSVダウンロード",
        data=loading_plan_df.to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{title_prefix.lower()}_loading_plan.csv",
        use_container_width=True,
    )
    st.download_button(
        f"{title_prefix} Excelダウンロード",
        data=build_excel_report(df, container_kpi_df),
        file_name=f"{title_prefix.lower()}_report.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
    )

    st.subheader("container KPI表")
    st.dataframe(container_kpi_df, use_container_width=True)
    st.download_button(
        f"{title_prefix} container KPI CSVダウンロード",
        data=container_kpi_df.to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{title_prefix.lower()}_container_kpi.csv",
        use_container_width=True,
    )

    st.subheader("積載不可貨物 (unplaced)")
    if result.unplaced:
        unplaced_df = pd.DataFrame(
            [
                {
                    "piece_id": p.piece_id,
                    "orig_id": p.orig_id,
                    "desc": p.desc,
                    "L_cm": p.L_cm,
                    "W_cm": p.W_cm,
                    "H_cm": p.H_cm,
                    "weight_kg": p.weight_kg,
                }
                for p in result.unplaced
            ]
        )
        st.dataframe(unplaced_df, use_container_width=True)

        door_issue_rows = []
        for piece in result.unplaced:
            oog = oog_lookup.get(piece.piece_id)
            if oog and oog.door_check_applied and not oog.door_passable:
                door_issue_rows.append(
                    {
                        "piece_id": piece.piece_id,
                        "desc": piece.desc,
                        "door_reason": oog.door_reason,
                    }
                )
        if door_issue_rows:
            st.warning("入口通過不可の貨物があります。")
            st.dataframe(pd.DataFrame(door_issue_rows), use_container_width=True)
    else:
        st.success("積載不可貨物はありません")

    if not df.empty:
        chart_col1, chart_col2 = st.columns(2)
        with chart_col1:
            st.markdown("**2D配置ビュー（上面）**")
            view_df = df[["container_label", "placed_x_cm", "placed_y_cm"]].copy()
            st.scatter_chart(view_df, x="placed_x_cm", y="placed_y_cm", color="container_label")

        with chart_col2:
            st.markdown("**3D配置ビュー**")
            chart_data = df[["placed_x_cm", "placed_y_cm", "placed_z_cm"]].copy()
            chart_data = chart_data.apply(pd.to_numeric)
            st.pydeck_chart(
                pdk.Deck(
                    map_style=None,
                    initial_view_state=pdk.ViewState(latitude=0, longitude=0, zoom=0, pitch=45),
                    layers=[
                        pdk.Layer(
                            "ColumnLayer",
                            data=chart_data,
                            get_position="[placed_x_cm, placed_y_cm]",
                            get_elevation="placed_z_cm",
                            elevation_scale=2,
                            radius=30,
                            get_fill_color="[0, 120, 255, 180]",
                            pickable=True,
                            auto_highlight=True,
                        )
                    ],
                ),
                use_container_width=True,
            )

    gross_map = estimate_gross_weight_by_container(result.placements, special_counts)
    oog_totals = summarize_oog_overages(result.oog_results)
    gross_df = pd.DataFrame(gross_map.items(), columns=["container", "estimated_gross_kg"])
    st.subheader("推定トータルグロスウェイト")
    st.dataframe(gross_df, use_container_width=True)

    max_over_w = max([oog.over_W_cm for _, oog in result.oog_results], default=Decimal("0"))
    max_over_h = max([oog.over_H_cm for _, oog in result.oog_results], default=Decimal("0"))
    total_gross = sum(gross_map.values(), Decimal("0"))
    advice = suggest_truck_requirement(total_gross, max_over_w, max_over_h)
    st.info(f"国内配送要件提案: {advice}")
    st.caption(f"OW(each) 合計: {oog_totals['OW_each']} cm / OH 合計: {oog_totals['OH']} cm")


def _render_ai_review_section(summary_df: pd.DataFrame, placement_df: pd.DataFrame, enabled: bool, api_ready: bool):
    st.subheader("AIダブルチェック")
    if not api_ready:
        st.info(
            "AIレビューを使うには APIキーが必要です。\n"
            "1) 環境変数 `OPENAI_API_KEY` を設定\n"
            "2) 必要に応じて `OPENAI_MODEL`（既定: gpt-4o-mini）を設定\n"
            "3) アプリを再起動"
        )
        return
    if not enabled:
        st.caption("サイドバーで「AIダブルチェックを有効化」をONにするとレビューを実行します。")
        return

    config = load_ai_review_config()
    if not config:
        st.warning("APIキーが取得できないためAIレビューを実行できません。")
        return

    prompt = build_ai_review_prompt(summary_df, placement_df)
    with st.spinner("AIレビューを実行中..."):
        try:
            ai_result = request_ai_review(config, prompt)
        except Exception as exc:  # noqa: BLE001
            st.error(str(exc))
            return

    caution_points = ai_result.caution_points or ["特記事項なし"]
    check_items = ai_result.check_items or ["特記事項なし"]
    improvement_suggestions = ai_result.improvement_suggestions or ["特記事項なし"]

    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown("**注意点**")
        for item in caution_points:
            st.write(f"- {item}")
    with col2:
        st.markdown("**確認事項**")
        for item in check_items:
            st.write(f"- {item}")
    with col3:
        st.markdown("**改善提案**")
        for item in improvement_suggestions:
            st.write(f"- {item}")

    st.caption("※ 外部APIへ送信されるため、個人情報・機密情報を含めないでください。")


with st.sidebar:
    st.header("共通設定")
    ai_config_ready = load_ai_review_config() is not None
    ai_double_check_enabled = st.checkbox(
        "AIダブルチェックを有効化",
        value=False,
        disabled=not ai_config_ready,
        help="結果サマリをLLM APIに送って注意点を確認します。",
    )
    if not ai_config_ready:
        st.caption("APIキー未設定のため無効です。`OPENAI_API_KEY` を環境変数に設定してください。")
    bias_threshold = st.number_input(
        "偏荷重警告閾値(%)",
        min_value=0.0,
        max_value=100.0,
        value=20.0,
        help="重心偏りの警告を出す基準値です。",
    )
    container_order_text = st.text_input(
        "コンテナ表示順 (カンマ区切り)",
        value="20GP,40GP,40HC,40OT,40FR,RF",
        placeholder="例: 20GP,40GP,40HC,40OT,40FR,RF",
    )
    st.subheader("追加制約")
    max_cg_offset_x_pct = st.number_input("重心X偏差上限(%)", min_value=0.0, max_value=100.0, value=100.0)
    max_cg_offset_y_pct = st.number_input("重心Y偏差上限(%)", min_value=0.0, max_value=100.0, value=100.0)
    st.subheader("FIXED_PRIORITY設定")
    small_lot_threshold_pieces = st.number_input(
        "小口閾値（piece数）",
        min_value=0,
        max_value=1000,
        value=2,
        step=1,
    )
    small_lot_threshold_m3 = st.number_input(
        "小口閾値（m3）",
        min_value=0.0,
        max_value=100000.0,
        value=0.0,
        help="0の場合はm3閾値を無効化します。",
    )

if "cargo_df" not in st.session_state:
    st.session_state["cargo_df"] = _empty_cargo_df()

main_tab, maintenance_tab = st.tabs(["計画作成", "データメンテナンス"])

with maintenance_tab:
    st.header("データメンテナンス")
    st.caption("規定情報（荷姿マスタ・コンテナ仕様）をここで編集します。初期値には一般的な値を入れています。")

    sample_col1, sample_col2 = st.columns(2)
    if sample_col1.button("サンプル荷姿マスタを入力欄へ", use_container_width=True):
        st.session_state["package_text_input"] = _read_text("data/package_master.sample.csv")
        st.success("荷姿マスタのサンプルを反映しました。")
    if sample_col2.button("サンプルコンテナ仕様を入力欄へ", use_container_width=True):
        st.session_state["container_text_input"] = _read_text("data/containers.sample.yaml")
        st.success("コンテナ仕様サンプルを反映しました。")

    st.subheader("荷姿マスタ (任意)")
    st.file_uploader("荷姿マスタCSVアップロード", type=["csv"], key="package")
    st.text_area(
        "荷姿マスタCSVテキスト貼り付け",
        key="package_text_input",
        height=140,
        placeholder="alias,code\nCRATE,CT\nPALLET,PL",
    )

    st.subheader("コンテナ仕様")
    st.checkbox("デフォルト仕様を使う", value=True, key="use_default_specs")
    st.file_uploader("containers.yamlアップロード", type=["yaml", "yml"], key="container")
    st.text_area(
        "containers.yamlテキスト貼り付け",
        key="container_text_input",
        height=200,
        value=DEFAULT_CONTAINERS_YAML,
        placeholder="containers:\n  - type: 20GP\n    category: STANDARD\n    inner_L_cm: 589\n    inner_W_cm: 235\n    inner_H_cm: 239",
    )

# 荷姿マスタ
package_mapping = {}
try:
    if "package" in st.session_state and st.session_state["package"] is not None:
        package_mapping = load_package_master(st.session_state["package"].getvalue().decode("utf-8"))
    elif st.session_state.get("package_text_input", "").strip():
        package_mapping = load_package_master(st.session_state["package_text_input"])
except Exception as exc:  # noqa: BLE001
    st.error(f"荷姿マスタ読み込みに失敗しました: {exc}")

# コンテナ仕様
containers_yaml = DEFAULT_CONTAINERS_YAML if st.session_state.get("use_default_specs", True) else None
if "container" in st.session_state and st.session_state["container"] is not None:
    containers_yaml = st.session_state["container"].getvalue().decode("utf-8")
elif st.session_state.get("container_text_input", "").strip():
    containers_yaml = st.session_state["container_text_input"]

container_specs = []
if containers_yaml:
    try:
        container_specs = _parse_container_specs(containers_yaml)
    except Exception as exc:  # noqa: BLE001
        st.error(f"containers.yaml 読み込みに失敗しました: {exc}")

standard_specs = [spec for spec in container_specs if spec.category == "STANDARD"]
special_specs = [spec for spec in container_specs if spec.category == "SPECIAL"]
if not standard_specs:
    st.warning("STANDARDコンテナ仕様がありません。データメンテナンスタブでコンテナ仕様を確認してください。")
    st.stop()

ref_options = [spec.type for spec in standard_specs]
ref_choice = "40HC" if "40HC" in ref_options else ref_options[0]
ref_spec = next((spec for spec in standard_specs if spec.type == ref_choice), None)
st.caption(f"OOG判定基準コンテナ: {ref_choice}（見積り基準）")

with main_tab:
    st.header("計画作成")
    st.caption("①本数条件を選択 → ②パッキングリスト入力 → ③実行ボタン押下 の順で進めます。")

    flow_mode = st.radio(
        "まずどちらで進めますか？",
        options=["コンテナ本数が決まっている", "コンテナ本数を見積もる"],
        horizontal=True,
    )
    execute_label = "見積もり実行" if flow_mode == "コンテナ本数を見積もる" else "バンプラン作成を実行"

    if flow_mode == "コンテナ本数を見積もる":
        st.info("このモードでは、貨物データを基に推奨コンテナ本数と配置結果を自動算出します。")
    else:
        st.info("このモードでは、下部で入力したコンテナ本数を使って配置計画を作成します。")

    st.subheader("パッキングリスト入力")
    cargo_col1, cargo_col2 = st.columns(2)
    with cargo_col1:
        cargo_file = st.file_uploader("貨物CSV/XLSXアップロード", type=["csv", "xlsx"], key="cargo")
    with cargo_col2:
        cargo_text = st.text_area(
            "貨物CSV/TSVテキスト貼り付け",
            height=180,
            placeholder="ItemID\tCargoName\tQty\tL\tW\tH\tGross\tStyle\tRotate\tStackable\tMaxTopLoad\tIncompatibleIDs\nA001\tMachine\t1\t100\t80\t50\t500\tCRATE\tTRUE\tFALSE\t\t",
        )

    st.caption("CSV/XLSXのヘッダーは簡易英語入力に対応しています（例: ItemID / CargoName / Qty / L / W / H / Gross / Style）。貼り付け欄はTSV（Excelコピー）/CSVを自動判定します。単位は L/W/H=cm、Gross=kg です。")
    blank_template_df = _build_blank_cargo_template_df()
    template_col1, template_col2 = st.columns(2)
    with template_col1:
        st.download_button(
            "記入用ブランクフォームを発行（CSV）",
            data=blank_template_df.to_csv(index=False).encode("utf-8-sig"),
            file_name="cargo_blank_form.csv",
            mime="text/csv",
            use_container_width=True,
        )
        st.download_button(
            "記入用ブランクフォームを発行（XLSX）",
            data=_build_blank_cargo_template_xlsx(blank_template_df),
            file_name="cargo_blank_form.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
        )
    with template_col2:
        st.caption("A列にアイテム番号1〜150を事前入力したブランクフォームです。151以上もそのまま追記して利用できます。")
        st.caption("列名は日本語で記載しています。アップロード時はそのまま読み込めます。")

    csv_col1, csv_col2 = st.columns(2)
    if csv_col1.button("サンプル貨物を読み込む", use_container_width=True):
        try:
            sample_df = load_cargo_csv(_read_text("data/cargo.sample.csv"))
            st.session_state["cargo_df"] = _normalize_cargo_dataframe(sample_df)
            st.success("サンプル貨物を読み込みました。")
        except (EmptyDataError, CargoInputError, UnicodeDecodeError, ValueError) as exc:
            st.error(_format_cargo_input_error(exc))
        except Exception as exc:  # noqa: BLE001
            st.error(_format_cargo_input_error(exc))

    if csv_col2.button("貨物入力を反映", use_container_width=True):
        try:
            if cargo_file is not None:
                st.session_state["cargo_df"] = _read_cargo_uploaded_file(cargo_file)
            elif cargo_text.strip():
                st.session_state["cargo_df"] = _read_cargo_text_input(cargo_text)
            else:
                st.warning("CSV/XLSXをアップロードするか、CSV/TSVテキストを入力してください。")
            if cargo_file is not None or cargo_text.strip():
                st.success("貨物データを反映しました。")
        except (EmptyDataError, CargoInputError, UnicodeDecodeError, ValueError) as exc:
            st.error(_format_cargo_input_error(exc))
        except Exception as exc:  # noqa: BLE001
            st.error(_format_cargo_input_error(exc))

    st.subheader("貨物データのクイック追加")
    quick_col1, quick_col2, quick_col3, quick_col4 = st.columns(4)
    with quick_col1:
        quick_id = st.text_input("ItemID", key="quick_id", placeholder="例: A001")
    with quick_col2:
        quick_desc = st.text_input("CargoName", key="quick_desc", placeholder="例: Machine")
    with quick_col3:
        quick_package = st.text_input("Style", key="quick_package", placeholder="例: CRATE")
    with quick_col4:
        quick_qty = st.number_input("Qty", min_value=1, value=1, step=1, key="quick_qty")

    dim_col1, dim_col2, dim_col3, dim_col4, dim_col5 = st.columns(5)
    with dim_col1:
        quick_l = st.number_input("L", min_value=0.0, value=0.0, step=1.0, key="quick_l")
    with dim_col2:
        quick_w = st.number_input("W", min_value=0.0, value=0.0, step=1.0, key="quick_w")
    with dim_col3:
        quick_h = st.number_input("H", min_value=0.0, value=0.0, step=1.0, key="quick_h")
    with dim_col4:
        quick_unit = st.selectbox("単位", ["cm", "mm", "m"], key="quick_unit")
    with dim_col5:
        quick_weight = st.number_input("Gross(kg)", min_value=0.0, value=0.0, step=1.0, key="quick_weight")

    flag_col1, flag_col2, flag_col3 = st.columns(3)
    with flag_col1:
        quick_rotate_allowed = st.checkbox("Rotate", value=True)
    with flag_col2:
        quick_stackable = st.checkbox("Stackable", value=True)
    with flag_col3:
        quick_max_stack = st.number_input("MaxTopLoad(kg, optional)", min_value=0.0, value=0.0, step=1.0)

    quick_incompatible = st.text_input(
        "IncompatibleIDs (comma separated)",
        placeholder="例: B001,C002",
    )

    if st.button("この内容を貨物データに追加", use_container_width=True):
        if not quick_id.strip() or not quick_desc.strip():
            st.error("ItemID と CargoName は必須です。")
        elif min(quick_l, quick_w, quick_h, quick_weight) <= 0:
            st.error("L/W/H と Gross は 0 より大きい値を入力してください。")
        else:
            converted_l = _convert_dimension_to_cm(quick_l, quick_unit)
            converted_w = _convert_dimension_to_cm(quick_w, quick_unit)
            converted_h = _convert_dimension_to_cm(quick_h, quick_unit)
            new_row = {
                "id": quick_id.strip(),
                "desc": quick_desc.strip(),
                "qty": int(quick_qty),
                "L_cm": float(converted_l),
                "W_cm": float(converted_w),
                "H_cm": float(converted_h),
                "weight_kg": float(quick_weight),
                "package_text": quick_package.strip(),
                "rotate_allowed": quick_rotate_allowed,
                "stackable": quick_stackable,
                "max_stack_load_kg": float(quick_max_stack) if quick_max_stack > 0 else None,
                "incompatible_with_ids": quick_incompatible.strip(),
            }
            st.session_state["cargo_df"] = pd.concat(
                [st.session_state["cargo_df"], pd.DataFrame([new_row])],
                ignore_index=True,
            )
            st.success("貨物データに追加しました。")

    st.subheader("貨物データ編集")
    st.caption("行の追加/削除や数値の直接編集ができます。selected で対象行を選ぶと一括削除や mm→cm 変換が可能です。")
    editable_df = st.session_state["cargo_df"].copy()
    saved_selection = st.session_state.get("cargo_selected", [])
    selected_values = (saved_selection + [False] * len(editable_df))[: len(editable_df)]
    selected_series = _coerce_bool_series(pd.Series(selected_values)).fillna(False).astype(bool)
    editable_df.insert(0, "selected", selected_series)
    editable_df = _coerce_for_data_editor(editable_df)

    select_col1, select_col2 = st.columns(2)
    with select_col1:
        if st.button("selected を全選択", use_container_width=True):
            editable_df["selected"] = True
    with select_col2:
        if st.button("selected を全解除", use_container_width=True):
            editable_df["selected"] = False

    edited_df = st.data_editor(
        editable_df,
        use_container_width=True,
        num_rows="dynamic",
        column_config={
            "selected": st.column_config.CheckboxColumn("selected", help="一括操作対象として選択"),
            "id": st.column_config.TextColumn("id", help="必須: 識別ID"),
            "desc": st.column_config.TextColumn("desc", help="必須: 品名"),
            "qty": st.column_config.NumberColumn("qty", min_value=1, help="必須: 数量"),
            "L_cm": st.column_config.NumberColumn("L_cm", min_value=0.0, help="必須: 長さ(cm)"),
            "W_cm": st.column_config.NumberColumn("W_cm", min_value=0.0, help="必須: 幅(cm)"),
            "H_cm": st.column_config.NumberColumn("H_cm", min_value=0.0, help="必須: 高さ(cm)"),
            "weight_kg": st.column_config.NumberColumn("weight_kg", min_value=0.0, help="必須: 重量(kg)"),
            "package_text": st.column_config.TextColumn("package_text", help="任意: 荷姿表示"),
            "rotate_allowed": st.column_config.CheckboxColumn("rotate_allowed"),
            "stackable": st.column_config.CheckboxColumn("stackable"),
            "max_stack_load_kg": st.column_config.NumberColumn("max_stack_load_kg", min_value=0.0),
            "incompatible_with_ids": st.column_config.TextColumn("incompatible_with_ids"),
        },
    )
    edited_df = _coerce_for_data_editor(edited_df)

    action_col1, action_col2 = st.columns(2)
    with action_col1:
        if st.button("selected 行を削除", use_container_width=True):
            if "selected" in edited_df.columns and edited_df["selected"].any():
                edited_df = edited_df.loc[~edited_df["selected"]].copy()
                st.success("selected 行を削除しました。")
            else:
                st.warning("削除対象の行を selected してください。")
    with action_col2:
        if st.button("selected 行を mm→cm に変換", use_container_width=True):
            if "selected" in edited_df.columns and edited_df["selected"].any():
                target_mask = edited_df["selected"] == True
                for col in ["L_cm", "W_cm", "H_cm"]:
                    edited_df.loc[target_mask, col] = pd.to_numeric(edited_df.loc[target_mask, col], errors="coerce") / 10
                st.success("selected 行の L/W/H を mm→cm で補正しました。")
            else:
                st.warning("変換対象の行を selected してください。")

    st.session_state["cargo_selected"] = _coerce_bool_series(edited_df.get("selected", pd.Series(dtype="boolean"))).fillna(False).astype(bool).tolist()
    st.session_state["cargo_df"] = _normalize_cargo_dataframe(edited_df.drop(columns=["selected"], errors="ignore"))

    cargo_df = st.session_state.get("cargo_df", _empty_cargo_df())
    if cargo_df.empty:
        st.info("貨物データが未入力です。CSV読み込みまたはフォーム入力を行ってください。")
        st.stop()

    st.subheader("実行")
    st.caption("貨物データ反映後に、下のボタンで計算を実行します。")
    execute_clicked = st.button(execute_label, type="primary", use_container_width=True)

    try:
        cargo_rows = normalize_cargo_rows(cargo_df)
        pieces = expand_pieces(cargo_rows)
    except CargoInputError as exc:
        st.error(str(exc))
        st.stop()

    package_lookup = {piece.piece_id: map_package_text(piece.package_text, package_mapping) for piece in pieces}
    container_order = [name.strip() for name in container_order_text.split(",") if name.strip()]
    order_map = {name: idx for idx, name in enumerate(container_order)}
    constraints = PackingConstraints(
        max_cg_offset_x_pct=Decimal(str(max_cg_offset_x_pct)),
        max_cg_offset_y_pct=Decimal(str(max_cg_offset_y_pct)),
    )

    if flow_mode == "コンテナ本数を見積もる":
        st.subheader("必要本数の自動計算")
        standard_by_type = {spec.type: spec for spec in standard_specs}
        ordered_candidate_types = [t for t in container_order if t in standard_by_type]
        remaining_standard_types = [spec.type for spec in standard_specs if spec.type not in ordered_candidate_types]
        candidate_types = ordered_candidate_types + remaining_standard_types
        candidates = [standard_by_type[t] for t in candidate_types]

        if ordered_candidate_types:
            st.caption(
                "見積り候補は STANDARD コンテナ全種です。サイドバーの「コンテナ表示順」を反映した候補順で"
                "多種混合の自動評価を行い、未指定タイプは containers.yaml の定義順で続けます。"
            )
        else:
            st.caption("見積り候補は STANDARD コンテナ全種です。containers.yaml の定義順で多種混合の自動評価を行います。")
        if not execute_clicked:
            st.caption("準備ができたら「見積もり実行」を押してください。")

        if execute_clicked:
            if not ref_spec:
                st.error("OOG判定基準コンテナが見つかりません。")
            else:
                result = estimate(
                    pieces,
                    candidates,
                    ref_spec,
                    Decimal(str(bias_threshold)),
                    "MIN_CONTAINERS",
                    "MULTI_TYPE",
                    constraints,
                    special_specs,
                    int(small_lot_threshold_pieces),
                    Decimal(str(small_lot_threshold_m3)) if small_lot_threshold_m3 > 0 else None,
                )

                st.subheader("推奨本数")
                special_counts, _ = summarize_special_container_needs(result.oog_results)
                summary_counts = dict(result.summary_by_type)
                for ctype, count in special_counts.items():
                    summary_counts.setdefault(ctype, count)
                summary_df = pd.DataFrame(summary_counts.items(), columns=["type", "count"])
                summary_df["type"] = summary_df["type"].map(_format_container_type_label)
                st.dataframe(summary_df, use_container_width=True)

                breakbulk_summary = getattr(result, "breakbulk_summary", {})
                breakbulk_count = int(breakbulk_summary.get("count", 0))
                if breakbulk_count > 0:
                    st.info("一部貨物はコンテナ積載不可のため、在来船を推奨します。")
                    breakbulk_df = pd.DataFrame(
                        [
                            {
                                "区分": "在来船相当貨物（除外）",
                                "個数": breakbulk_count,
                                "重量(kg)": float(breakbulk_summary.get("total_weight_kg", 0)),
                                "F/T(m3)": float(breakbulk_summary.get("total_ft_m3", 0)),
                            }
                        ]
                    )
                    st.dataframe(breakbulk_df, use_container_width=True)
                st.download_button(
                    "本数見積CSVダウンロード",
                    data=summary_df.to_csv(index=False).encode("utf-8-sig"),
                    file_name="container_estimate.csv",
                    use_container_width=True,
                )

                estimate_plan_df = build_placement_rows(
                    result.placements,
                    {piece.piece_id: oog for piece, oog in result.oog_results},
                    result.bias_by_container,
                    order_map,
                    package_lookup,
                    getattr(result, "special_reason_by_piece", {}),
                )
                estimate_kpi_df = build_container_kpi_rows(estimate_plan_df)
                st.subheader("container KPI表（Estimate）")
                st.dataframe(estimate_kpi_df, use_container_width=True)

                _render_ai_review_section(
                    summary_df,
                    estimate_plan_df,
                    enabled=ai_double_check_enabled,
                    api_ready=ai_config_ready,
                )

                _render_result_block(result, order_map, package_lookup, title_prefix="Estimate")

    else:
        st.subheader("必要コンテナ本数の確定")
        st.caption("例: 20GP x2、40HC x1、40OT x1 のように本数を入力してください。")
        if not execute_clicked:
            st.caption("本数入力後、「バンプラン作成を実行」を押してください。")
        count_cols = st.columns(3)
        counts_by_type = {}
        for idx, spec in enumerate(container_specs):
            with count_cols[idx % 3]:
                counts_by_type[spec.type] = st.number_input(
                    f"{spec.type} 本数",
                    min_value=0,
                    max_value=100,
                    value=0,
                    step=1,
                    key=f"count_{spec.type}",
                )

        if execute_clicked:
            standard_count_specs = [(spec, int(counts_by_type.get(spec.type, 0))) for spec in standard_specs]
            standard_count_specs = [(spec, count) for spec, count in standard_count_specs if count > 0]
            if not standard_count_specs:
                st.error("少なくとも1つのSTANDARDコンテナ本数を入力してください。")
            else:
                remaining = list(pieces)
                placements = []
                bias_by_container = {}
                weight_audit_by_container = {}
                for spec, count in standard_count_specs:
                    if not remaining:
                        break
                    result = validate(
                        remaining,
                        spec,
                        count,
                        Decimal(str(bias_threshold)),
                        ref_spec,
                        constraints,
                    )
                    placements.extend(result.placements)
                    bias_by_container.update(result.bias_by_container)
                    weight_audit_by_container.update(getattr(result, "weight_audit_by_container", {}))
                    remaining = result.unplaced

                oog_results = [(piece, evaluate_oog(piece, ref_spec)) for piece in pieces]

                class CombinedResult:
                    def __init__(self, placements, unplaced, bias_by_container, weight_audit_by_container, oog_results):
                        self.placements = placements
                        self.unplaced = unplaced
                        self.bias_by_container = bias_by_container
                        self.weight_audit_by_container = weight_audit_by_container
                        self.oog_results = oog_results
                        self.special_reason_by_piece = {}

                combined = CombinedResult(placements, remaining, bias_by_container, weight_audit_by_container, oog_results)
                _render_result_block(combined, order_map, package_lookup, title_prefix="Loading")

                selected_counts = {k: int(v) for k, v in counts_by_type.items() if int(v) > 0}
                summary_df = pd.DataFrame(selected_counts.items(), columns=["type", "count"])
                st.subheader("確定したコンテナ本数")
                st.dataframe(summary_df, use_container_width=True)
                st.download_button(
                    "確定本数CSVダウンロード",
                    data=summary_df.to_csv(index=False).encode("utf-8-sig"),
                    file_name="fixed_container_counts.csv",
                    use_container_width=True,
                )

                plan_df = build_placement_rows(
                    combined.placements,
                    {piece.piece_id: oog for piece, oog in combined.oog_results},
                    combined.bias_by_container,
                    order_map,
                    package_lookup,
                    combined.special_reason_by_piece,
                    combined.weight_audit_by_container,
                )
                loading_kpi_df = build_container_kpi_rows(plan_df)
                st.subheader("container KPI表（Loading）")
                st.dataframe(loading_kpi_df, use_container_width=True)

                _render_ai_review_section(
                    summary_df,
                    plan_df,
                    enabled=ai_double_check_enabled,
                    api_ready=ai_config_ready,
                )

                lines = [
                    "Vanning Plan",
                    "Container counts: " + ", ".join([f"{t} x {c}" for t, c in selected_counts.items()]),
                    f"Placed pieces: {len(combined.placements)} / Total pieces: {len(pieces)}",
                    "---",
                ]
                for _, row in plan_df.head(40).iterrows():
                    lines.append(
                        f"{row['container_label']} | {row['cargo_piece_id']} | xyz=({row['placed_x_cm']},{row['placed_y_cm']},{row['placed_z_cm']})"
                    )
                st.download_button(
                    "バンニング図面PDFダウンロード",
                    data=build_text_pdf(lines),
                    file_name="vanning_plan.pdf",
                    mime="application/pdf",
                    use_container_width=True,
                )
                st.download_button(
                    "Loading結果 Excelダウンロード",
                    data=build_excel_report(plan_df, loading_kpi_df),
                    file_name="loading_result_report.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True,
                )
                st.caption("※ PDFは簡易図面（文字ベース）です。主帳票はExcelを利用してください。")
