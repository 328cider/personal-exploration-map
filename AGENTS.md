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
7. export / import / share / backupを扱う場合は`docs/EXPORT_BOUNDARY.md`

`CURRENT_DIRECTION.md`、Issue、PR、実装が憲章と矛盾する場合は、下位文書を優先してはならない。実装都合で憲章を暗黙に変更せず、専用IssueとADRで明示する。

## Product invariants

`PRODUCT_CONSTITUTION.md` が正本である。特に次を毎回確認する。

1. 一度の探索で地図ができる。複数回通過を登録条件にしない。
2. 通常利用では、探索中にスマホを見続けたりカメラを構えたりさせない。
3. 場所の種類をプロダクト定義にしない。山、街、建物、会場などは例でしかない。
4. 生の位置・センサー観測は証拠として保持し、フィルタ済み地図は派生物にする。
5. 精度や接続に不確実性がある場合はUIで隠さない。
6. 個人地図は複数の探索セッションから育て、未観測区間を偽接続しない。
7. canonicalな地図への変更は明示的なapplication boundaryを通し、UI・renderer・game・experienceへ直接mutation権限を渡さない。
8. ゲーム、実績、Fog、ストーリーは交換可能なread-only拡張。地図の真実を書き換えない。
9. 既存地図やクラウドは必須依存にしない。
10. 独自価値のない部品はOSS・標準・プラットフォームを先に調査する。
11. 位置履歴は高感度データとしてlocal-firstを既定にする。

## Before implementation

IssueまたはPRに次を残す。該当しない場合も理由を書く。

- 解くユーザー問題
- Passive-first UXへの影響と追加操作時間
- 変更する地図レイヤー: raw evidence / derived map / manual correction / inference / game overlay
- canonical mapを書き換える主体と、通過する明示command / application boundary
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
- 現在採用している地図への唯一の書き込み窓口
- mutable sessionやcore mutationをapp / gameへ公開しない
- read-only serializerは置けるが、file system、share sheet、React Native、Expo、SQLite、Node runtimeへ依存しない

`mapping-engine`という名称やAPIはADRで変更できるが、canonical writeを制御されたapplication boundaryへ集約する憲章原則は維持する。

### Platform adapters

- OS、sensor、DB、file、network
- 観測と保存を担うが、map truthや報酬を決めない
- export file作成、temporary file、share sheet、platform permissionはここまたはapp shellで扱う

### Renderer

- read-only snapshotの表示
- 編集候補は作れても、確定はengine command経由

### Experience / game

- read-only snapshotとeventから別管理のstate、overlay、cueを生成
- raw、accepted / rejected、基本track、marker evidenceを直接変更しない
- 地図修正はユーザー確認後にappがengine commandへ変換する

## Export / import boundary

- GPXとgeographic GeoJSONはWGS84のgeographic PersonalMapだけを対象にする。
- local / unresolved frameを緯度経度0,0や任意のWGS84座標へ偽装しない。
- ExplorationSessionごとのsegmentを維持し、未観測区間を人工pointで接続しない。
- GPX / GeoJSONは相互運用用のderived exportであり、raw evidenceを含むbackupではない。
- `PersonalMapSnapshot`だけをJSON化してlossless bundleと呼ばない。raw / rejected / provider / frame provenanceを保持するrepository export modelを使う。
- diagnostic、uncertainty、confirmed evidence、game overlayを同一profileへ暗黙に混ぜない。
- raw位置を含むbundleはユーザーの明示操作だけで生成し、自動uploadしない。
- share sheetを自動で開かず、temporary fileを不要後に削除する。
- importしたderived snapshotをcanonical mapへ直接昇格させない。schema、hash、frame、provenanceを検証し、transactionとcanonical commandを通す。
- default filenameへ住所、地図名、正確な場所名を入れない。

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
- 実地試験はユーザーコストが高い。Android Emulatorで再現可能な起動・権限済み導線・擬似GNSS・live preview・終了・永続化を先に通す。
- `Android emulator user-flow gate`が失敗したField-test APKを、ユーザーへ実地試験候補として渡さない。
- エミュレータ合格を、実GNSS、OEM省電力、電池、ポケットUXの合格と混同しない。

## GitHub Actions budget (mandatory)

`docs/CI_BUDGET_POLICY.md` は人間、Codex、ChatGPT、その他すべての開発エージェントに適用する。

- 実装・レビュー修正・format・ローカル検証中はPRをDraftに保つ。GitHub Actionsをedit-test loopとして使わない。
- 反復中は対象テストを実行し、Readyにする前の最終headで`npm run check`を実行する。mobileまたはadapter変更では、ローカル環境が対応する限り`npm run mobile:check`も実行する。
- CIを起動するためだけのpush、未変更headのrerun、安心目的のAPK・emulator・benchmark・fixture拡張をしない。
- 通常のpackage/static/governance検証はReady PRで実行する。Docker、Field-test APK、Android Emulatorは変更分類が所有する境界だけで実行し、週次fullを分類漏れの安全網にする。
- 純粋な`mapping-core`、`mapping-engine`、`experience-sdk`変更だけを理由にAPKやemulatorを実行しない。mobile/native/SQLite/dependency/harness変更はfail-closedで必要レーンを選ぶ。
- Field-test APKのCI ABIは`arm64-v8a`と`x86_64`に限定する。明示的な対応端末要件なしに4 ABIへ戻さない。
- CIが製品不具合を検出した場合はローカルで再現・修正し、修正をまとめて1回pushする。runner、network、cache、registry、Android SDK等の具体的な外部障害がログで確認できる場合だけ失敗jobをrerunし、PRへ根拠を残す。
- workflowとCI policyの変更は`node scripts/check-ci-budget-policy.mjs`を通し、分類機構自身を軽量扱いしない。チェックを通すために規則を弱めない。

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
node scripts/check-ci-budget-policy.mjs
npm test
npm run typecheck
```

モバイルField-test候補は、GitHub Actionsで次をすべて成功させる。

- `Docker mobile check`
- `Standalone field-test APK`
- `Android emulator user-flow gate`

エミュレータE2Eの内容と証跡は `docs/ANDROID_EMULATOR_E2E.md` に従う。

エミュレータ合格後、Android実機では代替できない以下を記録する。

- 画面ON / OFF
- アプリ前面 / 背面
- 権限: 正常 / 拒否 / 後から変更
- 30分以上の継続
- 通知からの復帰
- 強制終了後の表示
- 実GNSS精度・欠落・ジャンプ
- OEM省電力と電池消費
- ポケット内の身体的UX
