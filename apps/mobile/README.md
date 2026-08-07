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
- game progression、実績、Fogのルール
- GNSS / PDRのアルゴリズムそのもの

現状の縦切りにはSQLite repositoryとmapping-coreを直接組み合わせる箇所があります。Issue #1のPersonalMap永続化と同時に`mapping-engine` facadeへ段階的に移行します。将来のgame appは同じengineを呼びますが、core mutationを直接組み立てません。

## 開発ビルド

バックグラウンド位置記録はExpo Goではなくdevelopment buildで検証します。

```bash
npm install
npm run mobile:android
```

Android実機では、位置権限、継続通知、画面OFF、アプリ復帰、OSによる停止を必ず確認してください。

## 画面フロー

```text
Home → Permission rationale → Recording → Quick marker → Review
```

記録中画面にライブ地図を常設していません。現実空間への注意を奪わず、必要な時だけマーカー操作を行うためです。

## GPSなし空間

`src/tracking/pdrPort.ts` は将来の技術検証用の境界だけを定義しています。精度を未検証のPDRを製品機能として偽装する実装はありません。
