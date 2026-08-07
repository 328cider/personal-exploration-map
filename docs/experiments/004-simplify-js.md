# Experiment 004: internal RDP vs simplify-js

- Status: **Completed — retain internal dependency-free RDP**
- Date: 2026-08-07
- Issue: #20
- Candidate: `simplify-js@1.2.4`
- Workflow run: `31183327902`
- Artifact id: `8995679065`
- Artifact digest: `sha256:6879535f50034e1747ff61aadda4b6efdf03b5dd488995d86f3edec7d4f48153`

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

## Candidate metadata

GitHub Actionsでnpm registryからexact metadataを取得した。

```json
{
  "version": "1.2.4",
  "license": "BSD-2-Clause",
  "dist.integrity": "sha512-vITfSlwt7h/oyrU42R83mtzFpwYk3+mkH9bOHqq/Qw6n8rtR7aE3NZQ5fbcyCUVVmuMJR6ynsAhOfK2qoah8Jg==",
  "repository.url": "git://github.com/mourner/simplify-js.git"
}
```

Benchmarkではproduct workspaceへdependencyを追加せず、`/tmp/simplify-js-benchmark`へinstallした。

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

radial-distance pre-passを使わずRDPのみを使う。すべてのfixtureでinternal実装とpoint idが完全一致し、original object referenceとprovenanceも保持された。

### simplify-js default

```js
simplify(points, tolerance, false)
```

radial-distance + RDP。高速だが、noisy routeではoutput point selectionとgeometryが変わった。

## Fixtures

- noisy line: 1k / 10k / 100k points
- rectangular loop: 10k
- marker-nearby sharp turn: 10k
- explicit gap: two 5k segmentsを別々に処理
- tolerance: 1.5 m

各fixtureはwarm-up 2回後、100k pointsは5回、それ以外は15回計測した。単一GitHub-hosted runner上のmicrobenchmarkであり、絶対性能保証ではなく採否の方向判断に使う。

## Results

### Geometry and provenance

- high-quality mode: 全fixtureでinternal RDPと**exact point ids一致**
- high-quality mode: original point referencesを返し、`sampleId` / `confidence` / local `sourcePosition`を保持
- gap fixture: 2 segmentを別々に処理し、偽接続なし
- default mode: noisy fixturesでoutput pointsが変化
- default mode: internal polylineとの差は最大約`1.696 m`

### Runtime summary

| Fixture | Internal median | simplify-js HQ median | simplify-js default median | Decision signal |
|---|---:|---:|---:|---|
| noisy line 1k | 0.119 ms | 0.480 ms | 0.054 ms | HQは遅い |
| noisy line 10k | 7.101 ms | 8.745 ms | 1.768 ms | M1規模でinternalがHQより速い |
| noisy line 100k | 221.288 ms | 219.663 ms | 100.574 ms | HQ差は約1%でmaterialでない |
| rectangular loop 10k | 0.189 ms | 0.127 ms | 0.115 ms | 全方式で十分小さい |
| marker-nearby turn 10k | 0.131 ms | 0.088 ms | 0.098 ms | 全方式で十分小さい |
| gap segment 5k A | 1.949 ms | 1.668 ms | 1.000 ms | HQ p95はinternalより悪い |
| gap segment 5k B | 1.402 ms | 1.251 ms | 0.656 ms | 絶対差は小さい |

詳細NDJSONはworkflow artifactに保存した。

## Decision

### Retain internal RDP

現時点では`simplify-js`をproduct dependencyへ追加しない。

理由:

1. M0/M1の1k〜10k noisy routeでは、high-quality modeに一貫した性能優位がない。
2. 100k pointsでもhigh-quality modeのmedian差は約1%で、dependency追加を正当化するほどmaterialではない。
3. default modeは高速だが、point selectionとgeometryが変わる。最大差はtoleranceと同程度であり、実機の地図認識性やmarker近傍形状を確認せず採用しない。
4. current implementationは小さく、dependency-free core test、original `TrackPoint` reference、provenance保持が明確である。
5. current RDPは製品独自アルゴリズムとして扱わず、標準RDPの監査可能な小規模実装として維持する。

これは「OSSを使わないことを好む」判断ではない。候補をexact version / license / integrity付きで比較し、現在の要件では採用便益がdependency costを上回らないという判断である。

## Revisit conditions

次のいずれかが実測された場合に再比較する。

- 1 sessionで100k accepted points級が通常利用になる
- simplificationが実機Reviewの待ち時間を支配する
- recursive implementationでstack / latency問題が発生する
- GeoJSON pipelineを導入し、共通OSSへの統合価値が生じる
- marker-aware protected-pointやtopology-aware simplificationが必要になる
- simplify-jsまたは別候補にmaterialな実装改善がある

再比較時もraw evidence、session境界、gap、provenanceを維持する。

## Non-goals

- raw observationsを事前に捨てる
- simplification toleranceのUX決定
- marker-aware protected-point algorithm
- topology / coverage simplification
- Turf / GeoJSON pipelineの先行導入

## Output

CI artifact:

- `simplify-js-metadata.json`
- `simplify-benchmark.ndjson`

Issue #20は本判断をもって完了とする。production dependency変更は行わない。
