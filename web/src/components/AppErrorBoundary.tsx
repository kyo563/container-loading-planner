import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("LoadPilot rendering error", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div>
          <span>LOADPILOT</span>
          <h1>画面の表示中に問題が発生しました</h1>
          <p>入力内容は外部へ送信されていません。ページを再読み込みして、もう一度お試しください。</p>
          <button type="button" onClick={() => window.location.reload()}>ページを再読み込み</button>
        </div>
      </main>
    );
  }
}
