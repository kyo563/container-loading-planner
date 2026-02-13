from decimal import Decimal

import pandas as pd

from container_planner.io import CargoInputError, normalize_cargo_rows, expand_pieces
from container_planner.models import ContainerSpec, PackingConstraints
from container_planner.packing import pack_pieces
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


def test_stack_load_limit_uses_cumulative_weight_on_bottom_piece():
    df = pd.DataFrame(
        [
            {
                "id": "BOTTOM",
                "desc": "bottom",
                "qty": 1,
                "L_cm": 100,
                "W_cm": 100,
                "H_cm": 40,
                "weight_kg": 50,
                "max_stack_load_kg": 100,
            },
            {
                "id": "TOP",
                "desc": "top",
                "qty": 2,
                "L_cm": 100,
                "W_cm": 100,
                "H_cm": 20,
                "weight_kg": 80,
            },
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec = ContainerSpec(
        type="20GP",
        category="STANDARD",
        inner_L_cm=Decimal("100"),
        inner_W_cm=Decimal("100"),
        inner_H_cm=Decimal("200"),
        max_payload_kg=Decimal("1000"),
        cost=Decimal("100"),
    )

    result = pack_pieces(spec, pieces, max_containers=1)

    assert len(result.loads[0].placements) == 2
    assert len(result.unplaced) == 1
    assert result.unplaced[0].orig_id == "TOP"


def test_incompatible_ids_are_checked_bidirectionally():
    df = pd.DataFrame(
        [
            {
                "id": "A",
                "desc": "declares incompatibility",
                "qty": 1,
                "L_cm": 100,
                "W_cm": 100,
                "H_cm": 50,
                "weight_kg": 20,
                "incompatible_with_ids": "B",
            },
            {
                "id": "B",
                "desc": "does not declare incompatibility",
                "qty": 1,
                "L_cm": 100,
                "W_cm": 100,
                "H_cm": 50,
                "weight_kg": 20,
                "incompatible_with_ids": "",
            },
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec = _base_spec("20GP", "100")

    result = pack_pieces(spec, pieces, max_containers=1)

    assert len(result.loads[0].placements) == 1
    assert len(result.unplaced) == 1
    assert result.unplaced[0].orig_id == "B"
