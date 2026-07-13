import type { ContainerSpec, OogResult, Placement } from "./types";

export interface OogDisplayMetrics {
  ohCm: number;
  owTotalCm: number;
  owEachCm: number;
}

export const oogDisplayMetrics = (
  placement: Placement,
  spec: ContainerSpec,
  oog?: OogResult,
): OogDisplayMetrics => {
  const referenceWidth = spec.type.endsWith("FR") ? (spec.deck_W_cm ?? spec.inner_W_cm) : spec.inner_W_cm;
  const owTotalCm = Math.max(0, placement.orient_W_cm - referenceWidth);
  return {
    ohCm: oog?.over_H_cm ?? 0,
    owTotalCm,
    owEachCm: owTotalCm / 2,
  };
};
