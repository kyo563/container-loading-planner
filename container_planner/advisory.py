from __future__ import annotations

from collections import Counter
from decimal import Decimal

from container_planner.models import ContainerLoad, OogResult, Piece, Placement, WeightAdvisory

TARE_WEIGHT_KG = {
    "20GP": Decimal("2300"),
    "40GP": Decimal("3800"),
    "40HC": Decimal("3900"),
    "OT": Decimal("4200"),
    "FR": Decimal("5500"),
    "RF": Decimal("4800"),
}

RF_KEYWORDS = {"reefer", "refrigerated", "frozen", "cold", "冷凍", "冷蔵", "RF"}
DEFAULT_WARNING_RATIO_PCT = Decimal("90")


def recommend_special_container(piece: Piece, oog: OogResult) -> str:
    text = f"{piece.desc} {piece.package_text}".lower()
    if any(keyword.lower() in text for keyword in RF_KEYWORDS):
        return "RF"
    if oog.over_W_cm > 0 or oog.over_L_cm > 0:
        return "FR"
    if oog.over_H_cm > 0:
        if piece.weight_kg > Decimal("28000"):
            return "FR"
        fills_one_container = piece.L_cm >= Decimal("1100") or piece.W_cm >= Decimal("220")
        if fills_one_container and piece.weight_kg >= Decimal("20000"):
            return "FR"
        return "OT"
    return "20GP"


def summarize_special_container_needs(oog_results: list[tuple[Piece, OogResult]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for piece, oog in oog_results:
        if not oog.oog_flag:
            continue
        counter[recommend_special_container(piece, oog)] += 1
    return dict(counter)


def estimate_gross_weight_by_container(placements: list[Placement], special_counts: dict[str, int]) -> dict[str, Decimal]:
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
    for ctype, count in special_counts.items():
        tare = TARE_WEIGHT_KG.get(ctype, Decimal("0"))
        for idx in range(1, count + 1):
            key = f"{ctype}-S{idx}"
            result[key] = tare
    return result


def _ratio_pct(value: Decimal, limit: Decimal | None) -> Decimal:
    if limit is None or limit <= 0:
        return Decimal("0")
    return (value / limit) * Decimal("100")


def evaluate_container_weight_advisories(loads: list[ContainerLoad]) -> dict[tuple[str, int], WeightAdvisory]:
    alerts: dict[tuple[str, int], WeightAdvisory] = {}
    for load in loads:
        cargo_weight = sum((pl.piece.weight_kg for pl in load.placements), Decimal("0"))
        tare = TARE_WEIGHT_KG.get(load.spec.type, Decimal("0"))
        gross_weight = cargo_weight + tare
        chassis_weight = load.spec.chassis_weight_kg or Decimal("0")
        road_total = gross_weight + chassis_weight

        payload_ratio = _ratio_pct(cargo_weight, load.spec.max_payload_kg)
        road_limit = load.spec.road_max_total_kg or load.spec.road_max_gross_kg
        road_ratio = _ratio_pct(road_total, road_limit)
        warning_ratio = load.spec.warning_ratio_pct or DEFAULT_WARNING_RATIO_PCT

        reasons: list[str] = []
        if load.spec.max_payload_kg is not None:
            if cargo_weight > load.spec.max_payload_kg:
                reasons.append("PAYLOAD_LIMIT_EXCEEDED")
            elif payload_ratio >= warning_ratio:
                reasons.append("PAYLOAD_NEAR_LIMIT")

        if road_limit is not None:
            if road_total > road_limit:
                reasons.append("ROAD_LIMIT_EXCEEDED")
            elif road_ratio >= warning_ratio:
                reasons.append("ROAD_LIMIT_NEAR")

        alerts[(load.spec.type, load.index)] = WeightAdvisory(
            alert_flag=bool(reasons),
            reasons=";".join(reasons),
            cargo_weight_kg=cargo_weight,
            gross_weight_kg=gross_weight,
            road_total_weight_kg=road_total,
            payload_ratio_pct=payload_ratio,
            road_ratio_pct=road_ratio,
        )
    return alerts


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
