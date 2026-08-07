# AGENTS.md

このリポジトリは「受動的な個人探索マッピング」を実装する。

## Required reading order

実装・設計・Issue分解を始める前に、次の順序で読む。

1. `PRODUCT_CONSTITUTION.md` — 変更してはいけない製品目的と境界
2. `CURRENT_DIRECTION.md` — 現在のマイルストーンと短期優先順位
3. 関連するAccepted ADRs
4. `docs/PRODUCT.md`、`docs/UX_PRINCIPLES.md`、`docs/ARCHITECTURE.md`
5. `docs/FEATURE_PLACEMENT.md` — core / engine / adapter / renderer / gameの配置規則
6. 対象Issue、関連PR、実験文書

`CURRENT_DIRECTION.md`、Issue、PR、実装が憲章と矛盾する場合は、下位文書を優先してはならない。実装都合で憲章を暗黙に変更せず、専用IssueとADRで明示する。

## Product invariants

`PRODUCT_CONSTITUTION.md` が正本である。特に次を毎回確認する。

1. 一度の探索で地図ができる。複数回通過を登録条件にしない。
2. 通常利用では、探索中にスマホを見続けたりカメラを構えたりさせない。
3. 場所の種類をプロダクト定義にしない。山、街、建物、会場などは例でしかない。
4. 生の位置・センサー観測は証拠として保持し、フィルタ済み地図は派生物にする。
5. 精度や接続に不確実性がある場合はUIで隠さない。
6. 個人地図は複数の探索セッションから育て、未観測区間を偽接続しない。
7. ゲーム、実績、Fog、ストーリーは交換可能な拡張。mapping-coreの真実を書き換えない。
8. 既存地図やクラウドは必須依存にしない。
9. 独自価値のない部品はOSS・標準・プラットフォームを先に調査する。
10. 位置履歴は高感度データとしてlocal-firstを既定にする。

## Before implementation

IssueまたはPRに次を残す。該当しない場合も理由を書く。

- 解くユーザー問題
- Passive-first UXへの影響と追加操作時間
- 変更する地図レイヤー: raw evidence / derived map / manual correction / inference / game overlay
- 責務分割: core / engine / adapter / renderer / experience-game
- Build / Adopt / Benchmark判断と確認した既存アプリ・OSS・標準・研究
- ゲームなしでマッピング機能が成立するか
- 位置履歴、共有、安全への影響
- 成功条件、失敗条件、停止またはロールバック条件
- 憲章への適合、または憲章変更が必要か

「複数画面や複数アプリから使いそう」だけを理由にcoreへ入れない。機能名ではなく、地図の真実に対する権限で分割する。1つの機能が複数層へ分かれてよい。

## Layer ownership

### `packages/mapping-core`

- raw evidence、ExplorationSession、PersonalMap、quality、frame、segment、marker、uncertainty、domain event
- 純粋TypeScriptのみ
- React、Expo、SQLite、renderer、game stateを参照しない

### `packages/mapping-engine`

- appが使うheadless command / query facade
- map / exploration lifecycle、transaction、repository / tracking port、event publication
- 地図への唯一の書き込み窓口
- mutable sessionやcore mutationをapp / gameへ公開しない

### Platform adapters

- OS、sensor、DB、file、network
- 観測と保存を担うが、map truthや報酬を決めない

### Renderer

- read-only snapshotの表示
- 編集候補は作れても、確定はengine command経由

### Experience / game

- read-only snapshotとeventから別管理のstate、overlay、cueを生成
- raw、accepted / rejected、基本track、marker evidenceを直接変更しない
- 地図修正はユーザー確認後にappがengine commandへ変換する

## Engineering rules

- 現在のスコープは、憲章の範囲内で `CURRENT_DIRECTION.md` を正本とする。
- 新しい位置推定方式は `TrackingProvider` 境界の内側に実装する。
- 地図の真実と不変条件は `packages/mapping-core` の純粋TypeScriptへ置く。
- 複数のcore操作と永続化を伴うユーザー操作は `mapping-engine` のcommand / queryにする。
- future `apps/game-*` はcore mutationを直接importせず、engineとexperience-sdkを使う。
- 推定結果をrawテーブルへ上書きしない。
- UI操作を増やす変更には、`docs/UX_PRINCIPLES.md` の中断コスト確認を書く。
- 実験的精度の機能は既定で有効にせず、計測方法と停止条件を先に文書化する。
- 大きなフレームワーク、認証、バックエンド、plugin systemを「将来使うかもしれない」だけで追加しない。
- 標準アルゴリズムや一般部品を自作する場合は、既存OSSを採用しない理由とライセンス判断を記録する。
- テストは重要な変換・品質判定・application transaction・アーキテクチャ境界を中心に必要十分に保つ。

## Constitution changes

`PRODUCT_CONSTITUTION.md` の変更は通常の機能変更ではない。次が揃うまで変更しない。

- リポジトリ所有者の明示承認
- 専用Issue
- Build / Buy再評価
- 新規ADR
- データ、UX、ゲーム境界、プライバシーへの移行影響
- 関連テンプレートとガードレールの同時更新

変更が承認されていない場合は、憲章を実装へ合わせず、実装を憲章へ合わせる。

## Required checks

```bash
node scripts/check-product-governance.mjs
node scripts/check-architecture-boundaries.mjs
npm test
npm run typecheck
```

モバイル変更は可能な範囲でAndroid実機の以下も記録する。

- 画面ON / OFF
- アプリ前面 / 背面
- 権限: 正常 / 拒否 / 後から変更
- 30分以上の継続
- 通知からの復帰
- 強制終了後の表示
