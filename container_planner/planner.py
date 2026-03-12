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
            max(p.L_cm, p.W_cm, p.H_cm),
            p.L_cm * p.W_cm,
            p.weight_kg,
        ),
        reverse=True,
    )


def sort_pieces_for_special_fill(pieces: Iterable[Piece]) -> list[Piece]:
    return sorted(
        pieces,
        key=lambda p: (p.weight_kg, p.m3),
        reverse=True,
    )


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


def _pack_special_and_fill(
    pieces_by_type: dict[str, list[Piece]],
    special_specs: dict[str, ContainerSpec],
    in_gauge: list[Piece],
    constraints: PackingConstraints | None,
) -> tuple[list[ContainerLoad], list[Piece]]:
    special_loads: list[ContainerLoad] = []
    remaining_in_gauge = list(in_gauge)

    for container_type, special_pieces in pieces_by_type.items():
        if not special_pieces:
            continue
        spec = special_specs.get(container_type)
        if spec is None:
            continue
        pack_target = sort_pieces(special_pieces) + sort_pieces_for_special_fill(remaining_in_gauge)
        packed = pack_pieces(spec, pack_target, constraints=constraints)
        special_loads.extend(packed.loads)
        placed_ids = {pl.piece.piece_id for load in packed.loads for pl in load.placements}
        remaining_in_gauge = [piece for piece in remaining_in_gauge if piece.piece_id not in placed_ids]

    return special_loads, remaining_in_gauge


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
    pieces_by_special_type: dict[str, list[Piece]] = {"FR": [], "OT": [], "RF": []}
    special_spec_map = {spec.type: spec for spec in (special_specs or [])}

    for piece in pieces:
        oog = evaluate_oog(piece, ref_spec)
        if oog.oog_flag:
            oog_results.append((piece, oog))
            special_type, reason = recommend_special_container(piece, oog)
            if special_type:
                pieces_by_special_type.setdefault(special_type, []).append(piece)
                special_piece_ids.add(piece.piece_id)
                special_reason_by_piece[piece.piece_id] = reason
        else:
            in_gauge.append(piece)

    special_loads, remaining_in_gauge = _pack_special_and_fill(
        pieces_by_special_type,
        special_spec_map,
        in_gauge,
        constraints,
    )
    in_gauge = sort_pieces(remaining_in_gauge)

    best = None
    decision_reasons: list[str] = []
    if mode == "FIXED_PRIORITY":
        priority_order = {"40HC": 0, "40GP": 1, "20GP": 2}
        spec_by_type = {spec.type: spec for spec in standard_specs}
        total_m3 = sum((piece.m3 for piece in in_gauge), Decimal("0"))
        meets_piece_threshold = len(in_gauge) <= small_lot_threshold_pieces
        meets_m3_threshold = small_lot_threshold_m3 is not None and total_m3 <= small_lot_threshold_m3
        allow_20gp_small_lot = meets_piece_threshold or meets_m3_threshold

        ordered_specs = sorted(standard_specs, key=lambda s: priority_order.get(s.type, 99))
        single_results = {
            spec.type: _pack_with_single_type(spec, in_gauge, constraints=constraints)
            for spec in ordered_specs
        }

        for spec in ordered_specs:
            if spec.type == "20GP" and not allow_20gp_small_lot:
                continue
            loads_candidate, unplaced_candidate = single_results.get(spec.type, ([], in_gauge))
            if unplaced_candidate:
                continue
            score = (len(loads_candidate), priority_order.get(spec.type, 99))
            if best is None or score < best[0]:
                best = (score, loads_candidate, unplaced_candidate)

        loads_40hc, unplaced_40hc = single_results.get("40HC", ([], in_gauge))
        loads_40gp, unplaced_40gp = single_results.get("40GP", ([], in_gauge))
        if not unplaced_40hc and not unplaced_40gp and len(loads_40hc) == len(loads_40gp):
            best = ((len(loads_40gp), priority_order.get("40GP", 99)), loads_40gp, unplaced_40gp)
            decision_reasons.append("40GP推奨: 40HCと同等収容（同本数）")

        if best is None:
            for spec in ordered_specs:
                if spec.type == "20GP" and not allow_20gp_small_lot:
                    continue
                loads_candidate, unplaced_candidate = single_results.get(spec.type, ([], in_gauge))
                score = (len(unplaced_candidate), len(loads_candidate), priority_order.get(spec.type, 99))
                if best is None or score < best[0]:
                    best = (score, loads_candidate, unplaced_candidate)

            spec_20gp = spec_by_type.get("20GP")
            if loads_40hc and unplaced_40hc and spec_20gp:
                residual_loads_20gp, residual_unplaced = _pack_with_single_type(
                    spec_20gp,
                    unplaced_40hc,
                    constraints=constraints,
                )
                combo_loads = [*loads_40hc, *residual_loads_20gp]
                score = (len(residual_unplaced), len(combo_loads), priority_order.get("40HC", 99))
                if best is None or score < best[0]:
                    best = (score, combo_loads, residual_unplaced)
                    decision_reasons.append("20GP採用: 40HC採用後の残貨物処理")

        if allow_20gp_small_lot:
            if meets_piece_threshold and meets_m3_threshold:
                decision_reasons.append(
                    f"20GP許可: 小口閾値（piece<= {small_lot_threshold_pieces} または m3<= {small_lot_threshold_m3}）"
                )
            elif meets_piece_threshold:
                decision_reasons.append(f"20GP許可: 小口閾値（piece<= {small_lot_threshold_pieces}）")
            elif meets_m3_threshold:
                decision_reasons.append(f"20GP許可: 小口閾値（m3<= {small_lot_threshold_m3}）")

        _, loads, unplaced = best
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

    unplaced_special = [piece for piece in pieces if piece.piece_id in special_piece_ids and piece.piece_id not in {pl.piece.piece_id for pl in placements}]
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
    return EstimateResult(
        placements=placements,
        unplaced=unplaced,
        oog_results=oog_results,
        summary_by_type=summary,
        bias_by_container=bias,
        weight_audit_by_container=weight_audit,
        special_reason_by_piece=special_reason_by_piece,
        decision_reasons=decision_reasons,
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
