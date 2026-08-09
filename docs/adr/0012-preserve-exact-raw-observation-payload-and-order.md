# ADR 0012: raw observationの元payloadと受領順をcanonical保存する

- Status: Accepted
- Date: 2026-08-10
- Related: #92, #99, #109, PR #108, PR #111

## Context

PersonalMapはraw observationから再生成される。logical bundle v1はJavaScript numberを
`ecmascript-number-string-v1`で表し、`NaN`、`±Infinity`、`-0`を保持できる。

しかしPR #108のNode 22 / SQLite実測で、現行numeric columnは次の挙動を示した。

- `NaN`はnullable `REAL`で`NULL`になり、`NOT NULL`ではinsert failureになる
- `-0`は正の`0`になる
- `±Infinity`は往復する

また、v3までの`position_samples`にはsession内ordinalがなく、readは
`recorded_at, id`順だった。同時刻、out-of-order callback、invalid timestampを含むprovider受領順を
この順序から復元することはできない。

logical serializerだけを正確にしても、SQLite保存時に失われた値と順序は復元できない。

## Decision

DB schema v4でraw observationを二層に分ける。

### Canonical exact payload

各新規rowへ次を保存する。

- `raw_payload_format = raw-position-sample-exact-v1`
- `raw_payload_json`
- `(exploration_id, id)` identity
- `sample_ordinal`
- `ordinal_provenance = ingest-sequence-v1`

`raw_payload_json`はproviderからmapping/filterへ渡された`RawPositionSample`をSQLite numeric affinity前に
serializeする。全numberはbundleと同じcanonical tokenを使い、optional fieldのabsenceとspecial valueを
区別する。

replayとlossless bundle exportは新規rowではこのexact payloadをauthorityとして読む。

### Normalized projection

既存のnumeric columnsは有限値だけを保存するquery/filter projectionとする。

- non-finite valueはprojectionで`NULL`
- projectionはoriginal raw truthではない
- projectionとpayloadが異なる場合、payloadをauthorityとする

### Order and identity

- ordinalはexclusive canonical transaction内でsessionごとの`MAX + 1`を割り当てる
- byte-identical retryはidempotentでordinalを消費しない
-同じsessionで同じIDに別payloadを渡した場合はtransactionを失敗させる
- sample IDはbundle / restore preflightと同じくExplorationSession scopeとする

### Legacy data

v3以前のrowは値や元順序を推測しない。

- `raw_payload_format = legacy-normalized-v1`
- `raw_payload_json = NULL`
- `ordinal_provenance = legacy-recorded-at-id-v1`
- ordinalは従来のdeterministic replay順`recorded_at, id`から移行時に付与

通常replayは従来どおり可能だが、lossless bundle exportはlegacy rowが一件でもあればfail closedする。

## Consistent read

bundle用SQLite readerは一つのread transaction / snapshot内でmap、frame、session、raw、markerを読む。
既存のserialized database queueがsnapshot全体を所有し、transaction内queryは順番にawaitする。

これによりtracking callbackとexport queryの途中混在、およびExpo SQLite native statementの並行利用を避ける。

## Alternatives considered

### A. numeric columnsをそのままbundle tokenへ変換する

却下。すでに`NULL`化された`NaN`と正規化された`-0`を復元できない。

### B. provider boundaryでinvalid sampleを保存前に捨てる

却下。rejection理由を含むraw evidenceを失い、将来filterで再評価できない。

### C. DB fileをそのままbackupする

却下。schema/runtime実装を公開contractにし、migration、privacy、cross-platform restoreを困難にする。

### D. timestampを順序として使い続ける

却下。timestampは観測値であり、receive order、同時刻、out-of-order deliveryを表さない。

### E. legacy値を推測してexact payloadを生成する

却下。回復不能な情報を捏造してlosslessと表示することになる。

## Consequences

### Positive

- 新規raw evidenceはspecial numberとoptional fieldをexact保存できる
- provider受領順を明示的に復元できる
- duplicate callbackのidempotencyとordinalが整合する
- bundle builderがnormalized DB columnsを再解釈しない
- legacy limitationが明示され、silent degradationを防げる

### Costs

- raw payloadとprojectionの二重保存でDB sizeが増える
- v4 migrationとExpo / Android validationが必要
- legacy mapは完全なlossless backup対象にできない
- future raw schema変更はpayload format version追加が必要

## Privacy and logging

exact payloadはraw locationを含むapp-private canonical evidenceである。

- automatic uploadなし
- analytics / crash logへpayload、座標、map/session IDを出さない
- errorはcode中心とし、raw JSONをmessageへ入れない
- external plaintext backupは通常導線へ出さない

## Validation

- exact codecでfinite、`NaN`、`±Infinity`、`-0`、optional absence
- v1→v4 migration、rollback、foreign-key integrity
- equal / out-of-order timestampでもordinal順
- duplicate retryでordinal非消費
- same sample IDを別sessionで保持
- normalized projectionとexact payloadのauthority分離
- one-snapshot SQLite bundle read
- legacy normalized rowのlossless export拒否
- Node SQLite package tests
- Expo Android migration / persistence / restart / emulator gate

## Revisit conditions

- raw sensor streamを`RawPositionSample`以外へ拡張する時
- payload sizeが実測でstorage/valueを損なう時
- encrypted cross-device backupを実装する時
- legacy mapのbest-effort export UXを別profileとして検討する時
