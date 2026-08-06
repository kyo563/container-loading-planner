import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  MousePointer2,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import {
  buildManualPlanResult,
  createManualLoads,
  MANUAL_POSITION_GRID_CM,
  placeManualPiece,
  removeManualPiece,
} from "../domain/manualPlan";
import { containerKey } from "../domain/planner";
import { containerLabel } from "../domain/reporting";
import type {
  ContainerLoad,
  ContainerSpec,
  Piece,
  Placement,
  PlanResult,
  PlanningSettings,
} from "../domain/types";

interface ManualPlannerProps {
  pieces: Piece[];
  specs: ContainerSpec[];
  counts: Record<string, number>;
  settings: PlanningSettings;
  onGenerateResult: (result: PlanResult) => void;
  onDraftChange: () => void;
}

interface DragState {
  pieceId: string;
  offsetXRatio: number;
  offsetYRatio: number;
}

const colorFor = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  const palette = ["#33b7a4", "#e1a84b", "#5c8ee6", "#d66f83", "#8c72d7", "#4ea36b", "#df7b45", "#4a9fbd"];
  return palette[Math.abs(hash) % palette.length];
};

const findPlacement = (loads: ContainerLoad[], pieceId: string): Placement | undefined =>
  loads.flatMap((load) => load.placements).find((placement) => placement.piece.piece_id === pieceId);

export function ManualPlanner({
  pieces,
  specs,
  counts,
  settings,
  onGenerateResult,
  onDraftChange,
}: ManualPlannerProps) {
  const [loads, setLoads] = useState<ContainerLoad[]>(() => createManualLoads(specs, counts));
  const [selectedKey, setSelectedKey] = useState(() => {
    const first = createManualLoads(specs, counts)[0];
    return first ? containerKey(first.spec.type, first.index) : "";
  });
  const [selectedPieceId, setSelectedPieceId] = useState("");
  const [selectedPlacementId, setSelectedPlacementId] = useState("");
  const [rotatedPieceIds, setRotatedPieceIds] = useState<Set<string>>(() => new Set());
  const [showTopView, setShowTopView] = useState(true);
  const [showSideView, setShowSideView] = useState(false);
  const [message, setMessage] = useState("");
  const dragState = useRef<DragState | null>(null);

  const activeLoad = loads.find((load) => containerKey(load.spec.type, load.index) === selectedKey) ?? loads[0];
  const placedIds = useMemo(
    () => new Set(loads.flatMap((load) => load.placements.map((placement) => placement.piece.piece_id))),
    [loads],
  );
  const unplaced = pieces.filter((piece) => !placedIds.has(piece.piece_id));
  const selectedPiece = pieces.find((piece) => piece.piece_id === selectedPieceId);
  const selectedPlacement = activeLoad?.placements.find(
    (placement) => placement.piece.piece_id === selectedPlacementId,
  );
  const activeWeight = activeLoad?.placements.reduce(
    (sum, placement) => sum + placement.piece.weight_kg,
    0,
  ) ?? 0;
  const activeM3 = activeLoad?.placements.reduce(
    (sum, placement) => sum + placement.piece.m3,
    0,
  ) ?? 0;

  const commitLoads = (next: ContainerLoad[], nextSelectedPlacementId = "") => {
    setLoads(next);
    setSelectedPlacementId(nextSelectedPlacementId);
    setMessage("");
    onDraftChange();
  };

  const applyPlacement = (
    piece: Piece,
    xCm: number,
    yCm: number,
    rotated: boolean,
  ): boolean => {
    if (!activeLoad) return false;
    const update = placeManualPiece(loads, selectedKey, piece, xCm, yCm, rotated);
    if (update.error) {
      setMessage(update.error);
      return false;
    }
    commitLoads(update.loads, piece.piece_id);
    setSelectedPieceId("");
    return true;
  };

  const handleStageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!activeLoad || !dragState.current) return;
    const piece = pieces.find((candidate) => candidate.piece_id === dragState.current?.pieceId);
    if (!piece) return;
    const existing = findPlacement(loads, piece.piece_id);
    const rotated = existing
      ? existing.rotation_key === "WLH"
      : rotatedPieceIds.has(piece.piece_id);
    const orientL = rotated ? piece.W_cm : piece.L_cm;
    const orientW = rotated ? piece.L_cm : piece.W_cm;
    const bounds = event.currentTarget.getBoundingClientRect();
    const xCm =
      ((event.clientX - bounds.left) / bounds.width) * activeLoad.spec.inner_L_cm -
      dragState.current.offsetXRatio * orientL;
    const yCm =
      ((event.clientY - bounds.top) / bounds.height) * activeLoad.spec.inner_W_cm -
      dragState.current.offsetYRatio * orientW;
    applyPlacement(piece, xCm, yCm, rotated);
    dragState.current = null;
  };

  const handleStageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!activeLoad || !selectedPiece || (event.target as HTMLElement).closest(".manual-cargo-box")) return;
    const rotated = rotatedPieceIds.has(selectedPiece.piece_id);
    const orientL = rotated ? selectedPiece.W_cm : selectedPiece.L_cm;
    const orientW = rotated ? selectedPiece.L_cm : selectedPiece.W_cm;
    const bounds = event.currentTarget.getBoundingClientRect();
    const xCm = ((event.clientX - bounds.left) / bounds.width) * activeLoad.spec.inner_L_cm - orientL / 2;
    const yCm = ((event.clientY - bounds.top) / bounds.height) * activeLoad.spec.inner_W_cm - orientW / 2;
    applyPlacement(selectedPiece, xCm, yCm, rotated);
  };

  const handleStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!activeLoad || !selectedPiece || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const rotated = rotatedPieceIds.has(selectedPiece.piece_id);
    const orientL = rotated ? selectedPiece.W_cm : selectedPiece.L_cm;
    const orientW = rotated ? selectedPiece.L_cm : selectedPiece.W_cm;
    applyPlacement(
      selectedPiece,
      (activeLoad.spec.inner_L_cm - orientL) / 2,
      (activeLoad.spec.inner_W_cm - orientW) / 2,
      rotated,
    );
  };

  const rotateSelectedPlacement = () => {
    if (!selectedPlacement) return;
    applyPlacement(
      selectedPlacement.piece,
      selectedPlacement.placed_x_cm,
      selectedPlacement.placed_y_cm,
      selectedPlacement.rotation_key !== "WLH",
    );
  };

  const nudgeSelectedPlacement = (deltaX: number, deltaY: number) => {
    if (!selectedPlacement) return;
    applyPlacement(
      selectedPlacement.piece,
      selectedPlacement.placed_x_cm + deltaX,
      selectedPlacement.placed_y_cm + deltaY,
      selectedPlacement.rotation_key === "WLH",
    );
  };

  const returnSelectedToPalette = () => {
    if (!selectedPlacement) return;
    commitLoads(removeManualPiece(loads, selectedPlacement.piece.piece_id));
    setSelectedPieceId(selectedPlacement.piece.piece_id);
  };

  const generateResult = () => {
    const result = buildManualPlanResult(loads, pieces, specs, settings, counts);
    onGenerateResult(result);
    window.setTimeout(
      () => document.getElementById("plan-results")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  };

  if (!activeLoad) return null;

  return (
    <section className="manual-planner panel" id="manual-planner">
      <div className="manual-heading">
        <div>
          <span className="eyebrow">MANUAL VANNING PLAN</span>
          <h2>手動バン詰めプラン</h2>
          <p>未配置貨物をドラッグするか、貨物を選んでコンテナ上をクリックしてください。位置は{MANUAL_POSITION_GRID_CM}cm単位で記録します。</p>
        </div>
        <div className="manual-progress">
          <strong>{placedIds.size}<span> / {pieces.length} PCS</span></strong>
          <small>配置済み</small>
        </div>
      </div>

      <div className="manual-container-tabs" role="tablist" aria-label="手動配置するコンテナ">
        {loads.map((load) => {
          const key = containerKey(load.spec.type, load.index);
          const weight = load.placements.reduce((sum, placement) => sum + placement.piece.weight_kg, 0);
          return (
            <button
              type="button"
              role="tab"
              aria-selected={key === selectedKey}
              key={key}
              className={key === selectedKey ? "active" : ""}
              onClick={() => {
                setSelectedKey(key);
                setSelectedPlacementId("");
                setMessage("");
              }}
            >
              <strong>{containerLabel(load)}</strong>
              <small>{load.placements.length} PCS · {weight.toLocaleString()}kg</small>
            </button>
          );
        })}
      </div>

      <div className="manual-workspace">
        <aside className="manual-palette">
          <div className="manual-palette-heading">
            <div><strong>未配置貨物</strong><small>クリックで選択、ドラッグで配置</small></div>
            <span>{unplaced.length}</span>
          </div>
          <div className="manual-palette-list">
            {unplaced.map((piece) => {
              const rotated = rotatedPieceIds.has(piece.piece_id);
              const orientL = rotated ? piece.W_cm : piece.L_cm;
              const orientW = rotated ? piece.L_cm : piece.W_cm;
              return (
                <div
                  key={piece.piece_id}
                  className={piece.piece_id === selectedPieceId ? "manual-palette-item selected" : "manual-palette-item"}
                  draggable
                  onDragStart={(event) => {
                    dragState.current = { pieceId: piece.piece_id, offsetXRatio: 0.5, offsetYRatio: 0.5 };
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", piece.piece_id);
                  }}
                >
                  <button
                    type="button"
                    className="manual-palette-select"
                    onClick={() => {
                      setSelectedPieceId(piece.piece_id);
                      setSelectedPlacementId("");
                      setMessage("");
                    }}
                  >
                    <span
                      className="manual-palette-shape"
                      style={{
                        width: `${Math.max(30, Math.min(86, orientL * 0.34))}px`,
                        height: `${Math.max(20, Math.min(52, orientW * 0.24))}px`,
                        background: colorFor(piece.orig_id),
                      }}
                    />
                    <span><strong>{piece.piece_id}</strong><small>{orientL} × {orientW} × {piece.H_cm}cm</small><small>{piece.weight_kg.toLocaleString()}kg</small></span>
                  </button>
                  <button
                    type="button"
                    className="manual-palette-rotate"
                    aria-label={`${piece.piece_id}を90度回転`}
                    disabled={!piece.rotate_allowed}
                    onClick={() => setRotatedPieceIds((current) => {
                      const next = new Set(current);
                      if (next.has(piece.piece_id)) next.delete(piece.piece_id);
                      else next.add(piece.piece_id);
                      return next;
                    })}
                  >
                    <RotateCw size={14} />
                  </button>
                </div>
              );
            })}
            {!unplaced.length && (
              <div className="manual-palette-empty"><CheckCircle2 /><strong>全貨物を配置済みです</strong></div>
            )}
          </div>
        </aside>

        <div className="manual-stage-panel">
          <div className="manual-stage-heading">
            <div>
              <strong>{containerLabel(activeLoad)}</strong>
              <small>{activeLoad.spec.inner_L_cm} × {activeLoad.spec.inner_W_cm} × {activeLoad.spec.inner_H_cm}cm</small>
            </div>
            <div>
              <span>{activeLoad.placements.length} PCS</span>
              <span>{activeWeight.toLocaleString()}kg</span>
              <span>{activeM3.toFixed(3)}m³</span>
            </div>
          </div>
          <div className="manual-view-switch" role="group" aria-label="バンプランの表示図">
            <strong>表示図</strong>
            <label>
              <input
                type="checkbox"
                checked={showTopView}
                disabled={showTopView && !showSideView}
                onChange={(event) => setShowTopView(event.target.checked)}
              />
              上から
            </label>
            <label>
              <input
                type="checkbox"
                checked={showSideView}
                disabled={showSideView && !showTopView}
                onChange={(event) => setShowSideView(event.target.checked)}
              />
              横から
            </label>
            <small>両方にチェックすると併記します</small>
          </div>
          <div className={showTopView && showSideView ? "manual-view-layout combined" : "manual-view-layout"}>
            {showTopView && (
              <section className="manual-view-panel" aria-label="上面図">
                <div className="manual-view-title"><strong>上面図</strong><small>配置・移動はこちらで操作</small></div>
                <div className="manual-axis-labels"><span>TRUCK SIDE · x=0</span><span>DOOR SIDE</span></div>
                <div
                  className={selectedPiece ? "manual-container-canvas placing" : "manual-container-canvas"}
                  style={{ aspectRatio: `${activeLoad.spec.inner_L_cm} / ${activeLoad.spec.inner_W_cm}` }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={handleStageDrop}
                  onClick={handleStageClick}
                  onKeyDown={handleStageKeyDown}
                  role="application"
                  tabIndex={0}
                  aria-label={`${containerLabel(activeLoad)}の手動配置エリア`}
                >
                  <span className="manual-center-line vertical" />
                  <span className="manual-center-line horizontal" />
                  {activeLoad.placements.map((placement, index) => (
                    <button
                      type="button"
                      key={placement.piece.piece_id}
                      draggable
                      className={placement.piece.piece_id === selectedPlacementId ? "manual-cargo-box selected" : "manual-cargo-box"}
                      style={{
                        left: `${(placement.placed_x_cm / activeLoad.spec.inner_L_cm) * 100}%`,
                        top: `${(placement.placed_y_cm / activeLoad.spec.inner_W_cm) * 100}%`,
                        width: `${(placement.orient_L_cm / activeLoad.spec.inner_L_cm) * 100}%`,
                        height: `${(placement.orient_W_cm / activeLoad.spec.inner_W_cm) * 100}%`,
                        background: colorFor(placement.piece.orig_id),
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPlacementId(placement.piece.piece_id);
                        setSelectedPieceId("");
                        setMessage("");
                      }}
                      onDragStart={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        dragState.current = {
                          pieceId: placement.piece.piece_id,
                          offsetXRatio: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
                          offsetYRatio: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
                        };
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", placement.piece.piece_id);
                      }}
                      aria-label={`${placement.piece.piece_id}、x ${placement.placed_x_cm}cm、y ${placement.placed_y_cm}cm`}
                    >
                      <b>{index + 1}</b>
                      <strong>{placement.piece.piece_id}</strong>
                      <small>{placement.orient_L_cm}×{placement.orient_W_cm}</small>
                    </button>
                  ))}
                  {!activeLoad.placements.length && (
                    <div className="manual-stage-empty"><MousePointer2 /><strong>ここへ貨物を配置</strong><small>ボックスはコンテナ内寸に合わせた縮尺です</small></div>
                  )}
                </div>
              </section>
            )}
            {showSideView && (
              <section className="manual-view-panel" aria-label="側面図">
                <div className="manual-view-title"><strong>側面図</strong><small>上面図の配置と連動</small></div>
                <div className="manual-axis-labels"><span>TRUCK SIDE · x=0</span><span>DOOR SIDE</span></div>
                <div
                  className="manual-side-canvas"
                  style={{ aspectRatio: `${activeLoad.spec.inner_L_cm} / ${activeLoad.spec.inner_H_cm}` }}
                  role="group"
                  aria-label={`${containerLabel(activeLoad)}の側面表示`}
                >
                  <span className="manual-center-line vertical" />
                  {activeLoad.placements.map((placement, index) => (
                    <button
                      type="button"
                      key={placement.piece.piece_id}
                      className={placement.piece.piece_id === selectedPlacementId ? "manual-side-cargo-box selected" : "manual-side-cargo-box"}
                      style={{
                        left: `${(placement.placed_x_cm / activeLoad.spec.inner_L_cm) * 100}%`,
                        bottom: `${(placement.placed_z_cm / activeLoad.spec.inner_H_cm) * 100}%`,
                        width: `${(placement.orient_L_cm / activeLoad.spec.inner_L_cm) * 100}%`,
                        height: `${(placement.orient_H_cm / activeLoad.spec.inner_H_cm) * 100}%`,
                        background: colorFor(placement.piece.orig_id),
                      }}
                      onClick={() => {
                        setSelectedPlacementId(placement.piece.piece_id);
                        setSelectedPieceId("");
                        setMessage("");
                      }}
                      aria-label={`${placement.piece.piece_id}、側面位置x ${placement.placed_x_cm}cm、高さ ${placement.orient_H_cm}cm`}
                    >
                      <b>{index + 1}</b><strong>{placement.piece.piece_id}</strong><small>H {placement.orient_H_cm}</small>
                    </button>
                  ))}
                  {!activeLoad.placements.length && (
                    <div className="manual-stage-empty"><strong>配置すると側面形状を表示します</strong></div>
                  )}
                </div>
              </section>
            )}
          </div>

          {message && <div className="manual-placement-error" role="alert">{message}</div>}
          {selectedPiece && (
            <div className="manual-selection-hint">
              <MousePointer2 size={16} />
              <span><strong>{selectedPiece.piece_id}</strong>を選択中です。{showTopView ? "上面図で配置位置をクリックしてください。" : "配置するには「上から」を有効にしてください。"}</span>
            </div>
          )}
          {selectedPlacement && (
            <div className="manual-placement-controls">
              <div>
                <strong>{selectedPlacement.piece.piece_id}</strong>
                <small>x={selectedPlacement.placed_x_cm} / y={selectedPlacement.placed_y_cm}cm · {selectedPlacement.orient_L_cm}×{selectedPlacement.orient_W_cm}×{selectedPlacement.orient_H_cm}cm</small>
              </div>
              <div className="manual-nudge" aria-label="選択貨物の位置調整">
                <button type="button" aria-label="左へ5cm" onClick={() => nudgeSelectedPlacement(-MANUAL_POSITION_GRID_CM, 0)}><ArrowLeft /></button>
                <button type="button" aria-label="右へ5cm" onClick={() => nudgeSelectedPlacement(MANUAL_POSITION_GRID_CM, 0)}><ArrowRight /></button>
                <button type="button" aria-label="上へ5cm" onClick={() => nudgeSelectedPlacement(0, -MANUAL_POSITION_GRID_CM)}><ArrowUp /></button>
                <button type="button" aria-label="下へ5cm" onClick={() => nudgeSelectedPlacement(0, MANUAL_POSITION_GRID_CM)}><ArrowDown /></button>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={!selectedPlacement.piece.rotate_allowed}
                onClick={rotateSelectedPlacement}
              >
                <RotateCw size={15} />90°回転
              </button>
              <button type="button" className="button danger" onClick={returnSelectedToPalette}>
                <Trash2 size={15} />未配置へ戻す
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="manual-footer">
        <div>
          <ClipboardList />
          <span><strong>配置からCLPを自動集計</strong><small>未配置貨物が残っていても途中集計できます。</small></span>
        </div>
        <button type="button" className="run-button" onClick={generateResult}>
          <ClipboardList />CLPリストを作成
        </button>
      </div>
    </section>
  );
}
