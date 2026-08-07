# Product Constitution

- Status: **Durable / owner-approved**
- Established: 2026-08-07
- Scope: product purpose, map truth, UX boundaries, architecture boundaries, and build-versus-adopt philosophy

この文書は、時間がたっても失ってはいけない製品哲学を定める。現在のマイルストーンや実装方式を固定する文書ではない。

## Document hierarchy

判断が矛盾した場合は、次の順序を優先する。

1. `PRODUCT_CONSTITUTION.md` — 恒久的な製品目的と制約
2. Accepted ADRs — 憲章の範囲内での長期設計判断
3. `docs/PRODUCT.md` / `docs/UX_PRINCIPLES.md` / `docs/ARCHITECTURE.md`
4. `CURRENT_DIRECTION.md` — 現在のマイルストーンと短期的な優先順位
5. Issues / pull requests / implementation notes

下位文書は上位文書を暗黙に上書きしてはならない。矛盾を見つけた場合は、実装都合で解消せず、明示的な設計判断として扱う。

## Product purpose

**現実空間を普通に探索するだけで、自分が実際に知った部分が、自分専用の地図として残り育っていく体験を作る。**

一般的な世界地図、GPSロガー、GIS、フロアスキャン、位置ゲームの複製を目的にしない。既存製品で要求を十分満たせる場合は、自作を正当化せず既存製品を使う。

## Durable product invariants

### 1. Personal exploration evidence is the source of truth

ユーザー自身の位置・センサー観測、明示入力、確認済み接続が地図の証拠である。既存地図は任意の補助レイヤーであり、個人地図の正本ではない。

### 2. One exploration must create value

一度の探索から経路や発見を地図として残す。複数回通過を登録条件にしない。再訪は補正、接続確認、探索範囲の拡張に使う。

### 3. Reality is the primary interface

通常の探索中は、スマホを見続けたりカメラを構え続けたりさせない。開始後はポケットにしまえることを基本とし、入力は必要なときだけ短く行えるようにする。

### 4. Uncertainty must not be disguised as fact

推定した壁、道、部屋、接続、位置を、観測済みの事実として描かない。raw evidence、accepted/rejected、derived track、manual correction、optional inferenceを区別できるようにする。

### 5. A personal map grows across exploration sessions

1回の記録は `ExplorationSession`、長期的に育つ地図は `PersonalMap` として分離する。セッション間を、実際に移動した証拠なしに直線で接続しない。座標系を統合する場合は、地理座標または明示的なanchorを根拠にする。

### 6. Game mechanics are replaceable experience layers

Fog、探索率、実績、収集、ストーリー、テーマは任意の上位レイヤーとする。ゲーム都合でraw evidence、accepted/rejected判定、基本経路、ユーザーの発見を変更してはならない。ゲームを無効化してもマッピングアプリとして成立させる。

### 7. Adopt commodity capabilities before rebuilding them

OS位置取得、保存、描画、測地計算、標準アルゴリズム、交換形式など、独自価値でない部品は既存OSS・標準・プラットフォームを先に調査する。各重要部品について `Adopt / Build / Benchmark` の判断とライセンスを明示する。既存部品が要求を満たすなら再実装しない。

### 8. Location history is sensitive and user-owned

MVPはlocal-firstを既定とし、アカウントやクラウドを必須にしない。同期、共有、ランキング、分析を導入する前に、明示的同意、削除、エクスポート、保持期間、暗号化、漏えい影響を設計する。

### 9. Place categories are examples, not product modes

街、建物、施設、自然地帯、イベント会場などは利用例であり、製品定義ではない。内部技術上の差を、必要なくユーザーへモード選択として押し付けない。

### 10. Technical uncertainty is resolved by experiments, not optimism

バックグラウンド記録、PDR、電池、精度、端末差などの不確実な機能は、成功条件と停止条件を先に定めて計測する。成立しない場合は `Go / Narrow / Stop` を判断し、精度未検証の機能を既定で有効化しない。

## Non-goals protected by this constitution

次を、目先の機能追加だけを理由に中心目的へ昇格させない。

- Google Maps等の汎用ナビゲーションの代替
- 測量・救助・安全保証に使える正確な図面
- 常時カメラ撮影を前提とするマッピング
- 位置履歴SNS、ランキング、広告基盤の先行実装
- 特定の場所カテゴリ専用アプリへの早期分岐
- ゲーム継続率のために地図の真実や安全性を歪めること

## Required review for every product or architecture change

IssueまたはPRで、少なくとも次を明示する。

1. **User problem** — どの探索上の問題を解くか
2. **Passive-first UX** — ポケット利用を維持できるか、操作と中断時間は増えるか
3. **Map truth** — raw evidence、derived map、manual correction、inference、game overlayのどれを変更するか
4. **Build / Adopt / Benchmark** — 既存アプリ、OSS、標準、研究で代替できないか
5. **Game boundary** — ゲームなしでもマッピングが成立するか
6. **Privacy and safety** — 位置履歴、共有、歩行中操作、危険誘導への影響
7. **Validation** — 成功条件、失敗条件、ロールバックまたは停止判断
8. **Constitution impact** — 憲章に適合するか、変更を要求するか

## Constitution change protocol

この憲章は不変ではないが、通常の機能PRのついでに変更してはならない。変更にはすべて次を必要とする。

1. リポジトリ所有者による明示的な承認
2. 変更理由とユーザー価値を記した専用Issue
3. 既存製品・OSS・研究を踏まえたBuild / Buy再評価
4. `docs/adr/` の新規ADR（変更前後、代替案、影響、移行、撤回条件を記録）
5. rawデータ、既存地図、UI/UX、ゲーム拡張、プライバシーへの移行影響の評価
6. 関連するAGENTS、Issue/PRテンプレート、テスト、設計文書の同時更新
7. 憲章変更だけを明確にレビューできるPR、または他の変更から独立したコミット範囲

承認されるまでは、実装側を憲章に合わせる。憲章を暗黙に実装へ合わせない。

## What may evolve without changing the constitution

次は憲章の範囲内で自由に変更できる。

- Expo、React Native、ネイティブ実装などの技術スタック
- 位置フィルタ、座標変換、描画、保存の具体的OSS
- 画面構成、文言、テーマ、マーカー候補
- 現在のマイルストーンとIssueの優先順位
- PDRの採用範囲または不採用判断
- ゲーム拡張の種類

重要なのは特定技術を守ることではなく、上記の製品目的、地図の真実、受動UX、交換可能な境界を守ることである。
