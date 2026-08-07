# Mobile reference explorer app

Expo / React NativeによるM0縦切りであり、headless mapping capabilityを利用する最初の**reference explorer shell**です。通常利用の主経路は、探索開始後にスマホをしまい、バックグラウンドGNSSを端末内へ保存することです。

このapp固有の責務:

- permission rationale
- `探索開始 → ポケット → 必要時だけ発見 → 終了 → レビュー` のUX
- mapping-engineのcommand / query呼び出し
- map rendererと任意experienceのcomposition
- Android / iOSの画面・通知・復帰導線

このappが所有しない責務:

- map truthとaccepted / rejected規則
- PersonalMap / ExplorationSessionのdomain invariant
- canonical storage transaction
- game progression、実績、Fogのルール
- GNSS / PDRのアルゴリズムそのもの

foreground UIとbackground TaskManager callbackは、どちらも`mobileMappingRuntime`から同じ`mapping-engine` commandへ位置観測を渡します。UIやbackground taskがcanonical mapping tablesへ直接書き込むことは禁止し、CIで検査しています。

## Development build

バックグラウンド位置記録はExpo Goではなく、app固有のdevelopment buildで検証します。repository rootで実行します。

```bash
npm ci
npm run mobile:check
npm run mobile:android
```

Windows、Android SDK、USB端末、GitHub Actions APKの詳細は [`../../docs/ANDROID_DEVELOPMENT.md`](../../docs/ANDROID_DEVELOPMENT.md) を参照してください。

Android実機では、次をbuild成功と分けて確認します。

- foreground / background位置権限
- foreground-service notification
- 画面OFF・ポケット内のcallback継続
- notificationからの復帰
- process recreation後のsession recovery
- OEM battery restriction
- raw / accepted / rejected、gap、accuracy、battery

## Screen flow

```text
PersonalMap Home
  → Permission rationale
  → Recording
  → Optional quick marker
  → End
  → PersonalMap Review + development diagnostics
  → Continue the same PersonalMap
```

記録中画面にライブ地図を常設していません。現実空間への注意を奪わず、必要な時だけmarker操作を行うためです。

## Diagnostics

Development Reviewでは、raw observationsをmapping-coreでreplayして次を表示します。

- accepted / rejectedと理由
- horizontal accuracy
- sample gaps
- callback received / persisted / duplicate / failed
- provider lifecycle
- app background / foreground / recovery
- marker入力時間

`座標なし集計を共有`はReact Native標準のshare sheetを明示操作で開きます。共有テキストに含めるのはaggregate metricsとrelative lifecycle offsetだけです。

含めないもの:

- 緯度経度、local coordinates
- PersonalMap / ExplorationSession id
- map name、marker text
- map image
- absolute start / end time

共有先と最終内容はOS UIで確認します。この機能は位置履歴exportではなく、Issue #3 / #4のexperiment recordを揃えるためのdevelopment-only補助です。

operational diagnosticsはmap truthではありません。診断保存失敗でraw位置記録を失敗させず、routeや接続を診断eventから生成しません。

実機runは [`../../docs/experiments/templates/background-gnss-run.md`](../../docs/experiments/templates/background-gnss-run.md) に記録します。

## GPS-denied spaces

`src/tracking/pdrPort.ts`は将来の技術検証用の境界だけを定義しています。精度を未検証のPDRを製品機能として偽装する実装はありません。M0のGNSS価値を確認してから、既存研究baselineとGo / Narrow / Stop比較を行います。
