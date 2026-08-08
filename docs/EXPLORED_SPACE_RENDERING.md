# Explored-space rendering

更新日: 2026-08-08

## 目的

細いGNSS軌跡だけでは、一般的なGPSロガーやGoogle Maps Timelineとの差が体験として見えにくい。

このアプリは移動履歴を再生するのではなく、ユーザーが探索した空間が自分の地図として育つことを中心価値とする。そのため、accepted routeを正確な道路線のように見せるのではなく、観測精度と不確実性を含む`explored space`として表示する。

## Map truthとの境界

explored-space表示はrenderer-derived dataであり、canonical map truthではない。

```text
raw observation
  ↓ quality / replay
accepted TrackPoint
  ↓ read-only renderer derivation
corridor / coverage cells / thin track
```

次を変更しない。

- raw observation
- accepted / rejected判定
- ExplorationSession境界
- PersonalMap frame
- marker
- session間の接続

renderer、game、experienceはこの表示を根拠にcanonical mapを書き換えない。

## Build / Adopt判断

位置取得、SQLite、Android emulator lifecycleは既存platform / OSSへ任せる。

今回のcorridorとcellは、汎用GIS buffer engineを再実装するものではない。TrackPointがすでにメートル単位のPersonalMap local frameへ投影されており、必要なのは画面上の比較表示だけである。

`Turf buffer`やGEOS系ライブラリも候補になるが、M0では採用しない。

- 正式なGeoJSON polygonやpolygon unionを生成しない
- corridorをcanonical geometryとして保存・exportしない
- 道路・敷地・部屋の境界を演算しない
- dependencyと複雑なpolygon edge caseを増やす価値がまだない

したがって、M0はscreen-space capsuleとlocal-frame cell集約に限定する。将来、探索範囲polygonのexport、面積計算、複数端末間unionが製品要件になった場合は、独自polygon処理を増やさず、既存GIS OSSを再評価する。

描画primitive自体の大量View問題は別論点であり、`react-native-svg`等の既存rendererへの移行候補を引き続き比較する。

## 比較する3表示

### 1. 探索範囲（既定）

accepted trackの周囲に半透明corridorを描く。

- `horizontalAccuracyMeters`を探索半径へ使用
- 半径は4〜30mに制限
- accuracyがないGNSSは12m、PDR / manualは4mを暫定値とする
- confidenceが低い範囲は薄く表示
- 中心線は観測経路として残す

面は道路幅、敷地、部屋、通行可能領域を意味しない。位置精度から推定した「この付近を探索した」という範囲である。

### 2. セル

観測範囲をローカル座標上のセルへ集約する。

- 一回目から即時にセルを表示
- 再訪は登録条件ではなく、観測の重なりとconfidenceによる濃さの改善に使う
- 1つのExplorationSession内だけ補間し、session間を補間しない
- セルサイズは範囲と点数に応じて6〜60mで自動調整
- 描画セル数は最大1,400個

### 3. 軌跡

従来のaccepted track中心線。比較用baselineとして残す。

## 性能境界

rendererは端末上でraw点数に比例して無制限にViewを作らない。

- 画面上の中心線点数は概ね1,200点以下へdecimate
- coverage cellは最大1,400個
- 10,000点fixtureでgeometry生成時間をCIに記録
- decimationは表示だけに適用し、raw evidenceとcanonical routeを削除しない

## 実機・エミュレータでの判定

Android Emulatorでは次を確認する。

- 既定表示が`探索範囲`
- foregroundでPersonalMapが成長する
- `セル`と`軌跡`へ切り替えられる
- 終了、Review、再起動後保持が壊れない
- screenshotとUI hierarchyをartifactへ保存

実端末では次を比較する。

- thin trackより歩いた空間を認識しやすいか
- GPS誤差を粗い線ではなく、不確実な範囲として理解できるか
- cell表示がゲーム的な塗りつぶしに見えるだけでなく、探索の把握に役立つか
- live previewを確認するための画面注視が増えないか

## Stop / redesign条件

以下の場合は表示を完成扱いにしない。

- ユーザーに道路・敷地・部屋の確定形状だと誤認させる
- Google Maps Timelineの軌跡を太くしただけに見える
- coverage cellが観測根拠と無関係なゲーム演出になる
- 10,000点規模で操作不能になる
- background描画pollingを必要とする

この場合は、PDR、anchor、手動確認、topological representationを含む設計へ戻る。
