import { AlertTriangle, Boxes, ChevronDown, Gauge, LockKeyhole, MousePointer2, Route } from "lucide-react";

import { customContainerSpecsFromEffective, STANDARD_CONTAINER_PROFILE_LABEL } from "../domain/containerProfiles";
import type { ContainerSpec, PlanningMode, PlanningSettings } from "../domain/types";

interface PlanSettingsProps {
  mode: PlanningMode;
  onModeChange: (mode: PlanningMode) => void;
  specs: ContainerSpec[];
  counts: Record<string, number>;
  onCountsChange: (counts: Record<string, number>) => void;
  settings: PlanningSettings;
  onSettingsChange: (settings: PlanningSettings) => void;
}

export function PlanSettings({
  mode,
  onModeChange,
  specs,
  counts,
  onCountsChange,
  settings,
  onSettingsChange,
}: PlanSettingsProps) {
  const customSpecCount = customContainerSpecsFromEffective(specs).length;
  const setSetting = <K extends keyof PlanningSettings>(key: K, value: PlanningSettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });

  return (
    <section className="panel settings-panel">
      <div className="panel-heading compact">
        <div>
          <div className="step-label"><span>2</span>計算条件</div>
          <h2>計画の目的を選択</h2>
        </div>
      </div>
      <div className="mode-selector" role="radiogroup" aria-label="計算モード">
        <button type="button" role="radio" aria-checked={mode === "estimate"} className={mode === "estimate" ? "mode-card active" : "mode-card"} onClick={() => onModeChange("estimate")}>
          <span className="mode-icon"><Route /></span>
          <span><strong>必要本数を見積もる</strong><small>総容積・総重量で20GP小口判定後、40HCを基準に提案</small></span>
          <span className="radio-dot" />
        </button>
        <button type="button" role="radio" aria-checked={mode === "validate"} className={mode === "validate" ? "mode-card active" : "mode-card"} onClick={() => onModeChange("validate")}>
          <span className="mode-icon"><LockKeyhole /></span>
          <span><strong>決まった本数で検証</strong><small>指定構成に収まるかを確認</small></span>
          <span className="radio-dot" />
        </button>
        <button type="button" role="radio" aria-checked={mode === "manual"} className={mode === "manual" ? "mode-card active" : "mode-card"} onClick={() => onModeChange("manual")}>
          <span className="mode-icon"><MousePointer2 /></span>
          <span><strong>手動でバン詰めする</strong><small>縮尺ボックスを自分で配置してCLPを作成</small></span>
          <span className="radio-dot" />
        </button>
      </div>

      {mode === "estimate" ? (
        <div className="setting-note">
          <Boxes size={19} />
          <div>
            <strong>{customSpecCount ? `基本マスター＋編集コンテナ${customSpecCount}タイプを評価します` : "固定の基本コンテナ情報を使用します"}</strong>
            <p>{customSpecCount ? "コンテナ設定でプランへ読み込んだ実機値を反映します。" : `${STANDARD_CONTAINER_PROFILE_LABEL}をそのまま採用し、コンテナ寸法はQRへ格納しません。`} 総容積・総重量と実配置が20GP 1本に収まる小口は20GP、それ以外は40HCで計画し、40GP代用可否を結果へ表示します。</p>
          </div>
        </div>
      ) : (
        <div className="count-settings">
          <div className="subheading-row"><div><strong>使用できるコンテナ本数</strong><small>0本のタイプは計算に使用しません。</small></div><span>{Object.values(counts).reduce((sum, count) => sum + count, 0)}本</span></div>
          <div className="container-count-grid">
            {specs.map((spec) => (
              <label key={spec.type} className={spec.category === "SPECIAL" ? "container-count special" : "container-count"}>
                <span><strong>{spec.type}</strong><small>{spec.category === "SPECIAL" ? "特殊" : "標準"}</small></span>
                <span className="stepper">
                  <button type="button" aria-label={`${spec.type}を1本減らす`} onClick={() => onCountsChange({ ...counts, [spec.type]: Math.max(0, (counts[spec.type] ?? 0) - 1) })}>−</button>
                  <input
                    type="number"
                    aria-label={`${spec.type}の本数`}
                    min="0"
                    max="100"
                    step="1"
                    value={counts[spec.type] ?? 0}
                    onChange={(event) => onCountsChange({ ...counts, [spec.type]: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
                  />
                  <button type="button" aria-label={`${spec.type}を1本増やす`} onClick={() => onCountsChange({ ...counts, [spec.type]: Math.min(100, (counts[spec.type] ?? 0) + 1) })}>＋</button>
                </span>
              </label>
            ))}
          </div>
          <div className="small-warning"><AlertTriangle size={15} />{mode === "manual" ? "選択したコンテナへ貨物を手動配置します。重なり、範囲外、Payload、混載不可を検査し、高さ差100cm以上は結果で注意喚起します。" : "標準コンテナは大型貨物をトラック側から床置き優先で積載します。OT・FRは大型順を必須とせず、FRの小口貨物制約と重心配慮を適用します。"}</div>
        </div>
      )}

      <details className="advanced-settings">
        <summary><span><Gauge size={17} />警告・監査条件</span><ChevronDown size={17} /></summary>
        <div className="advanced-grid">
          <label>
            <span>偏荷重警告閾値<small>重心偏差・左右前後差</small></span>
            <div className="unit-input"><input type="number" min="0" max="100" step="1" value={settings.bias_threshold_pct} onChange={(e) => setSetting("bias_threshold_pct", Number(e.target.value))} /><span>%</span></div>
          </label>
          <label>
            <span>車両総重量の目安<small>貨物＋コンテナ風袋</small></span>
            <div className="unit-input"><input type="number" min="0" step="1000" value={settings.vehicle_gross_limit_kg ?? ""} onChange={(e) => setSetting("vehicle_gross_limit_kg", e.target.value ? Number(e.target.value) : null)} /><span>kg</span></div>
          </label>
          <label>
            <span>Payload近接警告<small>最大積載重量に対する比率</small></span>
            <div className="unit-input"><input type="number" min="0" max="100" step="1" value={settings.payload_near_threshold_pct} onChange={(e) => setSetting("payload_near_threshold_pct", Number(e.target.value))} /><span>%</span></div>
          </label>
          <label>
            <span>重量集中警告<small>上位{settings.concentration_top_n}個の重量比率</small></span>
            <div className="unit-input"><input type="number" min="0" max="100" step="1" value={settings.concentration_warn_threshold_pct} onChange={(e) => setSetting("concentration_warn_threshold_pct", Number(e.target.value))} /><span>%</span></div>
          </label>
        </div>
      </details>
    </section>
  );
}
