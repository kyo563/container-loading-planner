import type { ContainerLoad } from "./types";

export const GENERAL_WIDTH_LIMIT_CM = 250;
export const GENERAL_HEIGHT_LIMIT_CM = 380;
export const HEIGHT_DESIGNATED_ROAD_LIMIT_CM = 410;
export const DIMENSION_C_NIGHT_WIDTH_CM = 300;

const TWO_AXLE_CONTAINER_LIMIT_KG = { "20": 20_320, "40": 24_000 } as const;
const THREE_AXLE_CONTAINER_LIMIT_KG = { "20": 24_000, "40": 30_480 } as const;

export interface JapanRoadTransportAssessment {
  cargoWeightKg: number;
  containerGrossKg: number;
  averageFloorLoadKgM2: number;
  chassisClass: "20" | "40";
  chassisMessage: string;
  specialPermitMessage?: string;
  escortMessage?: string;
  cargoEnvelopeWidthCm: number;
  cargoTopHeightCm: number;
}

const chassisClassFor = (load: ContainerLoad): "20" | "40" =>
  load.spec.type.startsWith("20") || load.spec.inner_L_cm < 800 ? "20" : "40";

export const assessJapanRoadTransport = (load: ContainerLoad): JapanRoadTransportAssessment => {
  const chassisClass = chassisClassFor(load);
  const cargoWeightKg = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);
  const containerGrossKg = cargoWeightKg + load.spec.tare_weight_kg;
  const floorAreaM2 = (load.spec.inner_L_cm * load.spec.inner_W_cm) / 10_000;
  const averageFloorLoadKgM2 = floorAreaM2 > 0 ? cargoWeightKg / floorAreaM2 : 0;
  const minY = Math.min(...load.placements.map((placement) => placement.placed_y_cm), 0);
  const maxY = Math.max(...load.placements.map((placement) => placement.placed_y_cm + placement.orient_W_cm), load.spec.inner_W_cm);
  const cargoEnvelopeWidthCm = maxY - minY;
  const cargoTopHeightCm = Math.max(...load.placements.map((placement) => placement.placed_z_cm + placement.orient_H_cm), 0);
  const twoAxleLimit = TWO_AXLE_CONTAINER_LIMIT_KG[chassisClass];
  const threeAxleLimit = THREE_AXLE_CONTAINER_LIMIT_KG[chassisClass];

  const chassisMessage = containerGrossKg > threeAxleLimit
    ? `3軸目安${threeAxleLimit.toLocaleString()}kg超・輸送方法要確認`
    : containerGrossKg > twoAxleLimit
      ? `要3軸候補（2軸目安${twoAxleLimit.toLocaleString()}kg超）`
      : `2軸目安内（上限${twoAxleLimit.toLocaleString()}kg・車検証確認）`;

  let specialPermitMessage: string | undefined;
  let escortMessage: string | undefined;
  if (load.spec.category === "SPECIAL") {
    const reasons: string[] = [];
    if (cargoEnvelopeWidthCm > GENERAL_WIDTH_LIMIT_CM) reasons.push(`幅${cargoEnvelopeWidthCm.toFixed(1)}cm（一般制限${GENERAL_WIDTH_LIMIT_CM}cm超）`);
    if (cargoTopHeightCm > GENERAL_HEIGHT_LIMIT_CM) reasons.push(`貨物上端${cargoTopHeightCm.toFixed(1)}cm（車両全高はさらに増加）`);
    specialPermitMessage = reasons.length
      ? `特車申請要確認：${reasons.join("・")}`
      : `特車申請要否確認：車両全高＝貨物上端${cargoTopHeightCm.toFixed(1)}cm＋シャーシ床面高（一般${GENERAL_HEIGHT_LIMIT_CM}cm／高さ指定道路${HEIGHT_DESIGNATED_ROAD_LIMIT_CM}cm）`;
    escortMessage = cargoEnvelopeWidthCm > DIMENSION_C_NIGHT_WIDTH_CM
      ? "幅3m超：寸法C条件区間では誘導車・夜間通行条件の可能性あり"
      : "許可経路のC・D条件により誘導車措置の可能性あり";
  }

  return { cargoWeightKg, containerGrossKg, averageFloorLoadKgM2, chassisClass, chassisMessage, specialPermitMessage, escortMessage, cargoEnvelopeWidthCm, cargoTopHeightCm };
};
