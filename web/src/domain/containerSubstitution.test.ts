import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { expandPieces } from "./input";
import { estimatePlan } from "./planner";

const cargo = (overrides: Partial<(typeof SAMPLE_CARGO)[number]> = {}) => ({
  ...SAMPLE_CARGO[0],
  uid: `substitution-${Math.random()}`,
  id: "SUB",
  desc: "Substitution test",
  qty: 1,
  L_cm: 600,
  W_cm: 100,
  H_cm: 220,
  weight_kg: 1_000,
  rotate_allowed: false,
  stackable: false,
  ...overrides,
});

describe("標準コンテナの選定と40GP代用判定", () => {
  it("全貨物が20GP 1本に収まる場合は20GPを選ぶ", () => {
    const result = estimatePlan(
      expandPieces([cargo({ L_cm: 300, W_cm: 100, H_cm: 100 })]),
      DEFAULT_CONTAINERS,
      DEFAULT_SETTINGS,
    );

    expect(result.loads.map((load) => load.spec.type)).toEqual(["20GP"]);
    expect(result.decision_reasons.join(" ")).toContain("20GP 1本");
  });

  it("20GPに収まらない標準貨物は40HCを基準にする", () => {
    const result = estimatePlan(expandPieces([cargo()]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);

    expect(result.loads.map((load) => load.spec.type)).toEqual(["40HC"]);
    expect(result.substitution_by_container.get("40HC-1")).toMatchObject({
      target_type: "40GP",
      feasible: true,
    });
  });

  it("40GPの入口高を通過できない場合は代用不可とする", () => {
    const result = estimatePlan(
      expandPieces([cargo({ H_cm: 230 })]),
      DEFAULT_CONTAINERS,
      DEFAULT_SETTINGS,
    );
    const assessment = result.substitution_by_container.get("40HC-1");

    expect(assessment?.feasible).toBe(false);
    expect(assessment?.reasons.join(" ")).toContain("入口寸法");
  });
});
