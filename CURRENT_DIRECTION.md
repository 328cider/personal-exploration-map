# Current Direction

更新日: 2026-08-09

> この文書は短期的な開発方針である。恒久的な製品目的、非交渉原則、変更手続きは [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) を正本とする。矛盾時は憲章を優先し、この文書を修正する。

## 現在のマイルストーン

**M0: Passive Mapping Vertical Slice — Android実機S0と、マッピング単体価値の判定**

内部で確認できる実装・UI・永続化・擬似GNSS・USB回収・客観解析は完了した。現在は、Android実機でしか確認できない次の問いへ移る段階である。

1. 画面OFF・ポケット内で実GNSSを安定記録できるか
2. 電池、発熱、権限、OEM省電力の制約は許容できるか
3. 終了後のPersonalMapから実際のturn、loop、往復、広場を認識できるか
4. Google Maps Timelineや一般GPS loggerより、`自分の探索で空間が形成される`価値を感じるか
5. マッピング単体で成立するか、将来game layerが必要か

現時点では、**実機MVP完成、差別化成立、PDR着手可のいずれも未判定**である。

## 目標体験

- 一回押して探索開始
- 通常は画面OFF・ポケット内で受動記録
- 必要な時だけ、安全に立ち止まって短い発見入力
- 意図してアプリを開くとPersonalMapが育って見える
- 探索終了後にReviewへ進める
- 再起動後も地図と発見が残る
- 同じPersonalMapへ独立したExplorationSessionとして続きを追加できる
- session間を未観測の直線で接続しない
- raw evidenceと不確実性を保持し、推定を確定地物として描かない
- 実地試験後の端末・時刻・電池・権限・診断を手入力しない
- 一度のraw runから複数表示を比較し、表示ごとに歩き直さない

Passive-firstはmap-invisibleを意味しない。探索中の主役は現実空間だが、ユーザーが意図して開いた時には進捗を確認できる。

## 現在のField-test候補

### APK runtime

- app: `探索マップ Field Test`
- package: `com.cider328.personalexplorationmap.fieldtest`
- Metro不要、スマホ単体で動作
- runtime source: `9437abb374d07d6cb549543a9185c7a11a4d90f6`
- USB diagnostics merge: `166172eca5ad5e6d6b673111483186c6171fe368`（PR #59）
- workflow run: `31311862191`
- APK artifact: `9037728411`
- emulator + USB evidence artifact: `9037812440`
- APK SHA-256: `c0e142f278852d8fc9504aa4a1a7a699487278472e74fa4f2c339769b6b074cf`

既存Field-test版をアンインストールせず、同じ署名のAPKを上書きする。通常packageはdebuggableにせず、Field-test packageだけをUSB抽出可能にする。

### 試験支援

- subjective review template merge: `3eb5fa4181c564f9ceafacdb0016e86a610c5d48`（PR #75）
- objective analyzer merge: `8ae58e43226c68f02547ddd5cb8853fa93ec256a`（PR #78）
- one-command runbook merge: `8e058f33245f6bd2d46271e32e26c92cf58f6d73`（PR #79）

正本:

- [`docs/REAL_DEVICE_S0_HANDOFF.md`](docs/REAL_DEVICE_S0_HANDOFF.md)
- [`docs/USB_FIELD_TEST_EXPORT.md`](docs/USB_FIELD_TEST_EXPORT.md)
- [`docs/FIELD_TEST_OBJECTIVE_ANALYSIS.md`](docs/FIELD_TEST_OBJECTIVE_ANALYSIS.md)
- [`docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md`](docs/FIELD_EXPLORATION_REVIEW_TEMPLATE.md)

## 現在の到達点

### Product / governance

- `PRODUCT_CONSTITUTION.md`を恒久的な正本として運用
- Issue / PR template、AGENTS、CIでPassive-first UX、map truth、canonical write、OSS再利用、game境界を確認
- UI、renderer、game、experienceはcanonical mapを直接変更できない
- 実地試験は高コストなため、エミュレータで検出できる問題を実地へ持ち込まない
- 実地試験の客観情報はUSBで自動回収し、人が記録するのは端末から分からない主観だけ
- 同じraw runから複数表示を比較し、表示ごとに歩き直さない
- blocking failure時は同じ条件を再試験せず、bundleを保持してcode / emulatorへ戻す

### Mapping architecture

```text
apps/mobile
  ↓ command / query
mapping-engine
  ↓
mapping-core
  ↕ repository / tracking ports
sqlite-adapter / GNSS / future PDR adapters

read-only PersonalMap
  ├─ renderer
  └─ experience-sdk / future game
```

- raw evidence、accepted / rejected、frame、ExplorationSession、PersonalMap aggregateを分離
- canonical writeはmapping-engineへ集約
- geographic / local、異なるlocal frameを根拠なく混ぜない
- game / experienceはread-only
- 地図変更が必要な場合はユーザー確認後の明示commandを通す

### PersonalMap-first UX

- Homeの主語を日付別GPSログからPersonalMapへ変更
- 複数sessionを別segmentとして一枚の地図へ表示
- `この地図の続きを探索`を実装
- live previewはforeground時だけ定期更新
- backgroundではpreview pollingを行わない
- `＋ 発見を記録`と`探索を終了して地図を見る`を固定表示
- provider停止やdiagnostics失敗でcanonical終了を阻害しない
- 初回provider開始失敗時は、evidenceのないprovisional mapだけを補償削除

### 位置の不確実性と通過表示

Issue #54を完了した。

```text
accepted point estimate
  ├─ 位置の不確実性
  ├─ 保守的な推定通過セル
  └─ 採用済み位置の中心線
```

- horizontal accuracyは不確実性帯の幅・透明度へ反映
- accuracyが悪くても通過セル面積を広げない
- poor accuracyはcell confidenceを下げる
- 同一session内の高密度sampleや往復を再訪回数と数えない
- `supportingSessionCount`は独立ExplorationSession数
- 一回目から表示し、再訪を登録条件にしない
- uncertainty、cell、centerlineはrenderer-derivedでありcanonical mapではない
- 道路、敷地、部屋、通行可能領域、正式な探索済みpolygonとは扱わない

fixture matrixでは、poor accuracyの5点が旧279 cellを生成していた問題を53 cellへ保守化し、all-accurate counterpartと同一cell ID集合になることをassertした。

### Reproducible build / Docker

- Node `22.23.2`、npm `10.9.8`、`package-lock.json`を固定
- Expo SDK 57 / React Native `0.86.2`
- Windows hostへNode、npm、JDK、Android SDK、Android Studioを必須導入しない
- Docker Desktopでcheckと客観解析を実行可能
- GitHub ActionsでJS bundle内蔵・署名済みField-test APKを生成
- app / renderer変更時は、同一runで新しいAPKをbuildしてE2Eへ渡す
- harness-only変更だけが既存署名APKを再利用できる
- ADBが無いWindowsでは公式Platform Toolsをリポジトリ内`.local`へだけ取得する

### Mandatory Android emulator / USB gate

同じField-test APKをAndroid 15 / API 35へclean installし、次をgreenにした。

- cold start / Home
- background記録開始
- 擬似GNSSによるlive map成長
- screen-off / background相当と復帰
- 探索終了からReview
- force-stop / relaunch後の永続化
- `位置の不確実性 / 通過セル / 軌跡`切替
- foreground-service notificationとnotification tap復帰
- 発見modal、default marker保存、Review永続化
- Fatal、React Native JS、既知Expo SQLite raceなし
- PowerShell USB collectorの実行
- Field-test packageだけで`run-as`成功
- app-private dataをbinary-safe tarとして回収
- coordinate-free summary、manifest、SHA256SUMS、raw local ZIPを生成
- 抽出SQLiteに`environment.session.started / ended`が存在
- device、battery、permission、elapsed-time、debuggable fieldsを確認
- coordinate-free outputに座標、map名・ID、marker本文、地図画像がないことを確認
- manifestで`containsRawLocation=true`、`autoUpload=false`を確認

このgateは基本UI、lifecycle、保存、擬似位置、USB回収を検証する。実GNSS、OEM省電力、電池、発熱、身体的UXを代替しない。

### Tracking / environment diagnostics

- raw / accepted / rejectedと理由
- accuracyとsample gap分布
- callback received / persisted / duplicate / failed
- provider start / stop
- foreground / background / recovery
- marker入力時間
- device / Android / app build
- session start / end wall-clockとmonotonic elapsed time
- battery start / end / delta、charge、temperature、voltage、current（端末が提供する場合）
- power saver、battery optimization、thermal
- foreground / background location、notification permission

Diagnostic eventはmap truthではない。best-effortで保存し、raw記録を待たせない。採否はraw evidenceからreplayする。

### USB回収と客観S0解析

帰宅後は次の1コマンドを使用する。

```powershell
.\scripts\collect-and-analyze-field-test.ps1
```

このコマンドが、USB回収、checksums、local ZIP、アプリ再起動、Docker解析、Markdown / JSON生成まで行う。

生成物:

```text
artifacts\device-bundles\pem-field-test-<UTC日時>\
├─ coordinate-free-diagnostics.txt
├─ manifest.json
├─ SHA256SUMS.txt
├─ app\app-private-data.tar
├─ system\...
└─ analysis\
   ├─ objective-s0-report.md
   └─ objective-s0-report.json
```

Objective analyzerは次をPASS / WARN / FAILで整理する。

- checksum / manifest integrity
- Field-test packageとlocal-only宣言
- start / end environment snapshot
- permission
- raw / accepted / callback accounting
- provider / environment lifecycle
- background復帰
- S0 marker
- sample gap
- battery / optimization / thermal
- operational error

Analyzerはcoordinate-free summary、manifest、checksumsを意味解析し、raw SQLite / tar内の位置履歴を読まない。禁止fieldが入力へ混入した場合も、その値をreportへ投影しない。

Objective statusは製品Go / Narrow / Stopではない。地図認識性、安全性、ポケットUX、Timelineとの差は人が判断する。

### Privacy boundary

通常共有可能:

- `coordinate-free-diagnostics.txt`
- `objective-s0-report.md`
- `objective-s0-report.json`
- subjective review templateの回答

PCローカル限定:

- raw ZIP
- `app-private-data.tar`
- SQLite / WAL / raw位置履歴

raw bundleは自動uploadしない。公開Issueや通常のチャットへ添付しない。

## 実機S0でのみ確認する項目

- 実際の位置権限導線
- 本物のGNSS精度、欠落、multipath、ジャンプ
- 画面OFF・ポケット内でのcallback継続
- foreground-service notificationの端末差
- OEMのbackground killと省電力設定
- 電池消費と発熱
- 発見入力の身体的・認知的負荷
- 実際の場所を三表示から思い出せるか
- Timelineや一般GPS loggerより`自分の探索で地図が育つ`と感じるか

## 次の順序

1. **Issue #3 / S0**: 5〜10分の安全な既知routeを一回だけ記録
2. 同じraw evidenceで`不確実性 / 通過セル / 軌跡`を切替比較
3. 帰宅後に`collect-and-analyze-field-test.ps1`を実行
4. Objective PASS / WARN / FAILと理由を確認
5. `FIELD_EXPLORATION_REVIEW_TEMPLATE.md`で主観だけを記録
6. Objective FAILまたはblocking errorなら同条件を再度歩かずcode / emulatorへ戻す
7. S0 Pass後、30分以上のforeground・画面ON baseline
8. 同等条件でbackground・画面OFF・ポケットrun
9. 途中marker、notification復帰、process recreation、recents dismissal、battery saver、OEM差
10. Issue #3をGo / Narrow / Stop判定
11. Issue #4で複数runのPassive-first UXとPersonalMap価値を判定
12. export、renderer性能などM0後続を必要性順に実装
13. Issue #3と#4の後だけIssue #5 PDR gateへ進む

## PDR / GPS-denied

ユーザー提供調査を`docs/PDR_TECHNOLOGY_GATE.md`とIssue #5へ反映済み。

- 全面的なIMU-only GPS代替はStop寄り
- 100〜300m、anchor間、短いGNSS欠落補完はNarrow候補
- 最初はKotlin native raw sensor loggerとimmutable / replayable evidence
- 同じlogをStep Detector baseline、classical PDR、RoNIN、EqNIO、sparse-GNSS hybridへoffline replay
- high-rate IMUをmapping-coreやJS bridgeへ直接流さない
- learned modelを比較前にAndroidへ統合しない
- PDR出力、factor graph、map matchingはderived revision / optional inferenceでありraw truthを上書きしない

PDRはGNSS M0の不具合や差別化不足を隠すために先行導入しない。

## 今はやらないこと

- 正確な壁、部屋、道路幅の自動推定
- camera常時起動、AR、LiDARを基本UXにする
- cloud同期、social、ranking、広告
- game本体をmapping coreへ混ぜる
- existing mapへの強制snapをPersonalMap truthにする
- accuracy円を探索済み面積として保存・集計する
- emulatorで再現できるbugを実地試験へ回す
- PDRやMLを価値検証前に既定有効化する
- objective analyzerだけで製品価値を自動判定する

## 変更してはいけない原則

以下は要約であり、完全な定義と変更手続きは`PRODUCT_CONSTITUTION.md`に従う。

- 一回目で地図を作る。再訪は登録条件ではない。
- 探索中の主役は現実空間であり、画面ではない。
- Passive-firstはmap-invisibleではない。
- 地図の正本はユーザーの探索証拠。
- ExplorationSessionは証拠の単位、PersonalMapは育つ集約。
- 既存地図は任意の補助レイヤー。
- 不確かな推定を確定地物、接続、面積として扱わない。
- canonical writeは制御されたapplication boundaryを通す。
- game / experienceはread-only。
- diagnosticsとderived inferenceをmap truthから分離する。
- 独自価値のない一般部品はOSS、標準、platformを先に調査する。
- 位置履歴は高感度かつユーザー所有で、local-firstを既定にする。
- 実地試験は高コストであり、内部検証可能な問題を持ち込まない。
