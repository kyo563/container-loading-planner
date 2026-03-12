from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal
from typing import Iterable

from container_planner.advisory import evaluate_container_weight_advisories
from container_planner.models import (
    BiasMetrics,
    ContainerLoad,
    ContainerSpec,
    EstimateResult,
    PackingConstraints,
    Piece,
    Placement,
    ValidateResult,
)
from container_planner.oog import evaluate_oog
from container_planner.packing import pack_pieces
from container_planner.rounding import ceil_decimal


REBALANCE_DIFF_RATIO = Decimal("0.25")


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


def _container_weight(load: ContainerLoad) -> Decimal:
    return sum((pl.piece.weight_kg for pl in load.placements), Decimal("0"))


def _build_load_from_pieces(
    spec: ContainerSpec,
    index: int,
    pieces: list[Piece],
    constraints: PackingConstraints | None,
) -> ContainerLoad | None:
    packed = pack_pieces(spec, sort_pieces(pieces), max_containers=1, constraints=constraints)
    if packed.unplaced:
        return None
    if not packed.loads:
        return ContainerLoad(spec=spec, index=index, placements=[])
    placements: list[Placement] = []
    for pl in packed.loads[0].placements:
        placements.append(
            Placement(
                piece=pl.piece,
                container_type=spec.type,
                container_category=spec.category,
                container_index=index,
                placed_x_cm=pl.placed_x_cm,
                placed_y_cm=pl.placed_y_cm,
                placed_z_cm=pl.placed_z_cm,
                orient_L_cm=pl.orient_L_cm,
                orient_W_cm=pl.orient_W_cm,
                orient_H_cm=pl.orient_H_cm,
                rotation_key=pl.rotation_key,
            )
        )
    return ContainerLoad(spec=spec, index=index, placements=placements)


def _rebalance_weight_in_group(loads: list[ContainerLoad], constraints: PackingConstraints | None = None) -> list[ContainerLoad]:
    if len(loads) <= 1:
        return loads
    for _ in range(len(loads) * 2):
        ordered = sorted(loads, key=_container_weight)
        light = ordered[0]
        heavy = ordered[-1]
        diff = _container_weight(heavy) - _container_weight(light)
        total = sum((_container_weight(load) for load in loads), Decimal("0"))
        if total <= 0 or diff <= (total / Decimal(str(len(loads)))) * REBALANCE_DIFF_RATIO:
            break

        heavy_pieces = [pl.piece for pl in heavy.placements]
        light_pieces = [pl.piece for pl in light.placements]
        moved = False
        for candidate in sorted(heavy_pieces, key=lambda p: p.weight_kg, reverse=True):
            new_heavy = [p for p in heavy_pieces if p.piece_id != candidate.piece_id]
            new_light = light_pieces + [candidate]
            rebuilt_heavy = _build_load_from_pieces(heavy.spec, heavy.index, new_heavy, constraints)
            rebuilt_light = _build_load_from_pieces(light.spec, light.index, new_light, constraints)
            if rebuilt_heavy is None or rebuilt_light is None:
                continue
            before = abs(_container_weight(heavy) - _container_weight(light))
            after = abs(_container_weight(rebuilt_heavy) - _container_weight(rebuilt_light))
            if after >= before:
                continue
            for idx, load in enumerate(loads):
                if load.spec.type == heavy.spec.type and load.index == heavy.index:
                    loads[idx] = rebuilt_heavy
                elif load.spec.type == light.spec.type and load.index == light.index:
                    loads[idx] = rebuilt_light
            moved = True
            break
        if not moved:
            break
    return loads


def _rebalance_load_weights(loads: list[ContainerLoad], constraints: PackingConstraints | None = None) -> list[ContainerLoad]:
    grouped: dict[tuple[str, str], list[ContainerLoad]] = defaultdict(list)
    others: list[ContainerLoad] = []
    for load in loads:
        if load.spec.category == "STANDARD":
            grouped[(load.spec.type, load.spec.category)].append(load)
        else:
            others.append(load)
    rebalanced: list[ContainerLoad] = []
    for group_loads in grouped.values():
        rebalanced.extend(_rebalance_weight_in_group(group_loads, constraints))
    rebalanced.extend(others)
    rebalanced.sort(key=lambda x: (x.spec.type, x.index))
    return rebalanced


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
    if mode == "FIXED_PRIORITY":
        priority_order = {"20GP": 0, "40GP": 1, "40HC": 2}
        for spec in standard_specs:
            loads, unplaced = _pack_with_single_type(spec, in_gauge, constraints=constraints)
            if unplaced:
                continue
            count = len(loads)
            rank = priority_order.get(spec.type, 99)
            score = (count, rank)
            if best is None or score < best[0]:
                best = (score, loads, unplaced)
        if best is None:
            for spec in standard_specs:
                loads, unplaced = _pack_with_single_type(spec, in_gauge, constraints=constraints)
                score = (len(loads), priority_order.get(spec.type, 99), len(unplaced))
                if best is None or score < best[0]:
                    best = (score, loads, unplaced)
        _, loads, unplaced = best
    elif algorithm == "MULTI_TYPE":
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
    loads = _rebalance_load_weights(loads, constraints=constraints)
    placements = [placement for load in loads for placement in load.placements]
    summary = Counter([load.spec.type for load in loads])
    bias = _bias_by_container(loads, threshold_pct)
    weight_alerts = evaluate_container_weight_advisories(loads)
    return EstimateResult(
        placements=placements,
        unplaced=unplaced,
        oog_results=oog_results,
        summary_by_type=summary,
        bias_by_container=bias,
        weight_alerts_by_container=weight_alerts,
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
    loads = _rebalance_load_weights(pack_result.loads, constraints=constraints)
    placements = [placement for load in loads for placement in load.placements]
    bias = _bias_by_container(loads, threshold_pct)
    weight_alerts = evaluate_container_weight_advisories(loads)
    oog_results = [(piece, evaluate_oog(piece, ref_spec)) for piece in pieces]
    return ValidateResult(
        placements=placements,
        unplaced=pack_result.unplaced,
        bias_by_container=bias,
        oog_results=oog_results,
        weight_alerts_by_container=weight_alerts,
    )
