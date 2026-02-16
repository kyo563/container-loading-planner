from __future__ import annotations

import io
from decimal import Decimal
from typing import Iterable

import pandas as pd

from container_planner.models import CargoRow, Piece
from container_planner.rounding import ceil_cm, ceil_m3, to_decimal

REQUIRED_COLUMNS = [
    "id",
    "desc",
    "qty",
    "L_cm",
    "W_cm",
    "H_cm",
    "weight_kg",
]

OPTIONAL_COLUMNS = {
    "package_text": "",
    "rotate_allowed": True,
    "stackable": True,
    "max_stack_load_kg": None,
    "incompatible_with_ids": "",
}

MAX_DIM_CM = Decimal("20000")
MAX_WEIGHT_KG = Decimal("100000")
MAX_QTY = 10000

COLUMN_ALIASES = {
    "itemid": "id",
    "cargoid": "id",
    "cargo_id": "id",
    "cargoname": "desc",
    "name": "desc",
    "qty": "qty",
    "quantity": "qty",
    "l": "L_cm",
    "length": "L_cm",
    "w": "W_cm",
    "width": "W_cm",
    "h": "H_cm",
    "height": "H_cm",
    "gross": "weight_kg",
    "grosskg": "weight_kg",
    "weight": "weight_kg",
    "weightkg": "weight_kg",
    "style": "package_text",
    "package": "package_text",
    "package_text": "package_text",
    "rotate": "rotate_allowed",
    "rotateallowed": "rotate_allowed",
    "stack": "stackable",
    "stackable": "stackable",
    "maxtopload": "max_stack_load_kg",
    "maxstackload": "max_stack_load_kg",
    "incompatibleids": "incompatible_with_ids",
    "incompatible": "incompatible_with_ids",
}


def _normalize_column_name(name: str) -> str:
    return "".join(ch for ch in str(name).strip() if ch.isalnum()).lower()


def _apply_column_aliases(df: pd.DataFrame) -> pd.DataFrame:
    rename_map: dict[str, str] = {}
    for col in df.columns:
        normalized = _normalize_column_name(col)
        target = COLUMN_ALIASES.get(normalized)
        if target:
            rename_map[col] = target
    if rename_map:
        df = df.rename(columns=rename_map)
    return df


class CargoInputError(ValueError):
    pass


def _parse_bool(value, default: bool) -> bool:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y"}:
        return True
    if text in {"0", "false", "no", "n"}:
        return False
    return default


def load_cargo_csv(content: str) -> pd.DataFrame:
    data = pd.read_csv(io.StringIO(content))
    return _apply_column_aliases(data)


def ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise CargoInputError(f"必須カラムが不足しています: {', '.join(missing)}")
    for col, default in OPTIONAL_COLUMNS.items():
        if col not in df.columns:
            df[col] = default
    return df


def normalize_cargo_rows(df: pd.DataFrame) -> list[CargoRow]:
    rows: list[CargoRow] = []
    for idx, row in df.iterrows():
        row_no = idx + 1

        def parse_decimal_field(field_name: str):
            raw = row.get(field_name)
            try:
                return to_decimal(raw)
            except Exception as exc:  # noqa: BLE001
                raise CargoInputError(
                    f"{field_name} の値 '{raw}' は数値に変換できません (行 {row_no})"
                ) from exc

        try:
            qty = int(row["qty"])
        except Exception as exc:  # noqa: BLE001
            raise CargoInputError(f"qty の値 '{row.get('qty')}' は整数に変換できません (行 {row_no})") from exc

        L_cm = ceil_cm(parse_decimal_field("L_cm"))
        W_cm = ceil_cm(parse_decimal_field("W_cm"))
        H_cm = ceil_cm(parse_decimal_field("H_cm"))
        weight_kg = parse_decimal_field("weight_kg")

        max_stack_load = row.get("max_stack_load_kg")
        if pd.isna(max_stack_load) or max_stack_load in {"", None}:
            max_stack_load_kg = None
        else:
            try:
                max_stack_load_kg = to_decimal(max_stack_load)
            except Exception as exc:  # noqa: BLE001
                raise CargoInputError(
                    f"max_stack_load_kg の値 '{max_stack_load}' は数値に変換できません (行 {row_no})"
                ) from exc
        if qty <= 0:
            raise CargoInputError(f"qtyは1以上である必要があります (行 {row_no})")
        if qty > MAX_QTY:
            raise CargoInputError(f"qtyが上限({MAX_QTY})を超えています (行 {row_no})")
        for label, value in (("L_cm", L_cm), ("W_cm", W_cm), ("H_cm", H_cm), ("weight_kg", weight_kg)):
            if value <= 0:
                raise CargoInputError(f"{label}は0より大きい必要があります (行 {row_no})")
        for label, value in (("L_cm", L_cm), ("W_cm", W_cm), ("H_cm", H_cm)):
            if value > MAX_DIM_CM:
                raise CargoInputError(f"{label}が上限({MAX_DIM_CM}cm)を超えています (行 {row_no})")
        if weight_kg > MAX_WEIGHT_KG:
            raise CargoInputError(f"weight_kgが上限({MAX_WEIGHT_KG}kg)を超えています (行 {row_no})")
        if max_stack_load_kg is not None and max_stack_load_kg < 0:
            raise CargoInputError(f"max_stack_load_kgは0以上である必要があります (行 {row_no})")
        cargo = CargoRow(
            id=str(row["id"]).strip(),
            desc=str(row["desc"]).strip(),
            qty=qty,
            L_cm=L_cm,
            W_cm=W_cm,
            H_cm=H_cm,
            weight_kg=weight_kg,
            package_text=str(row.get("package_text", "") or ""),
            rotate_allowed=_parse_bool(row.get("rotate_allowed"), True),
            stackable=_parse_bool(row.get("stackable"), True),
            max_stack_load_kg=max_stack_load_kg,
            incompatible_with_ids=str(row.get("incompatible_with_ids", "") or ""),
        )
        rows.append(cargo)
    return rows


def expand_pieces(rows: Iterable[CargoRow]) -> list[Piece]:
    pieces: list[Piece] = []
    for row in rows:
        for i in range(1, row.qty + 1):
            piece_id = f"{row.id}#{i}"
            volume_m3 = ceil_m3((row.L_cm * row.W_cm * row.H_cm) / Decimal("1000000"))
            pieces.append(
                Piece(
                    piece_id=piece_id,
                    orig_id=row.id,
                    piece_no=i,
                    desc=row.desc,
                    L_cm=row.L_cm,
                    W_cm=row.W_cm,
                    H_cm=row.H_cm,
                    weight_kg=row.weight_kg,
                    m3=volume_m3,
                    package_text=row.package_text,
                    rotate_allowed=row.rotate_allowed,
                    stackable=row.stackable,
                    max_stack_load_kg=row.max_stack_load_kg,
                    incompatible_with_ids=row.incompatible_with_ids,
                )
            )
    return pieces
