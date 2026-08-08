# Android Field-test USB診断回収

更新日: 2026-08-09

## 目的

実地試験後に端末・時刻・電池・権限・位置記録の集計を手入力しない。Android端末をUSB接続し、PowerShellを1回実行して、解析に必要なローカルbundleを回収する。

この経路は`探索マップ Field Test`専用である。通常版packageはdebuggableにしない。

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

これらはmap truthではない。raw位置、accepted/rejected、PersonalMap、ExplorationSessionの判断には使用しない。

Reviewの`座標なし集計を共有`にも、端末、時刻、開始・終了電池、消費ポイント、権限、省電力状態が自動で含まれる。

## USBで回収するもの

PowerShell scriptはアプリを一度force-stopし、整合した状態で次を回収する。

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

## 前提

- Windows PowerShell 5.1以上
- Android端末で開発者向けオプションとUSB debuggingをON
- USB接続時に端末側でこのPCを許可
- USB抽出対応の最新Field-test APKをインストール
- 通常版ではなくpackage `com.cider328.personalexplorationmap.fieldtest`

WindowsへNode、npm、JDK、Android SDK、Android Studioを入れる必要はない。

`adb`がPATHにない場合、scriptはGoogle公式のWindows platform-tools ZIPをrepoの`.local/android-platform-tools`へ取得する。システム全体にはインストールしない。

## 実行

repository rootで実行する。

```powershell
.\scripts\pull-field-test-bundle.ps1
```

複数端末が接続されている場合:

```powershell
.\scripts\pull-field-test-bundle.ps1 -Serial <adb-device-serial>
```

回収後にアプリを自動で再起動する場合:

```powershell
.\scripts\pull-field-test-bundle.ps1 -RestartApp
```

既定出力:

```text
artifacts/device-bundles/
  pem-field-test-YYYYMMDDTHHMMSSZ/
  pem-field-test-YYYYMMDDTHHMMSSZ.zip
```

## 重要なプライバシー境界

USB bundleにはraw位置情報、marker、アプリ内部DBが含まれる。

- public GitHub Issueへ添付しない
- チャットへ無条件にアップロードしない
- PCローカルで保管する
- 解析が必要な時だけprivateな経路で共有する
- 通常はアプリの`座標なし集計を共有`を先に使う

正確な住所、座標、地図画像を共有せずに判断できる場合は、raw bundleを共有しない。

## scriptが行う安全処理

- 接続済みauthorized deviceを確認
- 複数端末時は明示的なserialを要求
- `run-as`でField-test packageがdebuggableであることを確認
- appをforce-stopしてDB / WALの書き込み競合を避ける
- binary stdoutをPowerShellのtext pipelineへ通さず、BaseStreamでtarへ保存
- device serialはmanifestへ平文保存せずSHA-256化
- 全ファイルのSHA-256を作成
- raw bundleを自動送信しない

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

### bundle回収後にアプリが停止している

DB整合性のため既定では停止したままにする。手動で起動するか、次回は`-RestartApp`を付ける。

## 実機試験で残る手入力

自動化後も、次の主観評価だけは人が記録する。

- ポケット内で邪魔だったか
- 発見入力が負担だったか
- 三表示から実際のrouteを思い出せたか
- Timeline / GPS loggerとの差を感じたか
- 発熱が不快だったか

端末、Android、時刻、電池、権限、sample集計は手入力しない。
