import pandas as pd

from container_planner.io import CargoInputError, load_cargo_csv, load_cargo_dataframe


def test_load_cargo_dataframe_applies_alias_and_optional_defaults():
    df = pd.DataFrame(
        [
            {
                "ItemID": "A001",
                "CargoName": "Machine",
                "Qty": 1,
                "L": 100,
                "W": 80,
                "H": 50,
                "Gross": 500,
            }
        ]
    )
    loaded = load_cargo_dataframe(df)
    assert "id" in loaded.columns
    assert "desc" in loaded.columns
    assert "package_text" in loaded.columns
    assert loaded.iloc[0]["id"] == "A001"


def test_load_cargo_dataframe_raises_when_required_columns_missing():
    df = pd.DataFrame([{"foo": 1, "bar": 2}])
    try:
        load_cargo_dataframe(df)
        assert False, "CargoInputError expected"
    except CargoInputError as exc:
        assert "必須カラム" in str(exc)


def test_load_cargo_csv_still_reuses_dataframe_normalization():
    content = "ItemID,CargoName,Qty,L,W,H,Gross\nA001,Machine,1,100,80,50,500\n"
    loaded = load_cargo_csv(content)
    assert "id" in loaded.columns
    assert "weight_kg" in loaded.columns


def test_load_cargo_dataframe_supports_japanese_template_headers():
    df = pd.DataFrame(
        [
            {
                "アイテム番号": 1,
                "貨物名": "機械",
                "数量": 2,
                "長さ(cm)": 120,
                "幅(cm)": 80,
                "高さ(cm)": 60,
                "重量(kg)": 350,
                "回転可否(TRUE/FALSE)": "TRUE",
                "積み重ね可否(TRUE/FALSE)": "FALSE",
            }
        ]
    )

    loaded = load_cargo_dataframe(df)

    assert loaded.iloc[0]["id"] == 1
    assert loaded.iloc[0]["desc"] == "機械"
    assert loaded.iloc[0]["L_cm"] == 120
    assert loaded.iloc[0]["rotate_allowed"] == "TRUE"
