# Android Development Build

- Status: Reproducible build path
- Scope: Expo development/debug APK for background-location and renderer validation

## Why a development build

Expo Goでは、app固有のbackground location task、Android foreground service、SQLite migration、native renderer dependencyを製品と同じ条件で検証できない。

このリポジトリでは、実機検証を次の2段階へ分ける。

1. **Native assembly** — lockfile、Expo prebuild、Gradle、native modulesがAPKへ統合できるか
2. **Real-device behavior** — 権限、画面OFF、notification、OEM停止、battery、renderer frame stability

APKが生成できても、2の成功を意味しない。

## Prerequisites on Windows

- Node.js 22.13以上
- npm（root `package-lock.json`を使う）
- JDK 17
- Android Studio / Android SDK
- `ANDROID_HOME`またはAndroid Studioが認識するSDK
- USB debuggingを有効にしたAndroid端末、またはemulator

確認例:

```powershell
node --version
npm --version
java -version
adb --version
```

## Clean dependency install

repository rootで実行する。

```powershell
npm ci --no-audit --no-fund
npm run typecheck:mobile
npm run test:renderer --workspace @exploration-map/mobile
npm run benchmark:renderer --workspace @exploration-map/mobile
```

`npm install`でlockfileを暗黙更新せず、通常検証は`npm ci`を使う。

## Generate Android native project

```powershell
Set-Location .\apps\mobile
$env:CI = "1"
npx expo prebuild --platform android --clean
```

`apps/mobile/android`はgenerated outputであり、canonical architectureではない。Expo config、package dependencies、application codeから再生成する。

## Assemble debug APK

```powershell
Set-Location .\android
.\gradlew.bat :app:assembleDebug --no-daemon --stacktrace
```

APK:

```text
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## Install on a device

```powershell
adb devices
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

既存DB migrationを確認する場合は`-r`でデータを保持する。完全な初期状態を確認する場合だけ、意図してアプリデータを削除またはuninstallする。

## CI workflow

`.github/workflows/android-development-build.yml`は次の場合だけ実行する。

- manual `workflow_dispatch`
- app config、mobile dependency、lockfile、renderer、workflow自体を変更したPR

通常のdocumentationやmapping-coreだけのPRでは走らせない。Actionsコストを抑えつつ、native dependency変更を静的typecheckだけでマージしないための範囲である。

CI:

1. `npm ci`
2. Expo Android prebuild
3. JDK 17 / Gradle `:app:assembleDebug`
4. debug APK artifactを7日保持

## SVG renderer validation

Issue #19では、APKを端末へ入れて次を確認する。

- application launch
- demo PersonalMapの表示
- multi-session start / endが別々に見える
- session間に人工線がない
- low-confidence strokeが区別できる
- marker glyphが欠けない
- 1k / 5k / 10k fixtureのReview表示
- 画面遷移・再layoutでcrashしない
- obvious jank / memory pressure

CPU benchmarkだけでrendererを合格にしない。

## Background GNSS validation

Issue #3では [`experiments/templates/background-gnss-run.md`](experiments/templates/background-gnss-run.md) をrunごとに複製する。

- foreground / background
- 画面OFF / pocket
- notification return
- process recreation
- permission change
- battery saver / OEM condition
- battery start / end
- in-app development diagnostics

正確な位置や識別可能なmap screenshotをpublic Issueへ貼らず、count、gap、error、Go / Narrow / Stop判断を共有する。

## Failure classification

### Dependency / lockfile

- `npm ci`失敗
- Expo compatibility不一致
- native packageがlockfileへない

→ dependency versionとlockfileを修正する。generated Android codeを手編集して回避しない。

### Expo prebuild

- config plugin失敗
- Android package / permission生成失敗

→ `app.json`とofficial plugin configを修正する。

### Gradle / native compile

- JDK / SDK / compileSdk
- autolinking
- Kotlin / CMake / NDK

→ exact logとtoolchain versionをIssueへ残す。

### Device-only

- permission UX
- background停止
- renderer glyph / jank
- OEM battery restriction

→ APK assemblyとは分離し、Issue #3 / #19の実機evidenceとして扱う。
