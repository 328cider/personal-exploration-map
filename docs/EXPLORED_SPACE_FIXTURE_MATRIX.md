# Explored-space simulated fixture matrix

更新日: 2026-08-08

## 目的

実地試験はユーザーの移動・時間・端末操作コストが高い。位置の不確実性、推定通過セル、中心線の形状と意味をユーザーの歩行でデバッグしないため、rendererへ再現可能なlocal-coordinate fixtureを与える。

このmatrixは実GNSS、Android background lifecycle、電池、身体的UX、Google Maps Timelineとの差別化を証明しない。次を内部で先に検出する。

- loopやturnが読めない
- 往復経路を道路幅のように誤認させる
- 広場状の移動が線にしか見えない
- poor accuracyが探索済み面積を増やす
- 同一sessionのsample densityを再訪と数える
- 離れたExplorationSessionを偽接続する
- primitive数が無制限に増える

## Fixture

| ID | 形状 | 主な問い |
|---|---|---|
| `rectangle-loop` | 四辺の矩形loop | 4回のturnとstart=end topologyを認識できるか |
| `out-and-back` | 一つのsession内で一本道を往復 | 重なりを再訪sessionと誤集計しないか |
| `plaza-sweep` | 広場を蛇行して面状に移動 | conservative cellsで空間的な蓄積が読めるか |
| `sparse-mixed-accuracy` | 点が疎でaccuracy / confidenceが混在 | uncertaintyは広がるがcoverage footprintは増えないか |
| `separated-sessions` | 離れた2つのExplorationSession | session間に偽のband、cell、lineを作らないか |
| `overlapping-sessions` | ほぼ同じ場所を別sessionで2回探索 | 一回目から成立し、別sessionだけがsupportを強めるか |

## 比較表示

各fixtureを同じ入力から次の3列で出力する。

1. `Location uncertainty`
   - horizontal accuracy由来の薄いband
   - accuracyが悪いほど広く、かつ薄い
   - accepted point-estimate centerlineを併記
2. `Conservative passage cells`
   - point-estimate pathの近くを固定coreで集約
   - accuracyはcell footprintではなくconfidenceへ反映
   - `supportingSessionCount`はsupporting ExplorationSession数
3. `Point-estimate track`
   - accepted centerlineの比較baseline

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
- out-and-backの`maximumSupportingSessions`は1のまま
- overlapping sessionsでは少なくとも1つのcellが2 sessionから支持される
- mixed accuracyは異なるuncertainty幅を生成する
- mixed accuracyとall-accurate counterpartのcell ID集合は一致する
- mixed accuracyの平均cell confidenceはall-accurate counterpartより低い

## Issue #54適用後の結果

6 fixture × 3表示、計18 panelを生成し、全assertionが成功した。

| Fixture | Points | Uncertainty bands | Cells | Cell size | Avg cell confidence | Max session visits |
|---|---:|---:|---:|---:|---:|---:|
| rectangle loop | 31 | 30 | 100 | 6m | 0.8481 | 1 |
| out and back | 21 | 20 | 38 | 6m | 0.8221 | 1 |
| plaza sweep | 89 | 88 | 250 | 6m | 0.7962 | 1 |
| sparse mixed accuracy | 5 | 4 | 53 | 6m | 0.3590 | 1 |
| separated sessions | 25 | 23 | 54 | 6m | 0.8250 | 1 |
| overlapping sessions | 26 | 24 | 45 | 6m | 0.7872 | 2 |

### 旧実装との差

| Fixture | 旧cells | 新cells | 旧max visits | 新max session visits |
|---|---:|---:|---:|---:|
| rectangle loop | 149 | 100 | 9 | 1 |
| out and back | 78 | 38 | 12 | 1 |
| plaza sweep | 413 | 250 | 11 | 1 |
| sparse mixed accuracy | 279 | 53 | 17 | 1 |
| separated sessions | 100 | 54 | 8 | 1 |
| overlapping sessions | 79 | 45 | 14 | 2 |

旧`visits`はaccuracy円とsample densityを数えていたため、同一sessionでも大きな値になっていた。新`supportingSessionCount`はcellを支持するExplorationSession数であり、往復や高密度sampleを再訪sessionと偽装しない。

`sparse-mixed-accuracy`は279 cellから53 cellへ減少した。より重要なのは数の減少そのものではなく、同じ座標をすべて高精度にしたcounterpartとcell ID集合が一致し、poor accuracyがcoverage footprintを増やさなくなったことである。accuracyの悪化は平均cell confidence低下として残る。

## 成立した点

- rectangle、turn、loopはcenterlineで認識できる
- plaza sweepはconservative cellsで空間的な蓄積が見える
- separated sessionsはband、cell、lineのいずれでも偽接続されない
- 一回目からcellが生成され、再訪を登録条件にしない
- 同一sessionのout-and-backは`supportingSessionCount=1`
- 別sessionのoverlapだけが`supportingSessionCount=2`
- mixed accuracyはuncertainty幅へ現れ、cell面積へ現れない
- primitive数は設定した上限内に収まる

## 残る表示上の課題

### Uncertainty bandのカプセル列

rectangleやplazaではscreen-space capsuleが規則的に連なり、連続した確率分布というより円の列に見える場合がある。意味上はcoverageから分離できたが、最終的な視覚品質は完成扱いにしない。

### Passage cellの粒度

cell sizeが粗すぎるとturnやgapを消し、細かすぎるとゲーム塗りに見える。現在の6〜60m adaptive ruleはM0比較用であり、正式な探索面積やFog unlock規則ではない。

### 再訪強度

別sessionによるsupport増加はopacityへ反映するが、それをユーザーへ強調する価値があるかは未確定である。再訪は登録条件にせず、必要以上に「周回ゲーム」の見た目へ寄せない。

## Artifact

GitHub Actions `explored-space-fixtures`は次を保存する。

- `fixture-matrix.svg`
- `fixture-matrix.json`

SVGは視覚レビュー、JSONはprimitive数、cell size、平均confidence、supporting session数の比較に使用する。

## 次の判定

内部fixtureとAndroid Emulator E2Eがgreenになった後、1回の短い実routeだけを記録し、同じraw evidenceで三表示を切り替える。表示ごとに歩き直さない。

次のいずれかならredesignする。

- uncertaintyが探索済み面積または道路幅に見える
- passage cellが観測根拠のないゲーム塗りに見える
- loopや往復のtopologyを壊す
- separated sessionsの間を埋める
- centerline以外の表示がGoogle Maps Timelineとの差を生まない
