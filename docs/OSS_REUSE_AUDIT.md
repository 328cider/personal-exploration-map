# OSS / Standard Reuse Audit

- Status: Active decision record companion
- Reviewed: 2026-08-07
- Scope: rendering, simplification, geodesy, background tracking, exchange formats, and GPS-denied positioning

## Purpose

本製品の独自価値は、次の組み合わせにある。

- personal exploration evidenceを地図の正本にする
- 一度の探索からPersonalMapを作る
- 複数ExplorationSessionを偽接続せず育てる
- passive-first UX
- uncertaintyを事実として偽装しない
- gameをread-only experience layerへ分離する

OS API、DB、描画、標準アルゴリズム、座標変換、交換形式まで自作することは独自価値ではない。重要部品ごとに次のいずれかを明示する。

- **Adopt** — 既存OSS、標準、platformを製品経路に使う
- **Build** — 製品固有の不変条件なので自作する
- **Benchmark** — 候補を実データで比較するまで採否を決めない
- **Defer** — 現在の価値検証に不要なので実装しない

## Decision matrix

| Capability | Current state | Decision | Reason / next gate |
|---|---|---|---|
| Background GNSS | Expo Location / TaskManager | **Adopt** | OS権限、foreground service、callbackをplatformへ任せる。OpenTracks等から試験観点を学ぶ |
| Local persistence | Expo SQLite + generic SQLite adapter | **Adopt** | DB engineやORMを自作しない。raw replayとtransaction境界だけ製品固有 |
| PersonalMap domain | mapping-core / mapping-engine | **Build** | map truth、session境界、偽接続禁止、game write禁止は製品固有 |
| Blank-map rendering | React Native View-per-segment | **Adopt react-native-svg next** | 現実装はreferenceのみ。Polyline/Path/marker、zoom/panへ進む前にSVGへ移す |
| High-load rendering | 未導入 | **Benchmark React Native Skia only if needed** | SVGが実測閾値を満たさない場合だけ導入する |
| Optional basemap | 未導入 | **Defer / evaluate MapLibre later** | 白紙地図が正本。basemapは任意補助レイヤーでありM0必須ではない |
| Track simplification | internal Ramer–Douglas–Peucker | **Build temporarily, benchmark simplify-js** | dependency-free coreとmetadata保持を優先。性能・edge caseで必要ならBSD-2-Clause実装へ置換 |
| Geographic distance | internal haversine | **Build within explicit local envelope** | 小さなPersonalMapには十分。global/high-precision要件が出たらGeographicLibを採用 |
| Geographic projection | local equirectangular approximation | **Build within explicit local envelope** | first accepted pointを原点とする局所地図用。Proj4jsはCRS変換要件が出た時だけ採用 |
| GeoJSON exchange | 未実装 | **Adopt RFC 7946 semantics** | geographic derived segments / markersに使用。local coordinatesを偽のGeoJSONへしない |
| GPX exchange | 未実装 | **Adopt GPX 1.1 semantics** | WGS84 track。ExplorationSessionごとに`trkseg`を分け、偽接続しない |
| Lossless app export | 未実装 | **Build small versioned bundle** | raw evidence、local frame、rejected reason、confirmed markerを標準形式だけでは失うため |
| Background logger reference | OpenTracks / GPSLogger | **Benchmark behavior; do not copy blindly** | lifecycle、battery、vendor kill、exportの試験観点を利用。ライセンス境界を守る |
| Pocket PDR | port only | **Benchmark existing research first** | Path Guide、RoNIN、TLIO、phone-in-pocket研究等と比較し、独自sensor fusionを先行実装しない |
| Camera / visual tracking | 非採用 | **Defer** | SIMT Track+等は有力比較対象だが、常時カメラは現在のpassive-first UXに不一致 |

## Rendering

### react-native-svg — Adopt

採用理由:

- Expoが公式SDKとして統合方法を提供している
- blank local coordinate mapを`Path` / `Polyline` / `Circle`で表現できる
- sessionごとのpathを分け、未観測区間を接続しない構造が自然
- current View-per-segmentより、要素数・transform・zoom/panの責務が明確
- MIT系の許容的ライセンスで、game/rendering layerに閉じ込められる

導入条件:

1. Issue #2でExpo dependencyとlockfileを再現可能にする
2. current canvasと同一fixtureを描画する
3. confidence、start/end、marker、multiple segmentsを維持する
4. rendererがmap truthやaccepted/rejectedを変更しない
5. 1k / 5k / 10k pointsで操作性を計測する

current `TrackCanvas`はM0のreference implementationとしてのみ維持し、機能を増やし続けない。

### React Native Skia — Benchmark only

SVGが次のいずれかで不足した場合だけ比較する。

- 5,000 accepted points、20 segments、100 markersでpan/zoomが目視で不安定
- target端末でinteraction中に継続的なframe dropが発生
- uncertainty bandや大量overlayがSVG DOM相当の要素数で重い

「高性能そう」という理由だけでは導入しない。Skia導入はnative build、API surface、テストコストを増やす。

### MapLibre — Optional basemap only

MapLibreはGeoJSON/basemap表示の候補だが、PersonalMapの正本にはしない。

- blank map rendererを置換しない
- basemap OFFでも全機能が成立する
- local-frame mapは無理に地理座標へ変換しない
- map tile/network availabilityを記録成立条件にしない

## Track simplification

current `simplifyTrack`はRamer–Douglas–Peuckerの小さなdependency-free実装である。アルゴリズム自体はcommodityであり、独自発明として扱わない。

### Why retain temporarily

- mapping-core testをpackage installなしで実行できる
- `TrackPoint` objectとsample provenanceをそのまま返す
- toleranceの意味が明示的で、現在のfixtureが小さい
- `simplify-js`の既定radial-distance pre-passを含めるかは製品上の選択になる
- M0では描画前の数百〜数千点が主で、performance問題が未観測

### Benchmark gate

`simplify-js`（BSD-2-Clause）と同一fixtureで比較する。

- output point count
- corner preservation
- marker近傍の形状
- 1k / 10k / 100k pointsのruntime
- highest-quality optionの差
- dependency、type package、bundle size

結果が同等以上でdependency costが許容できればAdoptへ変更する。current implementationを維持する場合も、標準アルゴリズムであることと再評価条件をADRに残す。

`@turf/simplify`はGeoJSON pipeline全体が必要な時に検討する。単一アルゴリズムだけのためにTurf全体をmapping-coreへ入れない。

## Geodesy and coordinate transforms

### Current operating envelope

current local projectionは、PersonalMapの最初のaccepted geographic pointを原点とする局所equirectangular approximationである。

推奨範囲:

- absolute latitude: 80°未満
- originからの半径: 20 km以内
- antimeridian deltaはshortest longitude deltaへ正規化
- global route、測量、救助、安全保証には使わない

この範囲は法的精度保証ではなく、M0の表示と個人探索用のengineering envelopeである。範囲外sampleをrawから削除せず、diagnostic / map split / better transformの判断材料にする。

### When to adopt Proj4js

- explicit EPSG / projected CRSをimportする
- 自治体・GIS dataとの座標系変換が必要
- user-controlled map originだけでは不十分

### When to adopt GeographicLib

- 20 kmを超えるPersonalMapを1 frameで扱う
- high latitude / antimeridian / long geodesicで距離精度が製品価値になる
- export/import整合性に楕円体測地線が必要

現在のM0へ将来要件だけで導入しない。

## Exchange formats

詳細は [`EXPORT_BOUNDARY.md`](EXPORT_BOUNDARY.md) を正本とする。

- GeoJSON: geographic derived mapのinteroperability
- GPX: geographic track/logger interoperability
- versioned PersonalMap bundle: lossless backup / restore
- local coordinatesをWGS84に偽装しない
- game stateはcanonical map exportと分離
- raw evidence exportは明示的opt-in

## Background logging references

### OpenTracks

参考にするもの:

- foreground service lifecycle
- recording state recovery
- battery / sampling configuration
- marker and track export
- Android vendor / permission behavior

Apache-2.0のため再利用候補になり得るが、Kotlin/Android implementationをExpo adapterへ無理に移植しない。まずbehaviorとtest matrixを参照する。

### GPSLogger

軽量logging、batching、provider fallback、export設定の参考にする。GPL系コードは本製品へコピー・リンクせず、公開仕様とbehaviorの比較に限定する。

## GPS-denied positioning references

### Microsoft Research Path Guide

- infrastructure-free indoor trace
- inertial / magnetic cues
- one recorded pathをfollowするUX

PersonalMap aggregateの代替ではないが、single-traversal indoor traceの重要baselineである。source/licenseを確認せず取り込まない。

### RoNIN

- device orientation variationを扱うlearned inertial navigation
- public code / dataをoffline benchmark候補にする
- GPL-3.0 codeをproduct packageへ組み込まない

### TLIO

- learned displacementとfilterを組み合わせるbaseline
- reproducibility、model/runtime、training data、licenseを確認してから利用する

### SIMT Track+

weak-GPS trackingの製品比較対象。ただしcamera / ARCoreを使うため、現在のphone-in-pocket defaultには採用しない。

PDR判断は [`experiments/002-pocket-pdr.md`](experiments/002-pocket-pdr.md) に従い、Go / Narrow / Stopを先に定義する。

## License policy

| Candidate | Expected license / status | Product use rule |
|---|---|---|
| Expo Location / TaskManager / SQLite | Expo ecosystem permissive OSS | Adopt through official package |
| react-native-svg | MIT | Adopt after lockfile / Expo compatibility validation |
| React Native Skia | permissive; verify pinned release | Benchmark only; record exact version/license before install |
| MapLibre React Native | permissive; verify pinned release | Optional basemap only |
| simplify-js | BSD-2-Clause | Benchmark; direct adoption allowed after version review |
| Turf | MIT | Use only when GeoJSON pipeline justifies it |
| Proj4js | MIT | Adopt only for explicit CRS transformation requirement |
| GeographicLib | MIT/X11-style; verify JS package | Adopt only when precision envelope requires it |
| OpenTracks | Apache-2.0 | Behavior/reference or isolated reuse with notice review |
| GPSLogger | GPL-family | No code inclusion in proprietary/private product path without explicit legal decision |
| RoNIN | GPL-3.0 | Offline benchmark/reference only by default |
| Path Guide / TLIO research code | verify repository-specific license | No product inclusion until license is explicit |

「GitHubに公開されている」は再利用許可を意味しない。採用時にはexact repository、version/tag、license file、NOTICE義務、transitive dependenciesを記録する。

## Review cadence

次の時点でこの監査を更新する。

- 新しいrenderer / sensor / DB / geodesy dependencyを追加する前
- Issue #2でlockfileを作成する時
- PDR spike開始前
- GPX / GeoJSON export実装前
- second app / game appが実際に同じpackageを使う時
- 既存製品が本製品の体験全体を満たした時
