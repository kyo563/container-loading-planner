import { Camera, CameraOff, X } from "lucide-react";
import QrScanner from "qr-scanner";
import { useEffect, useRef, useState } from "react";

import { tokenFromScannedValue } from "../domain/sharedPlan";

interface PlanQrScannerProps {
  open: boolean;
  onClose: () => void;
  onToken: (token: string) => Promise<void>;
}

export function PlanQrScanner({ open, onClose, onToken }: PlanQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const processingRef = useRef(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open || !videoRef.current) return;
    let disposed = false;
    setError("");
    setStarting(true);
    processingRef.current = false;
    const scanner = new QrScanner(videoRef.current, async (result) => {
      if (processingRef.current || disposed) return;
      processingRef.current = true;
      await scanner.pause(true);
      try {
        const token = tokenFromScannedValue(result.data);
        await onToken(token);
        if (!disposed) onClose();
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "QRコードを読み込めませんでした。");
          processingRef.current = false;
          void scanner.start().catch(() => setError("カメラを再開できませんでした。画面を閉じて再度お試しください。"));
        }
      }
    }, { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true });
    void scanner.start().then(() => {
      if (!disposed) setStarting(false);
    }).catch((caught: unknown) => {
      if (!disposed) {
        setStarting(false);
        const name = caught instanceof DOMException ? caught.name : "";
        setError(name === "NotAllowedError"
          ? "カメラの使用が許可されていません。ブラウザの権限設定でカメラを許可してください。"
          : "カメラを起動できませんでした。接続状態とブラウザのカメラ設定を確認してください。");
      }
    });
    return () => {
      disposed = true;
      scanner.destroy();
    };
  }, [open, onClose, onToken]);

  if (!open) return null;
  return (
    <div className="modal-backdrop no-print" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scan-plan-title">
        <div className="modal-heading">
          <div><span className="eyebrow">SCAN PLAN</span><h3 id="scan-plan-title">カメラでプランQRを読み込む</h3></div>
          <button className="icon-button" aria-label="QR読取画面を閉じる" onClick={onClose}><X size={18} /></button>
        </div>
        <p>印刷したCLPまたは別端末に表示したLoadPilotのQRコードを、枠内へ映してください。</p>
        <div className="scanner-video-wrap">
          <video ref={videoRef} muted playsInline />
          {starting && <div className="scanner-status"><span className="spinner dark" />カメラを起動中…</div>}
          {error && <div className="scanner-status error"><CameraOff />{error}</div>}
        </div>
        <div className="scanner-privacy"><Camera size={15} /><span>映像は端末内で解析され、サーバーへ送信されません。</span></div>
      </section>
    </div>
  );
}
