import { ArrowRightLeft, Box, Calculator } from "lucide-react";
import { useMemo, useState } from "react";

import { CW_KG_PER_M3, MT_M3, RT_M3, SAI_M3 } from "../domain/constants";
import { fmt } from "../domain/rounding";

export function VolumeConverter() {
  const [mode, setMode] = useState<"dimensions" | "m3">("dimensions");
  const [length, setLength] = useState(100);
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
  const [m3Input, setM3Input] = useState(1);
  const [grossWeightKg, setGrossWeightKg] = useState(100);
  const m3 = useMemo(
    () => (mode === "dimensions" ? Math.max(0, length * width * height) / 1_000_000 : Math.max(0, m3Input)),
    [mode, length, width, height, m3Input],
  );
  const airVolumetricWeightKg = m3 * CW_KG_PER_M3;
  const chargeableWeightKg = Math.max(Math.max(0, grossWeightKg), airVolumetricWeightKg);
  const chargeableBasis = grossWeightKg >= airVolumetricWeightKg ? "重量勝ち（実重量を採用）" : "容積勝ち（容積重量を採用）";
  const metrics = [
    { label: "体積", value: fmt(m3, 3), unit: "m³", note: "基準値" },
    { label: "才数", value: fmt(m3 / SAI_M3, 1), unit: "才", note: "1才 = 0.0278m³" },
    { label: "実重量", value: fmt(Math.max(0, grossWeightKg), 1), unit: "kg", note: "入力した貨物総重量" },
    { label: "航空容積重量", value: fmt(airVolumetricWeightKg, 1), unit: "kg", note: "1m³ = 166.67kg" },
    { label: "航空チャージャブルウェイト", value: fmt(chargeableWeightKg, 1), unit: "kg", note: chargeableBasis, accent: true },
    { label: "Revenue Ton", value: fmt(m3 / RT_M3, 3), unit: "RT", note: "1RT = 2.83m³" },
    { label: "Measurement Ton", value: fmt(m3 / MT_M3, 3), unit: "MT", note: "1MT = 1.1327m³" },
  ];
  return (
    <main className="page-shell converter-page">
      <div className="page-intro">
        <span className="eyebrow">UNIT CONVERTER</span>
        <h1>容積・物流単位換算</h1>
        <p>容積と実重量から、才数・航空チャージャブルウェイト・RT・MTを同時換算します。</p>
      </div>
      <section className="panel converter-panel">
        <div className="converter-mode">
          <button className={mode === "dimensions" ? "active" : ""} onClick={() => setMode("dimensions")}><Box />cmディメンション</button>
          <button className={mode === "m3" ? "active" : ""} onClick={() => setMode("m3")}><Calculator />m³を直接入力</button>
        </div>
        <div className="converter-input-area">
          {mode === "dimensions" ? (
            <div className="dimension-row">
              <label><span>長さ</span><div className="unit-input large"><input type="number" min="0" step="1" value={length} onChange={(e) => setLength(Number(e.target.value))} /><span>cm</span></div></label>
              <b>×</b>
              <label><span>幅</span><div className="unit-input large"><input type="number" min="0" step="1" value={width} onChange={(e) => setWidth(Number(e.target.value))} /><span>cm</span></div></label>
              <b>×</b>
              <label><span>高さ</span><div className="unit-input large"><input type="number" min="0" step="1" value={height} onChange={(e) => setHeight(Number(e.target.value))} /><span>cm</span></div></label>
            </div>
          ) : (
            <label className="single-converter-input"><span>体積</span><div className="unit-input large"><input type="number" min="0" step="0.1" value={m3Input} onChange={(e) => setM3Input(Number(e.target.value))} /><span>m³</span></div></label>
          )}
          <label className="single-converter-input weight-converter-input"><span>貨物総重量（実重量）</span><div className="unit-input large"><input type="number" min="0" step="0.1" value={grossWeightKg} onChange={(e) => setGrossWeightKg(Number(e.target.value))} /><span>kg</span></div></label>
          <ArrowRightLeft className="converter-arrow" />
        </div>
        <div className="conversion-results">
          {metrics.map((metric, index) => (
            <div key={metric.label} className={`conversion-card${index === 0 ? " primary" : ""}${metric.accent ? " chargeable" : ""}`}>
              <small>{metric.label}</small><strong>{metric.value}<em>{metric.unit}</em></strong><p>{metric.note}</p>
            </div>
          ))}
        </div>
        <div className="formula-note"><strong>換算上の注意</strong><p>航空チャージャブルウェイトは、実重量と航空容積重量の大きい方を表示します。運賃計算ではキャリアや輸送モードごとに端数処理・最低重量・換算係数が異なる場合があるため、最終的には適用タリフを確認してください。</p></div>
      </section>
    </main>
  );
}
