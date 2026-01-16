from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Dict, Optional

import pandas as pd


@dataclass
class NaccsResult:
    code: str
    status: str


def _normalize(text: str) -> str:
    value = text.strip().upper()
    value = value.replace("　", " ")
    value = re.sub(r"\s+", " ", value)
    return value


def load_package_master(content: str) -> Dict[str, str]:
    data = pd.read_csv(io.StringIO(content))
    mapping: Dict[str, str] = {}
    for _, row in data.iterrows():
        alias = str(row.get("alias", "") or "").strip()
        code = str(row.get("code", "") or "").strip()
        if not alias:
            continue
        mapping[_normalize(alias)] = code
    return mapping


def map_package_text(text: str, mapping: Dict[str, str]) -> NaccsResult:
    if not text:
        return NaccsResult(code="", status="EMPTY")
    normalized = _normalize(text)
    code = mapping.get(normalized)
    if code:
        return NaccsResult(code=code, status="MAPPED")
    return NaccsResult(code="", status="UNMAPPED")
