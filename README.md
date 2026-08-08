# Personal Exploration Map

> **歩いたぶんだけ、自分の地図になる。**

現実空間を普通に探索している間の移動を受動的に記録し、必要なときだけ発見を入力することで、**自分が実際に知った空間だけを自分専用の地図として育てる**モバイルアプリです。

これは既存地図の訪問履歴アプリでも、測量用GISでも、カメラを構えて作るフロアスキャンアプリでもありません。地図の正本は既存の世界地図ではなく、ユーザー自身の探索記録です。

## 開発時の正本

長期間あいた後や新機能を追加する前は、次の順序で確認します。

1. [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) — 恒久的な製品目的、地図の真実、受動UX、ゲーム境界、OSS再利用方針
2. [`CURRENT_DIRECTION.md`](CURRENT_DIRECTION.md) — 現在のマイルストーンと短期優先順位
3. [`docs/adr/`](docs/adr/) — 長期設計判断
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — packageと依存方向
5. [`docs/FEATURE_PLACEMENT.md`](docs/FEATURE_PLACEMENT.md) — 新機能をcore / engine / adapter / renderer / gameへ分ける規則
6. [`docs/PDR_TECHNOLOGY_GATE.md`](docs/PDR_TECHNOLOGY_GATE.md) — GPS-denied軌跡推定を始める条件、実験境界、Go / Narrow / Stop基準
7. [`AGENTS.md`](AGENTS.md) — 開発者・エージェントの実行手順

短期方針、Issue、PR、実装は製品憲章を暗黙に上書きできません。憲章変更には、所有者承認、専用Issue、Build / Buy再評価、新規ADR、移行影響評価が必要です。

## 現在の判断

既存製品で十分なのは次の用途です。

- 既存地図の上で訪問済み領域を開放する: Fog of World / Stomped など
- GPSの足跡とピンを残す: Crumb Trails など
- 点・線・面を専門的に手動作図する: QField / SW Maps など
- カメラやLiDARを構えて屋内平面図を作る: Mappedin / magicplan など

一方、次の組み合わせは、調査した一般向け製品では満たされていませんでした。

1. 白紙またはローカル座標の**個人地図**が正本
2. 探索中はスマホをポケットに入れる**受動記録**
3. 一度歩いただけで、その場で地図になる
4. GPSが使える場所と使えない場所を同じデータモデルで扱う
5. 意味づけは必要なときだけ、短い操作で追加する
6. ゲーム要素は地図コアを汚さない交換可能な拡張

したがって、自作対象は「別のGPSロガー」ではなく、この未充足の組み合わせに限定します。詳細は [競合・研究調査](docs/COMPETITIVE_RESEARCH.md) と [製品定義](docs/PRODUCT.md) を参照してください。

## 開発中の最小プロダクト

現在の縦切りは次の体験です。

1. `新しい地図を探索する`を押す
2. スマホをポケットにしまう
3. 移動がバックグラウンドで記録される
4. 必要なときだけアプリを開き、育っているPersonalMapを確認する
5. 必要なときだけ`発見を記録`する
6. `探索を終了して地図を見る`で、PersonalMapへ1つのExplorationSessionとして追加する
7. Homeでは日付別ログではなくPersonalMapを一覧する
8. Reviewでは複数sessionを偽接続せず別segmentとして表示する
9. `探索範囲 / セル / 軌跡`を切り替え、移動履歴と探索済み空間を比較する
10. `この地図の続きを探索`から同じPersonalMapを育てる

屋内の高精度自動マッピングは、製品完成を前提にせず、独立した技術検証にします。最初にバックグラウンドGNSSを使える環境で価値を検証し、GPSなしのポケット内測位はGo / Narrow / Stop判定を経て追加します。

## リポジトリ構成

```text
apps/mobile/                  Reference explorer app（Expo / React Native）
packages/mapping-core/        地図の真実と純粋なdomain kernel
packages/mapping-engine/      Appが呼ぶheadless command / query facade
packages/sqlite-adapter/      Raw evidenceを保存するlocal-first repository adapter
packages/experience-sdk/      Game向けread-only snapshot / event境界
docs/                         製品、UX、設計、検証計画、ADR
scripts/                      ガバナンス、境界検査、Android emulator E2E
```

## 設計上の境界

```text
Explorer / future game apps
        │ commands / queries
        ▼
Headless mapping-engine       ← canonical mapの制御された書き込み境界
        │
        ├── mapping-core      ← raw evidence / session / PersonalMap / uncertainty
        ├── repository port   ← sqlite-adapter等が実装
        └── tracking port     ← GNSS / PDR等のadapterが実装

Read-only PersonalMap snapshot / MappingEvent
        ├── renderer
        └── experience-sdk / game state / overlay
```

- 生の観測値は失わず保存します。
- 表示経路や探索領域は再生成可能な派生物です。
- 推定した壁や部屋を事実として扱いません。
- UI、renderer、game、experienceはcanonical mapを直接変更しません。
- ゲームは地図を読み、別stateとoverlayを生成します。
- ゲームから地図修正を提案する場合、ユーザー確認後にengine commandへ変換します。
- 「複数アプリで使いそう」だけを理由にcoreへ入れません。

## 保存モデル

```text
PersonalMap
  ├─ ExplorationSession 1
  │    ├─ raw position samples
  │    └─ confirmed markers
  └─ ExplorationSession 2
       ├─ raw position samples
       └─ confirmed markers
```

DBにはraw observationsと確認済みmarkerを保存し、PersonalMap snapshotはreplayして再生成します。旧DBの`Exploration = 地図1枚`データは、同じIDのPersonalMapへ無損失で昇格させます。

## WindowsでのDocker-only検証

Windows hostへNode.js、npm、JDK、Android SDK、Android Studioを必須導入しません。Docker Desktopが動作しているrepository rootで実行します。

```powershell
git switch main
git pull --ff-only
docker compose build
docker compose run --rm check
```

短いdevelopment確認でMetroが必要な場合だけ、Docker内で起動します。

```powershell
.\scripts\docker-metro.ps1
```

実地試験にはMetroを使わず、GitHub Actionsで生成したJS bundle内蔵のField-test APKを使用します。詳細は [`docs/DOCKER_AND_FIELD_TEST.md`](docs/DOCKER_AND_FIELD_TEST.md) を参照してください。

## Android Field-test APKと必須エミュレータゲート

`devex-field-test` workflowは、committed lockfileから次を実行します。

1. Docker mobile check
2. Expo prebuild
3. Gradle release APK build
4. JS bundle内包、署名、SHA-256確認
5. Android 15 / API 35 emulatorへ同じAPKをclean install
6. 黒箱ユーザーフローE2E

エミュレータでは次を確認します。

- 起動、Home、権限説明、探索開始
- 擬似GNSSでのlive PersonalMap成長
- background・画面OFF相当と復帰
- 探索終了からReview
- force-stop後の永続化
- 探索範囲 / セル / 軌跡の切替
- foreground-service notificationの表示内容
- notificationから記録中画面への復帰
- 発見modal、marker保存、発見数更新、Reviewへの永続化
- Fatal、React Native JS、Expo SQLite native statement errorがないこと

エミュレータ不合格のAPKを実地試験候補として渡しません。エミュレータ合格は実GNSS、長時間画面OFF、OEM省電力、電池、ポケット内UXまで保証しないため、それらだけを実端末で確認します。詳細は [`docs/ANDROID_EMULATOR_E2E.md`](docs/ANDROID_EMULATOR_E2E.md) を参照してください。

テストハーネスだけを変更した場合は、`emulator-harness-only` workflowが同一PRで生成済みの署名APKを再利用し、不要なGradle再ビルドを避けます。

## Tracking diagnostics

Field-test buildのPersonalMap Reviewには、受動記録を判断するための端末内診断を表示します。

- raw / accepted / rejectedと理由
- horizontal accuracy
- sample gaps
- callback received / persisted / duplicate / failed
- provider start / stop
- app background / foreground / recovery
- marker入力時間

診断eventはmap truthではありません。採否と経路はraw observationsから再計算し、診断保存失敗でraw位置記録を止めません。座標、地図名、marker本文、絶対時刻を含めない集計だけを共有できます。実機runは [`docs/experiments/templates/background-gnss-run.md`](docs/experiments/templates/background-gnss-run.md) に記録します。

## PDR / GPS-deniedの扱い

詳細調査の結論を [`docs/PDR_TECHNOLOGY_GATE.md`](docs/PDR_TECHNOLOGY_GATE.md) とIssue #5へ固定しています。

- 一般的なIMU-only GPS代替はStop寄り
- 100〜300m、アンカー間、短いGNSS欠落補完はNarrow候補
- 最も合理的な候補は`sparse GNSS + manual anchor + uncertainty-aware PDR`
- 最初にAndroidへ学習モデルを入れない
- Kotlin native raw sensor loggerとimmutable / replayable evidenceから始める
- 同じraw logをStep Detector、classical PDR、RoNIN、EqNIO、sparse-GNSS hybridへreplayする
- high-rate IMUをmapping-coreやJS bridgeへ直接流さない
- learned model、map matching、smoothingはderived inferenceであり、PersonalMap truthを上書きしない

Issue #5はIssue #3と#4にblockedです。GNSS M0とマッピング単体の価値が未確認のまま、PDRを既定機能にしません。

## 現在の到達点

- 製品憲章、競合判断、UX原則、アーキテクチャ、機能配置規則を文書化
- 位置ソースに依存しないmapping-coreを実装
- ExplorationSessionと、複数sessionから育つPersonalMap aggregateを分離
- canonical commandを実行するheadless mapping-engineを実装
- 初回provider開始失敗時に、evidenceのないprovisional PersonalMapだけを安全に補償削除
- repository transaction完了後だけread-only MappingEventを公開
- DB v1からPersonalMap / ExplorationSessionを分離したschemaへ無損失移行
- 実SQLiteでraw保持、foreign-key、rollback、multi-session replayを検証
- foreground / background / marker / end / demoのmobile writeをmapping-engineへ統一
- HomeとReviewをPersonalMap-firstへ変更
- 複数sessionを偽接続せず別segmentとして描画
- foreground-only live map previewを追加
- 探索範囲 / セル / 軌跡の比較表示を追加
- frame互換性をprovider開始前にmapping-engineで強制
- game contractをmapping-coreからread-only experience-sdkへ分離
- background GNSSの端末内diagnosticsとrun templateを実装
- Android Field-test APKのビルド、署名、黒箱E2Eを自動化
- emulator E2EからExpo SQLite raceと操作到達性の問題を検出・修正
- notification、marker、終了、再起動保持を実地試験前に自動検証
- PDRを製品実装ではなくreplay-first技術ゲートとして正本化

次の作業は [CURRENT_DIRECTION.md](CURRENT_DIRECTION.md) に集約します。ただし、恒久的な境界は [PRODUCT_CONSTITUTION.md](PRODUCT_CONSTITUTION.md) が優先します。
