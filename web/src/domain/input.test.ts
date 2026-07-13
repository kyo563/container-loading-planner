import { describe, expect, it } from "vitest";

import { expandPieces, parseCargoText, validateCargoRows } from "./input";

describe("貨物入力", () => {
  it("日本語ヘッダーとExcel貼り付け形式を読み取る", () => {
    const rows = parseCargoText(
      "アイテム番号\t貨物名\t数量\t長さ(cm)\t幅(cm)\t高さ(cm)\t重量(kg)\t荷姿\nA001\t機械\t2\t120.2\t80\t90\t500\t木箱",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("A001");
    expect(expandPieces(rows)).toHaveLength(2);
    expect(expandPieces(rows)[0].L_cm).toBe(121);
  });

  it("重複IDと不正な数値を具体的に報告する", () => {
    const rows = parseCargoText(
      "id,desc,qty,L,W,H,gross\nA001,One,1,100,100,100,10\nA001,Two,0,100,100,100,10",
    );
    const issues = validateCargoRows(rows);
    expect(issues.some((issue) => issue.message.includes("重複"))).toBe(true);
    expect(issues.some((issue) => issue.field === "qty")).toBe(true);
  });
});

