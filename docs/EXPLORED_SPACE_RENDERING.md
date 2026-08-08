# Explored-space rendering

更新日: 2026-08-08

## 目的

Personal Exploration Mapは、既存地図の上へGPS履歴を重ねるだけのアプリではない。一方で、位置観測の誤差をそのまま「探索した面積」へ変換すると、歩いていない空間を探索済みと誤認させる。

このrendererでは、次の三つを別々の派生表現として扱う。

```text
accepted point estimate
  ├─ location uncertainty band
  ├─ conservative passage cells
  └─ point-estimate centerline
```

- **位置の不確実性**: 実際の位置がどの付近だった可能性があるか
- **推定通過セル**: accepted point-estimate pathの近くを通ったという保守的な表示
- **中心線**: accepted point estimateを結んだ比較baseline

いずれもrenderer-derived dataであり、道路、敷地、部屋、通行可能領域、正式な探索済みpolygonではない。

## Map truthとの境界

```text
raw observation
  ↓ quality / replay
accepted TrackPoint
  ↓ read-only renderer derivation
uncertainty band / passage cells / centerline
```

次を変更しない。

- raw observation
- accepted / rejected判定
- ExplorationSession境界
- PersonalMap frame
- marker
- session間の接続

renderer、game、experienceは、これらの表示を根拠にcanonical mapを書き換えない。

## 1. 位置の不確実性

accepted point-estimate pathの周囲に、horizontal accuracy由来の薄い帯を描く。

- `horizontalAccuracyMeters`は4〜30mへboundedする
- accuracyがないGNSSは12m、PDR / manualは4mを暫定値とする
- accuracyが悪いほど帯は広くなる
- accuracyとpoint confidenceが悪いほど帯は薄くなる
- ExplorationSession内の隣接点だけを結び、session間は結ばない
- 中心推定線を併記する

この帯は「広く探索した」ことを示さない。幅は道路幅、視認範囲、敷地、部屋、通行可能領域でもない。

## 2. 推定通過セル

accepted point-estimate pathの近くを、保守的なcellへ集約する。

### 面積の決め方

- cellを塗るcore半径は2.5mを上限とし、horizontal accuracyから広げない
- 同一ExplorationSession内の隣接点間だけを補間する
- session間を補間しない
- cell sizeは範囲と点数に応じて6〜60mで調整する
- 描画cell数は最大1,400個に制限する

したがって、同じpoint-estimate pathでaccuracyだけを悪化させても、cell IDとcoverage footprintは増えない。

### 確信度と再訪

- point confidenceとaccuracy qualityをcell confidenceへ反映する
- accuracyが悪い場合は面積ではなくopacityを下げる
- 一回目からcellを表示し、再訪を登録条件にしない
- 同一session内の高密度sampleは一つのsupportとしてdeduplicateする
- `supportingSessionCount`は、そのcellを支持するExplorationSession数を表す
- 別sessionで再び通ったcellだけを少し濃くする

このcellをFog/gameのhard unlock、面積集計、canonical polygon、外部exportへそのまま利用しない。必要になった場合は、目的別の証拠閾値とユーザーへの意味を別Issueで定義する。

## 3. 採用済み位置の中心線

従来のaccepted point-estimate centerlineを比較baselineとして残す。

- 正確な道路線とは主張しない
- sessionごとに独立したlineとする
- renderer上のdecimationだけを行い、raw evidenceとcanonical routeを削除しない

## 表示文言

| Internal mode | UI | 意味 |
|---|---|---|
| `uncertainty` | `不確実性` / `位置の不確実性` | 実際の位置がこの付近だった可能性 |
| `cells` | `通過セル` / `推定通過セル` | centerline近傍の保守的な通過表示 |
| `track` | `軌跡` / `採用済み位置の中心線` | accepted point estimateの比較baseline |

`探索範囲`や`探索済み面積`という名称は、accuracy円を確定面と誤認させるため使用しない。

## Build / Adopt判断

M0では正式なpolygon、union、面積計算、GeoJSON bufferを生成しない。そのため、Turf bufferやGEOS系libraryは導入せず、次の小さなpure geometryへ限定する。

- screen-space uncertainty capsule
- local-frame conservative cell aggregation
- read-only point-estimate centerline

将来、正式な面積、polygon export、複数端末間unionが製品要件になった場合は、独自GIS engineを拡張せず、既存OSSを再評価する。

## 性能境界

- 画面上のcenterlineは概ね1,200点以下へdecimateする
- uncertainty bandはdecimated edge数にboundedする
- passage cellは最大1,400個
- 10,000点fixtureでgeometry生成時間をCIに記録する
- raw evidence、accepted route、markerは変更しない

## 自動検証

Pure TypeScript testで次を固定する。

- poor accuracyはuncertaintyを広げ、coverage footprintを増やさない
- poor accuracyはcell confidenceを下げる
- dense sampling in one sessionを再訪と数えない
- later ExplorationSessionだけが`supportingSessionCount`を増やす
- separated sessionsをband、cell、lineのいずれでも偽接続しない
- 一回目からcellが生成される
- 10,000点でもprimitive数と時間がboundedする

Android Emulatorでは次を確認する。

- 既定表示が`位置の不確実性`
- `通過セル`と`軌跡`へ切り替えられる
- foreground live preview、終了、Review、marker、再起動後保持を壊さない
- screenshotとUI hierarchyをartifact化する

## 実端末で残る判定

内部fixtureとemulatorは意味上・操作上の明らかな欠陥を減らすが、製品価値は証明しない。一つの短い実routeを一度だけ記録し、同じraw evidenceで三表示を切り替えて次を比較する。

- thin centerlineより空間を思い出しやすいか
- uncertaintyが「探索済み面積」ではなく「位置が曖昧」と理解されるか
- passage cellが単なるゲーム塗りではなく、探索把握に役立つか
- live previewのための画面注視が増えないか
- Google Maps Timelineの太線化に留まっていないか

## Stop / redesign条件

- uncertaintyを道路幅・敷地・部屋の確定形状と誤認させる
- poor accuracyほど探索済み面積が増える
- 同一sessionのsample densityを再訪回数と誤認させる
- passage cellが観測根拠と無関係なゲーム演出になる
- session間を埋める
- 10,000点規模で操作不能になる
- background描画pollingを必要とする

この場合は表示を完成扱いにせず、anchor、手動確認、topological representationを含む設計へ戻る。
