import type { ContainerSpec, OogResult, Placement } from "./types";

export interface OogDisplayMetrics {
  ohCm: number;
  owTotalCm: number;
  owEachCm: number;
  owLeftCm: number;
  owRightCm: number;
  referenceWidthCm: number;
  referenceHeightCm: number;
}

export const oogDisplayMetrics = (
  placement: Placement,
  spec: ContainerSpec,
  oog?: OogResult,
): OogDisplayMetrics => {
  const referenceWidth = spec.type.endsWith("FR") ? (spec.deck_W_cm ?? spec.inner_W_cm) : spec.inner_W_cm;
  const owLeftCm = Math.max(0, -placement.placed_y_cm);
  const owRightCm = Math.max(0, placement.placed_y_cm + placement.orient_W_cm - referenceWidth);
  const owTotalCm = owLeftCm + owRightCm;
  return {
    ohCm: Math.max(0, oog?.over_H_cm ?? (placement.placed_z_cm + placement.orient_H_cm - spec.inner_H_cm)),
    owTotalCm,
    owEachCm: owTotalCm / 2,
    owLeftCm,
    owRightCm,
    referenceWidthCm: referenceWidth,
    referenceHeightCm: spec.inner_H_cm,
  };
};
