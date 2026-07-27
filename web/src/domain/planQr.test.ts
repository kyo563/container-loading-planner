import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import {
  createPlanQrBundleData,
  MAX_QR_PARTS,
  PlanQrPartCollector,
  QR_MAX_DATA_MODULES,
} from "./planQr";
import { decodeSharedPlan } from "./sharedPlan";

const baseState = {
  rows: SAMPLE_CARGO,
  mode: "estimate" as const,
  counts: { "40HC": 1 },
  settings: DEFAULT_SETTINGS,
  specs: DEFAULT_CONTAINERS,
};

const denseRows = Array.from({ length: 32 }, (_, index) => {
  const uniqueText = Array.from({ length: 6 }, (__, offset) =>
    ((index + 11) * (offset + 17) * 2_654_435_761 >>> 0).toString(36)).join("-");
  return {
    ...SAMPLE_CARGO[index % SAMPLE_CARGO.length],
    uid: `dense-${index}-${uniqueText}`,
    id: `D${String(index + 1).padStart(3, "0")}`,
    desc: `輸出貨物 ${index + 1} ${uniqueText}`,
    incompatible_with_ids: "",
  };
});

describe("planQr", () => {
  it("小さいプランは従来どおり共有URLを1枚のQRにする", async () => {
    const bundle = await createPlanQrBundleData({ ...baseState, rows: [SAMPLE_CARGO[0]], counts: {} });
    expect(bundle.planParts).toHaveLength(1);
    expect(bundle.plan.url).toBe(bundle.planUrl);
    expect(bundle.plan.isChunkPart).toBe(false);
    expect(bundle.plan.moduleCount).toBeLessThanOrEqual(QR_MAX_DATA_MODULES);

    const result = await new PlanQrPartCollector().acceptScannedValue(bundle.plan.url);
    expect(result.complete).toBe(true);
    expect(result.token?.startsWith("lp3.")).toBe(true);
  });

  it("高密度になるプランを上限以下の複数QRへ自動分割して復元する", async () => {
    const bundle = await createPlanQrBundleData({ ...baseState, rows: denseRows });
    expect(bundle.planParts.length).toBeGreaterThan(1);
    expect(bundle.planParts.length).toBeLessThanOrEqual(MAX_QR_PARTS);
    expect(bundle.planParts.every((part) =>
      part.isChunkPart && part.moduleCount <= QR_MAX_DATA_MODULES)).toBe(true);

    const collector = new PlanQrPartCollector();
    let token = "";
    for (const part of [...bundle.planParts].reverse()) {
      const result = await collector.acceptScannedValue(part.url);
      if (result.complete) token = result.token ?? "";
    }
    expect((await decodeSharedPlan(token)).rows.map(({ uid: _uid, ...row }) => row))
      .toEqual(denseRows.map(({ uid: _uid, ...row }) => row));
  });

  it("読取済みの分割QRは重複として無視する", async () => {
    const bundle = await createPlanQrBundleData({ ...baseState, rows: denseRows });
    const collector = new PlanQrPartCollector();
    const first = await collector.acceptScannedValue(bundle.planParts[0].url);
    const duplicate = await collector.acceptScannedValue(bundle.planParts[0].url);

    expect(first.complete).toBe(false);
    expect(duplicate).toMatchObject({
      complete: false,
      duplicate: true,
      received: 1,
      total: bundle.planParts.length,
    });
  });

  it("標準外仕様QRも同じ収集処理で復元できる", async () => {
    const customSpecs = DEFAULT_CONTAINERS.map((spec) =>
      spec.type === "40HC" ? { ...spec, inner_H_cm: 275 } : { ...spec });
    const bundle = await createPlanQrBundleData({ ...baseState, specs: customSpecs });
    expect(bundle.specsParts?.length).toBeGreaterThan(0);
    expect(bundle.planParts.length + (bundle.specsParts?.length ?? 0)).toBeLessThanOrEqual(MAX_QR_PARTS);

    const collector = new PlanQrPartCollector();
    let specsToken = "";
    for (const part of [...bundle.specsParts!].reverse()) {
      const result = await collector.acceptScannedValue(part.url);
      if (result.complete) specsToken = result.token ?? "";
    }
    expect(specsToken.startsWith("lps2.")).toBe(true);
  });

  it("一部が変更された分割QRを復元時に拒否する", async () => {
    const bundle = await createPlanQrBundleData({ ...baseState, rows: denseRows });
    const collector = new PlanQrPartCollector();
    const tampered = bundle.planParts.map((part, index) => index === 0
      ? `${part.url.slice(0, -1)}${part.url.endsWith("A") ? "B" : "A"}`
      : part.url);

    for (const value of tampered.slice(0, -1)) {
      await collector.acceptScannedValue(value);
    }
    await expect(collector.acceptScannedValue(tampered.at(-1)!)).rejects.toThrow(/破損|組み合わせ/u);
  });
});
