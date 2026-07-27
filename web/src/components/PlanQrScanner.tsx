import { Camera, CameraOff, X } from "lucide-react";
import QrScanner from "qr-scanner";
import { useEffect, useRef, useState } from "react";

import { PlanQrPartCollector, type PlanQrScanResult } from "../domain/planQr";

interface PlanQrScannerProps {
  open: boolean;
  onClose: () => void;
  onToken: (token: string) => Promise<{ complete: boolean; message?: string }>;
}

export function PlanQrScanner({ open, onClose, onToken }: PlanQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const processingRef = useRef(false);
  const collectorRef = useRef(new PlanQrPartCollector());
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");

  const partProgressMessage = (result: PlanQrScanResult): string => {
    const label = result.kind === "plan" ? "プランQR" : "カスタム仕様QR";
    const remaining = result.total - result.received;
    if (result.duplicate) return `${label} ${result.partIndex}/${result.total} は読取済みです。残り${remaining}枚です。`;
    return `${label}を${result.received}/${result.total}枚受け付けました。残り${remaining}枚です。`;
  };

  useEffect(() => {
    if (!open || !videoRef.current) return;
    let disposed = false;
    setError("");
    setStarting(true);
    setProgressMessage("");
    processingRef.current = false;
    collectorRef.current.reset();
    const scanner = new QrScanner(videoRef.current, async (result) => {
      if (processingRef.current || disposed) return;
      processingRef.current = true;
      await scanner.pause(true);
      try {
        const qrOutcome = await collectorRef.current.acceptScannedValue(result.data);
        if (!qrOutcome.complete) {
          if (!disposed) setProgressMessage(partProgressMessage(qrOutcome));
          processingRef.current = false;
          await scanner.start();
          return;
        }
        const outcome = await onToken(qrOutcome.token!);
        if (!disposed && outcome.complete) onClose();
        if (!disposed && !outcome.complete) {
          setProgressMessage(outcome.message ?? "もう1枚のQRコードを読み取ってください。");
          processingRef.current = false;
          await scanner.start();
        }
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
        <p>印刷したCLPまたは別端末に表示したLoadPilotのQRコードを、枠内へ映してください。分割QRは順不同で読み取れます。</p>
        {progressMessage && <div className="scanner-progress" role="status">{progressMessage}</div>}
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
