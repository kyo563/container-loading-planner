import { Check, Copy, Download, Link2, QrCode, Share2, X } from "lucide-react";
import { useState } from "react";

import { createPlanQrBundleData } from "../domain/planQr";
import { buildSharedPlanUrl, type ShareablePlanState } from "../domain/sharedPlan";

interface PlanShareProps {
  plan: ShareablePlanState;
}

export function PlanShare({ plan }: PlanShareProps) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [url, setUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [specsQrDataUrl, setSpecsQrDataUrl] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [error, setError] = useState("");
  const [qrError, setQrError] = useState("");
  const [copied, setCopied] = useState(false);

  const createShare = async () => {
    setOpen(true);
    setGenerating(true);
    setUrl("");
    setQrDataUrl("");
    setSpecsQrDataUrl("");
    setBundleId("");
    setError("");
    setQrError("");
    setCopied(false);
    try {
      try {
        const qr = await createPlanQrBundleData(plan);
        setUrl(qr.plan.url);
        setQrDataUrl(qr.plan.dataUrl);
        setSpecsQrDataUrl(qr.specs?.dataUrl ?? "");
        setBundleId(qr.bundleId ?? "");
      } catch {
        const nextUrl = await buildSharedPlanUrl(plan);
        setUrl(nextUrl);
        setQrError("このプランは1個のQRコードに収まりません。URLをコピーして共有してください。");
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
            <p>標準コンテナ仕様は省略し、貨物情報と計算条件だけを圧縮します。標準外仕様を使用した場合は、同じ照合IDを持つ2枚のQRを生成します。</p>

            {generating && <div className="share-loading"><span className="spinner dark" /><strong>共有データを作成中…</strong></div>}
            {error && <div className="share-message error" role="alert">{error}</div>}

            {!generating && url && (
              <div className="share-grid">
                <div className="qr-panel">
                  {specsQrDataUrl && <strong className="qr-part-label">プランQR 1/2</strong>}
                  {qrDataUrl ? <img src={qrDataUrl} alt="積載プラン共有用QRコード" /> : <div className="qr-placeholder"><QrCode /><span>QR生成不可</span></div>}
                  {qrDataUrl && <a className="button ghost qr-download" href={qrDataUrl} download="loadpilot-plan-qr.png"><Download size={15} />QR画像を保存</a>}
                  {specsQrDataUrl && <><strong className="qr-part-label">特殊コンテナ仕様QR 2/2</strong><img src={specsQrDataUrl} alt="特殊コンテナ仕様共有用QRコード" /><a className="button ghost qr-download" href={specsQrDataUrl} download="loadpilot-container-specs-qr.png"><Download size={15} />仕様QR画像を保存</a><small className="qr-bundle-id">照合ID: {bundleId}</small></>}
                  {qrError && <p className="qr-error">{qrError}</p>}
                </div>
                <div className="share-link-panel">
                  <label htmlFor="shared-plan-url"><Link2 size={16} />共有URL</label>
                  <textarea id="shared-plan-url" className="share-url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                  <div className="share-link-meta"><span>{url.length.toLocaleString()}文字</span><span>リンクを知る人は内容を閲覧できます</span></div>
                  <button className="button primary share-copy" onClick={() => void copyUrl()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "コピーしました" : "URLをコピー"}</button>
                  <div className="share-help"><strong>読み込み方</strong><p>{specsQrDataUrl ? "プランQRと特殊コンテナ仕様QRを続けて読み取ります。順番は問いませんが、両方の照合IDが一致するまで復元されません。" : "スマートフォン等でQRを読み取るか、共有URLを開いてください。標準コンテナ仕様で自動的に積載計算を実行します。"}</p></div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
