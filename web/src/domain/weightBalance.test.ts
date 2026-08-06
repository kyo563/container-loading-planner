import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS } from "./constants";
import { packPieces, sortPieces } from "./packing";
import { computeBias } from "./planner";
import type { ContainerLoad, Piece, Placement } from "./types";
import { cargoCenterOfGravity, splitWeightAcrossMidpoint } from "./weightBalance";

const STANDARD_40HC = DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!;
const FLAT_RACK_40 = DEFAULT_CONTAINERS.find((spec) => spec.type === "40FR")!;

const piece = (
  pieceId: string,
  lengthCm: number,
  widthCm: number,
  weightKg: number,
  origId = pieceId,
): Piece => ({
  piece_id: pieceId,
  orig_id: origId,
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
  it("異寸法貨物は重量にかかわらず大きいものからトラック側へ置く", () => {
    const pieces = sortPieces([
      piece("LARGE-LIGHT", 200, 90, 1_000),
      piece("MEDIUM-LIGHT", 200, 80, 1_000),
      piece("SMALL-HEAVY", 200, 70, 9_000),
    ]);
    const packed = packPieces(STANDARD_40HC, pieces, 1);
    const load = packed.loads[0];
    const smallHeavy = load.placements.find((placement) => placement.piece.piece_id === "SMALL-HEAVY")!;
    const ordered = [...load.placements].sort((a, b) => a.placed_x_cm - b.placed_x_cm);

    expect(packed.unplaced).toHaveLength(0);
    expect(ordered.map((placement) => placement.placed_x_cm)).toEqual([0, 200, 400]);
    expect(ordered.map((placement) => placement.piece.piece_id)).toEqual(["LARGE-LIGHT", "MEDIUM-LIGHT", "SMALL-HEAVY"]);
    expect(smallHeavy.placed_x_cm).toBe(400);
  });

  it("長さの異なる貨物を大・中・小の順でトラック側から並べる", () => {
    const packed = packPieces(STANDARD_40HC, sortPieces([
      piece("SMALL", 60, 40, 500),
      piece("LARGE", 210, 95, 500),
      piece("MEDIUM", 120, 80, 500),
    ]), 1);
    const ordered = [...packed.loads[0].placements].sort((a, b) => a.placed_x_cm - b.placed_x_cm);

    expect(packed.unplaced).toHaveLength(0);
    expect(ordered.map((placement) => placement.piece.piece_id)).toEqual(["LARGE", "MEDIUM", "SMALL"]);
    expect(ordered.map((placement) => placement.placed_x_cm)).toEqual([0, 210, 330]);
  });

  it("同一貨物を分断せず、各列をトラックサイド側から連続配置する", () => {
    const packed = packPieces(STANDARD_40HC, sortPieces([
      piece("A#1", 100, 100, 500, "A"),
      piece("B#1", 100, 100, 500, "B"),
      piece("A#2", 100, 100, 500, "A"),
      piece("C#1", 100, 100, 500, "C"),
      piece("B#2", 100, 100, 500, "B"),
      piece("C#2", 100, 100, 500, "C"),
    ]), 1);

    const rows = [...new Set(packed.loads[0].placements.map((placement) => placement.placed_y_cm))]
      .map((y) => packed.loads[0].placements
        .filter((placement) => placement.placed_y_cm === y)
        .sort((a, b) => a.placed_x_cm - b.placed_x_cm));

    expect(packed.unplaced).toHaveLength(0);
    for (const row of rows) {
      expect(row[0].placed_x_cm).toBe(0);
      for (let index = 1; index < row.length; index += 1) {
        expect(row[index].placed_x_cm).toBe(row[index - 1].placed_x_cm + row[index - 1].orient_L_cm);
      }
      const sequence = row.map((placement) => placement.piece.orig_id);
      const compressed = sequence.filter((origId, index) => index === 0 || origId !== sequence[index - 1]);
      expect(new Set(compressed).size).toBe(compressed.length);
    }
  });

  it("前後バランスの改善が小さい場合はパッキングリストの貨物順を保つ", () => {
    const packed = packPieces(STANDARD_40HC, sortPieces([
      piece("A#1", 100, 100, 510, "A"),
      piece("A#2", 100, 100, 510, "A"),
      piece("B#1", 100, 100, 500, "B"),
      piece("B#2", 100, 100, 500, "B"),
      piece("C#1", 100, 100, 500, "C"),
      piece("C#2", 100, 100, 500, "C"),
    ]), 1);
    const rows = [...new Set(packed.loads[0].placements.map((placement) => placement.placed_y_cm))]
      .map((y) => packed.loads[0].placements
        .filter((placement) => placement.placed_y_cm === y)
        .sort((a, b) => a.placed_x_cm - b.placed_x_cm));

    expect(packed.unplaced).toHaveLength(0);
    for (const row of rows) {
      expect(row.map((placement) => placement.piece.orig_id)).toEqual(["A", "B", "C"]);
    }
  });

  it("異なる貨物IDでも同寸法グループを隣接させる", () => {
    const packed = packPieces(STANDARD_40HC, sortPieces([
      piece("A#1", 100, 80, 300, "A"),
      piece("B#1", 100, 80, 400, "B"),
      piece("C#1", 200, 70, 500, "C"),
      piece("A#2", 100, 80, 300, "A"),
      piece("B#2", 100, 80, 400, "B"),
    ]), 1);
    const ordered = [...packed.loads[0].placements].sort((a, b) => a.placed_x_cm - b.placed_x_cm);
    const sizeSequence = ordered.map((placement) => `${placement.orient_L_cm}x${placement.orient_W_cm}`);
    const compressedSizes = sizeSequence.filter((size, index) => index === 0 || size !== sizeSequence[index - 1]);

    expect(packed.unplaced).toHaveLength(0);
    expect(new Set(compressedSizes).size).toBe(compressedSizes.length);
    expect(ordered
      .filter((placement) => placement.orient_L_cm === 100)
      .map((placement) => placement.piece.orig_id))
      .toEqual(["A", "A", "B", "B"]);
  });

  it("満載に近い場合は貨物グループを保ったまま重量物を中央付近に置く", () => {
    const group = (origId: string, count: number, weightKg: number) =>
      Array.from({ length: count }, (_, index) => piece(`${origId}#${index + 1}`, 100, 100, weightKg, origId));
    const packed = packPieces(STANDARD_40HC, sortPieces([
      ...group("A", 8, 100),
      ...group("HEAVY", 4, 5_000),
      ...group("B", 8, 100),
    ]), 1);
    const centersByGroup = new Map<string, number[]>();
    for (const placement of packed.loads[0].placements) {
      const centers = centersByGroup.get(placement.piece.orig_id) ?? [];
      centers.push(placement.placed_x_cm + placement.orient_L_cm / 2);
      centersByGroup.set(placement.piece.orig_id, centers);
    }
    const averageCenter = (origId: string) => {
      const centers = centersByGroup.get(origId)!;
      return centers.reduce((sum, center) => sum + center, 0) / centers.length;
    };
    const midpoint = STANDARD_40HC.inner_L_cm / 2;

    expect(packed.unplaced).toHaveLength(0);
    expect(Math.abs(averageCenter("HEAVY") - midpoint)).toBeLessThan(Math.abs(averageCenter("A") - midpoint));
    expect(Math.abs(averageCenter("HEAVY") - midpoint)).toBeLessThan(Math.abs(averageCenter("B") - midpoint));
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

  it("FRは重量物を中央へ寄せ、同寸法貨物を中心から点対称に置く", () => {
    const packed = packPieces(FLAT_RACK_40, sortPieces([
      piece("HEAVY", 100, 100, 10_000),
      piece("LIGHT-A", 100, 100, 1_000),
      piece("LIGHT-B", 100, 100, 1_000),
    ]), 1);
    const load = packed.loads[0];
    const byId = new Map(load.placements.map((placement) => [placement.piece.piece_id, placement]));
    const heavy = byId.get("HEAVY")!;
    const lightA = byId.get("LIGHT-A")!;
    const lightB = byId.get("LIGHT-B")!;
    const midpointX = FLAT_RACK_40.inner_L_cm / 2;
    const midpointY = FLAT_RACK_40.inner_W_cm / 2;
    const centerX = (placement: Placement) => placement.placed_x_cm + placement.orient_L_cm / 2;
    const centerY = (placement: Placement) => placement.placed_y_cm + placement.orient_W_cm / 2;

    expect(packed.unplaced).toHaveLength(0);
    expect(centerX(heavy)).toBeCloseTo(midpointX);
    expect(centerX(lightA) + centerX(lightB)).toBeCloseTo(midpointX * 2);
    expect(load.placements.every((placement) => Math.abs(centerY(placement) - midpointY) < 0.001)).toBe(true);
    expect(cargoCenterOfGravity(load)?.xCm).toBeCloseTo(midpointX);
    expect(cargoCenterOfGravity(load)?.yCm).toBeCloseTo(midpointY);
  });
});
