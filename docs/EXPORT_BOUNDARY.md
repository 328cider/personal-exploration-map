# Export / Import Boundary

- Status: Design boundary
- Established: 2026-08-07
- Scope: GPX, GeoJSON, and lossless PersonalMap backup

## Purpose

exportは1種類にまとめない。目的が異なるため、次の3境界へ分ける。

1. **GPX 1.1** — 一般的なGPS track / loggerとの相互運用
2. **GeoJSON** — geographic derived map / GISとの相互運用
3. **PersonalMap bundle** — raw evidenceを含む無損失backup / restore

標準形式へ収まらない情報を捨てて「export済み」と扱わない。一方、独自bundleだけに閉じ込めて標準相互運用を失わない。

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

### Metadata

可能な範囲でextensionsへ次を記録できる。

- PersonalMap id
- ExplorationSession id
- source provider
- confidence / horizontal accuracy
- accepted / rejected filter version

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

- each geographic ExplorationSession: one `LineString`
- confirmed geographic marker: one `Point`
- optional uncertainty / explored corridor: separate derived `Polygon` or `MultiPolygon`
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

### Derived vs evidence

GeoJSONは用途別profileを明示する。

- `derived-map`: accepted sampleから再構成した線・点
- `diagnostic`: rejected / gap / uncertaintyの可視化
- `confirmed-evidence`: confirmed marker / correction

game overlayはcanonical GeoJSON exportへ混ぜない。必要なら別file / layerとする。

## PersonalMap bundle

### Use

- lossless local backup
- device migration
- reproducible replay
- filter / renderer / engine update後の再生成

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

GPX / GeoJSONも位置履歴であるため同じ注意を適用する。

## Import rules

1. format / schema / hashを検証する
2. sourceとimport provenanceを記録する
3. id collisionを明示的に処理する
4. unknown frameを推測で統合しない
5. geographic / localをanchorなしで混ぜない
6. raw observationをcanonical command / repository transactionで保存する
7. derived snapshotをimportして正本にしない
8. partial failureはtransactionでrollbackする

## Implementation order

1. Issue #7のOSS監査とformat profileを確定
2. read-only export query / serializer boundaryをmapping-engineに追加
3. GPX geographic track exporter
4. GeoJSON derived map exporter
5. versioned lossless bundle exporter
6. restoreはexport formatがdogfoodで安定した後

## Validation

- two sessions export as two GPX `trkseg`
- no false connection after re-import / display
- local map is rejected by GPX / geographic GeoJSON exporter without anchor
- geographic marker round-trip
- bundle preserves rejected raw observations
- bundle replay reproduces PersonalMap stats / segments
- malformed / unsupported version is rejected without partial writes
- game state absence does not block map import
