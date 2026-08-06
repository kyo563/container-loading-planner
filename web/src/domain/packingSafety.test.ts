import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS } from "./constants";
import { packPieces, sortPieces } from "./packing";
import type { Piece } from "./types";

const STANDARD_40HC = DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!;

const piece = (
  pieceId: string,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
): Piece => ({
  piece_id: pieceId,
  orig_id: pieceId,
  piece_no: 1,
  desc: pieceId,
  L_cm: lengthCm,
  W_cm: widthCm,
  H_cm: heightCm,
  weight_kg: 500,
  m3: (lengthCm * widthCm * heightCm) / 1_000_000,
  package_text: "CASE",
  rotate_allowed: false,
  stackable: false,
  max_stack_load_kg: null,
  incompatible_with_ids: "",
});

describe("高さ差を抑える配置順", () => {
  it("大きい貨物を先頭に保ちながら高さの近い貨物を続ける", () => {
    const packed = packPieces(STANDARD_40HC, sortPieces([
      piece("TALL-LARGE", 220, 80, 220),
      piece("SHORT-MEDIUM", 200, 80, 100),
      piece("TALL-SMALL", 180, 80, 210),
    ]), 1);
    const placedIds = packed.loads[0].placements
      .sort((a, b) => a.placed_x_cm - b.placed_x_cm)
      .map((placement) => placement.piece.piece_id);

    expect(placedIds).toEqual(["TALL-LARGE", "TALL-SMALL", "SHORT-MEDIUM"]);
    expect(packed.unplaced).toHaveLength(0);
  });

  it("高さ差100cm以上でも配置不可にしない", () => {
    const allowed = packPieces(STANDARD_40HC, sortPieces([
      piece("TALL-199", 200, 80, 199),
      piece("SHORT-100", 200, 80, 100),
    ]), 1);
    const advisory = packPieces(STANDARD_40HC, sortPieces([
      piece("TALL-200", 200, 80, 200),
      piece("SHORT-100", 200, 80, 100),
    ]), 1);

    expect(allowed.loads[0].placements).toHaveLength(2);
    expect(allowed.unplaced).toHaveLength(0);
    expect(advisory.loads[0].placements).toHaveLength(2);
    expect(advisory.unplaced).toHaveLength(0);
  });

  it("左右の棚列でも高さ差だけを理由に積載不可にしない", () => {
    const packed = packPieces(STANDARD_40HC, sortPieces([
      piece("TALL", 700, 100, 200),
      piece("SHORT", 700, 100, 100),
    ]), 1);

    expect(packed.loads[0].placements.map((placement) => placement.piece.piece_id)).toEqual(["TALL", "SHORT"]);
    expect(packed.unplaced).toHaveLength(0);
  });

  it("床面の残りに入る小口貨物を試してから段積みへ進む", () => {
    const floorFirstSpec = {
      ...STANDARD_40HC,
      type: "FLOOR-FIRST",
      inner_L_cm: 500,
      inner_W_cm: 101,
      inner_H_cm: 203,
    };
    const packed = packPieces(floorFirstSpec, sortPieces([
      { ...piece("LARGE-A", 300, 100, 100), stackable: true },
      { ...piece("LARGE-B", 300, 100, 100), stackable: true },
      { ...piece("SMALL", 200, 100, 100), stackable: true },
    ]), 1);
    const byId = new Map(packed.loads[0].placements.map((placement) => [placement.piece.piece_id, placement]));

    expect(packed.unplaced).toHaveLength(0);
    expect(byId.get("LARGE-A")?.placed_x_cm).toBe(0);
    expect(byId.get("SMALL")?.placed_x_cm).toBe(300);
    expect(byId.get("SMALL")?.placed_z_cm).toBe(0);
    expect(byId.get("LARGE-B")?.placed_z_cm).toBe(100);
  });
});
