import { strFromU8, strToU8, zlibSync, unzlibSync } from "fflate";

import {
  containerSpecsForProfile,
  matchesContainerProfile,
  STANDARD_CONTAINER_PROFILE_ID,
} from "./containerProfiles";
import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS } from "./constants";
import type { CargoRow, ContainerSpec, PlanningSettings } from "./types";
import { validateCargoRows } from "./input";
import { assertValidContainerSpecs, assertValidPlanningSettings, assertValidRequestedCounts } from "./validation";

const LEGACY_FORMAT = "lp1";
const PLAN_FORMAT_V2 = "lp2";
const PLAN_FORMAT = "lp3";
const SPECS_FORMAT_V1 = "lps1";
const SPECS_FORMAT = "lps2";
const MAX_TOKEN_CHARS = 60_000;
const MAX_ROWS = 1_000;
const MAX_SPECS = 100;
const MAX_DECOMPRESSED_BYTES = 2_000_000;

export interface SharedPlanData {
  app: "loadpilot";
  version: 1;
  created_at: string;
  rows: CargoRow[];
  mode: "estimate" | "validate";
  counts: Record<string, number>;
  settings: PlanningSettings;
  specs: ContainerSpec[];
}

interface SharedPlanDataV2 {
  app: "loadpilot";
  version: 2;
  created_at: string;
  rows: CargoRow[];
  mode: "estimate" | "validate";
  counts: Record<string, number>;
  settings: PlanningSettings;
  custom_specs_ref?: string;
}

interface SharedSpecsData {
  app: "loadpilot-specs";
  version: 1;
  bundle_id: string;
  specs: ContainerSpec[];
}

type CompactCargoRow = Array<string | number | null>;
type CompactSettingOverride = [number, number | null];
type CompactContainerSpec = Array<string | number | null>;

interface SharedPlanDataV3 {
  a: "lp";
  v: 3;
  p: string;
  r: CompactCargoRow[];
  m: 0 | 1;
  c?: Array<[string, number]>;
  s?: CompactSettingOverride[];
  x?: string;
}

interface SharedSpecsDataV2 {
  a: "lps";
  v: 2;
  b: string;
  p: string;
  u: CompactContainerSpec[];
  d?: string[];
  o?: string[];
}

export interface SharedQrBundle {
  planToken: string;
  planUrl: string;
  profileId: string;
  specsToken?: string;
  specsUrl?: string;
  bundleId?: string;
}

export class SupplementalQrRequiredError extends Error {
  constructor(public readonly bundleId: string) {
    super("このプランはSOC・標準外コンテナ仕様を使用しています。続けて「カスタムコンテナ仕様QR」を読み取ってください。");
    this.name = "SupplementalQrRequiredError";
  }
}

export interface ShareablePlanState {
  rows: CargoRow[];
  mode: "estimate" | "validate";
  counts: Record<string, number>;
  settings: PlanningSettings;
  specs: ContainerSpec[];
}

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base64UrlToBytes = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("共有データの文字列形式が正しくありません。");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const checksum = async (bytes: Uint8Array): Promise<string> => {
  const source = new Uint8Array(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source.buffer));
  return bytesToBase64Url(digest.subarray(0, 8));
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}が数値ではありません。`);
  return value;
};
const optionalFiniteNumber = (value: unknown, label: string): number | null => value === null || value === undefined ? null : finiteNumber(value, label);
const textValue = (value: unknown, label: string, maxLength = 500): string => {
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`${label}の形式が正しくありません。`);
  return value;
};
const booleanValue = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${label}の形式が正しくありません。`);
  return value;
};

const sanitizeRows = (value: unknown): CargoRow[] => {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error("共有できる貨物行数を超えています。");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${index + 1}行目の貨物情報が正しくありません。`);
    return {
      uid: textValue(item.uid, "内部ID", 100),
      id: textValue(item.id, "貨物ID", 200),
      desc: textValue(item.desc, "貨物名"),
      qty: finiteNumber(item.qty, "数量"),
      L_cm: finiteNumber(item.L_cm, "長さ"),
      W_cm: finiteNumber(item.W_cm, "幅"),
      H_cm: finiteNumber(item.H_cm, "高さ"),
      weight_kg: finiteNumber(item.weight_kg, "重量"),
      package_text: textValue(item.package_text, "荷姿", 200),
      rotate_allowed: booleanValue(item.rotate_allowed, "回転可否"),
      stackable: booleanValue(item.stackable, "段積可否"),
      max_stack_load_kg: optionalFiniteNumber(item.max_stack_load_kg, "上積み許容重量"),
      incompatible_with_ids: textValue(item.incompatible_with_ids, "混載不可ID", 1_000),
    };
  });
};

const sanitizeSpecs = (value: unknown): ContainerSpec[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SPECS) throw new Error("コンテナ仕様の件数が正しくありません。");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${index + 1}件目のコンテナ仕様が正しくありません。`);
    const category = item.category;
    if (category !== "STANDARD" && category !== "SPECIAL") throw new Error("コンテナ区分が正しくありません。");
    const spec: ContainerSpec = {
      type: textValue(item.type, "コンテナタイプ", 100),
      category,
      inner_L_cm: finiteNumber(item.inner_L_cm, "内寸長"),
      inner_W_cm: finiteNumber(item.inner_W_cm, "内寸幅"),
      inner_H_cm: finiteNumber(item.inner_H_cm, "内寸高"),
      max_payload_kg: finiteNumber(item.max_payload_kg, "最大積載重量"),
      cost: finiteNumber(item.cost, "コスト"),
      tare_weight_kg: finiteNumber(item.tare_weight_kg, "風袋重量"),
    };
    if (item.door_W_cm !== undefined) spec.door_W_cm = finiteNumber(item.door_W_cm, "入口幅");
    if (item.door_H_cm !== undefined) spec.door_H_cm = finiteNumber(item.door_H_cm, "入口高");
    if (item.deck_L_cm !== undefined) spec.deck_L_cm = finiteNumber(item.deck_L_cm, "デッキ長");
    if (item.deck_W_cm !== undefined) spec.deck_W_cm = finiteNumber(item.deck_W_cm, "デッキ幅");
    return spec;
  });
};

const sanitizeSettings = (value: unknown): PlanningSettings => {
  if (!isRecord(value)) throw new Error("監査条件が正しくありません。");
  return {
    bias_threshold_pct: finiteNumber(value.bias_threshold_pct, "偏荷重閾値"),
    max_cg_offset_x_pct: optionalFiniteNumber(value.max_cg_offset_x_pct, "前後重心偏差"),
    max_cg_offset_y_pct: optionalFiniteNumber(value.max_cg_offset_y_pct, "左右重心偏差"),
    vehicle_gross_limit_kg: optionalFiniteNumber(value.vehicle_gross_limit_kg, "車両総重量"),
    payload_near_threshold_pct: finiteNumber(value.payload_near_threshold_pct, "Payload警告閾値"),
    concentration_top_n: finiteNumber(value.concentration_top_n, "重量集中件数"),
    concentration_warn_threshold_pct: finiteNumber(value.concentration_warn_threshold_pct, "重量集中閾値"),
  };
};

const sanitizeCounts = (value: unknown): Record<string, number> => {
  if (!isRecord(value) || Object.keys(value).length > MAX_SPECS) throw new Error("指定本数が正しくありません。");
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [textValue(key, "コンテナタイプ", 100), finiteNumber(count, "指定本数")]));
};

const sanitizePlan = (value: unknown): SharedPlanData => {
  if (!isRecord(value) || value.app !== "loadpilot" || value.version !== 1) throw new Error("対応していない共有プランです。");
  if (value.mode !== "estimate" && value.mode !== "validate") throw new Error("計算モードが正しくありません。");
  const plan: SharedPlanData = {
    app: "loadpilot",
    version: 1,
    created_at: textValue(value.created_at, "作成日時", 100),
    rows: sanitizeRows(value.rows),
    mode: value.mode,
    counts: sanitizeCounts(value.counts),
    settings: sanitizeSettings(value.settings),
    specs: sanitizeSpecs(value.specs),
  };
  const rowIssues = validateCargoRows(plan.rows);
  if (rowIssues.length) throw new Error(`共有プランの貨物情報が不正です（${rowIssues[0].row}行目: ${rowIssues[0].message}）。`);
  assertValidContainerSpecs(plan.specs);
  assertValidPlanningSettings(plan.settings);
  assertValidRequestedCounts(plan.counts, plan.specs);
  return plan;
};

const sanitizePlanV2 = (value: unknown, specs: ContainerSpec[]): SharedPlanData => {
  if (!isRecord(value) || value.app !== "loadpilot" || value.version !== 2) throw new Error("対応していない共有プランです。");
  if (value.mode !== "estimate" && value.mode !== "validate") throw new Error("計算モードが正しくありません。");
  const plan: SharedPlanData = {
    app: "loadpilot",
    version: 1,
    created_at: textValue(value.created_at, "作成日時", 100),
    rows: sanitizeRows(value.rows),
    mode: value.mode,
    counts: sanitizeCounts(value.counts),
    settings: sanitizeSettings(value.settings),
    specs,
  };
  const rowIssues = validateCargoRows(plan.rows);
  if (rowIssues.length) throw new Error(`共有プランの貨物情報が不正です（${rowIssues[0].row}行目: ${rowIssues[0].message}）。`);
  assertValidContainerSpecs(plan.specs);
  assertValidPlanningSettings(plan.settings);
  assertValidRequestedCounts(plan.counts, plan.specs);
  return plan;
};

const PLANNING_SETTING_KEYS = [
  "bias_threshold_pct",
  "max_cg_offset_x_pct",
  "max_cg_offset_y_pct",
  "vehicle_gross_limit_kg",
  "payload_near_threshold_pct",
  "concentration_top_n",
  "concentration_warn_threshold_pct",
] as const satisfies ReadonlyArray<keyof PlanningSettings>;

const compactRows = (rows: CargoRow[]): CompactCargoRow[] => rows.map((row) => {
  const flags = (row.rotate_allowed ? 1 : 0) | (row.stackable ? 2 : 0);
  const compact: CompactCargoRow = [
    row.id,
    row.desc,
    row.qty,
    row.L_cm,
    row.W_cm,
    row.H_cm,
    row.weight_kg,
    row.package_text,
    flags,
  ];
  if (row.max_stack_load_kg !== null || row.incompatible_with_ids) compact.push(row.max_stack_load_kg);
  if (row.incompatible_with_ids) compact.push(row.incompatible_with_ids);
  return compact;
});

const expandCompactRows = (value: unknown): CargoRow[] => {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error("共有できる貨物行数を超えています。");
  return value.map((item, index) => {
    if (!Array.isArray(item) || item.length < 9 || item.length > 11) {
      throw new Error(`${index + 1}行目の貨物情報が正しくありません。`);
    }
    const flags = finiteNumber(item[8], "貨物属性");
    if (!Number.isInteger(flags) || flags < 0 || flags > 3) throw new Error("貨物属性が正しくありません。");
    return {
      uid: `qr-${index + 1}-${textValue(item[0], "貨物ID", 200)}`,
      id: textValue(item[0], "貨物ID", 200),
      desc: textValue(item[1], "貨物名"),
      qty: finiteNumber(item[2], "数量"),
      L_cm: finiteNumber(item[3], "長さ"),
      W_cm: finiteNumber(item[4], "幅"),
      H_cm: finiteNumber(item[5], "高さ"),
      weight_kg: finiteNumber(item[6], "重量"),
      package_text: textValue(item[7], "荷姿", 200),
      rotate_allowed: Boolean(flags & 1),
      stackable: Boolean(flags & 2),
      max_stack_load_kg: optionalFiniteNumber(item[9], "上積み許容重量"),
      incompatible_with_ids: item[10] === undefined ? "" : textValue(item[10], "混載不可ID", 1_000),
    };
  });
};

const compactSettings = (settings: PlanningSettings): CompactSettingOverride[] =>
  PLANNING_SETTING_KEYS.flatMap((key, index) =>
    Object.is(settings[key], DEFAULT_SETTINGS[key]) ? [] : [[index, settings[key]] as CompactSettingOverride]);

const expandCompactSettings = (value: unknown): PlanningSettings => {
  if (value === undefined) return { ...DEFAULT_SETTINGS };
  if (!Array.isArray(value) || value.length > PLANNING_SETTING_KEYS.length) throw new Error("監査条件が正しくありません。");
  const settings = { ...DEFAULT_SETTINGS };
  const assigned = new Set<number>();
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) throw new Error("監査条件が正しくありません。");
    const index = finiteNumber(item[0], "監査条件番号");
    if (!Number.isInteger(index) || index < 0 || index >= PLANNING_SETTING_KEYS.length || assigned.has(index)) {
      throw new Error("監査条件番号が正しくありません。");
    }
    assigned.add(index);
    const key = PLANNING_SETTING_KEYS[index];
    (settings as unknown as Record<string, number | null>)[key] = optionalFiniteNumber(item[1], key);
  }
  return sanitizeSettings(settings);
};

const compactCounts = (counts: Record<string, number>): Array<[string, number]> =>
  Object.entries(counts).filter(([, count]) => count !== 0);

const expandCompactCounts = (value: unknown): Record<string, number> => {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > MAX_SPECS) throw new Error("指定本数が正しくありません。");
  const counts: Record<string, number> = {};
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) throw new Error("指定本数が正しくありません。");
    const type = textValue(item[0], "コンテナタイプ", 100);
    if (type in counts) throw new Error(`指定本数のコンテナタイプ「${type}」が重複しています。`);
    counts[type] = finiteNumber(item[1], "指定本数");
  }
  return counts;
};

const compactSpec = (spec: ContainerSpec): CompactContainerSpec => [
  spec.type,
  spec.category === "STANDARD" ? 0 : 1,
  spec.inner_L_cm,
  spec.inner_W_cm,
  spec.inner_H_cm,
  spec.door_W_cm ?? null,
  spec.door_H_cm ?? null,
  spec.deck_L_cm ?? null,
  spec.deck_W_cm ?? null,
  spec.max_payload_kg,
  spec.cost,
  spec.tare_weight_kg,
];

const expandCompactSpec = (value: unknown): ContainerSpec => {
  if (!Array.isArray(value) || value.length !== 12) throw new Error("カスタムコンテナ仕様が正しくありません。");
  const categoryCode = finiteNumber(value[1], "コンテナ区分");
  if (categoryCode !== 0 && categoryCode !== 1) throw new Error("コンテナ区分が正しくありません。");
  const spec: ContainerSpec = {
    type: textValue(value[0], "コンテナタイプ", 100),
    category: categoryCode === 0 ? "STANDARD" : "SPECIAL",
    inner_L_cm: finiteNumber(value[2], "内寸長"),
    inner_W_cm: finiteNumber(value[3], "内寸幅"),
    inner_H_cm: finiteNumber(value[4], "内寸高"),
    max_payload_kg: finiteNumber(value[9], "最大積載重量"),
    cost: finiteNumber(value[10], "コスト"),
    tare_weight_kg: finiteNumber(value[11], "風袋重量"),
  };
  const optionalDimensions = [
    ["door_W_cm", value[5]],
    ["door_H_cm", value[6]],
    ["deck_L_cm", value[7]],
    ["deck_W_cm", value[8]],
  ] as const;
  for (const [key, dimension] of optionalDimensions) {
    const parsed = optionalFiniteNumber(dimension, key);
    if (parsed !== null) spec[key] = parsed;
  }
  return spec;
};

type SpecsDelta = Pick<SharedSpecsDataV2, "p" | "u" | "d" | "o">;

const buildSpecsDelta = (specs: ContainerSpec[], profileId: string): SpecsDelta => {
  const baseSpecs = containerSpecsForProfile(profileId);
  const baseByType = new Map(baseSpecs.map((spec) => [spec.type, spec]));
  const targetByType = new Map(specs.map((spec) => [spec.type, spec]));
  const deleted = baseSpecs.filter((spec) => !targetByType.has(spec.type)).map((spec) => spec.type);
  const upserts = specs
    .filter((spec) => !baseByType.has(spec.type) || JSON.stringify(baseByType.get(spec.type)) !== JSON.stringify(spec))
    .map(compactSpec);
  const naturalOrder = [
    ...baseSpecs.filter((spec) => targetByType.has(spec.type)).map((spec) => spec.type),
    ...specs.filter((spec) => !baseByType.has(spec.type)).map((spec) => spec.type),
  ];
  const targetOrder = specs.map((spec) => spec.type);
  return {
    p: profileId,
    u: upserts,
    ...(deleted.length ? { d: deleted } : {}),
    ...(JSON.stringify(naturalOrder) === JSON.stringify(targetOrder) ? {} : { o: targetOrder }),
  };
};

const applySpecsDelta = (delta: SharedSpecsDataV2): ContainerSpec[] => {
  const baseSpecs = containerSpecsForProfile(delta.p);
  const baseTypes = new Set(baseSpecs.map((spec) => spec.type));
  const deleted = new Set(delta.d ?? []);
  if (deleted.size !== (delta.d?.length ?? 0)) throw new Error("削除対象のコンテナタイプが重複しています。");
  if ([...deleted].some((type) => !baseTypes.has(type))) throw new Error("削除対象に標準定義外のコンテナタイプがあります。");
  const upserts = delta.u.map(expandCompactSpec);
  const upsertByType = new Map(upserts.map((spec) => [spec.type, spec]));
  if (upsertByType.size !== upserts.length) throw new Error("カスタムコンテナ仕様が重複しています。");
  const result = baseSpecs
    .filter((spec) => !deleted.has(spec.type))
    .map((spec) => upsertByType.get(spec.type) ?? spec);
  for (const spec of upserts) {
    if (!result.some((item) => item.type === spec.type)) result.push(spec);
  }
  if (result.length === 0 || result.length > MAX_SPECS) throw new Error("コンテナ仕様の件数が正しくありません。");
  if (delta.o) {
    if (new Set(delta.o).size !== delta.o.length || delta.o.length !== result.length) {
      throw new Error("コンテナ仕様の並び順が正しくありません。");
    }
    const byType = new Map(result.map((spec) => [spec.type, spec]));
    const ordered = delta.o.map((type) => byType.get(type));
    if (ordered.some((spec) => !spec)) throw new Error("コンテナ仕様の並び順が正しくありません。");
    return ordered as ContainerSpec[];
  }
  return result;
};

const sanitizePlanV3 = (value: unknown, specs: ContainerSpec[]): SharedPlanData => {
  if (!isRecord(value) || value.a !== "lp" || value.v !== 3) throw new Error("対応していない共有プランです。");
  if (value.m !== 0 && value.m !== 1) throw new Error("計算モードが正しくありません。");
  const plan: SharedPlanData = {
    app: "loadpilot",
    version: 1,
    created_at: "",
    rows: expandCompactRows(value.r),
    mode: value.m === 0 ? "estimate" : "validate",
    counts: expandCompactCounts(value.c),
    settings: expandCompactSettings(value.s),
    specs,
  };
  const rowIssues = validateCargoRows(plan.rows);
  if (rowIssues.length) throw new Error(`共有プランの貨物情報が不正です（${rowIssues[0].row}行目: ${rowIssues[0].message}）。`);
  assertValidContainerSpecs(plan.specs);
  assertValidPlanningSettings(plan.settings);
  assertValidRequestedCounts(plan.counts, plan.specs);
  return plan;
};

const encodePayload = async (format: string, data: unknown): Promise<string> => {
  const compressed = zlibSync(strToU8(JSON.stringify(data)), { level: 9 });
  const token = `${format}.${await checksum(compressed)}.${bytesToBase64Url(compressed)}`;
  if (token.length > MAX_TOKEN_CHARS) throw new Error("共有データが長すぎます。貨物行を減らしてください。");
  return token;
};

const decodePayload = async (token: string, expectedFormat: string): Promise<unknown> => {
  if (token.length > MAX_TOKEN_CHARS) throw new Error("共有URLが長すぎます。");
  const [format, expectedChecksum, payload, ...rest] = token.split(".");
  if (format !== expectedFormat || !expectedChecksum || !payload || rest.length) throw new Error("共有URLの形式が正しくありません。");
  const compressed = base64UrlToBytes(payload);
  if (await checksum(compressed) !== expectedChecksum) throw new Error("共有データが破損または変更されています。");
  let decompressed: Uint8Array;
  try { decompressed = unzlibSync(compressed); } catch { throw new Error("共有データを展開できませんでした。"); }
  if (decompressed.byteLength > MAX_DECOMPRESSED_BYTES) throw new Error("共有データの展開後サイズが上限を超えています。");
  try { return JSON.parse(strFromU8(decompressed)) as unknown; } catch { throw new Error("共有データを読み取れませんでした。"); }
};

const decodeSpecsTokenV1 = async (token: string, expectedBundleId: string): Promise<ContainerSpec[]> => {
  const parsed = await decodePayload(token, SPECS_FORMAT_V1);
  if (!isRecord(parsed) || parsed.app !== "loadpilot-specs" || parsed.version !== 1) throw new Error("特殊コンテナ仕様QRの形式が正しくありません。");
  const bundleId = textValue(parsed.bundle_id, "照合ID", 40);
  if (bundleId !== expectedBundleId) throw new Error("異なるプランの特殊コンテナ仕様QRです。照合IDが一致しません。");
  const specs = sanitizeSpecs(parsed.specs);
  assertValidContainerSpecs(specs);
  return specs;
};

const decodeSpecsTokenV2 = async (
  token: string,
  expectedBundleId: string,
  expectedProfileId: string,
): Promise<ContainerSpec[]> => {
  const parsed = await decodePayload(token, SPECS_FORMAT);
  if (!isRecord(parsed) || parsed.a !== "lps" || parsed.v !== 2 || !Array.isArray(parsed.u)) {
    throw new Error("カスタムコンテナ仕様QRの形式が正しくありません。");
  }
  if (parsed.u.length > MAX_SPECS
    || (parsed.d !== undefined && (!Array.isArray(parsed.d) || parsed.d.length > MAX_SPECS))
    || (parsed.o !== undefined && (!Array.isArray(parsed.o) || parsed.o.length > MAX_SPECS))) {
    throw new Error("カスタムコンテナ仕様QRの件数が正しくありません。");
  }
  const delta: SharedSpecsDataV2 = {
    a: "lps",
    v: 2,
    b: textValue(parsed.b, "照合ID", 40),
    p: textValue(parsed.p, "標準コンテナ定義", 100),
    u: parsed.u as CompactContainerSpec[],
    ...(parsed.d === undefined ? {} : { d: parsed.d.map((type) => textValue(type, "削除対象タイプ", 100)) }),
    ...(parsed.o === undefined ? {} : { o: parsed.o.map((type) => textValue(type, "コンテナ並び順", 100)) }),
  };
  if (delta.b !== expectedBundleId) throw new Error("異なるプランのカスタムコンテナ仕様QRです。照合IDが一致しません。");
  if (delta.p !== expectedProfileId) throw new Error("標準コンテナ定義がプランQRと一致しません。");
  const specs = applySpecsDelta(delta);
  assertValidContainerSpecs(specs);
  return specs;
};

export const encodeSharedPlan = async (state: ShareablePlanState): Promise<string> => {
  return (await buildSharedQrBundle(state)).planToken;
};

export const decodeSharedPlan = async (token: string, specsToken?: string): Promise<SharedPlanData> => {
  if (token.startsWith(`${LEGACY_FORMAT}.`)) return sanitizePlan(await decodePayload(token, LEGACY_FORMAT));
  if (token.startsWith(`${PLAN_FORMAT_V2}.`)) {
    const parsed = await decodePayload(token, PLAN_FORMAT_V2);
    if (!isRecord(parsed)) throw new Error("共有プランの形式が正しくありません。");
    const customRef = parsed.custom_specs_ref === undefined ? undefined : textValue(parsed.custom_specs_ref, "照合ID", 40);
    if (customRef && !specsToken) throw new SupplementalQrRequiredError(customRef);
    const specs = customRef
      ? await decodeSpecsTokenV1(specsToken!, customRef)
      : DEFAULT_CONTAINERS.map((spec) => ({ ...spec }));
    return sanitizePlanV2(parsed, specs);
  }
  const parsed = await decodePayload(token, PLAN_FORMAT);
  if (!isRecord(parsed)) throw new Error("共有プランの形式が正しくありません。");
  const profileId = textValue(parsed.p, "標準コンテナ定義", 100);
  const customRef = parsed.x === undefined ? undefined : textValue(parsed.x, "照合ID", 40);
  if (customRef && !specsToken) throw new SupplementalQrRequiredError(customRef);
  const specs = customRef
    ? await decodeSpecsTokenV2(specsToken!, customRef, profileId)
    : containerSpecsForProfile(profileId);
  return sanitizePlanV3(parsed, specs);
};

export const buildSharedQrBundle = async (state: ShareablePlanState, baseUrl?: string): Promise<SharedQrBundle> => {
  const resolvedBaseUrl = baseUrl ?? (typeof window === "undefined" ? "https://loadpilot.invalid/" : window.location.href.split("#")[0]);
  sanitizePlan({ app: "loadpilot", version: 1, created_at: new Date().toISOString(), ...state });
  const profileId = STANDARD_CONTAINER_PROFILE_ID;
  const custom = !matchesContainerProfile(state.specs, profileId);
  let specsToken: string | undefined;
  let bundleId: string | undefined;
  if (custom) {
    const delta = buildSpecsDelta(state.specs, profileId);
    bundleId = (await checksum(strToU8(JSON.stringify(delta)))).slice(0, 12);
    const specsData: SharedSpecsDataV2 = { a: "lps", v: 2, b: bundleId, ...delta };
    specsToken = await encodePayload(SPECS_FORMAT, specsData);
  }
  const counts = compactCounts(state.counts);
  const settings = compactSettings(state.settings);
  const planData: SharedPlanDataV3 = {
    a: "lp",
    v: 3,
    p: profileId,
    r: compactRows(state.rows),
    m: state.mode === "estimate" ? 0 : 1,
    ...(counts.length ? { c: counts } : {}),
    ...(settings.length ? { s: settings } : {}),
    ...(bundleId ? { x: bundleId } : {}),
  };
  const planToken = await encodePayload(PLAN_FORMAT, planData);
  return {
    planToken,
    planUrl: `${resolvedBaseUrl}#plan=${planToken}`,
    profileId,
    ...(specsToken ? { specsToken, specsUrl: `${resolvedBaseUrl}#spec=${specsToken}`, bundleId } : {}),
  };
};

export const buildSharedPlanUrl = async (state: ShareablePlanState, baseUrl = window.location.href.split("#")[0]): Promise<string> =>
  (await buildSharedQrBundle(state, baseUrl)).planUrl;

export const tokenFromHash = (hash: string): string | null => {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.get("plan");
};

export const specsTokenFromHash = (hash: string): string | null => {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.get("spec");
};

export const sharedQrKind = (token: string): "plan" | "specs" =>
  token.startsWith(`${SPECS_FORMAT}.`) || token.startsWith(`${SPECS_FORMAT_V1}.`) ? "specs" : "plan";

export const supplementalBundleId = async (specsToken: string): Promise<string> => {
  if (specsToken.startsWith(`${SPECS_FORMAT_V1}.`)) {
    const parsed = await decodePayload(specsToken, SPECS_FORMAT_V1);
    if (!isRecord(parsed) || parsed.app !== "loadpilot-specs" || parsed.version !== 1) throw new Error("特殊コンテナ仕様QRの形式が正しくありません。");
    return textValue(parsed.bundle_id, "照合ID", 40);
  }
  const parsed = await decodePayload(specsToken, SPECS_FORMAT);
  if (!isRecord(parsed) || parsed.a !== "lps" || parsed.v !== 2) throw new Error("カスタムコンテナ仕様QRの形式が正しくありません。");
  return textValue(parsed.b, "照合ID", 40);
};

export const tokenFromScannedValue = (value: string): string => {
  const trimmed = value.trim();
  if ([LEGACY_FORMAT, PLAN_FORMAT_V2, PLAN_FORMAT, SPECS_FORMAT_V1, SPECS_FORMAT].some((format) => trimmed.startsWith(`${format}.`))) return trimmed;
  const direct = tokenFromHash(trimmed) ?? specsTokenFromHash(trimmed);
  if (direct) return direct;
  try {
    const url = new URL(trimmed);
    const token = tokenFromHash(url.hash) ?? specsTokenFromHash(url.hash);
    if (token) return token;
  } catch {
    // URLでない値は、下の共通エラーへまとめる。
  }
  throw new Error("LoadPilotの共有プランQRではありません。");
};
