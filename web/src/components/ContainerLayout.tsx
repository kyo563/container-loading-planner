import type { ContainerLoad } from "../domain/types";

const colorFor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = value.charCodeAt(index) + ((hash << 5) - hash);
  const palette = ["#33b7a4", "#e1a84b", "#5c8ee6", "#d66f83", "#8c72d7", "#4ea36b", "#df7b45", "#4a9fbd"];
  return palette[Math.abs(hash) % palette.length];
};

interface ContainerLayoutProps {
  load: ContainerLoad;
}

export function ContainerLayout({ load }: ContainerLayoutProps) {
  const minWidth = Math.min(0, ...load.placements.map((placement) => placement.placed_y_cm));
  const maxWidth = Math.max(
    load.spec.inner_W_cm,
    ...load.placements.map((placement) => placement.placed_y_cm + placement.orient_W_cm),
  );
  const paddingX = load.spec.inner_L_cm * 0.025;
  const drawingWidth = maxWidth - minWidth;
  const paddingY = drawingWidth * 0.09;
  const viewBox = `${-paddingX} ${minWidth - paddingY} ${load.spec.inner_L_cm + paddingX * 2} ${drawingWidth + paddingY * 2}`;
  return (
    <svg className="container-layout" viewBox={viewBox} role="img" aria-label={`${load.spec.type}の上面配置図`}>
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(45,70,91,.12)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={load.spec.inner_L_cm} height={load.spec.inner_W_cm} rx="9" fill="#f7fafc" stroke="#17324a" strokeWidth="4" />
      <rect x="0" y="0" width={load.spec.inner_L_cm} height={load.spec.inner_W_cm} rx="9" fill="url(#grid)" />
      <line x1={load.spec.inner_L_cm / 2} y1="0" x2={load.spec.inner_L_cm / 2} y2={load.spec.inner_W_cm} stroke="#17324a" strokeDasharray="12 9" strokeOpacity=".3" strokeWidth="2" />
      <line x1="0" y1={load.spec.inner_W_cm / 2} x2={load.spec.inner_L_cm} y2={load.spec.inner_W_cm / 2} stroke="#17324a" strokeDasharray="12 9" strokeOpacity=".3" strokeWidth="2" />
      {load.placements.map((placement) => {
        const color = colorFor(placement.piece.orig_id);
        const fontSize = Math.max(10, Math.min(22, placement.orient_L_cm / 5, placement.orient_W_cm / 2.8));
        const showLabel = placement.orient_L_cm > 65 && placement.orient_W_cm > 24;
        return (
          <g key={placement.piece.piece_id}>
            <rect
              x={placement.placed_x_cm}
              y={placement.placed_y_cm}
              width={placement.orient_L_cm}
              height={placement.orient_W_cm}
              rx="5"
              fill={color}
              fillOpacity={placement.placed_z_cm > 0 ? 0.64 : 0.86}
              stroke="#fff"
              strokeWidth="3"
            >
              <title>{`${placement.piece.piece_id} ${placement.piece.desc}\n${placement.orient_L_cm}×${placement.orient_W_cm}×${placement.orient_H_cm}cm / ${placement.piece.weight_kg}kg\nz=${placement.placed_z_cm}cm`}</title>
            </rect>
            {showLabel && (
              <text
                x={placement.placed_x_cm + placement.orient_L_cm / 2}
                y={placement.placed_y_cm + placement.orient_W_cm / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight="700"
                fill="#fff"
                pointerEvents="none"
              >
                {placement.piece.piece_id}
              </text>
            )}
          </g>
        );
      })}
      <text x="4" y={-paddingY * 0.28} fontSize="18" fontWeight="700" fill="#17324a">FRONT / DOOR</text>
      <text x={load.spec.inner_L_cm - 4} y={-paddingY * 0.28} textAnchor="end" fontSize="18" fill="#62768a">INNER {load.spec.inner_L_cm} × {load.spec.inner_W_cm} cm</text>
    </svg>
  );
}
