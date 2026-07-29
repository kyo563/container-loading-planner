import { describe, expect, it } from "vitest";

import {
  containerSpecsForProfile,
  customContainerSpecsFromEffective,
  effectiveContainerSpecs,
  matchesContainerProfile,
  STANDARD_CONTAINER_PROFILE_ID,
} from "./containerProfiles";
import { DEFAULT_CONTAINERS } from "./constants";

describe("containerProfiles", () => {
  it("編集コンテナ未指定時は固定の基本マスターを採用する", () => {
    const specs = effectiveContainerSpecs([]);
    expect(specs).toEqual(DEFAULT_CONTAINERS);
    expect(specs).not.toBe(DEFAULT_CONTAINERS);
    expect(matchesContainerProfile(specs)).toBe(true);
  });

  it("SOCコンテナを基本マスターへ追加する", () => {
    const source = DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!;
    const soc = { ...source, type: "40HC-SOC", inner_H_cm: 271 };
    const specs = effectiveContainerSpecs([soc]);

    expect(specs).toHaveLength(DEFAULT_CONTAINERS.length + 1);
    expect(specs.at(-1)).toEqual(soc);
    expect(customContainerSpecsFromEffective(specs)).toEqual([soc]);
  });

  it("基本タイプと同名の編集値はプラン内だけ上書きする", () => {
    const original = DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")!;
    const override = { ...original, inner_H_cm: 275 };
    const specs = effectiveContainerSpecs([override]);

    expect(specs.find((spec) => spec.type === "40HC")).toEqual(override);
    expect(DEFAULT_CONTAINERS.find((spec) => spec.type === "40HC")).toEqual(original);
    expect(customContainerSpecsFromEffective(specs)).toEqual([override]);
  });

  it("標準定義の取得結果は呼び出しごとに複製する", () => {
    const first = containerSpecsForProfile(STANDARD_CONTAINER_PROFILE_ID);
    const second = containerSpecsForProfile(STANDARD_CONTAINER_PROFILE_ID);
    first[0].inner_L_cm = 1;

    expect(second[0].inner_L_cm).toBe(DEFAULT_CONTAINERS[0].inner_L_cm);
  });
});
