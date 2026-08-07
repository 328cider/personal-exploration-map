# Experiment 003: react-native-svg PersonalMap Renderer

- Status: Implementation complete; Android visual validation pending
- Date: 2026-08-07
- Issue: #19
- Pull request: #32

## Question

M0のView-per-segment rendererを既存OSSへ置き換え、PersonalMapの不変条件を維持したまま、数千〜1万点規模の白紙地図を現実的に描画できるか。

## Decision under test

Expo SDK 57が推奨する`react-native-svg@15.15.4`をmobile rendererへ採用する。

- exact version: `15.15.4`
- package scope: `apps/mobile`のみ
- license: MIT
- lockfile: root `package-lock.json`
- canonical mapping packagesへのdependency: なし

React Native Skiaは先行導入しない。SVGが実端末で不足した場合だけ比較する。

## Product invariants

rendererは次を変更しない。

- raw observations
- accepted / rejected
- coordinate frame
- ExplorationSession membership
- segment connection
- confirmed markers
- PersonalMap stats

入力はread-onlyな`MapSnapshot`または`PersonalMapSnapshot`である。

## Geometry design

### Separate session paths

各ExplorationSessionを独立したsource segmentとして処理する。session Aの最後とsession Bの最初を同じSVG pathへ入れない。

```text
session A → one or more SVG Path runs
session B → one or more SVG Path runs
```

1 session内でもconfidence band / opacity bucketが変わる場合はstrokeを分けるが、境界pointを重複させて線を連続表示する。これは表示上のstyle splitであり、地図のsegmentを変更しない。

### Uncertainty

edge confidenceは隣接2点の小さい方を使う。

- confidence >= 0.5: normal track color
- confidence < 0.5: low-confidence color
- opacity: 0.1刻み、最低0.4相当へ切り上げ

低確度線を正確な線と同じ見た目にしない一方、完全に見えなくもしない。

### Markers and endpoints

- 各sessionにstart / end circle
- confirmed markerをCircle + glyphで描画
- markerとendpointはtrackと同じprojectionを使う
- grid / compassはpresentation layerでありmap truthではない

## Automated validation

### Read-only boundary

`scripts/check-renderer-boundary.mjs`で次を検査する。

- `react-native-svg`はmobile rendererだけに存在
- mapping-core / engine / experience / SQLite adapterへ漏れない
- pure geometry moduleはReact Native / Expo / SVGへ依存しない
- rendererがcanonical mutationを呼ばない
- exact dependency versionを固定

### Geometry tests

`apps/mobile/test/trackGeometry.test.ts`で次を確認する。

- two sessions remain separate stroke sources
- session間の人工connectionを生成しない
- confidence changeはstyle runだけを分割
- markerとendpointが同じprojectionを使う
- empty / pre-layout状態で描画primitiveを生成しない

### CI result

- renderer boundary: passed
- mobile typecheck: passed
- geometry tests: 4 passed / 0 failed
- locked `npm ci`: passed
- resolved `react-native-svg`: 15.15.4

## CPU geometry benchmark

GitHub Actions Ubuntu runner / Node 22上で、projectionとSVG path string構築だけを7回計測した。warmup 2回を除外してnearest-rank median / p95を記録する。

| Scenario | Points | Sessions | Markers | SVG strokes | Median | p95 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| M0 small | 1,000 | 1 | 10 | 54 | 4.728 ms | 7.847 ms | 7.847 ms |
| M1 growing | 5,000 | 20 | 50 | 287 | 3.753 ms | 4.545 ms | 4.545 ms |
| Stress | 10,000 | 100 | 100 | 629 | 9.901 ms | 15.953 ms | 15.953 ms |

### Interpretation

この結果が示すもの:

- pure geometry / path constructionはM0規模で支配的なCPU bottleneckではない
- confidence splitを含めても10,000点で1 frame相当付近に収まるrunner結果が得られた
- session分離を維持してもpath数はpoint数より十分少ない

この結果が示さないもの:

- Android native SVG rendering frame rate
- React reconciliation cost
- low-end device memory
- pan / zoom interaction
- 画面回転や再layout
- 100以上のgame overlay追加時の性能

したがって、CPU benchmarkだけでIssue #19を完全完了とはしない。

## Android validation gate

development APKで最低次を確認する。

1. demo PersonalMapを表示
2. multi-session PersonalMapでstart/endがsessionごとに見える
3. session間に線がない
4. low-confidence strokeが区別できる
5. marker glyphがAndroidで崩れない
6. 1k / 5k / 10k fixtureを表示
7. screen transitionと再layoutでcrashしない
8. memory pressure / obvious jankを記録

### Adopt SVG

- M0 / M1 fixtureでReview表示が安定
- pan / zoomを追加する前のstatic reviewで明らかなjankがない
- marker / confidence / segment semanticsが維持される

### Benchmark Skia

次のいずれかを実端末で再現した場合だけ。

- 5,000点・20session程度でReview表示が継続的に不安定
- pan / zoom追加時にframe dropが実用を妨げる
- uncertainty band / game overlayでSVG node数が主要bottleneckになる
- target low-end deviceでmemoryが許容範囲を超える

Skia比較を開始しても、SVG rendererを即削除せず同一fixtureで比較する。

## Remaining work

- Android development buildでnative linking / rendering確認
- target端末のvisual / frame-stability observation
- pan / zoomは必要性をdogfoodで確認してから設計
- game overlayのrenderer contractは2つ目の実利用appができてから拡張

## Decision

**Conditional Adopt.**

`react-native-svg@15.15.4`をM0の標準renderer実装として採用する。automated boundary・geometry・CPU benchmarkは合格。最終的なIssue #19 closeはAndroid実端末のvisual / stability gate後とする。
