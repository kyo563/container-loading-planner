import { orientationsFor } from "./oog";
import type { ContainerLoad, ContainerSpec, Orientation, Piece, Placement } from "./types";
import { splitWeightAcrossMidpoint } from "./weightBalance";

const WIDTH_CLEARANCE_CM = 1;
const HEIGHT_CLEARANCE_CM = 3;
// 100cmは配置不可の境界ではなく、並び順と結果確認に使う注意目安。
export const ADJACENT_HEIGHT_DIFFERENCE_ADVISORY_CM = 100;
const EPSILON = 0.001;
const SIDE_WEIGHT_BALANCE_FACTOR = 0.25;
const MAX_BALANCE_SWAP_ITEMS = 32;
const MAX_BALANCE_SWAP_PASSES = 8;
const MAX_LOAD_BALANCE_MOVES_PER_PIECE = 2;
const MAX_LOAD_BALANCE_CANDIDATES = 64;
const MAX_LOAD_BALANCE_SWAPS = 64;
// FRは重心だけでなく、中心から見た外形の点対称性も同じ尺度で評価する。
const FLAT_RACK_POINT_SYMMETRY_FACTOR = 1;
// 同寸法貨物は、バランス評価が5点以上改善する場合だけ前後順を変更する。
const MIN_FRONT_REAR_REORDER_IMPROVEMENT_SCORE = 5;
// 2本の平均貨物重量に対する差が40%を超える場合だけ、同一貨物グループの分割を許容する。
const SEVERE_LOAD_WEIGHT_DIFFERENCE_RATIO = 0.4;

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

const rangesOverlap = (startA: number, sizeA: number, startB: number, sizeB: number): boolean =>
  startA < startB + sizeB - EPSILON && startA + sizeA > startB + EPSILON;

const areHorizontallyAdjacent = (a: Placement, b: Placement): boolean => {
  if (!rangesOverlap(a.placed_z_cm, a.orient_H_cm, b.placed_z_cm, b.orient_H_cm)) return false;
  const touchesAlongX =
    Math.abs(a.placed_x_cm + a.orient_L_cm - b.placed_x_cm) <= EPSILON ||
    Math.abs(b.placed_x_cm + b.orient_L_cm - a.placed_x_cm) <= EPSILON;
  const touchesAlongY =
    Math.abs(a.placed_y_cm + a.orient_W_cm - b.placed_y_cm) <= EPSILON ||
    Math.abs(b.placed_y_cm + b.orient_W_cm - a.placed_y_cm) <= EPSILON;
  return (
    (touchesAlongX && rangesOverlap(a.placed_y_cm, a.orient_W_cm, b.placed_y_cm, b.orient_W_cm)) ||
    (touchesAlongY && rangesOverlap(a.placed_x_cm, a.orient_L_cm, b.placed_x_cm, b.orient_L_cm))
  );
};

export const hasLargeAdjacentHeightDifference = (a: Placement, b: Placement): boolean =>
  areHorizontallyAdjacent(a, b) &&
  Math.abs(a.orient_H_cm - b.orient_H_cm) >= ADJACENT_HEIGHT_DIFFERENCE_ADVISORY_CM;

const hasLargeHeightStep = (placements: Placement[]): boolean =>
  placements.some((placement, index) =>
    placements.slice(index + 1).some((other) => hasLargeAdjacentHeightDifference(placement, other)),
  );

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

  private provisionalPlacement(piece: Piece, profile: FitOrientation): Placement {
    return {
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
  }

  private canStack(piece: Piece, provisional: Placement): boolean {
    if (this.curZ === 0) return true;
    if (this.isOpenEquipment()) return false;
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
    return this.canStack(piece, this.provisionalPlacement(piece, profile));
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

  private bestProfile(piece: Piece): FitOrientation | undefined {
    return orientationsFor(piece)
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
      })[0];
  }

  placeFirstFitting(pieces: Piece[]): number {
    if (!this.currentLoad() && !this.newContainer()) return -1;
    while (true) {
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        const selected = this.bestProfile(piece);
        if (!selected) continue;
        const load = this.currentLoad();
        if (!load) return -1;
        load.placements.push(this.provisionalPlacement(piece, selected));
        this.curX += selected.footprintL;
        this.rowDepth = Math.max(this.rowDepth, selected.footprintW);
        this.layerHeight = Math.max(this.layerHeight, selected.footprintH);
        return index;
      }
      // 現在の床列に入る後続貨物がないことを確認してから次列、次段へ進む。
      if (this.startNewRow()) continue;
      if (this.startNewLayer()) continue;
      return -1;
    }
  }

  startNextContainer(): boolean {
    if (!this.currentLoad()?.placements.length) return false;
    return this.newContainer();
  }

  result(): ContainerLoad[] {
    return this.loads.filter((load) => load.placements.length > 0);
  }
}

const comparePieceLoadingPriority = (a: Piece, b: Piece): number =>
  b.L_cm - a.L_cm ||
  b.W_cm - a.W_cm ||
  b.H_cm - a.H_cm ||
  a.orig_id.localeCompare(b.orig_id) ||
  a.piece_no - b.piece_no ||
  b.weight_kg - a.weight_kg;

export const sortPieces = (pieces: Piece[]): Piece[] =>
  [...pieces].sort(comparePieceLoadingPriority);

const orderPiecesByHeightContinuity = (pieces: Piece[]): Piece[] => {
  const remaining = [...pieces];
  const ordered: Piece[] = [];
  while (remaining.length) {
    let current = remaining.shift()!;
    ordered.push(current);
    while (remaining.length) {
      const nextIndex = remaining.findIndex(
        (candidate) =>
          Math.abs(candidate.H_cm - current.H_cm) < ADJACENT_HEIGHT_DIFFERENCE_ADVISORY_CM,
      );
      if (nextIndex < 0) break;
      current = remaining.splice(nextIndex, 1)[0];
      ordered.push(current);
    }
  }
  return ordered;
};

const packSequentially = (spec: ContainerSpec, pieces: Piece[], maxContainers?: number): PackResult => {
  if (maxContainers != null && maxContainers <= 0) return { loads: [], unplaced: [...pieces] };
  const packer = new ShelfPacker(spec, maxContainers);
  const remaining = orderPiecesByHeightContinuity(pieces);
  while (remaining.length) {
    const placedIndex = packer.placeFirstFitting(remaining);
    if (placedIndex >= 0) {
      remaining.splice(placedIndex, 1);
      continue;
    }
    if (!packer.startNextContainer()) break;
  }
  return { loads: packer.result(), unplaced: remaining };
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

interface LoadBalanceEntry {
  load: ContainerLoad;
  index: number;
  weight: number;
}

interface RepackedLoadPair {
  source: ContainerLoad;
  target: ContainerLoad;
}

interface PieceGroup {
  key: string;
  pieces: Piece[];
  weight: number;
}

const piecesIn = (load: ContainerLoad): Piece[] =>
  load.placements.map((placement) => placement.piece);

const groupPiecesByCargo = (pieces: Piece[]): PieceGroup[] => {
  const groups = new Map<string, Piece[]>();
  for (const piece of pieces) {
    groups.set(piece.orig_id, [...(groups.get(piece.orig_id) ?? []), piece]);
  }
  return [...groups.entries()].map(([key, grouped]) => ({
    key,
    pieces: grouped,
    weight: grouped.reduce((sum, piece) => sum + piece.weight_kg, 0),
  }));
};

const hasSevereLoadWeightDifference = (
  source: LoadBalanceEntry,
  target: LoadBalanceEntry,
): boolean => {
  const averageWeight = (source.weight + target.weight) / 2;
  return (
    averageWeight > EPSILON &&
    (source.weight - target.weight) / averageWeight > SEVERE_LOAD_WEIGHT_DIFFERENCE_RATIO
  );
};

const repackLoadPair = (
  spec: ContainerSpec,
  source: LoadBalanceEntry,
  target: LoadBalanceEntry,
  sourcePieces: Piece[],
  targetPieces: Piece[],
): RepackedLoadPair | null => {
  const nextSource = repackSingleLoad(spec, sourcePieces, source.load.index);
  const nextTarget = repackSingleLoad(spec, targetPieces, target.load.index);
  return nextSource && nextTarget ? { source: nextSource, target: nextTarget } : null;
};

const tryMoveCargoGroupToLighterLoad = (
  spec: ContainerSpec,
  source: LoadBalanceEntry,
  target: LoadBalanceEntry,
): RepackedLoadPair | null => {
  const difference = source.weight - target.weight;
  const sourcePieces = piecesIn(source.load);
  const candidates = groupPiecesByCargo(sourcePieces)
    .filter((group) => group.pieces.length < sourcePieces.length)
    .filter((group) => Math.abs(difference - 2 * group.weight) < difference)
    .sort(
      (a, b) =>
        Math.abs(difference - 2 * a.weight) - Math.abs(difference - 2 * b.weight) ||
        b.weight - a.weight ||
        a.key.localeCompare(b.key),
    )
    .slice(0, MAX_LOAD_BALANCE_CANDIDATES);

  for (const candidate of candidates) {
    const nextSourcePieces = sourcePieces.filter((piece) => piece.orig_id !== candidate.key);
    const nextTargetPieces = [...piecesIn(target.load), ...candidate.pieces];
    const repacked = repackLoadPair(spec, source, target, nextSourcePieces, nextTargetPieces);
    if (repacked) return repacked;
  }
  return null;
};

const trySwapCargoGroupsBetweenLoads = (
  spec: ContainerSpec,
  source: LoadBalanceEntry,
  target: LoadBalanceEntry,
): RepackedLoadPair | null => {
  const difference = source.weight - target.weight;
  const sourceGroups = groupPiecesByCargo(piecesIn(source.load))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, MAX_LOAD_BALANCE_CANDIDATES);
  const targetGroups = groupPiecesByCargo(piecesIn(target.load))
    .sort((a, b) => a.weight - b.weight || a.key.localeCompare(b.key))
    .slice(0, MAX_LOAD_BALANCE_CANDIDATES);
  const swaps = sourceGroups
    .flatMap((fromSource) => targetGroups.map((fromTarget) => ({
      fromSource,
      fromTarget,
      nextDifference: Math.abs(difference - 2 * (fromSource.weight - fromTarget.weight)),
    })))
    .filter((swap) => swap.fromSource.weight > swap.fromTarget.weight && swap.nextDifference < difference)
    .sort((a, b) => a.nextDifference - b.nextDifference)
    .slice(0, MAX_LOAD_BALANCE_SWAPS);

  for (const swap of swaps) {
    const sourcePieces = piecesIn(source.load)
      .filter((piece) => piece.orig_id !== swap.fromSource.key)
      .concat(swap.fromTarget.pieces);
    const targetPieces = piecesIn(target.load)
      .filter((piece) => piece.orig_id !== swap.fromTarget.key)
      .concat(swap.fromSource.pieces);
    const repacked = repackLoadPair(spec, source, target, sourcePieces, targetPieces);
    if (repacked) return repacked;
  }
  return null;
};

const tryMovePieceToLighterLoad = (
  spec: ContainerSpec,
  source: LoadBalanceEntry,
  target: LoadBalanceEntry,
): RepackedLoadPair | null => {
  const difference = source.weight - target.weight;
  const candidates = piecesIn(source.load)
    .filter((piece) => Math.abs(difference - 2 * piece.weight_kg) < difference)
    .sort(
      (a, b) =>
        Math.abs(difference - 2 * a.weight_kg) - Math.abs(difference - 2 * b.weight_kg) ||
        b.weight_kg - a.weight_kg,
    );

  for (const candidate of candidates) {
    const sourcePieces = piecesIn(source.load).filter((piece) => piece.piece_id !== candidate.piece_id);
    const targetPieces = [...piecesIn(target.load), candidate];
    const repacked = repackLoadPair(spec, source, target, sourcePieces, targetPieces);
    if (repacked) return repacked;
  }
  return null;
};

const trySwapPiecesBetweenLoads = (
  spec: ContainerSpec,
  source: LoadBalanceEntry,
  target: LoadBalanceEntry,
): RepackedLoadPair | null => {
  const difference = source.weight - target.weight;
  const sourceCandidates = piecesIn(source.load)
    .sort((a, b) => b.weight_kg - a.weight_kg)
    .slice(0, MAX_LOAD_BALANCE_CANDIDATES);
  const targetCandidates = piecesIn(target.load)
    .sort((a, b) => a.weight_kg - b.weight_kg)
    .slice(0, MAX_LOAD_BALANCE_CANDIDATES);
  const swaps = sourceCandidates
    .flatMap((fromSource) => targetCandidates.map((fromTarget) => ({
      fromSource,
      fromTarget,
      nextDifference: Math.abs(difference - 2 * (fromSource.weight_kg - fromTarget.weight_kg)),
    })))
    .filter((swap) => swap.fromSource.weight_kg > swap.fromTarget.weight_kg && swap.nextDifference < difference)
    .sort((a, b) => a.nextDifference - b.nextDifference)
    .slice(0, MAX_LOAD_BALANCE_SWAPS);

  for (const swap of swaps) {
    const sourcePieces = piecesIn(source.load)
      .filter((piece) => piece.piece_id !== swap.fromSource.piece_id)
      .concat(swap.fromTarget);
    const targetPieces = piecesIn(target.load)
      .filter((piece) => piece.piece_id !== swap.fromTarget.piece_id)
      .concat(swap.fromSource);
    const repacked = repackLoadPair(spec, source, target, sourcePieces, targetPieces);
    if (repacked) return repacked;
  }
  return null;
};

const rebalanceLoadsByWeight = (spec: ContainerSpec, initialLoads: ContainerLoad[]): ContainerLoad[] => {
  if (initialLoads.length < 2) return initialLoads;
  const loads = initialLoads.map((load) => ({ ...load, placements: [...load.placements] }));
  const totalPieces = loads.reduce((sum, load) => sum + load.placements.length, 0);
  const maxMoves = Math.max(totalPieces * MAX_LOAD_BALANCE_MOVES_PER_PIECE, 1);

  for (let move = 0; move < maxMoves; move += 1) {
    const ordered: LoadBalanceEntry[] = loads
      .map((load, index) => ({ load, index, weight: cargoWeight(load) }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    let moved = false;

    for (const source of ordered) {
      if (source.load.placements.length <= 1) continue;
      const targets = ordered.filter((entry) => entry.index !== source.index && entry.weight < source.weight).sort((a, b) => a.weight - b.weight);
      for (const target of targets) {
        const repacked =
          tryMoveCargoGroupToLighterLoad(spec, source, target) ??
          trySwapCargoGroupsBetweenLoads(spec, source, target) ??
          (hasSevereLoadWeightDifference(source, target)
            ? tryMovePieceToLighterLoad(spec, source, target) ??
              trySwapPiecesBetweenLoads(spec, source, target)
            : null);
        if (!repacked) continue;
        loads[source.index] = repacked.source;
        loads[target.index] = repacked.target;
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return loads;
};

interface BalanceSequenceItem<T> {
  value: T;
  sizeCm: number;
  weightKg: number;
  stableKey: string;
}

type SequenceAlignment = "start" | "center";

const sequenceStartCm = <T,>(
  items: BalanceSequenceItem<T>[],
  extentCm: number,
  alignment: SequenceAlignment,
): number => alignment === "center"
  ? (extentCm - items.reduce((sum, item) => sum + item.sizeCm, 0)) / 2
  : 0;

const sequenceBalanceScore = <T,>(
  items: BalanceSequenceItem<T>[],
  extentCm: number,
  alignment: SequenceAlignment,
): number => {
  const totalWeight = items.reduce((sum, item) => sum + item.weightKg, 0);
  if (totalWeight <= 0) return 0;
  const midpoint = extentCm / 2;
  let cursor = sequenceStartCm(items, extentCm, alignment);
  let weightedPosition = 0;
  let beforeWeight = 0;
  let afterWeight = 0;

  for (const item of items) {
    weightedPosition += item.weightKg * (cursor + item.sizeCm / 2);
    const split = splitWeightAcrossMidpoint(cursor, item.sizeCm, midpoint, item.weightKg);
    beforeWeight += split.beforeKg;
    afterWeight += split.afterKg;
    cursor += item.sizeCm;
  }

  const centerOffsetPct = (Math.abs(weightedPosition / totalWeight - midpoint) / Math.max(midpoint, EPSILON)) * 100;
  const sideDifferencePct = (Math.abs(beforeWeight - afterWeight) / Math.max(totalWeight / 2, EPSILON)) * 100;

  // 空間を追加せず、重心偏差を主目的として中央線前後の重量差を1/4の重みで加える。
  return centerOffsetPct + sideDifferencePct * SIDE_WEIGHT_BALANCE_FACTOR;
};

const pendulumSequence = <T,>(
  items: BalanceSequenceItem<T>[],
  extendLeftFirst: boolean,
): BalanceSequenceItem<T>[] => {
  const byWeight = [...items].sort(
    (a, b) => b.weightKg - a.weightKg || b.sizeCm - a.sizeCm || a.stableKey.localeCompare(b.stableKey),
  );
  if (byWeight.length <= 1) return byWeight;
  const sequence = [byWeight[0]];
  for (let index = 1; index < byWeight.length; index += 1) {
    const extendLeft = index % 2 === (extendLeftFirst ? 1 : 0);
    if (extendLeft) sequence.unshift(byWeight[index]);
    else sequence.push(byWeight[index]);
  }
  return sequence;
};

const improveBalanceSequence = <T,>(
  items: BalanceSequenceItem<T>[],
  extentCm: number,
  alignment: SequenceAlignment,
  minimumImprovementScore = 0,
  scorer: (
    candidate: BalanceSequenceItem<T>[],
    extentCm: number,
    alignment: SequenceAlignment,
  ) => number = sequenceBalanceScore,
): BalanceSequenceItem<T>[] => {
  if (items.length <= 1) return items;
  const candidates = [
    [...items],
    pendulumSequence(items, true),
    pendulumSequence(items, false),
  ];
  let best = candidates.reduce((selected, candidate) =>
    scorer(candidate, extentCm, alignment) + minimumImprovementScore + EPSILON <
      scorer(selected, extentCm, alignment)
      ? candidate
      : selected,
  );
  if (best.length > MAX_BALANCE_SWAP_ITEMS) return best;

  for (let pass = 0; pass < MAX_BALANCE_SWAP_PASSES; pass += 1) {
    const currentScore = scorer(best, extentCm, alignment);
    let nextBest = best;
    let nextScore = currentScore;
    for (let left = 0; left < best.length - 1; left += 1) {
      for (let right = left + 1; right < best.length; right += 1) {
        const candidate = [...best];
        [candidate[left], candidate[right]] = [candidate[right], candidate[left]];
        const score = scorer(candidate, extentCm, alignment);
        if (score + minimumImprovementScore + EPSILON < nextScore) {
          nextBest = candidate;
          nextScore = score;
        }
      }
    }
    if (nextBest === best) break;
    best = nextBest;
  }
  return best;
};

const flatRackSequenceScore = <T,>(
  items: BalanceSequenceItem<T>[],
  extentCm: number,
  alignment: SequenceAlignment,
): number => {
  const positioned = positionSequence(items, extentCm, alignment);
  const midpoint = extentCm / 2;
  const pairCount = Math.floor(positioned.length / 2);
  let pointSymmetryPenalty = 0;

  for (let index = 0; index < pairCount; index += 1) {
    const left = positioned[index];
    const right = positioned[positioned.length - index - 1];
    const leftCenter = left.startCm + items[index].sizeCm / 2;
    const rightCenter = right.startCm + items[items.length - index - 1].sizeCm / 2;
    pointSymmetryPenalty += Math.abs(leftCenter + rightCenter - 2 * midpoint) / Math.max(extentCm, EPSILON) * 100;
  }
  if (positioned.length % 2 === 1) {
    const centerIndex = pairCount;
    const center = positioned[centerIndex].startCm + items[centerIndex].sizeCm / 2;
    pointSymmetryPenalty += Math.abs(center - midpoint) / Math.max(midpoint, EPSILON) * 100;
  }

  const normalizedSymmetryPenalty = pointSymmetryPenalty / Math.max(pairCount + (positioned.length % 2), 1);
  return sequenceBalanceScore(items, extentCm, alignment)
    + normalizedSymmetryPenalty * FLAT_RACK_POINT_SYMMETRY_FACTOR;
};

const positionSequence = <T,>(
  items: BalanceSequenceItem<T>[],
  extentCm: number,
  alignment: SequenceAlignment,
): Array<{ value: T; startCm: number }> => {
  let cursor = sequenceStartCm(items, extentCm, alignment);
  return items.map((item) => {
    const positioned = { value: item.value, startCm: cursor };
    cursor += item.sizeCm;
    return positioned;
  });
};

interface BalancedRow {
  key: number;
  depthCm: number;
  weightKg: number;
  placements: Placement[];
}

interface PlacementGroup {
  key: string;
  placements: Placement[];
  lengthCm: number;
  weightKg: number;
}

interface PlacementCluster {
  key: string;
  groups: PlacementGroup[];
  lengthCm: number;
  weightKg: number;
}

const placementGroupKey = (placement: Placement): string => [
  placement.piece.orig_id,
  placement.orient_L_cm,
  placement.orient_W_cm,
  placement.orient_H_cm,
].join("|");

const groupPlacements = (placements: Placement[]): PlacementGroup[] => {
  const groups = new Map<string, Placement[]>();
  for (const placement of placements) {
    const key = placementGroupKey(placement);
    groups.set(key, [...(groups.get(key) ?? []), placement]);
  }
  return [...groups.entries()].map(([key, grouped]) => ({
    key,
    placements: [...grouped].sort(
      (a, b) => a.piece.piece_no - b.piece.piece_no || a.piece.piece_id.localeCompare(b.piece.piece_id),
    ),
    lengthCm: grouped.reduce((sum, placement) => sum + placement.orient_L_cm, 0),
    weightKg: grouped.reduce((sum, placement) => sum + placement.piece.weight_kg, 0),
  }));
};

const clusterPlacementGroups = (groups: PlacementGroup[]): PlacementCluster[] => {
  const clusters = new Map<string, PlacementGroup[]>();
  for (const group of groups) {
    const first = group.placements[0];
    const key = [first.orient_L_cm, first.orient_W_cm, first.orient_H_cm].join("|");
    clusters.set(key, [...(clusters.get(key) ?? []), group]);
  }
  return [...clusters.entries()].map(([key, clustered]) => ({
    key,
    groups: clustered,
    lengthCm: clustered.reduce((sum, group) => sum + group.lengthCm, 0),
    weightKg: clustered.reduce((sum, group) => sum + group.weightKg, 0),
  }));
};

const loadingPriorityPiece = (cluster: PlacementCluster): Piece =>
  cluster.groups
    .flatMap((group) => group.placements)
    .map((placement) => placement.piece)
    .reduce((priority, piece) => comparePieceLoadingPriority(piece, priority) < 0 ? piece : priority);

const balanceExistingRows = (load: ContainerLoad): ContainerLoad => {
  const rows = new Map<number, Placement[]>();
  for (const placement of load.placements) {
    rows.set(placement.placed_y_cm, [...(rows.get(placement.placed_y_cm) ?? []), placement]);
  }
  const balancedRows: BalancedRow[] = [...rows.entries()].map(([key, row]) => {
    // x=0をトラック側とし、異寸法貨物は大きい順を重量バランス目的で入れ替えない。
    const orderedClusters = clusterPlacementGroups(
      groupPlacements([...row].sort((a, b) => a.placed_x_cm - b.placed_x_cm)),
    )
      .sort((a, b) =>
        comparePieceLoadingPriority(loadingPriorityPiece(a), loadingPriorityPiece(b)) ||
        a.key.localeCompare(b.key),
      )
      .map((cluster) => ({
        value: cluster,
        sizeCm: cluster.lengthCm,
        weightKg: cluster.weightKg,
        stableKey: cluster.key,
      }));
    const placements = positionSequence(orderedClusters, load.spec.inner_L_cm, "start").flatMap(({ value: cluster, startCm }) => {
      let cursor = startCm;
      return cluster.groups.flatMap((group) => group.placements.map((placement) => {
          const positioned = { ...placement, placed_x_cm: cursor };
          cursor += placement.orient_L_cm;
          return positioned;
        }));
    });
    return {
      key,
      depthCm: Math.max(...placements.map((placement) => placement.orient_W_cm)),
      weightKg: placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0),
      placements,
    };
  });
  const orderedRows = improveBalanceSequence(
    balancedRows
      .sort((a, b) => a.key - b.key)
      .map((row) => ({
        value: row,
        sizeCm: row.depthCm,
        weightKg: row.weightKg,
        stableKey: String(row.key),
      })),
    load.spec.inner_W_cm,
    "center",
  );
  const placements = positionSequence(orderedRows, load.spec.inner_W_cm, "center").flatMap(({ value: row, startCm }) =>
    row.placements.map((placement) => ({ ...placement, placed_y_cm: startCm })),
  );
  return { ...load, placements };
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
  const rowCount = Math.min(
    load.placements.length,
    Math.floor((load.spec.inner_W_cm - WIDTH_CLEARANCE_CM) / first.orient_W_cm),
  );
  const maxColumns = Math.floor(load.spec.inner_L_cm / first.orient_L_cm);
  const widthRemainder = load.spec.inner_W_cm - rowCount * first.orient_W_cm;
  if (rowCount < 2 || maxColumns < 1 || load.placements.length > rowCount * maxColumns || widthRemainder < WIDTH_CLEARANCE_CM) return null;

  const groups = groupPlacements(load.placements);
  const orderedGroups = improveBalanceSequence(
    groups.map((group) => ({
      value: group,
      sizeCm: Math.ceil(group.placements.length / rowCount) * first.orient_L_cm,
      weightKg: group.weightKg,
      stableKey: group.key,
    })),
    load.spec.inner_L_cm,
    "start",
    MIN_FRONT_REAR_REORDER_IMPROVEMENT_SCORE,
  ).map((item) => item.value);
  const rows = Array.from({ length: rowCount }, () => [] as Placement[]);
  const rowWeights = Array.from({ length: rowCount }, () => 0);
  for (const group of orderedGroups) {
    for (const placement of group.placements) {
      const available = rows
        .map((row, index) => ({ index, count: row.length, weightKg: rowWeights[index] }))
        .filter((row) => row.count < maxColumns)
        .sort((a, b) => a.count - b.count || a.weightKg - b.weightKg || a.index - b.index);
      const rowIndex = available[0]?.index;
      if (rowIndex == null) return null;
      rows[rowIndex].push(placement);
      rowWeights[rowIndex] += placement.piece.weight_kg;
    }
  }

  const sideMargin = widthRemainder / 2;
  const placements = rows.flatMap((row, rowIndex) => row.map((placement, columnIndex) => ({
    ...placement,
    placed_x_cm: columnIndex * first.orient_L_cm,
    placed_y_cm: sideMargin + rowIndex * first.orient_W_cm,
  })));
  return { ...load, placements };
};

const balanceSpatialPlacements = (load: ContainerLoad): ContainerLoad => {
  if (load.spec.type.endsWith("FR")) {
    const extentCm = load.spec.deck_L_cm ?? load.spec.inner_L_cm;
    const ordered = improveBalanceSequence(
      load.placements.map((placement) => ({
        value: placement,
        sizeCm: placement.orient_L_cm,
        weightKg: placement.piece.weight_kg,
        stableKey: placement.piece.piece_id,
      })),
      extentCm,
      "center",
      0,
      flatRackSequenceScore,
    );
    return {
      ...load,
      placements: positionSequence(ordered, extentCm, "center").map(({ value: placement, startCm }) => ({
        ...placement,
        placed_x_cm: startCm,
        placed_y_cm: (load.spec.inner_W_cm - placement.orient_W_cm) / 2,
      })),
    };
  }
  if (load.spec.type.endsWith("OT")) {
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
  if (load.placements.some((placement) => placement.placed_z_cm !== 0)) {
    const minY = Math.min(...load.placements.map((placement) => placement.placed_y_cm));
    const maxY = Math.max(...load.placements.map((placement) => placement.placed_y_cm + placement.orient_W_cm));
    const shiftY = (load.spec.inner_W_cm - (maxY - minY)) / 2 - minY;
    return {
      ...load,
      placements: load.placements.map((placement) => ({
        ...placement,
        placed_y_cm: placement.placed_y_cm + shiftY,
      })),
    };
  }
  const balanced = balanceUniformLoad(load) ?? balanceExistingRows(load);
  return hasLargeHeightStep(balanced.placements) ? load : balanced;
};

export const packPieces = (spec: ContainerSpec, pieces: Piece[], maxContainers?: number): PackResult => {
  const packed = packSequentially(spec, pieces, maxContainers);
  return { ...packed, loads: rebalanceLoadsByWeight(spec, packed.loads).map(balanceSpatialPlacements) };
};
