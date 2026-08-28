import Papa from "papaparse";
import type { Row, Worksheet } from "exceljs";

import { buildContainerKpis, containerLabel } from "./reporting";
import { containerKey } from "./planner";
import { oogDisplayMetrics } from "./oogDisplay";
import { assessJapanRoadTransport } from "./roadTransport";
import type { CargoRow, PlanResult } from "./types";

export type ContainerTareWeights = Readonly<Record<string, number>>;

export interface ContainerExportInfo {
  containerNumber: string;
  sealNumber: string;
}

export type ContainerExportInfoByKey = Readonly<Record<string, ContainerExportInfo>>;

const EXCEL_CELL_CHARACTER_LIMIT = 32_767;
const EXCEL_MAX_TARE_WEIGHT_KG = 100_000;
const EXCEL_SHEET_NAME_LIMIT = 31;
const EXCEL_COLORS = {
  navy: "FF11324E",
  teal: "FF0F6B70",
  paleBlue: "FFEAF3F8",
  paleYellow: "FFFFF3CD",
  paleGray: "FFF2F4F5",
  white: "FFFFFFFF",
  border: "FFB7C4CC",
  link: "FF0563C1",
} as const;

const tareWeightFor = (result: PlanResult, key: string, tareWeights: ContainerTareWeights): number =>
  tareWeights[key]
    ?? result.loads.find((load) => containerKey(load.spec.type, load.index) === key)?.spec.tare_weight_kg
    ?? 0;

const safeCell = <T>(value: T): T | string => {
  if (typeof value !== "string") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
};

const safeRows = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
  rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])));

export const placementRows = (result: PlanResult, tareWeights: ContainerTareWeights = {}): Record<string, unknown>[] =>
  result.loads.flatMap((load) => {
    const key = containerKey(load.spec.type, load.index);
    const bias = result.bias_by_container.get(key);
    const weight = result.weight_audit_by_container.get(key);
    const tareWeightKg = tareWeightFor(result, key, tareWeights);
    const containerGrossWeightKg = (weight?.total_weight_kg ?? 0) + tareWeightKg;
    return load.placements.map((placement, index) => {
      const oog = result.oog_results.get(placement.piece.piece_id);
      const displayOog = oogDisplayMetrics(placement, load.spec, oog);
      return {
        container_label: containerLabel(load),
        container_type: load.spec.type,
        container_index: load.index,
        loading_sequence: index + 1,
        cargo_piece_id: placement.piece.piece_id,
        orig_id: placement.piece.orig_id,
        desc: placement.piece.desc,
        package_text: placement.piece.package_text,
        L_cm: placement.piece.L_cm,
        W_cm: placement.piece.W_cm,
        H_cm: placement.piece.H_cm,
        weight_kg: placement.piece.weight_kg,
        m3: placement.piece.m3,
        placed_x_cm: placement.placed_x_cm,
        placed_y_cm: placement.placed_y_cm,
        placed_z_cm: placement.placed_z_cm,
        orient_L_cm: placement.orient_L_cm,
        orient_W_cm: placement.orient_W_cm,
        orient_H_cm: placement.orient_H_cm,
        rotation_key: placement.rotation_key,
        oog_flag: oog?.oog_flag ?? false,
        oog_over_L_cm: oog?.over_L_cm ?? 0,
        oog_over_W_cm: oog?.over_W_cm ?? 0,
        oog_ow_total_cm: displayOog.owTotalCm,
        oog_ow_each_left_cm: displayOog.owLeftCm,
        oog_ow_each_right_cm: displayOog.owRightCm,
        oog_over_H_cm: oog?.over_H_cm ?? 0,
        door_passable: oog?.door_passable ?? true,
        special_container_reason: result.special_reason_by_piece.get(placement.piece.piece_id) ?? "",
        bias_warn: bias?.bias_warn ?? false,
        bias_reason: bias?.bias_reason ?? "",
        bias_offset_x_pct: bias?.offset_x_pct ?? 0,
        bias_offset_y_pct: bias?.offset_y_pct ?? 0,
        weight_alert: weight?.weight_alert ?? false,
        weight_alert_message: weight?.weight_alert_message ?? "",
        container_total_cargo_kg: weight?.total_weight_kg ?? 0,
        container_tare_weight_kg: tareWeightKg,
        container_gross_weight_kg: containerGrossWeightKg,
        payload_ratio_pct: weight?.payload_ratio_pct ?? 0,
      };
    });
  });

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const exportPlacementsCsv = async (result: PlanResult, tareWeights: ContainerTareWeights = {}): Promise<void> => {
  const csv = `\uFEFF${Papa.unparse(safeRows(placementRows(result, tareWeights)))}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "container_loading_plan.csv");
};

export const exportCargoCsv = async (rows: CargoRow[]): Promise<void> => {
  const output = rows.map(({ uid: _uid, ...row }) => row);
  const csv = `\uFEFF${Papa.unparse(safeRows(output))}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "cargo_input.csv");
};

const excelSheetName = (type: string, index: number, usedNames: Set<string>): string => {
  const base = `${type}_${index}`.replace(/[\\/:*?\[\]]/gu, "_").slice(0, EXCEL_SHEET_NAME_LIMIT) || `Container_${index}`;
  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) {
    const label = `_${suffix}`;
    name = `${base.slice(0, EXCEL_SHEET_NAME_LIMIT - label.length)}${label}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
};

export const buildExcelReportWorkbook = async (
  result: PlanResult,
  tareWeights: ContainerTareWeights = {},
  containerInfo: ContainerExportInfoByKey = {},
  restorationUrl = "",
) => {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "LoadPilot";
  workbook.subject = "コンテナ別集計・パッキングリスト";
  workbook.calcProperties.fullCalcOnLoad = true;

  const styleTitle = (row: Row, height = 30) => {
    row.height = height;
    row.font = { bold: true, size: 18, color: { argb: EXCEL_COLORS.white } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.navy } };
    row.alignment = { vertical: "middle", horizontal: "left" };
  };
  const styleHeader = (row: Row) => {
    row.height = 26;
    row.font = { bold: true, color: { argb: EXCEL_COLORS.white } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.teal } };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  };
  const applyBorders = (sheet: Worksheet, fromRow: number, toRow: number, toColumn: number) => {
    for (let row = fromRow; row <= toRow; row += 1) {
      for (let column = 1; column <= toColumn; column += 1) {
        sheet.getCell(row, column).border = {
          top: { style: "thin", color: { argb: EXCEL_COLORS.border } },
          left: { style: "thin", color: { argb: EXCEL_COLORS.border } },
          bottom: { style: "thin", color: { argb: EXCEL_COLORS.border } },
          right: { style: "thin", color: { argb: EXCEL_COLORS.border } },
        };
      }
    }
  };
  const setRestorationUrl = (sheet: Worksheet, rowNumber: number, lastColumn: number) => {
    sheet.getCell(rowNumber, 1).value = "復元URL";
    sheet.getCell(rowNumber, 1).font = { bold: true };
    sheet.getCell(rowNumber, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.paleBlue } };
    sheet.mergeCells(rowNumber, 2, rowNumber, lastColumn);
    const cell = sheet.getCell(rowNumber, 2);
    if (!restorationUrl) {
      cell.value = "手動配置プランはURLからの再表示に対応していません。";
    } else if (restorationUrl.length > EXCEL_CELL_CHARACTER_LIMIT) {
      cell.value = "復元URLがExcelのセル上限を超えています。アプリ画面の共有QRを使用してください。";
    } else {
      cell.value = { text: restorationUrl, hyperlink: restorationUrl, tooltip: "LoadPilotで詳細を再表示" };
      cell.font = { color: { argb: EXCEL_COLORS.link }, underline: true, size: 9 };
    }
    cell.alignment = { vertical: "middle", wrapText: true };
  };

  const usedSheetNames = new Set<string>(["コンテナ集計", "積載不可"]);
  const packingSheetByContainer = new Map(result.loads.map((load) => [
    containerKey(load.spec.type, load.index),
    excelSheetName(load.spec.type, load.index, usedSheetNames),
  ]));
  const kpis = buildContainerKpis(result);
  const summary = workbook.addWorksheet("コンテナ集計", {
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  summary.mergeCells("A1:N1");
  summary.getCell("A1").value = "コンテナ別集計";
  styleTitle(summary.getRow(1));
  summary.mergeCells("A2:N2");
  summary.getCell("A2").value = "Tareを変更するとGrossが再計算されます。3軸シャーシが必要な場合のみ注記を表示します。";
  summary.getCell("A2").alignment = { vertical: "middle", wrapText: true };
  summary.getRow(2).height = 24;
  setRestorationUrl(summary, 3, 14);
  summary.mergeCells("A4:N4");
  summary.getCell("A4").value = "復元URLには貨物情報と計算条件が含まれます。共有範囲と保管先にご注意ください。";
  summary.getCell("A4").font = { italic: true, size: 9, color: { argb: "FF52636D" } };
  summary.getCell("A4").alignment = { vertical: "middle" };
  summary.getRow(3).height = 42;
  summary.getRow(4).height = 20;
  const summaryHeaders = ["No.", "コンテナ", "コンテナ番号", "Seal番号", "種別", "個数", "M³", "NET (kg)", "Tare (kg)", "Gross (kg)", "シャーシ注記", "偏荷重", "重量警告", "パッキングリスト"];
  summary.getRow(6).values = summaryHeaders;
  styleHeader(summary.getRow(6));
  summary.columns.forEach((column, index) => {
    column.width = [7, 15, 19, 18, 12, 9, 12, 15, 15, 15, 42, 12, 12, 19][index];
  });

  result.loads.forEach((load, index) => {
    const rowNumber = index + 7;
    const key = containerKey(load.spec.type, load.index);
    const kpi = kpis.find((candidate) => candidate.container_key === key)!;
    const tareWeightKg = tareWeightFor(result, key, tareWeights);
    const road = assessJapanRoadTransport(load, tareWeightKg);
    const info = containerInfo[key] ?? { containerNumber: "", sealNumber: "" };
    const packingSheetName = packingSheetByContainer.get(key)!;
    const row = summary.getRow(rowNumber);
    row.values = [
      index + 1,
      containerLabel(load),
      safeCell(info.containerNumber),
      safeCell(info.sealNumber),
      load.spec.type,
      kpi.piece_count,
      kpi.total_m3,
      kpi.total_gross_kg,
      tareWeightKg,
      { formula: `H${rowNumber}+I${rowNumber}`, result: kpi.total_gross_kg + tareWeightKg },
      road.chassisMessage ?? "",
      kpi.bias_warn ? "確認をお願いします" : "",
      kpi.weight_alert ? "確認をお願いします" : "",
      { text: packingSheetName, hyperlink: `#'${packingSheetName.replaceAll("'", "''")}'!A1` },
    ];
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 32;
    summary.getCell(rowNumber, 7).numFmt = "0.000";
    for (const column of [8, 9, 10]) summary.getCell(rowNumber, column).numFmt = "#,##0";
    for (const column of [3, 4, 9]) summary.getCell(rowNumber, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.paleYellow } };
    summary.getCell(rowNumber, 9).dataValidation = { type: "decimal", operator: "between", allowBlank: false, formulae: [0, EXCEL_MAX_TARE_WEIGHT_KG] };
    summary.getCell(rowNumber, 14).font = { color: { argb: EXCEL_COLORS.link }, underline: true };
  });
  const summaryTotalRow = result.loads.length + 7;
  summary.mergeCells(summaryTotalRow, 1, summaryTotalRow, 5);
  summary.getCell(summaryTotalRow, 1).value = "合計";
  summary.getCell(summaryTotalRow, 1).alignment = { horizontal: "right", vertical: "middle" };
  const firstSummaryDataRow = 7;
  const lastSummaryDataRow = Math.max(firstSummaryDataRow, summaryTotalRow - 1);
  const totals = {
    pieces: kpis.reduce((sum, kpi) => sum + kpi.piece_count, 0),
    m3: kpis.reduce((sum, kpi) => sum + kpi.total_m3, 0),
    net: kpis.reduce((sum, kpi) => sum + kpi.total_gross_kg, 0),
    tare: result.loads.reduce((sum, load) => sum + tareWeightFor(result, containerKey(load.spec.type, load.index), tareWeights), 0),
  };
  if (result.loads.length) {
    summary.getCell(summaryTotalRow, 6).value = { formula: `SUM(F${firstSummaryDataRow}:F${lastSummaryDataRow})`, result: totals.pieces };
    summary.getCell(summaryTotalRow, 7).value = { formula: `SUM(G${firstSummaryDataRow}:G${lastSummaryDataRow})`, result: totals.m3 };
    summary.getCell(summaryTotalRow, 8).value = { formula: `SUM(H${firstSummaryDataRow}:H${lastSummaryDataRow})`, result: totals.net };
    summary.getCell(summaryTotalRow, 9).value = { formula: `SUM(I${firstSummaryDataRow}:I${lastSummaryDataRow})`, result: totals.tare };
    summary.getCell(summaryTotalRow, 10).value = { formula: `SUM(J${firstSummaryDataRow}:J${lastSummaryDataRow})`, result: totals.net + totals.tare };
  } else {
    for (const column of [6, 7, 8, 9, 10]) summary.getCell(summaryTotalRow, column).value = 0;
  }
  for (let column = 1; column <= summaryHeaders.length; column += 1) {
    const cell = summary.getCell(summaryTotalRow, column);
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.paleBlue } };
  }
  summary.getCell(summaryTotalRow, 7).numFmt = "0.000";
  for (const column of [8, 9, 10]) summary.getCell(summaryTotalRow, column).numFmt = "#,##0";
  summary.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: summaryHeaders.length } };
  summary.pageSetup.printArea = `A1:N${summaryTotalRow}`;
  applyBorders(summary, 6, summaryTotalRow, summaryHeaders.length);

  result.loads.forEach((load, loadIndex) => {
    const key = containerKey(load.spec.type, load.index);
    const sheetName = packingSheetByContainer.get(key)!;
    const info = containerInfo[key] ?? { containerNumber: "", sealNumber: "" };
    const tareWeightKg = tareWeightFor(result, key, tareWeights);
    const netWeightKg = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);
    const totalM3 = load.placements.reduce((sum, placement) => sum + placement.piece.m3, 0);
    const summaryRowNumber = loadIndex + 7;
    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 8, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.mergeCells("A1:L1");
    sheet.getCell("A1").value = `${containerLabel(load)} パッキングリスト`;
    styleTitle(sheet.getRow(1));
    sheet.mergeCells("A2:L2");
    sheet.getCell("A2").value = "コンテナ番号・Seal番号・Tareの変更は「コンテナ集計」シートで行ってください。";
    sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.paleGray } };
    sheet.getCell("A2").alignment = { vertical: "middle" };
    const metadata = [
      ["コンテナ番号", { formula: `'コンテナ集計'!C${summaryRowNumber}`, result: safeCell(info.containerNumber) }, "Seal番号", { formula: `'コンテナ集計'!D${summaryRowNumber}`, result: safeCell(info.sealNumber) }, "種別", load.spec.type],
      ["NET (kg)", netWeightKg, "Tare (kg)", { formula: `'コンテナ集計'!I${summaryRowNumber}`, result: tareWeightKg }, "Gross (kg)", { formula: "B4+F4", result: netWeightKg + tareWeightKg }],
      ["M³", totalM3, "個数", load.placements.length, "シート", sheetName],
    ];
    metadata.forEach((values, offset) => {
      const rowNumber = offset + 3;
      const row = sheet.getRow(rowNumber);
      row.values = [values[0], values[1], "", "", values[2], values[3], "", "", values[4], values[5], "", ""];
      sheet.mergeCells(rowNumber, 2, rowNumber, 4);
      sheet.mergeCells(rowNumber, 6, rowNumber, 8);
      sheet.mergeCells(rowNumber, 10, rowNumber, 12);
      for (const column of [1, 5, 9]) {
        const cell = sheet.getCell(rowNumber, column);
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.paleBlue } };
      }
      row.alignment = { vertical: "middle", wrapText: true };
      row.height = 24;
    });
    for (const cell of [sheet.getCell("B4"), sheet.getCell("F4"), sheet.getCell("J4")]) cell.numFmt = "#,##0";
    sheet.getCell("B5").numFmt = "0.000";
    setRestorationUrl(sheet, 7, 12);
    sheet.getRow(7).height = 42;

    const headers = ["配置No.", "貨物ID", "品名", "荷姿", "L (cm)", "W (cm)", "H (cm)", "GW (kg)", "M³", "積付け", "配置座標 (cm)", "OOG"];
    sheet.getRow(8).values = headers;
    styleHeader(sheet.getRow(8));
    sheet.columns.forEach((column, index) => {
      column.width = [10, 19, 28, 16, 11, 11, 11, 13, 12, 22, 28, 12][index];
    });
    load.placements.forEach((placement, index) => {
      const oog = result.oog_results.get(placement.piece.piece_id);
      const displayOog = oogDisplayMetrics(placement, load.spec, oog);
      const rowNumber = index + 9;
      const row = sheet.getRow(rowNumber);
      row.values = [
        index + 1,
        safeCell(placement.piece.piece_id),
        safeCell(placement.piece.desc),
        safeCell(placement.piece.package_text || "—"),
        placement.piece.L_cm,
        placement.piece.W_cm,
        placement.piece.H_cm,
        placement.piece.weight_kg,
        placement.piece.m3,
        placement.placed_z_cm > 0 ? `段積み（床上 ${placement.placed_z_cm.toFixed(0)}cm）` : "床置き",
        `x=${placement.placed_x_cm.toFixed(1)}, y=${placement.placed_y_cm.toFixed(1)}, z=${placement.placed_z_cm.toFixed(1)}`,
        oog?.oog_flag ? `OH ${displayOog.ohCm} / OW ${displayOog.owTotalCm}` : "",
      ];
      row.alignment = { vertical: "middle", wrapText: true };
      row.height = 28;
      for (const column of [5, 6, 7, 8]) sheet.getCell(rowNumber, column).numFmt = "#,##0.0";
      sheet.getCell(rowNumber, 9).numFmt = "0.000";
    });
    const totalRow = load.placements.length + 9;
    sheet.mergeCells(totalRow, 1, totalRow, 7);
    sheet.getCell(totalRow, 1).value = `${containerLabel(load)} 合計（${load.placements.length} PCS）`;
    sheet.getCell(totalRow, 1).alignment = { horizontal: "right", vertical: "middle" };
    if (load.placements.length) {
      sheet.getCell(totalRow, 8).value = { formula: `SUM(H9:H${totalRow - 1})`, result: netWeightKg };
      sheet.getCell(totalRow, 9).value = { formula: `SUM(I9:I${totalRow - 1})`, result: totalM3 };
    } else {
      sheet.getCell(totalRow, 8).value = 0;
      sheet.getCell(totalRow, 9).value = 0;
    }
    sheet.getCell(totalRow, 8).numFmt = "#,##0";
    sheet.getCell(totalRow, 9).numFmt = "0.000";
    for (let column = 1; column <= headers.length; column += 1) {
      const cell = sheet.getCell(totalRow, column);
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.paleBlue } };
    }
    sheet.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8, column: headers.length } };
    sheet.pageSetup.printArea = `A1:L${totalRow}`;
    applyBorders(sheet, 3, 5, 12);
    applyBorders(sheet, 7, totalRow, headers.length);
  });

  if (result.unplaced.length) {
    const sheet = workbook.addWorksheet("積載不可", {
      views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.mergeCells("A1:I1");
    sheet.getCell("A1").value = "積載不可・要確認貨物";
    styleTitle(sheet.getRow(1));
    const headers = ["貨物ID", "品名", "L (cm)", "W (cm)", "H (cm)", "重量 (kg)", "OOG", "推奨", "理由"];
    sheet.getRow(3).values = headers;
    styleHeader(sheet.getRow(3));
    sheet.columns.forEach((column, index) => {
      column.width = [20, 30, 12, 12, 12, 15, 12, 32, 42][index];
    });
    result.unplaced.forEach((piece, index) => {
      const oog = result.oog_results.get(piece.piece_id);
      const row = sheet.getRow(index + 4);
      row.values = [
        safeCell(piece.piece_id),
        safeCell(piece.desc),
        piece.L_cm,
        piece.W_cm,
        piece.H_cm,
        piece.weight_kg,
        oog?.oog_flag ? "対象" : "対象外",
        safeCell(result.breakbulk_piece_ids.includes(piece.piece_id) ? "在来船・個別輸送を要検討" : oog?.suggestion ?? ""),
        safeCell(result.special_reason_by_piece.get(piece.piece_id) ?? "指定条件で積載不可"),
      ];
      row.alignment = { vertical: "middle", wrapText: true };
      row.height = 34;
    });
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
    sheet.pageSetup.printArea = `A1:I${result.unplaced.length + 3}`;
    applyBorders(sheet, 3, result.unplaced.length + 3, headers.length);
  }

  return workbook;
};

export const exportExcelReport = async (
  result: PlanResult,
  tareWeights: ContainerTareWeights = {},
  containerInfo: ContainerExportInfoByKey = {},
  restorationUrl = "",
): Promise<void> => {
  const workbook = await buildExcelReportWorkbook(result, tareWeights, containerInfo, restorationUrl);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "container_loading_report.xlsx");
};

export const printPlan = (): void => window.print();
