from decimal import Decimal

import pandas as pd

from container_planner.io import CargoInputError, normalize_cargo_rows, expand_pieces
from container_planner.advisory import recommend_special_container
from container_planner.models import ContainerSpec, OogResult, Orientation, PackingConstraints
from container_planner.planner import estimate


def _base_spec(container_type: str, cost: str) -> ContainerSpec:
    return ContainerSpec(
        type=container_type,
        category="STANDARD",
        inner_L_cm=Decimal("200"),
        inner_W_cm=Decimal("100"),
        inner_H_cm=Decimal("100"),
        max_payload_kg=Decimal("1000"),
        cost=Decimal(cost),
    )


def test_input_validation_negative_and_zero():
    df = pd.DataFrame(
        [
            {
                "id": "A",
                "desc": "bad",
                "qty": 0,
                "L_cm": 10,
                "W_cm": 10,
                "H_cm": 10,
                "weight_kg": 1,
            }
        ]
    )
    try:
        normalize_cargo_rows(df)
        assert False, "CargoInputError expected"
    except CargoInputError:
        pass


def test_multi_type_and_unplaced_visibility_data():
    df = pd.DataFrame(
        [
            {"id": "A", "desc": "cargo-a", "qty": 2, "L_cm": 120, "W_cm": 100, "H_cm": 50, "weight_kg": 100},
            {"id": "B", "desc": "cargo-b", "qty": 1, "L_cm": 200, "W_cm": 100, "H_cm": 50, "weight_kg": 100},
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec_20 = _base_spec("20GP", "100")
    spec_40 = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("400"),
        inner_W_cm=Decimal("100"),
        inner_H_cm=Decimal("100"),
        max_payload_kg=Decimal("2000"),
        cost=Decimal("180"),
    )

    result = estimate(
        pieces,
        [spec_20, spec_40],
        spec_40,
        Decimal("20"),
        "MIN_COST",
        "MULTI_TYPE",
    )
    assert len(result.unplaced) == 0
    assert len(result.summary_by_type) >= 1


def test_constraints_can_make_piece_unplaced():
    df = pd.DataFrame(
        [
            {
                "id": "A",
                "desc": "heavy-top",
                "qty": 1,
                "L_cm": 100,
                "W_cm": 100,
                "H_cm": 50,
                "weight_kg": 100,
            }
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec = _base_spec("20GP", "100")
    constraints = PackingConstraints(max_cg_offset_x_pct=Decimal("0"), max_cg_offset_y_pct=Decimal("0"))
    result = estimate(pieces, [spec], spec, Decimal("20"), "MIN_CONTAINERS", "SINGLE_TYPE", constraints)
    assert len(result.unplaced) >= 1


def test_fixed_priority_prefers_20gp_when_same_container_count():
    df = pd.DataFrame(
        [
            {"id": "A", "desc": "cargo-a", "qty": 1, "L_cm": 180, "W_cm": 90, "H_cm": 90, "weight_kg": 100},
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec_20 = _base_spec("20GP", "100")
    spec_40gp = _base_spec("40GP", "120")
    spec_40hc = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("220"),
        inner_W_cm=Decimal("100"),
        inner_H_cm=Decimal("120"),
        max_payload_kg=Decimal("1000"),
        cost=Decimal("130"),
    )

    result = estimate(
        pieces,
        [spec_20, spec_40gp, spec_40hc],
        spec_40hc,
        Decimal("20"),
        "FIXED_PRIORITY",
        "SINGLE_TYPE",
    )
    assert result.summary_by_type == {"20GP": 1}


def test_recommend_special_container_h_only_heavy_is_fr():
    piece = expand_pieces(normalize_cargo_rows(pd.DataFrame([
        {"id": "A", "desc": "heavy machine", "qty": 1, "L_cm": 1100, "W_cm": 220, "H_cm": 280, "weight_kg": 25000}
    ])))[0]
    oog = OogResult(
        oog_flag=True,
        oog_ref_type="40HC",
        over_L_cm=Decimal("0"),
        over_W_cm=Decimal("0"),
        over_H_cm=Decimal("10"),
        suggestion="OT",
        protrude_L_m3=Decimal("0"),
        protrude_W_m3=Decimal("0"),
        protrude_H_m3=Decimal("0.1"),
        chosen_orientation=Orientation(
            L_cm=piece.L_cm,
            W_cm=piece.W_cm,
            H_cm=piece.H_cm,
            rotation_key="LWH",
        ),
    )
    assert recommend_special_container(piece, oog) == "FR"
