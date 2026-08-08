# Explored-space rendering

更新日: 2026-08-08

## 目的

細いGNSS軌跡だけでは、一般的なGPSロガーやGoogle Maps Timelineとの差が体験として見えにくい。一方、GPSの`horizontalAccuracyMeters`をそのまま「探索した半径」へ変換すると、位置が不確かなほど歩いていない空間まで探索済みに見える。

このrendererでは、次の3概念を混ぜない。

```text
accepted TrackPointの中心推定
  ├─ 中心線                  = 採用済み位置のpoint estimate
  ├─ 位置の不確実性帯        = 真の位置がどこにあり得るか
  └─ 保守的な推定通過セル    = 中心推定経路の近傍だけ
```

目的は正式な道路・敷地・部屋・可視範囲を生成することではない。推定を事実として偽装せず、ユーザーが自分の探索証拠を読み返せる比較表示を作ることである。

## Map truthとの境界

すべてrenderer-derived dataであり、canonical map truthではない。

```text
raw observation
  ↓ quality / replay
accepted TrackPoint
  ↓ read-only renderer derivation
centerline / uncertainty band / passage cells
```

次を変更しない。

- raw observation
- accepted / rejected判定
- ExplorationSession境界
- PersonalMap frame
- marker
- session間の接続

renderer、game、experienceは、位置の不確実性帯や推定通過セルを根拠にcanonical mapを書き換えない。

## 重要な意味分離

### 位置の不確実性

`horizontalAccuracyMeters`は、真の位置が中心推定の周辺にある不確実性を表す。次を意味しない。

- その半径内をすべて歩いた
- 道路や通路がその幅である
- ユーザーが見渡した範囲である
- 敷地・部屋・通行可能領域の境界である

accuracyが悪い場合は、不確実性帯を広く、かつ薄く表示する。

### 推定通過セル

推定通過セルは、accepted TrackPointの中心推定を同一ExplorationSession内で結んだ経路の近傍を、保守的な固定コアでセル化したものとする。

- セルの物理的footprintは`horizontalAccuracyMeters`から広げない
- accuracyが悪い場合はセルconfidenceとopacityを下げる
- 一回目の探索から生成する
- 再訪は登録条件にしない
- 同一session内の高頻度sampleを再訪回数として数えない
- `supportingSessions`は、そのセルを支持する独立ExplorationSession数とする
- session間を補間しない

推定通過セルも身体の正確な占有面積ではない。中心推定経路に近いというrenderer上の保守的なderived evidenceである。

## Build / Adopt判断

位置取得、SQLite、Android emulator lifecycleは既存platform / OSSへ任せる。

今回の不確実性帯とセルは、汎用GIS buffer engineを再実装するものではない。TrackPointはすでにメートル単位のPersonalMap local frameへ投影されており、M0で必要なのは端末内の比較表示だけである。

`Turf buffer`やGEOS系ライブラリは現時点で採用しない。

- 正式なGeoJSON polygonやpolygon unionを生成しない
- uncertainty / passage cellをcanonical geometryとして保存・exportしない
- 道路・敷地・部屋の境界を演算しない
- 面積を製品指標として確定しない
- dependencyとpolygon edge caseを価値検証前に増やさない

将来、正式なpolygon export、面積計算、複数端末間unionが製品要件になった場合は、独自polygon処理を増やさず既存GIS OSSを再評価する。

## 比較する3表示

### 1. 不確実性（既定）

accepted track中心線の周囲に、位置の不確実性帯を描く。

- `horizontalAccuracyMeters`を不確実性半径へ使用
- 半径は4〜30mに制限
- accuracyがないGNSSは12m、PDR / manualは4mを暫定値とする
- confidenceとaccuracy qualityが低いほど薄く表示
- 中心線はpoint estimateとして残す
- 表示名は`位置の不確実性`

幅が広いほど「広く探索した」のではなく「中心推定が曖昧」である。

### 2. 通過セル

中心推定経路の近傍だけをローカル座標上のセルへ集約する。

- passage core半径はaccuracyから独立した保守値
- 一回目から即時にセルを表示
- accuracyはセル面積ではなくconfidenceへ反映
- 独立sessionの再観測だけを`supportingSessions`へ反映
- 1つのExplorationSession内だけ補間し、session間を補間しない
- セルサイズはPersonalMap範囲と点数に応じて6〜60mで自動調整
- 描画セル数は最大1,400個
- 表示名は`推定通過セル`

### 3. 軌跡

accepted TrackPointの中心推定を結んだ線。一般的なGPS loggerとの比較baselineとして残す。

## 性能境界

rendererは端末上でraw点数に比例して無制限にViewを作らない。

- 画面上の中心線点数は概ね1,200点以下へdecimate
- passage cellは最大1,400個
- 10,000点fixtureでgeometry生成時間をCIに記録
- decimationは表示だけに適用し、raw evidenceとcanonical routeを削除しない

## 自動検証

unit testとfixture matrixで最低限次を固定する。

- poor accuracyは不確実性帯を広げるが、推定通過セルのID・物理footprintを増やさない
- poor accuracyはセルconfidence / opacityを下げる
- 同一sessionの密なsampleは`supportingSessions = 1`のまま
- 別sessionの再訪は重なるセルを強める
- separated sessionsを偽接続しない
- rectangle、out-and-back、plaza、sparse mixed accuracy、separated、revisitを同じproduction geometryで比較する
- 10,000点でもprimitive上限を超えない

## Android Emulatorでの判定

Android Emulatorでは次を確認する。

- 既定表示が`位置の不確実性`
- foregroundでPersonalMapが成長する
- `通過セル`と`軌跡`へ切り替えられる
- 不確実性表示へ戻せる
- 終了、notification復帰、marker、Review、再起動後保持が壊れない
- screenshotとUI hierarchyをartifactへ保存

エミュレータ合格は、実GNSS精度、長時間screen-off、OEM kill、電池、身体的UXを証明しない。

## 実端末での判定

一つの実経路を一度記録し、同じraw evidenceから3表示を切り替えて比較する。表示ごとに歩き直さない。

- thin trackより経路・turn・loopを思い出しやすいか
- 不確実性帯を探索済み面積や道路幅と誤認しないか
- 推定通過セルがゲーム的な塗りつぶしだけでなく、探索の把握に役立つか
- sparse / poor accuracy区間を確定面と誤解しないか
- live previewを確認するための画面注視が増えないか

## Stop / redesign条件

以下の場合は表示を完成扱いにしない。

- ユーザーに道路・敷地・部屋の確定形状だと誤認させる
- accuracyが悪いほど探索済み面積が増えたように見える
- Google Maps Timelineの軌跡を太くしただけに見える
- passage cellが観測根拠と無関係なゲーム演出になる
- 10,000点規模で操作不能になる
- background描画pollingを必要とする

この場合も、PDRを先に導入して表示問題を隠さない。anchor、手動確認、topological representationを含む設計へ戻る。
