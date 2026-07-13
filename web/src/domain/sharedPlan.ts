import { strFromU8, strToU8, zlibSync, unzlibSync } from "fflate";

import type { CargoRow, ContainerSpec, PlanningSettings } from "./types";

const FORMAT = "lp1";
const MAX_TOKEN_CHARS = 60_000;
const MAX_ROWS = 1_000;
const MAX_SPECS = 100;

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
  return {
    app: "loadpilot",
    version: 1,
    created_at: textValue(value.created_at, "作成日時", 100),
    rows: sanitizeRows(value.rows),
    mode: value.mode,
    counts: sanitizeCounts(value.counts),
    settings: sanitizeSettings(value.settings),
    specs: sanitizeSpecs(value.specs),
  };
};

export const encodeSharedPlan = async (state: ShareablePlanState): Promise<string> => {
  const data: SharedPlanData = { app: "loadpilot", version: 1, created_at: new Date().toISOString(), ...state };
  const compressed = zlibSync(strToU8(JSON.stringify(data)), { level: 9 });
  const token = `${FORMAT}.${await checksum(compressed)}.${bytesToBase64Url(compressed)}`;
  if (token.length > MAX_TOKEN_CHARS) throw new Error("共有URLが長すぎます。貨物行またはカスタムコンテナ仕様を減らしてください。");
  return token;
};

export const decodeSharedPlan = async (token: string): Promise<SharedPlanData> => {
  if (token.length > MAX_TOKEN_CHARS) throw new Error("共有URLが長すぎます。");
  const [format, expectedChecksum, payload, ...rest] = token.split(".");
  if (format !== FORMAT || !expectedChecksum || !payload || rest.length) throw new Error("共有URLの形式が正しくありません。");
  const compressed = base64UrlToBytes(payload);
  if (await checksum(compressed) !== expectedChecksum) throw new Error("共有データが破損または変更されています。");
  try {
    return sanitizePlan(JSON.parse(strFromU8(unzlibSync(compressed))) as unknown);
  } catch (error) {
    if (error instanceof Error && !/invalid|unexpected|JSON/iu.test(error.message)) throw error;
    throw new Error("共有データを展開できませんでした。");
  }
};

export const buildSharedPlanUrl = async (state: ShareablePlanState, baseUrl = window.location.href.split("#")[0]): Promise<string> =>
  `${baseUrl}#plan=${await encodeSharedPlan(state)}`;

export const tokenFromHash = (hash: string): string | null => {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.get("plan");
};
