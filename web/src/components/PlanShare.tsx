import { Check, Copy, Download, Link2, QrCode, Share2, X } from "lucide-react";
import { useState } from "react";
import QRCode from "qrcode";

import { buildSharedPlanUrl, type ShareablePlanState } from "../domain/sharedPlan";

interface PlanShareProps {
  plan: ShareablePlanState;
}

export function PlanShare({ plan }: PlanShareProps) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [url, setUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const [qrError, setQrError] = useState("");
  const [copied, setCopied] = useState(false);

  const createShare = async () => {
    setOpen(true);
    setGenerating(true);
    setUrl("");
    setQrDataUrl("");
    setError("");
    setQrError("");
    setCopied(false);
    try {
      const nextUrl = await buildSharedPlanUrl(plan);
      setUrl(nextUrl);
      try {
        setQrDataUrl(await QRCode.toDataURL(nextUrl, { errorCorrectionLevel: "L", margin: 2, width: 320, color: { dark: "#0b2239", light: "#ffffff" } }));
      } catch {
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
            <p>貨物情報、計算条件、指定本数、コンテナ仕様を圧縮してURL内へ格納します。サーバーへの保存やアップロードは行いません。</p>

            {generating && <div className="share-loading"><span className="spinner dark" /><strong>共有データを作成中…</strong></div>}
            {error && <div className="share-message error" role="alert">{error}</div>}

            {!generating && url && (
              <div className="share-grid">
                <div className="qr-panel">
                  {qrDataUrl ? <img src={qrDataUrl} alt="積載プラン共有用QRコード" /> : <div className="qr-placeholder"><QrCode /><span>QR生成不可</span></div>}
                  {qrDataUrl && <a className="button ghost qr-download" href={qrDataUrl} download="loadpilot-plan-qr.png"><Download size={15} />QR画像を保存</a>}
                  {qrError && <p className="qr-error">{qrError}</p>}
                </div>
                <div className="share-link-panel">
                  <label htmlFor="shared-plan-url"><Link2 size={16} />共有URL</label>
                  <textarea id="shared-plan-url" className="share-url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                  <div className="share-link-meta"><span>{url.length.toLocaleString()}文字</span><span>リンクを知る人は内容を閲覧できます</span></div>
                  <button className="button primary share-copy" onClick={() => void copyUrl()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "コピーしました" : "URLをコピー"}</button>
                  <div className="share-help"><strong>読み込み方</strong><p>スマートフォン等でQRを読み取るか、共有URLを開いてください。貨物情報を復元後、自動的に積載計算を実行します。</p></div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
