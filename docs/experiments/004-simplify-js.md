# Experiment 004: internal RDP vs simplify-js

- Status: Benchmark implementation ready; CI results pending
- Date: 2026-08-07
- Issue: #20
- Candidate: `simplify-js@1.2.4`

## Question

`mapping-core/src/simplify.ts`のdependency-free Ramer–Douglas–Peucker実装を維持するか、既存OSSの`simplify-js`へ置き換えるか。

アルゴリズム自体は製品独自価値ではない。判断対象は、geometry、provenance、performance、dependency / license costである。

## Product constraints

どちらを採用しても次を変えてはならない。

- raw TrackPointを削除・上書きしない
- ExplorationSession間を一緒にsimplifyしない
- gapを越えて線を生成しない
- pointの`sampleId`、`sourcePosition`、`confidence`を保持する
- markerやconfirmed evidenceを推測で移動しない
- simplificationは再生成可能なderived map処理である

## Candidate

Benchmarkではproduct workspaceへdependencyを追加しない。

- exact candidate: `simplify-js@1.2.4`
- install location: `/tmp/simplify-js-benchmark`
- version / license / integrity / repository metadataをnpm registryからartifactへ保存
- product採用はbenchmark decision後の別commitで行う

## Implementations

### Internal

現在のrecursive RDP。

- tolerance squaredを使う
- radial-distance pre-passなし
- input `TrackPoint` objectをそのまま返す
- package installなしでcore testを実行可能

### simplify-js high quality

```js
simplify(points, tolerance, true)
```

radial-distance pre-passを使わずRDPのみを使う。internal実装とのpoint id完全一致を要求する。

### simplify-js default

```js
simplify(points, tolerance, false)
```

radial-distance + RDP。より速い可能性がある一方、output point selectionが変わり得る。

## Fixtures

- noisy line: 1k / 10k / 100k points
- rectangular loop: 10k
- marker-nearby sharp turn: 10k
- explicit gap: two 5k segmentsを別々に処理

Toleranceは1.5 m。

## Metrics

- output point count
- internal vs high-quality exact sample ids
- original object references
- provenance fields
- median / p95 / max runtime
- default outputとinternal polylineのsymmetric maximum deviation
- exact candidate metadata / license / integrity

## Assertions

Benchmark自体が次を満たさなければCI失敗。

- high-quality output sample idsがinternal RDPと完全一致
- simplify-jsがoriginal point referenceを返す
- `sampleId` / `confidence` / local `sourcePosition`が保持される
- gap fixtureを2 segmentのまま別々に処理する

## Decision options

### Adopt simplify-js high quality

- geometryとpoint idsが完全一致
- materialなperformance改善がある
- BSD-2-Clauseとdependency costが許容できる
- TrackPoint adapterが小さく、coreのmap truthを複雑化しない

### Adopt simplify-js default

high qualityよりさらにmaterialな改善があり、point selection差がM0/M1の地図認識やmarker近傍形状へ悪影響を与えない場合だけ。

### Retain internal RDP

- performance差がM0/M1規模で意味を持たない
- external dependency / adapter / bundle costが上回る
- exact high-quality結果が同じで、小さな実装を維持する方が監査しやすい

維持する場合も「独自アルゴリズム」ではなく、標準RDPの小さなdependency-free実装であることを明記する。

## Non-goals

- raw observationsを事前に捨てる
- simplification toleranceのUX決定
- marker-aware protected-point algorithm
- topology / coverage simplification
- Turf/GeoJSON pipelineの先行導入

## Output

CI artifact:

- `simplify-js-metadata.json`
- `simplify-benchmark.ndjson`

結果をこの文書とIssue #20へ反映し、採用または維持を明示してからIssueを閉じる。
