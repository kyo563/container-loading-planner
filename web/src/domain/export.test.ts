import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./constants";
import { buildExcelReportWorkbook, placementRows } from "./export";
import { expandPieces } from "./input";
import { containerKey, estimatePlan } from "./planner";

describe("帳票のコンテナ重量", () => {
  it("入力した実TareでNET・Tare・Grossを出力する", () => {
    const cargo = [{ ...SAMPLE_CARGO[0], qty: 1 }];
    const result = estimatePlan(expandPieces(cargo), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    const load = result.loads[0];
    const key = containerKey(load.spec.type, load.index);
    const actualTareWeightKg = 4_321;
    const rows = placementRows(result, { [key]: actualTareWeightKg });
    const netWeightKg = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);

    expect(rows[0].container_total_cargo_kg).toBe(netWeightKg);
    expect(rows[0].container_tare_weight_kg).toBe(actualTareWeightKg);
    expect(rows[0].container_gross_weight_kg).toBe(netWeightKg + actualTareWeightKg);
  });

  it("コンテナ集計と個別パッキングリストへ実情報と復元URLを出力する", async () => {
    const cargo = [{ ...SAMPLE_CARGO[0], qty: 2 }];
    const result = estimatePlan(expandPieces(cargo), DEFAULT_CONTAINERS, DEFAULT_SETTINGS);
    const load = result.loads[0];
    const key = containerKey(load.spec.type, load.index);
    const actualTareWeightKg = 4_321;
    const restorationUrl = "https://example.com/container-loading-planner/#plan=lp3.test.payload";
    const workbook = await buildExcelReportWorkbook(
      result,
      { [key]: actualTareWeightKg },
      { [key]: { containerNumber: "ABCD1234567", sealNumber: "SEAL-001" } },
      restorationUrl,
    );
    const summary = workbook.getWorksheet("コンテナ集計")!;
    const packing = workbook.getWorksheet(`${load.spec.type}_${load.index}`)!;

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["コンテナ集計", `${load.spec.type}_${load.index}`]);
    expect(summary.getCell("C7").value).toBe("ABCD1234567");
    expect(summary.getCell("D7").value).toBe("SEAL-001");
    expect(summary.getCell("I7").value).toBe(actualTareWeightKg);
    expect(summary.getCell("J7").value).toMatchObject({ formula: "H7+I7" });
    expect(summary.getCell("B3").value).toMatchObject({ text: restorationUrl, hyperlink: restorationUrl });
    expect(packing.getCell("B3").value).toMatchObject({ formula: "'コンテナ集計'!C7", result: "ABCD1234567" });
    expect(packing.getCell("F3").value).toMatchObject({ formula: "'コンテナ集計'!D7", result: "SEAL-001" });
    expect(packing.getCell("F4").value).toMatchObject({ formula: "'コンテナ集計'!I7", result: actualTareWeightKg });
    expect(packing.getCell("J4").value).toMatchObject({ formula: "B4+F4" });
    expect(packing.getRow(9).getCell(2).value).toBe(load.placements[0].piece.piece_id);

    const bytes = await workbook.xlsx.writeBuffer();
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  });
});
