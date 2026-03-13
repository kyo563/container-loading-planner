from __future__ import annotations

from decimal import Decimal
from typing import Dict, Iterable

import pandas as pd

from container_planner.models import BiasMetrics, OogResult, Placement, WeightAuditMetrics
from container_planner.naccs import NaccsResult

CIRCLED = {
    1: "①",
    2: "②",
    3: "③",
    4: "④",
    5: "⑤",
    6: "⑥",
    7: "⑦",
    8: "⑧",
    9: "⑨",
    10: "⑩",
    11: "⑪",
    12: "⑫",
    13: "⑬",
    14: "⑭",
    15: "⑮",
    16: "⑯",
    17: "⑰",
    18: "⑱",
    19: "⑲",
    20: "⑳",
}


def label_container(container_type: str, index: int) -> str:
    suffix = CIRCLED.get(index, str(index))
    return f"{container_type} {suffix}"


def build_placement_rows(
    placements: Iterable[Placement],
    oog_lookup: Dict[str, OogResult],
    bias_lookup: Dict[tuple, BiasMetrics],
    order_map: Dict[str, int],
    package_lookup: Dict[str, NaccsResult],
    special_reason_lookup: Dict[str, str] | None = None,
    weight_audit_lookup: Dict[tuple, WeightAuditMetrics] | None = None,
) -> pd.DataFrame:
    rows = []
    for sequence_no, placement in enumerate(placements, start=1):
        piece = placement.piece
        oog = oog_lookup.get(piece.piece_id)
        bias = bias_lookup.get((placement.container_type, placement.container_index))
        package = package_lookup.get(piece.piece_id)
        reason = (special_reason_lookup or {}).get(piece.piece_id, "")
        weight_audit = (weight_audit_lookup or {}).get((placement.container_type, placement.container_index))
        rows.append(
            {
                "container_label": label_container(placement.container_type, placement.container_index),
                "container_type": placement.container_type,
                "container_category": placement.container_category,
                "container_index": placement.container_index,
                "cargo_piece_id": piece.piece_id,
                "orig_id": piece.orig_id,
                "piece_no": piece.piece_no,
                "desc": piece.desc,
                "package_text": piece.package_text,
                "package_code": package.code if package else "",
                "package_code_status": package.status if package else "",
                "L_cm": piece.L_cm,
                "W_cm": piece.W_cm,
                "H_cm": piece.H_cm,
                "weight_kg": piece.weight_kg,
                "m3": piece.m3,
                "rotate_allowed": piece.rotate_allowed,
                "stackable": piece.stackable,
                "placed_x_cm": placement.placed_x_cm,
                "placed_y_cm": placement.placed_y_cm,
                "placed_z_cm": placement.placed_z_cm,
                "orient_L_cm": placement.orient_L_cm,
                "orient_W_cm": placement.orient_W_cm,
                "orient_H_cm": placement.orient_H_cm,
                "rotation_key": placement.rotation_key,
                "oog_flag": oog.oog_flag if oog else False,
                "oog_ref_type": oog.oog_ref_type if oog else "",
                "oog_over_L_cm": oog.over_L_cm if oog else Decimal("0"),
                "oog_over_W_cm": oog.over_W_cm if oog else Decimal("0"),
                "oog_over_H_cm": oog.over_H_cm if oog else Decimal("0"),
                "OW(each)": oog.over_W_cm if oog else Decimal("0"),
                "OH": oog.over_H_cm if oog else Decimal("0"),
                "special_container_reason": reason,
                "oog_suggestion": oog.suggestion if oog else "",
                "protrude_L_m3": oog.protrude_L_m3 if oog else Decimal("0"),
                "protrude_W_m3": oog.protrude_W_m3 if oog else Decimal("0"),
                "protrude_H_m3": oog.protrude_H_m3 if oog else Decimal("0"),
                "door_check_applied": oog.door_check_applied if oog else False,
                "door_passable": oog.door_passable if oog else True,
                "door_over_W_cm": oog.door_over_W_cm if oog else Decimal("0"),
                "door_over_H_cm": oog.door_over_H_cm if oog else Decimal("0"),
                "door_reason": oog.door_reason if oog else "",
                "bias_warn": bias.bias_warn if bias else False,
                "bias_reason": bias.bias_reason if bias else "",
                "bias_offset_x_pct": bias.offset_x_pct if bias else Decimal("0"),
                "bias_offset_y_pct": bias.offset_y_pct if bias else Decimal("0"),
                "bias_front_rear_diff_pct": bias.front_rear_diff_pct if bias else Decimal("0"),
                "bias_left_right_diff_pct": bias.left_right_diff_pct if bias else Decimal("0"),
                "weight_alert": weight_audit.weight_alert if weight_audit else False,
                "weight_alert_message": weight_audit.weight_alert_message if weight_audit else "",
                "container_total_weight_kg": weight_audit.total_weight_kg if weight_audit else Decimal("0"),
                "payload_ratio_pct": weight_audit.payload_ratio_pct if weight_audit else Decimal("0"),
                "vehicle_limit_ratio_pct": weight_audit.vehicle_limit_ratio_pct if weight_audit else Decimal("0"),
                "weight_concentration_top_n_ratio_pct": weight_audit.concentration_top_n_ratio_pct if weight_audit else Decimal("0"),
                "loading_sequence": sequence_no,
            }
        )
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["container_order"] = df["container_type"].map(order_map).fillna(999)
    df = df.sort_values(
        by=[
            "container_order",
            "container_index",
            "placed_z_cm",
            "placed_y_cm",
            "placed_x_cm",
            "cargo_piece_id",
        ]
    )
    df = df.drop(columns=["container_order"])
    return df


def build_container_kpi_rows(placements_df: pd.DataFrame) -> pd.DataFrame:
    headers = [
        "container_label",
        "container_type",
        "total_ft",
        "total_m3",
        "total_gross_kg",
        "max_single_gross_kg",
    ]
    if placements_df.empty:
        return pd.DataFrame(columns=headers)

    numeric_df = placements_df.copy()
    numeric_df["weight_kg"] = pd.to_numeric(numeric_df["weight_kg"], errors="coerce").fillna(0)
    numeric_df["m3"] = pd.to_numeric(numeric_df["m3"], errors="coerce").fillna(0)

    kpi_df = (
        numeric_df.groupby(["container_label", "container_type"], as_index=False)
        .agg(
            total_m3=("m3", "sum"),
            total_gross_kg=("weight_kg", "sum"),
            max_single_gross_kg=("weight_kg", "max"),
        )
        .sort_values(["container_type", "container_label"])
    )
    kpi_df["total_ft"] = (kpi_df["total_gross_kg"] / 1000).combine(kpi_df["total_m3"], max)
    return kpi_df[headers]


def build_loading_plan_rows(placements_df: pd.DataFrame) -> pd.DataFrame:
    columns = [
        "container_label",
        "step",
        "cargo_piece_id",
        "desc",
        "instruction",
    ]
    if placements_df.empty:
        return pd.DataFrame(columns=columns)

    ordered = placements_df.copy()
    if "loading_sequence" in ordered.columns:
        ordered = ordered.sort_values(["container_type", "container_index", "loading_sequence", "cargo_piece_id"])
    else:
        ordered = ordered.sort_values(["container_type", "container_index", "placed_z_cm", "placed_y_cm", "placed_x_cm", "cargo_piece_id"])

    ordered["step"] = ordered.groupby("container_label").cumcount() + 1
    ordered["instruction"] = ordered.apply(
        lambda row: (
            f"{int(row['step'])}. {row['cargo_piece_id']} ({row['desc']}) を "
            f"x={float(row['placed_x_cm']):.1f}cm, y={float(row['placed_y_cm']):.1f}cm, z={float(row['placed_z_cm']):.1f}cm に配置"
        ),
        axis=1,
    )
    return ordered[columns]

