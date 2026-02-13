from __future__ import annotations

from collections import Counter
from decimal import Decimal

from container_planner.models import OogResult, Piece, Placement

TARE_WEIGHT_KG = {
    "20GP": Decimal("2300"),
    "40GP": Decimal("3800"),
    "40HC": Decimal("3900"),
    "OT": Decimal("4200"),
    "FR": Decimal("5500"),
    "RF": Decimal("4800"),
}

RF_KEYWORDS = {"reefer", "refrigerated", "frozen", "cold", "冷凍", "冷蔵", "RF"}


def recommend_special_container(piece: Piece, oog: OogResult) -> str:
    text = f"{piece.desc} {piece.package_text}".lower()
    if any(keyword.lower() in text for keyword in RF_KEYWORDS):
        return "RF"
    if oog.over_W_cm > 0 or oog.over_L_cm > 0:
        return "FR"
    if oog.over_H_cm > 0:
        return "OT"
    return "20GP"


def summarize_special_container_needs(oog_results: list[tuple[Piece, OogResult]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for piece, oog in oog_results:
        if not oog.oog_flag:
            continue
        counter[recommend_special_container(piece, oog)] += 1
    return dict(counter)


def estimate_gross_weight_by_container(
    placements: list[Placement],
    special_counts: dict[str, int],
    oog_results: list[tuple[Piece, OogResult]] | None = None,
) -> dict[str, Decimal]:
    grouped: dict[str, Decimal] = {}
    for placement in placements:
        key = f"{placement.container_type}-{placement.container_index}"
        grouped.setdefault(key, Decimal("0"))
        grouped[key] += placement.piece.weight_kg
    result: dict[str, Decimal] = {}
    for key, cargo_weight in grouped.items():
        ctype = key.split("-")[0]
        tare = TARE_WEIGHT_KG.get(ctype, Decimal("0"))
        result[key] = cargo_weight + tare
    special_cargo_weights: dict[str, list[Decimal]] = {}
    for piece, oog in oog_results or []:
        if not oog.oog_flag:
            continue
        ctype = recommend_special_container(piece, oog)
        special_cargo_weights.setdefault(ctype, []).append(piece.weight_kg)

    for ctype, count in special_counts.items():
        tare = TARE_WEIGHT_KG.get(ctype, Decimal("0"))
        cargo_weights = special_cargo_weights.get(ctype, [])
        for idx in range(1, count + 1):
            key = f"{ctype}-S{idx}"
            cargo_weight = cargo_weights[idx - 1] if idx <= len(cargo_weights) else Decimal("0")
            result[key] = tare + cargo_weight
    return result


def suggest_truck_requirement(gross_kg: Decimal, max_over_w_cm: Decimal, max_over_h_cm: Decimal) -> str:
    notes = []
    if max_over_h_cm > 0:
        notes.append("高さ超過のため低床シャーシを推奨")
    if max_over_w_cm > 0:
        notes.append("幅超過のため特殊車両通行許可の事前確認を推奨")
    if gross_kg > Decimal("30000"):
        notes.append("総重量が大きいため3軸以上トレーラーを推奨")
    if not notes:
        return "一般的な海上コンテナ用シャーシで輸送可能見込み"
    return " / ".join(notes)
