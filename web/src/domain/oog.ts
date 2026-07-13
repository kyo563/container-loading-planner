import type { ContainerSpec, OogResult, Orientation, Piece } from "./types";
import { ceilCm } from "./rounding";

export const orientationsFor = (piece: Piece): Orientation[] => {
  if (!piece.rotate_allowed) {
    return [{ L_cm: piece.L_cm, W_cm: piece.W_cm, H_cm: piece.H_cm, rotation_key: "LWH" }];
  }
  const dims = [piece.L_cm, piece.W_cm, piece.H_cm];
  const permutations: [number, number, number, string][] = [
    [0, 1, 2, "LWH"],
    [0, 2, 1, "LHW"],
    [1, 0, 2, "WLH"],
    [1, 2, 0, "WHL"],
    [2, 0, 1, "HLW"],
    [2, 1, 0, "HWL"],
  ];
  const seen = new Set<string>();
  return permutations.flatMap(([a, b, c, key]) => {
    const values = [dims[a], dims[b], dims[c]];
    const signature = values.join("/");
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [{ L_cm: values[0], W_cm: values[1], H_cm: values[2], rotation_key: key }];
  });
};

export const evaluateOog = (piece: Piece, ref: ContainerSpec): OogResult => {
  const ranked = orientationsFor(piece)
    .map((orientation) => {
      const overL = Math.max(0, orientation.L_cm - ref.inner_L_cm);
      const overW = Math.max(0, orientation.W_cm - ref.inner_W_cm);
      const overH = Math.max(0, orientation.H_cm - ref.inner_H_cm);
      return { orientation, overL, overW, overH, score: overL + overW + overH };
    })
    .sort((a, b) => a.score - b.score);
  const best = ranked[0];
  const overL = ceilCm(best.overL);
  const overW = ceilCm(best.overW);
  const overH = ceilCm(best.overH);
  const doorCheck = ref.door_W_cm != null && ref.door_H_cm != null;
  let doorOverW = 0;
  let doorOverH = 0;
  if (doorCheck) {
    const doorBest = orientationsFor(piece)
      .map((orientation) => ({
        overW: Math.max(0, orientation.W_cm - (ref.door_W_cm ?? 0)),
        overH: Math.max(0, orientation.H_cm - (ref.door_H_cm ?? 0)),
      }))
      .sort((a, b) => a.overW + a.overH - (b.overW + b.overH))[0];
    doorOverW = ceilCm(doorBest.overW);
    doorOverH = ceilCm(doorBest.overH);
  }
  const doorReasons = [];
  if (doorOverW > 0) doorReasons.push(`入口幅超過 ${doorOverW}cm`);
  if (doorOverH > 0) doorReasons.push(`入口高さ超過 ${doorOverH}cm`);
  return {
    oog_flag: overL > 0 || overW > 0 || overH > 0,
    oog_ref_type: ref.type,
    over_L_cm: overL,
    over_W_cm: overW,
    over_H_cm: overH,
    suggestion: overL > 0 || overW > 0 ? "FR" : overH > 0 ? "OT" : "",
    chosen_orientation: best.orientation,
    door_passable: doorOverW === 0 && doorOverH === 0,
    door_check_applied: doorCheck,
    door_over_W_cm: doorOverW,
    door_over_H_cm: doorOverH,
    door_reason: doorReasons.join(" / "),
  };
};

const RF_KEYWORDS = ["reefer", "refrigerated", "frozen", "cold", "冷凍", "冷蔵", "要冷", "rf"];

export const requiresReefer = (piece: Piece): boolean => {
  const target = `${piece.desc} ${piece.package_text}`.toLowerCase();
  return RF_KEYWORDS.some((keyword) => target.includes(keyword));
};

export const isBreakbulkRequired = (piece: Piece, fortyFr?: ContainerSpec): boolean => {
  const deckLength = fortyFr?.deck_L_cm ?? 1160;
  const payload = fortyFr?.max_payload_kg ?? 34_000;
  const footprintFits = piece.L_cm <= deckLength || piece.W_cm <= deckLength;
  return !footprintFits || piece.weight_kg > payload;
};

const FR_MIN_FOOTPRINT_M2 = 2;
const FR_MIN_VOLUME_M3 = 2;
const FR_MIN_WEIGHT_KG = 2_000;

export const isFrCargoSubstantial = (piece: Piece): boolean => {
  const largestFootprintM2 = Math.max(
    piece.L_cm * piece.W_cm,
    piece.L_cm * piece.H_cm,
    piece.W_cm * piece.H_cm,
  ) / 10_000;
  return largestFootprintM2 >= FR_MIN_FOOTPRINT_M2 || piece.m3 >= FR_MIN_VOLUME_M3 || piece.weight_kg >= FR_MIN_WEIGHT_KG;
};
