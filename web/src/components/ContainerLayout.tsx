import { useId } from "react";

import { buildLayoutLabels } from "../domain/layoutLabels";
import { oogDisplayMetrics } from "../domain/oogDisplay";
import type { ContainerLoad, ContainerSpec, OogResult, Placement } from "../domain/types";
import { cargoCenterOfGravity } from "../domain/weightBalance";

const OOG_ANNOTATION_FONT_RATIO = 0.018;
const OOG_ANNOTATION_MIN_FONT_SIZE = 14;
const MAX_RENDERED_WIDTH_OVERHANG_RATIO = 0.3;
const WIDTH_TRUNCATION_TOLERANCE_CM = 0.1;
const LAYOUT_VERTICAL_PADDING_RATIO = 0.14;
const LAYOUT_HEADER_OFFSET_RATIO = 0.55;
const STACK_ANNOTATION_MIN_FONT_SIZE = 7;
const STACK_ANNOTATION_MAX_FONT_SIZE = 16;
const STACK_ANNOTATION_HEIGHT_RATIO = 0.3;
const STACK_ANNOTATION_CHARACTER_WIDTH_RATIO = 0.62;
const STACK_ANNOTATION_HORIZONTAL_PADDING_CM = 12;
const STACK_ANNOTATION_VERTICAL_PADDING_RATIO = 1.8;
const CENTER_OF_GRAVITY_MARKER_RATIO = 0.012;
const CENTER_OF_GRAVITY_MARKER_MIN_CM = 8;
const CENTER_OF_GRAVITY_MARKER_MAX_CM = 18;

const colorFor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = value.charCodeAt(index) + ((hash << 5) - hash);
  const palette = ["#33b7a4", "#e1a84b", "#5c8ee6", "#d66f83", "#8c72d7", "#4ea36b", "#df7b45", "#4a9fbd"];
  return palette[Math.abs(hash) % palette.length];
};

interface ContainerLayoutProps {
  load: ContainerLoad;
  oogResults?: Map<string, OogResult>;
}

interface WidthOverhangBand {
  side: "left" | "right";
  y: number;
  height: number;
  overhangCm: number;
}

export interface WidthDisplayProjection {
  referenceWidthCm: number;
  maxDisplayedOverhangCm: number;
  y: number;
  height: number;
  leftTruncated: boolean;
  rightTruncated: boolean;
}

const referenceWidthFor = (spec: ContainerSpec): number =>
  spec.type.endsWith("FR") ? (spec.deck_W_cm ?? spec.inner_W_cm) : spec.inner_W_cm;

export const widthOverhangBands = (placement: Placement, spec: ContainerSpec): WidthOverhangBand[] => {
  const referenceWidth = referenceWidthFor(spec);
  const leftCm = Math.max(0, -placement.placed_y_cm);
  const rightCm = Math.max(0, placement.placed_y_cm + placement.orient_W_cm - referenceWidth);
  const bands: WidthOverhangBand[] = [];
  if (leftCm > 0) {
    bands.push({
      side: "left",
      y: placement.placed_y_cm,
      height: leftCm,
      overhangCm: leftCm,
    });
  }
  if (rightCm > 0) {
    bands.push({
      side: "right",
      y: referenceWidth,
      height: rightCm,
      overhangCm: rightCm,
    });
  }
  return bands;
};

export const widthDisplayProjection = (placement: Placement, spec: ContainerSpec): WidthDisplayProjection => {
  const referenceWidthCm = referenceWidthFor(spec);
  const maxDisplayedOverhangCm = referenceWidthCm * MAX_RENDERED_WIDTH_OVERHANG_RATIO;
  const actualStart = placement.placed_y_cm;
  const actualEnd = placement.placed_y_cm + placement.orient_W_cm;
  const leftOverhangCm = Math.max(0, -actualStart);
  const rightOverhangCm = Math.max(0, actualEnd - referenceWidthCm);
  const displayStart = Math.max(actualStart, -maxDisplayedOverhangCm);
  const displayEnd = Math.min(actualEnd, referenceWidthCm + maxDisplayedOverhangCm);
  return {
    referenceWidthCm,
    maxDisplayedOverhangCm,
    y: displayStart,
    height: Math.max(0, displayEnd - displayStart),
    leftTruncated: leftOverhangCm > maxDisplayedOverhangCm + WIDTH_TRUNCATION_TOLERANCE_CM,
    rightTruncated: rightOverhangCm > maxDisplayedOverhangCm + WIDTH_TRUNCATION_TOLERANCE_CM,
  };
};

export function ContainerLayout({ load, oogResults }: ContainerLayoutProps) {
  const patternPrefix = useId().replaceAll(":", "");
  const gridPatternId = `${patternPrefix}-grid`;
  const overhangPatternId = `${patternPrefix}-ow`;
  const dimensionArrowId = `${patternPrefix}-dimension-arrow`;
  const { labels, legends, stackGroups } = buildLayoutLabels(load);
  const widthProjections = new Map(load.placements.map((placement) => [
    placement.piece.piece_id,
    widthDisplayProjection(placement, load.spec),
  ]));
  const centerOfGravity = cargoCenterOfGravity(load);
  const centerOfGravityMarkerRadius = Math.max(
    CENTER_OF_GRAVITY_MARKER_MIN_CM,
    Math.min(CENTER_OF_GRAVITY_MARKER_MAX_CM, load.spec.inner_L_cm * CENTER_OF_GRAVITY_MARKER_RATIO),
  );
  const hasTruncatedWidth = [...widthProjections.values()]
    .some((projection) => projection.leftTruncated || projection.rightTruncated);
  const minWidth = Math.min(0, ...[...widthProjections.values()].map((projection) => projection.y));
  const maxWidth = Math.max(
    load.spec.inner_W_cm,
    ...[...widthProjections.values()].map((projection) => projection.y + projection.height),
  );
  const paddingX = load.spec.inner_L_cm * 0.025;
  const drawingWidth = maxWidth - minWidth;
  const paddingY = drawingWidth * LAYOUT_VERTICAL_PADDING_RATIO;
  const annotationFontSize = Math.max(OOG_ANNOTATION_MIN_FONT_SIZE, load.spec.inner_L_cm * OOG_ANNOTATION_FONT_RATIO);
  const formatCm = (value: number): string => Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  const viewBox = `${-paddingX} ${minWidth - paddingY} ${load.spec.inner_L_cm + paddingX * 2} ${drawingWidth + paddingY * 2}`;
  return (
    <figure className="container-layout-figure">
    <svg className="container-layout" viewBox={viewBox} role="img" aria-label={`${load.spec.type}の上面配置図`}>
      <defs>
        <pattern id={gridPatternId} width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(45,70,91,.12)" strokeWidth="1" />
        </pattern>
        <pattern id={overhangPatternId} width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="#f1a43c" fillOpacity=".58" />
          <path d="M -3 3 L 3 -3 M 0 14 L 14 0 M 11 17 L 17 11" fill="none" stroke="#8b4d08" strokeOpacity=".72" strokeWidth="2" />
        </pattern>
        <marker id={dimensionArrowId} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 5 L 10 0 L 10 10 Z" fill="#7b3106" />
        </marker>
      </defs>
      <rect x="0" y="0" width={load.spec.inner_L_cm} height={load.spec.inner_W_cm} rx="9" fill="#f7fafc" />
      <rect x="0" y="0" width={load.spec.inner_L_cm} height={load.spec.inner_W_cm} rx="9" fill={`url(#${gridPatternId})`} />
      <line x1={load.spec.inner_L_cm / 2} y1="0" x2={load.spec.inner_L_cm / 2} y2={load.spec.inner_W_cm} stroke="#17324a" strokeDasharray="12 9" strokeOpacity=".3" strokeWidth="2" />
      <line x1="0" y1={load.spec.inner_W_cm / 2} x2={load.spec.inner_L_cm} y2={load.spec.inner_W_cm / 2} stroke="#17324a" strokeDasharray="12 9" strokeOpacity=".3" strokeWidth="2" />
      {load.placements.map((placement) => {
        const color = colorFor(placement.piece.orig_id);
        const label = labels.get(placement.piece.piece_id);
        const overhangBands = widthOverhangBands(placement, load.spec);
        const widthProjection = widthProjections.get(placement.piece.piece_id)!;
        const oogMetrics = oogDisplayMetrics(placement, load.spec, oogResults?.get(placement.piece.piece_id));
        const dimensionLineX = placement.placed_x_cm + Math.min(placement.orient_L_cm * 0.12, annotationFontSize * 4);
        const heightBadgeWidth = annotationFontSize * 7.2;
        const heightBadgeHeight = annotationFontSize * 1.75;
        const heightBadgeX = Math.max(
          placement.placed_x_cm + annotationFontSize * 0.35,
          placement.placed_x_cm + placement.orient_L_cm - heightBadgeWidth - annotationFontSize * 0.35,
        );
        const heightBadgeY = Math.max(
          widthProjection.y + annotationFontSize * 0.35,
          Math.min(
            placement.placed_y_cm + annotationFontSize * 0.35,
            widthProjection.y + widthProjection.height - heightBadgeHeight - annotationFontSize * 0.35,
          ),
        );
        const oogDescription = [
          oogMetrics.owTotalCm > 0
            ? `OW合計${formatCm(oogMetrics.owTotalCm)}cm（左${formatCm(oogMetrics.owLeftCm)}cm、右${formatCm(oogMetrics.owRightCm)}cm）`
            : "",
          oogMetrics.ohCm > 0 ? `OH ${formatCm(oogMetrics.ohCm)}cm` : "",
        ].filter(Boolean).join(" / ");
        return (
          <g key={placement.piece.piece_id}>
            <rect
              className="cargo-placement"
              x={placement.placed_x_cm}
              y={widthProjection.y}
              width={placement.orient_L_cm}
              height={widthProjection.height}
              rx="5"
              fill={color}
              fillOpacity={placement.placed_z_cm > 0 ? 0.64 : 0.86}
              stroke="#fff"
              strokeWidth="3"
            >
              <title>{`${placement.piece.piece_id} ${placement.piece.desc}\n${placement.orient_L_cm}×${placement.orient_W_cm}×${placement.orient_H_cm}cm / ${placement.piece.weight_kg}kg\nz=${placement.placed_z_cm}cm${oogDescription ? `\n${oogDescription}` : ""}`}</title>
            </rect>
            {overhangBands.map((band) => {
              const displayedHeight = Math.min(band.height, widthProjection.maxDisplayedOverhangCm);
              const displayedY = band.side === "left"
                ? -displayedHeight
                : widthProjection.referenceWidthCm;
              const lineStartY = displayedY;
              const lineEndY = band.side === "left"
                ? 0
                : displayedY + displayedHeight;
              const labelY = (lineStartY + lineEndY) / 2;
              const sideLabel = band.side === "left" ? "左" : "右";
              const truncated = band.side === "left"
                ? widthProjection.leftTruncated
                : widthProjection.rightTruncated;
              const breakY = band.side === "left" ? displayedY : displayedY + displayedHeight;
              return (
                <g
                  key={band.side}
                  className="cargo-width-overhang-annotation"
                  aria-label={truncated ? `OW ${band.side} drawing truncated` : undefined}
                  pointerEvents="none"
                >
                  <rect
                    className="cargo-width-overhang"
                    x={placement.placed_x_cm}
                    y={displayedY}
                    width={placement.orient_L_cm}
                    height={displayedHeight}
                    fill={`url(#${overhangPatternId})`}
                    stroke="#8b4d08"
                    strokeWidth="2"
                    aria-label={`OW ${band.side} ${band.overhangCm}cm`}
                  />
                  <line
                    className="oog-dimension-line"
                    x1={dimensionLineX}
                    y1={lineStartY}
                    x2={dimensionLineX}
                    y2={lineEndY}
                    stroke="#7b3106"
                    strokeWidth="2.5"
                    markerStart={`url(#${dimensionArrowId})`}
                    markerEnd={`url(#${dimensionArrowId})`}
                  />
                  <text
                    className="oog-dimension-label"
                    x={dimensionLineX + annotationFontSize * 0.65}
                    y={labelY}
                    dominantBaseline="central"
                    fontSize={annotationFontSize}
                    fontWeight="900"
                    fill="#7b3106"
                    stroke="#fff"
                    strokeWidth={annotationFontSize * 0.16}
                    paintOrder="stroke"
                  >
                    {`OW${sideLabel} +${formatCm(band.overhangCm)} cm`}
                  </text>
                  {truncated && (
                    <text
                      className="cargo-overhang-break"
                      x={placement.placed_x_cm + placement.orient_L_cm / 2}
                      y={breakY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={annotationFontSize * 1.35}
                      fontWeight="900"
                      fill="#7b3106"
                      stroke="#fff"
                      strokeWidth={annotationFontSize * 0.2}
                      paintOrder="stroke"
                      aria-hidden="true"
                    >
                      ～～
                    </text>
                  )}
                </g>
              );
            })}
            {oogMetrics.ohCm > 0 && (
              <g className="cargo-height-overhang-annotation" pointerEvents="none">
                <rect
                  x={heightBadgeX}
                  y={heightBadgeY}
                  width={heightBadgeWidth}
                  height={heightBadgeHeight}
                  rx={heightBadgeHeight / 2}
                  fill="#a73345"
                  stroke="#fff"
                  strokeWidth="2"
                />
                <text
                  x={heightBadgeX + heightBadgeWidth / 2}
                  y={heightBadgeY + heightBadgeHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={annotationFontSize}
                  fontWeight="900"
                  fill="#fff"
                >
                  {`OH +${formatCm(oogMetrics.ohCm)} cm`}
                </text>
              </g>
            )}
            {label && (
              <text
                x={placement.placed_x_cm + placement.orient_L_cm / 2}
                y={widthProjection.y + widthProjection.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={label.fontSize}
                fontWeight="700"
                fill="#fff"
                pointerEvents="none"
              >
                {label.text}
              </text>
            )}
          </g>
        );
      })}
      {stackGroups.map((group) => {
        const text = `${group.origId} ${group.tierCount}段 × ${group.columnCount}列`;
        const fontSize = Math.max(
          STACK_ANNOTATION_MIN_FONT_SIZE,
          Math.min(
            STACK_ANNOTATION_MAX_FONT_SIZE,
            group.height * STACK_ANNOTATION_HEIGHT_RATIO,
            group.width / Math.max(text.length * STACK_ANNOTATION_CHARACTER_WIDTH_RATIO, 1),
          ),
        );
        const badgeWidth = Math.max(
          fontSize * 3,
          Math.min(
            group.width,
            text.length * fontSize * STACK_ANNOTATION_CHARACTER_WIDTH_RATIO
              + STACK_ANNOTATION_HORIZONTAL_PADDING_CM,
          ),
        );
        const badgeHeight = fontSize * STACK_ANNOTATION_VERTICAL_PADDING_RATIO;
        const centerX = group.x + group.width / 2;
        const centerY = group.y + group.height / 2;
        return (
          <g className="cargo-stack-group" key={group.key} pointerEvents="none">
            <rect
              className="cargo-stack-outline"
              x={group.x}
              y={group.y}
              width={group.width}
              height={group.height}
              rx="5"
              fill="none"
              stroke="#17324a"
              strokeWidth="3"
              strokeDasharray="8 5"
            />
            <rect
              className="cargo-stack-badge"
              x={centerX - badgeWidth / 2}
              y={centerY - badgeHeight / 2}
              width={badgeWidth}
              height={badgeHeight}
              rx={badgeHeight / 2}
              fill="#17324a"
              stroke="#fff"
              strokeWidth="2"
            />
            <text
              className="cargo-stack-label"
              x={centerX}
              y={centerY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fontWeight="900"
              fill="#fff"
            >
              {text}
            </text>
          </g>
        );
      })}
      {centerOfGravity && (
        <g
          className="cargo-center-of-gravity"
          pointerEvents="none"
          aria-label={`貨物重心 X ${formatCm(centerOfGravity.xCm)}cm、Y ${formatCm(centerOfGravity.yCm)}cm`}
        >
          <line
            x1={load.spec.inner_L_cm / 2}
            y1={load.spec.inner_W_cm / 2}
            x2={centerOfGravity.xCm}
            y2={centerOfGravity.yCm}
            stroke="#a73345"
            strokeWidth="3"
            strokeDasharray="7 5"
          />
          <circle
            cx={load.spec.inner_L_cm / 2}
            cy={load.spec.inner_W_cm / 2}
            r={centerOfGravityMarkerRadius * 0.42}
            fill="#fff"
            stroke="#17324a"
            strokeWidth="2"
          />
          <circle
            cx={centerOfGravity.xCm}
            cy={centerOfGravity.yCm}
            r={centerOfGravityMarkerRadius}
            fill="#a73345"
            stroke="#fff"
            strokeWidth="3"
          />
          <line
            x1={centerOfGravity.xCm - centerOfGravityMarkerRadius * 0.55}
            y1={centerOfGravity.yCm}
            x2={centerOfGravity.xCm + centerOfGravityMarkerRadius * 0.55}
            y2={centerOfGravity.yCm}
            stroke="#fff"
            strokeWidth="2.5"
          />
          <line
            x1={centerOfGravity.xCm}
            y1={centerOfGravity.yCm - centerOfGravityMarkerRadius * 0.55}
            x2={centerOfGravity.xCm}
            y2={centerOfGravity.yCm + centerOfGravityMarkerRadius * 0.55}
            stroke="#fff"
            strokeWidth="2.5"
          />
          <text
            x={Math.min(
              load.spec.inner_L_cm - centerOfGravityMarkerRadius * 3.6,
              centerOfGravity.xCm + centerOfGravityMarkerRadius * 1.45,
            )}
            y={Math.max(
              centerOfGravityMarkerRadius,
              centerOfGravity.yCm - centerOfGravityMarkerRadius * 1.2,
            )}
            fontSize={centerOfGravityMarkerRadius}
            fontWeight="900"
            fill="#8f2438"
            stroke="#fff"
            strokeWidth={centerOfGravityMarkerRadius * 0.18}
            paintOrder="stroke"
          >
            貨物重心
          </text>
        </g>
      )}
      <rect
        className="container-deck-outline"
        x="0"
        y="0"
        width={load.spec.inner_L_cm}
        height={load.spec.inner_W_cm}
        rx="9"
        fill="none"
        stroke="#17324a"
        strokeWidth="4"
        pointerEvents="none"
      />
      <text x="4" y={minWidth - paddingY * LAYOUT_HEADER_OFFSET_RATIO} fontSize="18" fontWeight="700" fill="#17324a">FRONT / DOOR</text>
      <text x={load.spec.inner_L_cm - 4} y={minWidth - paddingY * LAYOUT_HEADER_OFFSET_RATIO} textAnchor="end" fontSize="18" fill="#62768a">INNER {load.spec.inner_L_cm} × {load.spec.inner_W_cm} cm</text>
    </svg>
    {(stackGroups.length > 0 || legends.length > 0 || hasTruncatedWidth) && (
      <figcaption className="layout-annotation-summary" aria-label="積載注釈">
        {hasTruncatedWidth && <span className="layout-break-note"><b>～～</b> OW貨物の描画省略（注釈値は実超過量）</span>}
        {stackGroups.length > 0 && (
          <div className="layout-stack-summary">
            {stackGroups.map((group) => (
              <span key={group.key}>
                <strong>{group.origId}</strong>
                <b>{group.tierCount}段 × {group.columnCount}列</b>
                <small>{group.pieceRange}（{group.pieceCount} PCS）</small>
              </span>
            ))}
          </div>
        )}
        {legends.length > 0 && (
          <div className="layout-label-legend" aria-label="小型貨物ID凡例">
            {legends.map((legend) => <span key={legend.origId}><b>{legend.code}</b><strong>{legend.origId}</strong>{legend.pieceRange} <small>({legend.count} PCS)</small></span>)}
          </div>
        )}
      </figcaption>
    )}
    </figure>
  );
}
