export type ContainerCategory = "STANDARD" | "SPECIAL";

export interface CargoRow {
  uid: string;
  id: string;
  desc: string;
  qty: number;
  L_cm: number;
  W_cm: number;
  H_cm: number;
  weight_kg: number;
  package_text: string;
  rotate_allowed: boolean;
  stackable: boolean;
  max_stack_load_kg: number | null;
  incompatible_with_ids: string;
}

export interface Piece {
  piece_id: string;
  orig_id: string;
  piece_no: number;
  desc: string;
  L_cm: number;
  W_cm: number;
  H_cm: number;
  weight_kg: number;
  m3: number;
  package_text: string;
  rotate_allowed: boolean;
  stackable: boolean;
  max_stack_load_kg: number | null;
  incompatible_with_ids: string;
}

export interface ContainerSpec {
  type: string;
  category: ContainerCategory;
  inner_L_cm: number;
  inner_W_cm: number;
  inner_H_cm: number;
  door_W_cm?: number;
  door_H_cm?: number;
  deck_L_cm?: number;
  deck_W_cm?: number;
  max_payload_kg: number;
  cost: number;
  tare_weight_kg: number;
}

export interface Orientation {
  L_cm: number;
  W_cm: number;
  H_cm: number;
  rotation_key: string;
}

export interface Placement {
  piece: Piece;
  container_type: string;
  container_category: ContainerCategory;
  container_index: number;
  placed_x_cm: number;
  placed_y_cm: number;
  placed_z_cm: number;
  orient_L_cm: number;
  orient_W_cm: number;
  orient_H_cm: number;
  rotation_key: string;
}

export interface ContainerLoad {
  spec: ContainerSpec;
  index: number;
  placements: Placement[];
}

export interface OogResult {
  oog_flag: boolean;
  oog_ref_type: string;
  over_L_cm: number;
  over_W_cm: number;
  over_H_cm: number;
  suggestion: string;
  chosen_orientation: Orientation;
  door_passable: boolean;
  door_check_applied: boolean;
  door_over_W_cm: number;
  door_over_H_cm: number;
  door_reason: string;
}

export interface BiasMetrics {
  bias_warn: boolean;
  bias_reason: string;
  offset_x_pct: number;
  offset_y_pct: number;
  front_rear_diff_pct: number;
  left_right_diff_pct: number;
}

export interface WeightAuditMetrics {
  total_weight_kg: number;
  gross_weight_kg: number;
  vehicle_limit_kg: number | null;
  vehicle_limit_ratio_pct: number;
  payload_limit_kg: number;
  payload_ratio_pct: number;
  concentration_top_n_ratio_pct: number;
  weight_alert: boolean;
  weight_alert_message: string;
}

export interface PlanningSettings {
  bias_threshold_pct: number;
  max_cg_offset_x_pct: number | null;
  max_cg_offset_y_pct: number | null;
  vehicle_gross_limit_kg: number | null;
  payload_near_threshold_pct: number;
  concentration_top_n: number;
  concentration_warn_threshold_pct: number;
}

export interface ContainerSubstitutionAssessment {
  source_type: string;
  target_type: string;
  feasible: boolean;
  reasons: string[];
}

export type PlanningMode = "estimate" | "validate" | "manual";

export interface PlanResult {
  mode: PlanningMode;
  placements: Placement[];
  loads: ContainerLoad[];
  unplaced: Piece[];
  oog_results: Map<string, OogResult>;
  bias_by_container: Map<string, BiasMetrics>;
  weight_audit_by_container: Map<string, WeightAuditMetrics>;
  special_reason_by_piece: Map<string, string>;
  decision_reasons: string[];
  breakbulk_piece_ids: string[];
  substitution_by_container: Map<string, ContainerSubstitutionAssessment>;
  requested_counts?: Record<string, number>;
}

export interface ContainerKpi {
  container_key: string;
  container_label: string;
  container_type: string;
  piece_count: number;
  total_ft: number;
  total_m3: number;
  total_gross_kg: number;
  max_single_gross_kg: number;
  payload_ratio_pct: number;
  volume_ratio_pct: number;
  bias_warn: boolean;
  weight_alert: boolean;
}

export interface ValidationIssue {
  row: number;
  field: keyof CargoRow | "row";
  message: string;
}

export type AppView = "planner" | "converter" | "containers" | "guide";

