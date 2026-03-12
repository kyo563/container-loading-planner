from __future__ import annotations

from decimal import Decimal
from typing import Iterable

from container_planner.models import OogResult, Orientation, Piece, ContainerSpec
from container_planner.rounding import ceil_cm, ceil_m3


def _orientations(piece: Piece) -> list[Orientation]:
    dims = [piece.L_cm, piece.W_cm, piece.H_cm]
    keys = [
        (0, 1, 2, "LWH"),
        (0, 2, 1, "LHW"),
        (1, 0, 2, "WLH"),
        (1, 2, 0, "WHL"),
        (2, 0, 1, "HLW"),
        (2, 1, 0, "HWL"),
    ]
    seen = set()
    result = []
    for a, b, c, key in keys:
        oriented = (dims[a], dims[b], dims[c])
        if oriented in seen:
            continue
        seen.add(oriented)
        result.append(Orientation(L_cm=oriented[0], W_cm=oriented[1], H_cm=oriented[2], rotation_key=key))
    return result


def choose_orientation(piece: Piece) -> list[Orientation]:
    if piece.rotate_allowed:
        return _orientations(piece)
    return [Orientation(L_cm=piece.L_cm, W_cm=piece.W_cm, H_cm=piece.H_cm, rotation_key="LWH")]


def evaluate_oog(piece: Piece, ref: ContainerSpec) -> OogResult:
    if ref.inner_L_cm is None or ref.inner_W_cm is None or ref.inner_H_cm is None:
        raise ValueError("OOG判定にはSTANDARDコンテナ内寸が必要です")
    best = None
    for orientation in choose_orientation(piece):
        over_L = max(Decimal("0"), orientation.L_cm - ref.inner_L_cm)
        over_W = max(Decimal("0"), orientation.W_cm - ref.inner_W_cm)
        over_H = max(Decimal("0"), orientation.H_cm - ref.inner_H_cm)
        score = over_L + over_W + over_H
        if best is None or score < best[0]:
            best = (score, orientation, over_L, over_W, over_H)
    _, orientation, over_L, over_W, over_H = best
    over_L = ceil_cm(over_L)
    over_W = ceil_cm(over_W)
    over_H = ceil_cm(over_H)
    oog_flag = any(over > 0 for over in [over_L, over_W, over_H])
    if over_W > 0 or over_L > 0:
        suggestion = "FR"
    elif over_H > 0 and over_L == 0 and over_W == 0:
        suggestion = "OT"
    else:
        suggestion = ""
    protrude_L = ceil_m3((over_L * orientation.W_cm * orientation.H_cm) / Decimal("1000000"))
    protrude_W = ceil_m3((orientation.L_cm * over_W * orientation.H_cm) / Decimal("1000000"))
    protrude_H = ceil_m3((orientation.L_cm * orientation.W_cm * over_H) / Decimal("1000000"))

    door_check_applied = ref.door_W_cm is not None and ref.door_H_cm is not None
    door_passable = True
    door_over_w = Decimal("0")
    door_over_h = Decimal("0")
    door_reason = ""
    if door_check_applied:
        best_door = None
        for candidate in choose_orientation(piece):
            over_door_w = max(Decimal("0"), candidate.W_cm - ref.door_W_cm)
            over_door_h = max(Decimal("0"), candidate.H_cm - ref.door_H_cm)
            score = over_door_w + over_door_h
            if best_door is None or score < best_door[0]:
                best_door = (score, over_door_w, over_door_h)

        _, door_over_w, door_over_h = best_door
        door_over_w = ceil_cm(door_over_w)
        door_over_h = ceil_cm(door_over_h)
        door_passable = door_over_w == 0 and door_over_h == 0
        if not door_passable:
            reasons = []
            if door_over_w > 0:
                reasons.append(f"入口幅超過 {door_over_w}cm")
            if door_over_h > 0:
                reasons.append(f"入口高さ超過 {door_over_h}cm")
            door_reason = " / ".join(reasons)

    return OogResult(
        oog_flag=oog_flag,
        oog_ref_type=ref.type,
        over_L_cm=over_L,
        over_W_cm=over_W,
        over_H_cm=over_H,
        suggestion=suggestion,
        protrude_L_m3=protrude_L,
        protrude_W_m3=protrude_W,
        protrude_H_m3=protrude_H,
        chosen_orientation=orientation,
        door_passable=door_passable,
        door_check_applied=door_check_applied,
        door_over_W_cm=door_over_w,
        door_over_H_cm=door_over_h,
        door_reason=door_reason,
    )


def summarize_oog_overages(oog_results: list[tuple[Piece, OogResult]]) -> dict[str, Decimal]:
    ow_each = Decimal("0")
    oh = Decimal("0")
    for _, oog in oog_results:
        ow_each += oog.over_W_cm
        oh += oog.over_H_cm
    return {"OW_each": ow_each, "OH": oh}
