# Current Direction

更新日: 2026-08-07

> この文書は短期的な開発方針であり、恒久的な製品目的と境界は [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) を正本とする。両者が矛盾する場合は憲章を優先し、この文書を修正する。

## 現在のマイルストーン

**M0: Passive Mapping Vertical Slice — Android実機成立性の検証へ移行**

次の体験を、バックグラウンドGNSSが利用できるAndroid実機で成立させる。

- 一回押して探索開始
- 画面OFF・ポケット内で継続記録
- 必要時だけクイックマーカー
- 終了後、既存地図なしのPersonalMapを表示
- アプリ再起動後も探索が残る
- 異常位置をraw evidenceから削除せず、derived mapだけから除外
- 次回、同じPersonalMapへ独立したExplorationSessionとして続きを追加
- session間を未観測の直線で接続しない

## 現在の到達点

### Product / governance

- `PRODUCT_CONSTITUTION.md`を恒久的な正本として運用
- Issue / PRテンプレート、AGENTS、CIでPassive-first UX、map truth、canonical write、OSS再利用、game境界を確認
- `CURRENT_DIRECTION.md`は憲章を上書きできない短期文書として分離

### Mapping architecture

- `mapping-core`: raw evidence、quality、frame、ExplorationSession、PersonalMap aggregate
- `mapping-engine`: canonical command / queryを実行するheadless application boundary
- `sqlite-adapter`: DB v1をPersonalMap / ExplorationSessionへ無損失移行し、raw evidenceからreplay
- platform adapters: foreground / background GNSSをengineへ接続
- renderer: PersonalMapSnapshotをread-only表示
- `experience-sdk`: game state、overlay、cueだけを生成するread-only境界

### User experience

- Homeの主語を日付別GPSログからPersonalMapへ変更
- 複数ExplorationSessionを別segmentとして1枚の地図に表示
- `この地図の続きを探索`を追加
- 続きの権限画面で、追加対象のPersonalMapを明示
- local-coordinate PersonalMapへ未アンカーGNSSを追加しない
- 探索中のライブ地図常設、場所カテゴリ選択、ゲーム要素は追加していない

### Boundary hardening

- UI、renderer、game、experienceはcanonical mapを直接変更できない
- `TrackingProviderPort`は`geographic` / `local` capabilityを宣言
- PersonalMapとのframe互換性を、DB writeとprovider startより前にmapping-engineで検査
- geographic / local、異なるlocal frameを暗黙混在させない
- mobile側の確認はUX補助、engine側が最終防衛線

### OSS / standards

- 部品別のBuild / Adopt / Benchmarkとlicenseを`docs/OSS_REUSE_AUDIT.md`へ記録
- 局所投影の推奨範囲と反日付変更線処理をテスト化
- renderer、簡略化、export、PDRは既存OSS・標準を比較してから実装
- 一般部品を「将来必要かもしれない」だけで先行導入しない

## 現在の未検証部分

コードと静的検査は成立しているが、次はまだ実機で確認していない。

- Android development buildが再現可能に作れること
- foreground / background権限の実際の導線
- 画面OFF・ポケット内で30〜60分記録が続くこと
- OS・端末メーカーによる停止、復帰、通知挙動
- 欠落率、位置精度、異常ジャンプ、電池消費
- 発見入力が探索を中断しすぎないこと
- 白紙のPersonalMapが通常のGPSログ以上の価値を持つこと

したがって、現時点で「実機MVP完成」とは判定しない。

## 次の順序

1. **Issue #2**: lockfile、Expo Doctor、Android development buildを再現可能にする
2. **Issue #17**: 初回tracking開始失敗時に空PersonalMapを残さないcanonical compensationを実装する
3. **Issue #3**: background GNSSの欠落、精度、電池、権限、プロセス終了を実機計測する
4. **Issue #4**: 10件の実探索でPassive-first UXと「育つ白紙地図」の価値をGo / Narrow / Stop判定する
5. **Issue #19**: 実機表示基盤として`react-native-svg` rendererを評価・移行する
6. **Issue #20 / #22**: 簡略化OSS比較とGPX / GeoJSON / lossless bundle境界を実装する
7. M0の価値を確認した後、**Issue #5**でポケット内PDRをGo / Narrow / Stop判定する
8. PDR判定後にGPSなし探索とanchor transformの製品統合範囲を決める

## 今はやらないこと

- 正確な壁、部屋、道幅の自動推定
- カメラ常時起動、AR、LiDARスキャン
- ソーシャル、ランキング、広告、クラウド同期
- 収集、実績、物語などのゲーム本体
- OpenStreetMap等への編集投稿
- 「山」「街」「建物」など用途別モードの増殖
- 二つ目のappがない段階での動的plugin loaderやnpm package公開
- 精度未検証PDRの既定有効化

## 変更してはいけない原則

以下は要約であり、完全な定義と変更手続きは `PRODUCT_CONSTITUTION.md` に従う。

- 一回目で地図を作る。再訪は登録条件ではなく補正材料。
- 探索中の主役は現実空間であり、画面ではない。
- マップの正本はユーザーの探索証拠。
- ExplorationSessionは証拠の単位、PersonalMapは複数sessionから育つ集約。
- 既存地図は任意の補助レイヤー。
- 不確かな推定を、確かな地物や接続として描かない。
- canonicalな地図変更は明示的なapplication boundaryを通す。
- UI、renderer、game、experienceはcanonical mapを直接変更しない。
- game / experienceはread-onlyで、地図修正はユーザー確認後の明示commandにする。
- 独自価値のない一般部品はOSS・標準・platformを先に調査する。
- 位置履歴は高感度かつユーザー所有で、local-firstを既定にする。
