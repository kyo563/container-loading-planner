import { evaluateOog } from "./oog";
import type {
  ContainerLoad,
  ContainerSpec,
  ContainerSubstitutionAssessment,
} from "./types";

const POSITION_TOLERANCE_CM = 0.001;

const uniquePieceIds = (pieceIds: string[]): string =>
  [...new Set(pieceIds)].join("、");

export const assessContainerSubstitution = (
  load: ContainerLoad,
  target: ContainerSpec,
): ContainerSubstitutionAssessment => {
  const lengthBlocked: string[] = [];
  const widthBlocked: string[] = [];
  const heightBlocked: string[] = [];
  const doorBlocked: string[] = [];

  for (const placement of load.placements) {
    if (
      placement.placed_x_cm < -POSITION_TOLERANCE_CM ||
      placement.placed_x_cm + placement.orient_L_cm > target.inner_L_cm + POSITION_TOLERANCE_CM
    ) {
      lengthBlocked.push(placement.piece.piece_id);
    }
    if (
      placement.placed_y_cm < -POSITION_TOLERANCE_CM ||
      placement.placed_y_cm + placement.orient_W_cm > target.inner_W_cm + POSITION_TOLERANCE_CM
    ) {
      widthBlocked.push(placement.piece.piece_id);
    }
    if (
      placement.placed_z_cm < -POSITION_TOLERANCE_CM ||
      placement.placed_z_cm + placement.orient_H_cm > target.inner_H_cm + POSITION_TOLERANCE_CM
    ) {
      heightBlocked.push(placement.piece.piece_id);
    }
    if (!evaluateOog(placement.piece, target).door_passable) {
      doorBlocked.push(placement.piece.piece_id);
    }
  }

  const cargoWeightKg = load.placements.reduce(
    (sum, placement) => sum + placement.piece.weight_kg,
    0,
  );
  const reasons: string[] = [];
  if (lengthBlocked.length) {
    reasons.push(`内寸長を超える配置: ${uniquePieceIds(lengthBlocked)}`);
  }
  if (widthBlocked.length) {
    reasons.push(`内寸幅を超える配置: ${uniquePieceIds(widthBlocked)}`);
  }
  if (heightBlocked.length) {
    reasons.push(`内寸高${target.inner_H_cm}cmを超える配置: ${uniquePieceIds(heightBlocked)}`);
  }
  if (doorBlocked.length) {
    reasons.push(`入口寸法を通過できない貨物: ${uniquePieceIds(doorBlocked)}`);
  }
  if (cargoWeightKg > target.max_payload_kg) {
    reasons.push(`貨物重量${cargoWeightKg.toLocaleString()}kgがPayload ${target.max_payload_kg.toLocaleString()}kgを超過`);
  }

  return {
    source_type: load.spec.type,
    target_type: target.type,
    feasible: reasons.length === 0,
    reasons: reasons.length
      ? reasons
      : ["同じ配置のまま、内寸・入口寸法・最大積載重量の条件内です。"],
  };
};

export const build40GpSubstitutionMap = (
  loads: ContainerLoad[],
  specs: ContainerSpec[],
): Map<string, ContainerSubstitutionAssessment> => {
  const target = specs.find((spec) => spec.type === "40GP");
  const assessments = new Map<string, ContainerSubstitutionAssessment>();
  if (!target) return assessments;
  for (const load of loads) {
    if (load.spec.type !== "40HC" || !load.placements.length) continue;
    assessments.set(
      `${load.spec.type}-${load.index}`,
      assessContainerSubstitution(load, target),
    );
  }
  return assessments;
};
