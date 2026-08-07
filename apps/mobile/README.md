# Mobile app

Expo / React NativeによるM0縦切りです。通常利用の主経路は、探索開始後にスマホをしまい、バックグラウンドGNSSをSQLiteへ保存することです。

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
