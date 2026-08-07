# ADR 0010: tracking診断をcanonical map truthから分離する

- Status: Accepted
- Date: 2026-08-07

## Context

バックグラウンドGNSSのM0判定には、raw位置サンプルだけでは説明しにくい情報がある。

- OS callbackが何件のbatchで届いたか
- duplicate callbackがあったか
- provider start / stopが成功したか
- appがforeground / backgroundへ移行したか
- process再生成後にsessionを復元したか
- marker入力が何秒の中断を生んだか
- platformまたはpersistence errorがいつ起きたか

これらは受動記録の信頼性とUXを評価する重要な観測だが、地図上の位置、経路、接続、発見を決める証拠ではない。

診断値をcanonical domainへ混ぜると、loggingの欠落やversion差でPersonalMapが変わり、ゲーム・UI・計測都合がmap truthへ侵食する。一方、診断保存の失敗でraw位置記録まで止めることも避ける必要がある。

## Decision

### Canonical evidence

次だけがPersonalMap再生成の正本である。

- raw position / sensor observations
- ExplorationSession metadata
- confirmed markers / corrections
- explicit coordinate frame / anchors

accepted / rejected、derived track、PersonalMapはmapping-core replayから再計算する。

### Operational diagnostics

provider lifecycle、callback delivery、app lifecycle、error、marker interruption timeを`tracking_diagnostic_events`へ別保存する。

- PersonalMap / ExplorationSessionへforeign keyで関連付ける
- event idでidempotentに保存する
- session削除時にcascade deleteする
- payloadは小さなscalar JSONに限定する
- diagnostic eventからcanonical routeを作らない
- diagnostic eventの保存失敗はtracking・raw persistenceを失敗させない

### Derived report

開発用reportは次を組み合わせる。

- raw observationsをmapping-coreでreplayした採否・精度・gap
- diagnostic eventsから集計したcallback・lifecycle・input timing

したがって、report表示や集計ロジックを変更してもPersonalMapは変化しない。

### Privacy

診断eventはlocal-firstとし、raw coordinateをpayloadへ重複保存しない。正確な位置を共有することなく、gap、count、error、state transitionをIssueへ要約できるようにする。

電池残量はM0ではmanual run templateへ記録し、sampling behaviorを理解する前に新しいplatform dependencyを追加しない。

## Alternatives considered

### A. app_stateへ最後のerrorだけ保存する

却下。単一値ではcallback batch、復帰、provider lifecycle、入力時間の時系列を再現できない。app_stateは最後のerrorのfallbackとして残す。

### B. RawPositionSampleへcallback metadataを追加する

却下。1 callbackに複数sampleが含まれ、delivery lifecycleと位置観測の責務が異なる。map truth modelがplatform deliveryへ依存する。

### C. Analytics serviceへ送る

却下。MVPのlocal-first原則と位置履歴の機密性に反する。実機検証にcloud accountは不要。

### D. 診断保存をcanonical transactionへ含める

却下。診断書き込み障害でraw observationを失う。diagnosticsはbest-effortであるべき。

## Consequences

### Positive

- background欠落の原因をraw gapとcallback deliveryに分けて調査できる
- process recoveryとprovider lifecycleを時系列で確認できる
- marker入力の中断時間を実測できる
- game / renderer / analyticsがmap truthを変更しない
- 個人位置を共有せず技術指標を報告できる

### Costs

- DB schema v3とevent pruning方針が必要になる
- diagnostic event自体が欠落する可能性をreportで考慮する必要がある
- development UIが増える
- 長期運用時は保持量と削除を監視する必要がある

## Retention

M0ではExplorationSessionと同じ寿命で保持し、session削除時にcascadeする。cloud syncやlong-term telemetryへ自動送信しない。

大量runで容量が問題になった場合は、raw mapとは別に明示的な診断削除・要約を設計する。

## Validation

- DB v2→v3 migrationでcanonical tablesを変更しない
- diagnostic eventのidempotent insert / order / cascade
- pure report unit tests
- foreground / background callbackのreceived / persisted / failed記録
- provider start / stopとAppState / recoveryの記録
- diagnostic store failureがcanonical ingestを妨げないこと
- Reviewのdevelopment reportがraw replay結果を表示すること

## Related

- Issue #3
- Product Constitution invariants 1, 4, 6, 8, 10
- ADR 0006 / 0007
- `docs/experiments/001-background-gnss.md`
