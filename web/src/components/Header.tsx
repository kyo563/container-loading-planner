import { Box, Calculator, Camera, Container, FileQuestion, Menu, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import type { AppView } from "../domain/types";

const NAV_ITEMS: { id: AppView; label: string; icon: typeof Box }[] = [
  { id: "planner", label: "積載計画", icon: Box },
  { id: "converter", label: "容積換算", icon: Calculator },
  { id: "containers", label: "コンテナ設定", icon: Container },
  { id: "guide", label: "使い方・注意", icon: FileQuestion },
];

interface HeaderProps {
  current: AppView;
  onNavigate: (view: AppView) => void;
  onScanPlan: () => void;
  onNewPlan: () => void;
}

export function Header({ current, onNavigate, onScanPlan, onNewPlan }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const navigate = (view: AppView) => {
    onNavigate(view);
    setOpen(false);
  };
  return (
    <header className="site-header no-print">
      <div className="header-inner">
        <button className="brand" onClick={() => navigate("planner")} aria-label="積載計画へ戻る">
          <span className="brand-mark"><Container size={23} strokeWidth={2.2} /></span>
          <span>
            <strong>LoadPilot</strong>
            <small>CONTAINER PLANNING</small>
          </span>
        </button>
        <nav className={open ? "main-nav is-open" : "main-nav"} aria-label="メインナビゲーション">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={current === item.id ? "nav-link active" : "nav-link"}
                onClick={() => navigate(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button className="header-new-plan-button" type="button" aria-label="新規プラン" onClick={onNewPlan}><RotateCcw size={16} /><span>新規プラン</span></button>
        <button className="header-scan-button" type="button" aria-label="QR読込" onClick={onScanPlan}><Camera size={16} /><span>QR読込</span></button>
        <div className="header-assurance"><ShieldCheck size={16} />データは端末内で処理</div>
        <button className="menu-button" type="button" onClick={() => setOpen((value) => !value)} aria-label="メニューを開閉" aria-expanded={open}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}
