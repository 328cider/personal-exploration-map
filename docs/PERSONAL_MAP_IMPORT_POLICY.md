# PersonalMap Import / Restore Policy

- Status: Design boundary; implementation pending
- Updated: 2026-08-09
- Related: Issue #22, `docs/EXPORT_BOUNDARY.md`, `docs/PERSONAL_MAP_BUNDLE_V1.md`

## Purpose

PersonalMap bundleのrestoreは、単なるJSON読込ではない。raw位置履歴、confirmed marker、session membership、coordinate frameをcanonical storageへ戻す高感度なtransactionである。

本書は、将来のimport実装が次を暗黙に行わないためのfail-closed policyを定める。

- 既存地図への自動merge
- ID collisionの自動上書き
- unknown frameの推測統合
- derived snapshotのcanonical昇格
- game stateを理由とするmap restore失敗
- partial import
- GPX / GeoJSONをlossless backupとして扱うこと

## Format classes

### Lossless PersonalMap bundle

目的:

- local backup
- device migration
- raw replay
- algorithm更新後のderived map再生成

canonical restore候補になれる唯一のexport formatである。ただし、schema、hash、inventory、frame、provenanceを検証し、transactionを通過した場合に限る。

### GPX / GeoJSON

目的:

- interoperability
- third-party viewer / GIS
- derived geographic track / confirmed geographic markerの交換

これらはraw/rejected evidence、provider、local frameを無損失に保持しない。importする場合も、**外部由来の新しいevidence source**として別command / provenanceで扱い、元PersonalMapのrestoreとは呼ばない。

## Restore modes

v1では1つだけを実装候補とする。

### `restore-new`

- bundleのPersonalMap IDがstorageに存在しない
- 全ExplorationSession IDが存在しない
- 全marker IDが存在しない
- validation成功後、1 transactionでexact IDを保存
- raw evidenceを元の順序で保存
- derived mapを現在のfilter / engineでreplay

v1では次を実装しない。

- `merge-into-existing`
- `replace-existing`
- `copy-as-new`
- partial session selection
- GPX / GeoJSONとの自動統合

これらは別Issue、UX、provenance、migration policyが必要である。

## ID collision policy

### Any collision fails before write

次のいずれかが既存storageに存在すれば、v1 restoreはcanonical transaction開始前に失敗する。

- PersonalMap ID
- ExplorationSession ID
- raw sample ID（session scopeを含め、repository invariantに従う）
- marker ID
- future anchor / correction ID

内容が見た目上同じでも自動no-opや上書きにしない。既存dataとbundleのどちらが正本か、単純なID一致だけでは決められないためである。

### No automatic ID remapping

IDを自動生成し直すと、次が壊れ得る。

- session membership
- marker / anchor reference
- provenance
- future attachment reference
- external audit / hash

`copy-as-new`が必要になった場合は、old→new ID mappingをmanifest付きで生成し、元bundleとは別のderived import operationとして設計する。lossless restoreとは分ける。

### Replace requires separate destructive flow

既存mapをbackupで置換する機能は、通常restoreへ含めない。将来実装する場合は、少なくとも次が必要。

- explicit destructive confirmation
- existing mapの事前backup
- transaction / rollback
- source bundle fingerprint
- audit event
- game / experience stateの別処理
- failure後の復旧試験

## Staging sequence

canonical repositoryへ触る前に、次を完了する。

```text
container bytes
  ↓
path traversal / duplicate path rejection
  ↓
manifest JSON / format / schema / number encoding
  ↓
privacy profile
  ↓
SHA-256 / UTF-8 byte length
  ↓
file inventory / roles / counts
  ↓
personalMap / exploration identity and membership
  ↓
canonical number token decode
  ↓
frame / provider / marker / raw sample shape
  ↓
ID collision preflight
  ↓
validated staged import model
  ↓
canonical repository transaction
  ↓
raw replay and derived snapshot verification
```

validationが失敗した場合、DB writeを1件も行わない。

## Frame policy

### Geographic bundle

- geographic raw observationを元値で保存
- geographic-local frame hintはvalidation / replay補助
- import時に既存地図へ自動接続しない
- antimeridian、高緯度、projection envelopeは現在のengine規則でreplay

### Local bundle

- local frame labelとraw local positionを保持
- label一致だけで既存local mapへ統合しない
- anchorなしでgeographic frameへ変換しない
- 別local frame間を接続しない

### Unresolved frame

- unresolvedのままrestore可能
- 推測でgeographic / localへ昇格しない

frame統合には、user-confirmed anchorまたは明示的transform evidenceをcanonical commandで追加する。

## Raw and derived data

restoreするcanonical data:

- PersonalMap metadata
- ExplorationSession metadata
- raw observations
- source provider / frame provenance
- confirmed markers
- future user-confirmed anchors / corrections

restoreしないcanonical data:

- accepted / rejected cacheを現在の真実として固定
- derived track
- bounds / distance / coverage
- diagnostics
- renderer geometry
- game / experience overlay

accepted / rejected cacheをbundleへ含める将来案でも、algorithm / filter version付きのcacheとして扱う。raw replay結果と一致しない場合はrawを優先し、差分をdiagnosticとして残す。

## Transaction policy

1. storage schema compatibilityを確認
2. all-ID collision preflight
3. transaction開始
4. PersonalMap record作成
5. ExplorationSessionを決定的順序で作成
6. raw evidenceをsession内の元順序で保存
7. confirmed markerを保存
8. transaction内でminimum referential integrityを検証
9. commit
10. transaction外または明示設計した同一transaction内でderived replay
11. replay snapshotのsession/sample/marker countをbundle inventoryと照合
12. restore completion eventを記録

途中失敗時はrollbackし、空PersonalMapや一部sessionを残さない。

## Replay verification

restore成功は「行がinsertできた」だけではない。次を確認する。

- PersonalMap ID一致
- ExplorationSession数一致
- raw sample数 / order一致
- marker数一致
- source provider / frame一致
- current engineでsnapshot生成可能
- session間に偽接続なし
- local / geographic frame invariant維持

filter version変更によりaccepted数やderived distanceが旧端末と変わることはあり得る。これはraw evidence喪失ではない。差分を説明できるようproducer / engine versionをmanifestへ保持する。

## Privacy and consent

- importはユーザーの明示操作のみ
- file picker選択後、含まれるraw locationと対象map数を説明
- defaultでcloudへuploadしない
- temporary extraction directoryを不要後に削除
- invalid bundleのprivate contentをlogcatやanalyticsへ出さない
- ID、地図名、marker本文、座標をエラーメッセージへ不用意に出さない
- validation reportは必要最小限のpath / error codeを使用

## Game / experience state

canonical map restoreはgameなしで完了できなければならない。

- bundle v1はgame stateを含めない
- future experience namespaceが存在してもoptional
- unknown game versionでmap restoreを失敗させない
- game restore失敗時もcanonical map transactionを巻き戻すかは、別transaction / UXとして明示する
- gameがraw evidenceやmarkerを上書きしない

## Import provenance

restore後に最低限記録する候補:

- import operation ID
- bundle format / schema
- exportedAt
- producer app / engine version
- manifest fingerprint
- importedAt
- restore mode (`restore-new`)
- result PersonalMap ID

raw bundle path、住所、地図名をoperational logへ平文で残さない。

## Error classes

最低限区別する。

- unsupported format / schema / number encoding
- unsafe path / duplicate path
- missing / unexpected file
- checksum / byte length mismatch
- malformed JSON / NDJSON
- invalid inventory / count
- invalid canonical number token
- invalid frame / source / marker shape
- ID collision
- repository schema incompatibility
- transaction failure
- replay failure

UIでは内部例外全文を出さず、再試行で直るもの、fileが壊れているもの、既存data collision、unsupported versionを区別する。

## Testing requirements

### Pure validation

- valid builder output
- tampering
- path traversal
- duplicate / missing / extra files
- unsupported version
- privacy profile drift
- malformed JSON / NDJSON
- invalid number aliases
- count / identity mismatch

### Repository transaction

- clean restore
- collision preflight
- failure at each write stage with rollback
- app restart after restore
- current replay
- local / geographic / unresolved frame
- multiple sessions with no fake bridge
- raw special number preservation
- marker provenance

### Migration

- old supported bundle version
- future unsupported bundle version
- app DB schema migration before restore
- unknown optional extension ignored only when schema explicitly permits it

## Non-goals for v1

- automatic cloud sync
- collaborative merge
- conflict resolution UI
- external GPX/GeoJSON round-trip equality
- game save migration
- automatic map matching
- ID remapping
- partial restore
- destructive replace

## Implementation order

1. logical bundle builder
2. pure fail-closed validator
3. staged decoder / import model
4. repository read-only export query
5. platform SHA-256 + directory / ZIP writer
6. explicit backup UI and dogfood
7. repository collision preflight
8. transactional `restore-new`
9. restart / replay / rollback tests
10. only after dogfood, import UI exposure

本policyを変更する場合は、`docs/EXPORT_BOUNDARY.md`、Issue #22、AGENTSのexport/import boundaryを同時に確認する。
