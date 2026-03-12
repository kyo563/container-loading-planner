from decimal import Decimal

import pandas as pd

from container_planner.io import CargoInputError, normalize_cargo_rows, expand_pieces
from container_planner.advisory import recommend_special_container
from container_planner.models import ContainerSpec, OogResult, Orientation, PackingConstraints
from container_planner.oog import evaluate_oog, summarize_oog_overages
from container_planner.planner import estimate
from container_planner.packing import pack_pieces


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
    spec_20 = ContainerSpec(
        type="20GP",
        category="STANDARD",
        inner_L_cm=Decimal("200"),
        inner_W_cm=Decimal("101"),
        inner_H_cm=Decimal("103"),
        max_payload_kg=Decimal("1000"),
        cost=Decimal("100"),
    )
    spec_40 = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("400"),
        inner_W_cm=Decimal("101"),
        inner_H_cm=Decimal("103"),
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


def test_fixed_priority_prefers_40gp_when_same_container_count():
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
    assert result.summary_by_type == {"40GP": 1}
    assert "40GP推奨: 40HCと同等収容（同本数）" in result.decision_reasons


def test_fixed_priority_uses_20gp_for_residual_after_40hc():
    df = pd.DataFrame(
        [
            {"id": "A", "desc": "wide-cargo", "qty": 1, "L_cm": 150, "W_cm": 90, "H_cm": 90, "weight_kg": 100},
            {"id": "B", "desc": "normal-cargo", "qty": 1, "L_cm": 150, "W_cm": 70, "H_cm": 90, "weight_kg": 100},
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec_40hc = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("220"),
        inner_W_cm=Decimal("80"),
        inner_H_cm=Decimal("120"),
        max_payload_kg=Decimal("1000"),
        cost=Decimal("130"),
    )
    spec_20 = _base_spec("20GP", "100")

    result = estimate(
        pieces,
        [spec_40hc, spec_20],
        spec_20,
        Decimal("20"),
        "FIXED_PRIORITY",
        "SINGLE_TYPE",
    )
    assert result.summary_by_type == {"40HC": 1, "20GP": 1}
    assert len(result.unplaced) == 0
    assert "20GP採用: 40HC採用後の残貨物処理" in result.decision_reasons


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
    assert recommend_special_container(piece, oog)[0] == "FR"


def test_evaluate_oog_detects_door_not_passable_with_reason():
    piece = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "A", "desc": "wide", "qty": 1, "L_cm": 130, "W_cm": 120, "H_cm": 119, "weight_kg": 100}
            ])
        )
    )[0]
    ref_spec = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("1200"),
        inner_W_cm=Decimal("235"),
        inner_H_cm=Decimal("269"),
        door_W_cm=Decimal("110"),
        door_H_cm=Decimal("118"),
    )

    oog = evaluate_oog(piece, ref_spec)

    assert oog.door_check_applied is True
    assert oog.door_passable is False
    assert oog.door_over_W_cm == Decimal("10")
    assert "入口幅超過" in oog.door_reason


def test_evaluate_oog_skips_door_check_when_door_size_missing():
    piece = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "A", "desc": "cargo", "qty": 1, "L_cm": 100, "W_cm": 100, "H_cm": 100, "weight_kg": 100}
            ])
        )
    )[0]
    ref_spec = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("1200"),
        inner_W_cm=Decimal("235"),
        inner_H_cm=Decimal("269"),
    )

    oog = evaluate_oog(piece, ref_spec)

    assert oog.door_check_applied is False
    assert oog.door_passable is True


def test_packing_requires_width_and_height_clearance():
    piece = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "A", "desc": "tight-fit", "qty": 1, "L_cm": 100, "W_cm": 99, "H_cm": 98, "weight_kg": 100}
            ])
        )
    )[0]
    spec = ContainerSpec(
        type="20GP",
        category="STANDARD",
        inner_L_cm=Decimal("200"),
        inner_W_cm=Decimal("100"),
        inner_H_cm=Decimal("100"),
    )

    result = pack_pieces(spec, [piece])

    assert len(result.unplaced) == 1


def test_oog_summary_returns_ow_each_and_oh_totals():
    piece = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "A", "desc": "oog", "qty": 1, "L_cm": 130, "W_cm": 120, "H_cm": 140, "weight_kg": 100}
            ])
        )
    )[0]
    ref_spec = ContainerSpec(
        type="40HC",
        category="STANDARD",
        inner_L_cm=Decimal("120"),
        inner_W_cm=Decimal("110"),
        inner_H_cm=Decimal("130"),
    )
    oog = evaluate_oog(piece, ref_spec)
    summary = summarize_oog_overages([(piece, oog)])
    assert summary["OW_each"] == oog.over_W_cm
    assert summary["OH"] == oog.over_H_cm


def test_fr_disallows_stacking_and_small_volume_piece():
    small_piece = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "A", "desc": "small", "qty": 1, "L_cm": 100, "W_cm": 100, "H_cm": 100, "weight_kg": 100}
            ])
        )
    )[0]
    fr_spec = ContainerSpec(
        type="FR",
        category="SPECIAL",
        inner_L_cm=Decimal("250"),
        inner_W_cm=Decimal("120"),
        inner_H_cm=Decimal("250"),
    )
    result_small = pack_pieces(fr_spec, [small_piece])
    assert len(result_small.unplaced) == 1

    bottom = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "B", "desc": "bottom", "qty": 1, "L_cm": 220, "W_cm": 100, "H_cm": 100, "weight_kg": 100}
            ])
        )
    )[0]
    top = expand_pieces(
        normalize_cargo_rows(
            pd.DataFrame([
                {"id": "C", "desc": "top", "qty": 1, "L_cm": 220, "W_cm": 100, "H_cm": 100, "weight_kg": 100}
            ])
        )
    )[0]
    result_stack = pack_pieces(fr_spec, [bottom, top])
    placed_ids = {pl.piece.piece_id for load in result_stack.loads for pl in load.placements}
    assert len(placed_ids) == 1


def test_weight_audit_flags_payload_and_vehicle_limit():
    df = pd.DataFrame(
        [
            {"id": "A", "desc": "heavy-a", "qty": 1, "L_cm": 90, "W_cm": 90, "H_cm": 90, "weight_kg": 800},
            {"id": "B", "desc": "heavy-b", "qty": 1, "L_cm": 90, "W_cm": 90, "H_cm": 90, "weight_kg": 700},
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec = _base_spec("20GP", "100")
    result = estimate(
        pieces,
        [spec],
        spec,
        Decimal("20"),
        "MIN_CONTAINERS",
        "SINGLE_TYPE",
        vehicle_limit_kg=Decimal("700"),
        payload_near_threshold_pct=Decimal("70"),
    )
    audit = result.weight_audit_by_container[("20GP", 1)]
    assert audit.weight_alert is True
    assert "車両重量制限超過" in audit.weight_alert_message
    assert "最大積載重量に近接" in audit.weight_alert_message



def test_weight_audit_detects_concentration_warning():
    df = pd.DataFrame(
        [
            {"id": "A", "desc": "heavy", "qty": 1, "L_cm": 90, "W_cm": 90, "H_cm": 90, "weight_kg": 900},
            {"id": "B", "desc": "light", "qty": 2, "L_cm": 50, "W_cm": 50, "H_cm": 50, "weight_kg": 50},
        ]
    )
    pieces = expand_pieces(normalize_cargo_rows(df))
    spec = _base_spec("20GP", "100")
    result = estimate(
        pieces,
        [spec],
        spec,
        Decimal("20"),
        "MIN_CONTAINERS",
        "SINGLE_TYPE",
        concentration_top_n=1,
        concentration_warn_threshold_pct=Decimal("70"),
    )
    audit = result.weight_audit_by_container[("20GP", 1)]
    assert audit.weight_alert is True
    assert "重量貨物集中度高" in audit.weight_alert_message
