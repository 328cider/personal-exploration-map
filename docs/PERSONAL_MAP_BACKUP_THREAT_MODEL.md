# PersonalMap Backup Threat Model

- Status: Security / privacy design boundary
- Updated: 2026-08-09
- Related: Issue #92, Issue #93, `docs/EXPORT_BOUNDARY.md`, `docs/PERSONAL_MAP_BUNDLE_V1.md`

## Scope

PersonalMap bundleは次を含み得る。

- raw geographic / local position history
- rejected location observations
- exact timestamps
- ExplorationSession membership
- tracking provider / frame provenance
- user-confirmed markers、labels、notes
- future manual anchors / corrections

これは単なる設定backupではなく、長期間の移動・行動・関心地点を推測できる高感度データである。

本書は次を分ける。

1. app-privateな内部dogfood backup
2. ユーザーが明示的に外部保存するcross-device backup
3. 公開共有を目的とするGPX / GeoJSON
4. USB Field-test diagnostics

これらを同じ保存・共有導線へ統合しない。

## Assets

守る対象:

- raw positions and timestamps
- marker text and location
- map / exploration identifiers
- frame / anchor relationships
- backup encryption key / passphrase-derived key
- temporary plaintext files
- manifest and file hashes
- import / restore provenance
- existing canonical map before destructive operations

Derived trackだけを隠してもraw observationが漏れれば意味がない。manifest、filename、path、error messageもlocationやuser labelを漏らし得る。

## Actors and failure modes

### Benign user mistake

- raw bundleを通常チャットやpublic Issueへ添付
- share sheetで意図しないcloud / messaging appを選択
- Downloadsへ置いたまま忘れる
- backupとGPXの違いを理解せず公開共有
- passphraseを失う
- 古いbackupで現在dataを上書き

### Other apps / local access

- external/shared storage上のplaintext backupを読む
- temporary export fileをshare後も読む
- notification、clipboard、logcat、crash reportからpathやprivate textを得る

### Device loss / compromise

- unlocked deviceまたは取得済みbackupから位置履歴を読む
- device-bound keyだけで暗号化したbackupが端末移行不能になる
- app-private fileでもroot / full-device compromiseでは保護できない

### Malicious bundle

- path traversal
- duplicate path / overwrite
- ZIP bomb / oversized file / excessive counts
- malformed JSON / NDJSON
- unsupported schema / number encoding
- checksum mismatch
- ID collisionを利用した既存data上書き
- frame / provider偽装
- private contentを含む巨大error message

### Implementation mistakes

- accepted snapshotだけをbackupしてraw/rejected evidenceを失う
- local coordinatesをWGS84と誤認
- game state failureでmap restoreも失敗
- partial transactionを残す
- default filenameへ地図名・住所を含める
- analytics / telemetryへbackup metadataを送る
- custom encryptionのnonce / authentication / KDFを誤る

## Security goals

- raw location backupはユーザーの明示操作だけで生成する
- automatic uploadを行わない
- default filename / container pathへ場所情報を入れない
- logical contentはhash / byte length / inventoryで検証する
- containerはpath traversal、duplicate、size abuseを拒否する
- importはvalidation完了後、collision-freeなtransactionだけで行う
- temporary plaintextを最小時間だけ保持し、終了・cancel・crash recoveryで削除する
- raw private contentをlog、analytics、error UIへ出さない
- gameなしでmap backup / restoreが成立する
- encryptionを使う場合はauthenticated encryptionとaudited implementationを使う
- security failure時にmap truthを変更しない

## Non-goals

- rooted / fully compromised deviceに対する完全保護
- userが明示的に復号・共有した後のrecipient control
- cloud providerのavailability保証
- anonymous publication of detailed raw tracks
- collaborative merge / conflict resolution
- custom cryptographic primitiveの設計

## Product modes

### Mode A — Internal app-private dogfood

目的:

- logical bundle writer / validator / restoreの開発検証
- raw evidence round-trip
- app restart / rollback

条件:

- app-private directoryだけへ生成
- share sheetなし
- automatic uploadなし
- debug / dogfood buildのみ
- temporary directoryとfinal fileを明確に分ける
- validator成功後だけdogfood restoreへ使用
- test dataを独立PersonalMapへ限定

初期実装はここから開始できる。外部保存機能がないためcross-device backupとしては未完成である。

### Mode B — Explicit unencrypted external export

raw位置を含むplaintext fileを外部storage / share providerへ渡す。

判断: **通常ユーザー向けv1としては採用しない。**

理由:

- recipient / cloud / local storageで位置履歴がplaintextになる
- share sheetの誤選択による影響が大きい
- GPX / GeoJSONとの違いを誤認しやすい
- temporary cleanupだけでは送信先のcopyを制御できない

開発者が意図してUSB / app-private領域から取得するField-test経路とは分ける。

### Mode C — Encrypted cross-device backup

目的:

- user-controlled device migration
- app外への保存
- future restore

必要条件:

- authenticated encryption
- portable key derivation / recovery design
- wrong passphraseとtamperingを区別しすぎてoracleを作らないerror UX
- schema / hash validationは復号後にも実施
- plaintext temporary fileを可能なら作らないstreaming container
- key / passphraseをlog、analytics、clipboardへ残さない
- backup作成前にraw locationを含む説明
- restore前に対象map数とcollision modeを説明

このmodeのcrypto/library選定は別ADRまたは専用Issueで行う。独自暗号、独自KDF、unauthenticated encryptionは使用しない。

### Mode D — Device-bound encrypted backup

OS keystore等に依存し、同じ端末 / app identityだけで復号する方式。

用途候補:

- local snapshot
- crash-safe app-private recovery

制限:

- cross-device migrationには使えない
- app uninstall / key invalidationで復号不能になり得る

cross-device backupと同じ名称・導線にしない。

## Encryption decision gate

ユーザー向け外部backupを実装する前に、次を比較する。

1. app-private onlyでM0 / dogfood要件を満たすか
2. cross-device migrationが現在の製品価値に必要か
3. passphrase UXを許容できるか
4. recoveryを提供しない場合のdata loss説明
5. audited libraryのAndroid / React Native / Expo compatibility
6. algorithm / KDF / parameterの長期保守
7. streaming encryptionとcontainer format
8. backup version migration
9. test vectorとindependent decryptability

「とりあえずZIP password」や「base64で隠す」は暗号化と扱わない。

## Container limits

platform parserは、contentをmapping-engineへ渡す前に上限を設ける。

初期値は実data測定後に決めるが、最低限次を別々に制限する。

- compressed archive bytes
- uncompressed total bytes
- per-file bytes
- file count
- exploration count
- raw sample count
- marker count
- path length
- JSON nesting / line length
- decompression ratio
- processing time / cancellation

上限超過はcanonical transaction前に拒否する。部分的に読み込んで「可能な分だけrestore」しない。

## Temporary file lifecycle

### Creation

- app-private temporary directory
- random operation ID
- private mode
- default filenameへ住所 / map名 / IDなし
- final destinationとtemporary pathを分ける

### Success

- share / save完了を確認
- plaintext temporary fileを削除
- operation metadataだけを最小限記録
- raw pathやmarker textをlogしない

### Cancel / failure

- cancellation、exception、process restart後にorphan cleanup
- cleanup failureを診断するがprivate contentをmessageへ含めない
- final destinationにpartial fileを残さない。atomic renameまたはprovider-supported commitを使用

### Retention

- app-private dogfood backupは明示的な一覧・削除UIまたは開発者commandを用意
- cacheへ無期限保存しない
- OS backup対象にするかを明示判断

## Sharing UX

- backup生成はsecondary action
- raw locationを含むことを短く明示
- GPX / GeoJSONとの違いを説明
- external app一覧を自動で開かない
- file生成前にformat / protectionを選択
- warningを閉じた後も取り消せる
- share完了をcloud backup成功と呼ばない
- recipient側でrestoreできるversionか表示

## Logging and telemetry

禁止:

- raw coordinate
- map / exploration ID
- map name
- marker text
- passphrase / key
- backup file path
- decrypted content
- manifest全体
- recipient app

許容候補:

- operation success / failure code
- schema version
- encrypted / app-private mode
- aggregate byte count bucket
- cleanup success

local-firstの初期段階では、これらもautomatic telemetryへ送らずlocal operational diagnosticに留める。

## Import / restore linkage

- pure validator成功前にDBを開かない
- collision preflight後も、writeとpreflightの間のraceをtransaction / unique constraintで防ぐ
- v1は`restore-new`のみ
- any ID collision = fail
- destructive replaceなし
- derived snapshotをcanonicalへinsertしない
- raw evidenceを保存後、current engineでreplay
- failure時rollback
- existing mapのbackupなしに置換しない

詳細は`docs/PERSONAL_MAP_IMPORT_POLICY.md`を正本とする。

## Test matrix

### Logical content

- special number round-trip
- unicode / marker text
- empty and multi-session map
- geographic / local / unresolved frame
- duplicate IDs
- invalid structural metadata

### Container security

- path traversal
- absolute / Windows drive path
- symlink entry
- duplicate filename
- ZIP bomb / decompression ratio
- oversized single file / file count
- malformed central directory
- cancellation during read/write

### Encryption

- known test vectors
- wrong passphrase
- bit flip / truncated ciphertext
- nonce uniqueness
- KDF parameter migration
- app restart during encrypt/decrypt
- no plaintext orphan

### Restore

- clean restore-new
- every collision class
- write-stage fault injection
- rollback
- restart / replay
- unsupported future version
- game absent

## Current decision

- pure logical builder / validator / staging / collision preflightを先に進める
- app-private dogfood writerを次のplatform実装候補とする
- plaintext external raw backupは通常ユーザー向けに出さない
- encrypted cross-device backupはlibrary / KDF / UX / migrationを別gateで決める
- current real-device S0 APKへbackup UIを追加しない

本decisionを変える場合は、Issue #92、Issue #93、`docs/EXPORT_BOUNDARY.md`、`AGENTS.md`、privacy UXを同時に更新する。
