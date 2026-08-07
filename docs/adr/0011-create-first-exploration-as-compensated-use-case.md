# ADR 0011: PersonalMapと初回探索を補償可能な1ユースケースとして作成する

- Status: Accepted
- Date: 2026-08-07
- Related issue: #17
- Renumbered: 2026-08-07（既存のoperational diagnostics ADR 0010との重複を解消）

## Context

新しい地図の開始は、従来次の2つのapplication commandに分かれていた。

1. `createPersonalMap`
2. `startExploration`

`startExploration`はtracking providerの開始に失敗した場合、作成したExplorationSessionを補償削除する。しかしPersonalMapは先に確定しているため、権限拒否、TaskManager非対応、OS API失敗などで、探索を一度も開始できなかった0-session PersonalMapがHomeに残る。

この問題をmobile UIから直接DELETEして隠すと、canonical map-write authorityを破り、将来のgame appや別shellで同じ問題が再発する。

一方、一般の`deletePersonalMap` commandをこの問題のためだけに先行実装すると、ユーザーによる位置履歴削除、確認、export、復元、active session、attachmentsなど別の意味を持つ機能を、automatic compensationと混同する。

## Decision

`mapping-engine`に`createPersonalMapWithFirstExploration` use caseを追加する。

- PersonalMap recordと最初のExplorationSession recordを1つのrepository transactionで作成する。
- frame/provider互換性を、writeやprovider side effectより前に検査する。
- canonical recordsの作成後にtracking providerを開始する。
- provider開始成功後だけ`exploration.started` eventを公開する。
- provider開始失敗時は、strict conditional compensationをrepository transactionで試みる。

補償削除は次をすべて満たす場合だけPersonalMap全体を削除する。

1. 対象PersonalMapが存在する。
2. 対象ExplorationSessionがそのPersonalMapの唯一のsessionである。
3. sessionはまだrecording状態である。
4. position sampleが0件である。
5. markerが0件である。

条件を満たさない場合、raw evidenceまたは別sessionを守るため削除を拒否し、元の開始エラーと補償拒否を`AggregateError`として返す。

既存PersonalMapへ続きを追加する`startExploration`は従来どおり別use caseとする。新規PersonalMapのmobile flowとdemo flowは、2段階呼び出しではなく新しいcomposite commandを利用する。

## Automatic compensation vs user deletion

automatic compensationは、provider開始前後の失敗を「操作が成立しなかった状態」へ戻す内部回復である。

user-initiated deletionは、成立済みの位置履歴をユーザーの意思で削除する別機能であり、将来次を含めて専用Issueとcommandで設計する。

- 明示確認
- active sessionの扱い
- export / backup案内
- attachments / experience state
- undoまたは復元可能性
- privacy expectation

本ADRは一般のuser delete APIを提供しない。

## Alternatives considered

### A. mobile側で失敗後に空PersonalMapを直接削除する

却下。canonical write boundaryを迂回し、他app shellで再発する。

### B. 一般の`deletePersonalMap` commandを先に作る

今回は却下。automatic compensationとユーザーのデータ削除では意味、確認、安全条件が異なる。

### C. PersonalMapを作成せず、provider成功後にmap/sessionを保存する

却下。provider callbackが成功応答前に到着する可能性があり、canonical exploration contextなしでraw evidenceを扱うことになる。

### D. provider開始失敗時に無条件でPersonalMapをcascade deleteする

却下。partial startでevidenceが到着した場合や、並行して別sessionが追加された場合にデータを失う。

## Consequences

### Positive

- 初回開始失敗で空PersonalMapがHomeに残らない。
- map/session recordの部分作成はtransactionで防げる。
- partial evidenceや別sessionが存在する場合は自動削除しない。
- mobile、future game、別shellが同じapplication use caseを利用できる。
- user deletionの設計を急いで混同しない。

### Costs

- engine APIとrepository writerに専用の補償境界が増える。
- provider開始はDB transaction外の副作用なので、完全な原子的処理ではなくsaga型の補償になる。
- 補償拒否時は、回復可能なrecordを残したうえで複合エラーを扱う必要がある。

## Validation

- in-memory engine testで成功、空map補償、evidence保護、既存session保護を確認する。
- real SQLite testでcascade、row count、foreign-key integrityを確認する。
- mobile static guardで新規探索がcomposite commandを使うことを確認する。
- Android実機ではIssue #3で権限拒否、TaskManager非対応、開始失敗後のHomeを確認する。

## Revisit conditions

- user-initiated PersonalMap deletionを実装する時
- provider startとcallbackのlifecycle contractを変更する時
- cloud syncまたはmulti-device concurrencyを導入する時
- raw attachmentsやexternal referencesをPersonalMapへ追加する時
