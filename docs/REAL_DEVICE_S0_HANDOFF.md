# Android実機 S0 ハンドオフ

更新日: 2026-08-09

## 目的

実地試験を基本動作のデバッグや手作業の転記に使わず、Android実機でしか分からない項目だけを確認する。

S0は5〜10分の短いsmoke testであり、30〜60分の性能比較ではない。S0に失敗した場合は同じ経路を歩き直さず、USB bundleと客観レポートを開発へ戻す。

## 使用するAPK

- アプリ名: `探索マップ Field Test`
- package: `com.cider328.personalexplorationmap.fieldtest`
- build: Metro不要、スマホ単体で動作
- runtime source: `9437abb374d07d6cb549543a9185c7a11a4d90f6`
- USB diagnostics merge: `166172eca5ad5e6d6b673111483186c6171fe368`（PR #59）
- objective analyzer merge: `8ae58e43226c68f02547ddd5cb8853fa93ec256a`（PR #78）
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
- `位置の不確実性 / 通過セル / 軌跡`の切替
- foreground-service notificationとnotification tap復帰
- 発見modal、default marker保存、Review永続化
- Fatal、React Native、既知Expo SQLite raceがないこと
- PowerShell USB collectorの実行
- `run-as`によるapp-private dataとSQLiteの抽出
- 開始・終了environment eventのSQLite保存
- 座標なし診断の端末・時刻・電池・権限・集計値
- raw bundleのlocal-only保持、checksums、`autoUpload=false`

さらに、USB bundleから次を自動判定する解析器を検証済み。

- bundle integrity
- Field-test packageとmanifest
- environment snapshot
- permission
- raw / accepted / callback accounting
- provider / environment lifecycle
- background復帰
- marker完了
- sample gap
- battery / optimization / thermal
- operational error

エミュレータで代替できるUI、終了、保存、通知、marker、USB抽出、客観集計の基本不具合は内部gateで止める。

## 実機でのみ確認するもの

- 本物のGNSS精度、欠落、multipath、ジャンプ
- 実端末の位置権限導線
- 画面OFF・ポケット内でのcallback継続
- OEMの省電力制御とforeground-service挙動
- 電池消費と発熱
- 通知からの実端末復帰
- 発見入力の身体的・認知的負荷
- 実際の場所を三表示から思い出せるか
- Timelineや一般GPS loggerより`自分の探索で地図が育つ`と感じるか

## S0前の確認

端末、Android、開始時刻、開始時電池、権限、省電力状態はアプリが自動記録する。手作業で転記しない。

最初のS0は切り分けのため、可能なら次の条件にする。

- バッテリーセーバーをOFF
- アプリの電池設定を`制限なし`
- 位置情報をON
- USBデバッグを有効化し、このPCを許可
- 帰宅後にDocker Desktopを起動できる

省電力条件はS0成功後に別条件として試す。OEM固有設定を変更した場合だけ短くメモする。

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
13. Reviewで同じraw evidenceを次の三表示へ切り替える。
    - `不確実性`
    - `通過セル`
    - `軌跡`
14. アプリを終了し、再起動する。
15. PersonalMapと発見が残っていることを確認する。
16. 帰宅後、端末をUSB接続し、Docker Desktopを起動する。
17. 次節の1コマンドで回収と解析を行う。

歩行中に画面を見ない。地図確認と発見入力は安全に停止してから行う。表示方式ごとに歩き直さない。

## 帰宅後の1コマンド

リポジトリ直下のWindows PowerShellで実行する。

```powershell
git switch main
git pull --ff-only
.\scripts\collect-and-analyze-field-test.ps1
```

このコマンドが次を行う。

1. Field-testアプリをforce-stop
2. app-private data、system / battery / permission evidenceをUSB回収
3. checksumsとraw local ZIPを生成
4. Field-testアプリを再起動
5. Docker内で座標なし客観S0解析
6. Markdown / JSONレポート生成

ADBがPATHにない場合、Google公式Platform Toolsをリポジトリ配下`.local`へ取得する。WindowsへNode.js、npm、JDK、Android SDK、Android Studioを要求しない。

複数端末が接続されている場合:

```powershell
.\scripts\collect-and-analyze-field-test.ps1 -Serial <adb-device-serial>
```

## 生成物

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

### 通常共有できるもの

- `coordinate-free-diagnostics.txt`
- `analysis\objective-s0-report.md`
- `analysis\objective-s0-report.json`
- `docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md`に沿った主観回答

これらは端末、時刻、電池、権限、sample集計、欠落、精度、callback、marker入力時間、状態遷移、エラー、客観PASS / WARN / FAIL理由を含む。

緯度経度、local座標、地図名・ID、marker文、地図画像は含まない。

### PCローカル限定

- `pem-field-test-<UTC日時>.zip`
- `app\app-private-data.tar`

これらにはraw位置とapp-private dataが含まれる。自動uploadされない。公開Issueや通常のチャットへ添付せず、詳細解析が本当に必要な場合だけprivateな経路を選ぶ。

## Objective status

### PASS

定義済みの客観S0項目にblocking failureも警告もない。

### WARN

記録は成立したが、sample gap、acceptance rate、省電力、battery / thermal欠測、S0時間などに確認事項がある。警告理由と主観レビューを合わせてS1へ進むか判断する。

### FAIL

required snapshot、permission、sample、callback、lifecycle、marker、integrity、manifestまたはoperational errorにblocking evidenceがある。

FAILでもレポートは残る。**同じ経路を歩き直さず、bundleとreportを使ってコード・エミュレータへ戻す。**

## S0 Pass

次を満たす。

- 起動・探索開始ができる
- foreground-service notificationが表示される
- 画面OFF後もraw sampleが増える
- foreground復帰後、おおむね10〜20秒以内にlive mapが更新される
- 発見を保存できる
- 探索を終了してReviewへ進める
- 三表示を切り替えられる
- 再起動後もPersonalMapと発見が残る
- USB bundleと客観レポートを生成できる
- objective statusがPASS、または理由を確認して許容可能なWARN
- crashやblocking errorがない

経路精度、地図認識性、差別化は主観レビューとS1で判定する。客観解析器だけで製品Goを決めない。

## S0 Fail / 中止

次の場合はその場で止め、歩き直さない。

- 探索を開始できない
- notificationが表示されない
- 2分以上歩いても位置sampleが0
- 探索を終了できない
- crashまたはblocking error
- 終了・再起動でデータが消える
- 端末が異常発熱する
- 安全に試験できない
- USB bundleを回収できない
- objective statusがFAIL

可能なら同じ端末データを保持したまま1回だけUSB回収・解析する。失敗した手順、画面のエラー、客観レポートを開発へ戻す。

## 人が残す主観だけ

`docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md`を使用する。

- ポケット内で邪魔だったか
- 記録中を信頼できたか
- 発見入力が負担だったか
- 三表示から実際のrouteを思い出せたか
- 不確実性や通過セルを確定境界と誤解しなかったか
- Timeline / GPS loggerとの差を感じたか
- 続きを探索したいか

端末、Android、時刻、電池、権限、sample集計は手入力しない。

## S0後の順序

S0がPassした後だけ、Issue #3の30分以上比較へ進む。

1. foreground・画面ON baseline
2. background・画面OFF・ポケット
3. background・途中で発見入力
4. notification復帰、process recreation、recents dismissal
5. battery saver / app最適化 / OEM条件

一つのrunのraw evidenceを三表示へ切り替えて比較する。

## PDRとの関係

S0とM0はGNSSでマッピング単体価値を判定する。PDRはこの段階の不具合や差別化不足を隠すために導入しない。

Issue #5では、全面的なIMU-only GPS代替ではなく、短いGNSS欠落区間・アンカー間を候補とし、Kotlin raw sensor loggerと同一logのoffline replayから始める。実地S0前にAndroidへ学習モデルを組み込まない。
