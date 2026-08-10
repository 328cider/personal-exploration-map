# ADR 0013: session外観測をraw保持し、derived routeとmarker鮮度を分離する

- Status: Accepted
- Date: 2026-08-10
- Related: #3, #4, #116, #119, PR #117, PR #126

## Context

2026-08-10の実機runでは、1つのExplorationSessionを66.1分継続し、raw 662件を662件すべて保存した。一方で次の二つの時刻問題が確認された。

1. session開始より12.423秒前のcached GNSS observationが1件あった
2. callback deliveryが最大759.725秒遅れ、古い観測を最大107件まとめて受信した

raw evidenceの保存は成立していたが、開始前cached fixが最初のaccepted pointになると、明示的な探索開始より前の位置がderived routeとgeographic frame originを決める。callback遅延中にmarkerを保存すると、marker fallbackが古いaccepted pointへ付く可能性もある。

raw observationの所有権、derived map truth、live freshnessを同一の削除・採用判断へ混ぜてはならない。

## Decision

### 1. Raw evidence

providerから受け取ったobservationは、次のいずれでもcanonical raw evidenceとして保持する。

- session開始前のcached fix
- session終了後の遅延fix
- non-finite timestamp
- callback受信時刻より未来に見えるfix
- quality filterで不採用になったfix

raw SQLite row、exact payload、session membership、ordinalを削除・書換えしない。

### 2. Derived session window

明示的なExplorationSession境界をderived routeの時間窓とする。

```text
recordedAtMs < startedAtMs
  → sample-before-session-start

startedAtMs <= recordedAtMs <= endedAtMs
  → 通常のquality / frame判定

recordedAtMs > endedAtMs
  → sample-after-session-end
```

許容clock skewは0msとする。session start / endとAndroid `Location.timestamp`はいずれも同一端末のwall-clock millisecondsを使うため、境界外sampleを推測でin-windowへ丸めない。

- pre-start sampleはframe originを決めない
- post-end sampleはcompleted routeへ戻さない
- completed sessionへ後から届いたin-window timestampは`session-not-recording`とし、post-end timestampと区別する
- non-finite timestampは`invalid-timestamp`

### 3. Callback future timestamp

callback receive timeは現行canonical `RawPositionSample`へ保存していない。受信時刻だけをlive ingestionで地図採否へ使うと、restart後のreplayで同じ判断を再現できない。

そのため、callback receive timeより未来のobservationは次のように扱う。

- raw evidenceは保持
- coordinate-free diagnosticsで`callback_future_observation_batches`を記録
- objective analyzerでは`future_observation_timestamp`をFAILとする
- future batchがあるrunをbuffered-delivery WARNへdowngradeしない
- session endが確定した後は、endより後のsampleをderived routeから除外する

future timestampをlive routeでも永続的に同一判断で除外する必要が実測で生じた場合、callback receive provenanceをcanonical storageへ追加する別schema / ADRを作る。現時点で非再現なambient `Date.now()`判定をmapping-coreへ入れない。

### 4. Marker attachment freshness

source positionを明示しないmarkerは、marker時刻以前の最新accepted pointへfallbackする。この実際のauthorityに合わせて、marker保存時に次をnon-canonical diagnosticとして記録する。

```text
latestObservationAgeMs
latestObservationMissing
latestObservationFuture
```

`latestObservationAgeMs`は、marker diagnostic event時刻から最新accepted observation timestampを引く。最新raw sampleではなくlatest accepted pointを使うため、低精度で除外された新しいsampleによって鮮度を過小評価しない。

- age >= 30秒は`marker_attachment_stale` WARN
- accepted pointなしは`marker_observation_missing` WARN
- accepted pointがmarker時刻より未来なら`marker_observation_from_future` FAIL
- marker text、座標、map/session IDはdiagnostic payloadと共有reportへ入れない
- diagnostic read failureでmarker保存を失敗させない

### 5. Analyzer semantics

次を別の軸としてreportする。

```text
observation continuity
  → post-hoc routeを再生成できるか

callback delivery freshness
  → live mapが何秒遅れたか

marker attachment freshness
  → 発見が何秒古いaccepted pointへ付いた可能性があるか

session window
  → raw observationが明示的探索境界内か
```

`generic` modeでcatch-up deliveryをWARNへ落とす条件はPR #126のまま維持し、future timestamp、未保存sample、observation outage、failed callbackがあればFAILとする。S0のlive-freshness gateは弱めない。

## Alternatives considered

### A. pre-start sampleをSQLiteへ保存しない

却下。provider behaviorとcached fixの証拠を失い、filter変更後の再検証ができない。

### B. 10秒程度のclock-skew toleranceを置く

却下。同じ端末clockで取得した境界に推測幅を入れると、今回の12.423秒cached fixのような観測を不安定に採用する。必要なtoleranceは実測とcanonical provenanceを得てから設計する。

### C. callback receive timeをその場だけ使ってfuture sampleを拒否する

却下。receive timeをcanonical保存していないため、restart後のreplay結果とlive結果が一致しない。

### D. marker鮮度をlatest raw sampleから計算する

却下。marker fallbackはaccepted trackを使うため、raw基準では実際の付着位置より新しく見える可能性がある。

### E. callback遅延中はmarker保存を禁止する

却下。Passive-first UXを壊し、発見自体を失う。MVPでは保存を継続し、鮮度を可視化・計測する。

## Consequences

### Positive

- cached fixがPersonalMap原点を汚染しない
- raw evidenceは失われない
- post-end observationとclosed-session deliveryを区別できる
- marker位置の古さを座標なしで評価できる
- live freshnessとpost-hoc completenessを別々に判断できる
- replay determinismを維持する

### Costs

- accepted countが旧buildより減る場合がある
-既存PersonalMapは再生時に新しいrejection reasonへ変わる
- marker鮮度のためmarker完了後にread-only repository queryが1回増える
- future timestampのcanonical receive provenanceは未実装のまま残る

## Validation

- pre-start sampleはrawに残り、track / frame originから除外
- first in-window accepted sampleがframe originになる
- post-end sampleは`sample-after-session-end`
- completed sessionへ届いたin-window sampleは`session-not-recording`
- non-finite timestampは`invalid-timestamp`
- restart replayでも同じderived result
- marker age / missing / futureのunit test
- coordinate-free text / JSONにmarker freshnessを出す
- raw coordinate、ID、marker本文を出さない
- Android emulatorでmarker保存、再起動、USB extractionを通す
- extracted SQLiteのmarker diagnostic payload shapeを検証する

## Revisit conditions

- future timestamp batchが実機で観測される
- accepted pointなしmarkerが通常利用で頻発する
- marker age 30秒WARNが誤警報として多発する
- PDRなどmonotonic sensor clockをwall clockへ変換するproviderを追加する
- receive provenanceをlossless backup / restore対象へ追加する
