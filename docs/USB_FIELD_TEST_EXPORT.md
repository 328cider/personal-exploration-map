# Android Field-test USB診断回収

更新日: 2026-08-09

## 目的

実地試験後に端末・時刻・電池・権限・位置記録の集計を手入力しない。Android端末をUSB接続し、PowerShellを1回実行して、ローカルbundleの回収と客観S0解析まで行う。

この経路は`探索マップ Field Test`専用である。通常版packageはdebuggableにしない。

## 推奨コマンド

repository rootのWindows PowerShellで実行する。

```powershell
git switch main
git pull --ff-only
.\scripts\collect-and-analyze-field-test.ps1
```

この1コマンドが次を行う。

1. authorized Android deviceを確認
2. Field-testアプリをforce-stop
3. `run-as`でapp-private dataをbinary-safe tarとして回収
4. system、battery、permission evidenceを回収
5. manifest、checksums、raw local ZIPを生成
6. Field-testアプリを再起動
7. Docker内でcoordinate-free objective S0 analyzerを実行
8. PASS / WARN / FAILのMarkdown / JSONを生成

複数端末が接続されている場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -Serial <adb-device-serial>
```

FAILでもPowerShell例外にせずレポートだけ確認する場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -NoFailExit
```

回収後にアプリを再起動しない場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -DoNotRestartApp
```

## 前提

- Windows PowerShell 5.1以上
- Docker Desktopが起動済み
- Android端末で開発者向けオプションとUSB debuggingをON
- USB接続時に端末側でこのPCを許可
- USB抽出対応の最新Field-test APKをインストール
- package `com.cider328.personalexplorationmap.fieldtest`

WindowsへNode.js、npm、JDK、Android SDK、Android Studioを入れる必要はない。

`adb`がPATHにない場合、collectorはGoogle公式Windows Platform Tools ZIPをrepoの`.local/android-platform-tools`へ取得する。システム全体にはインストールしない。

## 自動記録される情報

探索開始時と終了要求時に、次をoperational diagnosticsとしてSQLiteへ保存する。

- wall-clock時刻とAndroid elapsed realtime
- manufacturer、brand、model、Android version、SDK、build ID
- build fingerprintのSHA-256
- app package、version、debuggable状態
- timezone、locale
- battery level、status、充電方式、温度、電圧、current、charge counter（端末が提供する範囲）
- power saver
- battery optimization対象か
- thermal status
- fine / coarse / background location permission
- notification permission

これらはmap truthではない。raw位置、accepted / rejected、PersonalMap、ExplorationSessionの判断には使用しない。

## USBで回収するもの

- app-private dataのtar archive
  - SQLite DB
  - SQLite WAL / SHM
  - shared preferences
  - files / no_backup / cache等
- `getprop`
- `dumpsys battery`
- package別`dumpsys batterystats --charged`
- batterystats history
- power / deviceidle / thermalservice
- package permission / appops
- hostとdeviceの回収時刻
- SHA-256一覧

bundleは自動uploadしない。

## 生成物

```text
artifacts\device-bundles\
├─ pem-field-test-YYYYMMDDTHHMMSSZ\
│  ├─ coordinate-free-diagnostics.txt
│  ├─ manifest.json
│  ├─ SHA256SUMS.txt
│  ├─ app\app-private-data.tar
│  ├─ system\...
│  └─ analysis\
│     ├─ objective-s0-report.md
│     └─ objective-s0-report.json
└─ pem-field-test-YYYYMMDDTHHMMSSZ.zip
```

## 客観S0解析

Analyzerは次を一定の規則で確認する。

- checksum / manifest integrity
- Field-test package、`containsRawLocation=true`、`autoUpload=false`
- start / end environment snapshot
- location / notification permission
- raw / accepted sample
- callback received / persisted / duplicate / failed
- provider / environment lifecycle
- background / active復帰
- S0 marker完了
- 30 / 60 / 120秒以上のgap
- battery saver / optimization / thermal
- operational error

### PASS

定義済みの客観条件にblocking failureも警告もない。

### WARN

実行は成立したが、gap、acceptance rate、省電力、battery / thermal欠測、S0時間などに確認事項がある。

### FAIL

sample、permission、lifecycle、marker、integrityまたはoperational errorにblocking evidenceがある。

FAILでもレポートは生成される。同じ経路を歩き直さず、bundleを保持したままコード・エミュレータへ戻す。

Analyzerは製品Go / Narrow / Stop、地図認識性、ポケットUX、Timelineとの差別化を自動判定しない。

## 既に回収済みのbundleだけを再解析する

```powershell
.\scripts\analyze-latest-field-test.ps1
```

明示的なbundle:

```powershell
.\scripts\analyze-latest-field-test.ps1 `
  -BundlePath "artifacts\device-bundles\pem-field-test-YYYYMMDDTHHMMSSZ"
```

詳細は`docs/FIELD_TEST_OBJECTIVE_ANALYSIS.md`を参照する。

## 回収だけを行う低レベルコマンド

解析せずUSB回収だけを行う必要がある場合:

```powershell
.\scripts\pull-field-test-bundle.ps1 -RestartApp
```

通常は一括コマンドを使う。低レベルcollectorは、Dockerが利用できない時の緊急回収や、解析器自体を修正している場合に限る。

## 重要なプライバシー境界

USB bundleとZIPにはraw位置情報、marker、アプリ内部DBが含まれる。

- public GitHub Issueへ添付しない
- 通常のチャットへ無条件にアップロードしない
- PCローカルで保管する
- 詳細解析が必要な時だけprivateな経路で共有する
- 通常はcoordinate-free diagnosticsとobjective reportを先に使う

Coordinate-free outputsへ含めないもの:

- 緯度経度・local座標
- PersonalMap / ExplorationSession ID
- 地図名
- marker本文
- 地図画像

Objective analyzerはsummary、manifest、checksumsを読み、raw SQLite / tar内の位置履歴を意味解析しない。raw fileはintegrity確認のためhashするだけである。禁止fieldがsummaryへ混入しても、その値をreportへ投影しない。

## scriptが行う安全処理

- 接続済みauthorized deviceを確認
- 複数端末時は明示的なserialを要求
- Field-test packageを内部固定
- `run-as`でField-test packageがdebuggableであることを確認
- appをforce-stopしてDB / WALの書き込み競合を避ける
- binary stdoutをPowerShellのtext pipelineへ通さず、BaseStreamでtarへ保存
- device serialはmanifestへ平文保存せずSHA-256化
- 全ファイルのSHA-256を作成
- outputをrepository-localのignored pathへ制限
- raw bundleを自動送信しない
- objective reportをPersonalMapへ書き戻さない

## よくあるエラー

### `No authorized Android device found`

- USB debuggingをONにする
- USB用途をデータ転送へ変更する
- 端末に表示されたRSA許可を承認する
- 別のUSBケーブルを試す

### `run-as failed`

通常版または古いField-test APKが入っている可能性がある。USB抽出対応版を上書きインストールする。アンインストールは端末内データ消失の可能性があるため避ける。

### 複数端末が見つかる

`-Serial`を指定する。

### Dockerが見つからない

Docker Desktopを起動する。回収だけを先に行う必要がある場合は`pull-field-test-bundle.ps1 -RestartApp`を使い、解析は後で実行する。

### objective statusがFAIL

同じ条件を再度歩かない。生成済みbundleと`analysis\objective-s0-report.md`を保持し、code / emulatorへ戻す。

## 実機試験で残る手入力

自動化後も、次の主観評価だけは人が記録する。

- ポケット内で邪魔だったか
- 記録中を信頼できたか
- 発見入力が負担だったか
- 三表示から実際のrouteを思い出せたか
- 不確実性 / 通過セルを確定境界と誤解しなかったか
- Timeline / GPS loggerとの差を感じたか
- また続きを探索したいか

`docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md`を使用する。端末、Android、時刻、電池、権限、sample集計は手入力しない。
