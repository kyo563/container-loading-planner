import { describe, expect, it } from "vitest";
import QRCode from "qrcode";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { decodeSharedPlan, encodeSharedPlan, tokenFromHash } from "./sharedPlan";

const state = {
  rows: SAMPLE_CARGO,
  mode: "estimate" as const,
  counts: { "40HC": 1 },
  settings: DEFAULT_SETTINGS,
  specs: DEFAULT_CONTAINERS,
};

describe("sharedPlan", () => {
  it("貨物・計算条件・コンテナ仕様を圧縮して復元する", async () => {
    const token = await encodeSharedPlan(state);
    const restored = await decodeSharedPlan(token);
    expect(restored.rows).toEqual(SAMPLE_CARGO);
    expect(restored.mode).toBe("estimate");
    expect(restored.counts).toEqual({ "40HC": 1 });
    expect(restored.settings).toEqual(DEFAULT_SETTINGS);
    expect(restored.specs).toEqual(DEFAULT_CONTAINERS);
    expect(token.length).toBeLessThan(JSON.stringify(state).length);
  });

  it("変更・破損した共有データを拒否する", async () => {
    const token = await encodeSharedPlan(state);
    const last = token.at(-1) === "A" ? "B" : "A";
    await expect(decodeSharedPlan(`${token.slice(0, -1)}${last}`)).rejects.toThrow(/破損|変更/u);
  });

  it("URLフラグメントから共有トークンを取得する", () => {
    expect(tokenFromHash("#plan=lp1.check.payload")).toBe("lp1.check.payload");
    expect(tokenFromHash("#other=value")).toBeNull();
  });

  it("標準サンプルを1個のQRコードへ格納できる", async () => {
    const token = await encodeSharedPlan(state);
    const url = `https://example.com/container-loading-planner/#plan=${token}`;
    expect(() => QRCode.create(url, { errorCorrectionLevel: "L" })).not.toThrow();
  });
});
