import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS } from "./constants";
import { packPieces, sortPieces } from "./packing";
import { computeBias } from "./planner";
import type { ContainerLoad, Piece } from "./types";
import { cargoCenterOfGravity, splitWeightAcrossMidpoint } from "./weightBalance";

const STANDARD_40HC = DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!;

const piece = (
  pieceId: string,
  lengthCm: number,
  widthCm: number,
  weightKg: number,
): Piece => ({
  piece_id: pieceId,
  orig_id: pieceId,
  piece_no: 1,
  desc: pieceId,
  L_cm: lengthCm,
  W_cm: widthCm,
  H_cm: 80,
  weight_kg: weightKg,
  m3: (lengthCm * widthCm * 80) / 1_000_000,
  package_text: "CASE",
  rotate_allowed: false,
  stackable: false,
  max_stack_load_kg: null,
  incompatible_with_ids: "",
});

describe("コンテナ内重量バランス", () => {
  it("異寸法貨物でも重量物を中央へ寄せて前後・左右の偏りを抑える", () => {
    const pieces = sortPieces([
      piece("HEAVY", 200, 90, 9_000),
      piece("LIGHT-A", 200, 80, 1_000),
      piece("LIGHT-B", 200, 70, 1_000),
    ]);
    const packed = packPieces(STANDARD_40HC, pieces, 1);
    const load = packed.loads[0];
    const heavy = load.placements.find((placement) => placement.piece.piece_id === "HEAVY")!;
    const metrics = computeBias(load, 20);

    expect(packed.unplaced).toHaveLength(0);
    expect(heavy.placed_x_cm + heavy.orient_L_cm / 2).toBeCloseTo(STANDARD_40HC.inner_L_cm / 2);
    expect(metrics.offset_x_pct).toBeLessThan(0.1);
    expect(metrics.offset_y_pct).toBeLessThan(2);
    expect(metrics.bias_warn).toBe(false);
  });

  it("中央線をまたぐ貨物重量を占有長さに応じて両側へ按分する", () => {
    expect(splitWeightAcrossMidpoint(40, 20, 50, 1_000)).toEqual({
      beforeKg: 500,
      afterKg: 500,
    });
  });

  it("中央配置した単一貨物を偏荷重として誤警告しない", () => {
    const cargo = piece("CENTER", 600, 100, 10_000);
    const load: ContainerLoad = {
      spec: STANDARD_40HC,
      index: 1,
      placements: [{
        piece: cargo,
        container_type: STANDARD_40HC.type,
        container_category: STANDARD_40HC.category,
        container_index: 1,
        placed_x_cm: (STANDARD_40HC.inner_L_cm - cargo.L_cm) / 2,
        placed_y_cm: (STANDARD_40HC.inner_W_cm - cargo.W_cm) / 2,
        placed_z_cm: 0,
        orient_L_cm: cargo.L_cm,
        orient_W_cm: cargo.W_cm,
        orient_H_cm: cargo.H_cm,
        rotation_key: "LWH",
      }],
    };
    const center = cargoCenterOfGravity(load);
    const metrics = computeBias(load, 1);

    expect(center?.xCm).toBeCloseTo(STANDARD_40HC.inner_L_cm / 2);
    expect(center?.yCm).toBeCloseTo(STANDARD_40HC.inner_W_cm / 2);
    expect(metrics.front_rear_diff_pct).toBeLessThan(0.1);
    expect(metrics.left_right_diff_pct).toBeLessThan(0.1);
    expect(metrics.bias_warn).toBe(false);
  });
});
