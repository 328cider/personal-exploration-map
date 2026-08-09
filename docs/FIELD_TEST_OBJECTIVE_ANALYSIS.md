# Field-test客観S0解析

更新日: 2026-08-09
対象: Issue #77 / Issue #3

## 目的

実探索後にUSBで回収したField-test bundleから、端末・時刻・電池・権限・位置サンプル・欠落・provider lifecycle・エラーを毎回手作業で読み取らず、S0の客観的な技術状態を一定の規則で整理する。

この解析は、製品のGo / Narrow / Stopを自動決定しない。次は端末から判断できないため、`docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md`で人が評価する。

- ポケット内で探索を邪魔しなかったか
- 地図から実際の経路を思い出せたか
- 表示を確定した道路・敷地・部屋と誤解しなかったか
- Google Maps Timelineや一般GPS loggerとの差を感じたか
- また続きを探索したいか

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
.\scripts\collect-and-analyze-field-test.ps1
```

このコマンドは順番に次を行う。

1. Field-testアプリを停止する
2. `run-as`でapp-private dataをbinary-safe tarとして回収する
3. system / battery / permission情報を回収する
4. checksumsとローカルZIPを生成する
5. Field-testアプリを再起動する
6. Docker内で最新bundleを解析する
7. Markdown / JSONの客観S0レポートを生成する

複数のAndroid端末が接続されている場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -Serial <adb-device-serial>
```

解析結果がFAILでもPowerShell例外にせず、レポートだけ確認する場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -NoFailExit
```

回収後にアプリを再起動しない場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -DoNotRestartApp
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
.\scripts\analyze-latest-field-test.ps1
```

既定では`artifacts\device-bundles`配下にある最新の`pem-field-test-*`ディレクトリを選ぶ。

明示的なbundleを指定する場合:

```powershell
.\scripts\analyze-latest-field-test.ps1 `
  -BundlePath "artifacts\device-bundles\pem-field-test-20260809T123456Z"
```

`coordinate-free-diagnostics.txt`自体を指定することもできる。

```powershell
.\scripts\analyze-latest-field-test.ps1 `
  -BundlePath "artifacts\device-bundles\pem-field-test-20260809T123456Z\coordinate-free-diagnostics.txt"
```

別の出力先を使う場合:

```powershell
.\scripts\analyze-latest-field-test.ps1 `
  -OutputDirectory "artifacts\field-test-analysis\latest"
```

S0固有のbackground復帰・marker条件を外し、一般的なsessionとして解析する場合:

```powershell
.\scripts\analyze-latest-field-test.ps1 -Mode generic
```

## 終了状態

### PASS

定義済みの客観S0条件にblocking failureも警告もない。

PASSでも次は未判定である。

- 実際の地図認識性
- 身体的・認知的負担
- 安全性
- Timelineとの差別化
- 製品Go / Narrow / Stop

### WARN

実行自体は成立しているが、次のような条件を確認する必要がある。

- 30秒または60秒以上のsample gap
- acceptance rate低下
- battery saver
- battery optimization対象
- battery / thermal値を端末が提供しない
- S0想定時間からの逸脱

警告理由と主観レビューを合わせ、S1へ進むか判断する。

### FAIL

次のようなblocking evidenceがある。

- required environment snapshotなし
- 必要な位置・通知権限なし
- rawまたはaccepted sampleが0
- callbackの未計上またはfailed batch
- operational error
- 120秒以上のsample gap
- provider / environment lifecycle欠落
- background復帰またはS0 marker欠落
- checksum不一致
- Field-test package / manifest / privacy境界の不整合

FAIL時もMarkdown / JSONは生成される。**同じ条件を再度歩かず、bundleを保持したままコード・エミュレータへ戻す。**

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
- sample / accuracy / gap / callback集計
- lifecycle
- marker完了数
- operational error
- Pass / Warn / Fail理由

出力へ含めないもの:

- 正確な座標または軌跡
- PersonalMap / ExplorationSession ID
- 地図名
- marker本文
- 地図画像

入力に禁止された座標系fieldが混入した場合、解析はFAILになるが、その値をMarkdown / JSONへ投影しない。

解析器もUSB collectorも自動uploadを行わない。raw ZIPは引き続きPCローカルに保持する。

## 判定規則の扱い

初期S0規則は、最初の実機dataを得る前に異常を見逃さないため保守的に設定している。実機S0後に、結果を都合よく通すためではなく、観測された端末挙動と製品要件を根拠に閾値を更新する。

次を混同しない。

```text
objective S0 analyzer
  = 記録・環境・integrityの自動技術ゲート

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
