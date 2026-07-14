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
});
