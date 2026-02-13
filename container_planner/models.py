from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional


@dataclass
class CargoRow:
    id: str
    desc: str
    qty: int
    L_cm: Decimal
    W_cm: Decimal
    H_cm: Decimal
    weight_kg: Decimal
    package_text: str = ""
    rotate_allowed: bool = True
    stackable: bool = True
    max_stack_load_kg: Optional[Decimal] = None
    incompatible_with_ids: str = ""


@dataclass
class Piece:
    piece_id: str
    orig_id: str
    piece_no: int
    desc: str
    L_cm: Decimal
    W_cm: Decimal
    H_cm: Decimal
    weight_kg: Decimal
    m3: Decimal
    package_text: str
    rotate_allowed: bool
    stackable: bool
    max_stack_load_kg: Optional[Decimal]
    incompatible_with_ids: str


@dataclass
class ContainerSpec:
    type: str
    category: str
    inner_L_cm: Optional[Decimal] = None
    inner_W_cm: Optional[Decimal] = None
    inner_H_cm: Optional[Decimal] = None
    deck_L_cm: Optional[Decimal] = None
    deck_W_cm: Optional[Decimal] = None
    max_payload_kg: Optional[Decimal] = None
    cost: Optional[Decimal] = None


@dataclass
class Orientation:
    L_cm: Decimal
    W_cm: Decimal
    H_cm: Decimal
    rotation_key: str


@dataclass
class Placement:
    piece: Piece
    container_type: str
    container_category: str
    container_index: int
    placed_x_cm: Decimal
    placed_y_cm: Decimal
    placed_z_cm: Decimal
    orient_L_cm: Decimal
    orient_W_cm: Decimal
    orient_H_cm: Decimal
    rotation_key: str


@dataclass
class OogResult:
    oog_flag: bool
    oog_ref_type: str
    over_L_cm: Decimal
    over_W_cm: Decimal
    over_H_cm: Decimal
    suggestion: str
    protrude_L_m3: Decimal
    protrude_W_m3: Decimal
    protrude_H_m3: Decimal
    chosen_orientation: Orientation


@dataclass
class BiasMetrics:
    bias_warn: bool
    bias_reason: str
    offset_x_pct: Decimal
    offset_y_pct: Decimal
    front_rear_diff_pct: Decimal
    left_right_diff_pct: Decimal


@dataclass
class ContainerLoad:
    spec: ContainerSpec
    index: int
    placements: List[Placement] = field(default_factory=list)


@dataclass
class PackResult:
    loads: List[ContainerLoad]
    unplaced: List[Piece]


@dataclass
class PackingConstraints:
    max_cg_offset_x_pct: Optional[Decimal] = None
    max_cg_offset_y_pct: Optional[Decimal] = None


@dataclass
class EstimateResult:
    placements: List[Placement]
    unplaced: List[Piece]
    oog_results: List[tuple[Piece, OogResult]]
    summary_by_type: dict
    bias_by_container: dict


@dataclass
class ValidateResult:
    placements: List[Placement]
    unplaced: List[Piece]
    bias_by_container: dict
    oog_results: List[tuple[Piece, OogResult]]
