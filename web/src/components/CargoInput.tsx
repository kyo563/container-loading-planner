import { Download, FileDown, FileSpreadsheet, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EMPTY_CARGO, SAMPLE_CARGO } from "../domain/constants";
import { downloadBlankTemplate, parseCargoFile, parseCargoText } from "../domain/input";
import { exportCargoCsv } from "../domain/export";
import type { CargoRow, ValidationIssue } from "../domain/types";

interface CargoInputProps {
  rows: CargoRow[];
  issues: ValidationIssue[];
  onChange: (rows: CargoRow[], source?: "sample" | "user") => void;
  isSample: boolean;
}

type EditableField = Exclude<keyof CargoRow, "uid">;

const NUMBER_FIELDS = new Set<EditableField>(["qty", "L_cm", "W_cm", "H_cm", "weight_kg", "max_stack_load_kg"]);

export const retainExistingSelection = (
  selected: ReadonlySet<string>,
  rows: ReadonlyArray<Pick<CargoRow, "uid">>,
): Set<string> => {
  const rowIds = new Set(rows.map((row) => row.uid));
  return new Set([...selected].filter((uid) => rowIds.has(uid)));
};

export function CargoInput({ rows, issues, onChange, isSample }: CargoInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    setSelected((current) => {
      const next = retainExistingSelection(current, rows);
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const issueFor = (rowIndex: number, field: EditableField) =>
    issues.some((issue) => issue.row === rowIndex + 1 && issue.field === field);

  const update = (uid: string, field: EditableField, raw: string | boolean) => {
    onChange(
      rows.map((row) => {
        if (row.uid !== uid) return row;
        if (field === "rotate_allowed" || field === "stackable") return { ...row, [field]: Boolean(raw) };
        if (NUMBER_FIELDS.has(field)) {
          if (field === "max_stack_load_kg") return { ...row, [field]: raw === "" ? null : Number(raw) };
          return { ...row, [field]: raw === "" ? 0 : Number(raw) };
        }
        return { ...row, [field]: String(raw) };
      }),
      "user",
    );
  };

  const remove = (uid: string) => {
    onChange(rows.filter((row) => row.uid !== uid), "user");
    setSelected((current) => {
      const next = new Set(current);
      next.delete(uid);
      return next;
    });
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = await parseCargoFile(file);
      onChange(imported, "user");
      setMessage({ type: "success", text: `${imported.length}行を読み込みました。既存の表を置き換えています。` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "ファイルを読み込めませんでした。" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyPaste = () => {
    try {
      const imported = parseCargoText(pasteText);
      onChange(imported, "user");
      setPasteOpen(false);
      setPasteText("");
      setMessage({ type: "success", text: `${imported.length}行を反映しました。` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "貼り付けデータを読み込めませんでした。" });
    }
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.uid)));
  const deleteSelected = () => {
    if (!selected.size) return;
    onChange(rows.filter((row) => !selected.has(row.uid)), "user");
    setSelected(new Set());
  };
  const convertSelected = () => {
    if (!selected.size) return;
    onChange(
      rows.map((row) =>
        selected.has(row.uid)
          ? { ...row, L_cm: row.L_cm / 10, W_cm: row.W_cm / 10, H_cm: row.H_cm / 10 }
          : row,
      ),
      "user",
    );
    setMessage({ type: "success", text: `${selected.size}行の寸法をmmからcmへ変換しました。` });
  };

  return (
    <section className="panel cargo-panel">
      <div className="panel-heading">
        <div>
          <div className="step-label"><span>1</span>貨物データ</div>
          <h2>パッキングリストを入力</h2>
          <p>寸法はcm、単体重量はkgで入力します。数量はピース単位へ自動展開します。</p>
        </div>
        {isSample && <span className="status-chip amber">サンプル表示中</span>}
      </div>

      <div className="toolbar">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.xlsx"
          hidden
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={16} />CSV / Excel読込</button>
        <button className="button secondary" onClick={() => setPasteOpen(true)}><FileSpreadsheet size={16} />Excelから貼付</button>
        <button className="button ghost" onClick={() => onChange(SAMPLE_CARGO.map((row) => ({ ...row })), "sample")}><RotateCcw size={16} />サンプル</button>
        <span className="toolbar-spacer" />
        <div className="dropdown-wrap">
          <button className="button ghost"><FileDown size={16} />テンプレート</button>
          <div className="dropdown-menu">
            <button onClick={() => void downloadBlankTemplate("xlsx")}>Excel（150行）</button>
            <button onClick={() => void downloadBlankTemplate("csv")}>CSV（150行）</button>
          </div>
        </div>
        <button className="button ghost" disabled={!rows.length} onClick={() => void exportCargoCsv(rows)}><Download size={16} />入力を保存</button>
      </div>

      {message && (
        <div className={`inline-message ${message.type}`}>
          <span>{message.text}</span><button onClick={() => setMessage(null)} aria-label="閉じる"><X size={15} /></button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="selection-bar">
          <strong>{selected.size}行を選択中</strong>
          <button onClick={convertSelected}>mm → cm変換</button>
          <button className="danger-text" onClick={deleteSelected}><Trash2 size={15} />選択行を削除</button>
        </div>
      )}

      <div className="table-shell cargo-table-shell">
        <table className="data-table cargo-table">
          <thead>
            <tr>
              <th className="select-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全行を選択" /></th>
              <th>ID<span className="required">*</span></th>
              <th className="wide-col">貨物名<span className="required">*</span></th>
              <th>数量<span className="required">*</span></th>
              <th>L cm<span className="required">*</span></th>
              <th>W cm<span className="required">*</span></th>
              <th>H cm<span className="required">*</span></th>
              <th>単体kg<span className="required">*</span></th>
              <th>荷姿</th>
              <th title="縦横高さの入替を許可">回転</th>
              <th title="上に別貨物を積載可能">段積</th>
              <th>上積kg</th>
              <th>混載不可ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.uid} className={issues.some((issue) => issue.row === rowIndex + 1) ? "has-error" : ""}>
                <td className="select-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(row.uid)}
                    onChange={(event) => setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.uid); else next.delete(row.uid);
                      return next;
                    })}
                    aria-label={`${rowIndex + 1}行目を選択`}
                  />
                </td>
                <td><input className={issueFor(rowIndex, "id") ? "invalid" : ""} value={row.id} onChange={(e) => update(row.uid, "id", e.target.value)} /></td>
                <td><input className={issueFor(rowIndex, "desc") ? "invalid" : ""} value={row.desc} onChange={(e) => update(row.uid, "desc", e.target.value)} /></td>
                <td><input className={issueFor(rowIndex, "qty") ? "invalid" : ""} type="number" min="1" step="1" value={row.qty || ""} onChange={(e) => update(row.uid, "qty", e.target.value)} /></td>
                {(["L_cm", "W_cm", "H_cm", "weight_kg"] as const).map((field) => (
                  <td key={field}><input className={issueFor(rowIndex, field) ? "invalid" : ""} type="number" min="0" step="any" value={row[field] || ""} onChange={(e) => update(row.uid, field, e.target.value)} /></td>
                ))}
                <td><input value={row.package_text} onChange={(e) => update(row.uid, "package_text", e.target.value)} /></td>
                <td className="check-cell"><input type="checkbox" checked={row.rotate_allowed} onChange={(e) => update(row.uid, "rotate_allowed", e.target.checked)} /></td>
                <td className="check-cell"><input type="checkbox" checked={row.stackable} onChange={(e) => update(row.uid, "stackable", e.target.checked)} /></td>
                <td><input type="number" min="0" step="any" value={row.max_stack_load_kg ?? ""} placeholder="—" onChange={(e) => update(row.uid, "max_stack_load_kg", e.target.value)} /></td>
                <td><input value={row.incompatible_with_ids} placeholder="A001,B002" onChange={(e) => update(row.uid, "incompatible_with_ids", e.target.value)} /></td>
                <td><button className="icon-button danger" onClick={() => remove(row.uid)} aria-label={`${row.id || rowIndex + 1}を削除`}><Trash2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty-table">貨物データがありません。ファイルを読み込むか、行を追加してください。</div>}
      </div>
      <div className="table-footer">
        <button className="text-button" onClick={() => onChange([...rows, EMPTY_CARGO()], "user")}><Plus size={16} />行を追加</button>
        <span>{rows.length}行 / {rows.reduce((sum, row) => sum + (Number.isFinite(row.qty) ? row.qty : 0), 0).toLocaleString()}ピース</span>
      </div>

      {pasteOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPasteOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="paste-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><span className="eyebrow">IMPORT</span><h3 id="paste-title">Excel / CSVから貼り付け</h3></div>
              <button className="icon-button" onClick={() => setPasteOpen(false)}><X /></button>
            </div>
            <p>ヘッダーを含めてコピーしてください。タブ区切りとカンマ区切りを自動判定します。反映すると現在の表を置き換えます。</p>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"ItemID\tCargoName\tQty\tL\tW\tH\tGross\tStyle\nA001\tMachine\t1\t100\t80\t50\t500\tCRATE"}
            />
            <div className="modal-actions"><button className="button ghost" onClick={() => setPasteOpen(false)}>キャンセル</button><button className="button primary" onClick={applyPaste}>表へ反映</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
