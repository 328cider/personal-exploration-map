# ADR 0008: 独自価値でない一般部品は採用・比較を先にする

- Status: Accepted
- Date: 2026-08-07

## Context

PersonalMapの独自価値は、personal exploration evidenceを正本とし、一度の探索から地図を作り、複数ExplorationSessionを偽接続せず育て、passive-first UXとgame境界を守ることにある。

一方、位置API、SQLite、描画primitive、標準的な軌跡簡略化、測地計算、GPX / GeoJSON等まで独自実装すると、車輪の再発明、保守負荷、edge case、ライセンス見落としを増やす。

初期縦切りではdependency-free検証のため、小さなRDP簡略化、局所的な座標投影、View-per-segment rendererを実装した。これらを製品固有の資産と誤認して拡張し続けないため、部品別のBuild / Adopt / Benchmark境界が必要である。

## Decision

### Adopt

次は既存platform、OSS、標準を製品経路で利用する。

- background location / task lifecycle: Expo Location / TaskManager
- local database: Expo SQLite
- blank-map rendererの次段階: react-native-svg
- geographic track exchange: GPX 1.1 semantics
- geographic derived map exchange: GeoJSON semantics

exact version、license、NOTICE、transitive dependencyはlockfile導入時に記録する。

### Build

次は製品固有の不変条件なので薄い独自domainとして維持する。

- raw observationsを正本とするmodel
- ExplorationSessionとPersonalMapの分離
- session間を未観測の線で接続しない規則
- geographic / local frameをanchorなしで混ぜない規則
- uncertainty / confirmed evidence / inferenceの区別
- canonical map write authority
- passive-first UXとread-only game boundary
- raw evidenceを保持するversioned lossless PersonalMap bundle

### Benchmark before adopting

次は現在の実装を恒久化せず、実データで比較してから決める。

- current RDP vs simplify-js
- react-native-svg vs React Native Skia（SVGが実測で不足した場合のみ）
- current local projection vs GeographicLib / Proj4js（明示された範囲外要件が出た場合）
- pocket PDR vs Path Guide / RoNIN / TLIO等の公開baseline

### Defer

次はM0の価値検証に不要なので、将来可能性だけでは追加しない。

- MapLibreによる常設basemap
- dynamic plugin loader
- remote experience distribution
- global/high-precision geodesy
- camera / ARを通常探索のdefaultにすること

## Renderer decision

current View-per-segment `TrackCanvas`はreference implementationとする。zoom / pan、uncertainty、数千point、multiple overlaysへ機能を増やす前にreact-native-svgへ移行する。

移行はIssue #2でExpo dependencyとlockfileを再現可能にした後に行う。current fixtureと同じsegment / marker / confidenceを描画し、rendererがmap truthを変更しないことを条件とする。

React Native Skiaは「高性能そう」という理由では導入しない。SVGのpoint count、frame stability、interactionをtarget端末で測定し、不足した場合だけ比較する。

## Simplification decision

current `simplifyTrack`は標準Ramer–Douglas–Peuckerのdependency-free実装であり、独自アルゴリズムではない。

M0のpackage-install不要testと`TrackPoint` provenance保持のため一時維持する。simplify-jsと次を比較する。

- output geometry
- corner / marker-nearby shape preservation
- 1k / 10k / 100k points runtime
- bundle / type / dependency cost
- radial-distance pre-passの影響

採用しない場合も、比較結果と理由を記録する。

## Geodesy decision

current equirectangular local projectionとhaversineは、局所的なPersonalMap用に範囲を限定して維持する。

engineering envelope:

- absolute latitude < 80 degrees
- originから推奨半径20 km以内
- antimeridianはshortest longitude deltaを使う
- global route、測量、救助、安全保証には使わない

範囲外をrawから捨てない。diagnostic、map split、explicit better transformの判断材料にする。

Proj4jsはexplicit CRS transformationが必要になった時、GeographicLibはlong distance / high latitude / geodesic precisionが製品価値になった時に採用する。

## Exchange decision

GPXとGeoJSONをlossless backupにしない。

- GPX: geographic ExplorationSessionごとに別`trkseg`
- GeoJSON: geographic derived segments / markers
- local coordinatesをlongitude / latitudeへ偽装しない
- raw/rejected/local frameを含むbackupはversioned PersonalMap bundle
- game stateはcanonical map exportと分離

詳細は`docs/EXPORT_BOUNDARY.md`に従う。

## License policy

- permissive licenseでもexact releaseを確認する
- GPL-family codeを無意識にproduct pathへ含めない
- research repositoryは公開されていてもlicenseが明示されるまで組み込まない
- source codeを使わずbehaviorを参考にする場合も、何を参考にしたかを記録する
- dependency追加PRにBuild / Adopt / Benchmark判断とlicenseを含める

## Consequences

### Positive

- 独自価値へ実装資源を集中できる
- commodity edge caseと保守を既存ecosystemへ任せられる
- 大きなdependencyの先行導入を防げる
- 将来OSSが変わってもProduct Constitutionを変更せず交換できる
- license判断が暗黙にならない

### Costs

- benchmark issueとmigration workが必要になる
- reference implementationと採用OSSの短期的な重複が発生する
- package version / license auditを継続する必要がある
- current small implementationを「動いているから完成」と扱えない

## Revisit conditions

- Issue #2でlockfileを作る時
- renderer移行前
- export / import実装前
- PDR spike開始前
- PersonalMapが20 km / high latitude / antimeridianを実利用で扱う時
- second appが実際に同じpackageを利用する時
- 既存製品が本製品の体験全体を満たす時
