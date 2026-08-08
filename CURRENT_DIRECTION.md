# Current Direction

更新日: 2026-08-08

> この文書は短期的な開発方針であり、恒久的な製品目的と境界は [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) を正本とする。両者が矛盾する場合は憲章を優先し、この文書を修正する。

## 現在のマイルストーン

**M0: Passive Mapping Vertical Slice — Android実機での成立性と製品差分の判定**

次の体験を、バックグラウンドGNSSが利用できるAndroid実機で成立させる。

- 一回押して探索開始
- 画面OFF・ポケット内で継続記録
- 必要時だけクイックマーカー
- 必要な時にアプリを開くとPersonalMapが一定間隔で育って見える
- 終了後、既存地図なしのPersonalMapを表示
- アプリ再起動後も探索が残る
- 異常位置をraw evidenceから削除せず、derived mapだけから除外
- 次回、同じPersonalMapへ独立したExplorationSessionとして続きを追加
- session間を未観測の直線で接続しない
- 欠落、精度、callback、復帰、中断時間を端末内で計測できる
- thin trackだけでなく、探索範囲・セルとして空間が育つ表現を比較できる

Passive-firstはmap-invisibleを意味しない。通常状態は画面OFF・ポケット内だが、ユーザーが意図して開いた時には探索進捗が見えることをM0の一部とする。

M0では「APKが動く」だけでなく、Google Maps Timelineや一般GPS loggerとは異なる**探索済み空間が育つ価値**が認識できるかを判定する。

## 現在の到達点

### Product / governance

- `PRODUCT_CONSTITUTION.md`を恒久的な正本として運用
- Issue / PRテンプレート、AGENTS、CIでPassive-first UX、map truth、canonical write、OSS再利用、game境界を確認
- `CURRENT_DIRECTION.md`は憲章を上書きできない短期文書として分離
- ADR番号の重複とfilename / H1不一致をproduct-governance CIで拒否
- Android Field-test候補は、エミュレータの黒箱E2Eに失敗した状態でユーザーへ渡さない

### Mapping architecture

- `mapping-core`: raw evidence、quality、frame、ExplorationSession、PersonalMap aggregate
- `mapping-engine`: canonical command / queryを実行するheadless application boundary
- `sqlite-adapter`: PersonalMap / ExplorationSessionを保存し、raw evidenceからreplay
- platform adapters: foreground / background GNSSをengineへ接続
- renderer: PersonalMapSnapshotをread-only表示
- `experience-sdk`: game state、overlay、cueだけを生成するread-only境界

### User experience

- Homeの主語を日付別GPSログからPersonalMapへ変更
- 複数ExplorationSessionを別segmentとして1枚の地図に表示
- `この地図の続きを探索`を追加
- 続きの権限画面で追加対象のPersonalMapを明示
- local-coordinate PersonalMapへ未アンカーGNSSを追加しない
- 探索中のread-only PersonalMap previewをforeground時だけ約8秒間隔で更新
- background中はpreview pollingを行わず、画面注視を前提にしない
- `＋ 発見を記録`と`探索を終了して地図を見る`を画面下部へ固定
- 発見はカテゴリと任意メモだけで保存でき、写真を必須にしない
- 場所カテゴリ別モードやゲーム本体は追加していない

### Explored-space rendering

- `探索範囲`: horizontal accuracyとconfidenceから推定範囲をread-only描画
- `セル`: 観測範囲をadaptive cellへ集約し、一回目から表示
- `軌跡`: GPS logger型の比較baselineとして保持
- 3表示をlive previewとReviewで切替可能
- corridor / cellはrenderer-derivedであり、raw evidence、accepted route、session境界を変更しない
- 道路、敷地、部屋、通行可能領域の確定形状とは表示しない
- session間を補間しない
- 10,000点fixtureでgeometry生成とprimitive数を計測

実装は成立したが、実際の場所でTimeline以上の価値を持つかはIssue #42で未判定。

### Boundary hardening

- UI、renderer、game、experienceはcanonical mapを直接変更できない
- `TrackingProviderPort`は`geographic` / `local` capabilityを宣言
- PersonalMapとのframe互換性を、DB writeとprovider startより前にmapping-engineで検査
- geographic / local、異なるlocal frameを暗黙混在させない
- mobile側の確認はUX補助、engine側が最終防衛線
- 新規PersonalMapと初回ExplorationSessionを1 use caseで作成
- 初回provider開始失敗時は、唯一の空sessionである場合だけprovisional PersonalMapを補償削除
- raw evidenceまたは別sessionが存在する場合は自動削除しない
- provider停止失敗はoperational diagnosticとして残し、canonical ExplorationSession完了を阻害しない
- diagnosticsまたはReview表示の失敗で、完了済み探索をrecording画面に閉じ込めない

### Reproducible Android build

- Node `22.23.2`を`.nvmrc`へ固定
- npm `10.9.8`と`package-lock.json`を正本化
- Expo SDK 57が要求するReact Native `0.86.2`へ整合
- 通常CIは`npm ci`でcommitted dependency graphを再現
- `expo install --check`、Expo Doctor、mobile TypeScriptが成功
- Expo Android prebuildが成功
- GitHub ActionsでJS bundle内蔵・Metro不要のField-test APKを生成
- APK bundle、署名、SHA-256を検査
- Docker DesktopだけでNode/npm検査と任意のMetroを実行可能
- Windows hostへNode、npm、JDK、Android SDK、Android Studioを必須導入しない
- emulator harnessだけの変更では、同一PRで生成済みの署名APKを再利用し、不要なGradle再ビルドを避ける

build成功は、実GNSS、長時間screen-off、電池、OEM差を証明しない。実機挙動はIssue #3で別に判定する。

### Mandatory Android emulator gate

Android 15 / API 35へ、配布候補と同じField-test APKをclean installし、次を黒箱検証済み。

- cold startとHome
- 権限説明から探索開始
- 擬似GNSSによるlive PersonalMap成長
- background・画面OFF相当での追加位置取得
- foreground復帰と記録中session復元
- 探索終了からReviewへの遷移
- force-stop / relaunch後のPersonalMap保持
- 探索範囲 / セル / 軌跡の切替
- foreground-service notificationのpackage、title、body
- notificationから記録中画面への復帰
- 発見modalの表示
- default `気になる`markerの保存
- 記録画面の発見数更新
- Reviewへのmarker永続化
- Fatal、React Native JS、Expo SQLite native statement errorがないこと

このゲートの構築中に、Expo SQLiteへの並行進入によるnative statement raceと、記録画面の操作がスクロール下へ埋まる問題を実地試験前に検出・修正した。

エミュレータはUI、基本lifecycle、保存、擬似位置を保証する。実GNSS、OEM省電力、電池、身体的UXの代替にはしない。

### OSS reuse

- 部品別のBuild / Adopt / Benchmarkとlicenseを`docs/OSS_REUSE_AUDIT.md`へ記録
- 局所投影の推奨範囲と反日付変更線処理をテスト化
- renderer、簡略化、export、PDRは既存OSS・標準を比較してから実装
- explored-spaceのM0表示は正式なGIS polygon / unionではなくscreen-space比較に限定
- polygon export、面積、複数地図unionが要件になった場合はTurf / GEOS系を再評価し、独自GIS処理を増やさない

### Tracking diagnostics

Issue #3の計測基盤はmainへ反映済み。

- DBの`tracking_diagnostic_events`
- provider start / stop requested / success / failure
- foreground / background callback received / persisted / failed
- callback batch size、duplicate、accepted / rejected counts
- AppState foreground / background transition
- process restart後のsession recovery
- marker入力completed / cancelledと中断時間
- raw observationsをmapping-coreでreplayするgap / accuracy / rejection集計
- PersonalMap Reviewのdevelopment / Field-test diagnostics
- 座標、地図名、marker本文、絶対時刻を含めない集計共有
- device、battery、permission、OEM条件を記録するrun template

diagnostic eventはcanonical map truthではない。best-effort queueで保存し、raw位置記録やprovider lifecycleを待たせない。採否は常にraw evidenceから再計算する。詳細はADR 0010に従う。

## 初回実機feedbackへの対応

最初のField-test runで次のP0問題が確認された。

- `探索を終了`でエラーが出てReviewへ進めなかった
- 地図を終了まで隠すUXでは、マッピングが進む体験を感じられなかった
- 細いGNSS軌跡は粗く見え、Google Maps Timelineや一般GPS loggerとの差別化が不足していた

対応済み:

- Issue #40: provider停止・diagnostics・Review失敗で終了不能にしない
- Issue #41: foreground時だけ成長中PersonalMapを一定間隔で表示
- Issue #42の比較実装: thin track、accuracy-aware explored corridor、coverage cells
- Android emulator E2E: 終了、復帰、marker、notification、永続化を実地試験前に保証

最初のrunはGo / Narrow / Stop測定完了として数えない。Issue #42は実際の場所での差別化判定までopenとする。

## PDR / GPS-denied技術ゲート

ユーザー提供の詳細調査を`docs/PDR_TECHNOLOGY_GATE.md`へ反映済み。Issue #5も同文書に同期した。

現在の判断:

- 任意端末・任意持ち方・長距離のIMU-only GPS代替はStop寄り
- 100〜300m、入口・出口などのアンカー間、短いGNSS欠落補完はNarrow候補
- 最も合理的な候補は`sparse GNSS + manual anchor + uncertainty-aware PDR`
- Issue #5開始時にAndroidへ学習モデルを入れない
- 最初にKotlin native raw sensor loggerとimmutable / replayable evidenceを作る
- 同じraw logをAndroid Step Detector baseline、classical PDR、RoNIN、EqNIO、sparse-GNSS hybridへreplayする
- high-rate IMUをmapping-coreやJS bridgeへ直接流さない
- learned code / weightsはproduct packageから隔離し、licenseと端末一般化を別に判定する
- map matchingはoptional inferenceでありPersonalMap truthにしない

Issue #5はIssue #3と#4にblocked。GNSS M0とマッピング単体価値が未成立のままPDR実装へ逃げない。

## 現在の未検証部分

build、静的検査、エミュレータ上のUI / lifecycle / storageは成立している。次は実端末でしか確認できない項目。

- Androidの実際のforeground / background権限導線
- 実端末のforeground-service notificationと復帰差
- 画面OFF・ポケット内で30〜60分記録が続くこと
- OS・端末メーカーによる停止、復帰、recents dismissal、battery saver
- 実GNSSの欠落率、位置精度、異常ジャンプ
- 電池消費、発熱
- foregroundへ戻った時に成長中地図が十分早く更新されること
- 発見入力の身体的・認知的中断時間
- explored-space表現が実際の探索でthin trackやTimeline以上の価値を持つこと

したがって、現時点で「実機MVP完成」または「Google Maps Timelineとの差別化成立」とは判定しない。

## 次の順序

1. **Issue #42 / 内部比較**: 矩形、loop、往復、広場、疎なGNSS、精度混在、複数sessionを擬似経路で比較し、corridor / cellの誤認と見え方を詰める
2. **Issue #42 / UX調整**: エミュレータ証跡をもとに、表示説明、濃さ、cell粒度、live previewの情報量を調整
3. 変更後のField-test APKでDocker、署名、Android Emulator lifecycle / coverage / notification / marker gateをすべて再実行
4. **Issue #3 / 短い実機S0**: 内部ゲート完了後、1回の短い探索だけで権限、実GNSS、screen-off、notification、終了、marker、再起動を確認
5. 同じ実地データ上で探索範囲 / セル / 軌跡を切替え、追加歩行なしにIssue #42を比較
6. **Issue #3 / baseline・core test**: 必要性が確認された場合に限り、foregroundとbackgroundの30分以上runを比較
7. **Issue #3 / resilience**: permission変更、battery saver、recents dismissal、OEM差を追加測定
8. **Issue #4**: 基本不具合を実地へ持ち込まない状態で、実探索によるPassive-first UXとPersonalMap価値をGo / Narrow / Stop判定
9. **Issue #19**: 実測でView rendererが問題になった場合だけ、最新mainからSVG / Skiaを再評価
10. **Issue #22**: GPX / GeoJSON / lossless bundleを実装
11. Issue #3と#4の後、**Issue #5**でraw sensor loggerとoffline PDR技術ゲートを開始
12. PDR判定後にGPSなし探索とanchor transformの製品統合範囲を決める

## 今はやらないこと

- 正確な壁、部屋、道幅の自動推定
- カメラ常時起動、AR、LiDARスキャン
- ソーシャル、ランキング、広告、クラウド同期
- 収集、実績、物語などのゲーム本体
- OpenStreetMap等への編集投稿
- 「山」「街」「建物」など用途別モードの増殖
- 二つ目のappがない段階での動的plugin loaderやnpm package公開
- 精度未検証PDRの既定有効化
- Android ML modelの先行統合
- Expo JS listenerだけによる100〜200Hz screen-off sensor保存
- 生加速度の単純二重積分
- 磁気方位の無条件採用
- 自動telemetry / analytics service
- Google道路へmap matchingした結果をPersonalMapの正本にすること
- 基本UI、終了、marker、notification、保存のデバッグをユーザーの実地歩行へ委ねること

## 変更してはいけない原則

以下は要約であり、完全な定義と変更手続きは `PRODUCT_CONSTITUTION.md` に従う。

- 一回目で地図を作る。再訪は登録条件ではなく補正材料。
- 探索中の主役は現実空間であり、画面ではない。
- Passive-firstはmap-invisibleではない。意図して開いた時は進捗を確認できる。
- マップの正本はユーザーの探索証拠。
- ExplorationSessionは証拠の単位、PersonalMapは複数sessionから育つ集約。
- 既存地図は任意の補助レイヤー。
- 不確かな推定を、確かな地物や接続として描かない。
- canonicalな地図変更は明示的なapplication boundaryを通す。
- UI、renderer、game、experienceはcanonical mapを直接変更しない。
- game / experienceはread-onlyで、地図修正はユーザー確認後の明示commandにする。
- diagnosticsはmap truthと分離し、raw evidenceから採否を再計算する。
- 独自価値のない一般部品はOSS・標準・platformを先に調査する。
- 位置履歴は高感度かつユーザー所有で、local-firstを既定にする。
- 実地試験はユーザーコストが高い。エミュレータで検出できる問題を実地へ持ち込まない。
