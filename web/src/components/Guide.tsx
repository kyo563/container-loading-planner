import { AlertTriangle, CheckCircle2, FileSpreadsheet, Laptop, Lock, PackageCheck, Ship, Weight } from "lucide-react";

export function Guide() {
  return (
    <main className="page-shell guide-page">
      <div className="page-intro"><span className="eyebrow">OPERATING GUIDE</span><h1>使い方・判定範囲</h1><p>このツールが答えられることと、実務で別途確認すべきことを分けて説明します。</p></div>
      <section className="guide-steps">
        <div><span>01</span><FileSpreadsheet /><h2>貨物を入力</h2><p>CSV、Excel、貼り付け、直接編集に対応します。L/W/Hはcm、重量は単体kgです。</p></div>
        <div><span>02</span><PackageCheck /><h2>条件を選択</h2><p>必要本数の自動見積り、本数固定の検証、または縮尺ボックスを自分で置く手動プランを選びます。</p></div>
        <div><span>03</span><Ship /><h2>配置・結果を監査</h2><p>手動モードでは貨物を配置してCLPを作成します。配置図、OOG、Payload、偏荷重、積載不可貨物を確認してください。</p></div>
      </section>
      <div className="guide-grid">
        <section className="panel guide-card">
          <div className="guide-icon green"><CheckCircle2 /></div><h2>このツールが行うこと</h2>
          <ul><li>数量をピース単位へ展開し、回転可否を考慮します。</li><li>床面の棚割り方式で配置候補を作ります。</li><li>手動モードでは、縮尺上面図へ貨物を配置し、連動する側面図へ切替または併記できます。</li><li>手動配置からコンテナ別の個数・重量・容積を集計し、CLP、CSV、Excel、印刷帳票を作成します。</li><li>標準コンテナは大きい貨物をトラック側（x=0）、小さい貨物をドア側へ配置し、床面の候補を使い切ってから段積みします。</li><li>OT・FRは標準コンテナの大型順を必須とせず、特にFRは中心からの点対称性と重量重心に配慮します。</li><li>背の高い貨物から低い貨物へ続く並びを努力目標とし、高さ差100cm以上も配置不可にはしません。</li><li>同一貨物をなるべく一か所にまとめ、積載効率を優先して次の貨物を配置します。</li><li>総容積・総重量と実配置が1本の20GPに収まる小口は20GP、それ以外の標準貨物は40HCを基準に見積もります。</li><li>20GPの判定値と、40HCバンプランごとの40GP代用可否を表示します。</li><li>40HCを基準にOL・OW・OHと入口通過を判定します。</li><li>冷凍・冷蔵貨物、OT、FR、在来船検討貨物を振り分けます。</li><li>重量、容積、重心偏差、上位重量物の集中を可視化します。</li><li>自動計画はQR・URLで共有できます。手動配置はCSV・Excel・印刷帳票で保存できます。</li></ul>
        </section>
        <section className="panel guide-card caution">
          <div className="guide-icon amber"><AlertTriangle /></div><h2>このツールだけでは確定できないこと</h2>
          <ul><li>床の点荷重、フォークリフト・クレーンの作業可否</li><li>固縛方法、木材・緩衝材、重量物の荷重分散</li><li>船社ごとのOOG許容値、運賃、スペース、機材在庫</li><li>道路運送車両法、特殊車両通行許可、経路制限</li><li>危険品・温度管理・混載可否など品目固有の規制</li><li>荷役順、重心を考慮した現場での最終微調整</li></ul>
        </section>
      </div>
      <section className="panel methodology">
        <div><span className="eyebrow">METHOD</span><h2>計算方式について</h2></div>
        <p>自動配置は「最適解を数学的に保証するソルバー」ではなく、棚状に配置するヒューリスティックです。標準コンテナでは、大きい貨物をトラック側（x=0）、小さい貨物をドア側に置き、床面の残りに入る後続貨物をすべて試してから段積みへ進みます。背の高い貨物から低い貨物へ続く並びにも配慮します。高さ差100cmは注意目安であり、配置不可条件ではありません。OT・FRはこの大型順を必須とせず、FRはデッキ中心に対する点対称性と重量重心を評価して中央寄せします。手動モードは床面上の配置を5cm単位で記録し、重なり、床面範囲、内寸高、Payload、混載不可を検査します。同一貨物はグループ単位の移動・交換を優先し、2本の平均貨物重量に対する差が40%を超える場合だけ、収まりと偏荷重を確認しながら必要最小限に分割します。</p>
        <div className="method-badges"><span><Weight />重量監査</span><span><Ship />OOG振分</span><span><Laptop />ブラウザ計算</span><span><Lock />外部送信なし</span></div>
      </section>
      <section className="privacy-callout"><Lock /><div><strong>入力データはサーバーへ送信しません</strong><p>ファイル読込・計算・帳票作成はブラウザ内で行います。通常の再読込では貨物データを保持しません。共有URLを作成した場合だけ、圧縮した貨物情報がURLの#以降に含まれ、そのURLを知る人が復元できます。</p></div></section>
    </main>
  );
}
