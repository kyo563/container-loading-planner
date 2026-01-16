from __future__ import annotations

from decimal import Decimal, ROUND_CEILING


DIM_QUANT = Decimal("0.001")


def ceil_decimal(value: Decimal, quant: Decimal) -> Decimal:
    return value.quantize(quant, rounding=ROUND_CEILING)


def ceil_cm(value: Decimal) -> Decimal:
    return ceil_decimal(value, DIM_QUANT)


def ceil_m3(value: Decimal) -> Decimal:
    return ceil_decimal(value, DIM_QUANT)


def to_decimal(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))
