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

  it("複数コンテナの貨物重量差を制約内で小さくする", () => {
    const rows = [8_000, 7_000, 1_000, 1_000].map((weight, index) => cargo({
      uid: `balance-${index}`,
      id: `W${index + 1}`,
      L_cm: 600,
      W_cm: 230,
      H_cm: 100,
      weight_kg: weight,
      stackable: false,
    }));
    const result = validatePlan(expandPieces(rows), DEFAULT_CONTAINERS, { "40HC": 2 }, DEFAULT_SETTINGS);
    const weights = result.loads.map((load) => load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0)).sort((a, b) => a - b);
    expect(weights).toEqual([8_000, 9_000]);
    expect(result.decision_reasons.join(" ")).toContain("貨物重量差");
  });

  it("同寸法貨物を左右へ分けてコンテナ内重心を中央へ寄せる", () => {
    const rows = [0, 1].map((index) => cargo({
      uid: `spatial-${index}`,
      id: `S${index + 1}`,
      L_cm: 100,
      W_cm: 100,
      H_cm: 100,
      weight_kg: 1_000,
      stackable: false,
    }));
    const result = validatePlan(expandPieces(rows), DEFAULT_CONTAINERS, { "40HC": 1 }, DEFAULT_SETTINGS);
    const load = result.loads[0];
    const yPositions = new Set(load.placements.map((placement) => placement.placed_y_cm));
    const audit = result.bias_by_container.get(containerKey("40HC", 1));
    expect(yPositions.size).toBe(2);
    expect(audit?.offset_y_pct).toBeLessThan(0.1);
    expect(audit?.offset_x_pct).toBeLessThan(0.1);
  });

  it("段積み可能でも床面に余裕がある間は平置きを優先する", () => {
    const rows = [0, 1, 2, 3].map((index) => cargo({
      uid: `floor-first-${index}`,
      id: `F${index + 1}`,
      L_cm: 100,
      W_cm: 100,
      H_cm: 100,
      weight_kg: 500,
      stackable: true,
    }));
    const result = validatePlan(expandPieces(rows), DEFAULT_CONTAINERS, { "40HC": 1 }, DEFAULT_SETTINGS);
    expect(result.loads[0].placements.every((placement) => placement.placed_z_cm === 0)).toBe(true);
    expect(new Set(result.loads[0].placements.map((placement) => placement.placed_y_cm)).size).toBe(2);
  });
});
