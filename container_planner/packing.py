from __future__ import annotations

from decimal import Decimal
from typing import Iterable, List

from container_planner.models import ContainerLoad, ContainerSpec, Orientation, PackResult, Piece, Placement
from container_planner.oog import choose_orientation


class ShelfPacker:
    def __init__(self, spec: ContainerSpec):
        if spec.inner_L_cm is None or spec.inner_W_cm is None or spec.inner_H_cm is None:
            raise ValueError("STANDARDコンテナの内寸が必要です")
        self.spec = spec
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

    def place_piece(self, piece: Piece) -> bool:
        for _ in range(3):
            orientations = choose_orientation(piece)
            best = None
            for orientation in orientations:
                if self._fits(orientation):
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


def pack_pieces(spec: ContainerSpec, pieces: Iterable[Piece], max_containers: int | None = None) -> PackResult:
    packer = ShelfPacker(spec)
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
