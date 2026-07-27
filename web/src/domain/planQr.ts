import QRCode from "qrcode";

import { buildSharedQrBundle, sharedQrKind, tokenFromScannedValue, type ShareablePlanState } from "./sharedPlan";

export type PlanQrKind = "plan" | "specs";

export interface PlanQrData {
  url: string;
  dataUrl: string;
  kind: PlanQrKind;
  partIndex: number;
  partTotal: number;
  moduleCount: number;
  isChunkPart: boolean;
}

export interface PlanQrBundleData {
  plan: PlanQrData;
  planParts: PlanQrData[];
  planUrl: string;
  profileId: string;
  specs?: PlanQrData;
  specsParts?: PlanQrData[];
  bundleId?: string;
  requiresAppScanner: boolean;
}

export interface PlanQrScanResult {
  complete: boolean;
  token?: string;
  kind: PlanQrKind;
  received: number;
  total: number;
  partIndex: number;
  duplicate: boolean;
}

interface ParsedChunk {
  fingerprint: string;
  kind: PlanQrKind;
  partIndex: number;
  partTotal: number;
  chunk: string;
}

interface PendingChunkGroup {
  fingerprint: string;
  kind: PlanQrKind;
  total: number;
  chunks: Map<number, string>;
}

export const PRINT_QR_PX = 768;
export const SHARE_QR_PX = 768;
export const QR_QUIET_ZONE_MODULES = 4;
export const QR_MAX_DATA_MODULES = 85;
export const MAX_QR_PARTS = 8;

const QR_CHUNK_FORMAT = "lpq1";
const QR_INITIAL_CHUNK_CHARS = 550;
const QR_MIN_CHUNK_CHARS = 160;
const QR_CHUNK_SHRINK_STEP = 32;
const QR_FINGERPRINT_BYTES = 8;
const CHUNK_PATTERN = /^lpq1\.([a-f0-9]{16})\.(p|s)\.(\d+)\.(\d+)\.([A-Za-z0-9._-]+)$/u;

const qrModuleCount = (value: string): number => {
  try {
    return QRCode.create(value, { errorCorrectionLevel: "L" }).modules.size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const createQr = async (
  value: string,
  width: number,
  kind: PlanQrKind,
  partIndex: number,
  partTotal: number,
  isChunkPart: boolean,
): Promise<PlanQrData> => {
  const moduleCount = qrModuleCount(value);
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: "L",
    margin: QR_QUIET_ZONE_MODULES,
    width,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return { url: value, dataUrl, kind, partIndex, partTotal, moduleCount, isChunkPart };
};

const fingerprintToken = async (token: string): Promise<string> => {
  const bytes = new TextEncoder().encode(token);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.subarray(0, QR_FINGERPRINT_BYTES), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const chunkKindCode = (kind: PlanQrKind): "p" | "s" => kind === "plan" ? "p" : "s";

const createChunkValues = (
  token: string,
  kind: PlanQrKind,
  fingerprint: string,
  chunkChars: number,
): string[] => {
  const chunks = Array.from({ length: Math.ceil(token.length / chunkChars) }, (_, index) =>
    token.slice(index * chunkChars, (index + 1) * chunkChars));
  return chunks.map((chunk, index) =>
    `${QR_CHUNK_FORMAT}.${fingerprint}.${chunkKindCode(kind)}.${index + 1}.${chunks.length}.${chunk}`);
};

const splitTokenForReadableQr = async (token: string, kind: PlanQrKind): Promise<string[]> => {
  const fingerprint = await fingerprintToken(token);
  for (let chunkChars = QR_INITIAL_CHUNK_CHARS; chunkChars >= QR_MIN_CHUNK_CHARS; chunkChars -= QR_CHUNK_SHRINK_STEP) {
    const values = createChunkValues(token, kind, fingerprint, chunkChars);
    if (values.every((value) => qrModuleCount(value) <= QR_MAX_DATA_MODULES)) return values;
  }
  throw new Error("QRコードを読み取り可能な密度へ分割できませんでした。URLを共有してください。");
};

const createReadableQrParts = async (
  token: string,
  fullUrl: string,
  width: number,
  kind: PlanQrKind,
  maxParts: number,
): Promise<PlanQrData[]> => {
  if (qrModuleCount(fullUrl) <= QR_MAX_DATA_MODULES) {
    if (maxParts < 1) throw new Error(`共有QRが上限${MAX_QR_PARTS}枚を超えます。URLを共有してください。`);
    return [await createQr(fullUrl, width, kind, 1, 1, false)];
  }
  const values = await splitTokenForReadableQr(token, kind);
  if (values.length > maxParts) {
    throw new Error(`共有QRが上限${MAX_QR_PARTS}枚を超えます。URLを共有するか、貨物行を減らしてください。`);
  }
  return Promise.all(values.map((value, index) => createQr(value, width, kind, index + 1, values.length, true)));
};

export const createPlanQrBundleData = async (
  plan: ShareablePlanState,
  width = SHARE_QR_PX,
): Promise<PlanQrBundleData> => {
  const bundle = await buildSharedQrBundle(plan);
  const planParts = await createReadableQrParts(bundle.planToken, bundle.planUrl, width, "plan", MAX_QR_PARTS);
  const specsParts = bundle.specsToken && bundle.specsUrl
    ? await createReadableQrParts(bundle.specsToken, bundle.specsUrl, width, "specs", MAX_QR_PARTS - planParts.length)
    : undefined;
  return {
    plan: planParts[0],
    planParts,
    planUrl: bundle.planUrl,
    profileId: bundle.profileId,
    ...(specsParts ? { specs: specsParts[0], specsParts, bundleId: bundle.bundleId } : {}),
    requiresAppScanner: [...planParts, ...(specsParts ?? [])].some((part) => part.isChunkPart),
  };
};

export const createPlanQrData = async (plan: ShareablePlanState, width = SHARE_QR_PX): Promise<PlanQrData> =>
  (await createPlanQrBundleData(plan, width)).plan;

const chunkValueFromScannedValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.startsWith(`${QR_CHUNK_FORMAT}.`)) return trimmed;
  try {
    const url = new URL(trimmed);
    const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    return params.get("qr");
  } catch {
    return null;
  }
};

const parseChunk = (value: string): ParsedChunk | null => {
  const chunkValue = chunkValueFromScannedValue(value);
  if (!chunkValue) return null;
  const match = CHUNK_PATTERN.exec(chunkValue);
  if (!match) throw new Error("分割QRの形式が正しくありません。");
  const partIndex = Number(match[3]);
  const partTotal = Number(match[4]);
  if (!Number.isSafeInteger(partIndex) || !Number.isSafeInteger(partTotal)
    || partIndex < 1 || partIndex > partTotal || partTotal > MAX_QR_PARTS) {
    throw new Error("分割QRの連番が正しくありません。");
  }
  return {
    fingerprint: match[1],
    kind: match[2] === "p" ? "plan" : "specs",
    partIndex,
    partTotal,
    chunk: match[5],
  };
};

export class PlanQrPartCollector {
  private readonly groups = new Map<string, PendingChunkGroup>();

  reset(): void {
    this.groups.clear();
  }

  async acceptScannedValue(value: string): Promise<PlanQrScanResult> {
    const part = parseChunk(value);
    if (!part) {
      const token = tokenFromScannedValue(value);
      return {
        complete: true,
        token,
        kind: sharedQrKind(token),
        received: 1,
        total: 1,
        partIndex: 1,
        duplicate: false,
      };
    }

    const groupKey = `${part.fingerprint}.${part.kind}`;
    const existing = this.groups.get(groupKey);
    if (existing && existing.total !== part.partTotal) {
      throw new Error("同じ一式に異なる総枚数の分割QRが含まれています。");
    }
    const group = existing ?? {
      fingerprint: part.fingerprint,
      kind: part.kind,
      total: part.partTotal,
      chunks: new Map<number, string>(),
    };
    this.groups.set(groupKey, group);

    const previousChunk = group.chunks.get(part.partIndex);
    if (previousChunk && previousChunk !== part.chunk) {
      this.groups.delete(groupKey);
      throw new Error("同じ連番の分割QRに異なるデータが含まれています。");
    }
    const duplicate = previousChunk !== undefined;
    group.chunks.set(part.partIndex, part.chunk);
    if (group.chunks.size < group.total) {
      return {
        complete: false,
        kind: group.kind,
        received: group.chunks.size,
        total: group.total,
        partIndex: part.partIndex,
        duplicate,
      };
    }

    const token = Array.from({ length: group.total }, (_, index) => group.chunks.get(index + 1) ?? "").join("");
    this.groups.delete(groupKey);
    if (await fingerprintToken(token) !== group.fingerprint) {
      throw new Error("分割QRの組み合わせが異なるか、データが破損しています。");
    }
    tokenFromScannedValue(token);
    return {
      complete: true,
      token,
      kind: group.kind,
      received: group.total,
      total: group.total,
      partIndex: part.partIndex,
      duplicate,
    };
  }
}
