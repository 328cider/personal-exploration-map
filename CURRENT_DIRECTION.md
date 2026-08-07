# Current Direction

更新日: 2026-08-07

> この文書は短期的な開発方針であり、恒久的な製品目的と境界は [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md) を正本とする。両者が矛盾する場合は憲章を優先し、この文書を修正する。

## 現在のマイルストーン

**M0: Passive Mapping Vertical Slice**

バックグラウンドGNSSが利用できる環境で、次を端末実機で成立させる。

- 一回押して探索開始
- 画面OFF・ポケット内で継続記録
- 必要時だけクイックマーカー
- 終了後、既存地図なしの個人経路地図を表示
- アプリ再起動後も探索が残る
- 異常位置を生データから削除せず、派生経路だけから除外
- 次回、同じPersonalMapの続きを探索できる

## 現在のアーキテクチャ到達点

マッピング能力を将来のゲームアプリから再利用できるようにしつつ、すべてを巨大なcoreへ入れない境界はmainへ反映済み。

- `mapping-core`: 地図の真実と純粋なdomain規則
- `mapping-engine`: canonical command / queryを実行するheadless application boundary
- `sqlite-adapter`: raw evidenceを保存しPersonalMapをreplayするlocal-first repository
- platform adapters: GNSS、PDR、file
- renderer: read-only map表示
- `experience-sdk`: game state、overlay、cueだけを生成するread-only境界

機能配置は [`docs/FEATURE_PLACEMENT.md`](docs/FEATURE_PLACEMENT.md) に従い、再利用回数ではなく地図データへの権限で判断する。

## 現在の作業

Issue #1を次の小さな段階へ分けて進める。

1. **完了**: 複数ExplorationSessionをsegment付きPersonalMapへ集約するmapping-core
2. **完了**: canonical commandを実行するheadless mapping-engine
3. **検証中**: DB v1を無損失でPersonalMap / ExplorationSessionへ移行するSQLite repository（PR #15）
4. **次**: `apps/mobile`の記録開始、位置取込、marker、終了をmapping-engine commandへ移行
5. **次**: Homeを探索履歴中心からPersonalMap中心へ変更
6. **次**: `この地図の続きを探索`と複数segment Reviewを実装

## 今はやらないこと

- 正確な壁、部屋、道幅の自動推定
- カメラ常時起動、AR、LiDARスキャン
- ソーシャル、ランキング、収集、実績
- 既存地図への投稿やOpenStreetMap編集
- クラウド同期、アカウント、ユーザーデータ基盤
- 「山」「街」「建物」など用途別モードの増殖
- 二つ目のappがない段階での動的plugin loaderやnpm package公開

## 次の順序

1. PR #15のSQLite migration / repository / mobile static validationを完了する
2. Issue #1でmobile write pathをmapping-engineへ統一し、PersonalMap-first UIを接続する
3. Issue #7で描画、簡略化、測地計算、export形式のOSS再利用判断を完了する
4. Issue #2でlockfile、Expo Doctor、Android development buildを再現可能にする
5. Issue #3でバックグラウンドGNSSの欠落、電池、権限拒否、プロセス終了時の挙動を実機計測する
6. Issue #4で実探索10件から「受動記録」と「育つ白紙地図」の有用性を評価する
7. M0の価値を確認した後、Issue #5でポケット内PDRをGo / Narrow / Stop判定する
8. PDR判定後にGPSなし探索を製品へ統合する範囲を決める

## 変更してはいけない原則

以下は要約であり、完全な定義と変更手続きは `PRODUCT_CONSTITUTION.md` に従う。

- 一回目で地図を作る。再訪は登録条件ではなく補正材料。
- 探索中の主役は現実空間であり、画面ではない。
- マップの正本はユーザーの探索証拠。探索セッションは証拠の単位で、個人地図は複数セッションから育つ集約。
- 既存地図は任意の補助レイヤー。
- 不確かな推定を、確かな地物として描かない。
- canonicalな地図変更は明示的なapplication boundaryを通す。
- UI、renderer、game、experienceはcanonical mapを直接変更しない。
- game / experienceはread-onlyで、地図修正はユーザー確認後の明示commandにする。
- 独自価値のない一般部品はOSS・標準・platformを先に調査する。
