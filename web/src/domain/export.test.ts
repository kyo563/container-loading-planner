import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { placementRows } from "./export";
import { expandPieces } from "./input";
import { containerKey, estimatePlan } from "./planner";

describe("帳票のコンテナ重量", () => {
  it("入力した実TareでNET・Tare・Grossを出力する", () => {
    const cargo = [{ ...SAMPLE_CARGO[0], qty: 1 }];
    const result = estimatePlan(expandPieces(cargo), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    const load = result.loads[0];
    const key = containerKey(load.spec.type, load.index);
    const actualTareWeightKg = 4_321;
    const rows = placementRows(result, { [key]: actualTareWeightKg });
    const netWeightKg = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);

    expect(rows[0].container_total_cargo_kg).toBe(netWeightKg);
    expect(rows[0].container_tare_weight_kg).toBe(actualTareWeightKg);
    expect(rows[0].container_gross_weight_kg).toBe(netWeightKg + actualTareWeightKg);
  });
});
