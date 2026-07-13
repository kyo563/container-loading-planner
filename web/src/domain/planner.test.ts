import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { expandPieces } from "./input";
import { containerKey, estimatePlan, validatePlan } from "./planner";

const cargo = (overrides: Partial<(typeof SAMPLE_CARGO)[number]> = {}) => ({
  ...SAMPLE_CARGO[0],
  uid: `test-${Math.random()}`,
  id: "T001",
  desc: "Test cargo",
  qty: 1,
  L_cm: 100,
  W_cm: 100,
  H_cm: 100,
  weight_kg: 100,
  package_text: "CASE",
  rotate_allowed: false,
  stackable: true,
  max_stack_load_kg: null,
  incompatible_with_ids: "",
  ...overrides,
});

describe("estimatePlan", () => {
  it("サンプル貨物を欠落なく配置する", () => {
    const pieces = expandPieces(SAMPLE_CARGO);
    const result = estimatePlan(pieces, DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    expect(result.placements.length + result.unplaced.length).toBe(pieces.length);
    expect(result.placements.length).toBe(pieces.length);
    expect(result.loads.length).toBeGreaterThan(0);
  });

  it("インゲージの冷蔵貨物もRFへ振り分ける", () => {
    const pieces = expandPieces([cargo({ desc: "冷蔵食品", package_text: "CARTON" })]);
    const result = estimatePlan(pieces, DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    expect(result.loads).toHaveLength(1);
    expect(result.loads[0].spec.type).toBe("RF");
    expect(result.special_reason_by_piece.get("T001#1")).toContain("冷凍・冷蔵");
  });

  it("幅超過貨物をFRへ配置し、幅方向のオーバーハングを許容する", () => {
    const pieces = expandPieces([cargo({ L_cm: 500, W_cm: 280, H_cm: 180, weight_kg: 5_000 })]);
    const result = estimatePlan(pieces, DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    expect(result.unplaced).toHaveLength(0);
    expect(result.loads[0].spec.type).toMatch(/FR$/);
    expect(result.oog_results.get("T001#1")?.over_W_cm).toBeGreaterThan(0);
  });

  it("40FRのデッキ長を超える貨物を在来船検討へ回す", () => {
    const pieces = expandPieces([cargo({ L_cm: 1300, W_cm: 1200, H_cm: 100, weight_kg: 3_000 })]);
    const result = estimatePlan(pieces, DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    expect(result.breakbulk_piece_ids).toEqual(["T001#1"]);
    expect(result.unplaced.map((piece) => piece.piece_id)).toContain("T001#1");
  });
});

describe("validatePlan", () => {
  it("固定本数モードで特殊コンテナ指定を実際に使用する", () => {
    const pieces = expandPieces([cargo({ L_cm: 500, W_cm: 280, H_cm: 180, weight_kg: 5_000 })]);
    const result = validatePlan(pieces, DEFAULT_CONTAINERS, { "40FR": 1 }, DEFAULT_SETTINGS);
    expect(result.unplaced).toHaveLength(0);
    expect(result.loads[0].spec.type).toBe("40FR");
  });

  it("車両総重量を貨物重量と風袋の合計で監査する", () => {
    const pieces = expandPieces([cargo({ weight_kg: 26_000, L_cm: 100, W_cm: 100, H_cm: 100 })]);
    const settings = { ...DEFAULT_SETTINGS, vehicle_gross_limit_kg: 28_000 };
    const result = validatePlan(pieces, DEFAULT_CONTAINERS, { "40HC": 1 }, settings);
    const audit = result.weight_audit_by_container.get(containerKey("40HC", 1));
    expect(audit?.gross_weight_kg).toBe(29_900);
    expect(audit?.weight_alert).toBe(true);
    expect(audit?.weight_alert_message).toContain("車両総重量");
  });

  it("混載不可指定を双方向に扱う", () => {
    const rows = [
      cargo({ id: "A", desc: "A", incompatible_with_ids: "B" }),
      cargo({ id: "B", desc: "B", incompatible_with_ids: "" }),
    ];
    const result = validatePlan(expandPieces(rows), DEFAULT_CONTAINERS, { "40HC": 1 }, DEFAULT_SETTINGS);
    expect(result.loads[0].placements).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
  });
});

