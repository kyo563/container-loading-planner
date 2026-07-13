import { AlertTriangle, CheckCircle2, FileSpreadsheet, Laptop, Lock, PackageCheck, Ship, Weight } from "lucide-react";

export function Guide() {
  return (
    <main className="page-shell guide-page">
      <div className="page-intro"><span className="eyebrow">OPERATING GUIDE</span><h1>使い方・判定範囲</h1><p>このツールが答えられることと、実務で別途確認すべきことを分けて説明します。</p></div>
      <section className="guide-steps">
        <div><span>01</span><FileSpreadsheet /><h2>貨物を入力</h2><p>CSV、Excel、貼り付け、直接編集に対応します。L/W/Hはcm、重量は単体kgです。</p></div>
        <div><span>02</span><PackageCheck /><h2>条件を選択</h2><p>必要本数の自動見積り、または使用可能本数を指定した収まり検証を選びます。</p></div>
        <div><span>03</span><Ship /><h2>結果を監査</h2><p>配置図、OOG、入口通過、Payload、偏荷重、積載不可貨物を確認します。</p></div>
      </section>
      <div className="guide-grid">
        <section className="panel guide-card">
          <div className="guide-icon green"><CheckCircle2 /></div><h2>このツールが行うこと</h2>
          <ul><li>数量をピース単位へ展開し、回転可否を考慮します。</li><li>床面の棚割り方式で配置候補を作ります。</li><li>40HCを基準にOL・OW・OHと入口通過を判定します。</li><li>冷凍・冷蔵貨物、OT、FR、在来船検討貨物を振り分けます。</li><li>重量、容積、重心偏差、上位重量物の集中を可視化します。</li><li>CSV・Excel帳票・印刷用レポートを出力します。</li></ul>
        </section>
        <section className="panel guide-card caution">
          <div className="guide-icon amber"><AlertTriangle /></div><h2>このツールだけでは確定できないこと</h2>
          <ul><li>床の点荷重、フォークリフト・クレーンの作業可否</li><li>固縛方法、木材・緩衝材、重量物の荷重分散</li><li>船社ごとのOOG許容値、運賃、スペース、機材在庫</li><li>道路運送車両法、特殊車両通行許可、経路制限</li><li>危険品・温度管理・混載可否など品目固有の規制</li><li>荷役順、重心を考慮した現場での最終微調整</li></ul>
        </section>
      </div>
      <section className="panel methodology">
        <div><span className="eyebrow">METHOD</span><h2>計算方式について</h2></div>
        <p>配置計算は「最適解を数学的に保証するソルバー」ではなく、寸法の大きい貨物から棚状に配置するヒューリスティックです。短時間で実務上の初期案を得ることを優先しています。そのため、未配置と判定された貨物でも、人による配置変更で収まる場合があります。</p>
        <div className="method-badges"><span><Weight />重量監査</span><span><Ship />OOG振分</span><span><Laptop />ブラウザ計算</span><span><Lock />外部送信なし</span></div>
      </section>
      <section className="privacy-callout"><Lock /><div><strong>入力データはサーバーへ送信しません</strong><p>ファイル読込・計算・帳票作成はブラウザ内で行います。ページを再読込すると貨物データは消去されます。</p></div></section>
    </main>
  );
}

