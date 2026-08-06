import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS } from "./constants";
import {
  buildManualPlanResult,
  createManualLoads,
  placeManualPiece,
  removeManualPiece,
} from "./manualPlan";
import { buildContainerPackingLists } from "./reporting";
import type { Piece } from "./types";

const piece = (
  pieceId: string,
  lengthCm = 100,
  widthCm = 80,
  heightCm = 100,
  weightKg = 500,
): Piece => ({
  piece_id: pieceId,
  orig_id: pieceId,
  piece_no: 1,
  desc: pieceId,
  L_cm: lengthCm,
  W_cm: widthCm,
  H_cm: heightCm,
  weight_kg: weightKg,
  m3: (lengthCm * widthCm * heightCm) / 1_000_000,
  package_text: "CASE",
  rotate_allowed: true,
  stackable: false,
  max_stack_load_kg: null,
  incompatible_with_ids: "",
});

describe("手動バン詰めプラン", () => {
  it("指定本数から編集対象コンテナを作成する", () => {
    const loads = createManualLoads(DEFAULT_CONTAINERS, { "20GP": 2, "40HC": 1 });

    expect(loads.map((load) => `${load.spec.type}-${load.index}`)).toEqual([
      "20GP-1",
      "20GP-2",
      "40HC-1",
    ]);
  });

  it("縮尺座標へ配置し、回転・重複・削除を処理する", () => {
    const loads = createManualLoads(DEFAULT_CONTAINERS, { "40HC": 1 });
    const cargoA = piece("A", 120, 80);
    const cargoB = piece("B", 100, 70);
    const placedA = placeManualPiece(loads, "40HC-1", cargoA, 13, 8, true);
    const overlap = placeManualPiece(placedA.loads, "40HC-1", cargoB, 20, 20, false);
    const placedB = placeManualPiece(placedA.loads, "40HC-1", cargoB, 200, 10, false);

    expect(placedA.error).toBeNull();
    expect(placedA.loads[0].placements[0]).toMatchObject({
      placed_x_cm: 15,
      placed_y_cm: 10,
      orient_L_cm: 80,
      orient_W_cm: 120,
      rotation_key: "WLH",
    });
    expect(overlap.error).toContain("重なって");
    expect(placedB.error).toBeNull();
    expect(removeManualPiece(placedB.loads, "A")[0].placements.map((placement) => placement.piece.piece_id)).toEqual(["B"]);
  });

  it("高さ差100cm以上の隣接を許可し、結果へ注意事項を残す", () => {
    const loads = createManualLoads(DEFAULT_CONTAINERS, { "40HC": 1 });
    const tall = piece("TALL", 100, 80, 200);
    const short = piece("SHORT", 100, 80, 100);
    const first = placeManualPiece(loads, "40HC-1", tall, 0, 0, false);
    const adjacent = placeManualPiece(first.loads, "40HC-1", short, 100, 0, false);
    const result = buildManualPlanResult(
      adjacent.loads,
      [tall, short],
      DEFAULT_CONTAINERS,
      DEFAULT_SETTINGS,
      { "40HC": 1 },
    );

    expect(adjacent.error).toBeNull();
    expect(adjacent.loads[0].placements).toHaveLength(2);
    expect(result.decision_reasons.join(" ")).toContain("配置不可ではありません");
  });

  it("手動配置からコンテナ集計とCLPリストを作成する", () => {
    const pieces = [piece("A", 120, 80, 90, 600), piece("B", 100, 70, 80, 400)];
    const loads = createManualLoads(DEFAULT_CONTAINERS, { "40HC": 1 });
    const placed = placeManualPiece(loads, "40HC-1", pieces[0], 0, 0, false);
    const result = buildManualPlanResult(
      placed.loads,
      pieces,
      DEFAULT_CONTAINERS,
      DEFAULT_SETTINGS,
      { "40HC": 1 },
    );
    const packingLists = buildContainerPackingLists(result);

    expect(result.mode).toBe("manual");
    expect(result.placements.map((placement) => placement.piece.piece_id)).toEqual(["A"]);
    expect(result.unplaced.map((cargo) => cargo.piece_id)).toEqual(["B"]);
    expect(result.weight_audit_by_container.get("40HC-1")?.total_weight_kg).toBe(600);
    expect(packingLists[0]).toMatchObject({
      containerKey: "40HC-1",
      pieceCount: 1,
      totalWeightKg: 600,
    });
  });
});
