import { orientationsFor } from "./oog";
import type { ContainerLoad, ContainerSpec, Orientation, Piece, Placement } from "./types";

const WIDTH_CLEARANCE_CM = 1;
const HEIGHT_CLEARANCE_CM = 3;
const EPSILON = 0.001;

interface PackResult {
  loads: ContainerLoad[];
  unplaced: Piece[];
}

interface FitOrientation {
  orientation: Orientation;
  footprintL: number;
  footprintW: number;
  footprintH: number;
}

class ShelfPacker {
  private loads: ContainerLoad[] = [];
  private curX = 0;
  private curY = 0;
  private curZ = 0;
  private rowDepth = 0;
  private layerHeight = 0;

  constructor(
    private readonly spec: ContainerSpec,
    private readonly maxContainers?: number,
  ) {}

  private isFr(): boolean {
    return this.spec.type.endsWith("FR");
  }

  private isOpenEquipment(): boolean {
    return this.spec.type.endsWith("FR") || this.spec.type.endsWith("OT");
  }

  private currentLoad(): ContainerLoad | undefined {
    return this.loads[this.loads.length - 1];
  }

  private newContainer(): boolean {
    if (this.maxContainers != null && this.loads.length >= this.maxContainers) return false;
    this.loads.push({ spec: this.spec, index: this.loads.length + 1, placements: [] });
    this.curX = 0;
    this.curY = 0;
    this.curZ = 0;
    this.rowDepth = 0;
    this.layerHeight = 0;
    return true;
  }

  private fitProfile(orientation: Orientation): FitOrientation | null {
    if (this.isFr()) {
      const deckLength = this.spec.deck_L_cm ?? this.spec.inner_L_cm;
      if (orientation.L_cm > deckLength) return null;
      return {
        orientation,
        footprintL: orientation.L_cm,
        footprintW: Math.min(orientation.W_cm, this.spec.deck_W_cm ?? this.spec.inner_W_cm),
        footprintH: 1,
      };
    }
    if (this.spec.type.endsWith("OT")) {
      if (orientation.L_cm > this.spec.inner_L_cm || orientation.W_cm > this.spec.inner_W_cm) return null;
      return {
        orientation,
        footprintL: orientation.L_cm,
        footprintW: orientation.W_cm,
        footprintH: Math.min(orientation.H_cm, this.spec.inner_H_cm),
      };
    }
    return {
      orientation,
      footprintL: orientation.L_cm,
      footprintW: orientation.W_cm,
      footprintH: orientation.H_cm,
    };
  }

  private fits(profile: FitOrientation): boolean {
    if (this.isFr() && profile.orientation.W_cm > (this.spec.deck_W_cm ?? this.spec.inner_W_cm) && this.curY > 0) {
      return false;
    }
    const remainingWidth = this.spec.inner_W_cm - (this.curY + profile.footprintW);
    const remainingHeight = this.spec.inner_H_cm - (this.curZ + profile.footprintH);
    const heightFits = this.isOpenEquipment() || remainingHeight >= HEIGHT_CLEARANCE_CM;
    const widthFits = this.isFr() ? remainingWidth >= 0 : remainingWidth >= WIDTH_CLEARANCE_CM;
    return this.curX + profile.footprintL <= this.spec.inner_L_cm && widthFits && heightFits;
  }

  private totalWeight(): number {
    return (this.currentLoad()?.placements ?? []).reduce((sum, placement) => sum + placement.piece.weight_kg, 0);
  }

  private overlaps2d(a: Placement, b: Placement): boolean {
    return (
      a.placed_x_cm < b.placed_x_cm + b.orient_L_cm &&
      a.placed_x_cm + a.orient_L_cm > b.placed_x_cm &&
      a.placed_y_cm < b.placed_y_cm + b.orient_W_cm &&
      a.placed_y_cm + a.orient_W_cm > b.placed_y_cm
    );
  }

  private hasIncompatibility(piece: Piece): boolean {
    const candidateForbidden = new Set(piece.incompatible_with_ids.split(",").map((value) => value.trim()).filter(Boolean));
    return (this.currentLoad()?.placements ?? []).some((placement) => {
      const currentForbidden = new Set(
        placement.piece.incompatible_with_ids.split(",").map((value) => value.trim()).filter(Boolean),
      );
      return candidateForbidden.has(placement.piece.orig_id) || currentForbidden.has(piece.orig_id);
    });
  }

  private canStack(piece: Piece, profile: FitOrientation): boolean {
    if (this.curZ === 0) return true;
    if (this.isOpenEquipment()) return false;
    const provisional: Placement = {
      piece,
      container_type: this.spec.type,
      container_category: this.spec.category,
      container_index: this.currentLoad()?.index ?? 1,
      placed_x_cm: this.curX,
      placed_y_cm: this.curY,
      placed_z_cm: this.curZ,
      orient_L_cm: profile.orientation.L_cm,
      orient_W_cm: profile.orientation.W_cm,
      orient_H_cm: profile.orientation.H_cm,
      rotation_key: profile.orientation.rotation_key,
    };
    const bottoms = (this.currentLoad()?.placements ?? []).filter(
      (placement) =>
        Math.abs(placement.placed_z_cm + placement.orient_H_cm - this.curZ) < EPSILON &&
        this.overlaps2d(placement, provisional),
    );
    return (
      bottoms.length > 0 &&
      bottoms.every(
        (bottom) =>
          bottom.piece.stackable &&
          (bottom.piece.max_stack_load_kg == null || piece.weight_kg <= bottom.piece.max_stack_load_kg),
      )
    );
  }

  private canPlace(piece: Piece, profile: FitOrientation): boolean {
    if (this.totalWeight() + piece.weight_kg > this.spec.max_payload_kg) return false;
    if (this.hasIncompatibility(piece)) return false;
    return this.canStack(piece, profile);
  }

  private startNewRow(): boolean {
    if (this.isFr()) return false;
    if (this.rowDepth <= 0 || this.curY + this.rowDepth + EPSILON > this.spec.inner_W_cm) return false;
    this.curX = 0;
    this.curY += this.rowDepth;
    this.rowDepth = 0;
    return true;
  }

  private startNewLayer(): boolean {
    if (this.isOpenEquipment() || this.layerHeight <= 0 || this.curZ + this.layerHeight + EPSILON > this.spec.inner_H_cm) {
      return false;
    }
    this.curX = 0;
    this.curY = 0;
    this.curZ += this.layerHeight;
    this.rowDepth = 0;
    this.layerHeight = 0;
    return true;
  }

  private tryPlaceInCurrent(piece: Piece): boolean {
    for (let positionAttempt = 0; positionAttempt < 3; positionAttempt += 1) {
      const candidates = orientationsFor(piece)
        .map((orientation) => this.fitProfile(orientation))
        .filter((profile): profile is FitOrientation => profile != null)
        .filter((profile) => this.fits(profile) && this.canPlace(piece, profile))
        .sort((a, b) => {
          const remainingA =
            this.spec.inner_L_cm - (this.curX + a.footprintL) +
            this.spec.inner_W_cm - (this.curY + a.footprintW) +
            this.spec.inner_H_cm - (this.curZ + a.footprintH);
          const remainingB =
            this.spec.inner_L_cm - (this.curX + b.footprintL) +
            this.spec.inner_W_cm - (this.curY + b.footprintW) +
            this.spec.inner_H_cm - (this.curZ + b.footprintH);
          return remainingA - remainingB;
        });
      const selected = candidates[0];
      if (selected) {
        const load = this.currentLoad();
        if (!load) return false;
        load.placements.push({
          piece,
          container_type: this.spec.type,
          container_category: this.spec.category,
          container_index: load.index,
          placed_x_cm: this.curX,
          placed_y_cm: this.curY,
          placed_z_cm: this.curZ,
          orient_L_cm: selected.orientation.L_cm,
          orient_W_cm: selected.orientation.W_cm,
          orient_H_cm: selected.orientation.H_cm,
          rotation_key: selected.orientation.rotation_key,
        });
        this.curX += selected.footprintL;
        this.rowDepth = Math.max(this.rowDepth, selected.footprintW);
        this.layerHeight = Math.max(this.layerHeight, selected.footprintH);
        return true;
      }
      if (this.startNewRow()) continue;
      if (this.startNewLayer()) continue;
      break;
    }
    return false;
  }

  place(piece: Piece): boolean {
    if (!this.currentLoad() && !this.newContainer()) return false;
    if (this.tryPlaceInCurrent(piece)) return true;
    if (!this.newContainer()) return false;
    return this.tryPlaceInCurrent(piece);
  }

  result(): ContainerLoad[] {
    return this.loads.filter((load) => load.placements.length > 0);
  }
}

export const sortPieces = (pieces: Piece[]): Piece[] =>
  [...pieces].sort(
    (a, b) =>
      b.L_cm - a.L_cm || b.W_cm - a.W_cm || b.H_cm - a.H_cm || b.weight_kg - a.weight_kg,
  );

const packSequentially = (spec: ContainerSpec, pieces: Piece[], maxContainers?: number): PackResult => {
  if (maxContainers != null && maxContainers <= 0) return { loads: [], unplaced: [...pieces] };
  const packer = new ShelfPacker(spec, maxContainers);
  const unplaced: Piece[] = [];
  for (const piece of pieces) {
    if (!packer.place(piece)) unplaced.push(piece);
  }
  return { loads: packer.result(), unplaced };
};

const cargoWeight = (load: ContainerLoad): number => load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);

const repackSingleLoad = (spec: ContainerSpec, pieces: Piece[], index: number): ContainerLoad | null => {
  if (!pieces.length) return null;
  const packed = packSequentially(spec, sortPieces(pieces), 1);
  const load = packed.loads[0];
  if (!load || packed.unplaced.length) return null;
  return {
    ...load,
    index,
    placements: load.placements.map((placement) => ({ ...placement, container_index: index })),
  };
};

const rebalanceLoadsByWeight = (spec: ContainerSpec, initialLoads: ContainerLoad[]): ContainerLoad[] => {
  if (initialLoads.length < 2) return initialLoads;
  const loads = initialLoads.map((load) => ({ ...load, placements: [...load.placements] }));
  const totalPieces = loads.reduce((sum, load) => sum + load.placements.length, 0);
  const maxMoves = Math.max(totalPieces * 2, 1);

  for (let move = 0; move < maxMoves; move += 1) {
    const ordered = loads
      .map((load, index) => ({ load, index, weight: cargoWeight(load) }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    let moved = false;

    for (const source of ordered) {
      if (source.load.placements.length <= 1) continue;
      const targets = ordered.filter((entry) => entry.index !== source.index && entry.weight < source.weight).sort((a, b) => a.weight - b.weight);
      for (const target of targets) {
        const difference = source.weight - target.weight;
        const candidates = source.load.placements
          .map((placement) => placement.piece)
          .filter((piece) => Math.abs(difference - 2 * piece.weight_kg) < difference)
          .sort(
            (a, b) =>
              Math.abs(difference - 2 * a.weight_kg) - Math.abs(difference - 2 * b.weight_kg) ||
              b.weight_kg - a.weight_kg,
          );
        for (const candidate of candidates) {
          const sourcePieces = source.load.placements.map((placement) => placement.piece).filter((piece) => piece.piece_id !== candidate.piece_id);
          const targetPieces = [...target.load.placements.map((placement) => placement.piece), candidate];
          const nextSource = repackSingleLoad(spec, sourcePieces, source.load.index);
          const nextTarget = repackSingleLoad(spec, targetPieces, target.load.index);
          if (!nextSource || !nextTarget) continue;
          loads[source.index] = nextSource;
          loads[target.index] = nextTarget;
          moved = true;
          break;
        }
        if (!moved) {
          const sourceCandidates = source.load.placements
            .map((placement) => placement.piece)
            .sort((a, b) => b.weight_kg - a.weight_kg)
            .slice(0, 64);
          const targetCandidates = target.load.placements
            .map((placement) => placement.piece)
            .sort((a, b) => a.weight_kg - b.weight_kg)
            .slice(0, 64);
          const swaps = sourceCandidates
            .flatMap((fromSource) => targetCandidates.map((fromTarget) => ({
              fromSource,
              fromTarget,
              nextDifference: Math.abs(difference - 2 * (fromSource.weight_kg - fromTarget.weight_kg)),
            })))
            .filter((swap) => swap.fromSource.weight_kg > swap.fromTarget.weight_kg && swap.nextDifference < difference)
            .sort((a, b) => a.nextDifference - b.nextDifference)
            .slice(0, 64);
          for (const swap of swaps) {
            const sourcePieces = source.load.placements
              .map((placement) => placement.piece)
              .filter((piece) => piece.piece_id !== swap.fromSource.piece_id)
              .concat(swap.fromTarget);
            const targetPieces = target.load.placements
              .map((placement) => placement.piece)
              .filter((piece) => piece.piece_id !== swap.fromTarget.piece_id)
              .concat(swap.fromSource);
            const nextSource = repackSingleLoad(spec, sourcePieces, source.load.index);
            const nextTarget = repackSingleLoad(spec, targetPieces, target.load.index);
            if (!nextSource || !nextTarget) continue;
            loads[source.index] = nextSource;
            loads[target.index] = nextTarget;
            moved = true;
            break;
          }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return loads;
};

const centerExistingRows = (load: ContainerLoad): ContainerLoad => {
  const rows = new Map<number, Placement[]>();
  for (const placement of load.placements) {
    rows.set(placement.placed_y_cm, [...(rows.get(placement.placed_y_cm) ?? []), placement]);
  }
  const centeredRows = [...rows.values()].map((row) => {
    const minX = Math.min(...row.map((placement) => placement.placed_x_cm));
    const maxX = Math.max(...row.map((placement) => placement.placed_x_cm + placement.orient_L_cm));
    const shiftX = (load.spec.inner_L_cm - (maxX - minX)) / 2 - minX;
    return row.map((placement) => ({ ...placement, placed_x_cm: placement.placed_x_cm + shiftX }));
  });
  const flattened = centeredRows.flat();
  const minY = Math.min(...flattened.map((placement) => placement.placed_y_cm));
  const maxY = Math.max(...flattened.map((placement) => placement.placed_y_cm + placement.orient_W_cm));
  const shiftY = (load.spec.inner_W_cm - (maxY - minY)) / 2 - minY;
  return { ...load, placements: flattened.map((placement) => ({ ...placement, placed_y_cm: placement.placed_y_cm + shiftY })) };
};

const balanceUniformLoad = (load: ContainerLoad): ContainerLoad | null => {
  if (load.placements.length < 2 || load.placements.some((placement) => placement.placed_z_cm !== 0)) return null;
  const first = load.placements[0];
  const uniform = load.placements.every(
    (placement) =>
      placement.orient_L_cm === first.orient_L_cm &&
      placement.orient_W_cm === first.orient_W_cm &&
      placement.orient_H_cm === first.orient_H_cm,
  );
  if (!uniform) return null;
  const rowCount = 2;
  const maxColumns = Math.floor(load.spec.inner_L_cm / first.orient_L_cm);
  const widthRemainder = load.spec.inner_W_cm - rowCount * first.orient_W_cm;
  if (maxColumns < 1 || load.placements.length > rowCount * maxColumns || widthRemainder < rowCount * WIDTH_CLEARANCE_CM) return null;

  const rows: Placement[][] = [[], []];
  const rowWeights = [0, 0];
  const weighted = [...load.placements].sort((a, b) => b.piece.weight_kg - a.piece.weight_kg || a.piece.piece_id.localeCompare(b.piece.piece_id));
  for (const placement of weighted) {
    const available = [0, 1].filter((index) => rows[index].length < maxColumns);
    const rowIndex = available.sort((a, b) => rowWeights[a] - rowWeights[b] || rows[a].length - rows[b].length || a - b)[0];
    rows[rowIndex].push(placement);
    rowWeights[rowIndex] += placement.piece.weight_kg;
  }

  const sideMargin = widthRemainder / 2;
  const placements = rows.flatMap((row, rowIndex) => {
    const startX = (load.spec.inner_L_cm - row.length * first.orient_L_cm) / 2;
    const positions = row
      .map((_, index) => startX + index * first.orient_L_cm)
      .sort((a, b) => Math.abs(a + first.orient_L_cm / 2 - load.spec.inner_L_cm / 2) - Math.abs(b + first.orient_L_cm / 2 - load.spec.inner_L_cm / 2));
    return [...row]
      .sort((a, b) => b.piece.weight_kg - a.piece.weight_kg || a.piece.piece_id.localeCompare(b.piece.piece_id))
      .map((placement, index) => ({
        ...placement,
        placed_x_cm: positions[index],
        placed_y_cm: sideMargin + rowIndex * first.orient_W_cm,
      }));
  });
  return { ...load, placements };
};

const balanceSpatialPlacements = (load: ContainerLoad): ContainerLoad => {
  if (load.spec.type.endsWith("FR") || load.spec.type.endsWith("OT")) {
    const minX = Math.min(...load.placements.map((placement) => placement.placed_x_cm));
    const maxX = Math.max(...load.placements.map((placement) => placement.placed_x_cm + placement.orient_L_cm));
    const shiftX = Math.max(0, (load.spec.inner_L_cm - (maxX - minX)) / 2 - minX);
    return {
      ...load,
      placements: load.placements.map((placement) => ({
        ...placement,
        placed_x_cm: placement.placed_x_cm + shiftX,
        placed_y_cm: (load.spec.inner_W_cm - placement.orient_W_cm) / 2,
      })),
    };
  }
  if (load.placements.some((placement) => placement.placed_z_cm !== 0)) return load;
  return balanceUniformLoad(load) ?? centerExistingRows(load);
};

export const packPieces = (spec: ContainerSpec, pieces: Piece[], maxContainers?: number): PackResult => {
  const packed = packSequentially(spec, pieces, maxContainers);
  return { ...packed, loads: rebalanceLoadsByWeight(spec, packed.loads).map(balanceSpatialPlacements) };
};
