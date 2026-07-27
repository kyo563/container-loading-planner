import type { ContainerLoad, Placement } from "./types";

const MAX_LABEL_FONT_SIZE = 22;
const MIN_FULL_LABEL_FONT_SIZE = 7;
const MIN_COMPACT_LABEL_FONT_SIZE = 5;
const CHARACTER_WIDTH_RATIO = 0.62;
const HORIZONTAL_PADDING_CM = 6;
const VERTICAL_PADDING_CM = 4;
const STACK_POSITION_PRECISION = 3;
const STACK_ADJACENCY_TOLERANCE_CM = 0.1;

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

export interface LayoutStackGroup {
  key: string;
  origId: string;
  pieceIds: string[];
  pieceRange: string;
  tierCount: number;
  columnCount: number;
  pieceCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StackColumn {
  origId: string;
  placements: Placement[];
  tierCount: number;
  baseZ: number;
  x: number;
  y: number;
  width: number;
  height: number;
  tierHeight: number;
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

const positionKey = (value: number): string => value.toFixed(STACK_POSITION_PRECISION);
const overlaps = (firstStart: number, firstLength: number, secondStart: number, secondLength: number): boolean =>
  Math.min(firstStart + firstLength, secondStart + secondLength)
    - Math.max(firstStart, secondStart) > STACK_ADJACENCY_TOLERANCE_CM;

const columnsAreAdjacent = (first: StackColumn, second: StackColumn): boolean => {
  const xTouches = Math.abs(first.x + first.width - second.x) <= STACK_ADJACENCY_TOLERANCE_CM
    || Math.abs(second.x + second.width - first.x) <= STACK_ADJACENCY_TOLERANCE_CM;
  const yTouches = Math.abs(first.y + first.height - second.y) <= STACK_ADJACENCY_TOLERANCE_CM
    || Math.abs(second.y + second.height - first.y) <= STACK_ADJACENCY_TOLERANCE_CM;
  return (xTouches && overlaps(first.y, first.height, second.y, second.height))
    || (yTouches && overlaps(first.x, first.width, second.x, second.width));
};

export const buildLayoutStackGroups = (placements: Placement[]): LayoutStackGroup[] => {
  const columnPlacements = new Map<string, Placement[]>();
  for (const placement of placements) {
    const key = [
      placement.piece.orig_id,
      positionKey(placement.placed_x_cm),
      positionKey(placement.placed_y_cm),
      positionKey(placement.orient_L_cm),
      positionKey(placement.orient_W_cm),
      positionKey(placement.orient_H_cm),
    ].join("|");
    columnPlacements.set(key, [...(columnPlacements.get(key) ?? []), placement]);
  }

  const columns: StackColumn[] = [...columnPlacements.values()].flatMap((column) => {
    const sorted = [...column].sort((left, right) => left.placed_z_cm - right.placed_z_cm);
    if (sorted.length < 2) return [];
    const contiguous = sorted.every((placement, index) =>
      index === 0
      || Math.abs(placement.placed_z_cm
        - (sorted[index - 1].placed_z_cm + sorted[index - 1].orient_H_cm)) <= STACK_ADJACENCY_TOLERANCE_CM);
    if (!contiguous) return [];
    const bottom = sorted[0];
    return [{
      origId: bottom.piece.orig_id,
      placements: sorted,
      tierCount: sorted.length,
      baseZ: bottom.placed_z_cm,
      x: bottom.placed_x_cm,
      y: bottom.placed_y_cm,
      width: bottom.orient_L_cm,
      height: bottom.orient_W_cm,
      tierHeight: bottom.orient_H_cm,
    }];
  });

  const comparableColumns = new Map<string, StackColumn[]>();
  for (const column of columns) {
    const key = [
      column.origId,
      column.tierCount,
      positionKey(column.baseZ),
      positionKey(column.width),
      positionKey(column.height),
      positionKey(column.tierHeight),
    ].join("|");
    comparableColumns.set(key, [...(comparableColumns.get(key) ?? []), column]);
  }

  const groups: LayoutStackGroup[] = [];
  for (const comparable of comparableColumns.values()) {
    const remaining = new Set(comparable);
    while (remaining.size) {
      const first = remaining.values().next().value as StackColumn;
      remaining.delete(first);
      const component = [first];
      for (let index = 0; index < component.length; index += 1) {
        for (const candidate of [...remaining]) {
          if (!columnsAreAdjacent(component[index], candidate)) continue;
          remaining.delete(candidate);
          component.push(candidate);
        }
      }
      const pieces = component.flatMap((column) => column.placements.map((placement) => placement.piece));
      const minX = Math.min(...component.map((column) => column.x));
      const minY = Math.min(...component.map((column) => column.y));
      const maxX = Math.max(...component.map((column) => column.x + column.width));
      const maxY = Math.max(...component.map((column) => column.y + column.height));
      groups.push({
        key: component.flatMap((column) => column.placements.map((placement) => placement.piece.piece_id)).join("|"),
        origId: first.origId,
        pieceIds: pieces.map((piece) => piece.piece_id),
        pieceRange: compactRanges(pieces.map((piece) => piece.piece_no)),
        tierCount: first.tierCount,
        columnCount: component.length,
        pieceCount: pieces.length,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      });
    }
  }
  return groups;
};

export const buildLayoutLabels = (load: ContainerLoad): {
  labels: Map<string, PlacementLabel>;
  legends: LayoutLegend[];
  stackGroups: LayoutStackGroup[];
} => {
  const groupOrder = [...new Set(load.placements.map((placement) => placement.piece.orig_id))];
  const codeByGroup = new Map(groupOrder.map((origId, index) => [origId, groupCode(index)]));
  const labels = new Map<string, PlacementLabel>();
  const compactGroups = new Set<string>();
  const compactPieceIds = new Set<string>();
  const stackGroups = buildLayoutStackGroups(load.placements);
  const groupedPieceIds = new Set(stackGroups.flatMap((group) => group.pieceIds));

  for (const placement of load.placements) {
    const fullText = placement.piece.piece_id;
    if (groupedPieceIds.has(fullText)) continue;
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
    compactPieceIds.add(fullText);
  }

  const legends = groupOrder.filter((origId) => compactGroups.has(origId)).map((origId) => {
    const pieces = load.placements
      .filter((placement) => placement.piece.orig_id === origId && compactPieceIds.has(placement.piece.piece_id))
      .map((placement) => placement.piece);
    return {
      code: codeByGroup.get(origId) ?? "?",
      origId,
      pieceRange: compactRanges(pieces.map((piece) => piece.piece_no)),
      count: pieces.length,
    };
  });
  return { labels, legends, stackGroups };
};
