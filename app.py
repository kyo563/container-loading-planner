from decimal import Decimal

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
from container_planner.pdf_export import build_text_pdf

st.set_page_config(page_title="コンテナ詰め算出アプリ", layout="wide")
st.title("コンテナ詰め算出アプリ")


def _to_decimal(value):
    if value is None:
        return None
    return Decimal(str(value))


with st.sidebar:
    st.header("共通設定")
    bias_threshold = st.number_input("偏荷重警告閾値(%)", min_value=0.0, max_value=100.0, value=20.0)
    container_order_text = st.text_input("コンテナ表示順 (カンマ区切り)", value="20GP,40GP,40HC,OT,FR,RF")
    st.subheader("追加制約")
    max_cg_offset_x_pct = st.number_input("重心X偏差上限(%)", min_value=0.0, max_value=100.0, value=100.0)
    max_cg_offset_y_pct = st.number_input("重心Y偏差上限(%)", min_value=0.0, max_value=100.0, value=100.0)

st.subheader("貨物データ入力")
col1, col2 = st.columns(2)
with col1:
    cargo_file = st.file_uploader("貨物CSVアップロード", type=["csv"], key="cargo")
with col2:
    cargo_text = st.text_area("貨物CSVテキスト貼り付け", height=150)

cargo_df = None
if cargo_file is not None:
    cargo_df = pd.read_csv(cargo_file)
elif cargo_text.strip():
    cargo_df = load_cargo_csv(cargo_text)
else:
    try:
        cargo_df = pd.read_csv("data/cargo.sample.csv")
    except (FileNotFoundError, EmptyDataError):
        cargo_df = None

if cargo_df is not None:
    cargo_df = st.data_editor(cargo_df, num_rows="dynamic")

st.subheader("荷姿マスタ (任意)")
package_file = st.file_uploader("荷姿マスタCSVアップロード", type=["csv"], key="package")
package_text = st.text_area("荷姿マスタCSVテキスト貼り付け", height=120)

package_mapping = {}
if package_file is not None:
    package_mapping = load_package_master(package_file.getvalue().decode("utf-8"))
elif package_text.strip():
    package_mapping = load_package_master(package_text)

st.subheader("コンテナ仕様 (任意)")
container_file = st.file_uploader("containers.yaml アップロード", type=["yaml", "yml"], key="container")
container_text = st.text_area("containers.yaml テキスト貼り付け", height=120)

containers_yaml = None
if container_file is not None:
    containers_yaml = container_file.getvalue().decode("utf-8")
elif container_text.strip():
    containers_yaml = container_text

container_specs = []
if containers_yaml:
    try:
        data = yaml.safe_load(containers_yaml)
        for item in data.get("containers", []):
            container_specs.append(
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
    except Exception as exc:  # noqa: BLE001
        st.error(f"containers.yaml 読み込みに失敗しました: {exc}")

standard_specs = [spec for spec in container_specs if spec.category == "STANDARD"]
ref_options = [spec.type for spec in standard_specs]
ref_choice = st.selectbox("OOG判定基準コンテナ", options=ref_options) if ref_options else None
ref_spec = next((spec for spec in standard_specs if spec.type == ref_choice), None)

if cargo_df is None:
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

tab_estimate, tab_validate = st.tabs(["Estimate", "Validate"])

with tab_estimate:
    st.header("① 必要本数の自動計算")
    candidate_types = st.multiselect("候補STANDARDコンテナ", options=[spec.type for spec in standard_specs])
    mode = st.selectbox("目的関数", options=["MIN_CONTAINERS", "MIN_COST"])
    algorithm = st.selectbox("最適化アルゴリズム", options=["SINGLE_TYPE", "MULTI_TYPE"])
    if st.button("Estimate 実行"):
        if not ref_spec or not candidate_types:
            st.error("OOG判定基準と候補コンテナを選択してください")
        else:
            candidates = [spec for spec in standard_specs if spec.type in candidate_types]
            constraints = PackingConstraints(
                max_cg_offset_x_pct=Decimal(str(max_cg_offset_x_pct)),
                max_cg_offset_y_pct=Decimal(str(max_cg_offset_y_pct)),
            )
            result = estimate(pieces, candidates, ref_spec, Decimal(str(bias_threshold)), mode, algorithm, constraints)
            special_counts = summarize_special_container_needs(result.oog_results)

            st.subheader("推奨本数")
            summary_df = pd.DataFrame(result.summary_by_type.items(), columns=["type", "count"])
            if special_counts:
                summary_df = pd.concat(
                    [summary_df, pd.DataFrame(special_counts.items(), columns=["type", "count"])],
                    ignore_index=True,
                )
            st.dataframe(summary_df)
            st.download_button(
                "本数見積CSVダウンロード",
                data=summary_df.to_csv(index=False).encode("utf-8-sig"),
                file_name="container_estimate.csv",
            )

            oog_lookup = {piece.piece_id: oog for piece, oog in result.oog_results}
            df = build_placement_rows(result.placements, oog_lookup, result.bias_by_container, order_map, package_lookup)
            st.subheader("配置一覧")
            st.dataframe(df)
            st.download_button(
                "配置一覧CSVダウンロード",
                data=df.to_csv(index=False).encode("utf-8-sig"),
                file_name="placements.csv",
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
                            "reason_hint": "寸法/重量/制約で積載不可",
                        }
                        for p in result.unplaced
                    ]
                )
                st.dataframe(unplaced_df)
            else:
                st.success("積載不可貨物はありません")

            if not df.empty:
                st.subheader("2D配置ビュー（上面）")
                view_df = df[["container_label", "cargo_piece_id", "placed_x_cm", "placed_y_cm", "placed_z_cm"]].copy()
                st.scatter_chart(view_df, x="placed_x_cm", y="placed_y_cm", color="container_label")

                st.subheader("3D配置ビュー")
                chart_data = df[["placed_x_cm", "placed_y_cm", "placed_z_cm"]].copy()
                chart_data["placed_x_cm"] = pd.to_numeric(chart_data["placed_x_cm"])
                chart_data["placed_y_cm"] = pd.to_numeric(chart_data["placed_y_cm"])
                chart_data["placed_z_cm"] = pd.to_numeric(chart_data["placed_z_cm"])
                st.pydeck_chart(
                    pdk.Deck(
                        map_style=None,
                        initial_view_state=pdk.ViewState(
                            latitude=0,
                            longitude=0,
                            zoom=0,
                            pitch=45,
                        ),
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
                    )
                )

            gross_map = estimate_gross_weight_by_container(result.placements, special_counts)
            gross_df = pd.DataFrame(gross_map.items(), columns=["container", "estimated_gross_kg"])
            st.subheader("④ 推定トータルグロスウェイト")
            st.dataframe(gross_df)

            if result.oog_results:
                max_over_w = max([oog.over_W_cm for _, oog in result.oog_results])
                max_over_h = max([oog.over_H_cm for _, oog in result.oog_results])
            else:
                max_over_w = Decimal("0")
                max_over_h = Decimal("0")
            total_gross = sum(gross_map.values(), Decimal("0"))
            advice = suggest_truck_requirement(total_gross, max_over_w, max_over_h)
            st.info(f"国内配送要件提案: {advice}")

with tab_validate:
    st.header("② ローディングプラン作成")
    validate_type = st.selectbox("検証対象STANDARDコンテナ", options=[spec.type for spec in standard_specs])
    validate_count = st.number_input("本数", min_value=1, max_value=100, value=1)
    if st.button("Validate 実行"):
        if not ref_spec:
            st.error("OOG判定基準コンテナを選択してください")
        else:
            spec = next(spec for spec in standard_specs if spec.type == validate_type)
            constraints = PackingConstraints(
                max_cg_offset_x_pct=Decimal(str(max_cg_offset_x_pct)),
                max_cg_offset_y_pct=Decimal(str(max_cg_offset_y_pct)),
            )
            result = validate(
                pieces,
                spec,
                int(validate_count),
                Decimal(str(bias_threshold)),
                ref_spec,
                constraints,
            )
            oog_lookup = {piece.piece_id: oog for piece, oog in result.oog_results}
            df = build_placement_rows(result.placements, oog_lookup, result.bias_by_container, order_map, package_lookup)
            st.dataframe(df)

            st.download_button(
                "バンニングプランCSVダウンロード",
                data=df.to_csv(index=False).encode("utf-8-sig"),
                file_name="vanning_plan.csv",
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
                            "reason_hint": "本数不足または制約超過",
                        }
                        for p in result.unplaced
                    ]
                )
                st.dataframe(unplaced_df)
            else:
                st.success("積載不可貨物はありません")
            lines = [
                "Vanning Plan",
                f"Container: {validate_type} x {int(validate_count)}",
                f"Placed pieces: {len(result.placements)} / Total pieces: {len(pieces)}",
                "---",
            ]
            for _, row in df.head(40).iterrows():
                lines.append(
                    f"{row['container_label']} | {row['cargo_piece_id']} | xyz=({row['placed_x_cm']},{row['placed_y_cm']},{row['placed_z_cm']})"
                )
            pdf_bytes = build_text_pdf(lines)
            st.download_button(
                "バンニング図面PDFダウンロード",
                data=pdf_bytes,
                file_name="vanning_plan.pdf",
                mime="application/pdf",
            )
            st.caption("※ PDFは簡易図面（文字ベース）です。")
