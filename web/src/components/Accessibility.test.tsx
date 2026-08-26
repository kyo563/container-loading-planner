import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS } from "../domain/constants";
import { CargoInput, retainExistingSelection } from "./CargoInput";
import { Header } from "./Header";
import { PlanSettings } from "./PlanSettings";

describe("主要操作のアクセシビリティ", () => {
  it("モバイルで文字が非表示になってもヘッダー操作名を保持する", () => {
    const markup = renderToStaticMarkup(
      <Header current="planner" onNavigate={() => undefined} onScanPlan={() => undefined} onNewPlan={() => undefined} />,
    );

    expect(markup).toContain('aria-label="新規プラン"');
    expect(markup).toContain('aria-label="QR読込"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("データは端末内で処理");
  });

  it("計算モードをラジオ選択として公開する", () => {
    const markup = renderToStaticMarkup(
      <PlanSettings
        mode="estimate"
        onModeChange={() => undefined}
        specs={DEFAULT_CONTAINERS}
        counts={{ "40HC": 1 }}
        onCountsChange={() => undefined}
        settings={DEFAULT_SETTINGS}
        onSettingsChange={() => undefined}
      />,
    );

    expect(markup.match(/role="radio"/gu)).toHaveLength(3);
    expect(markup).toContain('role="radio" aria-checked="true"');
    expect(markup).toContain('role="radio" aria-checked="false"');
    expect(markup).toContain("手動でバン詰めする");
  });

  it("貨物データの差し替え時に存在しない行の選択を残さない", () => {
    const selected = new Set(["row-a", "removed"]);
    const retained = retainExistingSelection(selected, [{ uid: "row-a" }, { uid: "row-b" }]);

    expect([...retained]).toEqual(["row-a"]);
  });

  it("貨物入力は空の状態でもサーバー描画できる", () => {
    const markup = renderToStaticMarkup(
      <CargoInput rows={[]} issues={[]} onChange={() => undefined} isSample={false} />,
    );

    expect(markup).toContain("貨物データがありません");
  });
});
