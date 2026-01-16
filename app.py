import io
from decimal import Decimal

import pandas as pd
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
from container_planner.models import ContainerSpec

st.set_page_config(page_title="コンテナ詰め算出アプリ", layout="wide")

st.title("コンテナ詰め算出アプリ")


def _to_decimal(value):
    if value is None:
        return None
    return Decimal(str(value))


with st.sidebar:
    st.header("共通設定")
    bias_threshold = st.number_input("偏荷重警告閾値(%)", min_value=0.0, max_value=100.0, value=20.0)
    container_order_text = st.text_input("コンテナ表示順 (カンマ区切り)", value="20GP,40GP,40HC,OT,FR")

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
        sample = pd.read_csv("data/cargo.sample.csv")
        cargo_df = sample
    except FileNotFoundError:
        cargo_df = None

if cargo_df is not None:
    st.caption("取り込み後の編集テーブル")
    cargo_df = st.data_editor(cargo_df, num_rows="dynamic")

st.subheader("荷姿マスタ (任意)")
package_file = st.file_uploader("荷姿マスタCSVアップロード", type=["csv"], key="package")
package_text = st.text_area("荷姿マスタCSVテキスト貼り付け", height=120)

package_mapping = {}
if package_file is not None:
    package_mapping = load_package_master(package_file.getvalue().decode("utf-8"))
elif package_text.strip():
    package_mapping = load_package_master(package_text)
else:
    try:
        package_mapping = load_package_master(open("data/package_master.sample.csv", encoding="utf-8").read())
    except FileNotFoundError:
        package_mapping = {}

st.subheader("コンテナ仕様 (任意)")
container_file = st.file_uploader("containers.yaml アップロード", type=["yaml", "yml"], key="container")
container_text = st.text_area("containers.yaml テキスト貼り付け", height=120)

containers_yaml = None
if container_file is not None:
    containers_yaml = container_file.getvalue().decode("utf-8")
elif container_text.strip():
    containers_yaml = container_text
else:
    try:
        containers_yaml = open("data/containers.sample.yaml", encoding="utf-8").read()
    except FileNotFoundError:
        containers_yaml = None

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

if ref_choice:
    ref_spec = next(spec for spec in standard_specs if spec.type == ref_choice)
else:
    ref_spec = None

if cargo_df is None:
    st.stop()

try:
    cargo_rows = normalize_cargo_rows(cargo_df)
    pieces = expand_pieces(cargo_rows)
except CargoInputError as exc:
    st.error(str(exc))
    st.stop()

package_lookup = {}
for piece in pieces:
    result = map_package_text(piece.package_text, package_mapping)
    package_lookup[piece.piece_id] = result

container_order = [name.strip() for name in container_order_text.split(",") if name.strip()]
order_map = {name: idx for idx, name in enumerate(container_order)}

tab_estimate, tab_validate = st.tabs(["Estimate", "Validate"])

with tab_estimate:
    st.header("本数見積り")
    candidate_types = st.multiselect("候補STANDARDコンテナ", options=[spec.type for spec in standard_specs])
    mode = st.selectbox("目的関数", options=["MIN_CONTAINERS", "MIN_COST"])
    algorithm = st.selectbox("アルゴリズム", options=["MIXED_GREEDY", "SINGLE_TYPE"])
    if st.button("Estimate 実行"):
        if not ref_spec:
            st.error("OOG判定基準コンテナを選択してください")
        elif not candidate_types:
            st.error("候補コンテナを選択してください")
        else:
            candidates = [spec for spec in standard_specs if spec.type in candidate_types]
            result = estimate(
                pieces,
                candidates,
                ref_spec,
                Decimal(str(bias_threshold)),
                mode,
                algorithm,
            )
            st.subheader("推奨本数")
            st.dataframe(pd.DataFrame(result.summary_by_type.items(), columns=["type", "count"]))
            st.subheader("警告一覧")
            st.write(
                f"未積載: {len(result.unplaced)} 件, OOG: {len(result.oog_results)} 件"
            )
            oog_lookup = {piece.piece_id: oog for piece, oog in result.oog_results}
            bias_lookup = result.bias_by_container
            df = build_placement_rows(result.placements, oog_lookup, bias_lookup, order_map, package_lookup)
            st.subheader("配置一覧")
            st.dataframe(df)
            csv_bytes = df.to_csv(index=False).encode("utf-8")
            st.download_button("配置一覧CSVダウンロード", data=csv_bytes, file_name="placements.csv")

with tab_validate:
    st.header("収まり検証")
    validate_type = st.selectbox("検証対象STANDARDコンテナ", options=[spec.type for spec in standard_specs])
    validate_count = st.number_input("本数", min_value=1, max_value=100, value=1)
    if st.button("Validate 実行"):
        if not ref_spec:
            st.error("OOG判定基準コンテナを選択してください")
        else:
            spec = next(spec for spec in standard_specs if spec.type == validate_type)
            result = validate(
                pieces,
                spec,
                int(validate_count),
                Decimal(str(bias_threshold)),
                ref_spec,
            )
            st.subheader("収まり判定")
            if result.unplaced:
                st.warning("未積載があります")
            else:
                st.success("全量収まりました")
            oog_lookup = {piece.piece_id: oog for piece, oog in result.oog_results}
            bias_lookup = result.bias_by_container
            df = build_placement_rows(result.placements, oog_lookup, bias_lookup, order_map, package_lookup)
            st.subheader("配置一覧")
            st.dataframe(df)
            csv_bytes = df.to_csv(index=False).encode("utf-8")
            st.download_button("配置一覧CSVダウンロード", data=csv_bytes, file_name="placements_validate.csv")
