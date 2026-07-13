import type { ContainerLoad, Placement } from "./types";

const MAX_LABEL_FONT_SIZE = 22;
const MIN_FULL_LABEL_FONT_SIZE = 7;
const MIN_COMPACT_LABEL_FONT_SIZE = 5;
const CHARACTER_WIDTH_RATIO = 0.62;
const HORIZONTAL_PADDING_CM = 6;
const VERTICAL_PADDING_CM = 4;

export interface PlacementLabel {
  text: string;
  fontSize: number;
  compact: boolean;
}

export interface LayoutLegend {
  code: string;
  origId: string;
  pieceRange: string;
  count: number;
}

const groupCode = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : `G${index + 1}`;

const fittingFontSize = (text: string, placement: Placement, minimum: number): number | null => {
  const availableWidth = Math.max(0, placement.orient_L_cm - HORIZONTAL_PADDING_CM);
  const availableHeight = Math.max(0, placement.orient_W_cm - VERTICAL_PADDING_CM);
  const byWidth = availableWidth / Math.max(text.length * CHARACTER_WIDTH_RATIO, 1);
  const size = Math.min(MAX_LABEL_FONT_SIZE, availableHeight, byWidth);
  return size >= minimum ? size : null;
};

const compactRanges = (numbers: number[]): string => {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let start = 0; start < unique.length;) {
    let end = start;
    while (end + 1 < unique.length && unique[end + 1] === unique[end] + 1) end += 1;
    ranges.push(start === end ? `#${unique[start]}` : `#${unique[start]}–#${unique[end]}`);
    start = end + 1;
  }
  return ranges.join("、");
};

export const buildLayoutLabels = (load: ContainerLoad): { labels: Map<string, PlacementLabel>; legends: LayoutLegend[] } => {
  const groupOrder = [...new Set(load.placements.map((placement) => placement.piece.orig_id))];
  const codeByGroup = new Map(groupOrder.map((origId, index) => [origId, groupCode(index)]));
  const labels = new Map<string, PlacementLabel>();
  const compactGroups = new Set<string>();

  for (const placement of load.placements) {
    const fullText = placement.piece.piece_id;
    const fullSize = fittingFontSize(fullText, placement, MIN_FULL_LABEL_FONT_SIZE);
    if (fullSize != null) {
      labels.set(fullText, { text: fullText, fontSize: fullSize, compact: false });
      continue;
    }

    const code = codeByGroup.get(placement.piece.orig_id) ?? "?";
    const compactText = `${code}${placement.piece.piece_no}`;
    const compactSize = fittingFontSize(compactText, placement, MIN_COMPACT_LABEL_FONT_SIZE);
    const numberText = String(placement.piece.piece_no);
    const numberSize = fittingFontSize(numberText, placement, MIN_COMPACT_LABEL_FONT_SIZE);
    labels.set(fullText, {
      text: compactSize != null ? compactText : numberSize != null ? numberText : "•",
      fontSize: compactSize ?? numberSize ?? MIN_COMPACT_LABEL_FONT_SIZE,
      compact: true,
    });
    compactGroups.add(placement.piece.orig_id);
  }

  const legends = groupOrder.filter((origId) => compactGroups.has(origId)).map((origId) => {
    const pieces = load.placements.filter((placement) => placement.piece.orig_id === origId).map((placement) => placement.piece);
    return {
      code: codeByGroup.get(origId) ?? "?",
      origId,
      pieceRange: compactRanges(pieces.map((piece) => piece.piece_no)),
      count: pieces.length,
    };
  });
  return { labels, legends };
};
