from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Iterable, List

from container_planner.models import ContainerLoad, ContainerSpec, Orientation, PackResult, PackingConstraints, Piece, Placement
from container_planner.oog import choose_orientation

MAX_FLAT_RACK_BALANCE_ITEMS = 32
MAX_FLAT_RACK_BALANCE_PASSES = 8
FLAT_RACK_POINT_SYMMETRY_FACTOR = Decimal("1")


class ShelfPacker:
    WIDTH_CLEARANCE_CM = Decimal("1")
    HEIGHT_CLEARANCE_CM = Decimal("3")
    ADJACENT_HEIGHT_DIFFERENCE_ADVISORY_CM = Decimal("100")
    EPSILON = Decimal("0.001")

    def __init__(self, spec: ContainerSpec, constraints: PackingConstraints | None = None):
        if spec.inner_L_cm is None or spec.inner_W_cm is None or spec.inner_H_cm is None:
            raise ValueError("STANDARDコンテナの内寸が必要です")
        self.spec = spec
        self.constraints = constraints or PackingConstraints()
        self.loads: List[ContainerLoad] = []
        self._new_container()

    def _new_container(self):
        self.loads.append(ContainerLoad(spec=self.spec, index=len(self.loads) + 1))
        self.cur_x = Decimal("0")
        self.cur_y = Decimal("0")
        self.cur_z = Decimal("0")
        self.row_depth = Decimal("0")
        self.layer_height = Decimal("0")

    def _fits(self, orientation: Orientation) -> bool:
        remaining_w = self.spec.inner_W_cm - (self.cur_y + orientation.W_cm)
        remaining_h = self.spec.inner_H_cm - (self.cur_z + orientation.H_cm)
        return (
            self.cur_x + orientation.L_cm <= self.spec.inner_L_cm
            and remaining_w >= self.WIDTH_CLEARANCE_CM
            and remaining_h >= self.HEIGHT_CLEARANCE_CM
        )

    def _start_new_row(self):
        self.cur_x = Decimal("0")
        self.cur_y += self.row_depth
        self.row_depth = Decimal("0")

    def _start_new_layer(self):
        self.cur_x = Decimal("0")
        self.cur_y = Decimal("0")
        self.cur_z += self.layer_height
        self.layer_height = Decimal("0")
        self.row_depth = Decimal("0")

    def _try_start_new_row(self) -> bool:
        if self.row_depth <= 0 or self.cur_y + self.row_depth + self.EPSILON > self.spec.inner_W_cm:
            return False
        self._start_new_row()
        return True

    def _try_start_new_layer(self) -> bool:
        if self._is_flatrack() or self.layer_height <= 0 or self.cur_z + self.layer_height + self.EPSILON > self.spec.inner_H_cm:
            return False
        self._start_new_layer()
        return True

    def _calc_total_weight(self) -> Decimal:
        return sum((pl.piece.weight_kg for pl in self.loads[-1].placements), Decimal("0"))

    @staticmethod
    def _overlap_2d(a: Placement, b: Placement) -> bool:
        ax2 = a.placed_x_cm + a.orient_L_cm
        ay2 = a.placed_y_cm + a.orient_W_cm
        bx2 = b.placed_x_cm + b.orient_L_cm
        by2 = b.placed_y_cm + b.orient_W_cm
        return a.placed_x_cm < bx2 and ax2 > b.placed_x_cm and a.placed_y_cm < by2 and ay2 > b.placed_y_cm

    def _is_flatrack(self) -> bool:
        return self.spec.type.endswith("FR")

    def _container_allows_stacking(self) -> bool:
        return not self._is_flatrack()

    def _container_allows_piece(self, piece: Piece) -> bool:
        if self._is_flatrack() and piece.m3 <= Decimal("2"):
            return False
        return True

    def _can_stack_on_bottom(self, bottom: Placement, top_weight: Decimal) -> bool:
        if not self._container_allows_stacking():
            return False
        if not bottom.piece.stackable:
            return False
        if bottom.piece.max_stack_load_kg is None:
            return True
        return top_weight <= bottom.piece.max_stack_load_kg

    def _is_incompatible(self, piece: Piece) -> bool:
        forbidden_ids = {x.strip() for x in piece.incompatible_with_ids.split(",") if x.strip()}
        if not forbidden_ids:
            return False
        current_ids = {pl.piece.orig_id for pl in self.loads[-1].placements}
        return bool(forbidden_ids & current_ids)

    def _within_cg_limit(self, orientation: Orientation, piece: Piece) -> bool:
        if self.constraints.max_cg_offset_x_pct is None and self.constraints.max_cg_offset_y_pct is None:
            return True
        total_weight = self._calc_total_weight() + piece.weight_kg
        if total_weight <= 0:
            return True
        weighted_x = sum(
            (pl.piece.weight_kg * (pl.placed_x_cm + pl.orient_L_cm / Decimal("2")) for pl in self.loads[-1].placements),
            Decimal("0"),
        )
        weighted_y = sum(
            (pl.piece.weight_kg * (pl.placed_y_cm + pl.orient_W_cm / Decimal("2")) for pl in self.loads[-1].placements),
            Decimal("0"),
        )
        weighted_x += piece.weight_kg * (self.cur_x + orientation.L_cm / Decimal("2"))
        weighted_y += piece.weight_kg * (self.cur_y + orientation.W_cm / Decimal("2"))
        center_x = self.spec.inner_L_cm / Decimal("2")
        center_y = self.spec.inner_W_cm / Decimal("2")
        offset_x_pct = abs((weighted_x / total_weight) - center_x) / center_x * Decimal("100")
        offset_y_pct = abs((weighted_y / total_weight) - center_y) / center_y * Decimal("100")
        x_ok = self.constraints.max_cg_offset_x_pct is None or offset_x_pct <= self.constraints.max_cg_offset_x_pct
        y_ok = self.constraints.max_cg_offset_y_pct is None or offset_y_pct <= self.constraints.max_cg_offset_y_pct
        return x_ok and y_ok

    def _provisional_placement(self, piece: Piece, orientation: Orientation) -> Placement:
        return Placement(
            piece=piece,
            container_type=self.spec.type,
            container_category=self.spec.category,
            container_index=self.loads[-1].index,
            placed_x_cm=self.cur_x,
            placed_y_cm=self.cur_y,
            placed_z_cm=self.cur_z,
            orient_L_cm=orientation.L_cm,
            orient_W_cm=orientation.W_cm,
            orient_H_cm=orientation.H_cm,
            rotation_key=orientation.rotation_key,
        )

    def _can_place_with_constraints(self, piece: Piece, orientation: Orientation) -> bool:
        if not self._container_allows_piece(piece):
            return False
        if self._is_incompatible(piece):
            return False
        payload = self.spec.max_payload_kg
        if payload is not None and self._calc_total_weight() + piece.weight_kg > payload:
            return False
        if not self._within_cg_limit(orientation, piece):
            return False
        new_placement = self._provisional_placement(piece, orientation)
        if self.cur_z == 0:
            return True
        bottoms = [
            pl for pl in self.loads[-1].placements if pl.placed_z_cm + pl.orient_H_cm == self.cur_z and self._overlap_2d(pl, new_placement)
        ]
        if not bottoms:
            return False
        return all(self._can_stack_on_bottom(bottom, piece.weight_kg) for bottom in bottoms)

    def _best_orientation(self, piece: Piece) -> Orientation | None:
        best: tuple[Decimal, Orientation] | None = None
        for orientation in choose_orientation(piece):
            if not self._fits(orientation) or not self._can_place_with_constraints(piece, orientation):
                continue
            remaining = (
                (self.spec.inner_L_cm - (self.cur_x + orientation.L_cm))
                + (self.spec.inner_W_cm - (self.cur_y + orientation.W_cm))
                + (self.spec.inner_H_cm - (self.cur_z + orientation.H_cm))
            )
            if best is None or remaining < best[0]:
                best = (remaining, orientation)
        return best[1] if best else None

    def _place_at_current_position(self, piece: Piece, orientation: Orientation) -> None:
        self.loads[-1].placements.append(self._provisional_placement(piece, orientation))
        self.cur_x += orientation.L_cm
        self.row_depth = max(self.row_depth, orientation.W_cm)
        self.layer_height = max(self.layer_height, orientation.H_cm)

    def place_first_fitting(self, pieces: list[Piece]) -> int | None:
        while True:
            for index, piece in enumerate(pieces):
                orientation = self._best_orientation(piece)
                if orientation is None:
                    continue
                self._place_at_current_position(piece, orientation)
                return index
            # 後続の小口貨物も現在の床列で試し、床面を使い切ってから次段へ進む。
            if self._try_start_new_row():
                continue
            if self._try_start_new_layer():
                continue
            return None

    def start_next_container(self) -> bool:
        if not self.loads[-1].placements:
            return False
        self._new_container()
        return True

    def place_piece(self, piece: Piece) -> bool:
        for _ in range(3):
            orientations = choose_orientation(piece)
            best = None
            for orientation in orientations:
                if self._fits(orientation):
                    if not self._can_place_with_constraints(piece, orientation):
                        continue
                    remaining = (
                        (self.spec.inner_L_cm - (self.cur_x + orientation.L_cm))
                        + (self.spec.inner_W_cm - (self.cur_y + orientation.W_cm))
                        + (self.spec.inner_H_cm - (self.cur_z + orientation.H_cm))
                    )
                    if best is None or remaining < best[0]:
                        best = (remaining, orientation)
            if best:
                _, orientation = best
                placement = self._provisional_placement(piece, orientation)
                self.loads[-1].placements.append(placement)
                self.cur_x += orientation.L_cm
                self.row_depth = max(self.row_depth, orientation.W_cm)
                self.layer_height = max(self.layer_height, orientation.H_cm)
                return True
            if self.cur_y + self.row_depth + Decimal("0.001") <= self.spec.inner_W_cm:
                self._start_new_row()
                continue
            if self.cur_z + self.layer_height + Decimal("0.001") <= self.spec.inner_H_cm:
                self._start_new_layer()
                continue
            self._new_container()
        return False


def _order_pieces_by_height_continuity(pieces: Iterable[Piece]) -> list[Piece]:
    remaining = list(pieces)
    ordered: list[Piece] = []
    while remaining:
        current = remaining.pop(0)
        ordered.append(current)
        while remaining:
            next_index = next(
                (
                    index
                    for index, candidate in enumerate(remaining)
                    if abs(candidate.H_cm - current.H_cm) < ShelfPacker.ADJACENT_HEIGHT_DIFFERENCE_ADVISORY_CM
                ),
                None,
            )
            if next_index is None:
                break
            current = remaining.pop(next_index)
            ordered.append(current)
    return ordered


def pack_pieces(
    spec: ContainerSpec,
    pieces: Iterable[Piece],
    max_containers: int | None = None,
    constraints: PackingConstraints | None = None,
) -> PackResult:
    ordered = _order_pieces_by_height_continuity(pieces)
    if not ordered:
        return PackResult(loads=[], unplaced=[])
    packer = ShelfPacker(spec, constraints=constraints)

    if spec.category == "STANDARD":
        remaining = ordered
        while remaining:
            placed_index = packer.place_first_fitting(remaining)
            if placed_index is not None:
                remaining.pop(placed_index)
                continue
            if max_containers is not None and len(packer.loads) >= max_containers:
                break
            if not packer.start_next_container():
                break
        loads = [load for load in packer.loads if load.placements]
        return PackResult(loads=loads, unplaced=remaining)

    unplaced: list[Piece] = []
    for piece in ordered:
        if not packer.place_piece(piece):
            unplaced.append(piece)
        if max_containers is not None and len(packer.loads) > max_containers:
            unplaced.append(piece)
    if max_containers is not None:
        packer.loads = packer.loads[:max_containers]
    loads = [_balance_special_load(load) for load in packer.loads if load.placements]
    return PackResult(loads=loads, unplaced=unplaced)


def _centered_sequence_start(placements: list[Placement], extent_cm: Decimal) -> Decimal:
    return (extent_cm - sum((placement.orient_L_cm for placement in placements), Decimal("0"))) / Decimal("2")


def _flat_rack_sequence_score(placements: list[Placement], extent_cm: Decimal) -> Decimal:
    if not placements:
        return Decimal("0")
    midpoint = extent_cm / Decimal("2")
    cursor = _centered_sequence_start(placements, extent_cm)
    centers: list[Decimal] = []
    total_weight = sum((placement.piece.weight_kg for placement in placements), Decimal("0"))
    weighted_position = Decimal("0")
    for placement in placements:
        center = cursor + placement.orient_L_cm / Decimal("2")
        centers.append(center)
        weighted_position += placement.piece.weight_kg * center
        cursor += placement.orient_L_cm
    cg_penalty = (
        abs(weighted_position / total_weight - midpoint) / max(midpoint, ShelfPacker.EPSILON) * Decimal("100")
        if total_weight > 0
        else Decimal("0")
    )
    pair_count = len(centers) // 2
    symmetry_penalty = sum(
        (abs(centers[index] + centers[-index - 1] - midpoint * Decimal("2")) / max(extent_cm, ShelfPacker.EPSILON) * Decimal("100")
         for index in range(pair_count)),
        Decimal("0"),
    )
    if len(centers) % 2:
        symmetry_penalty += abs(centers[pair_count] - midpoint) / max(midpoint, ShelfPacker.EPSILON) * Decimal("100")
    symmetry_count = pair_count + len(centers) % 2
    return cg_penalty + (
        symmetry_penalty
        / Decimal(max(symmetry_count, 1))
        * FLAT_RACK_POINT_SYMMETRY_FACTOR
    )


def _balanced_flat_rack_sequence(placements: list[Placement], extent_cm: Decimal) -> list[Placement]:
    by_weight = sorted(
        placements,
        key=lambda placement: (placement.piece.weight_kg, placement.orient_L_cm, placement.piece.piece_id),
        reverse=True,
    )
    pendulum_left: list[Placement] = []
    pendulum_right: list[Placement] = []
    for index, placement in enumerate(by_weight):
        if index % 2:
            pendulum_left.insert(0, placement)
            pendulum_right.append(placement)
        else:
            pendulum_left.append(placement)
            pendulum_right.insert(0, placement)
    candidates = [placements, pendulum_left, pendulum_right]
    best = min(candidates, key=lambda candidate: _flat_rack_sequence_score(candidate, extent_cm))
    if len(best) > MAX_FLAT_RACK_BALANCE_ITEMS:
        return best
    for _ in range(MAX_FLAT_RACK_BALANCE_PASSES):
        current_score = _flat_rack_sequence_score(best, extent_cm)
        improved = best
        improved_score = current_score
        for left in range(len(best) - 1):
            for right in range(left + 1, len(best)):
                candidate = list(best)
                candidate[left], candidate[right] = candidate[right], candidate[left]
                score = _flat_rack_sequence_score(candidate, extent_cm)
                if score < improved_score:
                    improved = candidate
                    improved_score = score
        if improved is best:
            break
        best = improved
    return best


def _balance_special_load(load: ContainerLoad) -> ContainerLoad:
    if not load.placements or not (load.spec.type.endswith("FR") or load.spec.type.endswith("OT")):
        return load
    extent_cm = load.spec.deck_L_cm or load.spec.inner_L_cm
    width_cm = load.spec.deck_W_cm or load.spec.inner_W_cm
    if extent_cm is None or width_cm is None:
        return load
    placements = (
        _balanced_flat_rack_sequence(load.placements, extent_cm)
        if load.spec.type.endswith("FR")
        else load.placements
    )
    cursor = _centered_sequence_start(placements, extent_cm)
    centered: list[Placement] = []
    for placement in placements:
        centered.append(replace(
            placement,
            placed_x_cm=cursor,
            placed_y_cm=(width_cm - placement.orient_W_cm) / Decimal("2"),
        ))
        cursor += placement.orient_L_cm
    return ContainerLoad(spec=load.spec, index=load.index, placements=centered)
