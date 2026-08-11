# ADR 0014: battery optimization ONを通常条件としてlive freshnessを設計する

- Status: Accepted
- Date: 2026-08-11
- Related: #3, #4, #116, #119, #128

## Context

Pixel 10 / Android 17の実測では、battery optimization ON、power saver OFF、必要権限許可の通常条件で、受信したraw sampleは全件SQLiteへ保存できた。一方、background callbackの最大gapは約9分、callback到着時の最新observationも最大約6分古かった。raw evidenceのeventual completenessと、探索中のlive map・marker位置のfreshnessは別品質である。

ユーザーへbattery optimization除外を要求しないと成立しない設計はPassive-first要件に合わない。

## Decision

1. battery optimization ONをField-testと通常利用のbaselineにする。解析上はINFOとして記録し、それ自体をWARN/FAILにしない。
2. raw observationのcanonical保存とderived mapの判定は変更しない。
3. background requestからアプリ指定の`deferredUpdatesDistance` / `deferredUpdatesInterval`を外し、OSへ追加の遅延許可を与えない。
4. アプリがactiveへ戻った時は、現在位置fixを1回明示要求してcanonical ingestへ通す。
5. marker入力開始時にstale/missingなら同じrefreshを先行し、保存時にも30秒以内のaccepted位置を要求する。fresh accepted位置を得られなければ、古い位置へ黙ってmarkerを付けない。
6. Recording UIは最後に端末から届いた位置時刻のageを座標なしで表示する。
7. refresh requested/succeeded/failedをcoordinate-free lifecycle evidenceとして保存する。
8. callback gapとnewest-observation ageのS0基準は、battery optimizationを理由に弱めない。
9. この最小変更でもforeground catch-upが成立しない場合、既存`TrackingProviderPort`の内側でAndroid native Fused Location adapterを比較する。PDRへは進まない。

## Consequences

- 通常ユーザーへ設定変更を要求しない。
- active復帰時だけ追加fixを取得するため、常時foreground pollingは増やさない。
- markerはGPS困難環境で一時的に保存できない場合があるが、誤った古い位置へ確定するより安全である。位置未確定markerの明示UXは別Issueで検討する。
- Expo providerとnative providerの比較は同じraw evidence / diagnostics / S0基準で行える。
