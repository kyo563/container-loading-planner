from decimal import Decimal

import pandas as pd

from container_planner.io import CargoInputError, normalize_cargo_rows, expand_pieces
from container_planner.advisory import recommend_special_container
from container_planner.models import ContainerSpec, OogResult, Orientation, PackingConstraints, Piece, Placement
from container_planner.planner import estimate
from container_planner.reporting import build_container_summary_rows


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


def test_input_validation_error_message_includes_column_and_value():
    df = pd.DataFrame(
        [
            {
                "id": "A",
                "desc": "bad",
                "qty": 1,
                "L_cm": "abc",
                "W_cm": 10,
                "H_cm": 10,
                "weight_kg": 1,
            }
        ]
    )
    try:
        normalize_cargo_rows(df)
        assert False, "CargoInputError expected"
    except CargoInputError as exc:
        assert "L_cm" in str(exc)
        assert "abc" in str(exc)


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


def test_build_container_summary_rows_aggregates_metrics():
    piece_1 = Piece(
        piece_id="A-1",
        orig_id="A",
        piece_no=1,
        desc="cargo-a",
        L_cm=Decimal("100"),
        W_cm=Decimal("100"),
        H_cm=Decimal("100"),
        weight_kg=Decimal("1000"),
        m3=Decimal("1.0"),
        package_text="",
        rotate_allowed=True,
        stackable=True,
        max_stack_load_kg=None,
        incompatible_with_ids="",
    )
    piece_2 = Piece(
        piece_id="B-1",
        orig_id="B",
        piece_no=1,
        desc="cargo-b",
        L_cm=Decimal("100"),
        W_cm=Decimal("100"),
        H_cm=Decimal("200"),
        weight_kg=Decimal("500"),
        m3=Decimal("2.0"),
        package_text="",
        rotate_allowed=True,
        stackable=True,
        max_stack_load_kg=None,
        incompatible_with_ids="",
    )
    placements = [
        Placement(
            piece=piece_1,
            container_type="20GP",
            container_category="STANDARD",
            container_index=1,
            placed_x_cm=Decimal("0"),
            placed_y_cm=Decimal("0"),
            placed_z_cm=Decimal("0"),
            orient_L_cm=piece_1.L_cm,
            orient_W_cm=piece_1.W_cm,
            orient_H_cm=piece_1.H_cm,
            rotation_key="LWH",
        ),
        Placement(
            piece=piece_2,
            container_type="20GP",
            container_category="STANDARD",
            container_index=1,
            placed_x_cm=Decimal("100"),
            placed_y_cm=Decimal("0"),
            placed_z_cm=Decimal("0"),
            orient_L_cm=piece_2.L_cm,
            orient_W_cm=piece_2.W_cm,
            orient_H_cm=piece_2.H_cm,
            rotation_key="LWH",
        ),
    ]

    df = build_container_summary_rows(placements, {"20GP": 1})

    assert len(df) == 1
    row = df.iloc[0]
    assert row["container_label"] == "20GP ①"
    assert row["total_weight_kg"] == Decimal("1500")
    assert row["total_weight_ton"] == Decimal("1.5")
    assert row["total_m3"] == Decimal("3.0")
    assert row["freight_ton_ft"] == Decimal("3.0")
    assert row["total_gross_kg"] == Decimal("3800")
    assert row["max_single_item_weight_kg"] == Decimal("1000")
