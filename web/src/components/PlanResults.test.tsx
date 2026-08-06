import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "../domain/constants";
import { expandPieces } from "../domain/input";
import { estimatePlan } from "../domain/planner";
import { PlanResults } from "./PlanResults";

const cargo = (heightCm: number) => ({
  ...SAMPLE_CARGO[0],
  uid: `result-${heightCm}`,
  id: `RESULT-${heightCm}`,
  qty: 1,
  L_cm: 600,
  W_cm: 100,
  H_cm: heightCm,
  weight_kg: 1_000,
  rotate_allowed: false,
  stackable: false,
});

describe("PlanResults", () => {
  it("40HCバンプランに40GP代用可否と理由を表示する", () => {
    const possible = renderToStaticMarkup(
      <PlanResults result={estimatePlan(expandPieces([cargo(220)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS)} />,
    );
    const blocked = renderToStaticMarkup(
      <PlanResults result={estimatePlan(expandPieces([cargo(230)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS)} />,
    );

    expect(possible).toContain("40GP代用：可能");
    expect(possible).toContain("内寸・入口寸法・最大積載重量の条件内");
    expect(blocked).toContain("40GP代用：不可");
    expect(blocked).toContain("入口寸法を通過できない貨物");
  });
});
