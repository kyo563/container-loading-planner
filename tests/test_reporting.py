import pandas as pd

from container_planner.reporting import build_container_kpi_rows


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
