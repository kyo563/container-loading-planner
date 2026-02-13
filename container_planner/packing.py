from __future__ import annotations

from decimal import Decimal
from typing import Iterable, List

from container_planner.models import ContainerLoad, ContainerSpec, Orientation, PackResult, PackingConstraints, Piece, Placement
from container_planner.oog import choose_orientation


class ShelfPacker:
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
        return (
            self.cur_x + orientation.L_cm <= self.spec.inner_L_cm
            and self.cur_y + orientation.W_cm <= self.spec.inner_W_cm
            and self.cur_z + orientation.H_cm <= self.spec.inner_H_cm
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

    def _calc_total_weight(self) -> Decimal:
        return sum((pl.piece.weight_kg for pl in self.loads[-1].placements), Decimal("0"))

    @staticmethod
    def _overlap_2d(a: Placement, b: Placement) -> bool:
        ax2 = a.placed_x_cm + a.orient_L_cm
        ay2 = a.placed_y_cm + a.orient_W_cm
        bx2 = b.placed_x_cm + b.orient_L_cm
        by2 = b.placed_y_cm + b.orient_W_cm
        return a.placed_x_cm < bx2 and ax2 > b.placed_x_cm and a.placed_y_cm < by2 and ay2 > b.placed_y_cm

    def _can_stack_on_bottom(self, bottom: Placement, top_weight: Decimal) -> bool:
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

    def _can_place_with_constraints(self, piece: Piece, orientation: Orientation) -> bool:
        if self._is_incompatible(piece):
            return False
        payload = self.spec.max_payload_kg
        if payload is not None and self._calc_total_weight() + piece.weight_kg > payload:
            return False
        if not self._within_cg_limit(orientation, piece):
            return False
        if self.cur_z == 0:
            return True
        new_placement = Placement(
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
        bottoms = [
            pl for pl in self.loads[-1].placements if pl.placed_z_cm + pl.orient_H_cm == self.cur_z and self._overlap_2d(pl, new_placement)
        ]
        if not bottoms:
            return False
        return all(self._can_stack_on_bottom(bottom, piece.weight_kg) for bottom in bottoms)

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
                placement = Placement(
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
                self.loads[-1].placements.append(placement)
                self.cur_x += orientation.L_cm
                self.row_depth = max(self.row_depth, orientation.W_cm)
                self.layer_height = max(self.layer_height, orientation.H_cm)
                if not piece.stackable:
                    self._start_new_layer()
                return True
            if self.cur_y + self.row_depth + Decimal("0.001") <= self.spec.inner_W_cm:
                self._start_new_row()
                continue
            if self.cur_z + self.layer_height + Decimal("0.001") <= self.spec.inner_H_cm:
                self._start_new_layer()
                continue
            self._new_container()
        return False


def pack_pieces(
    spec: ContainerSpec,
    pieces: Iterable[Piece],
    max_containers: int | None = None,
    constraints: PackingConstraints | None = None,
) -> PackResult:
    packer = ShelfPacker(spec, constraints=constraints)
    unplaced: list[Piece] = []
    for piece in pieces:
        placed = packer.place_piece(piece)
        if not placed:
            unplaced.append(piece)
        if max_containers is not None and len(packer.loads) > max_containers:
            unplaced.append(piece)
    if max_containers is not None:
        packer.loads = packer.loads[:max_containers]
    return PackResult(loads=packer.loads, unplaced=unplaced)
