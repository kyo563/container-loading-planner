from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pandas as pd
from pandas.errors import EmptyDataError
import pydeck as pdk
import streamlit as st
import yaml

from container_planner import (
    CargoInputError,
    build_placement_rows,
    estimate,
    expand_pieces,
    load_cargo_csv,
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
from container_planner.models import ContainerSpec, PackingConstraints
from container_planner.oog import evaluate_oog
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
    max_payload_kg: 28200
    cost: 1.0
  - type: 40GP
    category: STANDARD
    inner_L_cm: 1203
    inner_W_cm: 235
    inner_H_cm: 239
    max_payload_kg: 26700
    cost: 1.7
  - type: 40HC
    category: STANDARD
    inner_L_cm: 1203
    inner_W_cm: 235
    inner_H_cm: 269
    max_payload_kg: 26600
    cost: 1.9
  - type: OT
    category: SPECIAL
    deck_L_cm: 1200
    deck_W_cm: 235
    max_payload_kg: 28000
  - type: FR
    category: SPECIAL
    deck_L_cm: 1160
    deck_W_cm: 240
    max_payload_kg: 34000
  - type: RF
    category: SPECIAL
    inner_L_cm: 1150
    inner_W_cm: 228
    inner_H_cm: 220
    max_payload_kg: 27500
""".strip()

REQUIRED_COLUMNS = ["id", "desc", "qty", "L_cm", "W_cm", "H_cm", "weight_kg"]
OPTIONAL_COLUMNS = ["package_text", "rotate_allowed", "stackable", "max_stack_load_kg", "incompatible_with_ids"]
ALL_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS


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
    return pd.DataFrame(columns=ALL_COLUMNS)


def _normalize_cargo_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in ALL_COLUMNS:
        if col not in out.columns:
            out[col] = None
    out = out[ALL_COLUMNS]
    if out.empty:
        return _empty_cargo_df()
    out["rotate_allowed"] = out["rotate_allowed"].fillna(True)
    out["stackable"] = out["stackable"].fillna(True)
    out["incompatible_with_ids"] = out["incompatible_with_ids"].fillna("")
    return out


def _read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _render_result_block(result, order_map, package_lookup, title_prefix: str):
    special_counts = summarize_special_container_needs(result.oog_results)
    oog_lookup = {piece.piece_id: oog for piece, oog in result.oog_results}
    df = build_placement_rows(result.placements, oog_lookup, result.bias_by_container, order_map, package_lookup)

    st.subheader(f"{title_prefix} 配置一覧")
    st.dataframe(df, use_container_width=True)
    st.download_button(
        f"{title_prefix} 配置CSVダウンロード",
        data=df.to_csv(index=False).encode("utf-8-sig"),
        file_name=f"{title_prefix.lower()}_placements.csv",
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
    gross_df = pd.DataFrame(gross_map.items(), columns=["container", "estimated_gross_kg"])
    st.subheader("推定トータルグロスウェイト")
    st.dataframe(gross_df, use_container_width=True)

    max_over_w = max([oog.over_W_cm for _, oog in result.oog_results], default=Decimal("0"))
    max_over_h = max([oog.over_H_cm for _, oog in result.oog_results], default=Decimal("0"))
    total_gross = sum(gross_map.values(), Decimal("0"))
    advice = suggest_truck_requirement(total_gross, max_over_w, max_over_h)
    st.info(f"国内配送要件提案: {advice}")


with st.sidebar:
    st.header("共通設定")
    bias_threshold = st.number_input(
        "偏荷重警告閾値(%)",
        min_value=0.0,
        max_value=100.0,
        value=20.0,
        help="重心偏りの警告を出す基準値です。",
    )
    container_order_text = st.text_input(
        "コンテナ表示順 (カンマ区切り)",
        value="20GP,40GP,40HC,OT,FR,RF",
        placeholder="例: 20GP,40GP,40HC,OT,FR,RF",
    )
    st.subheader("追加制約")
    max_cg_offset_x_pct = st.number_input("重心X偏差上限(%)", min_value=0.0, max_value=100.0, value=100.0)
    max_cg_offset_y_pct = st.number_input("重心Y偏差上限(%)", min_value=0.0, max_value=100.0, value=100.0)

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
if not standard_specs:
    st.warning("STANDARDコンテナ仕様がありません。データメンテナンスタブでコンテナ仕様を確認してください。")
    st.stop()

ref_options = [spec.type for spec in standard_specs]
ref_choice = "40HC" if "40HC" in ref_options else ref_options[0]
ref_spec = next((spec for spec in standard_specs if spec.type == ref_choice), None)
st.caption(f"OOG判定基準コンテナ: {ref_choice}（見積り基準）")

with main_tab:
    st.header("計画作成")
    st.caption("①本数条件を選択 → ②パッキングリスト入力 → ③バンプラン作成 の順で進めます。")

    flow_mode = st.radio(
        "まずどちらで進めますか？",
        options=["コンテナ本数が決まっている", "コンテナ本数を見積もる"],
        horizontal=True,
    )
    execute_clicked = st.button("見積もり開始 / バンプラン実行", type="primary", use_container_width=True)
    st.caption("上のボタンを押すと、現在のモード設定で計算を実行します。")

    st.subheader("パッキングリスト入力")
    cargo_col1, cargo_col2 = st.columns(2)
    with cargo_col1:
        cargo_file = st.file_uploader("貨物CSVアップロード", type=["csv"], key="cargo")
    with cargo_col2:
        cargo_text = st.text_area(
            "貨物CSVテキスト貼り付け",
            height=180,
            placeholder="ItemID,CargoName,Qty,L,W,H,Gross,Style,Rotate,Stackable,MaxTopLoad,IncompatibleIDs\nA001,Machine,1,100,80,50,500,CRATE,TRUE,FALSE,,",
        )

    st.caption("CSVヘッダーは簡易英語で入力できます（例: ItemID / CargoName / Qty / L / W / H / Gross / Style）。単位は L/W/H=cm、Gross=kg です。")
    template_col1, template_col2 = st.columns(2)
    with template_col1:
        st.download_button(
            "貨物CSVテンプレートをダウンロード",
            data=_read_text("data/cargo.template.csv").encode("utf-8-sig"),
            file_name="cargo_template.csv",
            mime="text/csv",
            use_container_width=True,
        )
    with template_col2:
        st.caption("任意列（Style/Rotate/Stackable/MaxTopLoad/IncompatibleIDs）も含むテンプレートです。")

    csv_col1, csv_col2 = st.columns(2)
    if csv_col1.button("サンプル貨物を読み込む", use_container_width=True):
        try:
            sample_df = load_cargo_csv(_read_text("data/cargo.sample.csv"))
            st.session_state["cargo_df"] = _normalize_cargo_dataframe(sample_df)
            st.success("サンプル貨物を読み込みました。")
        except Exception as exc:  # noqa: BLE001
            st.error(f"サンプル貨物の読み込みに失敗しました: {exc}")

    if csv_col2.button("貨物CSV入力を反映", use_container_width=True):
        try:
            if cargo_file is not None:
                loaded_df = load_cargo_csv(cargo_file.getvalue().decode("utf-8"))
                st.session_state["cargo_df"] = _normalize_cargo_dataframe(loaded_df)
            elif cargo_text.strip():
                loaded_df = load_cargo_csv(cargo_text)
                st.session_state["cargo_df"] = _normalize_cargo_dataframe(loaded_df)
            else:
                st.warning("CSVをアップロードするか、テキストを入力してください。")
            st.success("貨物データを反映しました。")
        except EmptyDataError:
            st.error("貨物CSVが空です。内容を入力してください。")
        except CargoInputError as exc:
            st.error(str(exc))
        except Exception as exc:  # noqa: BLE001
            st.error(f"入力の読み込みに失敗しました: {exc}")

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
    selected_series = pd.Series(selected_values, dtype="boolean").fillna(False).astype(bool)
    editable_df.insert(0, "selected", selected_series)

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

    st.session_state["cargo_selected"] = edited_df.get("selected", pd.Series(dtype=bool)).fillna(False).tolist()
    st.session_state["cargo_df"] = _normalize_cargo_dataframe(edited_df.drop(columns=["selected"], errors="ignore"))

    cargo_df = st.session_state.get("cargo_df", _empty_cargo_df())
    if cargo_df.empty:
        st.info("貨物データが未入力です。CSV読み込みまたはフォーム入力を行ってください。")
        st.stop()

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
        fixed_candidate_order = ["20GP", "40GP", "40HC"]
        candidates = [spec for t in fixed_candidate_order for spec in standard_specs if spec.type == t]
        if not candidates:
            candidates = list(standard_specs)
        st.caption("見積り優先順位: 20GP（収まる場合）→ 40GP → 40HC。40HCを計算基準に固定。")

        if execute_clicked:
            if not ref_spec:
                st.error("OOG判定基準コンテナが見つかりません。")
            else:
                result = estimate(
                    pieces,
                    candidates,
                    ref_spec,
                    Decimal(str(bias_threshold)),
                    "FIXED_PRIORITY",
                    "SINGLE_TYPE",
                    constraints,
                )

                st.subheader("推奨本数")
                special_counts = summarize_special_container_needs(result.oog_results)
                summary_df = pd.DataFrame(result.summary_by_type.items(), columns=["type", "count"])
                if special_counts:
                    summary_df = pd.concat(
                        [summary_df, pd.DataFrame(special_counts.items(), columns=["type", "count"])],
                        ignore_index=True,
                    )
                st.dataframe(summary_df, use_container_width=True)
                st.download_button(
                    "本数見積CSVダウンロード",
                    data=summary_df.to_csv(index=False).encode("utf-8-sig"),
                    file_name="container_estimate.csv",
                    use_container_width=True,
                )

                _render_result_block(result, order_map, package_lookup, title_prefix="Estimate")

    else:
        st.subheader("必要コンテナ本数の確定")
        st.caption("例: 20GP x2、40HC x1、OT x1 のように本数を入力してください。")
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
                    remaining = result.unplaced

                oog_results = [(piece, evaluate_oog(piece, ref_spec)) for piece in pieces]

                class CombinedResult:
                    def __init__(self, placements, unplaced, bias_by_container, oog_results):
                        self.placements = placements
                        self.unplaced = unplaced
                        self.bias_by_container = bias_by_container
                        self.oog_results = oog_results

                combined = CombinedResult(placements, remaining, bias_by_container, oog_results)
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
                st.caption("※ PDFは簡易図面（文字ベース）です。")
