# Export / Import Boundary

- Status: Active boundary — geographic serializers partially implemented
- Established: 2026-08-07
- Last reviewed: 2026-08-09
- Scope: GPX, GeoJSON, and lossless PersonalMap backup

## Purpose

exportは1種類にまとめない。目的が異なるため、次の3境界へ分ける。

1. **GPX 1.1** — 一般的なGPS track / loggerとの相互運用
2. **GeoJSON** — geographic derived map / GISとの相互運用
3. **PersonalMap bundle** — raw evidenceを含む無損失backup / restore

標準形式へ収まらない情報を捨てて「export済み」と扱わない。一方、独自bundleだけに閉じ込めて標準相互運用を失わない。

## Current implementation status

PR #81 / main `53ab66a37ba11472f2c935b4415c1f7787dab4e6`で、mapping-engineへdependency-freeのread-only serializerを追加した。

Implemented:

- `serializePersonalMapGpx`
- `buildPersonalMapGeoJson`
- `serializePersonalMapGeoJson`
- typed error / warning contract
- session separation、local-frame rejection、geographic marker handling
- mapping package test / typecheck、mobile static、APK build

Not implemented:

- mobile file creation、保存、share sheet
- GPX / GeoJSON import
- lossless PersonalMap bundle
- raw/rejected evidence backup / restore
- temporary file cleanup / encryption

現在のField-test S0候補へexport UIを追加していない。pure serializerをmainへ置いたことと、ユーザー向けexport機能が完成したことを混同しない。

## Canonical rule

DBのcanonical recordは次である。

- PersonalMap metadata
- ExplorationSession metadata
- raw position / sensor observations
- confirmed markers
- tracking provider / coordinate frame provenance
- explicit anchors / user-confirmed corrections when introduced

accepted / rejected、derived track、bounds、distance、coverage等は再生成可能な派生物である。

export fileがDBの正本へ自動昇格することはない。import時はprovenanceとvalidationを記録し、canonical commandを通す。

## GPX 1.1 profile

### Use

- geographic GNSS trackの交換
- third-party GPS logger / viewerとの相互運用
- session単位の経路確認

### Mapping

```text
PersonalMap
  → one <gpx>
  → one <trk>
  → each ExplorationSession becomes one <trkseg>
  → accepted geographic observations become <trkpt>
```

重要:

- ExplorationSession間を同一`trkseg`へ連結しない
- 実際に歩いていない接続点を生成しない
- local coordinate sessionを緯度経度0,0等へ偽装しない
- rejected raw sampleは通常GPXには含めない
- markerはgeographic source positionがある場合に`<wpt>`候補

### Implemented behavior

- each ExplorationSessionを独立`trkseg`へ出力
- accepted geographic positionのみ`trkpt`へ出力
- time、optional altitude、source、confidence、horizontal accuracyを保持
- geographic markerを`wpt`へ出力
- local-only markerはwarning付きで省略
- local / unresolved PersonalMapをtyped errorで拒否
- XML special charactersをescape

### Metadata

可能な範囲でextensionsへ次を記録できる。

- PersonalMap id
- ExplorationSession id
- source provider / position source
- confidence / horizontal accuracy
- accepted / rejected filter version

現在のserializerはPersonalMap id、ExplorationSession id、point source、confidence、horizontal accuracyをextensionsへ入れる。filter versionはsnapshot contractに存在しないため未実装であり、lossless bundle側のprovenance設計で扱う。

extensionsが失われても基本GPX trackとして読めるようにする。

### Limitations

GPXだけでは次を無損失に表せない。

- local coordinate frame
- full raw/rejected evidence
- arbitrary sensor streams
- explicit frame anchors
- game / experience state
- internal event history

したがってGPXをbackup形式にはしない。

## GeoJSON profile

### Use

- geographic derived PersonalMapの表示・分析
- optional basemap / GIS toolとの交換
- segments、markers、diagnosticsのfeature表現

### Feature mapping

- each eligible geographic ExplorationSession: one `LineString`
- confirmed geographic marker: one `Point`
- optional uncertainty: separate diagnostic feature / file only when semantics are defined
- segment / marker ids: `properties`

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [[139.0, 35.0], [139.0001, 35.0001]]
  },
  "properties": {
    "personalMapId": "map-1",
    "explorationId": "exploration-1",
    "evidence": "derived-from-accepted-observations"
  }
}
```

### Coordinate rule

GeoJSON geometryはlongitude / latitudeのgeographic coordinatesとしてのみ出力する。

禁止:

- local x/yをGeoJSON longitude/latitudeへそのまま入れる
- unknown frameをWGS84と宣言する
- inferenceをconfirmed evidenceと同じfeatureへ混ぜる

local mapをGISへ渡す必要が生じた場合は、明示CRSを持つ別format、anchor transform、またはlossless bundleを使う。GeoJSONの標準的なgeographic意味を曲げない。

### Implemented behavior

- 2点以上の各ExplorationSessionを独立LineString featureへ出力
- coordinate orderをlongitude / latitudeへ固定
- optional altitudeをthird position elementへ出力
- geographic markerをPoint featureへ出力
- trackを`derived-map` / `derived-from-accepted-observations`と明示
- markerを`confirmed-evidence`と明示
- 2点未満のsessionをinvalid LineStringにせずwarning付きで省略
- local / unresolved PersonalMapをtyped errorで拒否

Antimeridianを跨ぐLineStringのcut / splitは未検証であり、Issue #22の残項目として扱う。

### Derived vs evidence

GeoJSONは用途別profileを明示する。

- `derived-map`: accepted sampleから再構成した線
- `diagnostic`: rejected / gap / uncertaintyの可視化
- `confirmed-evidence`: confirmed marker / correction

現在のserializerは`derived-map` trackと`confirmed-evidence` markerのみを出力する。diagnostic / uncertainty geometryはcanonical geographic exportへ混ぜない。

game overlayはcanonical GeoJSON exportへ混ぜない。必要なら別file / layerとする。

## PersonalMap bundle

### Use

- lossless local backup
- device migration
- reproducible replay
- filter / renderer / engine update後の再生成

### Current status

未実装。

`PersonalMapSnapshot`はderived viewであり、raw observation、rejected evidence、tracking provider provenanceをすべて保持しない。したがって、snapshotだけをJSON化してlossless backupと呼ばない。repositoryのread-only export modelを別途設計する。

### Container

最初はversioned JSON documentまたはZIP containerを採用する。binary database copyを公開contractにしない。

```text
personal-map-bundle/
  manifest.json
  personal-map.json
  explorations/
    <exploration-id>.json
  observations/
    <exploration-id>.ndjson
  markers/
    <exploration-id>.json
  attachments/          optional future
  experience/           optional and separate
```

### Required manifest

- bundle schema version
- exportedAt
- app / mapping-engine version
- PersonalMap ids
- content hashes
- coordinate frame definitions
- attachment inventory
- whether raw sensitive location history is included

### Required preservation

- raw observations in original order and values
- source provider
- timestamps
- accuracy / confidence
- coordinate kind and frame label
- confirmed markers
- session start / end
- PersonalMap membership
- explicit anchor/correction provenance when introduced

accepted / rejectedは、filter versionとともにcacheとして入れてもよいが、raw replayから再計算可能にする。

### Experience state

experience / game stateはcanonical map bundleと別namespaceにする。

- mapping backupだけをrestoreできる
- gameを削除してもPersonalMapをrestoreできる
- game version mismatchでraw map importを失敗させない

## Privacy and consent

raw location historyは高感度データである。

- lossless bundle exportは明示操作のみ
- export前に含まれる情報を説明する
- share sheetを自動で開かない
- temporary fileを不要後に削除する
- encryptionはcloud/syncより先に設計する
- diagnostic exportとuser backupを分ける
- default filenameへ住所や正確な場所名を含めない

GPX / GeoJSONも位置履歴であるため同じ注意を適用する。pure serializerはfile作成やshareを自動実行しない。

## Import rules

1. format / schema / hashを検証する
2. sourceとimport provenanceを記録する
3. id collisionを明示的に処理する
4. unknown frameを推測で統合しない
5. geographic / localをanchorなしで混ぜない
6. raw observationをcanonical command / repository transactionで保存する
7. derived snapshotをimportして正本にしない
8. partial failureはtransactionでrollbackする

Import / restoreは未実装であり、serializer追加をround-trip完成とは扱わない。

## Implementation order

1. [x] Issue #7のOSS監査とformat profileを確定
2. [x] read-only serializer boundaryをmapping-engineに追加
3. [x] GPX geographic track serializer
4. [x] GeoJSON derived map serializer
5. [ ] mobile file / explicit share adapter
6. [ ] versioned lossless bundle exporter
7. [ ] export dogfood
8. [ ] import / restore transaction

## Validation

Completed:

- [x] two sessions export as two GPX `trkseg`
- [x] no artificial connection point
- [x] local map is rejected by GPX / geographic GeoJSON serializer without anchor
- [x] geographic marker becomes GPX waypoint / GeoJSON Point
- [x] longitude / latitude order
- [x] invalid or inconsistent geographic source position is rejected
- [x] mapping package test / TypeScript
- [x] mobile architecture / canonical-write / Expo / TypeScript
- [x] Metro-independent Field-test APK build after export surface addition

Remaining:

- [ ] official GPX XSD validation strategy
- [ ] antimeridian GeoJSON fixture / split strategy
- [ ] explicit mobile file / share UX
- [ ] bundle preserves rejected raw observations
- [ ] bundle replay reproduces PersonalMap stats / segments
- [ ] malformed / unsupported version is rejected without partial writes
- [ ] game state absence does not block map import
