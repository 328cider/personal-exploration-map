# Experiment 001: ポケット内バックグラウンドGNSS

## Hypothesis

ユーザーが探索開始後にスマホをロックしてポケットへ入れても、30–60分の探索経路と発見を、見返せる個人地図として十分に記録できる。

## Why first

屋内PDRより技術的不確実性が低く、コアUX、権限、電池、永続化、レビュー体験を先に検証できる。

## Existing implementation references

成熟したAndroid GPS loggerから、アルゴリズムをコピーするのではなく、lifecycleと試験観点を学ぶ。

### OpenTracks

確認対象:

- foreground service開始・停止
- notificationからの復帰
- process recreation後のrecording state
- sampling interval / distanceとbatteryの関係
- markerとtrack export
- pause / resume / stopの状態遷移
- Android version / vendor差

Apache-2.0の実装は再利用候補になり得るが、Kotlin serviceをExpoへ再実装すること自体を目的にしない。まずbehaviorとfailure matrixを比較する。

### GPSLogger

確認対象:

- lightweight continuous logging
- batching / delayed callback
- provider fallback
- signal loss後のrecovery
- export timingとpartial file
- device-specific battery restrictions

GPL-family codeはproduct pathへコピー・リンクせず、公開仕様、実行behavior、試験観点の参照に限定する。

## Protocol

最低3種類のAndroid端末状態で、同じ既知ルートを記録する。

1. 画面ON・前面
2. 画面OFF・ポケット・バックグラウンド
3. 画面OFF・途中でマーカー追加・再度ポケット
4. notificationからアプリへ復帰
5. processをOSが再生成した後にactive sessionを復元
6. permissionを途中で変更
7. networkなし
8. battery saver ON / OFF

各30分以上。開けた場所、建物沿い、短い屋内通過を含む。比較用の基準軌跡は既存GPSロガーまたは高頻度前面記録を使用する。

場所カテゴリは製品モードにしない。試験条件の説明としてのみ記録する。

## Sampling matrix

最初から唯一のsampling設定を正解とみなさない。

- accuracy preset
- time interval
- distance interval
- deferred update distance / interval
- stationary period
- foreground vs background

各設定で、欠落・経路認識性・batteryを比較する。最適化でraw callbackを捨てず、platform callbackとrepository persistenceの両時刻を診断できるようにする。

## Metrics

### Recording continuity

- callback gapの最大・p50・p95・p99
- 30秒 / 60秒 / 120秒超のgap数
- raw callback batch size
- OS callback数とpersisted unique sample数
- duplicate callback数
- recording stateとplatform runtimeの不一致時間

### Map quality

- raw sample数
- accepted / rejected数と理由
- route length差
- endpoint error
- known corner / turn preservation
- 明らかな異常ジャンプ
- 建物沿いの横ずれ
- segment gapの位置と長さ

### Resource / platform cost

- 電池消費 / 時間
- foreground service notificationの持続
- memory / process restart
- permission prompt回数
- battery optimization設定への依存
- OEM固有の追加設定

### UX

- 探索開始からポケットへしまうまでの時間
- 記録状態を確認した回数と理由
- marker入力時間
- notification文言の理解
- 終了忘れ
- white blank PersonalMapを見て経路を認識できるか

## Product targets

これは既知の性能値ではなく、初期の意思決定目標である。

- 30分探索で地図を壊す長い欠落がない
- 異常ジャンプが派生経路に残らない
- 通常歩行の形状を見返して認識できる
- 1時間利用で現実的な電池消費に収まる
- 開始からポケットへしまうまで迷わない
- notification / active contextからsessionを復元できる
- duplicate callbackでraw evidenceが二重化しない

## Comparison discipline

既存loggerとの比較では、単にdistance数値を合わせるのではなく次を分ける。

- platform callbackの取得能力
- filter / simplificationの違い
- basemapが形状認識を助けている影響
- 本製品固有のPersonalMap / segment / marker価値

既存loggerが同じ体験を十分満たす場合は、独自実装を正当化しない。

## Stop / narrow conditions

### Narrow

- OEM設定案内が必要だが、一度設定すれば安定する
- foreground-only fallbackなら短時間用途に成立する
- samplingを下げればbatteryと経路認識性を両立できる

### Stop / redesign

- OS終了や画面OFFで頻繁に記録が途切れる
- 権限説明を理解しても継続利用が困難
- 電池負荷が一回の探索でも許容されない
- 白紙地図が既存GPSログ以上の価値を生まない
- active context復元が端末差で信頼できない
- 安定化に常時画面ONや頻繁なユーザー操作が必要

## Required record

各試験結果に次を残す。

- device / Android version / OEM
- app commit / Expo SDK / native build id
- permission状態
- battery optimization状態
- sampling設定
- start / end / process events
- raw diagnostic summary
- derived map screenshot
- user observation
- Go / Narrow / Stopへの影響
