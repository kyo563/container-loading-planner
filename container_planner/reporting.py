from __future__ import annotations

from decimal import Decimal
from typing import Dict, Iterable

import pandas as pd

from container_planner.models import BiasMetrics, OogResult, Placement
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
) -> pd.DataFrame:
    rows = []
    for placement in placements:
        piece = placement.piece
        oog = oog_lookup.get(piece.piece_id)
        bias = bias_lookup.get((placement.container_type, placement.container_index))
        package = package_lookup.get(piece.piece_id)
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
                "oog_suggestion": oog.suggestion if oog else "",
                "protrude_L_m3": oog.protrude_L_m3 if oog else Decimal("0"),
                "protrude_W_m3": oog.protrude_W_m3 if oog else Decimal("0"),
                "protrude_H_m3": oog.protrude_H_m3 if oog else Decimal("0"),
                "bias_warn": bias.bias_warn if bias else False,
                "bias_reason": bias.bias_reason if bias else "",
                "bias_offset_x_pct": bias.offset_x_pct if bias else Decimal("0"),
                "bias_offset_y_pct": bias.offset_y_pct if bias else Decimal("0"),
                "bias_front_rear_diff_pct": bias.front_rear_diff_pct if bias else Decimal("0"),
                "bias_left_right_diff_pct": bias.left_right_diff_pct if bias else Decimal("0"),
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
