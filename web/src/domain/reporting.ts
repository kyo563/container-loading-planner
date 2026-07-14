import type { ContainerKpi, ContainerLoad, Piece, PlanResult } from "./types";
import { containerKey } from "./planner";

const CIRCLED = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];

export const containerLabel = (load: ContainerLoad): string =>
  `${load.spec.type} ${CIRCLED[load.index] ?? load.index}`;

export const buildContainerKpis = (result: PlanResult): ContainerKpi[] =>
  result.loads.map((load) => {
    const key = containerKey(load.spec.type, load.index);
    const totalM3 = load.placements.reduce((sum, placement) => sum + placement.piece.m3, 0);
    const totalWeight = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);
    const maxWeight = Math.max(...load.placements.map((placement) => placement.piece.weight_kg), 0);
    const capacityM3 = (load.spec.inner_L_cm * load.spec.inner_W_cm * load.spec.inner_H_cm) / 1_000_000;
    const weightAudit = result.weight_audit_by_container.get(key);
    const bias = result.bias_by_container.get(key);
    return {
      container_key: key,
      container_label: containerLabel(load),
      container_type: load.spec.type,
      piece_count: load.placements.length,
      total_ft: Math.max(totalWeight / 1000, totalM3),
      total_m3: totalM3,
      total_gross_kg: totalWeight,
      max_single_gross_kg: maxWeight,
      payload_ratio_pct: weightAudit?.payload_ratio_pct ?? 0,
      volume_ratio_pct: capacityM3 > 0 ? (totalM3 / capacityM3) * 100 : 0,
      bias_warn: bias?.bias_warn ?? false,
      weight_alert: weightAudit?.weight_alert ?? false,
    };
  });

export const summarizeCounts = (result: PlanResult): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const load of result.loads) counts[load.spec.type] = (counts[load.spec.type] ?? 0) + 1;
  return counts;
};

export interface PackingListItem {
  position: number;
  piece: Piece;
  placedZCm: number;
}

export interface ContainerPackingList {
  containerKey: string;
  containerLabel: string;
  pieceCount: number;
  totalWeightKg: number;
  totalM3: number;
  items: PackingListItem[];
}

export const buildContainerPackingLists = (result: PlanResult): ContainerPackingList[] => result.loads.map((load) => ({
  containerKey: containerKey(load.spec.type, load.index),
  containerLabel: containerLabel(load),
  pieceCount: load.placements.length,
  totalWeightKg: load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0),
  totalM3: load.placements.reduce((sum, placement) => sum + placement.piece.m3, 0),
  items: load.placements.map((placement, index) => ({ position: index + 1, piece: placement.piece, placedZCm: placement.placed_z_cm })),
}));
