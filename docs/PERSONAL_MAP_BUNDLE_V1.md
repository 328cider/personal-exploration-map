# PersonalMap Bundle v1 — Logical Format

- Status: implementation candidate / export-only logical contract
- Schema version: `1`
- Number encoding: `ecmascript-number-string-v1`
- Updated: 2026-08-09

## Purpose

PersonalMap bundleは、GPXやGeoJSONとは別の**無損失backup / replay境界**である。

- GPX / GeoJSON: geographic derived mapの相互運用
- PersonalMap bundle: raw evidence、session、frame、provider、confirmed markerを保持するbackup

`PersonalMapSnapshot`だけをJSON化してbackupとは呼ばない。snapshotはaccepted track、bounds、stats等のderived viewであり、rejected sampleや元のraw値を完全には保持しない。

## Product boundary

v1 logical builderはread-onlyであり、次を行わない。

- SQLiteを読む
- file / directory / ZIPを書く
- share sheetを開く
- cloudへ送信する
- canonical mapを変更する
- import / restore transactionを実行する
- accepted / rejected、derived track、coverageを正本として保存する
- game / experience stateを含める

repository read model、SHA-256 runtime、container writer、暗号化、明示的share UI、transactional importはplatform / adapter側の別責務である。

## Manifest invariants

```json
{
  "format": "personal-exploration-map-bundle",
  "schemaVersion": 1,
  "numberEncoding": "ecmascript-number-string-v1",
  "containsRawLocation": true,
  "containsDerivedMap": false,
  "containsGameState": false,
  "replayRequired": true,
  "fileHashAlgorithm": "sha256"
}
```

意味:

- raw位置を含むため、高感度なprivate backupとして扱う
- derived trackをcanonical backupへ固定しない
- gameなしでmapをrestoreできる
- restore後はraw evidenceからderived mapを再生成する
- content fileはすべてSHA-256とUTF-8 byte lengthで検証する

`manifest.json`は自身のhash inventoryへ入れない。container署名やmanifest authenticationは将来の暗号化・署名layerで扱う。

## Logical files

```text
manifest.json
personal-map.json
explorations/
  0001.json
  0002.json
observations/
  0001.ndjson
  0002.ndjson
markers/
  0001.json
  0002.json
```

file pathへPersonalMap名、場所名、住所、session名、IDを入れない。explorationは開始時刻とIDで決定的に並べ、4桁ordinal pathを割り当てる。

IDとuser-authored labelはrestoreに必要なprivate content内へ保持するが、default filenameやcontainer pathへ露出しない。

## `personal-map.json`

保持するもの:

- PersonalMap ID
- user-authored name
- created / updated timestamp
- export時点のderived frame hint

`frameAtExport`はvalidation / replay hintであり、raw evidenceより強い真実ではない。異なるframeを推測で統合する根拠にしない。

## `explorations/<ordinal>.json`

保持するもの:

- ExplorationSession ID
- PersonalMap membership
- user-authored session name
- started / optional ended timestamp
- tracking provider ID
- optional local frame label

各sessionは独立した証拠単位であり、bundleでも順序やmembershipを維持する。session間をderived lineで接続しない。

## `observations/<ordinal>.ndjson`

1行1件の`RawPositionSample`をpersisted orderで保存する。

保持するもの:

- sample ID
- raw timestamp
- source (`gnss / pdr / manual / simulation`)
- geographicまたはlocal position
- altitude / floor
- horizontal accuracy
- heading
- speed
- confidence

invalid coordinateやconfidenceを理由にrejectedになったraw sampleも消さない。

## Exact number encoding

通常のJSONは、`NaN`と`±Infinity`を正しく表せず、`JSON.stringify`では`null`に変わる。`-0`も通常のnumber JSONでは`0`になる。

v1では**すべてのnumberをstringとして保存**する。

| JavaScript value | Token |
|---|---|
| `NaN` | `"NaN"` |
| `+Infinity` | `"+Infinity"` |
| `-Infinity` | `"-Infinity"` |
| `-0` | `"-0"` |
| finite number | `String(value)`のcanonical表現 |

Decoderは`01`、`1.0`、`+1`、`0e0`、前後空白、lowercase infinity等の別表記を拒否する。一つの値に一つのtokenだけを許可し、hash、diff、replayを安定させる。

structural metadata（PersonalMap / session start/end等）はfiniteかつ整合していなければbundle buildを拒否する。一方、raw evidence内のinvalid numberは失敗の証拠なのでtoken化して保持する。

## `markers/<ordinal>.json`

user-confirmed markerをpersisted orderで保持する。

- marker ID
- timestamp
- category
- label / note
- optional local x/y
- optional raw source position

markerはconfirmed evidenceであり、game collectibleやinferred POIを暗黙に混ぜない。

## SHA-256 port

mapping-engineはruntime cryptoをimportしない。

```ts
interface PersonalMapBundleSha256Port {
  sha256Utf8(content: string): string | Promise<string>;
}
```

platform adapterがUTF-8 bytesをSHA-256化し、64文字lowercase hexを返す。builderは形式を検証し、各logical fileのbyte lengthとhashをmanifestへ記録する。

## Build-time fail-closed rules

- map / exploration IDとnameは空にしない
- canonical metadata timestampはfinite
- map updatedAtはcreatedAt以降
- exploration endはstart以降
- explorationのPersonalMap membership一致
- exploration ID重複なし
- session内sample ID重複なし
- bundle全体でmarker ID重複なし
- hasher結果は64文字SHA-256 hex

raw sample自体を品質filterで捨てない。品質判定はrestore後のreplayに委ねる。

## Import precondition

このbuilderだけでimportは完成しない。import adapterは少なくとも次を行う。

1. container path traversalを拒否
2. format / schema / number encodingを確認
3. manifest profileとprivacy flagを確認
4. 全fileのhash / byte lengthを確認
5. inventory、counts、IDs、membershipを確認
6. bundle number tokenをcanonical decoderで復元
7. ID collision policyを明示
8. canonical repository transactionを開始
9. raw evidenceとconfirmed markerを保存
10. derived mapをreplay
11. failure時にpartial stateをrollback

validatorが成功する前にcanonical transactionを開始しない。

## Privacy

- raw locationを含むことをexport前に説明する
- exportはユーザーの明示操作だけ
- automatic uploadなし
- default filenameへ場所情報なし
- temporary fileを不要後に削除
- public Issueや通常チャットへraw bundleを添付しない
- encryption / device migration threat modelはcontainer実装前に定義する

## Current implementation state

Implemented in mapping-engine:

- logical content builder
- deterministic inventory
- exact number encoder / decoder
- injected SHA-256 port
- build-time validation
- unit tests

Not yet implemented:

- repository read-only export model
- actual SHA-256 adapter
- directory / ZIP writer
- encryption
- mobile explicit backup/share UI
- container parser
- fail-closed validator
- transactional import / restore

後続実装で本書と実体がずれた場合、同じPRで更新する。
