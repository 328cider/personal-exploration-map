# Android実機S0 再実施手順 — 初回bundleレビュー後

- Status: active handoff
- Date: 2026-08-10
- Related: #3, #114, #116, PR #115, PR #117

## 初回bundleの結論

2026-08-10に回収した最初の実機bundleは、製品またはruntimeのFAILではなく、**INCONCLUSIVE（単一sessionのS0手順が未完了）**として扱う。

bundleには2つの短いExplorationSessionが含まれていた。

- session 1は約74.6秒で、provider start/stop、raw/persisted/accepted 8、短いbackground→active遷移を記録したが、marker完了がなかった
- session 2は約29.2秒で、raw/persisted/accepted 7、marker完了1件を記録したが、background→active遷移がなかった
- permissionは開始・終了ともforeground/background locationとnotificationが許可されていた
- callback failed batchとoperational errorはなかった
- 両sessionとも5〜10分S0を満たさなかった

必要な操作を複数sessionから合成してPASSにはしない。一方、最新sessionだけを見て`background_recovery_missing`を製品FAILとする旧解析も誤りだった。PR #115で`INCONCLUSIVE`を追加し、sessionごとの評価、明示selection、hard failure優先へ修正した。

## 初回bundleから支持されること

- Field-test packageを実機へinstall・起動できる
- foreground/background locationとnotification permissionを取得できる
- GNSS providerの開始・停止が完了する
- callbackで受信したsampleをSQLiteへ保存できる
-短いbackground→active遷移を記録できる
- markerを保存できる
- USB回収、checksum、Docker解析が完了する
- raw bundleはlocal-onlyで`autoUpload=false`

## まだ支持されないこと

- 5〜10分の単一session S0
- 5〜10分の画面OFF・ポケット内callback継続
- battery / thermal評価
- 実routeの認識性
- Timeline / GPS loggerとの差別化
- product Go / Narrow / Stop

また、両sessionで`Location.timestamp`由来のsample gapがsession durationを超えていた。cached/staleまたはsession-window外GNSS observationの可能性があるが、旧diagnosticsでは実callback受信間隔と区別できなかった。

## 次に使用するAPK

PR #117の最終headで次を同一artifactに対してgreenにした。

- mapping package tests / strict typecheck
- mobile static / Expo Doctor / mobile strict typecheck
- product / architecture / CI budget governance
-署名済み、Metro不要、USB-debuggable Field-test APK
- Android 15 cold start / background growth / marker / Review
- force-stop / relaunch persistence
- DB schema v4 exact raw payload / sample ordinal
- USB collectorとapp-private SQLite抽出
- diagnostics format 3 callback timing / observation freshness evidence

Artifact:

- workflow run: `31362969958`
- source head: `430d572b74fee4fec790ee17af0b91d955a59e78`
- merged runtime: `0acf606ec7fa469610ace09b237414af07a304df`
- APK artifact ID: `9053209638`
- APK artifact digest: `sha256:87eafead71ace2bcd0ff6a7fd23b364c854948d1de4290614e0009e2f3ea437c`
- APK SHA-256: `a0cf72d334c2f0f92bbf16160b97872ded745c8eee256ebacaebfd0c1e378366`
- emulator / USB evidence artifact ID: `9053331886`
- evidence digest: `sha256:1c9421631b7192b1dfe30fee63c2b632690b9929511a7c154585d3b5da946247`

既存の`探索マップ Field Test`をアンインストールせず、同じpackageへ上書きinstallする。アンインストールすると既存のlocal mapと初回bundleの元DBを端末から失う可能性がある。

## S0条件

最初の判定可能なS0は、**一つのExplorationSessionで全操作を完了**する。

- target: 5〜10分
- minimum interpretable duration: 4分
- battery saver: OFF
- app battery setting: 可能なら`制限なし`
- location: ON
- foreground / background location: 許可
- notification: 許可
-安全でよく知っている経路
- 最低2回は曲がる
- 歩行中に画面を見ない

## 単一session手順

1. 新しいAPKを上書きinstallする。
2. `探索マップ Field Test`を起動する。
3. `新しい地図を探索する`を押す。
4. `探索を記録中`通知が出たことを確認する。
5. 画面を消し、普段どおりポケットへ入れる。
6. そのまま4分以上、target 5〜10分の範囲で歩く。
7. 同じ探索を終了せず、安全に停止してアプリをforegroundへ戻す。
8. live mapまたは位置sample数が開始時より増えていることを確認する。
9. `＋ 発見を記録`を開き、defaultの`気になる`を1件保存する。
10. 必要なら同じsessionのまま再び画面を消し、短く歩く。
11. 安全に停止して`探索を終了して地図を見る`を押す。
12. Reviewで`不確実性 / 通過セル / 軌跡`を切り替える。
13. アプリをforce-stopまたは終了し、再起動する。
14. PersonalMapとmarkerが残っていることを確認する。
15. 同じsessionをもう一度開始しない。帰宅後にUSB回収する。

重要:

- markerを保存するために別の探索を開始しない
- background確認後に探索を終了し、marker用の新規探索を作らない
-表示方式ごとに歩き直さない
- 途中でblocking errorが出た場合は同条件を繰り返さず、可能ならそのbundleを回収する

## 帰宅後の回収

リポジトリ直下で次を実行する。

```powershell
git switch main
git pull --ff-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\collect-and-analyze-field-test.ps1"
```

`ExecutionPolicy Bypass`はこの子プロセスだけに適用し、PC全体の設定を変更しない。

新しいcoordinate-free diagnosticsでは次が追加される。

- diagnostics format / report version 3
- callback delivery gap distribution
- callback時点のoldest / newest observation age
- future / timestamp missing batch count
- session開始前sample件数と最大先行時間
- session終了後sample件数と最大遅延時間

これにより、Android callbackが止まったのか、callbackは届いたがcached/stale GNSS fixが混じったのかを分離する。

## 共有可能なファイル

通常のprivate ChatGPT project内で共有してよいもの:

- `coordinate-free-diagnostics.txt`
- `analysis\objective-s0-report.md`
- `analysis\objective-s0-report.json`
- 主観レビュー回答

共有しないもの:

- `pem-field-test-*.zip`
- `app-private-data.tar`
- SQLite / WAL
- raw位置履歴

## 判定

### PASS / WARN

単一sessionでduration、background→active、marker、permission、sample、callback、lifecycle、integrityを満たす。WARNはcallback gap、battery optimization、GNSS freshness等の確認事項を含む。

### INCONCLUSIVE

duration不足、background→active不足、marker不足など、手順材料が足りない。製品FAILとは扱わず、不足手順を一つのsessionで満たして再実施できる。

### FAIL

permission不足、sample 0、callback persistence failure、operational error、integrity/privacy failure、critical thermal等。bundleを保持し、同じ条件を歩き直さず開発へ戻す。

## stale GNSS policy

この再実施では、format 3 evidenceを集める。cached/stale sampleをcanonical raw evidenceから削除しない。

session開始前sampleをderived routeから除外するthresholdは、初回の短いsplit-session bundleだけから決めない。callback delivery gap、observation age、before-start/after-end offsetを確認した後、Issue #116でmap policyを決定する。
