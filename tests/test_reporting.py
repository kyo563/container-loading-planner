import pandas as pd

from container_planner.reporting import build_container_kpi_rows, build_loading_plan_rows


def test_build_container_kpi_rows_calculates_metrics_per_container_label():
    placements_df = pd.DataFrame(
        [
            {
                "container_label": "40HC ①",
                "container_type": "40HC",
                "cargo_piece_id": "A-1",
                "weight_kg": 1200,
                "m3": 0.8,
            },
            {
                "container_label": "40HC ①",
                "container_type": "40HC",
                "cargo_piece_id": "B-1",
                "weight_kg": 300,
                "m3": 1.5,
            },
            {
                "container_label": "20GP ①",
                "container_type": "20GP",
                "cargo_piece_id": "C-1",
                "weight_kg": 500,
                "m3": 0.2,
            },
        ]
    )

    kpi_df = build_container_kpi_rows(placements_df)

    row_40hc = kpi_df.loc[kpi_df["container_label"] == "40HC ①"].iloc[0]
    assert row_40hc["total_m3"] == 2.3
    assert row_40hc["total_gross_kg"] == 1500
    assert row_40hc["max_single_gross_kg"] == 1200
    assert row_40hc["total_ft"] == 2.3

    row_20gp = kpi_df.loc[kpi_df["container_label"] == "20GP ①"].iloc[0]
    assert row_20gp["total_ft"] == 0.5



def test_build_loading_plan_rows_builds_step_by_container():
    placements_df = pd.DataFrame(
        [
            {
                "container_label": "40HC ①",
                "container_type": "40HC",
                "container_index": 1,
                "loading_sequence": 2,
                "cargo_piece_id": "B-1",
                "desc": "Cargo B",
                "placed_x_cm": 200,
                "placed_y_cm": 20,
                "placed_z_cm": 0,
            },
            {
                "container_label": "40HC ①",
                "container_type": "40HC",
                "container_index": 1,
                "loading_sequence": 1,
                "cargo_piece_id": "A-1",
                "desc": "Cargo A",
                "placed_x_cm": 0,
                "placed_y_cm": 0,
                "placed_z_cm": 0,
            },
            {
                "container_label": "20GP ①",
                "container_type": "20GP",
                "container_index": 1,
                "loading_sequence": 1,
                "cargo_piece_id": "C-1",
                "desc": "Cargo C",
                "placed_x_cm": 10,
                "placed_y_cm": 5,
                "placed_z_cm": 0,
            },
        ]
    )

    plan_df = build_loading_plan_rows(placements_df)

    assert list(plan_df.columns) == ["container_label", "step", "cargo_piece_id", "desc", "instruction"]

    row_20gp = plan_df.iloc[0]
    assert row_20gp["container_label"] == "20GP ①"
    assert row_20gp["step"] == 1

    row_a = plan_df.iloc[1]
    row_b = plan_df.iloc[2]
    assert row_a["cargo_piece_id"] == "A-1"
    assert row_a["step"] == 1
    assert row_b["cargo_piece_id"] == "B-1"
    assert row_b["step"] == 2
    assert "x=0.0cm, y=0.0cm, z=0.0cm" in row_a["instruction"]
