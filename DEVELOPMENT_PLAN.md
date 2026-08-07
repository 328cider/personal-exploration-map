# Development Plan

## M0 — Passive Mapping Vertical Slice

目的: GPSが利用できる場所で、プロダクトのUI/UX仮説を端から端まで検証する。

- [x] mapping-coreのデータモデル
- [x] 生サンプルから派生経路を再構成
- [x] 異常ジャンプの除外
- [x] 白紙キャンバスへの経路表示
- [x] SQLite永続化
- [x] バックグラウンド位置タスクの実装
- [x] クイックマーカー
- [ ] Android実機ビルド
- [ ] 30分歩行テスト
- [ ] 画面OFF・プロセス復帰テスト
- [ ] バッテリーと欠落率の測定
- [ ] 10件のドッグフード結果からUX修正

## M1 — Local-coordinate Mapping Spike

目的: GPSなしでも「一回歩けば役に立つ経路図」が成立するか判定する。

- [ ] Android foreground serviceでIMU収集
- [ ] 歩数・姿勢・方向変化の再生可能ログ
- [ ] PDR baseline
- [ ] 入口・階段・接続点の手動アンカー
- [ ] 100–300mの複数経路で誤差測定
- [ ] Go / Narrow / Stop判定

## M2 — Hybrid Personal Map

M1がGoまたはNarrowの場合のみ着手する。

- [ ] GNSSとローカル座標のアンカー接続
- [ ] 階層と探索マップの再開
- [ ] 誤差・欠落・推定の可視化
- [ ] 経路の軽量手動修正
- [ ] エクスポート / インポート

## M3 — Replaceable Experience Layers

マッピングコアの有用性が確認できた後に着手する。

- [ ] Fog / 探索済み領域
- [ ] 探索率
- [ ] 発見コレクション
- [ ] 実績、ストーリー、テーマ
- [ ] 拡張SDKの安定化
