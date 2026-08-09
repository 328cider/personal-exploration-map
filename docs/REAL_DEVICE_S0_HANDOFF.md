# Android実機 S0 ハンドオフ

更新日: 2026-08-09

## 目的

実地試験を基本動作のデバッグに使わず、Android実機でしか分からない項目だけを確認する。

このS0は5〜10分の短いsmoke testであり、30〜60分の性能比較ではない。S0に失敗した場合は同じ試験を何度も歩き直さず、表示されたエラーと座標なし診断を開発へ戻す。

## 使用するAPK

- アプリ名: `探索マップ Field Test`
- package: `com.cider328.personalexplorationmap.fieldtest`
- build: Metro不要、スマホ単体で動作
- source commit: `9437abb374d07d6cb549543a9185c7a11a4d90f6`
- merged commit: `166172eca5ad5e6d6b673111483186c6171fe368`
- workflow run: `31311862191`
- Actions artifact: `9037728411`
- APK SHA-256: `c0e142f278852d8fc9504aa4a1a7a699487278472e74fa4f2c339769b6b074cf`

既存のField-test版をアンインストールせず、同じ署名のAPKを上書きインストールする。アンインストールすると端末内データが失われる可能性がある。

このAPKだけがUSB抽出用のdebuggable releaseであり、通常packageはdebuggable化しない。

## 実地前に完了している検証

同じAPKをAndroid 15 / API 35エミュレータへclean installし、次を黒箱確認済み。

- cold startとHome
- background記録開始
- 擬似GNSSによるlive PersonalMap成長
- screen-off / background相当での位置追加
- foreground復帰とsession復元
- 探索終了からReviewへの遷移
- force-stop / relaunch後のPersonalMap保持
- `位置の不確実性` / `通過セル` / `軌跡`の切替
- foreground-service notificationのpackage、title、body
- notification tapから記録画面への復帰
- 発見modal、default marker保存、live count更新、Review永続化
- Fatal、React Native、既知のExpo SQLite raceがないこと
- PowerShell USB collectorの実行
- `run-as`によるapp-private dataとSQLiteの抽出
- 開始・終了environment eventのSQLite保存
- 座標なし診断に端末、時刻、電池、権限、集計値が含まれること
- 座標なし診断に緯度経度、地図名・ID、marker文、地図画像が含まれないこと
- raw bundleがローカル保存のみで、自動uploadされないこと
- bundle内ファイルのSHA-256検証

エミュレータで代替できるUI、終了、保存、通知、marker、USB抽出の基本不具合はこのgateで止める。

## 実機でのみ確認するもの

- 本物のGNSS精度、欠落、multipath、ジャンプ
- 実端末の位置権限導線
- 画面OFF・ポケット内でのcallback継続
- OEMの省電力制御とforeground-service挙動
- 電池消費と発熱
- 通知からの実端末復帰
- スマホを取り出して発見を入力する身体的・認知的負荷
- 実際の場所を地図から思い出せるか
- Timelineや一般GPS loggerより「自分の探索で地図が育つ」と感じるか

## S0前の確認

端末、Android、開始時刻、開始時電池、権限、省電力状態はアプリが自動記録し、試験後のUSB bundleにも含まれる。手作業で転記しなくてよい。

最初のS0は切り分けのため、可能なら次の条件にする。

- バッテリーセーバーをOFF
- アプリの電池設定を`制限なし`
- 位置情報をON
- USBデバッグを有効化し、このPCを許可

省電力条件はS0成功後に別条件として試す。OEM固有の設定を変更した場合だけ、その変更内容を短くメモする。

## S0手順

安全でよく知っている場所を一度だけ歩く。

1. APKを上書きインストールする。
2. `探索マップ Field Test`を起動する。
3. `新しい地図を探索する`を押す。
4. foreground / background位置権限を求められたら許可する。
5. `探索を記録中`通知が表示されることを確認する。
6. 画面を消し、スマホを普段のポケットへ入れる。
7. 5〜10分、最低2回は曲がる経路を普通に歩く。
8. 安全に立ち止まって一度だけアプリを開く。
9. live mapが開始時より育っていることを確認する。
10. `＋ 発見を記録`からdefaultの`気になる`を1件保存する。メモは任意。
11. 再び画面を消し、少し歩く。
12. 安全に立ち止まり、`探索を終了して地図を見る`を押す。
13. Reviewで次の三表示を、同じraw evidenceから切り替える。
    - `不確実性`
    - `通過セル`
    - `軌跡`
14. アプリを終了し、再起動する。
15. PersonalMapと発見が残っていることを確認する。
16. `座標なし集計を共有`で診断テキストを生成できることを確認する。
17. PCへUSB接続し、次節のコマンドでField-test bundleを回収する。

歩行中に画面を見ない。地図確認と発見入力は安全に停止してから行う。

## USBでの自動回収

リポジトリの最新`main`を取得し、Windows PowerShellで次を実行する。

```powershell
git switch main
git pull --ff-only
.\scripts\pull-field-test-bundle.ps1 -RestartApp
```

ADBがPATHにない場合、scriptはGoogle公式platform-toolsをリポジトリ配下の`.local`へ取得する。Node.js、npm、JDK、Android SDKはホストへ要求しない。

正常終了すると、次が生成される。

```text
artifacts\device-bundles\
├─ pem-field-test-<UTC日時>\
│  ├─ coordinate-free-diagnostics.txt
│  ├─ manifest.json
│  ├─ SHA256SUMS.txt
│  ├─ app\app-private-data.tar
│  └─ system\...
└─ pem-field-test-<UTC日時>.zip
```

### 通常共有するもの

`coordinate-free-diagnostics.txt`には、端末、Android、開始・終了時刻、電池、権限、省電力、sample数、欠落、精度、callback、marker入力時間、状態遷移、最終エラーが含まれる。

緯度経度、local座標、地図名・ID、marker文、地図画像は含まれない。通常の不具合報告には、まずこのテキストと主観メモを使う。

### ローカル限定のもの

`pem-field-test-<UTC日時>.zip`と`app-private-data.tar`には、raw位置とapp-private dataが含まれる。自動uploadされない。公開Issueや通常のチャットには添付せず、必要な場合だけprivateな経路で意図的に共有する。

## S0 Pass

次をすべて満たす。

- 起動・探索開始ができる
- foreground-service notificationが表示される
- 画面OFF後もraw sampleが増える
- foreground復帰後、おおむね10〜20秒以内にlive mapが更新される
- 発見を保存できる
- 探索を終了してReviewへ進める
- 三表示を切り替えられる
- 再起動後もPersonalMapと発見が残る
- USB bundleを回収できる
- 繰り返し操作を妨げるcrashやblocking errorがない

経路精度や差別化の最終評価はS0 Pass条件にしない。S0は機能成立性のgateである。

## S0 Fail / 中止

次の場合はその場で試験を止め、歩き直さない。

- 探索を開始できない
- notificationが表示されない
- 2分以上歩いても位置sampleが0のまま
- 探索を終了できない
- crashまたは同じblocking errorが繰り返す
- 終了・再起動でデータが消える
- 端末が異常発熱する
- 安全に試験できない

共有するもの:

```text
失敗した手順番号:
画面のエラー文:
通知の有無:
座標なし診断:
そのほかの違和感:
```

端末、Android、時刻、電池、権限、省電力などは座標なし診断から取得する。正確な住所、座標、raw location log、特定可能な地図画像は共有しない。

USB回収自体に失敗した場合は、PowerShellのエラー全文も共有する。歩行試験はやり直さず、端末内データを保持したまま回収経路を修正する。

## S0後の順序

S0がPassした後だけ、Issue #3の30分以上の比較へ進む。

1. foreground・画面ON baseline
2. background・画面OFF・ポケット
3. background・途中で発見入力
4. notification復帰、process recreation、recents dismissal
5. battery saver / app最適化 / OEM条件

表示比較のために三回歩かない。一つのrunのraw evidenceを、`不確実性 / 通過セル / 軌跡`へ切り替えて比較する。

## PDRとの関係

S0とM0はGNSSでマッピング単体価値を判定する。PDRはこの段階の不具合や差別化不足を隠すために導入しない。

Issue #5では、全面的なIMU-only GPS代替ではなく、短いGNSS欠落区間・アンカー間を候補とし、Kotlin raw sensor loggerと同一logのoffline replayから始める。実地S0の結果を得る前にAndroidへ学習モデルを組み込まない。
