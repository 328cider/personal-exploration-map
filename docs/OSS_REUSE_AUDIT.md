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
- **Retain after benchmark** — commodity実装だが、現要件では置換便益が依存コストを上回らない
- **Defer** — 現在の価値検証に不要なので実装しない

## Decision matrix

| Capability | Current state | Decision | Reason / next gate |
|---|---|---|---|
| Background GNSS | Expo Location / TaskManager | **Adopt** | OS権限、foreground service、callbackをplatformへ任せる。OpenTracks等から試験観点を学ぶ |
| Local persistence | Expo SQLite + generic SQLite adapter | **Adopt** | DB engineやORMを自作しない。raw replayとtransaction境界だけ製品固有 |
| PersonalMap domain | mapping-core / mapping-engine | **Build** | map truth、session境界、偽接続禁止、game write禁止は製品固有 |
| Blank-map rendering | View-per-segment reference | **Adopt react-native-svg** | MIT。session-separated pathとmarkerをread-onlyで描画。実機frame gateはIssue #19 |
| High-load rendering | 未導入 | **Benchmark Skia only if needed** | SVGが実機閾値を満たさない場合だけ導入する |
| Optional basemap | 未導入 | **Defer / evaluate MapLibre later** | 白紙地図が正本。basemapは任意補助レイヤーでありM0必須ではない |
| Track simplification | internal standard RDP | **Retain after simplify-js benchmark** | HQはgeometry同一だがM0/M1でmaterialな性能差なし。defaultは高速だがgeometryを変更。再評価条件を明示 |
| Geographic distance | internal haversine | **Build within explicit local envelope** | 小さなPersonalMapには十分。global/high-precision要件が出たらGeographicLibを採用 |
| Geographic projection | local equirectangular approximation | **Build within explicit local envelope** | first accepted pointを原点とする局所地図用。Proj4jsはCRS変換要件が出た時だけ採用 |
| GeoJSON exchange | 未実装 | **Adopt RFC 7946 semantics** | geographic derived segments / markersに使用。local coordinatesを偽のGeoJSONへしない |
| GPX exchange | 未実装 | **Adopt GPX 1.1 semantics** | WGS84 track。ExplorationSessionごとに`trkseg`を分け、偽接続しない |
| Lossless app export | 未実装 | **Build small versioned bundle** | raw evidence、local frame、rejected reason、confirmed markerを標準形式だけでは失うため |
| Background logger reference | OpenTracks / GPSLogger | **Benchmark behavior; do not copy blindly** | lifecycle、battery、vendor kill、exportの試験観点を利用。ライセンス境界を守る |
| Pocket PDR | port only | **Benchmark existing research first** | Path Guide、RoNIN、TLIO等と比較し、独自sensor fusionを先行実装しない |
| Camera / visual tracking | 非採用 | **Defer** | camera-assisted trackingは比較対象だが、常時カメラはpassive-first UXに不一致 |

## Rendering

### react-native-svg — Adopt

採用理由:

- ExpoとReact Nativeで成熟した描画primitiveを利用できる
- blank local coordinate mapを`Path` / `Polyline` / `Circle`で表現できる
- sessionごとのpathを分け、未観測区間を接続しない構造が自然
- current View-per-segmentより、要素数・transform・zoom/panの責務が明確
- MITライセンスでrenderer層に閉じ込められる

導入条件:

1. committed lockfileとExpo compatibilityを維持する
2. current canvasと同一fixtureを描画する
3. confidence、start/end、marker、multiple segmentsを維持する
4. rendererがmap truthやaccepted/rejectedを変更しない
5. 1k / 5k / 10k pointsを計測する
6. Android実機で視認性とframe stabilityを確認する

実装・CPU geometry benchmarkはPR #32、physical-device gateはIssue #19で扱う。

### React Native Skia — Benchmark only

SVGが次のいずれかで不足した場合だけ比較する。

- 5,000 accepted points、20 segments、100 markersでpan/zoomが目視で不安定
- target端末でinteraction中に継続的なframe dropが発生
- uncertainty bandや大量overlayで要素数が支配的になる

「高性能そう」という理由だけでは導入しない。Skia導入はnative build、API surface、テストコストを増やす。

### MapLibre — Optional basemap only

MapLibreはGeoJSON/basemap表示の候補だが、PersonalMapの正本にはしない。

- blank map rendererを置換しない
- basemap OFFでも全機能が成立する
- local-frame mapは無理に地理座標へ変換しない
- map tile/network availabilityを記録成立条件にしない

## Track simplification

`mapping-core/src/simplify.ts`は標準Ramer–Douglas–Peuckerの小さなdependency-free実装である。製品独自アルゴリズムとして扱わない。

### Completed benchmark

Experiment 004で`simplify-js@1.2.4`（BSD-2-Clause）と比較した。

- exact version、license、integrity、repository metadataをartifactへ保存
- product workspaceへdependencyを追加せず比較
- noisy line 1k / 10k / 100k
- rectangular loop 10k
- marker-nearby turn 10k
- 2つのgap-separated 5k segments
- tolerance 1.5m

結果:

- high-quality modeは全fixtureでinternal RDPとexact point ids一致
- original TrackPoint referenceとprovenanceを保持
- M0/M1の1k〜10k noisy routeでhigh-quality modeに一貫した性能優位なし
- 100k pointsでもhigh-quality median差は約1%
- default modeは高速だがnoisy routeのpoint selectionを変更し、internal polylineとの差が最大約1.696m
- segmentを別々に処理すればgapは維持可能

詳細は[`experiments/004-simplify-js.md`](experiments/004-simplify-js.md)。

### Decision — retain internal RDP

現時点では`simplify-js`をproduction dependencyへ追加しない。

理由:

- M0/M1規模でmaterialな性能改善がない
- current implementationは小さく監査しやすい
- dependency-free core testを維持できる
- TrackPoint/sample provenanceが明確
- default fast modeのgeometry差を実機価値検証前に導入しない

これはOSS回避ではなく、exact candidateを比較した結果としての`Retain after benchmark`である。

### Revisit conditions

- 1 sessionで100k accepted points級が通常利用になる
- simplificationが実機Review latencyを支配する
- recursive implementationでstack / latency問題が出る
- GeoJSON pipelineとの共通化価値が生じる
- marker-aware / topology-aware simplificationが必要になる
- 別候補にmaterialな改善がある

`@turf/simplify`はGeoJSON pipeline全体が必要な時に検討する。単一アルゴリズムだけのためにTurf全体をmapping-coreへ入れない。

## Geodesy and coordinate transforms

### Current operating envelope

current local projectionは、PersonalMapの最初のaccepted geographic pointを原点とする局所equirectangular approximationである。

推奨範囲:

- absolute latitude: 80°未満
- originからの半径: 20 km以内
- antimeridian deltaはshortest longitude deltaへ正規化
- global route、測量、救助、安全保証には使わない

範囲外sampleをrawから削除せず、diagnostic / map split / better transformの判断材料にする。

### Adopt Proj4js when

- explicit EPSG / projected CRSをimportする
- 自治体・GIS dataとの座標系変換が必要
- user-controlled map originだけでは不十分

### Adopt GeographicLib when

- 20 kmを超えるPersonalMapを1 frameで扱う
- high latitude / long geodesicで距離精度が製品価値になる
- export/import整合性に楕円体測地線が必要

現在のM0へ将来要件だけで導入しない。

## Exchange formats

詳細は[`EXPORT_BOUNDARY.md`](EXPORT_BOUNDARY.md)を正本とする。

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

PersonalMap aggregateの代替ではないが、single traversal indoor traceの重要baselineである。source/licenseを確認せず取り込まない。

### RoNIN

- device orientation variationを扱うlearned inertial navigation
- public dataset / codeによるoffline benchmark候補
- GPL-3.0 codeをproduct packageへ組み込まない

### TLIO

- learned displacementとfilterのbaseline
- reproducibility、model/runtime、training data、licenseを確認してから利用する

### Camera-assisted tracking

weak-GPS trackingの比較対象。ただしcamera / ARCoreを使うため、現在のphone-in-pocket defaultには採用しない。

PDR判断は[`experiments/002-pocket-pdr.md`](experiments/002-pocket-pdr.md)とcompanion benchmark文書に従い、Go / Narrow / Stopを先に定義する。

## License policy

| Candidate | License / status | Product use rule |
|---|---|---|
| Expo Location / TaskManager / SQLite | Expo ecosystem permissive OSS | Adopt through official package |
| react-native-svg | MIT | Renderer層で採用。exact versionをlockfileで固定 |
| React Native Skia | permissive; pinned releaseで再確認 | SVG不足時だけbenchmark |
| MapLibre React Native | permissive; pinned releaseで再確認 | Optional basemap only |
| simplify-js 1.2.4 | BSD-2-Clause | Benchmark済み。現在は非採用、再評価条件あり |
| Turf | MIT | GeoJSON pipelineが正当化する場合のみ |
| Proj4js | MIT | explicit CRS変換要件時のみ |
| GeographicLib | MIT/X11-style; JS packageを再確認 | precision envelope超過時のみ |
| OpenTracks | Apache-2.0 | Behavior/referenceまたはNOTICE確認済みisolated reuse |
| GPSLogger | GPL-family | 明示的な法的判断なしにproduct codeへ含めない |
| RoNIN | GPL-3.0 | offline benchmark/reference only |
| Path Guide / TLIO research code | repository-specific license要確認 | license明示までproduct inclusionなし |

「GitHubに公開されている」は再利用許可を意味しない。採用時にはexact repository、version/tag、license file、NOTICE義務、transitive dependenciesを記録する。

## Review cadence

次の時点でこの監査を更新する。

- 新しいrenderer / sensor / DB / geodesy dependencyを追加する前
- lockfileまたはExpo SDKを更新する時
- PDR spike開始前
- GPX / GeoJSON export実装前
- simplification再評価条件が成立した時
- second app / game appが実際に同じpackageを使う時
- 既存製品が本製品の体験全体を満たした時
