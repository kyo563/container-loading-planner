import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { strToU8, zlibSync } from "fflate";

import { STANDARD_CONTAINER_PROFILE_ID } from "./containerProfiles";
import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { buildSharedQrBundle, buildSharedRestorationUrl, decodeSharedPlan, encodeSharedPlan, specsTokenFromHash, SupplementalQrRequiredError, tokenFromHash, tokenFromScannedValue } from "./sharedPlan";

const state = {
  rows: SAMPLE_CARGO,
  mode: "estimate" as const,
  counts: { "40HC": 1 },
  settings: DEFAULT_SETTINGS,
  specs: DEFAULT_CONTAINERS,
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const encodeOldPayload = async (format: string, data: unknown): Promise<string> => {
  const compressed = zlibSync(strToU8(JSON.stringify(data)), { level: 9 });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(compressed).buffer));
  return `${format}.${bytesToBase64Url(digest.subarray(0, 8))}.${bytesToBase64Url(compressed)}`;
};

describe("sharedPlan", () => {
  it("貨物・計算条件・コンテナ仕様を圧縮して復元する", async () => {
    const token = await encodeSharedPlan(state);
    const restored = await decodeSharedPlan(token);
    expect(restored.rows.map(({ uid: _uid, ...row }) => row))
      .toEqual(SAMPLE_CARGO.map(({ uid: _uid, ...row }) => row));
    expect(restored.rows.every((row) => row.uid.startsWith("qr-"))).toBe(true);
    expect(restored.mode).toBe("estimate");
    expect(restored.counts).toEqual({ "40HC": 1 });
    expect(restored.settings).toEqual(DEFAULT_SETTINGS);
    expect(restored.specs).toEqual(DEFAULT_CONTAINERS);
    expect(token.length).toBeLessThan(JSON.stringify(state).length * 0.55);
    const previousFormatToken = await encodeOldPayload("lp2", {
      app: "loadpilot",
      version: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      rows: SAMPLE_CARGO,
      mode: "estimate",
      counts: { "40HC": 1 },
      settings: DEFAULT_SETTINGS,
    });
    expect(token.length).toBeLessThan(previousFormatToken.length * 0.75);
  });

  it("変更・破損した共有データを拒否する", async () => {
    const token = await encodeSharedPlan(state);
    const checksumIndex = token.indexOf(".") + 1;
    const replacement = token[checksumIndex] === "A" ? "B" : "A";
    const tampered = `${token.slice(0, checksumIndex)}${replacement}${token.slice(checksumIndex + 1)}`;
    await expect(decodeSharedPlan(tampered)).rejects.toThrow(/破損|変更/u);
  });

  it("URLフラグメントから共有トークンを取得する", () => {
    expect(tokenFromHash("#plan=lp1.check.payload")).toBe("lp1.check.payload");
    expect(tokenFromHash("#other=value")).toBeNull();
  });

  it("カメラで読み取った共有URLと生トークンから復元文字列を取得する", () => {
    expect(tokenFromScannedValue("https://example.com/app/#plan=lp1.check.payload")).toBe("lp1.check.payload");
    expect(tokenFromScannedValue("lp1.check.payload")).toBe("lp1.check.payload");
    expect(() => tokenFromScannedValue("https://example.com/not-loadpilot")).toThrow(/LoadPilot/u);
  });

  it("標準サンプルを1個のQRコードへ格納できる", async () => {
    const bundle = await buildSharedQrBundle(state, "https://example.com/app/");
    const token = bundle.planToken;
    expect(bundle.specsToken).toBeUndefined();
    expect(bundle.profileId).toBe(STANDARD_CONTAINER_PROFILE_ID);
    expect(token.startsWith("lp3.")).toBe(true);
    const url = `https://example.com/container-loading-planner/#plan=${token}`;
    expect(() => QRCode.create(url, { errorCorrectionLevel: "L" })).not.toThrow();
  });

  it("標準仕様は共有データから省略し、復元時に標準値を適用する", async () => {
    const token = await encodeSharedPlan(state);
    expect(token.startsWith("lp3.")).toBe(true);
    expect((await decodeSharedPlan(token)).specs).toEqual(DEFAULT_CONTAINERS);
  });

  it("旧lp2形式の標準プランも引き続き復元する", async () => {
    const oldToken = await encodeOldPayload("lp2", {
      app: "loadpilot",
      version: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      rows: SAMPLE_CARGO,
      mode: "estimate",
      counts: { "40HC": 1 },
      settings: DEFAULT_SETTINGS,
    });
    const restored = await decodeSharedPlan(oldToken);
    expect(restored.rows).toEqual(SAMPLE_CARGO);
    expect(restored.specs).toEqual(DEFAULT_CONTAINERS);
  });

  it("標準外仕様は照合ID付きの2枚へ分離して復元する", async () => {
    const customSpecs = DEFAULT_CONTAINERS.map((spec) => spec.type === "40HC" ? { ...spec, inner_H_cm: 275 } : { ...spec });
    const bundle = await buildSharedQrBundle({ ...state, specs: customSpecs }, "https://example.com/app/");
    expect(bundle.planToken.startsWith("lp3.")).toBe(true);
    expect(bundle.specsToken?.startsWith("lps2.")).toBe(true);
    expect(bundle.specsToken!.length).toBeLessThan(JSON.stringify(customSpecs).length);
    await expect(decodeSharedPlan(bundle.planToken)).rejects.toBeInstanceOf(SupplementalQrRequiredError);
    expect((await decodeSharedPlan(bundle.planToken, bundle.specsToken)).specs).toEqual(customSpecs);
  });

  it("Excel向け復元URLは標準外仕様も1リンクで復元できる", async () => {
    const customSpecs = DEFAULT_CONTAINERS.map((spec) => spec.type === "40HC" ? { ...spec, inner_H_cm: 275 } : { ...spec });
    const url = await buildSharedRestorationUrl({ ...state, specs: customSpecs }, "https://example.com/app/");
    const hash = new URL(url).hash;
    const planToken = tokenFromHash(hash);
    const specsToken = specsTokenFromHash(hash);

    expect(planToken).toBeTruthy();
    expect(specsToken).toBeTruthy();
    expect((await decodeSharedPlan(planToken!, specsToken!)).specs).toEqual(customSpecs);
  });

  it("SOCコンテナは標準定義との差分だけを追加QRへ保存して復元する", async () => {
    const source = DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!;
    const socSpec = {
      ...source,
      type: "SOC40HC",
      inner_L_cm: 1_198,
      max_payload_kg: 27_100,
      tare_weight_kg: 4_150,
    };
    const customSpecs = [...DEFAULT_CONTAINERS, socSpec];
    const bundle = await buildSharedQrBundle({ ...state, specs: customSpecs });

    expect(bundle.specsToken?.startsWith("lps2.")).toBe(true);
    expect(bundle.specsToken!.length).toBeLessThan(JSON.stringify(customSpecs).length);
    expect((await decodeSharedPlan(bundle.planToken, bundle.specsToken)).specs).toEqual(customSpecs);
  });

  it("異なる案件の特殊仕様QRを拒否する", async () => {
    const firstSpecs = DEFAULT_CONTAINERS.map((spec) => spec.type === "40HC" ? { ...spec, inner_H_cm: 275 } : { ...spec });
    const secondSpecs = DEFAULT_CONTAINERS.map((spec) => spec.type === "40HC" ? { ...spec, inner_H_cm: 280 } : { ...spec });
    const first = await buildSharedQrBundle({ ...state, specs: firstSpecs });
    const second = await buildSharedQrBundle({ ...state, specs: secondSpecs });
    await expect(decodeSharedPlan(first.planToken, second.specsToken)).rejects.toThrow(/照合ID/u);
  });

  it("旧lp2・lps1形式のカスタム仕様も引き続き復元する", async () => {
    const customSpecs = DEFAULT_CONTAINERS.map((spec) =>
      spec.type === "40HC" ? { ...spec, inner_H_cm: 276 } : { ...spec });
    const bundleId = "legacy-test";
    const oldPlanToken = await encodeOldPayload("lp2", {
      app: "loadpilot",
      version: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      rows: SAMPLE_CARGO,
      mode: "estimate",
      counts: { "40HC": 1 },
      settings: DEFAULT_SETTINGS,
      custom_specs_ref: bundleId,
    });
    const oldSpecsToken = await encodeOldPayload("lps1", {
      app: "loadpilot-specs",
      version: 1,
      bundle_id: bundleId,
      specs: customSpecs,
    });
    expect((await decodeSharedPlan(oldPlanToken, oldSpecsToken)).specs).toEqual(customSpecs);
  });

  it("業務上不正な貨物値を共有前に拒否する", async () => {
    await expect(encodeSharedPlan({ ...state, rows: [{ ...SAMPLE_CARGO[0], qty: -1 }] })).rejects.toThrow(/貨物情報が不正/u);
  });

  it("不明なコンテナタイプの指定本数を拒否する", async () => {
    await expect(encodeSharedPlan({ ...state, counts: { UNKNOWN: 1 } })).rejects.toThrow(/不明なコンテナタイプ/u);
  });
});
