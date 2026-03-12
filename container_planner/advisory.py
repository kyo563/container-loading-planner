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
FR_MIN_VOLUME_M3 = Decimal("2")


def _requires_rf(piece: Piece) -> bool:
    text = f"{piece.desc} {piece.package_text}".lower()
    return any(keyword.lower() in text for keyword in RF_KEYWORDS)


def _is_fr_candidate(piece: Piece, oog: OogResult) -> bool:
    if oog.over_W_cm <= 0 and oog.over_L_cm <= 0:
        return False
    return piece.m3 > FR_MIN_VOLUME_M3


def recommend_special_container(piece: Piece, oog: OogResult) -> tuple[str, str]:
    if _requires_rf(piece):
        return "RF", "冷凍・冷蔵キーワード検出"
    if _is_fr_candidate(piece, oog):
        return "FR", "長さ/幅超過（OW）"
    if oog.over_H_cm > 0:
        if piece.weight_kg > Decimal("28000"):
            return "FR", "高さ超過かつ重量が重くOT不適"
        fills_one_container = piece.L_cm >= Decimal("1100") or piece.W_cm >= Decimal("220")
        if fills_one_container and piece.weight_kg >= Decimal("20000"):
            return "FR", "高さ超過かつ大型重量物"
        return "OT", "高さ超過（OH）"
    return "", ""


def summarize_special_container_needs(oog_results: list[tuple[Piece, OogResult]]) -> tuple[dict[str, int], dict[str, str]]:
    counter: Counter[str] = Counter()
    reasons: dict[str, str] = {}
    for piece, oog in oog_results:
        if not oog.oog_flag:
            continue
        container_type, reason = recommend_special_container(piece, oog)
        if not container_type:
            continue
        counter[container_type] += 1
        reasons[piece.piece_id] = reason
    return dict(counter), reasons


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
