from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Iterable

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


def estimate(
    pieces: list[Piece],
    standard_specs: list[ContainerSpec],
    ref_spec: ContainerSpec,
    threshold_pct: Decimal,
    mode: str,
    algorithm: str,
    constraints: PackingConstraints | None = None,
) -> EstimateResult:
    oog_results = []
    in_gauge: list[Piece] = []
    for piece in pieces:
        oog = evaluate_oog(piece, ref_spec)
        if oog.oog_flag:
            oog_results.append((piece, oog))
        else:
            in_gauge.append(piece)
    in_gauge = sort_pieces(in_gauge)
    best = None
    if algorithm == "MULTI_TYPE":
        loads, unplaced = _pack_with_multi_type(standard_specs, in_gauge, mode, constraints=constraints)
    else:
        for spec in standard_specs:
            loads, unplaced = _pack_with_single_type(spec, in_gauge, constraints=constraints)
            count = len(loads)
            cost = (spec.cost or Decimal("0")) * count
            score = count if mode == "MIN_CONTAINERS" else cost
            if best is None or score < best[0]:
                best = (score, loads, unplaced)
        _, loads, unplaced = best
    placements = [placement for load in loads for placement in load.placements]
    summary = Counter([load.spec.type for load in loads])
    bias = _bias_by_container(loads, threshold_pct)
    return EstimateResult(
        placements=placements,
        unplaced=unplaced,
        oog_results=oog_results,
        summary_by_type=summary,
        bias_by_container=bias,
    )


def validate(
    pieces: list[Piece],
    spec: ContainerSpec,
    count: int,
    threshold_pct: Decimal,
    ref_spec: ContainerSpec,
    constraints: PackingConstraints | None = None,
) -> ValidateResult:
    in_gauge = sort_pieces(pieces)
    pack_result = pack_pieces(spec, in_gauge, max_containers=count, constraints=constraints)
    placements = [placement for load in pack_result.loads for placement in load.placements]
    bias = _bias_by_container(pack_result.loads, threshold_pct)
    oog_results = [(piece, evaluate_oog(piece, ref_spec)) for piece in pieces]
    return ValidateResult(
        placements=placements,
        unplaced=pack_result.unplaced,
        bias_by_container=bias,
        oog_results=oog_results,
    )
