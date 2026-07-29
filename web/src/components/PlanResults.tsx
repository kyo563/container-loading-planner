import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronRight, Download, FileSpreadsheet, Printer, Scale, Ship, Weight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { exportExcelReport, exportPlacementsCsv, printPlan } from "../domain/export";
import { oogDisplayMetrics } from "../domain/oogDisplay";
import { createPlanQrBundleData, PRINT_QR_PX, type PlanQrData } from "../domain/planQr";
import { containerKey } from "../domain/planner";
import { assessJapanRoadTransport } from "../domain/roadTransport";
import { buildContainerKpis, buildContainerPackingLists, containerLabel, summarizeCounts } from "../domain/reporting";
import { fmt, fmtInt } from "../domain/rounding";
import type { ShareablePlanState } from "../domain/sharedPlan";
import type { PlanResult } from "../domain/types";
import { ContainerLayout } from "./ContainerLayout";
import { PlanShare } from "./PlanShare";

interface PlanResultsProps {
  result: PlanResult;
  sharePlan: ShareablePlanState;
}

export function PlanResults({ result, sharePlan }: PlanResultsProps) {
  const kpis = useMemo(() => buildContainerKpis(result), [result]);
  const packingLists = useMemo(() => buildContainerPackingLists(result), [result]);
  const roadAssessments = useMemo(() => new Map(result.loads.map((load) => [containerKey(load.spec.type, load.index), assessJapanRoadTransport(load)])), [result]);
  const counts = useMemo(() => summarizeCounts(result), [result]);
  const [selectedKey, setSelectedKey] = useState(() => result.loads[0] ? containerKey(result.loads[0].spec.type, result.loads[0].index) : "");
  const [exportError, setExportError] = useState("");
  const [printPlanQrParts, setPrintPlanQrParts] = useState<PlanQrData[]>([]);
  const [printSpecsQrParts, setPrintSpecsQrParts] = useState<PlanQrData[]>([]);
  const [printBundleId, setPrintBundleId] = useState("");
  const [printQrError, setPrintQrError] = useState(false);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [includePrintQr, setIncludePrintQr] = useState(true);
  const [printInColor, setPrintInColor] = useState(false);
  const [containerReportView, setContainerReportView] = useState<"summary" | "packing">("summary");
  const [expandedPackingLists, setExpandedPackingLists] = useState<Set<string>>(() => new Set(packingLists[0] ? [packingLists[0].containerKey] : []));
  const runExport = async (action: () => void | Promise<void>): Promise<void> => {
    setExportError("");
    try {
      await action();
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "帳票を作成できませんでした。もう一度お試しください。");
    }
  };
  useEffect(() => {
    setSelectedKey(result.loads[0] ? containerKey(result.loads[0].spec.type, result.loads[0].index) : "");
    setExpandedPackingLists(new Set(packingLists[0] ? [packingLists[0].containerKey] : []));
  }, [result]);
  useEffect(() => {
    let cancelled = false;
    setPrintPlanQrParts([]);
    setPrintSpecsQrParts([]);
    setPrintBundleId("");
    setPrintQrError(false);
    void createPlanQrBundleData(sharePlan, PRINT_QR_PX).then((qr) => {
      if (!cancelled) {
        setPrintPlanQrParts(qr.planParts);
        setPrintSpecsQrParts(qr.specsParts ?? []);
        setPrintBundleId(qr.bundleId ?? "");
      }
    }).catch(() => {
      if (!cancelled) setPrintQrError(true);
    });
    return () => { cancelled = true; };
  }, [sharePlan]);
  const togglePackingList = (key: string) => setExpandedPackingLists((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectedLoad = result.loads.find((load) => containerKey(load.spec.type, load.index) === selectedKey) ?? result.loads[0];
  const selectedKpi = kpis.find((kpi) => kpi.container_key === selectedKey) ?? kpis[0];
  const selectedBias = selectedLoad ? result.bias_by_container.get(containerKey(selectedLoad.spec.type, selectedLoad.index)) : undefined;
  const selectedWeight = selectedLoad ? result.weight_audit_by_container.get(containerKey(selectedLoad.spec.type, selectedLoad.index)) : undefined;
  const selectedRoad = selectedLoad ? roadAssessments.get(containerKey(selectedLoad.spec.type, selectedLoad.index)) : undefined;
  const allPieces = result.placements.length + result.unplaced.length;
  const totalM3 = [...result.placements.map((placement) => placement.piece), ...result.unplaced].reduce((sum, piece) => sum + piece.m3, 0);
  const totalWeight = [...result.placements.map((placement) => placement.piece), ...result.unplaced].reduce((sum, piece) => sum + piece.weight_kg, 0);
  const oogEntries = [...result.oog_results.entries()].filter(([, oog]) => oog.oog_flag || !oog.door_passable);
  const warningCount = kpis.filter((kpi) => {
    const road = roadAssessments.get(kpi.container_key);
    return kpi.bias_warn || kpi.weight_alert || road?.chassisLevel === "warning" || Boolean(road?.specialPermitMessage);
  }).length + result.unplaced.length;
  const printQrParts = [...printPlanQrParts, ...printSpecsQrParts];
  const printQrInstruction = printQrParts.length > 1
    ? `${printQrParts.length}枚のQRをLoadPilotの「QR読込」で順不同に読み取ってください${printBundleId ? `（カスタム仕様の照合ID: ${printBundleId}）` : ""}。`
    : "QRを読み取ると、貨物情報・計算条件を復元して再編集できます。";
  const printResultClassName = [
    "results-section",
    includePrintQr ? "print-with-qr" : "print-hide-qr",
    printInColor ? "print-color" : "print-monochrome",
  ].join(" ");
  const openPrintPreview = (): void => {
    setPrintOptionsOpen(false);
    window.setTimeout(() => {
      void runExport(printPlan);
    }, 0);
  };
  const loadedTotals = useMemo(() => kpis.reduce((totals, kpi) => ({
    pieces: totals.pieces + kpi.piece_count,
    ft: totals.ft + kpi.total_ft,
    m3: totals.m3 + kpi.total_m3,
    weight: totals.weight + kpi.total_gross_kg,
  }), { pieces: 0, ft: 0, m3: 0, weight: 0 }), [kpis]);
  const oogMetricsFor = (pieceId: string) => {
    const load = result.loads.find((candidate) => candidate.placements.some((placement) => placement.piece.piece_id === pieceId));
    const placement = load?.placements.find((candidate) => candidate.piece.piece_id === pieceId);
    const oog = result.oog_results.get(pieceId);
    return load && placement ? oogDisplayMetrics(placement, load.spec, oog) : {
      ohCm: oog?.over_H_cm ?? 0,
      owTotalCm: oog?.over_W_cm ?? 0,
      owEachCm: (oog?.over_W_cm ?? 0) / 2,
      owLeftCm: (oog?.over_W_cm ?? 0) / 2,
      owRightCm: (oog?.over_W_cm ?? 0) / 2,
      referenceWidthCm: 0,
      referenceHeightCm: 0,
    };
  };
  const dimensionHighlights = (metrics: string[]) => [
    metrics.includes("length") ? "最長" : "",
    metrics.includes("width") ? "最大幅" : "",
    metrics.includes("height") ? "最高" : "",
  ].filter(Boolean);

  return (
    <section className={printResultClassName} id="plan-results">
      <div className="print-report-header print-only">
        <div><h1>Container Loading Plan</h1><p>LoadPilot / {new Date().toLocaleString("ja-JP")}</p><small className="print-qr-instruction">{printQrInstruction}</small></div>
        <div className="print-qr-group">
          {printQrParts.map((part) => {
            const label = part.kind === "plan" ? "プラン" : "特殊仕様";
            const caption = part.partTotal > 1 ? `${label} ${part.partIndex}/${part.partTotal}` : label;
            return <figure key={`${part.kind}-${part.partIndex}`}><img src={part.dataUrl} alt={`${caption}復元用QRコード`} /><figcaption>{caption}</figcaption></figure>;
          })}
        </div>
        {printQrError && <span className="print-qr-error">データ量超過のためQRを掲載できません</span>}
      </div>
      <div className="results-heading">
        <div>
          <span className="eyebrow">PLANNING RESULT</span>
          <h2>{result.mode === "estimate" ? "推奨コンテナ構成" : "指定本数での積載検証"}</h2>
          <p>配置はヒューリスティック計算による計画案です。警告と積載不可貨物を必ず確認してください。</p>
        </div>
        <div className="result-actions no-print">
          <PlanShare plan={sharePlan} />
          <button className="button secondary" onClick={() => void runExport(() => exportPlacementsCsv(result))}><Download size={16} />CSV</button>
          <button className="button secondary" onClick={() => void runExport(() => exportExcelReport(result))}><FileSpreadsheet size={16} />Excel帳票</button>
          <button className="button secondary" onClick={() => setPrintOptionsOpen(true)}><Printer size={16} />印刷 / PDF</button>
        </div>
      </div>
      {exportError && <div className="global-error no-print" role="alert"><strong>帳票を出力できません</strong><p>{exportError}</p></div>}

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
        <div className="metric-card"><span className="metric-icon green"><Check /></span><div><small>積載済み</small><strong>{result.placements.length}<em> / {allPieces} PCS</em></strong><p>{allPieces ? fmt((result.placements.length / allPieces) * 100, 1) : "0.0"}%</p></div></div>
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
              const road = roadAssessments.get(key);
              return (
                <button key={key} className={key === selectedKey ? "container-list-item active" : "container-list-item"} onClick={() => setSelectedKey(key)}>
                  <span className="container-type-icon">{load.spec.type.slice(0, 2)}</span>
                  <span><strong>{containerLabel(load)}</strong><small>{load.placements.length} pcs · {fmt(kpi?.total_m3 ?? 0, 2)} m³</small></span>
                  {(kpi?.bias_warn || kpi?.weight_alert || Boolean(road && road.chassisLevel !== "ok") || Boolean(road?.specialPermitMessage)) && <AlertTriangle size={16} className="warning-icon" />}
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
            <div className="layout-stage"><ContainerLayout load={selectedLoad} oogResults={result.oog_results} /></div>
            {selectedLoad.placements.some((placement) => result.oog_results.get(placement.piece.piece_id)?.oog_flag) && (
              <div className="layout-oog-summary">
                {selectedLoad.placements.filter((placement) => result.oog_results.get(placement.piece.piece_id)?.oog_flag).map((placement) => {
                  const metrics = oogMetricsFor(placement.piece.piece_id);
                  return <span key={placement.piece.piece_id}><strong>{placement.piece.piece_id}</strong>　OW合計 +{fmt(metrics.owTotalCm, 1)} cm（左 +{fmt(metrics.owLeftCm, 1)} / 右 +{fmt(metrics.owRightCm, 1)} cm、貨物幅 {fmt(placement.orient_W_cm, 1)} / 基準幅 {fmt(metrics.referenceWidthCm, 1)} cm）　OH +{fmt(metrics.ohCm, 1)} cm</span>;
                })}
              </div>
            )}
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
                <small>{selectedRoad?.chassisLevel === "ok" ? "貨物＋風袋（2軸シャーシ範囲内）" : selectedRoad?.chassisLevel === "caution" ? "貨物＋風袋（要三軸シャーシ）" : "貨物＋風袋（輸送方法を要確認）"}</small>
              </div>
            </div>
            {(selectedBias?.bias_warn || selectedWeight?.weight_alert || selectedRoad?.chassisLevel === "warning") && (
              <div className="container-warning container-warning-danger"><AlertTriangle size={18} /><div><strong>このコンテナは要確認です</strong><p>{[selectedBias?.bias_reason, selectedWeight?.weight_alert_message, selectedRoad?.chassisLevel === "warning" ? selectedRoad.chassisMessage : undefined].filter(Boolean).join(" / ")}</p></div></div>
            )}
            {selectedRoad?.chassisLevel === "caution" && (
              <div className="container-warning chassis-caution"><AlertTriangle size={18} /><div><strong>注意：要三軸シャーシ</strong><p>{selectedRoad.chassisMessage}</p></div></div>
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
              <div><h3>{containerLabel(load)}</h3><p>総個数: {load.placements.length} PCS　/　総重量: {fmtInt(kpi?.total_gross_kg ?? 0)} kg　/　総容積: {fmt(kpi?.total_m3 ?? 0, 3)} m³</p></div>
              <ContainerLayout load={load} oogResults={result.oog_results} />
              {load.placements.filter((placement) => result.oog_results.get(placement.piece.piece_id)?.oog_flag).map((placement) => {
                const metrics = oogMetricsFor(placement.piece.piece_id);
                return <p key={placement.piece.piece_id}><strong>{placement.piece.piece_id}</strong>　OW合計 +{fmt(metrics.owTotalCm, 1)}cm（左 +{fmt(metrics.owLeftCm, 1)} / 右 +{fmt(metrics.owRightCm, 1)}cm）・ OH +{fmt(metrics.ohCm, 1)}cm</p>;
              })}
              <p>Payload {fmt(kpi?.payload_ratio_pct ?? 0, 1)}% ・ 重心偏差 X/Y {fmt(bias?.offset_x_pct ?? 0, 1)} / {fmt(bias?.offset_y_pct ?? 0, 1)}% ・ 総重量目安 {fmtInt(weight?.gross_weight_kg ?? 0)}kg</p>
            </article>
          );
        })}
      </div>

      <div className="print-only print-grand-total">
        <strong>全コンテナ・積載済み総計</strong>
        <span>総個数: {loadedTotals.pieces} PCS</span>
        <span>総重量: {fmtInt(loadedTotals.weight)} kg</span>
        <span>総容積: {fmt(loadedTotals.m3, 3)} m³</span>
      </div>

      <div className="result-table-section">
        <div className="section-title-row"><div><span className="eyebrow">CONTAINER REPORT</span><h3>コンテナ別集計・パッキングリスト</h3></div>
          <div className="report-view-switch no-print" role="group" aria-label="コンテナ帳票の表示切替">
            <button type="button" className={containerReportView === "summary" ? "active" : ""} onClick={() => setContainerReportView("summary")}>集計</button>
            <button type="button" className={containerReportView === "packing" ? "active" : ""} onClick={() => setContainerReportView("packing")}>パッキングリスト</button>
          </div>
        </div>
        <div className={containerReportView === "summary" ? "container-report-summary" : "container-report-summary report-view-hidden"}><div className="table-shell"><table className="data-table result-table"><thead><tr><th>コンテナ</th><th>pcs</th><th>F/T</th><th>M³</th><th>貨物重量</th><th>平均床荷重</th><th>Payload</th><th>容積</th><th>国内陸送・法令確認</th><th>監査</th></tr></thead><tbody>
          {kpis.map((kpi) => {
            const road = roadAssessments.get(kpi.container_key);
            const requiresReview = kpi.bias_warn || kpi.weight_alert || road?.chassisLevel === "warning" || Boolean(road?.specialPermitMessage);
            const requiresThreeAxle = road?.chassisLevel === "caution";
            const chassisMessageClass = road?.chassisLevel === "caution" ? "transport-caution" : road?.chassisLevel === "warning" ? "transport-warning" : undefined;
            return <tr key={kpi.container_key}><td><strong>{kpi.container_label}</strong></td><td>{kpi.piece_count}</td><td>{fmt(kpi.total_ft, 3)}</td><td>{fmt(kpi.total_m3, 3)}</td><td>{fmtInt(kpi.total_gross_kg)} kg</td><td>{fmtInt(road?.averageFloorLoadKgM2 ?? 0)} kg/m²<small className="cell-note">貨物重量÷内寸床面積</small></td><td>{fmt(kpi.payload_ratio_pct, 1)}%</td><td>{fmt(kpi.volume_ratio_pct, 1)}%</td><td className="transport-check-cell"><strong className={chassisMessageClass}>{road?.chassisMessage}</strong>{road?.specialPermitMessage && <small>{road.specialPermitMessage}</small>}{road?.escortMessage && <small>{road.escortMessage}</small>}</td><td className="audit-status-cell">{requiresReview && <span className="status-chip red">要確認</span>}{requiresThreeAxle && <span className="status-chip amber">注意：要三軸シャーシ</span>}{!requiresReview && !requiresThreeAxle && <span className="status-chip green">範囲内</span>}</td></tr>;
          })}
        </tbody><tfoot><tr><td><strong>積載済み総計</strong></td><td><strong>{loadedTotals.pieces}</strong></td><td><strong>{fmt(loadedTotals.ft, 3)}</strong></td><td><strong>{fmt(loadedTotals.m3, 3)}</strong></td><td><strong>{fmtInt(loadedTotals.weight)} kg</strong></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr></tfoot></table></div></div>
        <div className={containerReportView === "packing" ? "packing-list-view" : "packing-list-view report-view-hidden"}>
          <div className="packing-list-tools no-print"><span>コンテナを開くと個別明細を確認できます。</span><button type="button" onClick={() => setExpandedPackingLists(expandedPackingLists.size === packingLists.length ? new Set() : new Set(packingLists.map((list) => list.containerKey)))}>{expandedPackingLists.size === packingLists.length ? "すべて閉じる" : "すべて展開"}</button></div>
          {packingLists.map((list) => {
            const expanded = expandedPackingLists.has(list.containerKey);
            return <article className="packing-list-card" key={list.containerKey}>
              <button type="button" className="packing-list-heading" aria-expanded={expanded} onClick={() => togglePackingList(list.containerKey)}>
                <span><strong>{list.containerLabel}</strong><small>{list.pieceCount} PCS</small></span>
                <span className="packing-list-totals"><b>{fmtInt(list.totalWeightKg)} kg</b><b>{fmt(list.totalM3, 3)} m³</b><ChevronDown className={expanded ? "expanded" : ""} /></span>
              </button>
              <div className={expanded ? "packing-list-body" : "packing-list-body collapsed"}>
                <div className="table-shell"><table className="data-table packing-list-table"><thead><tr><th>配置No.</th><th>貨物ID</th><th>品名</th><th>荷姿</th><th>寸法 cm</th><th>GW</th><th>M³</th><th>積付け</th></tr></thead><tbody>
                  {list.items.map((item) => {
                    const dimensionBadges = dimensionHighlights(item.notableMetrics);
                    return <tr key={item.piece.piece_id}><td>{item.position}</td><td><strong>{item.piece.piece_id}</strong></td><td>{item.piece.desc}</td><td>{item.piece.package_text || "—"}</td><td className={dimensionBadges.length ? "notable-packing-cell" : ""}>{item.piece.L_cm} × {item.piece.W_cm} × {item.piece.H_cm}{dimensionBadges.map((label) => <small className="notable-badge" key={label}>{label}</small>)}</td><td className={item.notableMetrics.includes("weight") ? "notable-packing-cell" : ""}>{fmtInt(item.piece.weight_kg)} kg{item.notableMetrics.includes("weight") && <small className="notable-badge">最大GW</small>}</td><td className={item.notableMetrics.includes("volume") ? "notable-packing-cell" : ""}>{fmt(item.piece.m3, 3)}{item.notableMetrics.includes("volume") && <small className="notable-badge">最大m³</small>}</td><td>{item.placedZCm > 0 ? `段積み（床上 ${fmtInt(item.placedZCm)}cm）` : "床置き"}</td></tr>;
                  })}
                </tbody><tfoot><tr><td colSpan={4}><strong>{list.containerLabel} 合計</strong></td><td><strong>{list.pieceCount} PCS</strong></td><td><strong>{fmtInt(list.totalWeightKg)} kg</strong></td><td><strong>{fmt(list.totalM3, 3)}</strong></td><td>—</td></tr></tfoot></table></div>
              </div>
            </article>;
          })}
        </div>
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
          <div className="table-shell"><table className="data-table result-table"><thead><tr><th>貨物ID</th><th>基準</th><th>OL</th><th>OW total</th><th>OW each L/R</th><th>OH</th><th>入口</th><th>候補</th></tr></thead><tbody>
            {oogEntries.map(([pieceId, oog]) => { const metrics = oogMetricsFor(pieceId); return <tr key={pieceId}><td><strong>{pieceId}</strong></td><td>{oog.oog_ref_type}</td><td>{oog.over_L_cm} cm</td><td>{fmt(metrics.owTotalCm, 1)} cm</td><td>{fmt(metrics.owLeftCm, 1)} / {fmt(metrics.owRightCm, 1)} cm</td><td>{fmt(metrics.ohCm, 1)} cm</td><td>{oog.door_passable ? "通過可" : oog.door_reason}</td><td>{oog.suggestion || "標準"}</td></tr>;})}
          </tbody></table></div>
        </details>
      )}
      <p className="result-disclaimer">本結果は初期検討用です。国内陸送判定はコンテナ総重量（貨物＋コンテナ風袋）と貨物外形による注意喚起であり、シャーシ車検証、軸重・輪荷重、実車全高、通行経路、特殊車両通行許可・確認制度の回答書を必ず確認してください。誘導車の要否は許可経路に付されるC・D条件で確定します。床面に余裕がある間は平置きを優先しますが、残る隙間には移動防止措置が必要です。</p>
      {printOptionsOpen && (
        <div
          className="modal-backdrop no-print"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPrintOptionsOpen(false); }}
        >
          <section className="modal-card print-options-modal" role="dialog" aria-modal="true" aria-labelledby="print-options-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">PRINT OPTIONS</span>
                <h3 id="print-options-title">印刷設定</h3>
              </div>
            </div>
            <p>印刷プレビューを開く前に、帳票へ掲載する内容と色を選択できます。</p>
            <div className="print-options-list">
              <label className="print-option-row">
                <input
                  type="checkbox"
                  checked={includePrintQr}
                  onChange={(event) => setIncludePrintQr(event.target.checked)}
                />
                <span><strong>QRコードを掲載する</strong><small>モバイルでプランと特殊仕様を復元できます。</small></span>
              </label>
              <label className="print-option-row">
                <input
                  type="checkbox"
                  checked={printInColor}
                  onChange={(event) => setPrintInColor(event.target.checked)}
                />
                <span><strong>カラーで印刷する</strong><small>オフの場合はモノクロで印刷します（既定）。</small></span>
              </label>
            </div>
            <div className="modal-actions">
              <button className="button ghost" type="button" onClick={() => setPrintOptionsOpen(false)}>キャンセル</button>
              <button className="button primary" type="button" onClick={openPrintPreview}><Printer size={16} />印刷画面を開く</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
