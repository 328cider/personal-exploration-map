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
6. [`AGENTS.md`](AGENTS.md) — 開発者・エージェントの実行手順

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
3. 一度歩いただけで、その場で経路が地図になる
4. GPSが使える場所と使えない場所を同じデータモデルで扱う
5. 意味づけは必要なときだけ、短い操作で追加する
6. ゲーム要素は地図コアを汚さない交換可能な拡張

したがって、自作対象は「別のGPSロガー」ではなく、この未充足の組み合わせに限定します。詳細は [競合・研究調査](docs/COMPETITIVE_RESEARCH.md) と [製品定義](docs/PRODUCT.md) を参照してください。

## 開発中の最小プロダクト

現在の縦切りは次の体験です。

1. `新しい地図を探索する`を押す
2. スマホをポケットにしまう
3. 移動がバックグラウンドで記録される
4. 必要なときだけ`発見を記録`する
5. `探索を終了`すると、PersonalMapへ1つのExplorationSessionとして追加される
6. Homeでは日付別ログではなくPersonalMapを一覧する
7. Reviewでは複数sessionを偽接続せず別segmentとして表示する
8. `この地図の続きを探索`から同じPersonalMapを育てる

屋内の高精度自動マッピングは、製品完成を前提にせず、独立した技術検証にします。最初にバックグラウンドGNSSを使える環境で価値を検証し、GPSなしのポケット内測位はGo / Narrow / Stop判定を経て追加します。

## リポジトリ構成

```text
apps/mobile/                  Reference explorer app（Expo / React Native）
packages/mapping-core/        地図の真実と純粋なdomain kernel
packages/mapping-engine/      Appが呼ぶheadless command / query facade
packages/sqlite-adapter/      Raw evidenceを保存するlocal-first repository adapter
packages/experience-sdk/      Game向けread-only snapshot / event境界
docs/                         製品、UX、設計、検証計画、ADR
scripts/                      ガバナンスと依存方向の検査
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

## 再現可能なローカル検証

Node.jsは`.nvmrc`、dependency graphは`package-lock.json`を正本にします。repository rootで実行します。

```bash
npm ci
npm run check
npm run typecheck:mobile
npm run check:expo
```

全体をまとめて確認する場合:

```bash
npm run mobile:check
```

通常のsetupでは`npm install`へ置き換えず、dependency変更を意図するPRだけがmanifestとlockfileを同時に更新します。

## Android development build

バックグラウンド位置記録はExpo Goではなく、app固有のdevelopment buildで検証します。

```bash
npm ci
npm run mobile:check
npm run mobile:android
```

Windows、Android Studio、USB debugging、GitHub Actionsのdebug APK、Issue #3の実機runについては [`docs/ANDROID_DEVELOPMENT.md`](docs/ANDROID_DEVELOPMENT.md) を参照してください。

GitHub Actionsの`android-development-build`は、committed lockfileからExpo prebuildとGradle `assembleDebug`を行い、debug APKを短期間のartifactとして保存します。build成功は、画面OFF・電池・OEM差まで保証しないため、実端末の判定は別途行います。

## Tracking diagnostics

Development buildのPersonalMap Reviewには、受動記録を判断するための端末内診断を表示します。

- raw / accepted / rejectedと理由
- horizontal accuracy
- sample gaps
- callback received / persisted / duplicate / failed
- provider start / stop
- app background / foreground / recovery
- marker入力時間

診断eventはmap truthではありません。採否と経路はraw observationsから再計算し、診断保存失敗でraw位置記録を止めません。実機runは [`docs/experiments/templates/background-gnss-run.md`](docs/experiments/templates/background-gnss-run.md) に記録します。

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
- frame互換性をprovider開始前にmapping-engineで強制
- game contractをmapping-coreからread-only experience-sdkへ分離
- background GNSSの端末内diagnosticsとrun templateを実装
- 屋内PDRは検証前提のportとして分離

次の作業は [CURRENT_DIRECTION.md](CURRENT_DIRECTION.md) に集約します。ただし、恒久的な境界は [PRODUCT_CONSTITUTION.md](PRODUCT_CONSTITUTION.md) が優先します。
