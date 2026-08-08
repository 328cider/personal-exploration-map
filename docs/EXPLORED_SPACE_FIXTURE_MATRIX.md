# Explored-space simulated fixture matrix

更新日: 2026-08-08

## 目的

実地試験はユーザーの移動・時間・端末操作コストが高い。基本的な形状・意味・性能問題を歩行でデバッグしないため、rendererへ再現可能なlocal-coordinate fixtureを与え、`位置の不確実性 / 推定通過セル / 軌跡`を同じ入力から比較する。

このmatrixは実GNSS、Android background lifecycle、電池、身体的UXを評価しない。以下を内部で先に検出する。

- loopやturnが読めない
- 往復経路を道路幅のように誤認させる
- 広場状の探索が線にしか見えない
- 精度の悪い点が確定境界や広い探索済み面に見える
- 離れたExplorationSessionを偽接続する
- 同一sessionの高頻度sampleを再訪と数える
- 再訪を登録条件にする
- primitive数が無制限に増える

## Fixture

| ID | 形状 | 主な問い |
|---|---|---|
| `rectangle-loop` | 四辺の矩形loop | 4回のturnとstart=end topologyを認識できるか |
| `out-and-back` | 一本道の往復 | 重なりが再訪に見え、太い道路の確定形状に見えないか |
| `plaza-sweep` | 広場を蛇行して面状に探索 | 通過セルが空間的な蓄積として読めるか |
| `sparse-mixed-accuracy` | 点が疎でaccuracy / confidenceが混在 | 不確実性を示しつつ、歩いていない面を埋めないか |
| `separated-sessions` | 離れた2つのExplorationSession | session間に偽のband・line・cellを作らないか |
| `overlapping-sessions` | ほぼ同じ場所を2回探索 | 一回目から成立し、別sessionの再観測だけがsupportを増やすか |

## 比較表示

各fixtureを次の3列で出力する。

1. `Location uncertainty`
   - horizontal accuracy由来の位置不確実性帯
   - accuracy qualityとconfidenceをopacityへ反映
   - accepted point-estimate centerlineを併記
2. `Conservative passage cells`
   - 中心推定経路の保守的なcoreだけをadaptive cellへ集約
   - horizontal accuracyはcell footprintを広げずconfidenceだけを下げる
   - `supportingSessions`を再観測の強さへ反映
3. `Thin track`
   - accepted point-estimate centerline
   - 一般的GPS logger型の比較baseline

出力はrenderer-derived evidenceであり、canonical PersonalMapではない。

## 実装境界

`scripts/render-explored-space-fixtures.ts`は、製品と同じ`buildExploredSpaceGeometry`をimportする。fixture専用にuncertainty / cellアルゴリズムを複製しない。

```text
fixture local observations
  ↓
buildExploredSpaceGeometry（製品と同じpure function）
  ↓
SVG matrix + JSON metrics
```

次を変更しない。

- raw evidence schema
- accepted / rejected判定
- PersonalMap frame
- ExplorationSession境界
- marker
- canonical write authority

## 自動assertion

- すべてのfixtureが一回の入力から描画される
- rendered centerlineは1,201点以下
- cellは1,400個以下
- separated sessionsのuncertainty band数は各session内edge数の合計と一致する
- 単一session fixtureはsample密度にかかわらず`maximumSupportingSessions = 1`
- overlapping sessionsは少なくとも1つのcellを2 sessionが支持する
- mixed accuracyは異なるuncertainty幅を生成する
- 同じsparse経路をaccuracy 4m / 30mへ置き換えてもcell ID列が一致する
- poor accuracy側は平均cell confidenceが低い

## Artifact

GitHub Actions `explored-space-fixtures`は次を保存する。

- `fixture-matrix.svg`
- `fixture-matrix.json`

SVGは視覚レビュー、JSONはpoint数、uncertainty primitive数、cell数、cell size、supporting session数、平均confidenceの比較に使用する。

## Issue #54反映後のmatrix結果

6 fixture × 3表示、計18 panelをproduction geometryから生成する。

| Fixture | Points | Uncertainty bands | Passage cells | Cell size | Max supporting sessions | Avg cell confidence |
|---|---:|---:|---:|---:|---:|---:|
| rectangle loop | 31 | 30 | 100 | 6m | 1 | 0.848 |
| out and back | 21 | 20 | 38 | 6m | 1 | 0.822 |
| plaza sweep | 89 | 88 | 250 | 6m | 1 | 0.796 |
| sparse mixed accuracy | 5 | 4 | 53 | 6m | 1 | 0.359 |
| separated sessions | 25 | 23 | 54 | 6m | 1 | 0.825 |
| overlapping sessions | 26 | 24 | 45 | 6m | 2 | 0.787 |

### 旧方式からの重要な変化

旧方式の`sparse-mixed-accuracy`は、わずか5点からaccuracy円内を塗り、279 cellを生成していた。分離後は中心推定経路の近傍だけを扱うため53 cellとなり、accuracy 4mと30mでcell ID列は変わらない。

```text
旧:
poor accuracy
  → 大きなaccuracy円
  → 多数cell
  → 広く探索したように見える

新:
poor accuracy
  ├─ uncertainty bandは広く薄くなる
  └─ passage cell footprintは同じ、confidenceだけ下がる
```

### 成立した点

- rectangle、turn、loopは中心線で認識できる
- plaza sweepは推定通過セルで空間的な蓄積が見える
- separated sessionsはline、uncertainty、cellのいずれでも偽接続されない
- 一回目からcellが生成され、再訪は登録条件になっていない
- 同一sessionの高密度sampleは再訪と数えられない
- overlapping sessionsだけが`supportingSessions = 2`を生成する
- mixed accuracyは異なる不確実性幅とconfidenceを生成する
- poor accuracyが推定通過セル面積を増やさない
- primitive数は設定した上限内に収まる

### 残る表示上の課題

#### 不確実性帯のカプセル列

rectangleやplazaでは、screen-space capsuleが規則的に連なって見える。これは位置不確実性の比較primitiveとしては利用できるが、完成した地図面とは扱わない。

#### 通過セルの意味

推定通過セルは身体の正確な占有面積でも、道路・敷地・部屋でもない。UI文言と実端末評価で、中心推定経路の近傍を保守的に示すderived evidenceとして理解できるかを確認する。

#### 再訪強度

別sessionのsupportは数値上区別できるが、濃さの差が本当に有用かは未確定である。再訪を登録条件へ戻さず、価値がなければ視覚強調自体を弱める。

## 判定への使い方

このmatrixだけでGoogle Maps Timelineとの差別化を証明しない。役割は候補を絞り、実地試験へ持ち込む表示上・意味上の明らかな問題を減らすことである。

内部レビューで次が起きた場合は、実地試験前に調整する。

- 不確実性帯が探索済み面や道路幅に見える
- poor accuracyで通過セルの物理footprintが増える
- cellが粗すぎてturnやgapを消す
- cellが観測根拠のないゲーム塗りに見える
- loopや往復のtopologyを破壊する
- separated sessionsの間が埋まる

内部fixtureとAndroid Emulator E2Eの両方がgreenになった後、1回の短い実地データで3表示を切り替えて評価する。表示ごとに歩き直さない。
