import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { expandPieces } from "./input";
import { estimatePlan } from "./planner";
import { buildContainerPackingLists } from "./reporting";

describe("buildContainerPackingLists", () => {
  it("コンテナごとの個別明細と合計を欠落なく生成する", () => {
    const result = estimatePlan(expandPieces(SAMPLE_CARGO), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    const lists = buildContainerPackingLists(result);
    expect(lists).toHaveLength(result.loads.length);
    expect(lists.flatMap((list) => list.items)).toHaveLength(result.placements.length);
    expect(lists[0].items.map((item) => item.position)).toEqual(result.loads[0].placements.map((_, index) => index + 1));
    expect(lists[0].totalWeightKg).toBe(result.loads[0].placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0));
    expect(lists[0].totalM3).toBeCloseTo(result.loads[0].placements.reduce((sum, placement) => sum + placement.piece.m3, 0));
  });

  it("コンテナ内で異なる最大寸法・重量・容積を該当貨物へ付与する", () => {
    const result = estimatePlan(expandPieces(SAMPLE_CARGO), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    const items = buildContainerPackingLists(result)[0].items;
    const coil = items.find((item) => item.piece.orig_id === "A1001")!;
    const machine = items.find((item) => item.piece.orig_id === "C3001")!;
    expect(coil.notableMetrics).toContain("weight");
    expect(machine.notableMetrics).toEqual(expect.arrayContaining(["length", "height", "volume"]));
  });

  it("全貨物が同じ値の項目は一面を強調しない", () => {
    const rows = [{ ...SAMPLE_CARGO[0], qty: 2 }];
    const result = estimatePlan(expandPieces(rows), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    expect(buildContainerPackingLists(result)[0].items.every((item) => item.notableMetrics.length === 0)).toBe(true);
  });

  it("単品コンテナでは作業基準として全最大項目を表示する", () => {
    const result = estimatePlan(expandPieces([{ ...SAMPLE_CARGO[0], qty: 1 }]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    expect(buildContainerPackingLists(result)[0].items[0].notableMetrics).toEqual(["length", "width", "height", "weight", "volume"]);
  });
});
