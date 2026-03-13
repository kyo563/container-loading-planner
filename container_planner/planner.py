from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Iterable

from container_planner.advisory import build_weight_audit_metrics, recommend_special_container
from container_planner.models import (
    BiasMetrics,
    ContainerLoad,
    ContainerSpec,
    EstimateResult,
    PackingConstraints,
    Piece,
    ValidateResult,
)
from container_planner.oog import evaluate_oog
from container_planner.packing import pack_pieces
from container_planner.rounding import ceil_decimal


def sort_pieces(pieces: Iterable[Piece]) -> list[Piece]:
    return sorted(
        pieces,
        key=lambda p: (
            p.L_cm,
            p.W_cm,
            p.H_cm,
            p.weight_kg,
        ),
        reverse=True,
    )


def sort_pieces_for_special_fill(pieces: Iterable[Piece]) -> list[Piece]:
    return sorted(
        pieces,
        key=lambda p: (
            p.L_cm,
            p.W_cm,
            p.H_cm,
            p.weight_kg,
        ),
    )


def _is_ow_piece(oog_result) -> bool:
    return oog_result.over_W_cm > 0 or oog_result.over_L_cm > 0


def _is_oh_only_piece(oog_result) -> bool:
    return oog_result.over_H_cm > 0 and not _is_ow_piece(oog_result)


def _select_oh_special_type(
    piece: Piece,
    special_spec_map: dict[str, ContainerSpec],
    prefer_ot: bool,
) -> str:
    ot_type = _select_special_container_type(piece, "OT", special_spec_map)
    fr_type = _select_special_container_type(piece, "FR", special_spec_map)
    ot_spec = special_spec_map.get(ot_type)
    fr_spec = special_spec_map.get(fr_type)

    if prefer_ot:
        if ot_spec is not None and _can_fit_piece_on_special_spec(piece, ot_spec):
            return ot_type
        if fr_spec is not None and _can_fit_piece_on_special_spec(piece, fr_spec):
            return fr_type
    else:
        if fr_spec is not None and _can_fit_piece_on_special_spec(piece, fr_spec):
            return fr_type
        if ot_spec is not None and _can_fit_piece_on_special_spec(piece, ot_spec):
            return ot_type

    return ot_type if prefer_ot else fr_type


def compute_bias_metrics(load: ContainerLoad, threshold_pct: Decimal) -> BiasMetrics:
    total_weight = Decimal("0")
    weighted_x = Decimal("0")
    weighted_y = Decimal("0")
    if load.spec.inner_L_cm is None or load.spec.inner_W_cm is None:
        raise ValueError("偏荷重計算にはSTANDARDコンテナ内寸が必要です")
    half_L = load.spec.inner_L_cm / Decimal("2")
    half_W = load.spec.inner_W_cm / Decimal("2")
    front_weight = Decimal("0")
    rear_weight = Decimal("0")
    left_weight = Decimal("0")
    right_weight = Decimal("0")
    for placement in load.placements:
        piece = placement.piece
        cx = placement.placed_x_cm + placement.orient_L_cm / Decimal("2")
        cy = placement.placed_y_cm + placement.orient_W_cm / Decimal("2")
        total_weight += piece.weight_kg
        weighted_x += piece.weight_kg * cx
        weighted_y += piece.weight_kg * cy
        if cx <= half_L:
            front_weight += piece.weight_kg
        else:
            rear_weight += piece.weight_kg
        if cy <= half_W:
            left_weight += piece.weight_kg
        else:
            right_weight += piece.weight_kg
    if total_weight == 0:
        return BiasMetrics(
            bias_warn=False,
            bias_reason="",
            offset_x_pct=Decimal("0"),
            offset_y_pct=Decimal("0"),
            front_rear_diff_pct=Decimal("0"),
            left_right_diff_pct=Decimal("0"),
        )
    com_x = weighted_x / total_weight
    com_y = weighted_y / total_weight
    offset_x_pct = abs(com_x - half_L) / half_L * Decimal("100")
    offset_y_pct = abs(com_y - half_W) / half_W * Decimal("100")
    avg_half = total_weight / Decimal("2")
    front_rear_diff_pct = abs(front_weight - rear_weight) / avg_half * Decimal("100")
    left_right_diff_pct = abs(left_weight - right_weight) / avg_half * Decimal("100")
    offset_x_pct = ceil_decimal(offset_x_pct, Decimal("0.001"))
    offset_y_pct = ceil_decimal(offset_y_pct, Decimal("0.001"))
    front_rear_diff_pct = ceil_decimal(front_rear_diff_pct, Decimal("0.001"))
    left_right_diff_pct = ceil_decimal(left_right_diff_pct, Decimal("0.001"))
    reasons = []
    if offset_x_pct > threshold_pct:
        reasons.append("COM_X_OFFSET")
    if offset_y_pct > threshold_pct:
        reasons.append("COM_Y_OFFSET")
    if front_rear_diff_pct > threshold_pct:
        reasons.append("FRONT_REAR_IMBALANCE")
    if left_right_diff_pct > threshold_pct:
        reasons.append("LEFT_RIGHT_IMBALANCE")
    return BiasMetrics(
        bias_warn=bool(reasons),
        bias_reason=";".join(reasons),
        offset_x_pct=offset_x_pct,
        offset_y_pct=offset_y_pct,
        front_rear_diff_pct=front_rear_diff_pct,
        left_right_diff_pct=left_right_diff_pct,
    )


def _bias_by_container(loads: Iterable[ContainerLoad], threshold_pct: Decimal) -> dict:
    result = {}
    for load in loads:
        if load.spec.category != "STANDARD":
            continue
        result[(load.spec.type, load.index)] = compute_bias_metrics(load, threshold_pct)
    return result


def _weight_audit_by_container(
    loads: Iterable[ContainerLoad],
    vehicle_limit_kg: Decimal | None,
    payload_near_threshold_pct: Decimal,
    concentration_top_n: int,
    concentration_warn_threshold_pct: Decimal,
) -> dict:
    audits = {}
    for load in loads:
        audits[(load.spec.type, load.index)] = build_weight_audit_metrics(
            placements=load.placements,
            payload_limit_kg=load.spec.max_payload_kg,
            vehicle_limit_kg=vehicle_limit_kg,
            payload_near_threshold_pct=payload_near_threshold_pct,
            top_n=concentration_top_n,
            concentration_warn_threshold_pct=concentration_warn_threshold_pct,
        )
    return audits


def _pack_with_single_type(
    spec: ContainerSpec,
    pieces: list[Piece],
    constraints: PackingConstraints | None = None,
) -> tuple[list[ContainerLoad], list[Piece]]:
    result = pack_pieces(spec, pieces, constraints=constraints)
    return result.loads, result.unplaced


def _pack_with_multi_type(
    specs: list[ContainerSpec],
    pieces: list[Piece],
    mode: str,
    constraints: PackingConstraints | None = None,
) -> tuple[list[ContainerLoad], list[Piece]]:
    remaining = list(pieces)
    loads: list[ContainerLoad] = []
    while remaining:
        best = None
        for spec in specs:
            result = pack_pieces(spec, remaining, max_containers=1, constraints=constraints)
            placed_count = len(result.loads[0].placements) if result.loads else 0
            if placed_count == 0:
                continue
            score = Decimal("1") if mode == "MIN_CONTAINERS" else (spec.cost or Decimal("0"))
            efficiency = score / Decimal(str(placed_count))
            if best is None or efficiency < best[0]:
                best = (efficiency, result)
        if best is None:
            break
        chosen = best[1]
        loads.extend(chosen.loads)
        placed_piece_ids = {pl.piece.piece_id for load in chosen.loads for pl in load.placements}
        remaining = [piece for piece in remaining if piece.piece_id not in placed_piece_ids]
    return loads, remaining


def _pick_standard_spec(standard_specs: list[ContainerSpec], preferred: str) -> ContainerSpec | None:
    for spec in standard_specs:
        if spec.type == preferred:
            return spec
    return standard_specs[0] if standard_specs else None


def _pick_special_spec_by_ft(special_specs: dict[str, ContainerSpec], base_type: str, prefer_40ft: bool) -> ContainerSpec | None:
    candidates = [spec for spec in special_specs.values() if spec.type.endswith(base_type)]
    if not candidates:
        return None

    if prefer_40ft:
        for spec in candidates:
            if spec.type.startswith("40"):
                return spec
    for spec in candidates:
        if spec.type.startswith("20"):
            return spec
    return candidates[0]


def _can_fit_piece_on_special_spec(piece: Piece, spec: ContainerSpec) -> bool:
    if spec.max_payload_kg is not None and piece.weight_kg > spec.max_payload_kg:
        return False

    if spec.inner_L_cm is not None and spec.inner_W_cm is not None:
        fits_floor = (piece.L_cm <= spec.inner_L_cm and piece.W_cm <= spec.inner_W_cm) or (
            piece.W_cm <= spec.inner_L_cm and piece.L_cm <= spec.inner_W_cm
        )
        if not fits_floor:
            return False
        if spec.inner_H_cm is not None and piece.H_cm > spec.inner_H_cm:
            return False
        return True

    if spec.deck_L_cm is not None and spec.deck_W_cm is not None:
        return (piece.L_cm <= spec.deck_L_cm and piece.W_cm <= spec.deck_W_cm) or (
            piece.W_cm <= spec.deck_L_cm and piece.L_cm <= spec.deck_W_cm
        )

    return False


def _select_special_container_type(piece: Piece, base_type: str, special_specs: dict[str, ContainerSpec]) -> str:
    if base_type not in {"FR", "OT"}:
        return base_type

    spec_20 = special_specs.get(f"20{base_type}")
    spec_40 = special_specs.get(f"40{base_type}")
    if spec_20 is None and spec_40 is None:
        return base_type
    if spec_20 is None:
        return spec_40.type
    if spec_40 is None:
        return spec_20.type

    if _can_fit_piece_on_special_spec(piece, spec_40):
        return spec_40.type
    return spec_20.type


def _sort_special_loads_for_fill(special_loads: list[ContainerLoad]) -> list[ContainerLoad]:
    def priority(load: ContainerLoad) -> tuple[int, str]:
        ctype = load.spec.type
        if ctype.endswith("OT"):
            return (0, ctype)
        if ctype.endswith("FR"):
            return (1, ctype)
        return (2, ctype)

    return sorted(special_loads, key=priority)


def _filter_fr_forbidden_small_cargo(pieces: list[Piece], spec: ContainerSpec) -> tuple[list[Piece], list[Piece]]:
    if not spec.type.endswith("FR"):
        return pieces, []

    allowed = [piece for piece in pieces if piece.m3 > Decimal("1")]
    forbidden = [piece for piece in pieces if piece.m3 <= Decimal("1")]
    return allowed, forbidden


def _pack_special_only(
    pieces_by_type: dict[str, list[Piece]],
    special_specs: dict[str, ContainerSpec],
    constraints: PackingConstraints | None,
) -> list[ContainerLoad]:
    special_loads: list[ContainerLoad] = []

    for container_type, special_pieces in pieces_by_type.items():
        if not special_pieces:
            continue
        spec = special_specs.get(container_type)
        if spec is None or not _special_spec_has_inner_dims(spec):
            continue

        packed_special = pack_pieces(spec, sort_pieces(special_pieces), constraints=constraints)
        special_loads.extend(packed_special.loads)

    return special_loads


def _fill_existing_special_loads(
    special_loads: list[ContainerLoad],
    in_gauge: list[Piece],
    constraints: PackingConstraints | None,
) -> tuple[list[ContainerLoad], list[Piece]]:
    remaining_in_gauge = list(in_gauge)

    for load in _sort_special_loads_for_fill(special_loads):
        if not remaining_in_gauge:
            break
        spec = load.spec
        if not _special_spec_has_inner_dims(spec):
            continue

        fixed_special = [pl.piece for pl in load.placements]
        if not fixed_special:
            continue

        fill_candidates, _ = _filter_fr_forbidden_small_cargo(remaining_in_gauge, spec)
        if not fill_candidates:
            continue

        refill = pack_pieces(
            spec,
            sort_pieces(fixed_special) + sort_pieces_for_special_fill(fill_candidates),
            max_containers=1,
            constraints=constraints,
        )
        if not refill.loads:
            continue
        load.placements = refill.loads[0].placements
        placed_ids = {pl.piece.piece_id for pl in load.placements}
        remaining_in_gauge = [piece for piece in remaining_in_gauge if piece.piece_id not in placed_ids]

    return special_loads, remaining_in_gauge


def _special_spec_has_inner_dims(spec: ContainerSpec) -> bool:
    return spec.inner_L_cm is not None and spec.inner_W_cm is not None and spec.inner_H_cm is not None


def _is_breakbulk_required(piece: Piece, fr_spec: ContainerSpec | None) -> bool:
    deck_L = (fr_spec.deck_L_cm if fr_spec and fr_spec.deck_L_cm is not None else Decimal("1160"))
    deck_W = (fr_spec.deck_W_cm if fr_spec and fr_spec.deck_W_cm is not None else Decimal("240"))
    max_payload = (fr_spec.max_payload_kg if fr_spec and fr_spec.max_payload_kg is not None else Decimal("34000"))

    fits_footprint = (piece.L_cm <= deck_L and piece.W_cm <= deck_W) or (piece.W_cm <= deck_L and piece.L_cm <= deck_W)
    if not fits_footprint:
        return True
    if piece.weight_kg > max_payload:
        return True
    return False


def _build_breakbulk_summary(pieces: list[Piece]) -> dict[str, Decimal | int]:
    total_weight = sum((piece.weight_kg for piece in pieces), Decimal("0"))
    total_m3 = sum((piece.m3 for piece in pieces), Decimal("0"))
    return {
        "count": len(pieces),
        "total_weight_kg": total_weight,
        "total_ft_m3": total_m3,
    }
def estimate(
    pieces: list[Piece],
    standard_specs: list[ContainerSpec],
    ref_spec: ContainerSpec,
    threshold_pct: Decimal,
    mode: str,
    algorithm: str,
    constraints: PackingConstraints | None = None,
    special_specs: list[ContainerSpec] | None = None,
    small_lot_threshold_pieces: int = 2,
    small_lot_threshold_m3: Decimal | None = None,
    vehicle_limit_kg: Decimal | None = Decimal("30000"),
    payload_near_threshold_pct: Decimal = Decimal("90"),
    concentration_top_n: int = 3,
    concentration_warn_threshold_pct: Decimal = Decimal("70"),
) -> EstimateResult:

    oog_results = []
    in_gauge: list[Piece] = []
    special_reason_by_piece: dict[str, str] = {}
    special_piece_ids: set[str] = set()
    pieces_by_special_type: dict[str, list[Piece]] = {"RF": []}
    special_spec_map = {spec.type: spec for spec in (special_specs or [])}
    fr_spec = _pick_special_spec_by_ft(special_spec_map, "FR", prefer_40ft=True)
    breakbulk_excluded: list[Piece] = []

    oog_by_piece: list[tuple[Piece, object]] = []
    for piece in pieces:
        if _is_breakbulk_required(piece, fr_spec):
            breakbulk_excluded.append(piece)
            special_reason_by_piece[piece.piece_id] = "在来船推奨（40FR想定でも積載不可）"
            continue
        oog = evaluate_oog(piece, ref_spec)
        oog_by_piece.append((piece, oog))

    has_non_oh_oog = any(oog.oog_flag and not _is_oh_only_piece(oog) for _, oog in oog_by_piece)
    prefer_ot_for_oh = not has_non_oh_oog

    for piece, oog in oog_by_piece:
        if oog.oog_flag:
            oog_results.append((piece, oog))
            if _is_ow_piece(oog):
                special_type = _select_special_container_type(piece, "FR", special_spec_map)
                reason = "長さ/幅超過（OW）"
            elif _is_oh_only_piece(oog):
                special_type = _select_oh_special_type(piece, special_spec_map, prefer_ot=prefer_ot_for_oh)
                reason = "高さ超過（OH）"
                if special_type.endswith("FR"):
                    reason = "高さ超過（OH）: FR選定"
                elif prefer_ot_for_oh:
                    reason = "高さ超過（OH）: OH貨物のみのためOT優先"
            else:
                special_type, reason = recommend_special_container(piece, oog)
                special_type = _select_special_container_type(piece, special_type, special_spec_map)
            if special_type:
                pieces_by_special_type.setdefault(special_type, []).append(piece)
                special_piece_ids.add(piece.piece_id)
                special_reason_by_piece[piece.piece_id] = reason
        else:
            in_gauge.append(piece)

    special_loads = _pack_special_only(
        pieces_by_special_type,
        special_spec_map,
        constraints,
    )
    in_gauge = sort_pieces(in_gauge)

    best = None
    decision_reasons: list[str] = []
    if mode == "FIXED_PRIORITY":
        preferred_40hc = _pick_standard_spec(standard_specs, "40HC")
        if preferred_40hc:
            loads, unplaced = _pack_with_single_type(preferred_40hc, in_gauge, constraints=constraints)
        else:
            loads, unplaced = _pack_with_single_type(standard_specs[0], in_gauge, constraints=constraints)

        special_loads, unplaced = _fill_existing_special_loads(special_loads, unplaced, constraints)

        if unplaced:
            preferred_20gp = _pick_standard_spec(standard_specs, "20GP")
            if preferred_20gp:
                tail_loads, unplaced = _pack_with_single_type(preferred_20gp, unplaced, constraints=constraints)
                loads.extend(tail_loads)
                if tail_loads:
                    decision_reasons.append("20GP採用: 特殊コンテナおよび40HC積載後の残貨物処理")
    elif algorithm == "MULTI_TYPE":
        decision_reasons = []
        loads, unplaced = _pack_with_multi_type(standard_specs, in_gauge, mode, constraints=constraints)
    else:
        decision_reasons = []
        prioritized = []
        preferred = _pick_standard_spec(standard_specs, "40HC")
        if preferred:
            prioritized.append(preferred)
            prioritized.extend([s for s in standard_specs if s.type != preferred.type])
        else:
            prioritized = standard_specs

        for spec in prioritized:
            loads, unplaced = _pack_with_single_type(spec, in_gauge, constraints=constraints)
            count = len(loads)
            cost = (spec.cost or Decimal("0")) * count
            score = count if mode == "MIN_CONTAINERS" else cost
            if best is None or score < best[0]:
                best = (score, loads, unplaced)
        _, loads, unplaced = best

    loads = [*special_loads, *loads]
    placements = [placement for load in loads for placement in load.placements]
    summary = Counter([load.spec.type for load in loads])

    planned_piece_ids = {piece.piece_id for piece in breakbulk_excluded}
    planned_piece_ids.update(piece.piece_id for piece in pieces if piece.piece_id in special_piece_ids)
    unplaced_special = [piece for piece in pieces if piece.piece_id in planned_piece_ids and piece.piece_id not in {pl.piece.piece_id for pl in placements}]
    if unplaced_special:
        unplaced.extend(unplaced_special)
        dedup = {}
        for piece in unplaced:
            dedup[piece.piece_id] = piece
        unplaced = list(dedup.values())

    bias = _bias_by_container(loads, threshold_pct)
    weight_audit = _weight_audit_by_container(
        loads,
        vehicle_limit_kg=vehicle_limit_kg,
        payload_near_threshold_pct=payload_near_threshold_pct,
        concentration_top_n=concentration_top_n,
        concentration_warn_threshold_pct=concentration_warn_threshold_pct,
    )
    if breakbulk_excluded:
        decision_reasons.append("一部貨物はコンテナ積載不可のため、在来船を推奨します。")
    return EstimateResult(
        placements=placements,
        unplaced=unplaced,
        oog_results=oog_results,
        summary_by_type=summary,
        bias_by_container=bias,
        weight_audit_by_container=weight_audit,
        special_reason_by_piece=special_reason_by_piece,
        decision_reasons=decision_reasons,
        breakbulk_summary=_build_breakbulk_summary(breakbulk_excluded),
        breakbulk_piece_ids=[piece.piece_id for piece in breakbulk_excluded],
    )


def validate(
    pieces: list[Piece],
    spec: ContainerSpec,
    count: int,
    threshold_pct: Decimal,
    ref_spec: ContainerSpec,
    constraints: PackingConstraints | None = None,
    vehicle_limit_kg: Decimal | None = Decimal("30000"),
    payload_near_threshold_pct: Decimal = Decimal("90"),
    concentration_top_n: int = 3,
    concentration_warn_threshold_pct: Decimal = Decimal("70"),
) -> ValidateResult:
    in_gauge = sort_pieces(pieces)
    pack_result = pack_pieces(spec, in_gauge, max_containers=count, constraints=constraints)
    placements = [placement for load in pack_result.loads for placement in load.placements]
    bias = _bias_by_container(pack_result.loads, threshold_pct)
    weight_audit = _weight_audit_by_container(
        pack_result.loads,
        vehicle_limit_kg=vehicle_limit_kg,
        payload_near_threshold_pct=payload_near_threshold_pct,
        concentration_top_n=concentration_top_n,
        concentration_warn_threshold_pct=concentration_warn_threshold_pct,
    )
    oog_results = [(piece, evaluate_oog(piece, ref_spec)) for piece in pieces]
    return ValidateResult(
        placements=placements,
        unplaced=pack_result.unplaced,
        bias_by_container=bias,
        weight_audit_by_container=weight_audit,
        oog_results=oog_results,
        special_reason_by_piece={},
    )
