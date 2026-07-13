import { AlertCircle, AlertTriangle, Check, ChevronRight, Download, FileSpreadsheet, Printer, Scale, Ship, Weight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { exportExcelReport, exportPlacementsCsv, printPlan } from "../domain/export";
import { containerKey } from "../domain/planner";
import { buildContainerKpis, containerLabel, summarizeCounts } from "../domain/reporting";
import { fmt, fmtInt } from "../domain/rounding";
import type { PlanResult } from "../domain/types";
import { ContainerLayout } from "./ContainerLayout";

interface PlanResultsProps {
  result: PlanResult;
}

export function PlanResults({ result }: PlanResultsProps) {
  const kpis = useMemo(() => buildContainerKpis(result), [result]);
  const counts = useMemo(() => summarizeCounts(result), [result]);
  const [selectedKey, setSelectedKey] = useState(() => result.loads[0] ? containerKey(result.loads[0].spec.type, result.loads[0].index) : "");
  useEffect(() => {
    setSelectedKey(result.loads[0] ? containerKey(result.loads[0].spec.type, result.loads[0].index) : "");
  }, [result]);
  const selectedLoad = result.loads.find((load) => containerKey(load.spec.type, load.index) === selectedKey) ?? result.loads[0];
  const selectedKpi = kpis.find((kpi) => kpi.container_key === selectedKey) ?? kpis[0];
  const selectedBias = selectedLoad ? result.bias_by_container.get(containerKey(selectedLoad.spec.type, selectedLoad.index)) : undefined;
  const selectedWeight = selectedLoad ? result.weight_audit_by_container.get(containerKey(selectedLoad.spec.type, selectedLoad.index)) : undefined;
  const allPieces = result.placements.length + result.unplaced.length;
  const totalM3 = [...result.placements.map((placement) => placement.piece), ...result.unplaced].reduce((sum, piece) => sum + piece.m3, 0);
  const totalWeight = [...result.placements.map((placement) => placement.piece), ...result.unplaced].reduce((sum, piece) => sum + piece.weight_kg, 0);
  const oogEntries = [...result.oog_results.entries()].filter(([, oog]) => oog.oog_flag || !oog.door_passable);
  const warningCount = kpis.filter((kpi) => kpi.bias_warn || kpi.weight_alert).length + result.unplaced.length;

  return (
    <section className="results-section" id="plan-results">
      <div className="print-report-header print-only">
        <h1>Container Loading Plan</h1><p>LoadPilot / {new Date().toLocaleString("ja-JP")}</p>
      </div>
      <div className="results-heading">
        <div>
          <span className="eyebrow">PLANNING RESULT</span>
          <h2>{result.mode === "estimate" ? "推奨コンテナ構成" : "指定本数での積載検証"}</h2>
          <p>配置はヒューリスティック計算による計画案です。警告と積載不可貨物を必ず確認してください。</p>
        </div>
        <div className="result-actions no-print">
          <button className="button secondary" onClick={() => void exportPlacementsCsv(result)}><Download size={16} />CSV</button>
          <button className="button secondary" onClick={() => void exportExcelReport(result)}><FileSpreadsheet size={16} />Excel帳票</button>
          <button className="button secondary" onClick={printPlan}><Printer size={16} />印刷 / PDF</button>
        </div>
      </div>

      <div className={result.unplaced.length ? "outcome-banner warning" : "outcome-banner success"}>
        <span className="outcome-icon">{result.unplaced.length ? <AlertTriangle /> : <Check />}</span>
        <div>
          <strong>{result.unplaced.length ? `${result.unplaced.length}ピースが未配置です` : "全貨物を配置できました"}</strong>
          <p>{result.unplaced.length ? "コンテナ構成、OOG、混載制約、最大積載重量を確認してください。" : `${result.placements.length}ピースの配置案を作成しました。`}</p>
        </div>
        <div className="count-pills">
          {Object.entries(counts).map(([type, count]) => <span key={type}><b>{type}</b> × {count}</span>)}
        </div>
      </div>

      <div className="metric-grid result-metrics">
        <div className="metric-card"><span className="metric-icon blue"><Ship /></span><div><small>コンテナ</small><strong>{result.loads.length}<em>本</em></strong><p>{Object.keys(counts).length}タイプ</p></div></div>
        <div className="metric-card"><span className="metric-icon green"><Check /></span><div><small>積載済み</small><strong>{result.placements.length}<em> / {allPieces}</em></strong><p>{allPieces ? fmt((result.placements.length / allPieces) * 100, 1) : "0.0"}%</p></div></div>
        <div className="metric-card"><span className="metric-icon gold"><Scale /></span><div><small>貨物合計</small><strong>{fmt(totalM3, 3)}<em>m³</em></strong><p>{fmtInt(totalWeight)} kg</p></div></div>
        <div className={`metric-card ${warningCount ? "metric-warning" : ""}`}><span className="metric-icon red"><AlertCircle /></span><div><small>要確認</small><strong>{warningCount}<em>件</em></strong><p>未配置・重量・偏荷重</p></div></div>
      </div>

      {result.decision_reasons.length > 0 && (
        <div className="decision-panel">
          <strong>選定根拠・前提</strong>
          <ul>{result.decision_reasons.map((reason) => <li key={reason}><ChevronRight size={15} />{reason}</li>)}</ul>
        </div>
      )}

      {selectedLoad && selectedKpi && (
        <div className="container-review-grid">
          <aside className="container-list no-print">
            <div className="aside-title"><strong>コンテナ別計画</strong><span>{result.loads.length}</span></div>
            {result.loads.map((load) => {
              const key = containerKey(load.spec.type, load.index);
              const kpi = kpis.find((item) => item.container_key === key);
              return (
                <button key={key} className={key === selectedKey ? "container-list-item active" : "container-list-item"} onClick={() => setSelectedKey(key)}>
                  <span className="container-type-icon">{load.spec.type.slice(0, 2)}</span>
                  <span><strong>{containerLabel(load)}</strong><small>{load.placements.length} pcs · {fmt(kpi?.total_m3 ?? 0, 2)} m³</small></span>
                  {(kpi?.bias_warn || kpi?.weight_alert) && <AlertTriangle size={16} className="warning-icon" />}
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </aside>
          <article className="container-detail">
            <div className="container-detail-heading">
              <div><span className="eyebrow">TOP VIEW</span><h3>{containerLabel(selectedLoad)}</h3><p>{selectedLoad.spec.inner_L_cm} × {selectedLoad.spec.inner_W_cm} × {selectedLoad.spec.inner_H_cm} cm</p></div>
              <div className="detail-badges"><span>{selectedLoad.placements.length} PCS</span><span>{fmt(selectedKpi.total_m3, 2)} M³</span></div>
            </div>
            <div className="layout-stage"><ContainerLayout load={selectedLoad} /></div>
            <div className="utilization-grid">
              <div>
                <span><Weight size={16} />Payload</span><strong>{fmt(selectedKpi.payload_ratio_pct, 1)}%</strong>
                <div className="progress"><i style={{ width: `${Math.min(100, selectedKpi.payload_ratio_pct)}%` }} className={selectedKpi.payload_ratio_pct >= 90 ? "warn" : ""} /></div>
                <small>{fmtInt(selectedKpi.total_gross_kg)} / {fmtInt(selectedLoad.spec.max_payload_kg)} kg</small>
              </div>
              <div>
                <span><Scale size={16} />容積（参考）</span><strong>{fmt(selectedKpi.volume_ratio_pct, 1)}%</strong>
                <div className="progress"><i style={{ width: `${Math.min(100, selectedKpi.volume_ratio_pct)}%` }} /></div>
                <small>{fmt(selectedKpi.total_m3, 2)} m³</small>
              </div>
              <div>
                <span>重心偏差 X / Y</span><strong>{fmt(selectedBias?.offset_x_pct ?? 0, 1)} / {fmt(selectedBias?.offset_y_pct ?? 0, 1)}%</strong>
                <small>{selectedBias?.bias_warn ? selectedBias.bias_reason : "警告閾値内"}</small>
              </div>
              <div>
                <span>総重量目安</span><strong>{fmtInt(selectedWeight?.gross_weight_kg ?? 0)} kg</strong>
                <small>貨物＋風袋（陸送条件は別途確認）</small>
              </div>
            </div>
            {(selectedBias?.bias_warn || selectedWeight?.weight_alert) && (
              <div className="container-warning"><AlertTriangle size={18} /><div><strong>このコンテナは要確認です</strong><p>{[selectedBias?.bias_reason, selectedWeight?.weight_alert_message].filter(Boolean).join(" / ")}</p></div></div>
            )}
          </article>
        </div>
      )}

      <div className="print-only print-all-layouts">
        {result.loads.map((load) => {
          const key = containerKey(load.spec.type, load.index);
          const kpi = kpis.find((item) => item.container_key === key);
          const bias = result.bias_by_container.get(key);
          const weight = result.weight_audit_by_container.get(key);
          return (
            <article key={key} className="print-layout-card">
              <div><h3>{containerLabel(load)}</h3><p>{load.placements.length} pcs / {fmt(kpi?.total_m3 ?? 0, 2)} m³ / {fmtInt(kpi?.total_gross_kg ?? 0)} kg</p></div>
              <ContainerLayout load={load} />
              <p>Payload {fmt(kpi?.payload_ratio_pct ?? 0, 1)}% ・ 重心偏差 X/Y {fmt(bias?.offset_x_pct ?? 0, 1)} / {fmt(bias?.offset_y_pct ?? 0, 1)}% ・ 総重量目安 {fmtInt(weight?.gross_weight_kg ?? 0)}kg</p>
            </article>
          );
        })}
      </div>

      <div className="result-table-section">
        <div className="section-title-row"><div><span className="eyebrow">CONTAINER KPI</span><h3>コンテナ別集計</h3></div></div>
        <div className="table-shell"><table className="data-table result-table"><thead><tr><th>コンテナ</th><th>pcs</th><th>F/T</th><th>M³</th><th>貨物重量</th><th>Payload</th><th>容積</th><th>監査</th></tr></thead><tbody>
          {kpis.map((kpi) => <tr key={kpi.container_key}><td><strong>{kpi.container_label}</strong></td><td>{kpi.piece_count}</td><td>{fmt(kpi.total_ft, 3)}</td><td>{fmt(kpi.total_m3, 3)}</td><td>{fmtInt(kpi.total_gross_kg)} kg</td><td>{fmt(kpi.payload_ratio_pct, 1)}%</td><td>{fmt(kpi.volume_ratio_pct, 1)}%</td><td>{kpi.bias_warn || kpi.weight_alert ? <span className="status-chip red">要確認</span> : <span className="status-chip green">範囲内</span>}</td></tr>)}
        </tbody></table></div>
      </div>

      {result.unplaced.length > 0 && (
        <div className="result-table-section danger-section">
          <div className="section-title-row"><div><span className="eyebrow">UNPLACED</span><h3>積載不可・要確認貨物</h3></div><span className="status-chip red">{result.unplaced.length} pcs</span></div>
          <div className="table-shell"><table className="data-table result-table"><thead><tr><th>貨物ID</th><th>品名</th><th>寸法 cm</th><th>重量</th><th>OOG</th><th>判定・次の確認</th></tr></thead><tbody>
            {result.unplaced.map((piece) => {
              const oog = result.oog_results.get(piece.piece_id);
              const isBreakbulk = result.breakbulk_piece_ids.includes(piece.piece_id);
              return <tr key={piece.piece_id}><td><strong>{piece.piece_id}</strong></td><td>{piece.desc}</td><td>{piece.L_cm} × {piece.W_cm} × {piece.H_cm}</td><td>{fmtInt(piece.weight_kg)} kg</td><td>{oog?.oog_flag ? <span className="status-chip amber">{oog.suggestion || "対象"}</span> : "—"}</td><td>{isBreakbulk ? "在来船・個別輸送を要検討" : result.special_reason_by_piece.get(piece.piece_id) || "指定構成・積載制約を見直してください"}</td></tr>;
            })}
          </tbody></table></div>
        </div>
      )}

      {oogEntries.length > 0 && (
        <details className="oog-details">
          <summary>OOG・入口通過判定 <span>{oogEntries.length}件</span></summary>
          <div className="table-shell"><table className="data-table result-table"><thead><tr><th>貨物ID</th><th>基準</th><th>OL</th><th>OW</th><th>OH</th><th>入口</th><th>候補</th></tr></thead><tbody>
            {oogEntries.map(([pieceId, oog]) => <tr key={pieceId}><td><strong>{pieceId}</strong></td><td>{oog.oog_ref_type}</td><td>{oog.over_L_cm} cm</td><td>{oog.over_W_cm} cm</td><td>{oog.over_H_cm} cm</td><td>{oog.door_passable ? "通過可" : oog.door_reason}</td><td>{oog.suggestion || "標準"}</td></tr>)}
          </tbody></table></div>
        </details>
      )}
      <p className="result-disclaimer">本結果は初期検討用です。実入手可能なコンテナ仕様、床荷重、固縛、積付け作業性、道路法令、船社・ターミナル条件を別途確認してください。</p>
    </section>
  );
}
