# OSS / Standard Reuse Audit

- Status: Active decision-record companion
- Reviewed: 2026-08-09
- Scope: tracking, persistence, rendering, simplification, geodesy, exchange formats, diagnostics, and GPS-denied positioning

## Purpose

本製品の独自価値は、一般的な位置取得・描画・DB・地理計算を自作することではない。独自価値は次にある。

- personal exploration evidenceを地図の正本にする
- 一度の探索からPersonalMapを作る
- 複数ExplorationSessionを偽接続せず育てる
- passive-first UX
- uncertaintyを事実として偽装しない
- gameをread-only experience layerへ分離する
- raw evidenceからderived mapを再生成可能にする

一般部品は次のいずれかへ明示分類する。

- **Adopt** — 既存OSS、標準、platformを製品経路に使う
- **Build** — 製品固有の不変条件なので小さく自作する
- **Benchmark** — 実データで比較するまで採否を決めない
- **Retain after benchmark** — 比較したが、現要件では置換便益が依存コストを上回らない
- **Defer** — 現在の価値検証に不要なので入れない

## Current decision matrix

| Capability | mainの現在状態 | 判断 | 次のgate |
|---|---|---|---|
| Background GNSS | Expo Location / TaskManager | **Adopt** | Issue #3の実端末GNSS・OEM・電池判定 |
| Local persistence | Expo SQLite + generic adapter | **Adopt** | raw replayとtransaction境界だけ製品固有 |
| PersonalMap domain | mapping-core / mapping-engine | **Build** | map truth、session、frame、canonical writeを維持 |
| Blank-map rendering | React Native `View` primitive renderer | **Benchmark / migrate candidate: react-native-svg** | S0候補を凍結中。Issue #19で実装・lockfile・実機性能を完了する |
| High-load rendering | 未導入 | **Benchmark Skia only if needed** | SVGが実用fixtureで不足した場合だけ |
| Optional basemap | 未導入 | **Defer / MapLibre later** | blank mapが正本。basemapは任意補助layer |
| Track simplification | internal standard RDP | **Retain after benchmark** | 100k点級や実機latency支配時に再評価 |
| Geographic distance | internal haversine | **Build within explicit envelope** | long-range / high-precision要件時にGeographicLib |
| Geographic projection | local equirectangular approximation | **Build within explicit envelope** | explicit CRS要件時にProj4js等 |
| GeoJSON exchange | 未実装 | **Adopt RFC 7946 semantics** | Issue #22 |
| GPX exchange | 未実装 | **Adopt GPX 1.1 semantics** | Issue #22 |
| Lossless app export | 未実装 | **Build small versioned bundle** | Issue #22 |
| Background logger reference | OpenTracks / GPSLogger | **Benchmark behavior only** | lifecycle・battery・vendor kill観点をIssue #3へ反映 |
| USB Field-test evidence | app-specific collector + standard platform tools | **Build thin adapter / adopt ADB** | PR #59で完了。rawはlocal-only |
| Objective Field-test analysis | Node標準library + Docker wrapper | **Build small local tool** | PR #78で完了。map truthへ書き戻さない |
| Pocket PDR | port / architecture only | **Benchmark research first** | Issue #5。Issue #3 / #4後に開始 |
| Camera / visual tracking | 非採用 | **Defer** | 常時cameraはpassive-firstに不一致 |

## Rendering

### mainの事実

2026-08-09時点のmainは、`react-native-svg`を依存に含めていない。

- `apps/mobile/package.json`に`react-native-svg`なし
- `TrackCanvas`はReact Native `View` primitiveでsegment、uncertainty band、coverage cell、markerを描画
- current Field-test APKもView rendererでAndroid 15のUI / lifecycle / USB gateを通過

したがって、**採用方針を決めたことと、mainへ採用実装が入ったことを混同しない。** 過去の実験branchやCI結果が存在しても、mainとlockfileに入っていなければ製品採用済みではない。

### react-native-svg — implementation candidate

候補理由:

- Expo / React Nativeで成熟した描画primitive
- blank local mapを`Path` / `Polyline` / `Circle`で表現可能
- sessionごとのpathを分け、未観測区間を接続しない構造が自然
- View-per-segmentより要素数・transform・pan / zoom責務を整理しやすい
- MIT license

Issue #19で必要なこと:

1. 着手時点のExpo compatibilityを公式情報で再確認
2. exact package version、license、integrity、transitive dependencyをlockfileへ固定
3. current View rendererと同じfixture・map truthを描画
4. `位置の不確実性 / 通過セル / 軌跡`、marker、start/end、multiple sessionsを維持
5. rendererからcanonical commandを呼ばない
6. 1k / 5k / 10k points、1 / 20 / 100 segments、10 / 100 markersを計測
7. Android実端末でframe stabilityと視認性を確認
8. 成立後にView-per-primitive implementationを削除またはreference fixtureへ限定

現在のS0候補APKは凍結し、renderer移行のためだけに実地試験前のruntimeを変更しない。S0がrenderer blockerを示した場合、またはS0完了後にIssue #19へ戻る。

### React Native Skia — benchmark only

SVGが次のいずれかで不足した場合だけ比較する。

- 5,000 accepted points、20 segments、100 markersでpan / zoomが継続的に不安定
- target端末でinteraction中にmaterialなframe drop
- uncertainty / overlay要素数が支配的

「高性能そう」という理由だけでは導入しない。Skiaはnative build、API surface、binary、test costを増やす。

### MapLibre — optional basemap only

- blank map rendererを置換しない
- basemap OFFでも全機能が成立
- local-frame mapを地理座標へ偽変換しない
- tile / network availabilityを記録成立条件にしない
- canonical PersonalMapではなく任意補助layer

## Track simplification

`mapping-core/src/simplify.ts`は標準Ramer–Douglas–Peuckerの小さなdependency-free実装であり、製品独自アルゴリズムとして扱わない。

### simplify-js benchmark — completed

Experiment 004で`simplify-js@1.2.4`（BSD-2-Clause）と比較済み。

- noisy line 1k / 10k / 100k
- rectangular loop 10k
- marker-nearby turn 10k
- gap-separated 5k + 5k segments
- tolerance 1.5m
- exact version、license、integrityをartifact化

結果:

- high-quality modeは全fixtureでinternal RDPとpoint ID一致
- TrackPoint referenceとprovenanceを保持
- 1k〜10kで一貫した性能優位なし
- 100kでもhigh-quality median差は約1%
- default modeは高速だがpoint selectionを変更し、形状差が最大約1.696m
- segmentを別処理すればgapは維持可能

Decision:

- production dependencyへ追加しない
- current internal RDPを維持
- 100k点級が通常化、Review latency支配、stack問題、GeoJSON共通化、topology-aware要件時に再評価

詳細: [`experiments/004-simplify-js.md`](experiments/004-simplify-js.md)

## Geodesy and coordinate transforms

### Current operating envelope

current local projectionは最初のaccepted geographic pointを原点とする局所equirectangular approximation。

- absolute latitude: 80°未満
- originからの半径: 20 km以内
- antimeridian deltaはshortest longitude deltaへ正規化
- global route、測量、救助、安全保証には使用しない

範囲外sampleをrawから削除せず、diagnostic、map split、better transform判断へ使う。

### Proj4js等を採用する条件

- explicit EPSG / projected CRS import
- 自治体・GIS dataとの座標変換
- user-controlled local originでは不足

### GeographicLib等を採用する条件

- 20 km超を1 frameで扱う
- high latitude / long geodesic精度が製品価値
- exchange整合性に楕円体測地線が必要

将来可能性だけでM0へ追加しない。

## Exchange formats

[`EXPORT_BOUNDARY.md`](EXPORT_BOUNDARY.md)を設計正本とし、実装はIssue #22で扱う。

- GeoJSON: geographic derived segments / markers
- GPX: geographic track interoperability
- versioned PersonalMap bundle: raw evidenceとlocal frameを含むlossless backup
- ExplorationSessionごとに別segment
- local coordinatesをWGS84へ偽装しない
- game stateをcanonical map exportへ混ぜない
- raw location exportは明示opt-in

設計完了を実装完了と呼ばない。

## Background logging references

### OpenTracks

参考にするもの:

- foreground service lifecycle
- recording recovery
- battery / sampling
- marker / export
- Android vendor / permission behavior

Apache-2.0でも、Expo adapterへ無条件移植しない。behaviorとtest matrixを優先する。

### GPSLogger

軽量logging、batching、provider fallback、export設定を参考にする。GPL-family codeは明示的判断なしにcopy / linkしない。

## Field-test tooling

### Adopted platform pieces

- Android `adb`
- `run-as`
- `dumpsys`
- official Windows Platform Tools
- Docker Desktop
- Node標準library

### Product-specific thin tools

- `pull-field-test-bundle.ps1`
- `collect-and-analyze-field-test.ps1`
- coordinate-free diagnostics formatter
- objective S0 analyzer

これらはmap truthを変更せず、raw evidenceの自動uploadを行わない。raw ZIPはlocal-only、通常共有はcoordinate-free reportのみ。

## GPS-denied positioning

正本: [`docs/PDR_TECHNOLOGY_GATE.md`](PDR_TECHNOLOGY_GATE.md) とIssue #5。

- 全面的なIMU-only GPS代替はStop寄り
- 100〜300m、anchor間、短いGNSS欠落補完はNarrow候補
- 最初にKotlin native raw loggerとimmutable / replayable evidence
- 同じlogをStep Detector、classical PDR、RoNIN、EqNIO、sparse-GNSS hybridへoffline replay
- high-rate IMUをmapping-coreやJS bridgeへ直接流さない
- learned modelを比較前にAndroidへ統合しない
- map matchingをPersonalMap truthへ昇格させない

### Research candidates

- Microsoft Research Path Guide: single-traversal indoor traceとfollow UXのbaseline
- RoNIN: orientation variationを扱うoffline learned baseline。GPL-3.0 product inclusionなし
- TLIO: learned displacement + uncertainty filter architecture。dataset / weights条件を分離確認
- EqNIO: precision benchmark。明示license確認までproduct inclusionなし
- camera-assisted tracking: 比較対象だがphone-in-pocket defaultには不採用

Issue #3と#4のGNSS M0 / product-value判定を隠すためにPDRを先行導入しない。

## License policy

| Candidate | License / status | Current rule |
|---|---|---|
| Expo Location / TaskManager / SQLite | permissive Expo ecosystem | official packageをAdopt |
| react-native-svg | MIT | **candidate**。main未導入。Issue #19でexact versionを再検証 |
| React Native Skia | permissive、exact release再確認 | SVG不足時だけBenchmark |
| MapLibre React Native | permissive、exact release再確認 | optional basemap only |
| simplify-js 1.2.4 | BSD-2-Clause | Benchmark済み。現在非採用 |
| Turf | MIT | GeoJSON pipelineが正当化する時だけ |
| Proj4js | MIT | explicit CRS要件時だけ |
| GeographicLib | MIT/X11-style、package再確認 | precision envelope超過時だけ |
| OpenTracks | Apache-2.0 | behavior/referenceまたはisolated reuse |
| GPSLogger | GPL-family | product codeへ無判断で含めない |
| RoNIN | GPL-3.0 / research constraints | offline benchmark only |
| EqNIO | explicit reuse license未確認 | isolated precision benchmark only |
| TLIO | BSD software / dataset・weights別条件 | architecture benchmark later |
| GTSAM | BSD | offline factor-graph価値確認後 |

「GitHubに公開されている」は再利用許可を意味しない。採用時にexact repository、tag/version、license file、NOTICE、transitive dependencies、weights / dataset権利を記録する。

## Completion and follow-ups

このauditで完了したもの:

- capability別Build / Adopt / Benchmark分類
- license policy
- simplify-js比較とRDP維持判断
- geodesy operating envelope
- exchange boundary設計
- background logger参照観点
- PDR research / license / architecture gate
- future-only dependencyを入れない規則

別Issueで継続するもの:

- Issue #19: react-native-svg実装、lockfile、Android実機性能
- Issue #22: GPX / GeoJSON / lossless bundle実装
- Issue #3 / #4: GNSS M0と製品価値
- Issue #5: PDR technology gate

umbrella auditを開いたままにしてfollow-up実装と二重管理しない。

## Review cadence

次の時点で更新する。

- renderer / sensor / DB / geodesy dependency追加前
- lockfileまたはExpo SDK更新時
- Issue #19 / #22 / #5着手時
- simplification再評価条件成立時
- second app / game appが同じpackageを実利用する時
- 既存製品が体験全体を満たし自作不要になった時
