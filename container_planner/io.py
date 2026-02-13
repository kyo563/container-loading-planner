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
    return data


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
        try:
            qty = int(row["qty"])
        except Exception as exc:  # noqa: BLE001
            raise CargoInputError(f"qtyが整数に変換できません (行 {idx + 1})") from exc
        try:
            L_cm = ceil_cm(to_decimal(row["L_cm"]))
            W_cm = ceil_cm(to_decimal(row["W_cm"]))
            H_cm = ceil_cm(to_decimal(row["H_cm"]))
            weight_kg = to_decimal(row["weight_kg"])
            max_stack_load = row.get("max_stack_load_kg")
            max_stack_load_kg = None if pd.isna(max_stack_load) or max_stack_load in {"", None} else to_decimal(max_stack_load)
        except Exception as exc:  # noqa: BLE001
            raise CargoInputError(f"寸法または重量が数値に変換できません (行 {idx + 1})") from exc
        if qty <= 0:
            raise CargoInputError(f"qtyは1以上である必要があります (行 {idx + 1})")
        if qty > MAX_QTY:
            raise CargoInputError(f"qtyが上限({MAX_QTY})を超えています (行 {idx + 1})")
        for label, value in (("L_cm", L_cm), ("W_cm", W_cm), ("H_cm", H_cm), ("weight_kg", weight_kg)):
            if value <= 0:
                raise CargoInputError(f"{label}は0より大きい必要があります (行 {idx + 1})")
        for label, value in (("L_cm", L_cm), ("W_cm", W_cm), ("H_cm", H_cm)):
            if value > MAX_DIM_CM:
                raise CargoInputError(f"{label}が上限({MAX_DIM_CM}cm)を超えています (行 {idx + 1})")
        if weight_kg > MAX_WEIGHT_KG:
            raise CargoInputError(f"weight_kgが上限({MAX_WEIGHT_KG}kg)を超えています (行 {idx + 1})")
        if max_stack_load_kg is not None and max_stack_load_kg < 0:
            raise CargoInputError(f"max_stack_load_kgは0以上である必要があります (行 {idx + 1})")
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
