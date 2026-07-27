import Papa from "papaparse";

import { buildContainerKpis, containerLabel, summarizeCounts } from "./reporting";
import { containerKey } from "./planner";
import { oogDisplayMetrics } from "./oogDisplay";
import type { CargoRow, PlanResult } from "./types";

const safeCell = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
};

const safeRows = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
  rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])));

export const placementRows = (result: PlanResult): Record<string, unknown>[] =>
  result.loads.flatMap((load) => {
    const key = containerKey(load.spec.type, load.index);
    const bias = result.bias_by_container.get(key);
    const weight = result.weight_audit_by_container.get(key);
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
        container_gross_weight_kg: weight?.gross_weight_kg ?? 0,
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

export const exportPlacementsCsv = async (result: PlanResult): Promise<void> => {
  const csv = `\uFEFF${Papa.unparse(safeRows(placementRows(result)))}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "container_loading_plan.csv");
};

export const exportCargoCsv = async (rows: CargoRow[]): Promise<void> => {
  const output = rows.map(({ uid: _uid, ...row }) => row);
  const csv = `\uFEFF${Papa.unparse(safeRows(output))}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "cargo_input.csv");
};

export const exportExcelReport = async (result: PlanResult): Promise<void> => {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const counts = summarizeCounts(result);
  const summary = [
    ...Object.entries(counts).map(([type, count]) => ({ 区分: "コンテナ", 種別: type, 数量: count })),
    { 区分: "貨物", 種別: "積載済み", 数量: result.placements.length },
    { 区分: "貨物", 種別: "積載不可・要確認", 数量: result.unplaced.length },
  ];
  const kpis = buildContainerKpis(result).map((kpi) => ({
    コンテナ: kpi.container_label,
    種別: kpi.container_type,
    個数: kpi.piece_count,
    "F/T": kpi.total_ft,
    "M3": kpi.total_m3,
    "貨物重量(kg)": kpi.total_gross_kg,
    "最大単体重量(kg)": kpi.max_single_gross_kg,
    "容積使用率(%)": kpi.volume_ratio_pct,
    "Payload使用率(%)": kpi.payload_ratio_pct,
    偏荷重警告: kpi.bias_warn ? "要確認" : "なし",
    重量警告: kpi.weight_alert ? "要確認" : "なし",
  }));
  const placements = safeRows(placementRows(result));
  const loadingPlan = result.loads.flatMap((load) =>
    load.placements.map((placement, index) => {
      const oog = result.oog_results.get(placement.piece.piece_id);
      const displayOog = oogDisplayMetrics(placement, load.spec, oog);
      return ({
      コンテナ: containerLabel(load),
      手順: index + 1,
      貨物ID: placement.piece.piece_id,
      品名: safeCell(placement.piece.desc),
      配置指示: `x=${placement.placed_x_cm.toFixed(1)}cm, y=${placement.placed_y_cm.toFixed(1)}cm, z=${placement.placed_z_cm.toFixed(1)}cm`,
      OOG寸法: oog?.oog_flag ? `OH ${displayOog.ohCm}cm / OW total ${displayOog.owTotalCm}cm / left ${displayOog.owLeftCm}cm / right ${displayOog.owRightCm}cm` : "—",
    });}),
  );
  const unplaced = result.unplaced.map((piece) => {
    const oog = result.oog_results.get(piece.piece_id);
    return {
      貨物ID: piece.piece_id,
      品名: safeCell(piece.desc),
      "L(cm)": piece.L_cm,
      "W(cm)": piece.W_cm,
      "H(cm)": piece.H_cm,
      "重量(kg)": piece.weight_kg,
      OOG: oog?.oog_flag ? "対象" : "対象外",
      推奨: result.breakbulk_piece_ids.includes(piece.piece_id) ? "在来船・個別輸送を要検討" : oog?.suggestion ?? "",
      理由: result.special_reason_by_piece.get(piece.piece_id) ?? "指定条件で積載不可",
    };
  });
  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    const keys = rows.length ? Object.keys(rows[0]) : ["データ"];
    sheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(34, Math.max(12, key.length * 1.8)) }));
    sheet.addRows(rows);
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF11324E" } };
    header.alignment = { vertical: "middle" };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  };
  addSheet("Summary", summary);
  addSheet("ContainerKPI", kpis);
  addSheet("Placements", placements);
  addSheet("LoadingPlan", loadingPlan);
  addSheet("Unplaced", unplaced);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "container_loading_report.xlsx");
};

export const printPlan = (): void => window.print();
