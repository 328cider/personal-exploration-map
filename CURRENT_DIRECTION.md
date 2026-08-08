# Current Direction

更新日: 2026-08-09

> この文書は短期的な開発方針であり、恒久的な製品目的と境界は [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) を正本とする。両者が矛盾する場合は憲章を優先し、この文書を修正する。

## 現在のマイルストーン

**M0: Passive Mapping Vertical Slice — Android実機S0と製品差分の判定**

現在は、エミュレータで確認可能な基本動作を通過し、Android実機でしか分からない項目へ移る段階である。

目標体験:

- 一回押して探索開始
- 通常は画面OFF・ポケット内で受動記録
- 必要時だけ短い発見入力
- 意図して開くとPersonalMapが育って見える
- 探索終了後にReviewへ進める
- 再起動後も地図と発見が残る
- 同じPersonalMapへ独立したExplorationSessionとして続きを追加
- session間を未観測の直線で接続しない
- raw evidenceと不確実性を保持し、推定を確定地物として描かない

Passive-firstはmap-invisibleを意味しない。探索中の主役は現実空間だが、ユーザーが意図して開いた時には進捗を確認できる。

## 今回のField-test候補

PR #56をmainへmerge済み。

- merged commit: `74b70715da59c74bab585b2b3c0d2a3fd919c5f7`
- source head: `0ad4e847d6c3bca290c5781547d924cfde618c92`
- workflow run: `31264093837`
- APK SHA-256: `b61f3b3f68e16f21099cc4f4f474743399b89d5af56b1bb1c53ccee1dc09358d`
- Metro不要、スマホ単体で動作
- 手順: [`docs/REAL_DEVICE_S0_HANDOFF.md`](docs/REAL_DEVICE_S0_HANDOFF.md)

既存Field-test版をアンインストールせず、同じ署名のAPKを上書きする。

## 現在の到達点

### Product / governance

- `PRODUCT_CONSTITUTION.md`を恒久的な正本として運用
- Issue / PR template、AGENTS、CIでPassive-first UX、map truth、canonical write、OSS再利用、game境界を確認
- UI、renderer、game、experienceはcanonical mapを直接変更できない
- 実地試験はユーザーコストが高いため、エミュレータで検出できる問題を実地へ持ち込まない

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
- gameはread-onlyで、地図変更はユーザー確認後の明示commandのみ

### PersonalMap-first UX

- Homeの主語を日付別GPSログからPersonalMapへ変更
- 複数sessionを別segmentとして一枚の地図へ表示
- `この地図の続きを探索`を実装
- live previewはforeground時だけ約8秒間隔で更新
- backgroundではpreview pollingを行わない
- `＋ 発見を記録`と`探索を終了して地図を見る`を固定表示
- provider停止やdiagnostics失敗でcanonical終了を阻害しない
- 初回provider開始失敗時はevidenceのないprovisional mapだけを補償削除

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
- Docker Desktopで全checkを実行可能
- GitHub ActionsでJS bundle内蔵・署名済みField-test APKを生成
- app / renderer変更時は必ず同一runで新しいAPKをbuildしてE2Eへ渡す
- harness-only変更だけが既存署名APKを再利用できる

### Mandatory Android emulator gate

同じField-test APKをAndroid 15 / API 35へclean installし、次をgreenにした。

- cold start / Home
- background記録開始
- 擬似GNSSによるlive map成長
- screen-off / background相当と復帰
- 探索終了からReview
- force-stop / relaunch後の永続化
- `位置の不確実性 / 通過セル / 軌跡`切替
- foreground-service notificationのpackage / title / body
- notification tapから記録中画面へ復帰
- 発見modal、default marker保存、live count更新、Review永続化
- Fatal、React Native JS、既知Expo SQLite native statement raceなし

このgateは基本UI、lifecycle、保存、擬似位置を検証する。実GNSS、OEM省電力、電池、発熱、身体的UXを代替しない。

### Tracking diagnostics

Issue #3向け計測基盤はmainへ反映済み。

- raw / accepted / rejectedと理由
- accuracyとsample gap分布
- callback received / persisted / duplicate / failed
- provider start / stop
- foreground / background / recovery
- marker入力時間
- 座標、地図名、marker本文、絶対時刻を含めない集計共有

Diagnostic eventはmap truthではない。best-effortで保存し、raw記録を待たせない。採否はraw evidenceからreplayする。

## 実機S0でのみ確認する項目

- 実際の位置権限導線
- 本物のGNSS精度、欠落、multipath、ジャンプ
- 画面OFF・ポケット内でのcallback継続
- foreground-service notificationの端末差
- OEMのbackground killと省電力設定
- 電池消費と発熱
- 発見入力の身体的・認知的負荷
- 実際の場所を三表示から思い出せるか
- Timelineや一般GPS loggerより「自分の探索で地図が育つ」と感じるか

したがって、現時点では「実機MVP完成」や「Google Maps Timelineとの差別化成立」とはまだ判定しない。

## 次の順序

1. **Issue #3 / S0**: 5〜10分の安全な既知routeを一回だけ記録
2. 同じraw evidenceで`不確実性 / 通過セル / 軌跡`を切替比較
3. S0 Pass後、30分以上のforeground・画面ON baseline
4. 同等条件でbackground・画面OFF・ポケットrun
5. 途中marker、notification復帰、process recreation、recents dismissal、battery saver、OEM差
6. Issue #3をGo / Narrow / Stop判定
7. Issue #4で複数runのPassive-first UXとPersonalMap価値を判定
8. export、renderer性能などM0後続を必要性順に実装
9. Issue #3と#4の後だけIssue #5 PDR gateへ進む

表示ごとに歩き直さない。一回のraw runから全表示を再生成する。

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
