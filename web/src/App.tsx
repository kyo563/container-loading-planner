import { ArrowRight, Boxes, CheckCircle2, Lock, Ruler, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CargoInput } from "./components/CargoInput";
import { ContainerEditor } from "./components/ContainerEditor";
import { Guide } from "./components/Guide";
import { Header } from "./components/Header";
import { PlanResults } from "./components/PlanResults";
import { PlanSettings } from "./components/PlanSettings";
import { VolumeConverter } from "./components/VolumeConverter";
import { DEFAULT_CONTAINERS, DEFAULT_SETTINGS, SAMPLE_CARGO } from "./domain/constants";
import { expandPieces, validateCargoRows } from "./domain/input";
import { estimatePlan, validatePlan } from "./domain/planner";
import { decodeSharedPlan, tokenFromHash } from "./domain/sharedPlan";
import type { AppView, CargoRow, ContainerSpec, PlanResult, PlanningSettings, ValidationIssue } from "./domain/types";

const MAX_BROWSER_PIECES = 5_000;
const DEFAULT_COUNTS: Record<string, number> = { "20GP": 0, "40GP": 0, "40HC": 1, "20OT": 0, "40OT": 0, "20FR": 0, "40FR": 0, RF: 0 };

function PlannerPage({
  rows,
  setRows,
  isSample,
  setIsSample,
  specs,
  mode,
  setMode,
  counts,
  setCounts,
  settings,
  setSettings,
  restoreRevision,
  restoreMessage,
}: {
  rows: CargoRow[];
  setRows: (rows: CargoRow[]) => void;
  isSample: boolean;
  setIsSample: (value: boolean) => void;
  specs: ContainerSpec[];
  mode: "estimate" | "validate";
  setMode: (value: "estimate" | "validate") => void;
  counts: Record<string, number>;
  setCounts: (value: Record<string, number>) => void;
  settings: PlanningSettings;
  setSettings: (value: PlanningSettings) => void;
  restoreRevision: number;
  restoreMessage: string;
}) {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const handledRestoreRevision = useRef(0);

  const invalidateResult = () => {
    setResult(null);
    setError("");
  };
  const changeRows = (next: CargoRow[], source: "sample" | "user" = "user") => {
    setRows(next);
    setIsSample(source === "sample");
    setIssues([]);
    invalidateResult();
  };
  const calculate = () => {
    setError("");
    const foundIssues = validateCargoRows(rows);
    setIssues(foundIssues);
    if (!rows.length) {
      setError("貨物データを入力してください。");
      return;
    }
    if (foundIssues.length) {
      setError(`入力内容に${foundIssues.length}件の問題があります。赤枠のセルを修正してください。`);
      return;
    }
    const totalPieces = rows.reduce((sum, row) => sum + row.qty, 0);
    if (totalPieces > MAX_BROWSER_PIECES) {
      setError(`合計${totalPieces.toLocaleString()}ピースです。ブラウザを停止させないため、1回の計算は${MAX_BROWSER_PIECES.toLocaleString()}ピース以下に分割してください。`);
      return;
    }
    if (mode === "validate" && !Object.values(counts).some((count) => count > 0)) {
      setError("使用するコンテナ本数を1本以上入力してください。");
      return;
    }
    if (!specs.some((spec) => spec.category === "STANDARD")) {
      setError("STANDARDコンテナ仕様がありません。コンテナ仕様画面を確認してください。");
      return;
    }
    setCalculating(true);
    window.setTimeout(() => {
      try {
        const pieces = expandPieces(rows);
        const next = mode === "estimate" ? estimatePlan(pieces, specs, settings) : validatePlan(pieces, specs, counts, settings);
        setResult(next);
        window.setTimeout(() => document.getElementById("plan-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "計算中にエラーが発生しました。");
      } finally {
        setCalculating(false);
      }
    }, 30);
  };

  useEffect(() => {
    if (!restoreRevision || handledRestoreRevision.current === restoreRevision) return;
    handledRestoreRevision.current = restoreRevision;
    calculate();
  }, [restoreRevision]);

  return (
    <main>
      <section className="planner-hero no-print">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow light">CONTAINER LOADING PLANNER</span>
            <h1>積載判断を、<br /><em>速く・見える形に。</em></h1>
            <p>貨物寸法と重量から、必要本数・OOG・配置・偏荷重を一括確認。<br className="desktop-only" />初期見積りからバンニング検討まで、ブラウザ内で完結します。</p>
            <div className="hero-badges"><span><ShieldCheck />外部送信なし</span><span><Ruler />OOG判定</span><span><Boxes />混載計画</span></div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="wire-container"><i /><i /><i /><span>40HC</span></div>
            <div className="cargo-cube cube-a" /><div className="cargo-cube cube-b" /><div className="cargo-cube cube-c" />
            <div className="hero-stat"><CheckCircle2 /><span><small>CLIENT-SIDE</small><strong>Privacy first</strong></span></div>
          </div>
        </div>
      </section>

      <div className="planner-shell no-print">
        {restoreMessage && <div className="restore-banner" role="status"><CheckCircle2 /><div><strong>共有プランを復元しました</strong><p>{restoreMessage}</p></div></div>}
        <div className="planner-grid">
          <CargoInput rows={rows} issues={issues} onChange={changeRows} isSample={isSample} />
          <PlanSettings
            mode={mode}
            onModeChange={(next) => { setMode(next); invalidateResult(); }}
            specs={specs}
            counts={counts}
            onCountsChange={(next) => { setCounts(next); invalidateResult(); }}
            settings={settings}
            onSettingsChange={(next) => { setSettings(next); invalidateResult(); }}
          />
        </div>
        <section className="run-panel">
          <div><span className="step-label"><span>3</span>計算実行</span><strong>{mode === "estimate" ? "貨物に合うコンテナ構成を算出します" : "指定した本数への収まりを検証します"}</strong><small>結果変更後は再計算が必要です。</small></div>
          <button className="run-button" onClick={calculate} disabled={calculating}>
            {calculating ? <span className="spinner" /> : <Sparkles />}
            {calculating ? "計算中…" : mode === "estimate" ? "必要本数を計算" : "積載プランを作成"}
            {!calculating && <ArrowRight />}
          </button>
        </section>
        {error && <div className="global-error" role="alert"><strong>計算を実行できません</strong><p>{error}</p>{issues.length > 0 && <ul>{issues.slice(0, 5).map((issue, index) => <li key={`${issue.row}-${issue.field}-${index}`}>{issue.row}行目: {issue.message}</li>)}</ul>}</div>}
      </div>
      {result && <div className="results-shell"><PlanResults result={result} sharePlan={{ rows, mode, counts, settings, specs }} /></div>}
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<AppView>("planner");
  const [rows, setRows] = useState<CargoRow[]>(() => SAMPLE_CARGO.map((row) => ({ ...row })));
  const [isSample, setIsSample] = useState(true);
  const [specs, setSpecs] = useState<ContainerSpec[]>(() => DEFAULT_CONTAINERS.map((spec) => ({ ...spec })));
  const [mode, setMode] = useState<"estimate" | "validate">("estimate");
  const [counts, setCounts] = useState<Record<string, number>>({ ...DEFAULT_COUNTS });
  const [settings, setSettings] = useState<PlanningSettings>({ ...DEFAULT_SETTINGS });
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    const token = tokenFromHash(window.location.hash);
    if (!token) return;
    void decodeSharedPlan(token).then((shared) => {
      setRows(shared.rows);
      setIsSample(false);
      setSpecs(shared.specs);
      setMode(shared.mode);
      setCounts(shared.counts);
      setSettings(shared.settings);
      setView("planner");
      setRestoreError("");
      setRestoreMessage(`${shared.rows.length}行の貨物情報と計算条件を読み込み、積載プランを再計算しました。`);
      setRestoreRevision((current) => current + 1);
    }).catch((caught: unknown) => {
      setRestoreMessage("");
      setRestoreError(caught instanceof Error ? caught.message : "共有プランを読み込めませんでした。");
    });
  }, []);

  return (
    <div className="app">
      <Header current={view} onNavigate={setView} />
      {restoreError && <div className="restore-error" role="alert"><strong>共有プランを読み込めません</strong><p>{restoreError}</p></div>}
      {view === "planner" && <PlannerPage rows={rows} setRows={setRows} isSample={isSample} setIsSample={setIsSample} specs={specs} mode={mode} setMode={setMode} counts={counts} setCounts={setCounts} settings={settings} setSettings={setSettings} restoreRevision={restoreRevision} restoreMessage={restoreMessage} />}
      {view === "converter" && <VolumeConverter />}
      {view === "containers" && <ContainerEditor specs={specs} onChange={setSpecs} />}
      {view === "guide" && <Guide />}
      <footer className="site-footer no-print"><div><span className="brand-mark small"><Boxes size={17} /></span><strong>LoadPilot</strong></div><p>初期積載検討を支援するオープンソースツールです。最終判断は実機材・法令・運送条件を確認してください。</p><span><Lock size={14} />データは保存・送信されません</span></footer>
    </div>
  );
}
