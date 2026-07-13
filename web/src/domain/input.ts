import Papa from "papaparse";

import { CARGO_TEMPLATE_HEADERS, createUid } from "./constants";
import type { CargoRow, Piece, ValidationIssue } from "./types";
import { ceilCm, ceilM3 } from "./rounding";

const REQUIRED_FIELDS: (keyof CargoRow)[] = ["id", "desc", "qty", "L_cm", "W_cm", "H_cm", "weight_kg"];

const COLUMN_ALIASES: Record<string, keyof CargoRow> = {
  id: "id",
  itemid: "id",
  cargoid: "id",
  アイテム番号: "id",
  desc: "desc",
  cargoname: "desc",
  name: "desc",
  貨物名: "desc",
  qty: "qty",
  quantity: "qty",
  数量: "qty",
  l: "L_cm",
  lcm: "L_cm",
  length: "L_cm",
  長さcm: "L_cm",
  w: "W_cm",
  wcm: "W_cm",
  width: "W_cm",
  幅cm: "W_cm",
  h: "H_cm",
  hcm: "H_cm",
  height: "H_cm",
  高さcm: "H_cm",
  gross: "weight_kg",
  grosskg: "weight_kg",
  weight: "weight_kg",
  weightkg: "weight_kg",
  重量kg: "weight_kg",
  packagetext: "package_text",
  style: "package_text",
  package: "package_text",
  荷姿: "package_text",
  rotateallowed: "rotate_allowed",
  rotate: "rotate_allowed",
  回転可否truefalse: "rotate_allowed",
  stackable: "stackable",
  stack: "stackable",
  積み重ね可否truefalse: "stackable",
  maxstackloadkg: "max_stack_load_kg",
  maxstackload: "max_stack_load_kg",
  maxtopload: "max_stack_load_kg",
  上積み許容kg: "max_stack_load_kg",
  incompatiblewithids: "incompatible_with_ids",
  incompatibleids: "incompatible_with_ids",
  incompatible: "incompatible_with_ids",
  混載不可アイテム番号: "incompatible_with_ids",
};

const normalizeHeader = (value: string): string =>
  value
    .trim()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

const asText = (value: unknown): string => (value == null ? "" : String(value).trim());

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const normalized = asText(value).replace(/,/g, "");
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  const normalized = asText(value).toLowerCase();
  if (["true", "1", "yes", "y", "on", "可", "○"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off", "不可", "×"].includes(normalized)) return false;
  return fallback;
};

export const recordsToCargoRows = (records: Record<string, unknown>[]): CargoRow[] => {
  return records
    .map((record) => {
      const normalized: Partial<Record<keyof CargoRow, unknown>> = {};
      for (const [header, value] of Object.entries(record)) {
        const field = COLUMN_ALIASES[normalizeHeader(header)];
        if (field) normalized[field] = value;
      }

      if (!Object.values(normalized).some((value) => asText(value) !== "")) return null;

      const maxStackRaw = normalized.max_stack_load_kg;
      const maxStack = asText(maxStackRaw) === "" ? null : asNumber(maxStackRaw, Number.NaN);
      return {
        uid: createUid(),
        id: asText(normalized.id),
        desc: asText(normalized.desc),
        qty: asNumber(normalized.qty),
        L_cm: asNumber(normalized.L_cm),
        W_cm: asNumber(normalized.W_cm),
        H_cm: asNumber(normalized.H_cm),
        weight_kg: asNumber(normalized.weight_kg),
        package_text: asText(normalized.package_text),
        rotate_allowed: asBoolean(normalized.rotate_allowed, true),
        stackable: asBoolean(normalized.stackable, true),
        max_stack_load_kg: maxStack,
        incompatible_with_ids: asText(normalized.incompatible_with_ids),
      } satisfies CargoRow;
    })
    .filter((row): row is CargoRow => row !== null);
};

const parseDelimitedText = (text: string): CargoRow[] => {
  const result = Papa.parse<Record<string, unknown>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: text.includes("\t") ? "\t" : "",
    transformHeader: (header) => header.trim(),
  });
  if (result.errors.length) {
    const first = result.errors[0];
    throw new Error(`表データを読み取れませんでした（${first.message} / 行 ${(first.row ?? 0) + 1}）`);
  }
  return recordsToCargoRows(result.data);
};

export const parseCargoText = (text: string): CargoRow[] => {
  if (!text.trim()) throw new Error("貼り付けデータが空です。");
  const rows = parseDelimitedText(text);
  if (!rows.length) throw new Error("貨物データの行が見つかりませんでした。");
  return rows;
};

export const parseCargoFile = async (file: File): Promise<CargoRow[]> => {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") {
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) throw new Error("Excelファイルにシートがありません。");
    const headers = Array.from({ length: firstSheet.columnCount }, (_, index) => firstSheet.getCell(1, index + 1).text.trim());
    const records: Record<string, unknown>[] = [];
    firstSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        if (!header) return;
        const cell = row.getCell(index + 1);
        const value = cell.value;
        record[header] = typeof value === "object" && value != null && "result" in value ? value.result : value ?? "";
      });
      records.push(record);
    });
    const rows = recordsToCargoRows(records);
    if (!rows.length) throw new Error("Excelの先頭シートに貨物データがありません。");
    return rows;
  }
  return parseCargoText(await file.text());
};

export const validateCargoRows = (rows: CargoRow[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  rows.forEach((row, index) => {
    const rowNo = index + 1;
    for (const field of REQUIRED_FIELDS) {
      if ((field === "id" || field === "desc") && !String(row[field]).trim()) {
        issues.push({ row: rowNo, field, message: `${field}は必須です。` });
      }
    }
    if (row.id && seenIds.has(row.id)) {
      issues.push({ row: rowNo, field: "id", message: `id「${row.id}」が重複しています。` });
    }
    if (row.id) seenIds.add(row.id);
    if (!Number.isInteger(row.qty) || row.qty < 1 || row.qty > 10_000) {
      issues.push({ row: rowNo, field: "qty", message: "qtyは1〜10,000の整数で入力してください。" });
    }
    for (const field of ["L_cm", "W_cm", "H_cm"] as const) {
      const value = row[field];
      if (!Number.isFinite(value) || value <= 0 || value > 20_000) {
        issues.push({ row: rowNo, field, message: `${field}は0より大きく20,000cm以下で入力してください。` });
      }
    }
    if (!Number.isFinite(row.weight_kg) || row.weight_kg <= 0 || row.weight_kg > 100_000) {
      issues.push({ row: rowNo, field: "weight_kg", message: "weight_kgは0より大きく100,000kg以下で入力してください。" });
    }
    if (row.max_stack_load_kg != null && (!Number.isFinite(row.max_stack_load_kg) || row.max_stack_load_kg < 0)) {
      issues.push({ row: rowNo, field: "max_stack_load_kg", message: "上積み許容重量は0以上で入力してください。" });
    }
  });
  return issues;
};

export const expandPieces = (rows: CargoRow[]): Piece[] =>
  rows.flatMap((row) =>
    Array.from({ length: row.qty }, (_, index) => ({
      piece_id: `${row.id}#${index + 1}`,
      orig_id: row.id,
      piece_no: index + 1,
      desc: row.desc,
      L_cm: ceilCm(row.L_cm),
      W_cm: ceilCm(row.W_cm),
      H_cm: ceilCm(row.H_cm),
      weight_kg: row.weight_kg,
      m3: ceilM3((row.L_cm * row.W_cm * row.H_cm) / 1_000_000),
      package_text: row.package_text,
      rotate_allowed: row.rotate_allowed,
      stackable: row.stackable,
      max_stack_load_kg: row.max_stack_load_kg,
      incompatible_with_ids: row.incompatible_with_ids,
    })),
  );

export const downloadBlankTemplate = async (format: "csv" | "xlsx"): Promise<void> => {
  const rows = Array.from({ length: 150 }, (_, index) => {
    const row: Record<string, string | number> = {};
    CARGO_TEMPLATE_HEADERS.forEach((header, headerIndex) => {
      row[header] = headerIndex === 0 ? index + 1 : "";
    });
    return row;
  });
  if (format === "xlsx") {
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("cargo_template", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = CARGO_TEMPLATE_HEADERS.map((header, index) => ({ header, key: header, width: index === 1 ? 28 : 18 }));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF11324E" } };
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a"); link.href = url; link.download = "cargo_blank_form.xlsx"; link.click(); URL.revokeObjectURL(url);
    return;
  }
  const csv = `\uFEFF${Papa.unparse(rows, { columns: [...CARGO_TEMPLATE_HEADERS] })}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "cargo_blank_form.csv";
  link.click();
  URL.revokeObjectURL(url);
};
