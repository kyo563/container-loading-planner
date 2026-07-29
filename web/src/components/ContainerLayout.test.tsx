import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ContainerSpec, Placement } from "../domain/types";
import { ContainerLayout, widthDisplayProjection, widthOverhangBands } from "./ContainerLayout";

const spec: ContainerSpec = {
  type: "40FR",
  category: "SPECIAL",
  inner_L_cm: 1160,
  inner_W_cm: 240,
  inner_H_cm: 1000,
  deck_L_cm: 1160,
  deck_W_cm: 240,
  max_payload_kg: 34_000,
  cost: 1,
  tare_weight_kg: 5_500,
};

const placement: Placement = {
  piece: {
    piece_id: "OW-1#1",
    orig_id: "OW-1",
    piece_no: 1,
    desc: "OW cargo",
    L_cm: 500,
    W_cm: 280,
    H_cm: 180,
    weight_kg: 5_000,
    m3: 25.2,
    package_text: "CASE",
    rotate_allowed: false,
    stackable: false,
    max_stack_load_kg: null,
    incompatible_with_ids: "",
  },
  container_type: "40FR",
  container_category: "SPECIAL",
  container_index: 1,
  placed_x_cm: 330,
  placed_y_cm: -20,
  placed_z_cm: 0,
  orient_L_cm: 500,
  orient_W_cm: 280,
  orient_H_cm: 180,
  rotation_key: "LWH",
};

describe("ContainerLayout OW表示", () => {
  it("コンテナ幅から左右にはみ出した部分だけを描画帯として返す", () => {
    expect(widthOverhangBands(placement, spec)).toEqual([
      { side: "left", y: -20, height: 20, overhangCm: 20 },
      { side: "right", y: 240, height: 20, overhangCm: 20 },
    ]);
  });

  it("インゲージ貨物にはOW描画帯を作らない", () => {
    expect(widthOverhangBands({ ...placement, placed_y_cm: 20, orient_W_cm: 200 }, spec)).toEqual([]);
  });

  it("左右非対称の配置では実際の各側超過量を返す", () => {
    expect(widthOverhangBands({ ...placement, placed_y_cm: -10 }, spec)).toEqual([
      { side: "left", y: -10, height: 10, overhangCm: 10 },
      { side: "right", y: 240, height: 30, overhangCm: 30 },
    ]);
  });

  it("OW部分を2本のハッチ帯で描き、コンテナ外周線をその前面に重ねる", () => {
    const markup = renderToStaticMarkup(<ContainerLayout load={{ spec, index: 1, placements: [placement] }} />);
    expect(markup.match(/class="cargo-width-overhang"/gu)).toHaveLength(2);
    expect(markup.match(/class="oog-dimension-line"/gu)).toHaveLength(2);
    expect(markup).toContain("OW left 20cm");
    expect(markup).toContain("OW right 20cm");
    expect(markup).toContain("OW左 +20 cm");
    expect(markup).toContain("OW右 +20 cm");
    expect(markup).not.toContain('class="cargo-overhang-break"');
    expect(markup.indexOf('class="container-deck-outline"')).toBeGreaterThan(
      markup.lastIndexOf('class="cargo-width-overhang"'),
    );
  });

  it("貨物重量から算出した重心位置を上面図へ表示する", () => {
    const markup = renderToStaticMarkup(<ContainerLayout load={{ spec, index: 1, placements: [placement] }} />);

    expect(markup).toContain('class="cargo-center-of-gravity"');
    expect(markup).toContain("貨物重心 X 580cm、Y 120cm");
    expect(markup).toContain(">貨物重心</text>");
    expect(markup).toContain("FRONT / TRUCK SIDE");
    expect(markup).toContain("DOOR SIDE · INNER");
  });

  it("極端なOWは描画幅だけを打ち切り、実超過量と省略記号を表示する", () => {
    const extremePlacement = {
      ...placement,
      piece: { ...placement.piece, W_cm: 1_000 },
      placed_y_cm: -380,
      orient_W_cm: 1_000,
    };
    expect(widthDisplayProjection(extremePlacement, spec)).toEqual({
      referenceWidthCm: 240,
      maxDisplayedOverhangCm: 72,
      y: -72,
      height: 384,
      leftTruncated: true,
      rightTruncated: true,
    });

    const markup = renderToStaticMarkup(
      <ContainerLayout load={{ spec, index: 1, placements: [extremePlacement] }} />,
    );
    expect(markup.match(/class="cargo-overhang-break"/gu)).toHaveLength(2);
    expect(markup).toContain("OW left drawing truncated");
    expect(markup).toContain("OW right drawing truncated");
    expect(markup).toContain("OW左 +380 cm");
    expect(markup).toContain("OW右 +380 cm");
    expect(markup).toContain("OW貨物の描画省略（注釈値は実超過量）");
  });

  it("上面図で表現しにくいOH量を貨物上のバッジで注釈する", () => {
    const ohResult = {
      oog_flag: true,
      oog_ref_type: "40HC",
      over_L_cm: 0,
      over_W_cm: 0,
      over_H_cm: 35,
      suggestion: "OT",
      chosen_orientation: {
        L_cm: placement.orient_L_cm,
        W_cm: placement.orient_W_cm,
        H_cm: placement.orient_H_cm,
        rotation_key: placement.rotation_key,
      },
      door_passable: true,
      door_check_applied: false,
      door_over_W_cm: 0,
      door_over_H_cm: 0,
      door_reason: "",
    };
    const markup = renderToStaticMarkup(
      <ContainerLayout
        load={{ spec: { ...spec, type: "40OT" }, index: 1, placements: [placement] }}
        oogResults={new Map([[placement.piece.piece_id, ohResult]])}
      />,
    );
    expect(markup).toContain('class="cargo-height-overhang-annotation"');
    expect(markup).toContain("OH +35 cm");
  });

  it("同一貨物の段積みを段数と列数の注釈でまとめる", () => {
    const placements = Array.from({ length: 3 }, (_, column) =>
      Array.from({ length: 4 }, (_, tier) => ({
        ...placement,
        piece: {
          ...placement.piece,
          piece_id: `#101#${column * 4 + tier + 1}`,
          orig_id: "#101",
          piece_no: column * 4 + tier + 1,
        },
        placed_x_cm: column * placement.orient_L_cm,
        placed_y_cm: 0,
        placed_z_cm: tier * placement.orient_H_cm,
      })),
    ).flat();
    const markup = renderToStaticMarkup(
      <ContainerLayout load={{ spec, index: 1, placements }} />,
    );

    expect(markup).toContain('class="cargo-stack-group"');
    expect(markup).toContain("#101 4段 × 3列");
    expect(markup).toContain("#1–#12（12 PCS）");
    expect(markup).not.toContain(">#101#1</text>");
  });
});
