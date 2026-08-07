# Product Roadmap

## Phase 0 — Definition and architecture

完了条件:

- Build / Buy判断
- passive-first UX原則
- game / mapping分離
- raw / derived分離
- 技術ゲートの明文化

状態: 完了

## Phase 1 — Outdoor-capable passive vertical slice

目的は「GPSアプリを作ること」ではなく、受動探索と白紙個人地図の体験が価値を持つかを最短で確認すること。

- Android development build
- background GNSS
- local-only SQLite
- quick marker
- blank track review
- permission / interruption recovery
- dogfood sessions

Go条件:

- 実際にスマホをしまって利用できる
- 終了後の地図を見返す価値がある
- マーカー操作が探索の邪魔にならない
- 既存GPSログとの差が言語化できる

## Phase 2 — Pocket PDR experiment

Android-firstで実施する。製品機能として約束する前に、再現可能なログと評価を作る。

結果の分岐:

- **Go**: ローカル経路を通常機能へ統合
- **Narrow**: 手動アンカーや短距離 backtracking に限定
- **Stop**: GPSなし自動経路を見送り、手動トポロジーに切り替える

## Phase 3 — Personal map continuity

- 探索の再開と接続
- 複数階
- 手動アンカー
- 不確実性編集
- エクスポート / インポート
- 任意の既存地図オーバーレイ

## Phase 4 — Replaceable experience layers

- Fog of War
- 探索率
- 発見コレクション
- 実績
- テーマ / ストーリー

ゲーム指標がマッピングの正確さや安全性を上書きしないことをリリース条件にする。
