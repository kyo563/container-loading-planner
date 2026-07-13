import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS } from "./constants";
import { buildLayoutLabels } from "./layoutLabels";
import type { ContainerLoad, Placement } from "./types";

const placement = (pieceNo: number, length: number, width: number, origId = "SMALL-CARGO"): Placement => ({
  piece: { piece_id: `${origId}#${pieceNo}`, orig_id: origId, piece_no: pieceNo, desc: "小型貨物", L_cm: length, W_cm: width, H_cm: 20, weight_kg: 10, m3: 0.01, package_text: "CARTON", rotate_allowed: true, stackable: true, max_stack_load_kg: null, incompatible_with_ids: "" },
  container_type: "40HC", container_category: "STANDARD", container_index: 1,
  placed_x_cm: pieceNo * 10, placed_y_cm: 0, placed_z_cm: 0,
  orient_L_cm: length, orient_W_cm: width, orient_H_cm: 20, rotation_key: "LWH",
});

const load = (placements: Placement[]): ContainerLoad => ({ spec: DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!, index: 1, placements });

describe("buildLayoutLabels", () => {
  it("十分な大きさの貨物は完全な貨物IDを表示する", () => {
    const result = buildLayoutLabels(load([placement(1, 180, 80)]));
    expect(result.labels.get("SMALL-CARGO#1")).toMatchObject({ text: "SMALL-CARGO#1", compact: false });
    expect(result.legends).toHaveLength(0);
  });

  it("小型貨物は短縮番号とID範囲の凡例を生成する", () => {
    const result = buildLayoutLabels(load([placement(1, 35, 18), placement(2, 35, 18), placement(3, 35, 18)]));
    expect(result.labels.get("SMALL-CARGO#1")).toMatchObject({ text: "A1", compact: true });
    expect(result.legends).toEqual([{ code: "A", origId: "SMALL-CARGO", pieceRange: "#1–#3", count: 3 }]);
  });

  it("非連続の個体番号を誤って連続範囲にまとめない", () => {
    const result = buildLayoutLabels(load([placement(1, 35, 18), placement(3, 35, 18)]));
    expect(result.legends[0].pieceRange).toBe("#1、#3");
  });
});
