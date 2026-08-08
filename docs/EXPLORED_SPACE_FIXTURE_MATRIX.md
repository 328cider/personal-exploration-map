# Explored-space simulated fixture matrix

更新日: 2026-08-08

## 目的

実地試験はユーザーの移動・時間・端末操作コストが高い。探索範囲やセルの基本的な形状問題をユーザーの歩行でデバッグしないため、rendererへ再現可能なlocal-coordinate fixtureを与え、`探索範囲 / セル / 軌跡`を同じ入力から比較する。

このmatrixは実GNSS、Android background lifecycle、電池、身体的UXを評価しない。以下を内部で先に検出する。

- loopやturnが読めない
- 往復経路を道路幅のように誤認させる
- 広場状の探索が線にしか見えない
- 精度の悪い点が確定境界のように見える
- 離れたExplorationSessionを偽接続する
- 再訪が登録条件になっている
- primitive数が無制限に増える

## Fixture

| ID | 形状 | 主な問い |
|---|---|---|
| `rectangle-loop` | 四辺の矩形loop | 4回のturnとstart=end topologyを認識できるか |
| `out-and-back` | 一本道の往復 | 重なりが再訪に見え、太い道路の確定形状に見えないか |
| `plaza-sweep` | 広場を蛇行して面状に探索 | 線の履歴ではなく探索した空間として読めるか |
| `sparse-mixed-accuracy` | 点が疎でaccuracy / confidenceが混在 | 不確実性を見せつつ境界を断定しないか |
| `separated-sessions` | 離れた2つのExplorationSession | session間に偽のcorridorや線を作らないか |
| `overlapping-sessions` | ほぼ同じ場所を2回探索 | 一回目から成立し、再訪は観測の濃さだけを改善するか |

## 比較表示

各fixtureを次の3列で出力する。

1. `Explored corridor`
   - horizontal accuracyとconfidence由来の推定探索範囲
   - accepted route中心線を併記
2. `Coverage cells`
   - adaptive cellへ観測範囲を集約
   - overlapping observationをvisit数と濃さへ反映
3. `Thin track`
   - 一般GPS logger型の比較baseline

出力はrenderer-derived evidenceであり、canonical PersonalMapではない。

## 実装境界

`scripts/render-explored-space-fixtures.ts`は、製品と同じ`buildExploredSpaceGeometry`をimportする。fixture専用にcorridor / cellアルゴリズムを複製しない。

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
- separated sessionsのcorridor数は各session内のedge数の合計と一致する
- overlapping sessionsは少なくとも1つのcellを複数回観測する
- mixed accuracyは異なるcorridor幅を生成する

## Artifact

GitHub Actions `explored-space-fixtures`は次を保存する。

- `fixture-matrix.svg`
- `fixture-matrix.json`

SVGは視覚レビュー、JSONはprimitive数・cell size・visit数の比較に使用する。

## 初回matrixの結果

初回runは6 fixture × 3表示、計18 panelを生成し、全assertionが成功した。

主な数値:

| Fixture | Points | Corridors | Cells | Cell size | Max visits |
|---|---:|---:|---:|---:|---:|
| rectangle loop | 31 | 30 | 149 | 6m | 9 |
| out and back | 21 | 20 | 78 | 6m | 12 |
| plaza sweep | 89 | 88 | 413 | 6m | 11 |
| sparse mixed accuracy | 5 | 4 | 279 | 6m | 17 |
| separated sessions | 25 | 23 | 100 | 6m | 8 |
| overlapping sessions | 26 | 24 | 79 | 6m | 14 |

### 成立した点

- rectangle、turn、loopは中心線で認識できる
- plaza sweepはcell表示で面状の蓄積が見える
- separated sessionsはline、corridor、cellのいずれでも偽接続されない
- 一回目からcellが生成され、再訪は登録条件になっていない
- overlapping observationsはcell visit数を増やす
- mixed accuracyは異なるcorridor幅を生成する
- primitive数は設定した上限内に収まる

### 発見した問題

#### Corridorのカプセル列

rectangleやplazaでは、screen-space capsuleが規則的に連なり、連続した探索面より「円の列」に見える。位置の不確実性は表現できるが、完成した地図表現とは扱えない。

#### Accuracyとcoverageの意味が混ざっている

`sparse-mixed-accuracy`はわずか5点から279 cellを生成した。horizontal accuracyは「真の位置がどこにあるかの不確実性」であり、その円内すべてを探索した証拠ではない。

現在のcellはaccuracy円内の全cellへvisitを加えるため、精度が悪いほど探索済み面積が増えたように見える。これは`不確かな推定を事実にしない`原則と衝突する可能性がある。

この問題はIssue #54で、次の分離として扱う。

```text
estimated path / point estimate
+ location uncertainty distribution
+ conservative or probabilistic explored coverage
```

PR #53は比較基盤を追加するものであり、現在のcoverage semanticsを完成扱いにしない。

#### 再訪強度の可読性

out-and-backとoverlapping sessionsではvisit数は増えているが、画面上の濃さ差は小さい。再訪が登録条件ではないことを維持しつつ、観測の重なりをユーザーへ示す必要が本当にあるかも含めて再評価する。

## 判定への使い方

このmatrixだけでGoogle Maps Timelineとの差別化を証明しない。役割は候補を絞り、実地試験へ持ち込む表示上・意味上の明らかな問題を減らすことである。

内部レビューで次が起きた場合は、実地試験前に調整する。

- corridorがカプセルの列にしか見えず、面として理解できない
- cellが粗すぎてturnやgapを消す
- cellがゲーム塗りにしか見えず、観測根拠を理解できない
- loopや往復のtopologyを破壊する
- mixed accuracyが道路幅または探索済み面積の変化に見える
- separated sessionsの間が埋まる

Issue #54でuncertaintyとcoverageを分離し、内部fixtureとAndroid emulator E2Eの両方がgreenになった後、1回の短い実地データで表示を切り替えて評価する。表示ごとに歩き直さない。
