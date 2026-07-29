import { Check, CopyPlus, Download, Library, LockKeyhole, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parse, stringify } from "yaml";

import {
  containerSpecsForProfile,
  customContainerSpecsFromEffective,
  effectiveContainerSpecs,
  isStandardContainerType,
  STANDARD_CONTAINER_PROFILE_ID,
  STANDARD_CONTAINER_PROFILE_LABEL,
} from "../domain/containerProfiles";
import type { ContainerCategory, ContainerSpec } from "../domain/types";
import { assertValidContainerSpecs } from "../domain/validation";

interface ContainerEditorProps {
  activeCustomSpecs: ContainerSpec[];
  onActiveCustomSpecsChange: (specs: ContainerSpec[]) => void;
}

type NumericField = Exclude<keyof ContainerSpec, "type" | "category">;
type Message = { tone: "success" | "error"; text: string } | null;

const CUSTOM_LIBRARY_STORAGE_KEY = "loadpilot.custom-container-library.v1";
const CUSTOM_LIBRARY_FORMAT = "loadpilot-custom-containers-v1";
const MAX_CUSTOM_CONTAINERS = 50;

const normalizeSpec = (raw: Partial<ContainerSpec>): ContainerSpec => ({
  type: String(raw.type ?? "").trim(),
  category: raw.category === "SPECIAL" ? "SPECIAL" : "STANDARD",
  inner_L_cm: Number(raw.inner_L_cm ?? 0),
  inner_W_cm: Number(raw.inner_W_cm ?? 0),
  inner_H_cm: Number(raw.inner_H_cm ?? 0),
  ...(raw.door_W_cm == null ? {} : { door_W_cm: Number(raw.door_W_cm) }),
  ...(raw.door_H_cm == null ? {} : { door_H_cm: Number(raw.door_H_cm) }),
  ...(raw.deck_L_cm == null ? {} : { deck_L_cm: Number(raw.deck_L_cm) }),
  ...(raw.deck_W_cm == null ? {} : { deck_W_cm: Number(raw.deck_W_cm) }),
  max_payload_kg: Number(raw.max_payload_kg ?? 0),
  cost: Number(raw.cost ?? 0),
  tare_weight_kg: Number(raw.tare_weight_kg ?? 0),
});

const loadStoredLibrary = (): ContainerSpec[] => {
  try {
    const stored = window.localStorage.getItem(CUSTOM_LIBRARY_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as { format?: string; containers?: Partial<ContainerSpec>[] };
    if (parsed.format !== CUSTOM_LIBRARY_FORMAT || !Array.isArray(parsed.containers)) return [];
    const normalized = parsed.containers.slice(0, MAX_CUSTOM_CONTAINERS).map(normalizeSpec);
    assertValidContainerSpecs(effectiveContainerSpecs(normalized));
    return normalized;
  } catch {
    return [];
  }
};

const mergeLibrarySpecs = (library: ContainerSpec[], incoming: ContainerSpec[]): ContainerSpec[] => {
  const incomingByType = new Map(incoming.map((spec) => [spec.type, spec]));
  return [
    ...library.map((spec) => ({ ...(incomingByType.get(spec.type) ?? spec) })),
    ...incoming.filter((spec) => !library.some((item) => item.type === spec.type)).map((spec) => ({ ...spec })),
  ].slice(0, MAX_CUSTOM_CONTAINERS);
};

const nextSocType = (baseType: string, library: ContainerSpec[]): string => {
  const used = new Set(library.map((spec) => spec.type));
  const prefix = `${baseType}-SOC`;
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
};

export function ContainerEditor({ activeCustomSpecs, onActiveCustomSpecsChange }: ContainerEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const standardSpecs = containerSpecsForProfile(STANDARD_CONTAINER_PROFILE_ID);
  const [librarySpecs, setLibrarySpecs] = useState<ContainerSpec[]>(() =>
    mergeLibrarySpecs(loadStoredLibrary(), activeCustomSpecs));
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    setLibrarySpecs((current) => mergeLibrarySpecs(current, activeCustomSpecs));
  }, [activeCustomSpecs]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_LIBRARY_STORAGE_KEY, JSON.stringify({
        format: CUSTOM_LIBRARY_FORMAT,
        containers: librarySpecs,
      }));
    } catch {
      // 保存容量やプライベートモードで失敗しても、現在の画面内では編集を継続する。
    }
  }, [librarySpecs]);

  const updateText = (index: number, value: string) => {
    setLibrarySpecs((current) =>
      current.map((spec, currentIndex) => currentIndex === index ? { ...spec, type: value } : spec));
  };

  const updateCategory = (index: number, value: ContainerCategory) => {
    setLibrarySpecs((current) =>
      current.map((spec, currentIndex) => currentIndex === index ? { ...spec, category: value } : spec));
  };

  const updateNumber = (index: number, field: NumericField, value: string) => {
    setLibrarySpecs((current) => current.map((spec, currentIndex) => {
      if (currentIndex !== index) return spec;
      if (!value && ["door_W_cm", "door_H_cm", "deck_L_cm", "deck_W_cm"].includes(field)) {
        const next = { ...spec };
        delete next[field];
        return next;
      }
      return { ...spec, [field]: Number(value) || 0 };
    }));
  };

  const duplicateStandard = (standard: ContainerSpec) => {
    if (librarySpecs.length >= MAX_CUSTOM_CONTAINERS) {
      setMessage({ tone: "error", text: `編集コンテナは最大${MAX_CUSTOM_CONTAINERS}タイプです。` });
      return;
    }
    const copy = { ...standard, type: nextSocType(standard.type, librarySpecs) };
    setLibrarySpecs((current) => [...current, copy]);
    setMessage({ tone: "success", text: `${standard.type}をSOC編集用として複製しました。下の編集コンテナ欄で実機値を入力してください。` });
  };

  const addCustom = () => {
    const source = standardSpecs.find((spec) => spec.type === "40GP") ?? standardSpecs[0];
    duplicateStandard(source);
  };

  const applyToPlan = (spec: ContainerSpec) => {
    try {
      const normalized = normalizeSpec(spec);
      const next = [
        ...activeCustomSpecs.filter((item) => item.type !== normalized.type),
        normalized,
      ];
      assertValidContainerSpecs(effectiveContainerSpecs(next));
      onActiveCustomSpecsChange(next);
      setMessage({
        tone: "success",
        text: `${normalized.type}をこのプランへ読み込みました。QRでは標準定義との差分だけを別のカスタム仕様QRへ保存します。`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "コンテナ仕様を適用できませんでした。" });
    }
  };

  const removeFromPlan = (type: string) => {
    onActiveCustomSpecsChange(activeCustomSpecs.filter((spec) => spec.type !== type));
    setMessage({ tone: "success", text: `${type}の利用を解除しました。該当する基本タイプは固定マスターへ戻ります。` });
  };

  const removeFromLibrary = (index: number) => {
    const target = librarySpecs[index];
    setLibrarySpecs((current) => current.filter((_, currentIndex) => currentIndex !== index));
    if (target) onActiveCustomSpecsChange(activeCustomSpecs.filter((spec) => spec.type !== target.type));
    setMessage({ tone: "success", text: `${target?.type || "編集コンテナ"}をライブラリから削除しました。` });
  };

  const downloadYaml = () => {
    const body = stringify({
      format: CUSTOM_LIBRARY_FORMAT,
      base_profile: STANDARD_CONTAINER_PROFILE_ID,
      containers: librarySpecs,
    });
    const url = URL.createObjectURL(new Blob([body], { type: "text/yaml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "loadpilot-custom-containers.yaml";
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      const data = parse(await file.text()) as { containers?: Partial<ContainerSpec>[] };
      if (!Array.isArray(data.containers) || !data.containers.length) throw new Error("containers配列がありません。");
      if (data.containers.length > MAX_CUSTOM_CONTAINERS) {
        throw new Error(`編集コンテナは最大${MAX_CUSTOM_CONTAINERS}タイプです。`);
      }
      const normalized = data.containers.map(normalizeSpec);
      const customOnly = customContainerSpecsFromEffective(normalized);
      if (!customOnly.length) throw new Error("基本マスターと異なる編集コンテナが含まれていません。");
      assertValidContainerSpecs(effectiveContainerSpecs(customOnly));
      setLibrarySpecs(customOnly);
      setMessage({
        tone: "success",
        text: `${customOnly.length}タイプを編集ライブラリへ読み込みました。使用するタイプの「プランへ読込」を押してください。`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "読み込みに失敗しました。" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <main className="page-shell specs-page">
      <div className="page-intro split-intro">
        <div>
          <span className="eyebrow">CONTAINER SETTINGS</span>
          <h1>コンテナ設定</h1>
          <p>基本コンテナは固定マスターを使用します。SOC・実機差がある場合だけ編集コンテナを作成し、このプランへ読み込んでください。</p>
        </div>
        <div className="intro-actions">
          <input ref={fileRef} hidden type="file" accept=".yaml,.yml" onChange={(event) => void readFile(event.target.files?.[0])} />
          <button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={16} />編集YAML読込</button>
          <button className="button secondary" onClick={downloadYaml} disabled={!librarySpecs.length}><Download size={16} />編集YAML保存</button>
          <button className="button ghost" onClick={() => onActiveCustomSpecsChange([])} disabled={!activeCustomSpecs.length}><RotateCcw size={16} />基本設定へ戻す</button>
        </div>
      </div>

      {message && <div className={`inline-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}><span>{message.text}</span></div>}

      <section className="panel specs-panel">
        <div className="specs-section-heading">
          <div>
            <span className="specs-heading-icon locked"><LockKeyhole size={17} /></span>
            <div><strong>基本コンテナ情報</strong><p>{STANDARD_CONTAINER_PROFILE_LABEL}。原則変更不可で、指定がなければこの定義をそのまま採用します。</p></div>
          </div>
          <span className="status-chip green">固定・QR格納不要</span>
        </div>
        <div className="table-shell">
          <table className="data-table specs-table standard-specs-table">
            <thead><tr><th>Type</th><th>区分</th><th>内寸 L×W×H</th><th>Door W×H</th><th>Deck L×W</th><th>Payload</th><th>風袋</th><th>評価係数</th><th>編集コンテナ</th></tr></thead>
            <tbody>
              {standardSpecs.map((spec) => (
                <tr key={spec.type}>
                  <td><strong>{spec.type}</strong></td>
                  <td><span className={spec.category === "SPECIAL" ? "status-chip amber" : "status-chip blue"}>{spec.category}</span></td>
                  <td><span className="fixed-spec-value">{spec.inner_L_cm} × {spec.inner_W_cm} × {spec.inner_H_cm} cm</span></td>
                  <td><span className="fixed-spec-value">{spec.door_W_cm && spec.door_H_cm ? `${spec.door_W_cm} × ${spec.door_H_cm} cm` : "開放／対象外"}</span></td>
                  <td><span className="fixed-spec-value">{spec.deck_L_cm && spec.deck_W_cm ? `${spec.deck_L_cm} × ${spec.deck_W_cm} cm` : "—"}</span></td>
                  <td>{spec.max_payload_kg.toLocaleString()} kg</td>
                  <td>{spec.tare_weight_kg.toLocaleString()} kg</td>
                  <td>{spec.cost}</td>
                  <td><button className="button ghost compact-button" onClick={() => duplicateStandard(spec)}><CopyPlus size={14} />SOC用に複製</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel specs-panel custom-specs-panel">
        <div className="specs-section-heading">
          <div>
            <span className="specs-heading-icon"><Library size={17} /></span>
            <div><strong>編集コンテナライブラリ</strong><p>SOC、船社・製造年による実機差、独自機材だけを保存します。端末内に保存され、プランごとに読込を選択します。</p></div>
          </div>
          <div className="custom-specs-actions">
            <span className="status-chip blue">使用中 {activeCustomSpecs.length}タイプ</span>
            <button className="button secondary compact-button" onClick={addCustom}><Plus size={14} />新規追加</button>
          </div>
        </div>

        {activeCustomSpecs.length > 0 && (
          <div className="active-custom-summary">
            <strong>このプランで使用中</strong>
            <div>{activeCustomSpecs.map((spec) => (
              <span key={spec.type}>{spec.type}{isStandardContainerType(spec.type) ? "（基本を上書き）" : ""}<button aria-label={`${spec.type}の利用を解除`} onClick={() => removeFromPlan(spec.type)}>×</button></span>
            ))}</div>
          </div>
        )}

        {librarySpecs.length ? (
          <div className="table-shell">
            <table className="data-table specs-table custom-specs-table">
              <thead><tr><th>Type</th><th>区分</th><th>内寸L</th><th>内寸W</th><th>内寸H</th><th>Door W</th><th>Door H</th><th>Deck L</th><th>Deck W</th><th>Payload kg</th><th>風袋 kg</th><th>評価係数</th><th>操作</th></tr></thead>
              <tbody>
                {librarySpecs.map((spec, index) => {
                  const active = activeCustomSpecs.some((item) => item.type === spec.type && JSON.stringify(item) === JSON.stringify(spec));
                  const loadedType = activeCustomSpecs.some((item) => item.type === spec.type);
                  return (
                    <tr key={`${index}-${spec.type}`}>
                      <td><input aria-label={`${index + 1}件目のタイプ`} className="spec-type-input" value={spec.type} onChange={(event) => updateText(index, event.target.value)} /></td>
                      <td><select value={spec.category} onChange={(event) => updateCategory(index, event.target.value as ContainerCategory)}><option value="STANDARD">STANDARD</option><option value="SPECIAL">SPECIAL</option></select></td>
                      {(["inner_L_cm", "inner_W_cm", "inner_H_cm", "door_W_cm", "door_H_cm", "deck_L_cm", "deck_W_cm", "max_payload_kg", "tare_weight_kg", "cost"] as NumericField[]).map((field) => (
                        <td key={field}><input type="number" min="0" step="any" value={spec[field] ?? ""} onChange={(event) => updateNumber(index, field, event.target.value)} /></td>
                      ))}
                      <td>
                        <div className="spec-action-stack">
                          <button className={active ? "button ghost compact-button active" : "button secondary compact-button"} onClick={() => applyToPlan(spec)}>
                            {active ? <Check size={14} /> : <Upload size={14} />}{active ? "使用中" : loadedType ? "更新を反映" : "プランへ読込"}
                          </button>
                          {loadedType && <button className="button ghost compact-button" onClick={() => removeFromPlan(spec.type)}>利用解除</button>}
                          <button className="icon-button danger" aria-label={`${spec.type || "編集コンテナ"}を削除`} onClick={() => removeFromLibrary(index)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-custom-library">
            <Library size={30} />
            <strong>編集コンテナはまだありません</strong>
            <p>上の基本マスターから「SOC用に複製」するか、編集YAMLを読み込んでください。未指定のプランは基本マスターだけで計算・QR共有します。</p>
          </div>
        )}

        <div className="spec-notes">
          <div><strong>固定マスター</strong><p>基本コンテナはこの画面から変更できません。QRには寸法を入れず、バージョン付き定義IDだけを保存します。</p></div>
          <div><strong>SOC・実機差</strong><p>編集値を「プランへ読込」した場合だけ計算に使用します。基本タイプと同じType名にすると、そのプラン内だけ基本値を上書きします。</p></div>
          <div><strong>カスタムQR</strong><p>編集コンテナを使用したプランでは、別端末でも正確に復元できるよう標準との差分だけを追加QRへ保存します。</p></div>
        </div>
      </section>
    </main>
  );
}
