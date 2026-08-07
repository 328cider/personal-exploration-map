# Current Direction

更新日: 2026-08-08

> この文書は短期的な開発方針であり、恒久的な製品目的と境界は [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) を正本とする。両者が矛盾する場合は憲章を優先し、この文書を修正する。

## 現在のマイルストーン

**M0: Passive Mapping Vertical Slice — Android実機での成立性判定**

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

Passive-firstはmap-invisibleを意味しない。通常状態は画面OFF・ポケット内だが、ユーザーが意図して開いた時には探索進捗が見えることをM0の一部とする。

## 現在の到達点

### Product / governance

- `PRODUCT_CONSTITUTION.md`を恒久的な正本として運用
- Issue / PRテンプレート、AGENTS、CIでPassive-first UX、map truth、canonical write、OSS再利用、game境界を確認
- `CURRENT_DIRECTION.md`は憲章を上書きできない短期文書として分離
- ADR番号の重複とfilename / H1不一致をproduct-governance CIで拒否

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
- 初回実機feedbackを受け、探索中のread-only PersonalMap previewをforeground時だけ約8秒間隔で更新
- background中はpreview pollingを行わず、画面注視を前提にしない
- 場所カテゴリ選択やゲーム要素は追加していない

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
- GitHub ActionsでGradle `:app:assembleDebug`とdebug APK artifact生成が成功
- Docker DesktopだけでNode/npm検査と任意のMetroを実行できる
- GitHub ActionsでJS bundle内蔵・Metro不要のField-test APKを生成できる
- Windows hostへNode、npm、JDK、Android SDK、Android Studioを必須導入しない

build成功は、screen-off callback、電池、権限、OEM差を証明しない。実機挙動はIssue #3で別に判定する。

### OSS reuse

- 部品別のBuild / Adopt / Benchmarkとlicenseを`docs/OSS_REUSE_AUDIT.md`へ記録
- 局所投影の推奨範囲と反日付変更線処理をテスト化
- renderer、簡略化、export、PDRは既存OSS・標準を比較してから実装

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
- device、battery、permission、OEM条件を記録するrun template

diagnostic eventはcanonical map truthではない。best-effort queueで保存し、raw位置記録やprovider lifecycleを待たせない。採否は常にraw evidenceから再計算する。詳細はADR 0010に従う。

## 初回実機feedback

最初のField-test runで、完全な診断共有前に次のP0問題が確認された。

- `探索を終了`でエラーが出てReviewへ進めなかった
- 地図を終了まで隠すUXでは、マッピングが進む体験を感じられなかった
- 細いGNSS軌跡は粗く見え、Google Maps Timelineや一般GPS loggerとの差別化が不足していた

このrunはGo / Narrow / Stop測定完了として数えない。

即時対応:

- Issue #40: provider停止・diagnostics・Review失敗で終了不能にしない
- Issue #41: foreground時だけ成長中PersonalMapを一定間隔で表示
- Issue #42: thin trackとaccuracy-aware explored corridor / coverage cellsを比較

## 現在の未検証部分

build・計測コード・静的検査は成立しているが、次は実端末で未検証。

- 修正版Field-test APKで探索を確実に終了できること
- foreground / background権限の実際の導線
- foreground-service notification
- 画面OFF・ポケット内で30〜60分記録が続くこと
- OS・端末メーカーによる停止、復帰、通知挙動
- 欠落率、位置精度、異常ジャンプ、電池消費
- foregroundへ戻った時に約10秒以内で成長中地図が更新されること
- 発見入力が探索を中断しすぎないこと
- explored-space表現が通常のGPS履歴以上の価値を持つこと

したがって、現時点で「実機MVP完成」または「Google Maps Timelineとの差別化成立」とは判定しない。

## 次の順序

1. **Issue #40 / #41**: 終了不能修正とforeground-only live PersonalMap previewをField-test APKで再検証
2. **Issue #3 / smoke再試験**: 起動、権限、notification、数分のscreen-off記録、marker、終了、再起動を確認
3. **Issue #42**: thin trackとaccuracy-aware explored corridor / coverage cellsを実端末比較
4. **Issue #3 / baseline**: 30分以上のforeground・画面ON runを記録
5. **Issue #3 / core test**: 同等ルートでbackground・画面OFF・ポケットrunを記録し、gap、accuracy、accepted/rejected、batteryを比較
6. **Issue #3 / resilience**: notification復帰、process recreation、permission変更、battery saver、recents dismissal、OEM差を追加測定
7. **Issue #4**: 10件の実探索でPassive-first UXと「育つ白紙地図」の価値をGo / Narrow / Stop判定
8. **Issue #19**: `react-native-svg` rendererを実機評価・移行
9. **Issue #22**: GPX / GeoJSON / lossless bundleを実装
10. M0の価値を確認した後、**Issue #5**でポケット内PDRをGo / Narrow / Stop判定
11. PDR判定後にGPSなし探索とanchor transformの製品統合範囲を決める

## 今はやらないこと

- 正確な壁、部屋、道幅の自動推定
- カメラ常時起動、AR、LiDARスキャン
- ソーシャル、ランキング、広告、クラウド同期
- 収集、実績、物語などのゲーム本体
- OpenStreetMap等への編集投稿
- 「山」「街」「建物」など用途別モードの増殖
- 二つ目のappがない段階での動的plugin loaderやnpm package公開
- 精度未検証PDRの既定有効化
- 自動telemetry / analytics service
- Google道路へmap matchingした結果をPersonalMapの正本にすること

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
