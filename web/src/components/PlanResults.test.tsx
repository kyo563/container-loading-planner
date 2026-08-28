import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "../domain/constants";
import { expandPieces } from "../domain/input";
import { estimatePlan } from "../domain/planner";
import { PlanResults } from "./PlanResults";

const cargo = (heightCm: number) => ({
  ...SAMPLE_CARGO[0],
  uid: `result-${heightCm}`,
  id: `RESULT-${heightCm}`,
  qty: 1,
  L_cm: 600,
  W_cm: 100,
  H_cm: heightCm,
  weight_kg: 1_000,
  rotate_allowed: false,
  stackable: false,
});

describe("PlanResults", () => {
  it("40HCバンプランに40GP代用可否と理由を表示する", () => {
    const possible = renderToStaticMarkup(
      <PlanResults result={estimatePlan(expandPieces([cargo(220)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS)} />,
    );
    const blocked = renderToStaticMarkup(
      <PlanResults result={estimatePlan(expandPieces([cargo(230)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS)} />,
    );

    expect(possible).toContain("40GP代用：可能");
    expect(possible).toContain("内寸・入口寸法・最大積載重量の条件内");
    expect(blocked).toContain("40GP代用：不可");
    expect(blocked).toContain("入口寸法を通過できない貨物");
  });

  it("選定根拠を表示せずNET・Tare・Grossを分けて表示する", () => {
    const markup = renderToStaticMarkup(
      <PlanResults result={estimatePlan(expandPieces([cargo(220)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS)} />,
    );

    expect(markup).not.toContain("選定根拠・前提");
    expect(markup).toContain("NET（貨物重量）");
    expect(markup).toContain("Tare（コンテナ風袋）");
    expect(markup).toContain("Gross（合計コンテナ重量）");
    expect(markup).toContain("のTare重量");
    expect(markup).not.toContain("2軸シャーシ範囲内");
  });

  it("コンテナ情報の入力欄と印刷用の11マスを表示する", () => {
    const result = estimatePlan(expandPieces([cargo(220)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    const markup = renderToStaticMarkup(
      <PlanResults result={result} />,
    );

    expect(markup).toContain("コンテナ情報メモ");
    expect(markup).toContain("のコンテナ番号");
    expect(markup).toContain("のSeal番号");
    expect(markup).toContain("CONTAINER NO.");
    expect(markup).toContain("SEAL NO.");
    expect(markup.match(/class="print-container-number-box"/gu)).toHaveLength(result.loads.length * 11);
  });

  it("印刷物をCLP、パッキングリスト、QRの順に構成し、占有率を掲載しない", () => {
    const markup = renderToStaticMarkup(
      <PlanResults result={estimatePlan(expandPieces([cargo(220)]), DEFAULT_CONTAINERS, DEFAULT_SETTINGS)} />,
    );
    const printStart = markup.indexOf('<div class="print-document print-only">');
    const screenStart = markup.indexOf('<div class="results-heading">', printStart);
    const printMarkup = markup.slice(printStart, screenStart);

    expect(printStart).toBeGreaterThanOrEqual(0);
    expect(screenStart).toBeGreaterThan(printStart);
    expect(printMarkup.indexOf('class="print-clp-pages"')).toBeLessThan(printMarkup.indexOf('class="print-packing-pages"'));
    expect(printMarkup.indexOf('class="print-packing-pages"')).toBeLessThan(printMarkup.indexOf('class="print-qr-page"'));
    expect(printMarkup).toContain("CONTAINER LOADING PLAN");
    expect(printMarkup).toContain("コンテナサイズ");
    expect(printMarkup).toContain("NET");
    expect(printMarkup).toContain("Tare");
    expect(printMarkup).toContain("M³");
    expect(printMarkup).not.toContain("推奨コンテナ構成");
    expect(printMarkup).not.toContain("Payload");
    expect(printMarkup).not.toContain("容積（参考）");
  });
});
