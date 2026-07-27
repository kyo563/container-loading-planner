import { Check, Copy, Download, Link2, QrCode, Share2, X } from "lucide-react";
import { useState } from "react";

import {
  STANDARD_CONTAINER_PROFILE_ID,
  STANDARD_CONTAINER_PROFILE_LABEL,
} from "../domain/containerProfiles";
import { createPlanQrBundleData, type PlanQrData } from "../domain/planQr";
import { buildSharedPlanUrl, type ShareablePlanState } from "../domain/sharedPlan";

interface PlanShareProps {
  plan: ShareablePlanState;
}

const qrLabel = (part: PlanQrData): string => {
  const label = part.kind === "plan" ? "プランQR" : "カスタムコンテナ仕様QR";
  return part.partTotal > 1 ? `${label} ${part.partIndex}/${part.partTotal}` : label;
};

const qrFilename = (part: PlanQrData): string => {
  const kind = part.kind === "plan" ? "plan" : "container-specs";
  const suffix = part.partTotal > 1 ? `-${part.partIndex}-of-${part.partTotal}` : "";
  return `loadpilot-${kind}-qr${suffix}.png`;
};

export function PlanShare({ plan }: PlanShareProps) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [url, setUrl] = useState("");
  const [planQrParts, setPlanQrParts] = useState<PlanQrData[]>([]);
  const [specsQrParts, setSpecsQrParts] = useState<PlanQrData[]>([]);
  const [bundleId, setBundleId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [requiresAppScanner, setRequiresAppScanner] = useState(false);
  const [error, setError] = useState("");
  const [qrError, setQrError] = useState("");
  const [copied, setCopied] = useState(false);

  const createShare = async () => {
    setOpen(true);
    setGenerating(true);
    setUrl("");
    setPlanQrParts([]);
    setSpecsQrParts([]);
    setBundleId("");
    setProfileId("");
    setRequiresAppScanner(false);
    setError("");
    setQrError("");
    setCopied(false);
    try {
      try {
        const qr = await createPlanQrBundleData(plan);
        setUrl(qr.planUrl);
        setPlanQrParts(qr.planParts);
        setSpecsQrParts(qr.specsParts ?? []);
        setBundleId(qr.bundleId ?? "");
        setProfileId(qr.profileId);
        setRequiresAppScanner(qr.requiresAppScanner);
      } catch (caught) {
        const nextUrl = await buildSharedPlanUrl(plan);
        setUrl(nextUrl);
        setQrError(caught instanceof Error
          ? caught.message
          : "QRコードを生成できませんでした。URLをコピーして共有してください。");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "共有リンクを作成できませんでした。");
    } finally {
      setGenerating(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("クリップボードへコピーできませんでした。URL欄を選択してコピーしてください。");
    }
  };

  const totalQrParts = planQrParts.length + specsQrParts.length;
  const allQrParts = [...planQrParts, ...specsQrParts];
  const readHelp = requiresAppScanner
    ? `LoadPilot画面上部の「QR読込」で${totalQrParts}枚すべてを読み取ってください。順番は問いません。読取済みのQRは重複しても無視されます。`
    : specsQrParts.length
      ? "プランQRとカスタムコンテナ仕様QRを続けて読み取ります。順番は問いませんが、両方の照合IDが一致するまで復元されません。"
      : "スマートフォン等でQRを読み取るか、共有URLを開いてください。標準コンテナ仕様で自動的に積載計算を実行します。";
  const profileLabel = profileId === STANDARD_CONTAINER_PROFILE_ID ? STANDARD_CONTAINER_PROFILE_LABEL : profileId;

  return (
    <>
      <button className="button secondary" onClick={() => void createShare()}><Share2 size={16} />QR / URL共有</button>
      {open && (
        <div className="modal-backdrop no-print" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="modal-card share-modal" role="dialog" aria-modal="true" aria-labelledby="share-plan-title">
            <div className="modal-heading">
              <div><span className="eyebrow">SHARE PLAN</span><h3 id="share-plan-title">プランをQR・URLで共有</h3></div>
              <button className="icon-button" aria-label="共有画面を閉じる" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <p>通常は標準コンテナ定義IDだけを保存してQRを軽くします。SOC・寸法変更などの差分がある場合だけ、カスタムコンテナ仕様QRを追加します。</p>

            {generating && <div className="share-loading"><span className="spinner dark" /><strong>共有データを作成中…</strong></div>}
            {error && <div className="share-message error" role="alert">{error}</div>}

            {!generating && url && (
              <div className="share-grid">
                <div className="qr-panel">
                  {allQrParts.length ? allQrParts.map((part) => (
                    <div className="qr-part-card" key={`${part.kind}-${part.partIndex}`}>
                      <strong className="qr-part-label">{qrLabel(part)}</strong>
                      <img
                        src={part.dataUrl}
                        alt={`${qrLabel(part)}（積載プラン共有用）`}
                      />
                      <small className="qr-density-note">{part.moduleCount} × {part.moduleCount} モジュール</small>
                      <a className="button ghost qr-download" href={part.dataUrl} download={qrFilename(part)}>
                        <Download size={15} />QR画像を保存
                      </a>
                    </div>
                  )) : <div className="qr-placeholder"><QrCode /><span>QR生成不可</span></div>}
                  {bundleId && <small className="qr-bundle-id">カスタム仕様の照合ID: {bundleId}</small>}
                  {totalQrParts > 1 && <small className="qr-total-note">合計 {totalQrParts} 枚・順不同で読取可能</small>}
                  {qrError && <p className="qr-error">{qrError}</p>}
                </div>
                <div className="share-link-panel">
                  <label htmlFor="shared-plan-url"><Link2 size={16} />共有URL</label>
                  <textarea id="shared-plan-url" className="share-url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                  <div className="share-link-meta"><span>{url.length.toLocaleString()}文字</span><span>リンクを知る人は内容を閲覧できます</span></div>
                  <button className="button primary share-copy" onClick={() => void copyUrl()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "コピーしました" : "URLをコピー"}</button>
                  {profileLabel && (
                    <div className="share-help">
                      <strong>コンテナ定義</strong>
                      <p>{profileLabel}（20GP・40GP・40HC・20OT・40OT・20FR・40FR・RF）{specsQrParts.length ? "を基準に、カスタム差分のみを追加QRへ保存しています。" : "を参照するため、仕様寸法はQRへ重複保存していません。"}</p>
                    </div>
                  )}
                  <div className="share-help"><strong>読み込み方</strong><p>{readHelp}</p></div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
