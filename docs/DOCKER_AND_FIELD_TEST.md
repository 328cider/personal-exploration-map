# Docker development and Android field-test build

更新日: 2026-08-07

この文書は、WindowsホストへNode.js、npm、JDK、Android SDK、Android Studioを追加せずに開発・実機検証する推奨経路を定義する。

## 結論

通常の役割分担は次とする。

```text
Docker Desktop
  ├─ npm ci
  ├─ mapping / SQLite tests
  ├─ TypeScript / Expo checks
  └─ 必要時のMetro

GitHub Actions
  └─ Android Field-test APK build

Android実端末
  └─ 画面OFF・ポケット内・GNSS・通知・電池・UX検証
```

Android emulatorはDocker内で動かさない。Docker Desktop上でnested virtualization、画面、ADB、位置入力まで扱う複雑さに対して、M0で必要な実GNSS・OEM省電力・ポケットUXを検証できないためである。

## Windows側に必要なもの

- Docker Desktop
- Git（repositoryを取得・更新する場合）
- ブラウザ

Node.js、npm、JDK、Android SDK、Android Studioは必須ではない。

## Dockerで検査する

repository rootで実行する。

```powershell
docker compose build
docker compose run --rm check
```

`check`はコンテナ内で次を実行する。

```text
npm ci --no-audit --no-fund
npm run mobile:check
```

Node `22.23.2`とnpm `10.9.8`をDocker imageで固定する。`node_modules`、npm cache、Expo stateはnamed volumeへ置くため、Windowsのrepository folderへ`node_modules`を生成しない。

任意のcommandを実行する場合:

```powershell
docker compose run --rm shell
```

コンテナ内ではrepositoryが`/workspace`へmountされる。

volumeも含めて初期化する場合:

```powershell
docker compose down -v
```

これはDocker内のdependency cacheだけを削除し、source fileや端末内PersonalMapは削除しない。

## DockerでMetroを起動する（短い開発確認のみ）

Development APKを使う時だけMetroが必要になる。

```powershell
.\scripts\docker-metro.ps1
```

scriptは利用可能なLAN IPv4 addressを検出し、Dockerのport `8081`をWindowsへ公開する。自動検出が合わない場合:

```powershell
.\scripts\docker-metro.ps1 -HostAddress 192.168.1.20
```

条件:

- PCとAndroid端末を同じWi-Fiへ接続
- Windows Firewallで必要に応じてTCP 8081を許可
- Development appで表示されるMetro URLへ接続

MetroはUIや短い動作確認用であり、30〜60分の屋外runには使用しない。

## Metro不要Field-test APKを作る

GitHub repositoryで次を実行する。

1. `Actions`を開く
2. `devex-field-test`を選ぶ
3. `Run workflow`を押す
4. branchに`main`を選ぶ
5. workflow完了後、artifact `personal-exploration-map-field-test`をdownload
6. ZIPを展開し、`personal-exploration-map-field-test.apk`をAndroid端末へ渡す

Field-test APKは次の性質を持つ。

- React Nativeのrelease variantでJavaScript bundleをAPKへ内包
- Metro不要
- app名: `探索マップ Field Test`
- package id: `com.cider328.personalexplorationmap.fieldtest`
- 通常development appと並存可能
- 座標なしtracking diagnosticsを表示
- debug keystoreで署名した内部検証用APK
- Google Play提出用production artifactではない

workflowはAPK内に`assets/index.android.bundle`があることと、APK署名を検査し、SHA-256をartifactへ同梱する。

## スマホへ直接インストールする

PCへADBを導入しなくてもよい。

1. APKをスマホへdownloadまたは転送
2. ファイルアプリでAPKを開く
3. 初回だけ、使用したブラウザまたはファイルアプリに「不明なアプリのインストール」を許可
4. `探索マップ Field Test`をインストール
5. インストール後、不要なら「不明なアプリのインストール」許可を戻す

Field-test appは通常development appと別packageなので、両方を同じ端末へ置ける。PersonalMapのSQLiteもappごとに分離される。

## 最初のS0 smoke test

安全でよく知っている場所で5〜10分だけ試す。

1. `探索マップ Field Test`を起動
2. 新しいPersonalMapを作る
3. foreground位置権限を許可
4. background位置権限を許可
5. 記録中notificationを確認
6. 画面を消し、スマホをポケットへ入れる
7. 少なくとも1回曲がる経路を歩く
8. 一度だけスマホを取り出し、markerを追加
9. 再び画面を消して歩く
10. 探索を終了
11. Reviewの経路・raw/accepted/rejected・tracking diagnosticsを確認
12. `座標なし集計を共有`で結果を作る
13. appを終了・再起動し、PersonalMapが残ることを確認

S0に失敗した場合、30〜60分runへ進まず、権限・notification・provider errorを先に整理する。

## 30〜60分run

S0成功後、Issue #3のtemplateに従い、次を可能な限り同等ルートで比較する。

1. foreground・画面ON
2. background・画面OFF・ポケット
3. background・途中でmarker入力

比較対象:

- raw / accepted / rejected
- accuracy median / p95 / max
- gap median / p95 / max
- 30秒・60秒・120秒以上のgap
- notification復帰
- process recreation
- 開始時／終了時battery
- marker入力時間
- 白紙PersonalMapの認識しやすさ

座標、正確な住所、識別可能な地図画像はIssueへ投稿しない。

## データとプライバシー

DockerとGitHub Actionsが扱うのはsource codeとbuild dependencyだけである。実端末で記録した位置履歴、marker、SQLiteは端末内に残り、自動的にDockerやGitHubへ送られない。

Field-test diagnosticsもcanonical map truthとは分離される。共有はユーザーが明示的に選んだ座標なし集計だけにする。

## 障害の切り分け

```text
Docker check failure
  → lockfile / TypeScript / Expo compatibility

Field-test workflow failure
  → Expo prebuild / Gradle / JS bundle / APK signing

Install failure
  → Android unknown-app permission / storage / package signature

Screen-off recording failure
  → permission / foreground service / OEM battery control / callback delivery

Map discrepancy
  → raw evidence / quality filter / replay / renderer
```

build成功だけでGNSSやPassive-first UXの成立を主張しない。最終判定はIssue #3とIssue #4の実Android端末結果で行う。
