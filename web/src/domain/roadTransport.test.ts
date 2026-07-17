import { describe, expect, it } from "vitest";

import { assessJapanRoadTransport } from "./roadTransport";
import type { ContainerLoad, ContainerSpec, Piece, Placement } from "./types";

const piece = (weight: number): Piece => ({ piece_id: "A#1", orig_id: "A", piece_no: 1, desc: "Cargo", L_cm: 200, W_cm: 280, H_cm: 390, weight_kg: weight, m3: 21.84, package_text: "CRATE", rotate_allowed: false, stackable: false, max_stack_load_kg: null, incompatible_with_ids: "" });
const load = (type: "20GP" | "40FR", weight: number): ContainerLoad => {
  const spec: ContainerSpec = type === "20GP"
    ? { type, category: "STANDARD", inner_L_cm: 589, inner_W_cm: 235, inner_H_cm: 239, max_payload_kg: 28_200, cost: 1, tare_weight_kg: 2_300 }
    : { type, category: "SPECIAL", inner_L_cm: 1160, inner_W_cm: 240, inner_H_cm: 1000, deck_L_cm: 1160, deck_W_cm: 240, max_payload_kg: 34_000, cost: 1, tare_weight_kg: 5_500 };
  const cargo = piece(weight);
  const placement: Placement = { piece: cargo, container_type: type, container_category: spec.category, container_index: 1, placed_x_cm: 0, placed_y_cm: type === "40FR" ? -20 : 0, placed_z_cm: 0, orient_L_cm: cargo.L_cm, orient_W_cm: cargo.W_cm, orient_H_cm: cargo.H_cm, rotation_key: "LWH" };
  return { spec, index: 1, placements: [placement] };
};

describe("日本国内陸送の参考判定", () => {
  it("20ftのコンテナ総重量が20,320kgを超えると3軸候補にする", () => {
    expect(assessJapanRoadTransport(load("20GP", 19_000)).chassisMessage).toMatch(/要3軸/u);
  });

  it("平均床荷重を貨物重量÷コンテナ内寸床面積で算出する", () => {
    const result = assessJapanRoadTransport(load("20GP", 10_000));
    expect(result.averageFloorLoadKgM2).toBeCloseTo(10_000 / (5.89 * 2.35));
  });

  it("幅・高さ超過の特殊コンテナを特車申請と誘導車の要確認にする", () => {
    const result = assessJapanRoadTransport(load("40FR", 10_000));
    expect(result.specialPermitMessage).toMatch(/特車申請要確認/u);
    expect(result.escortMessage).toMatch(/誘導車/u);
  });
});
