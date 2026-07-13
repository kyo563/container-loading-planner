import type { ContainerSpec, Piece, PlanningSettings } from "./types";

const MAX_CONTAINER_COUNT = 100;
const MAX_CONTAINER_DIMENSION_CM = 20_000;
const MAX_CONTAINER_WEIGHT_KG = 100_000;

const requireRange = (value: number, label: string, min: number, max: number): void => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}は${min}〜${max.toLocaleString()}の範囲で入力してください。`);
  }
};

const requireOptionalRange = (value: number | null | undefined, label: string, min: number, max: number): void => {
  if (value != null) requireRange(value, label, min, max);
};

const requirePositive = (value: number, label: string, max: number): void => {
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`${label}は0より大きく${max.toLocaleString()}以下で入力してください。`);
  }
};

export const assertValidContainerSpecs = (specs: ContainerSpec[]): void => {
  if (!specs.length) throw new Error("コンテナ仕様がありません。");
  const seenTypes = new Set<string>();
  for (const [index, spec] of specs.entries()) {
    const label = `${index + 1}件目のコンテナ仕様`;
    if (!spec.type.trim()) throw new Error(`${label}のタイプ名が空です。`);
    if (seenTypes.has(spec.type)) throw new Error(`コンテナタイプ「${spec.type}」が重複しています。`);
    seenTypes.add(spec.type);
    requireRange(spec.inner_L_cm, `${spec.type}の内寸長`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireRange(spec.inner_W_cm, `${spec.type}の内寸幅`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireRange(spec.inner_H_cm, `${spec.type}の内寸高`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireOptionalRange(spec.door_W_cm, `${spec.type}の入口幅`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireOptionalRange(spec.door_H_cm, `${spec.type}の入口高`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireOptionalRange(spec.deck_L_cm, `${spec.type}のデッキ長`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireOptionalRange(spec.deck_W_cm, `${spec.type}のデッキ幅`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireRange(spec.max_payload_kg, `${spec.type}の最大積載重量`, 1, MAX_CONTAINER_WEIGHT_KG);
    requireRange(spec.tare_weight_kg, `${spec.type}の風袋重量`, 0, MAX_CONTAINER_WEIGHT_KG);
    requireRange(spec.cost, `${spec.type}の比較コスト`, 0, 1_000_000);
  }
  if (!specs.some((spec) => spec.category === "STANDARD")) throw new Error("STANDARDコンテナ仕様がありません。");
};

export const assertValidPlanningSettings = (settings: PlanningSettings): void => {
  requireRange(settings.bias_threshold_pct, "偏荷重閾値", 0, 100);
  requireOptionalRange(settings.max_cg_offset_x_pct, "前後重心偏差", 0, 100);
  requireOptionalRange(settings.max_cg_offset_y_pct, "左右重心偏差", 0, 100);
  requireOptionalRange(settings.vehicle_gross_limit_kg, "車両総重量", 1, 1_000_000);
  requireRange(settings.payload_near_threshold_pct, "Payload警告閾値", 0, 100);
  if (!Number.isInteger(settings.concentration_top_n) || settings.concentration_top_n < 1 || settings.concentration_top_n > 10_000) {
    throw new Error("重量集中件数は1〜10,000の整数で入力してください。");
  }
  requireRange(settings.concentration_warn_threshold_pct, "重量集中閾値", 0, 100);
};

export const assertValidPieces = (pieces: Piece[]): void => {
  const ids = new Set<string>();
  for (const piece of pieces) {
    if (!piece.piece_id || ids.has(piece.piece_id)) throw new Error(`貨物内部ID「${piece.piece_id || "(空欄)"}」が重複または不正です。`);
    ids.add(piece.piece_id);
    requireRange(piece.L_cm, `${piece.piece_id}の長さ`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireRange(piece.W_cm, `${piece.piece_id}の幅`, 1, MAX_CONTAINER_DIMENSION_CM);
    requireRange(piece.H_cm, `${piece.piece_id}の高さ`, 1, MAX_CONTAINER_DIMENSION_CM);
    requirePositive(piece.weight_kg, `${piece.piece_id}の重量`, MAX_CONTAINER_WEIGHT_KG);
    requirePositive(piece.m3, `${piece.piece_id}の容積`, 1_000_000);
  }
};

export const assertValidRequestedCounts = (counts: Record<string, number>, specs: ContainerSpec[]): void => {
  const knownTypes = new Set(specs.map((spec) => spec.type));
  for (const [type, count] of Object.entries(counts)) {
    if (!knownTypes.has(type)) throw new Error(`指定本数に不明なコンテナタイプ「${type}」があります。`);
    if (!Number.isInteger(count) || count < 0 || count > MAX_CONTAINER_COUNT) {
      throw new Error(`${type}の指定本数は0〜${MAX_CONTAINER_COUNT}の整数で入力してください。`);
    }
  }
};

export const assertValidPlanningInput = (
  pieces: Piece[],
  specs: ContainerSpec[],
  settings: PlanningSettings,
  counts?: Record<string, number>,
): void => {
  assertValidPieces(pieces);
  assertValidContainerSpecs(specs);
  assertValidPlanningSettings(settings);
  if (counts) assertValidRequestedCounts(counts, specs);
};
