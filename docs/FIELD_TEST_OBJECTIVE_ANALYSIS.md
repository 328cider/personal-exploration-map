# Field-test客観解析

更新日: 2026-08-10
対象: Issue #77 / Issue #3 / Issue #114 / Issue #119

## 目的

実探索後にUSBで回収したField-test bundleから、端末・時刻・電池・権限・位置サンプル・欠落・provider lifecycle・エラーを毎回手作業で読み取らず、客観的な技術状態を一定の規則で整理する。

この解析は、製品のGo / Narrow / Stopを自動決定しない。次は端末から判断できないため、`docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md`で人が評価する。

- ポケット内で探索を邪魔しなかったか
- 地図から実際の経路を思い出せたか
- 表示を確定した道路・敷地・部屋と誤解しなかったか
- Google Maps Timelineや一般GPS loggerとの差を感じたか
- また続きを探索したいか

## Evidence unit

S0の証拠単位は**一つのExplorationSession**である。

- 5〜10分の継続時間
- background遷移とactive復帰
- marker 1件完了
- provider start / stop
- raw sample、callback、permission、environment snapshot

を同一session内で確認する。複数sessionの「片方にbackground、もう片方にmarker」が存在しても、一つのS0として合成しない。

bundleに複数sessionがある場合、既定では最新sessionを表示するが、reportへ`evaluatedExplorationIndex`とselection reasonを記録する。過去sessionを明示的に確認する場合は`-ExplorationIndex`を使う。

## 前提

- Docker Desktopが起動している
- リポジトリの最新`main`を取得している
- USBデバッグを有効にしたField-test端末がPCから承認済み

WindowsへNode.js、npm、JDK、Android SDK、Android Studioを導入しない。ADBが無い場合はUSB collectorがGoogle公式Platform Toolsをリポジトリ内`.local`へ取得し、解析用Node.jsは既存Docker image内で実行する。

## 回収から解析まで1コマンド — 推奨

リポジトリ直下のWindows PowerShellで実行する。

```powershell
git switch main
git pull --ff-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\collect-and-analyze-field-test.ps1"
```

`ExecutionPolicy Bypass`はこの子プロセスだけに適用し、PC全体のPowerShell設定を変更しない。

このコマンドは順番に次を行う。

1. Field-testアプリを停止する
2. `run-as`でapp-private dataをbinary-safe tarとして回収する
3. system / battery / permission情報を回収する
4. checksumsとローカルZIPを生成する
5. Field-testアプリを再起動する
6. Docker内で最新bundleを解析する
7. Markdown / JSONの客観レポートを生成する

複数のAndroid端末が接続されている場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\collect-and-analyze-field-test.ps1" -Serial <adb-device-serial>
```

解析結果がFAILでもPowerShell例外にせず、レポートだけ確認する場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\collect-and-analyze-field-test.ps1" -NoFailExit
```

回収後にアプリを再起動しない場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\collect-and-analyze-field-test.ps1" -DoNotRestartApp
```

既定の生成物:

```text
artifacts\device-bundles\
├─ pem-field-test-<UTC日時>\
│  ├─ coordinate-free-diagnostics.txt
│  ├─ manifest.json
│  ├─ SHA256SUMS.txt
│  ├─ app\app-private-data.tar
│  ├─ system\...
│  └─ analysis\
│     ├─ objective-s0-report.md
│     └─ objective-s0-report.json
└─ pem-field-test-<UTC日時>.zip
```

## 既に回収済みのbundleだけを解析する

Field-test bundleが既にある場合は、USB回収を繰り返さず解析だけを実行する。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\analyze-latest-field-test.ps1"
```

明示的なbundleを指定する場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\analyze-latest-field-test.ps1" `
  -BundlePath "artifacts\device-bundles\pem-field-test-20260809T123456Z"
```

bundle内の特定sessionを後から評価する場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\analyze-latest-field-test.ps1" `
  -BundlePath "artifacts\device-bundles\pem-field-test-20260809T123456Z" `
  -ExplorationIndex 1
```

S0固有のbackground復帰・marker・継続時間条件を外し、一般的な長時間sessionとして解析する場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\analyze-latest-field-test.ps1" `
  -Mode generic
```

## 終了状態

### PASS

定義済みの客観条件にblocking failureも警告もない。

PASSでも次は未判定である。

- 実際の地図認識性
- 身体的・認知的負担
- 安全性
- Timelineとの差別化
- 製品Go / Narrow / Stop

### WARN

試験とcanonical evidence保存は成立しているが、確認が必要な条件がある。

例:

- 30秒または60秒以上のcallback delivery gap
- generic modeで確認された遅延一括配送
- live map / marker位置の鮮度低下
- acceptance rate低下
- battery saver
- battery optimization対象
- battery / thermal値を端末が提供しない
- 5〜10分のtargetから軽度に外れる
- cached / stale observation timestampの疑い

警告理由と主観レビューを合わせ、次の試験または開発へ進む条件を判断する。

### INCONCLUSIVE

製品またはruntimeのFAILではなく、**一つのsessionでS0手順を評価する材料が不足**している。

例:

- sessionが4分未満
- background遷移とactive復帰の片方または両方がない
- marker完了がない
- 複数sessionに必要な操作が分散している
- 評価対象sessionを明示できない

INCONCLUSIVEではraw bundleを保持し、不足した手順を一つの継続sessionで満たして再実施してよい。複数sessionの証拠を合成してPASSにしない。

### FAIL

blocking evidenceがある。

- required environment snapshotなし
- 必要な位置・通知権限なし
- rawまたはaccepted sampleが0
- callback sampleの未計上
- failed callback batch
- operational error
- S0のblocking callback gap
- generic modeでもcatch-up deliveryを裏付けられない120秒超callback gap
- observation stream自体のoutage
- provider / environment lifecycle欠落
- critical thermal
- checksum不一致
- Field-test package / manifest / privacy境界の不整合

FAIL時もMarkdown / JSONは生成される。**同じ条件を再度歩かず、bundleを保持したままコード・エミュレータへ戻す。**

protocol不足とhard failureが同時にある場合はFAILを優先する。

## Observation gapとcallback gap

次を区別する。

```text
observation timestamp gap
  = Location.timestamp同士の差
  = post-hoc routeを再生成できる観測列の連続性
  = cached / stale fixやsession外timestampの影響を受ける

callback delivery gap
  = callback.received eventの実受信時刻同士の差
  = live map / marker位置の鮮度とbackground deliveryの指標
```

observation gapがsession durationを超えても、それだけでcallback停止とは判定しない。cached / staleまたはsession-window外sampleの疑いとしてWARNにし、raw evidenceは削除しない。

診断format 3ではcallback gapに加え、callback到着時のoldest / newest observation age、largest batch、session開始前・終了後sample件数を出す。古いbundleにcallback gapがない場合はsample gapを補助的に読むが、時刻整合性が疑わしい場合はhard outageへ昇格させない。

## Generic modeの遅延一括配送

120秒以上のcallback gapを一律にraw-data lossと扱わない。`generic` modeでは、次を**すべて**満たした時だけ、hard FAILの`callback_gap_120s`を次のWARNへ置換する。

```text
callback_delivery_batched
live_freshness_degraded
```

必要条件:

1. received sampleが`persisted + duplicate`で完全にaccounted
2. failed callback batchが0
3. operational errorなし
4. observation gapが30秒未満で連続
5. largest callback batchが2件以上
6. oldest-observation age最大値がcallback gap最大値と概ね整合
7. future observation batchが0
8. observation timestamp欠損batchが0

意味:

- `callback_delivery_batched`: OS/providerが観測を一時的にbufferし、後からまとめて配送した証拠
- `live_freshness_degraded`: 遅延中のlive mapとmarker attachmentは古かった可能性

この分類は、保存できていないsampleや実観測outageをWARNへ弱めない。条件のどれかを満たさない場合、120秒超callback gapはFAILのままである。

### S0 mode

短いwalking-only S0では、live freshness自体が製品要件である。そのため、catch-up deliveryが後から全件保存していても、120秒超callback gapを自動的にWARNへ下げない。S0では`callback_gap_120s`をFAILとして維持する。

## 解析する情報

### 読むもの

- `coordinate-free-diagnostics.txt`
- `manifest.json`
- `SHA256SUMS.txt`
- checksum検証対象ファイルのbytes

### 読まないもの

- raw SQLiteのテーブル内容
- `app-private-data.tar`内の位置履歴
- 緯度経度
- local座標
- 地図名・地図ID
- marker本文
- 地図画像

`app-private-data.tar`等はchecksum検証のためbytesをhashするが、中身を解析しない。

## 出力のプライバシー境界

出力へ含めるもの:

- 端末・Android・アプリbuild
- session開始・終了・経過時間
- battery / power / thermal / permission
- sample / accuracy / observation gap / callback gap集計
- callback largest batch
- callback oldest / newest observation age distribution
- future / missing observation timestamp batch count
- session-window外sampleの件数と最大ずれ
- lifecycle
- marker完了数
- operational error
- sessionごとのobjective status
- evaluated exploration indexとselection reason
- PASS / WARN / INCONCLUSIVE / FAIL理由

出力へ含めないもの:

- 正確な座標または軌跡
- PersonalMap / ExplorationSession ID
- 地図名
- marker本文
- 地図画像

入力に禁止された座標系fieldが混入した場合、解析はFAILになるが、その値をMarkdown / JSONへ投影しない。

解析器もUSB collectorも自動uploadを行わない。raw ZIPは引き続きPCローカルに保持する。

## 判定規則の扱い

初期S0規則は、最初の実機dataを得る前に異常を見逃さないため保守的に設定していた。実機証拠を得た後、次の区別を追加した。

- protocol不完了と製品FAIL
- evidenceの単一session単位
- observation gapとcallback gap
- raw observation lossと遅延一括配送
- post-hoc completenessとlive freshness

これは結果を都合よくPASSへ変更するものではない。generic modeのbuffered deliveryもWARNであり、live freshness低下を明示する。S0のlive-freshness gateは維持する。

次を混同しない。

```text
objective analyzer
  = 記録・環境・integrity・protocol completenessの自動技術ゲート

Issue #3 Go / Narrow / Stop
  = 実GNSS、電池、端末差、地図認識性を含む製品技術判断

Issue #4 UX判定
  = Passive-first、価値、差別化、継続意向の人間評価
```

## 実装境界

- Node.js標準ライブラリだけを使用する
- raw map truthやSQLiteを変更しない
- canonical mapping packageへ依存しない
- analysis結果をPersonalMapへ書き戻さない
- cloud、telemetry、外部APIを使用しない
- FAIL時に再歩行を要求しない
- INCONCLUSIVE時だけ、欠けたprotocolを一つのsessionで再実施できる
