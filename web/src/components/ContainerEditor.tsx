import { Download, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { parse, stringify } from "yaml";

import { DEFAULT_CONTAINERS } from "../domain/constants";
import type { ContainerSpec } from "../domain/types";

interface ContainerEditorProps {
  specs: ContainerSpec[];
  onChange: (specs: ContainerSpec[]) => void;
}

type NumericField = Exclude<keyof ContainerSpec, "type" | "category">;

export function ContainerEditor({ specs, onChange }: ContainerEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const update = (index: number, field: NumericField, value: string) => {
    onChange(specs.map((spec, current) => current === index ? { ...spec, [field]: Number(value) || 0 } : spec));
  };
  const downloadYaml = () => {
    const body = stringify({ containers: specs.map(({ tare_weight_kg, ...spec }) => ({ ...spec, tare_weight_kg })) });
    const url = URL.createObjectURL(new Blob([body], { type: "text/yaml;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "containers.yaml"; link.click(); URL.revokeObjectURL(url);
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      const data = parse(await file.text()) as { containers?: Partial<ContainerSpec>[] };
      if (!Array.isArray(data.containers) || !data.containers.length) throw new Error("containers配列がありません。");
      const normalized = data.containers.map((raw) => ({
        type: String(raw.type ?? "").trim(),
        category: raw.category === "SPECIAL" ? "SPECIAL" : "STANDARD",
        inner_L_cm: Number(raw.inner_L_cm ?? 0), inner_W_cm: Number(raw.inner_W_cm ?? 0), inner_H_cm: Number(raw.inner_H_cm ?? 0),
        door_W_cm: raw.door_W_cm == null ? undefined : Number(raw.door_W_cm), door_H_cm: raw.door_H_cm == null ? undefined : Number(raw.door_H_cm),
        deck_L_cm: raw.deck_L_cm == null ? undefined : Number(raw.deck_L_cm), deck_W_cm: raw.deck_W_cm == null ? undefined : Number(raw.deck_W_cm),
        max_payload_kg: Number(raw.max_payload_kg ?? 0), cost: Number(raw.cost ?? 0), tare_weight_kg: Number(raw.tare_weight_kg ?? 0),
      } satisfies ContainerSpec));
      if (normalized.some((spec) => !spec.type || spec.inner_L_cm <= 0 || spec.inner_W_cm <= 0 || spec.inner_H_cm <= 0 || spec.max_payload_kg <= 0)) throw new Error("必須の仕様値が0または空です。");
      onChange(normalized); setMessage(`${normalized.length}タイプを読み込みました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "読み込みに失敗しました。"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };
  return (
    <main className="page-shell specs-page">
      <div className="page-intro split-intro">
        <div><span className="eyebrow">CONTAINER MASTER</span><h1>コンテナ仕様</h1><p>使用する実コンテナの仕様が分かる場合は、その数値へ差し替えてください。</p></div>
        <div className="intro-actions">
          <input ref={fileRef} hidden type="file" accept=".yaml,.yml" onChange={(e) => void readFile(e.target.files?.[0])} />
          <button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={16} />YAML読込</button>
          <button className="button secondary" onClick={downloadYaml}><Download size={16} />YAML保存</button>
          <button className="button ghost" onClick={() => onChange(DEFAULT_CONTAINERS.map((spec) => ({ ...spec })))}><RotateCcw size={16} />初期値</button>
        </div>
      </div>
      {message && <div className="inline-message success"><span>{message}</span></div>}
      <section className="panel specs-panel">
        <div className="table-shell"><table className="data-table specs-table"><thead><tr><th>Type</th><th>区分</th><th>内寸L</th><th>内寸W</th><th>内寸H</th><th>Door W</th><th>Door H</th><th>Payload kg</th><th>風袋 kg</th><th>評価係数</th></tr></thead><tbody>
          {specs.map((spec, index) => <tr key={`${spec.type}-${index}`}><td><strong>{spec.type}</strong></td><td><span className={spec.category === "SPECIAL" ? "status-chip amber" : "status-chip blue"}>{spec.category}</span></td>
            {(["inner_L_cm", "inner_W_cm", "inner_H_cm", "door_W_cm", "door_H_cm", "max_payload_kg", "tare_weight_kg", "cost"] as NumericField[]).map((field) => <td key={field}><input type="number" min="0" step="any" value={spec[field] ?? ""} onChange={(e) => update(index, field, e.target.value)} /></td>)}
          </tr>)}
        </tbody></table></div>
        <div className="spec-notes">
          <div><strong>寸法値</strong><p>代表値です。製造年、運航会社、機材により差があります。Door寸法は入口通過判定に使います。</p></div>
          <div><strong>特殊コンテナ</strong><p>OT・FRの高さ／幅方向は開放条件として扱います。実際のOOG許容値、固縛、船積可否は船社確認が必要です。</p></div>
          <div><strong>評価係数</strong><p>本数が同じ候補の比較順に使う相対値です。実運賃ではありません。</p></div>
        </div>
      </section>
    </main>
  );
}

