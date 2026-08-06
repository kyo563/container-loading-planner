import { evaluateOog } from "./oog";
import { build40GpSubstitutionMap } from "./containerSubstitution";
import { hasLargeAdjacentHeightDifference } from "./packing";
import { auditContainerLoads, containerKey } from "./planner";
import type {
  ContainerLoad,
  ContainerSpec,
  Piece,
  Placement,
  PlanResult,
  PlanningSettings,
} from "./types";

export const MANUAL_POSITION_GRID_CM = 5;

export interface ManualPlacementUpdate {
  loads: ContainerLoad[];
  error: string | null;
}

const snapToGrid = (value: number): number =>
  Math.round(value / MANUAL_POSITION_GRID_CM) * MANUAL_POSITION_GRID_CM;

const rangesOverlap = (startA: number, sizeA: number, startB: number, sizeB: number): boolean =>
  startA < startB + sizeB && startA + sizeA > startB;

const placementsOverlap = (a: Placement, b: Placement): boolean =>
  rangesOverlap(a.placed_x_cm, a.orient_L_cm, b.placed_x_cm, b.orient_L_cm) &&
  rangesOverlap(a.placed_y_cm, a.orient_W_cm, b.placed_y_cm, b.orient_W_cm) &&
  rangesOverlap(a.placed_z_cm, a.orient_H_cm, b.placed_z_cm, b.orient_H_cm);

const incompatibleIds = (piece: Piece): Set<string> =>
  new Set(piece.incompatible_with_ids.split(",").map((value) => value.trim()).filter(Boolean));

const areIncompatible = (a: Piece, b: Piece): boolean =>
  incompatibleIds(a).has(b.orig_id) || incompatibleIds(b).has(a.orig_id);

export const createManualLoads = (
  specs: ContainerSpec[],
  requestedCounts: Record<string, number>,
): ContainerLoad[] =>
  specs.flatMap((spec) =>
    Array.from({ length: requestedCounts[spec.type] ?? 0 }, (_, index) => ({
      spec,
      index: index + 1,
      placements: [],
    })),
  );

const placementError = (load: ContainerLoad, candidate: Placement): string | null => {
  if (
    candidate.placed_x_cm < 0 ||
    candidate.placed_y_cm < 0 ||
    candidate.placed_x_cm + candidate.orient_L_cm > load.spec.inner_L_cm ||
    candidate.placed_y_cm + candidate.orient_W_cm > load.spec.inner_W_cm
  ) {
    return "貨物がコンテナ床面の範囲を超えています。";
  }
  if (candidate.placed_z_cm + candidate.orient_H_cm > load.spec.inner_H_cm) {
    return "貨物高さがコンテナ内寸高を超えています。";
  }
  const cargoWeight = load.placements.reduce(
    (sum, placement) => sum + placement.piece.weight_kg,
    candidate.piece.weight_kg,
  );
  if (cargoWeight > load.spec.max_payload_kg) {
    return `最大積載重量を${Math.ceil(cargoWeight - load.spec.max_payload_kg).toLocaleString()}kg超過します。`;
  }
  if (load.placements.some((placement) => placementsOverlap(placement, candidate))) {
    return "ほかの貨物と重なっています。空いている位置へ移動してください。";
  }
  if (load.placements.some((placement) => areIncompatible(placement.piece, candidate.piece))) {
    return "混載不可に指定された貨物が同じコンテナにあります。";
  }
  return null;
};

export const placeManualPiece = (
  loads: ContainerLoad[],
  targetContainerKey: string,
  piece: Piece,
  xCm: number,
  yCm: number,
  rotated: boolean,
): ManualPlacementUpdate => {
  if (rotated && !piece.rotate_allowed) {
    return { loads, error: "この貨物は回転不可に設定されています。" };
  }
  const target = loads.find((load) => containerKey(load.spec.type, load.index) === targetContainerKey);
  if (!target) return { loads, error: "配置先コンテナが見つかりません。" };

  const orientL = rotated ? piece.W_cm : piece.L_cm;
  const orientW = rotated ? piece.L_cm : piece.W_cm;
  const maxX = target.spec.inner_L_cm - orientL;
  const maxY = target.spec.inner_W_cm - orientW;
  const positionedX = Math.min(Math.max(0, snapToGrid(xCm)), Math.max(0, maxX));
  const positionedY = Math.min(Math.max(0, snapToGrid(yCm)), Math.max(0, maxY));
  const nextLoads = loads.map((load) => ({
    ...load,
    placements: load.placements.filter((placement) => placement.piece.piece_id !== piece.piece_id),
  }));
  const nextTarget = nextLoads.find((load) => containerKey(load.spec.type, load.index) === targetContainerKey)!;
  const candidate: Placement = {
    piece,
    container_type: nextTarget.spec.type,
    container_category: nextTarget.spec.category,
    container_index: nextTarget.index,
    placed_x_cm: positionedX,
    placed_y_cm: positionedY,
    placed_z_cm: 0,
    orient_L_cm: orientL,
    orient_W_cm: orientW,
    orient_H_cm: piece.H_cm,
    rotation_key: rotated ? "WLH" : "LWH",
  };
  const error = placementError(nextTarget, candidate);
  if (error) return { loads, error };
  return {
    loads: nextLoads.map((load) =>
      containerKey(load.spec.type, load.index) === targetContainerKey
        ? { ...load, placements: [...load.placements, candidate] }
        : load,
    ),
    error: null,
  };
};

export const removeManualPiece = (loads: ContainerLoad[], pieceId: string): ContainerLoad[] =>
  loads.map((load) => ({
    ...load,
    placements: load.placements.filter((placement) => placement.piece.piece_id !== pieceId),
  }));

export const buildManualPlanResult = (
  loads: ContainerLoad[],
  pieces: Piece[],
  specs: ContainerSpec[],
  settings: PlanningSettings,
  requestedCounts: Record<string, number>,
): PlanResult => {
  const normalizedLoads = loads.map((load) => ({
    ...load,
    placements: [...load.placements].sort(
      (a, b) =>
        a.placed_x_cm - b.placed_x_cm ||
        a.placed_y_cm - b.placed_y_cm ||
        a.piece.piece_id.localeCompare(b.piece.piece_id),
    ),
  }));
  const placements = normalizedLoads.flatMap((load) => load.placements);
  const placedIds = new Set(placements.map((placement) => placement.piece.piece_id));
  const unplaced = pieces.filter((piece) => !placedIds.has(piece.piece_id));
  const referenceSpec =
    specs.find((spec) => spec.type === "40HC") ??
    specs.find((spec) => spec.category === "STANDARD") ??
    specs[0];
  if (!referenceSpec) throw new Error("OOG判定に使用できるコンテナ仕様がありません。");
  const audits = auditContainerLoads(normalizedLoads, settings);
  const decisionReasons = [
    "手動プランモードで作成した配置です。貨物位置は利用者が指定し、集計・重量・偏荷重・OOGを自動監査しました。",
  ];
  if (unplaced.length) {
    decisionReasons.push(`${unplaced.length}ピースは手動配置されていません。CLP確定前に未配置貨物を確認してください。`);
  }
  const hasHeightAdvisory = normalizedLoads.some((load) =>
    load.placements.some((placement, index) =>
      load.placements.slice(index + 1).some((other) =>
        hasLargeAdjacentHeightDifference(placement, other)),
    ),
  );
  if (hasHeightAdvisory) {
    decisionReasons.push("隣接貨物に100cm以上の高さ差があります。配置不可ではありませんが、倒れ込み対策と固縛を現場で確認してください。");
  }
  return {
    mode: "manual",
    loads: normalizedLoads,
    placements,
    unplaced,
    oog_results: new Map(pieces.map((piece) => [piece.piece_id, evaluateOog(piece, referenceSpec)])),
    bias_by_container: audits.bias_by_container,
    weight_audit_by_container: audits.weight_audit_by_container,
    special_reason_by_piece: new Map(),
    decision_reasons: decisionReasons,
    breakbulk_piece_ids: [],
    substitution_by_container: build40GpSubstitutionMap(normalizedLoads, specs),
    requested_counts: requestedCounts,
  };
};
