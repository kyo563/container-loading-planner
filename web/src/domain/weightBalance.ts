import type { ContainerLoad } from "./types";

const MIN_AXIS_SIZE_CM = 0.001;

export interface AxisWeightSplit {
  beforeKg: number;
  afterKg: number;
}

export interface CargoCenterOfGravity {
  xCm: number;
  yCm: number;
  totalWeightKg: number;
}

/**
 * 貨物重量は平面上に均等分布すると仮定し、中央線の前後（左右）へ
 * 各側の占有長さ比で按分する。中央線をまたぐ貨物を片側100%に数えない。
 */
export const splitWeightAcrossMidpoint = (
  startCm: number,
  sizeCm: number,
  midpointCm: number,
  weightKg: number,
): AxisWeightSplit => {
  const safeSize = Math.max(sizeCm, MIN_AXIS_SIZE_CM);
  const endCm = startCm + safeSize;
  const beforeLength = Math.max(0, Math.min(endCm, midpointCm) - startCm);
  const afterLength = Math.max(0, endCm - Math.max(startCm, midpointCm));
  const coveredLength = beforeLength + afterLength;

  if (coveredLength <= 0) {
    return startCm + safeSize / 2 <= midpointCm
      ? { beforeKg: weightKg, afterKg: 0 }
      : { beforeKg: 0, afterKg: weightKg };
  }

  return {
    beforeKg: weightKg * (beforeLength / coveredLength),
    afterKg: weightKg * (afterLength / coveredLength),
  };
};

export const cargoCenterOfGravity = (load: ContainerLoad): CargoCenterOfGravity | null => {
  const totalWeightKg = load.placements.reduce(
    (sum, placement) => sum + placement.piece.weight_kg,
    0,
  );
  if (totalWeightKg <= 0) return null;

  const weighted = load.placements.reduce(
    (sum, placement) => ({
      x:
        sum.x
        + placement.piece.weight_kg
          * (placement.placed_x_cm + placement.orient_L_cm / 2),
      y:
        sum.y
        + placement.piece.weight_kg
          * (placement.placed_y_cm + placement.orient_W_cm / 2),
    }),
    { x: 0, y: 0 },
  );

  return {
    xCm: weighted.x / totalWeightKg,
    yCm: weighted.y / totalWeightKg,
    totalWeightKg,
  };
};
