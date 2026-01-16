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
    )
