import { evaluateOog, isBreakbulkRequired, isFrCargoSubstantial, requiresReefer } from "./oog";
import { packPieces, sortPieces } from "./packing";
import type {
  BiasMetrics,
  ContainerLoad,
  ContainerSpec,
  OogResult,
  Piece,
  PlanResult,
  PlanningSettings,
  WeightAuditMetrics,
} from "./types";
import { ceilTo } from "./rounding";
import { assertValidPlanningInput } from "./validation";
import { cargoCenterOfGravity, splitWeightAcrossMidpoint } from "./weightBalance";

const keyFor = (type: string, index: number): string => `${type}-${index}`;

const isOw = (oog: OogResult): boolean => oog.over_L_cm > 0 || oog.over_W_cm > 0;
const isOhOnly = (oog: OogResult): boolean => oog.over_H_cm > 0 && !isOw(oog);

const canFitSpecial = (piece: Piece, spec: ContainerSpec): boolean => {
  if (piece.weight_kg > spec.max_payload_kg) return false;
  if (spec.type.endsWith("FR")) {
    const deckLength = spec.deck_L_cm ?? spec.inner_L_cm;
    return piece.L_cm <= deckLength || piece.W_cm <= deckLength;
  }
  const candidates = piece.rotate_allowed
    ? [
        [piece.L_cm, piece.W_cm, piece.H_cm],
        [piece.W_cm, piece.L_cm, piece.H_cm],
        [piece.L_cm, piece.H_cm, piece.W_cm],
        [piece.H_cm, piece.L_cm, piece.W_cm],
        [piece.W_cm, piece.H_cm, piece.L_cm],
        [piece.H_cm, piece.W_cm, piece.L_cm],
      ]
    : [[piece.L_cm, piece.W_cm, piece.H_cm]];
  return candidates.some(([length, width, height]) => {
    const heightFits = spec.type.endsWith("OT") || height <= spec.inner_H_cm;
    return length <= spec.inner_L_cm && width <= spec.inner_W_cm && heightFits;
  });
};

const chooseSpecialSpec = (
  piece: Piece,
  baseType: "FR" | "OT",
  specialSpecs: ContainerSpec[],
  existing: Piece[],
): ContainerSpec | undefined => {
  const candidates = specialSpecs.filter((spec) => spec.type.endsWith(baseType) && canFitSpecial(piece, spec));
  if (candidates.length <= 1) return candidates[0];
  const compared = candidates
    .map((spec) => {
      const packed = packPieces(spec, sortPieces([...existing, piece]));
      return {
        spec,
        valid: packed.unplaced.length === 0,
        count: packed.loads.length,
        totalCost: packed.loads.length * spec.cost,
      };
    })
    .filter((entry) => entry.valid)
    .sort((a, b) => a.count - b.count || a.totalCost - b.totalCost || a.spec.type.localeCompare(b.spec.type));
  return compared[0]?.spec ?? [...candidates].sort((a, b) => a.cost - b.cost || a.type.localeCompare(b.type))[0];
};

const normalizeLoadIndices = (loads: ContainerLoad[]): ContainerLoad[] => {
  const counters = new Map<string, number>();
  return loads.map((load) => {
    const nextIndex = (counters.get(load.spec.type) ?? 0) + 1;
    counters.set(load.spec.type, nextIndex);
    return {
      ...load,
      index: nextIndex,
      placements: load.placements.map((placement) => ({ ...placement, container_index: nextIndex })),
    };
  });
};

const weightBalanceReason = (loads: ContainerLoad[]): string | null => {
  const counts = new Map<string, number>();
  for (const load of loads) counts.set(load.spec.type, (counts.get(load.spec.type) ?? 0) + 1);
  const types = [...counts.entries()].filter(([, count]) => count > 1).map(([type]) => type);
  return types.length
    ? `${types.join("・")}は、寸法・混載・Payload制約を満たす範囲でコンテナ間の貨物重量差を小さくするよう再配置しました。`
    : null;
};

const incompatibilityReason = (pieces: Piece[], loads: ContainerLoad[]): string | null => {
  const containerByPiece = new Map<string, string>();
  for (const load of loads) {
    const key = keyFor(load.spec.type, load.index);
    for (const placement of load.placements) containerByPiece.set(placement.piece.piece_id, key);
  }
  const separatedPairs = new Set<string>();
  for (const piece of pieces) {
    const forbiddenIds = piece.incompatible_with_ids.split(",").map((value) => value.trim()).filter(Boolean);
    for (const forbiddenId of forbiddenIds) {
      const counterparts = pieces.filter((candidate) => candidate.orig_id === forbiddenId);
      if (counterparts.some((counterpart) => containerByPiece.get(counterpart.piece_id) !== containerByPiece.get(piece.piece_id))) {
        separatedPairs.add([piece.orig_id, forbiddenId].sort().join(" ↔ "));
      }
    }
  }
  return separatedPairs.size
    ? `混載不可指定（${[...separatedPairs].join("、")}）により、対象貨物を別コンテナへ分けました。`
    : null;
};

const packMultiType = (pieces: Piece[], specs: ContainerSpec[]): { loads: ContainerLoad[]; unplaced: Piece[] } => {
  let remaining = [...pieces];
  const loads: ContainerLoad[] = [];
  while (remaining.length) {
    const choices = specs
      .map((spec, order) => {
        const result = packPieces(spec, remaining, 1);
        const placed = result.loads[0]?.placements.length ?? 0;
        return { spec, result, placed, order };
      })
      .filter((choice) => choice.placed > 0)
      .sort(
        (a, b) =>
          b.placed - a.placed ||
          a.spec.cost / a.placed - b.spec.cost / b.placed ||
          a.order - b.order,
      );
    const selected = choices[0];
    if (!selected) break;
    loads.push(...selected.result.loads);
    const placedIds = new Set(selected.result.loads.flatMap((load) => load.placements.map((placement) => placement.piece.piece_id)));
    remaining = remaining.filter((piece) => !placedIds.has(piece.piece_id));
  }
  return { loads, unplaced: remaining };
};

const fillSpecialLoads = (
  initialLoads: ContainerLoad[],
  initialCandidates: Piece[],
): { loads: ContainerLoad[]; remaining: Piece[] } => {
  let remaining = [...initialCandidates];
  const loads = initialLoads.map((load) => {
    if (load.spec.type === "RF") return load;
    let accepted = load.placements.map((placement) => placement.piece);
    let current = load;
    for (const candidate of [...remaining].sort((a, b) => a.m3 - b.m3 || a.weight_kg - b.weight_kg)) {
      const attempt = packPieces(load.spec, [...accepted, candidate], 1);
      const placedIds = new Set(attempt.loads[0]?.placements.map((placement) => placement.piece.piece_id) ?? []);
      if (attempt.unplaced.length === 0 && placedIds.has(candidate.piece_id) && accepted.every((piece) => placedIds.has(piece.piece_id))) {
        accepted = [...accepted, candidate];
        current = attempt.loads[0];
        remaining = remaining.filter((piece) => piece.piece_id !== candidate.piece_id);
      }
    }
    return current;
  });
  return { loads, remaining };
};

export const computeBias = (load: ContainerLoad, thresholdPct: number): BiasMetrics => {
  const totalWeight = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);
  if (totalWeight <= 0) {
    return {
      bias_warn: false,
      bias_reason: "",
      offset_x_pct: 0,
      offset_y_pct: 0,
      front_rear_diff_pct: 0,
      left_right_diff_pct: 0,
    };
  }
  const halfL = load.spec.inner_L_cm / 2;
  const halfW = load.spec.inner_W_cm / 2;
  let front = 0;
  let rear = 0;
  let left = 0;
  let right = 0;
  for (const placement of load.placements) {
    const frontRearSplit = splitWeightAcrossMidpoint(
      placement.placed_x_cm,
      placement.orient_L_cm,
      halfL,
      placement.piece.weight_kg,
    );
    const leftRightSplit = splitWeightAcrossMidpoint(
      placement.placed_y_cm,
      placement.orient_W_cm,
      halfW,
      placement.piece.weight_kg,
    );
    front += frontRearSplit.beforeKg;
    rear += frontRearSplit.afterKg;
    left += leftRightSplit.beforeKg;
    right += leftRightSplit.afterKg;
  }
  const centerOfGravity = cargoCenterOfGravity(load);
  const offsetX = ceilTo((Math.abs((centerOfGravity?.xCm ?? halfL) - halfL) / halfL) * 100, 0.001);
  const offsetY = ceilTo((Math.abs((centerOfGravity?.yCm ?? halfW) - halfW) / halfW) * 100, 0.001);
  const frontRear = ceilTo((Math.abs(front - rear) / (totalWeight / 2)) * 100, 0.001);
  const leftRight = ceilTo((Math.abs(left - right) / (totalWeight / 2)) * 100, 0.001);
  const reasons: string[] = [];
  if (offsetX > thresholdPct) reasons.push("前後重心偏差");
  if (offsetY > thresholdPct) reasons.push("左右重心偏差");
  if (frontRear > thresholdPct) reasons.push("前後重量差");
  if (leftRight > thresholdPct) reasons.push("左右重量差");
  return {
    bias_warn: reasons.length > 0,
    bias_reason: reasons.join(" / "),
    offset_x_pct: offsetX,
    offset_y_pct: offsetY,
    front_rear_diff_pct: frontRear,
    left_right_diff_pct: leftRight,
  };
};

const computeWeightAudit = (load: ContainerLoad, settings: PlanningSettings): WeightAuditMetrics => {
  const weights = load.placements.map((placement) => placement.piece.weight_kg).sort((a, b) => b - a);
  const cargoWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const grossWeight = cargoWeight + load.spec.tare_weight_kg;
  const payloadRatio = load.spec.max_payload_kg > 0 ? (cargoWeight / load.spec.max_payload_kg) * 100 : 0;
  const vehicleRatio = settings.vehicle_gross_limit_kg ? (grossWeight / settings.vehicle_gross_limit_kg) * 100 : 0;
  const topWeight = weights.slice(0, Math.max(settings.concentration_top_n, 1)).reduce((sum, value) => sum + value, 0);
  const concentration = cargoWeight > 0 ? (topWeight / cargoWeight) * 100 : 0;
  const messages: string[] = [];
  if (payloadRatio > 100) messages.push(`最大積載重量超過 ${cargoWeight.toLocaleString()} / ${load.spec.max_payload_kg.toLocaleString()}kg`);
  else if (payloadRatio >= settings.payload_near_threshold_pct) messages.push(`最大積載重量に近接 ${payloadRatio.toFixed(1)}%`);
  if (settings.vehicle_gross_limit_kg && grossWeight > settings.vehicle_gross_limit_kg) {
    messages.push(`車両総重量目安超過 ${grossWeight.toLocaleString()} / ${settings.vehicle_gross_limit_kg.toLocaleString()}kg`);
  }
  if (weights.length >= 2 && concentration >= settings.concentration_warn_threshold_pct) {
    messages.push(`重量集中度 ${concentration.toFixed(1)}%（上位${settings.concentration_top_n}個）`);
  }
  return {
    total_weight_kg: cargoWeight,
    gross_weight_kg: grossWeight,
    vehicle_limit_kg: settings.vehicle_gross_limit_kg,
    vehicle_limit_ratio_pct: vehicleRatio,
    payload_limit_kg: load.spec.max_payload_kg,
    payload_ratio_pct: payloadRatio,
    concentration_top_n_ratio_pct: concentration,
    weight_alert: messages.length > 0,
    weight_alert_message: messages.join(" / "),
  };
};

const attachAudits = (
  loads: ContainerLoad[],
  settings: PlanningSettings,
): Pick<PlanResult, "bias_by_container" | "weight_audit_by_container"> => {
  const bias = new Map<string, BiasMetrics>();
  const weight = new Map<string, WeightAuditMetrics>();
  for (const load of loads) {
    const key = keyFor(load.spec.type, load.index);
    bias.set(key, computeBias(load, settings.bias_threshold_pct));
    weight.set(key, computeWeightAudit(load, settings));
  }
  return { bias_by_container: bias, weight_audit_by_container: weight };
};

export const estimatePlan = (
  pieces: Piece[],
  specs: ContainerSpec[],
  settings: PlanningSettings,
): PlanResult => {
  assertValidPlanningInput(pieces, specs, settings);
  const standardSpecs = specs.filter((spec) => spec.category === "STANDARD");
  const specialSpecs = specs.filter((spec) => spec.category === "SPECIAL");
  const refSpec = standardSpecs.find((spec) => spec.type === "40HC") ?? standardSpecs[0];
  if (!refSpec) throw new Error("STANDARDコンテナ仕様がありません。");

  const oogResults = new Map(pieces.map((piece) => [piece.piece_id, evaluateOog(piece, refSpec)]));
  const fortyFr = specialSpecs.find((spec) => spec.type === "40FR");
  const specialGroups = new Map<string, Piece[]>();
  const specialReasons = new Map<string, string>();
  const breakbulk: Piece[] = [];
  const ambient: Piece[] = [];
  const oogEntries = pieces.map((piece) => [piece, oogResults.get(piece.piece_id)!] as const);
  const preferOtForOh = !oogEntries.some(([, oog]) => oog.oog_flag && !isOhOnly(oog));

  const addSpecial = (spec: ContainerSpec | undefined, piece: Piece, reason: string) => {
    if (!spec) {
      breakbulk.push(piece);
      specialReasons.set(piece.piece_id, `${reason} / 対応コンテナ仕様なし`);
      return;
    }
    specialGroups.set(spec.type, [...(specialGroups.get(spec.type) ?? []), piece]);
    specialReasons.set(piece.piece_id, reason);
  };

  for (const [piece, oog] of oogEntries) {
    if (requiresReefer(piece)) {
      addSpecial(specialSpecs.find((spec) => spec.type === "RF"), piece, "冷凍・冷蔵キーワード検出");
      continue;
    }
    if (isBreakbulkRequired(piece, fortyFr)) {
      breakbulk.push(piece);
      specialReasons.set(piece.piece_id, "40FR想定でも積載不可（在来船・個別輸送を要検討）");
      continue;
    }
    if (!oog.oog_flag) {
      ambient.push(piece);
      continue;
    }
    if (isOw(oog)) {
      if (!isFrCargoSubstantial(piece)) {
        breakbulk.push(piece);
        specialReasons.set(piece.piece_id, "FR最小貨物基準未満（個別輸送・専用架台等を要検討）");
        continue;
      }
      const existing = specialSpecs
        .filter((spec) => spec.type.endsWith("FR"))
        .flatMap((spec) => specialGroups.get(spec.type) ?? []);
      addSpecial(chooseSpecialSpec(piece, "FR", specialSpecs, existing), piece, "長さ・幅超過（FR候補）");
      continue;
    }
    const primary: "OT" | "FR" = preferOtForOh ? "OT" : "FR";
    const secondary: "OT" | "FR" = primary === "OT" ? "FR" : "OT";
    const primaryExisting = specialSpecs
      .filter((spec) => spec.type.endsWith(primary))
      .flatMap((spec) => specialGroups.get(spec.type) ?? []);
    const selected =
      chooseSpecialSpec(piece, primary, specialSpecs, primaryExisting) ??
      chooseSpecialSpec(piece, secondary, specialSpecs, []);
    addSpecial(selected, piece, `高さ超過（${selected?.type.endsWith("FR") ? "FR" : "OT"}候補）`);
  }

  const specialLoads: ContainerLoad[] = [];
  const unplacedSpecial: Piece[] = [];
  for (const [type, specialPieces] of specialGroups) {
    const spec = specialSpecs.find((candidate) => candidate.type === type);
    if (!spec) {
      unplacedSpecial.push(...specialPieces);
      continue;
    }
    const packed = packPieces(spec, sortPieces(specialPieces));
    specialLoads.push(...packed.loads);
    unplacedSpecial.push(...packed.unplaced);
  }

  const filled = fillSpecialLoads(specialLoads, sortPieces(ambient));
  const standard = packMultiType(filled.remaining, standardSpecs);
  const loads = normalizeLoadIndices([...filled.loads, ...standard.loads]);
  const audits = attachAudits(loads, settings);
  const unplacedMap = new Map<string, Piece>();
  [...breakbulk, ...unplacedSpecial, ...standard.unplaced].forEach((piece) => unplacedMap.set(piece.piece_id, piece));
  const decisionReasons: string[] = [];
  if ([...specialReasons.values()].some((reason) => reason.includes("冷凍・冷蔵"))) decisionReasons.push("冷凍・冷蔵貨物はRFへ分離しました。");
  if ([...specialReasons.values()].some((reason) => reason.includes("FR候補"))) decisionReasons.push("長さ・幅超過貨物はFRへ振り分けました。船社承認と固縛条件の確認が必要です。");
  if ([...specialReasons.values()].some((reason) => reason.includes("OT候補"))) decisionReasons.push("高さ超過貨物はOTへ振り分けました。上方クリアランスの確認が必要です。");
  if ([...specialReasons.values()].some((reason) => reason.includes("40FR想定でも積載不可"))) decisionReasons.push("40FRのデッキ長または最大積載重量を超える貨物をコンテナ計画から除外しました。");
  if ([...specialReasons.values()].some((reason) => reason.includes("FR最小貨物基準未満"))) decisionReasons.push("小型・細長いOOG貨物はFRからの振落しリスクを考慮し、自動FR積載の対象外としました。");
  const balanceReason = weightBalanceReason(loads);
  if (balanceReason) decisionReasons.push(balanceReason);
  const separatedReason = incompatibilityReason(pieces, loads);
  if (separatedReason) decisionReasons.push(separatedReason);
  return {
    mode: "estimate",
    loads,
    placements: loads.flatMap((load) => load.placements),
    unplaced: [...unplacedMap.values()],
    oog_results: oogResults,
    special_reason_by_piece: specialReasons,
    decision_reasons: decisionReasons,
    breakbulk_piece_ids: breakbulk.map((piece) => piece.piece_id),
    ...audits,
  };
};

export const validatePlan = (
  pieces: Piece[],
  specs: ContainerSpec[],
  requestedCounts: Record<string, number>,
  settings: PlanningSettings,
): PlanResult => {
  assertValidPlanningInput(pieces, specs, settings, requestedCounts);
  const standardSpecs = specs.filter((spec) => spec.category === "STANDARD");
  const refSpec = standardSpecs.find((spec) => spec.type === "40HC") ?? standardSpecs[0];
  if (!refSpec) throw new Error("STANDARDコンテナ仕様がありません。");
  let remaining = sortPieces(pieces);
  const loads: ContainerLoad[] = [];
  for (const spec of specs) {
    const count = requestedCounts[spec.type] ?? 0;
    if (!count || !remaining.length) continue;
    const packed = packPieces(spec, remaining, count);
    loads.push(...packed.loads);
    remaining = packed.unplaced;
  }
  const normalized = normalizeLoadIndices(loads);
  const audits = attachAudits(normalized, settings);
  const decisionReasons = remaining.length ? ["指定本数に収まらない貨物があります。積載不可一覧とOOG判定を確認してください。"] : [];
  const balanceReason = weightBalanceReason(normalized);
  if (balanceReason) decisionReasons.push(balanceReason);
  const separatedReason = incompatibilityReason(pieces, normalized);
  if (separatedReason) decisionReasons.push(separatedReason);
  return {
    mode: "validate",
    loads: normalized,
    placements: normalized.flatMap((load) => load.placements),
    unplaced: remaining,
    oog_results: new Map(pieces.map((piece) => [piece.piece_id, evaluateOog(piece, refSpec)])),
    bias_by_container: audits.bias_by_container,
    weight_audit_by_container: audits.weight_audit_by_container,
    special_reason_by_piece: new Map(),
    decision_reasons: decisionReasons,
    breakbulk_piece_ids: [],
    requested_counts: requestedCounts,
  };
};

export const containerKey = keyFor;
