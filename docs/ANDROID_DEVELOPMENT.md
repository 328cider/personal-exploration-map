# Android Development Build

- Target: Expo SDK 57 / React Native 0.86.2
- Validated Node: 22.23.2
- Validated npm: 10.9.8
- Java: 17
- App id: `com.cider328.personalexplorationmap`

この文書は、M0のバックグラウンドGNSSをAndroid実機で検証するための再現可能な手順である。Expo Goはバックグラウンドlocation taskとapp固有のnative設定を十分に再現しないため、検証経路に使用しない。

## 1. Windows prerequisites

次をインストールする。

- Git
- Node.js 22.23.2または`.nvmrc`を読めるNode version manager
- npm 10.9.8
- JDK 17
- Android Studio
- Android SDK Platform、Build Tools、Platform Tools
- USB接続する場合は端末メーカーのdriver

環境確認:

```powershell
node --version
npm --version
java -version
adb version
```

期待値:

```text
node v22.23.2
npm 10.9.8
Java 17
adb command available
```

Node 22の別patchでも動く可能性はあるが、問題切り分け時は`.nvmrc`のversionへ合わせる。

## 2. Repository setup

PowerShellでrepository rootへ移動する。

```powershell
cd C:\Users\mitsu\DevApps\personal-exploration-map
git switch main
git pull --ff-only
npm ci
npm run mobile:check
```

`npm ci`はcommitted `package-lock.json`を変更せず、同じdependency graphを再現する。通常のsetupで`npm install`へ置き換えない。dependency変更を意図するPRだけがlockfileを更新する。

`npm run mobile:check`は次を実行する。

- product governance
- architecture boundary
- mobile canonical-write boundary
- mapping / SQLite tests
- strict TypeScript checks
- Expo dependency compatibility
- Expo Doctor

## 3. Prepare the Android device

Android端末で次を有効にする。

1. 開発者向けオプション
2. USBデバッグ
3. PCからのUSBデバッグ許可

接続確認:

```powershell
adb devices
```

端末が`unauthorized`の場合は、端末側の確認dialogを許可して再実行する。

Wi-Fi debuggingを利用する場合も、最初のM0 runではUSB接続を推奨する。Metro接続とinstall失敗を位置記録の問題から分離しやすいためである。

## 4. Build, install, and start Metro

最短経路:

```powershell
npm run mobile:android
```

これはExpoのapp-specific Android projectを生成・buildし、接続端末へdevelopment appをinstallしてMetroを開始する。

native projectを明示的に作り直す場合:

```powershell
npm run mobile:prebuild:android
cd apps\mobile\android
.\gradlew.bat :app:installDebug
cd ..\..\..
npm run mobile:start
```

Metroへ接続できない場合:

```powershell
adb reverse tcp:8081 tcp:8081
npm run mobile:start
```

端末上で`探索マップ`を開く。Expo Goではなく、package id `com.cider328.personalexplorationmap`のdevelopment appを使用する。

## 5. Install an APK built by GitHub Actions

GitHubのActionsから`android-development-build`を手動実行できる。

1. GitHub repositoryの`Actions`を開く
2. `android-development-build`を選ぶ
3. `Run workflow`で対象branchを選ぶ
4. 成功後、artifact `personal-exploration-map-android-debug`をdownload
5. ZIPを展開

install:

```powershell
adb install -r .\app-debug.apk
```

このAPKもdevelopment buildなので、実行時はrepository rootでMetroを起動する。

```powershell
npm ci
npm run mobile:start
adb reverse tcp:8081 tcp:8081
```

Actions artifactにユーザーの位置履歴やsecretは含まれない。実機で記録したSQLiteは端末内に残る。

## 6. First smoke test

長時間runの前に、短い安全な場所で次を確認する。

- appが起動する
- foreground位置権限の説明とOS promptが表示される
- background位置権限が段階的に要求される
- `探索を始める`後にAndroid foreground-service notificationが表示される
- 画面を消して数分移動後、raw sample数が増える
- 発見markerを保存できる
- explorationを終了できる
- PersonalMap Reviewに経路とdevelopment diagnosticsが表示される
- 再起動後もPersonalMapが残る

短いsmoke testが失敗した場合、30〜60分runへ進まず、権限・notification・Metro・provider errorを先に記録する。

## 7. Issue #3 real-device run

各runは次を複製して記録する。

```text
docs/experiments/templates/background-gnss-run.md
```

推奨順序:

1. foreground、画面ON
2. background、画面OFF、ポケット
3. background、途中でmarker入力
4. notificationから復帰
5. app relaunch / process recreation
6. permission変更、battery saver、recents dismissal

正確な住所、raw coordinates、識別可能な地図画像をpublic Issueへ貼らない。Issue #3にはgap、accuracy、counts、battery、端末条件、Go / Narrow / Stop判断だけを残す。

## 8. Useful diagnostics

接続端末一覧:

```powershell
adb devices -l
```

app logを絞って確認:

```powershell
adb logcat | Select-String "personalexplorationmap|expo|Location|TaskManager"
```

package確認:

```powershell
adb shell pm list packages | Select-String "personalexplorationmap"
```

permission確認:

```powershell
adb shell dumpsys package com.cider328.personalexplorationmap
```

foreground service確認:

```powershell
adb shell dumpsys activity services | Select-String "personalexplorationmap|location"
```

これらのlogには端末固有情報が含まれる可能性があるため、共有前に内容を確認する。

## 9. Failure classification

問題を次の層へ分ける。

### Build / Metro

- npm / lockfile
- JDK / Android SDK
- Gradle
- Metro connection

### Platform adapter

- foreground / background permission
- TaskManager availability
- foreground service
- OEM battery restriction
- callback delivery

### Canonical mapping

- raw sample persistence
- accepted / rejected
- PersonalMap replay
- session recovery

### UX

- start-to-pocket clarity
- marker interruption time
- recording-state trust
- white-map recognizability

層を混ぜず、build failureをGNSS精度問題として扱わない。

## 10. Clean rebuild

lockfileを保持したままdependencyとnative outputを再構築する。

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\mobile\node_modules -ErrorAction SilentlyContinue
npm ci
npm run mobile:prebuild:android
npm run mobile:android
```

`package-lock.json`を削除して解決しない。lockfile自体に問題がある場合は、dependency変更PRとして原因とExpo Doctor結果を記録する。
