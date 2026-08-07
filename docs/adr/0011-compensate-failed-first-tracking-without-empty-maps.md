# ADR 0011: 初回tracking開始失敗は未観測の新規map/sessionだけを補償削除する

- Status: Accepted
- Date: 2026-08-07

## Context

新規探索の旧フローは次の2 commandだった。

1. `createPersonalMap`
2. `startExploration`

`startExploration`はprovider開始失敗時に新しいExplorationSessionを削除していたが、先に作成した0-session PersonalMapは残った。HomeをPersonalMap-firstへ変更したため、権限拒否、TaskManager不可、OS開始失敗などで、ユーザーが一度も探索できていない空地図が表示され得る。

UIで0-session mapを隠すだけではcanonical stateが残り、export、sync、別app shell、game appから見える。canonical deleteもmapping-engineの制御されたapplication boundaryへ置く必要がある。

一方、user-initiated deletionとautomatic compensationは意味が異なる。

- automatic compensation: 新規作成直後、providerが開始せず、raw observationもconfirmed markerもない一時的recordを元に戻す
- user deletion: 既存位置履歴を意図的に削除する高感度操作であり、確認、export、復旧、共有・同期影響を別途設計する

## Decision

### New application use case

`mapping-engine`へ`createPersonalMapWithFirstExploration`を追加する。

- PersonalMapとfirst ExplorationSessionを同一repository transactionで作成
- repository commit後にtracking providerを開始
- provider開始成功後だけ`exploration.started` eventを公開
- mobileの新規探索とdemo作成はこのuse caseを使う

既存PersonalMapの続きは従来どおり`startExploration`を使う。

### Conditional automatic compensation

provider開始失敗時は、engineがrepository transaction内で次を確認して削除する。

#### New PersonalMap + first session

削除可能なのはすべてを満たす場合だけ。

- 指定PersonalMapが存在する
- 所属ExplorationSessionが指定first sessionの1件だけ
- sessionがrecording状態
- raw position sampleが0件
- confirmed markerが0件

条件を満たせばPersonalMapを削除し、foreign-key cascadeでsessionとoperational diagnosticsを削除する。

#### Existing PersonalMap continuation

削除可能なのは新規sessionがrecording状態で、raw sampleとconfirmed markerが0件の場合だけ。PersonalMap本体と既存sessionは削除しない。

### Evidence preservation

providerが失敗を返す前にcallbackやmarkerがcanonical保存された場合、automatic compensationを拒否する。

- raw evidenceを削除しない
- map/sessionを回復可能な状態で残す
- engineはstart errorとcompensation refusalを`AggregateError`として返す
- 後続のrecovery UXで明示的に扱う

「provider start失敗だから」という理由だけで、既に到着した位置履歴を黙って削除しない。

### User deletion remains separate

一般的な`deletePersonalMap` commandは本ADRでは追加しない。実装する場合は別Issueで次を設計する。

- destructive confirmation
- export / backup導線
- active sessionの扱い
- attachment、experience state、syncの扱い
- undoまたは非可逆性の説明

## Alternatives considered

### A. Homeで0-session mapを非表示にする

却下。canonical orphanが残り、別app、export、将来syncで再出現する。

### B. Public `deletePersonalMap` commandを先に作り、mobile catchから呼ぶ

却下。自動補償とユーザー削除の権限・確認・監査が混ざる。UIがcatch処理を忘れると再発する。

### C. provider.startをDB transaction内で実行する

却下。外部OS副作用をSQLite transaction中に待つと、callbackのDB書き込み、deadlock、長時間lock、rollback不能なprovider状態を招く。

### D. providerを先に開始し、成功後にmap/sessionを保存する

却下。provider callbackがcanonical record作成前に到着するraceがあり、raw observationを失う。

### E. provider failure時は常に強制削除する

却下。callbackが先に届いた場合のraw evidenceを失い、Product Constitutionのsource-of-truth原則に反する。

## Consequences

### Positive

- 初回開始失敗で空PersonalMapがHomeへ残らない
- map/session作成とprovider startの意味が1 application use caseになる
- existing PersonalMapの続きを誤削除しない
- callback raceでcanonical evidenceが到着しても保存する
- UI、game、adapterが直接DELETE SQLを持たない

### Costs

- engine APIとrepository writer contractが増える
- compensation refusal時のrecovery UXが将来必要
- user deletionは別途実装が必要
- provider lifecycleは完全な単一ACID transactionにはできず、明示的compensationを保守する必要がある

## Privacy / export / recovery impact

- 未観測の空recordだけを削除するため、位置履歴の喪失はない
- raw/markerがあれば削除を拒否する
- GPX / GeoJSON / PersonalMap bundleには空失敗mapを出力しない
- user deletionのexport確認は別Issueへ残す
- compensation refusal mapは将来のrecovery/diagnostic画面で説明可能にする

## Validation

- provider start failure後にPersonalMap / ExplorationSessionが0件
- actual SQLite transaction / cascade integrity
- raw sampleがある場合は削除拒否
- markerがある場合は削除拒否
- 既存sessionがあるPersonalMapは削除拒否
- continuation failureは新しい未観測sessionだけ削除
- provider成功時はmap/session/eventが通常どおり残る
- mobile新規探索はcombined use caseを使用

## Related

- Issue #17
- Product Constitution invariants 1, 6, 8
- ADR 0006 / 0007 / 0010
