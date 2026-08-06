import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "../domain/constants";
import { expandPieces } from "../domain/input";
import { ManualPlanner } from "./ManualPlanner";

describe("ManualPlanner", () => {
  it("縮尺配置エリア、未配置貨物、CLP作成操作を表示する", () => {
    const markup = renderToStaticMarkup(
      <ManualPlanner
        pieces={expandPieces(SAMPLE_CARGO.slice(0, 1))}
        specs={DEFAULT_CONTAINERS}
        counts={{ "40HC": 1 }}
        settings={DEFAULT_SETTINGS}
        onDraftChange={() => undefined}
        onGenerateResult={() => undefined}
      />,
    );

    expect(markup).toContain("手動バン詰めプラン");
    expect(markup).toContain("未配置貨物");
    expect(markup).toContain('role="application"');
    expect(markup).toContain("TRUCK SIDE · x=0");
    expect(markup).toContain("上から");
    expect(markup).toContain("横から");
    expect(markup).toContain("両方にチェックすると併記します");
    expect(markup.match(/type="checkbox"/gu)).toHaveLength(2);
    expect(markup).not.toContain('aria-label="側面図"');
    expect(markup).toContain("CLPリストを作成");
  });
});
