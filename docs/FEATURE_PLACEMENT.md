# Feature Placement Guide

## 目的

新機能を `mapping-core` とゲームアプリのどちらへ入れるかを、担当者の感覚や「再利用されそう」という予想だけで決めないための判断基準である。

重要なのは、**機能名ではなく、その機能を構成する各責務が何に対する権限を持つか**である。1つの機能が複数の層へ分かれることは正常であり、むしろ境界が明確になる。

## 依存方向

```text
apps/explorer or apps/game-*
        │
        ├── commands / queries ──▶ mapping-engine
        │                              │
        │                              ▼
        │                         mapping-core
        │
        ├── read-only snapshot ──▶ renderer
        │
        └── events + snapshot ───▶ experience-sdk / game module

platform adapters ──implement──▶ mapping-engine ports
```

許可する依存:

- `mapping-engine` → `mapping-core`
- adapters → `mapping-engine` と必要なcore型
- renderer → read-only map型
- experience/game → `experience-sdk`
- app shell → engine、renderer、experience

禁止する依存:

- `mapping-core` → engine、Expo、React、SQLite、renderer、experience/game
- `mapping-engine` → renderer、experience/game
- experience/game → coreのmutation関数
- renderer → repository、tracking provider、core mutation

## 最初に問うこと

### Q1. この処理は「地図の事実」を決めるか

次のいずれかを決めるなら `mapping-core` である。

- 観測を受理・除外するか
- どの座標frameに属するか
- どの点が同一segmentか
- セッション間を接続してよいか
- markerやuser-confirmed correctionを地図証拠としてどう扱うか
- 不確実性、欠落、推定をどう区別するか
- raw evidenceからderived mapをどう再生成するか

coreは純粋TypeScriptとし、端末、DB、画面、ゲーム進行を知らない。

### Q2. 複数のcore操作を、安全なユーザー操作として完結させるか

次のようなユースケースは `mapping-engine` である。

- 個人地図を作成する
- その地図の探索を開始・継続・終了する
- raw sampleを保存してからreplayする
- markerを追加し、保存とevent発行を一貫させる
- user-confirmed correctionをtransactionとして反映する
- PersonalMap snapshotをqueryする
- GPX / GeoJSON exportを開始する

engineは地図への唯一の書き込み窓口であり、appやgameへmutable sessionを渡さない。

### Q3. OS、端末、DB、ネットワーク、ファイルに触れるか

それはadapterである。

- Expo Location / TaskManager
- SQLite repository
- PDR sensor collector
- file picker / GPX writer
- optional cloud sync
- notification / foreground service

adapterは観測を供給・保存するが、地図の採否やゲーム報酬を決めない。

### Q4. snapshotを見た目へ変換するだけか

それはrendererである。

- 白紙キャンバス
- polyline / marker描画
- zoom / pan
- 不確実性の線幅・透明度
- 任意basemap
- 色、テーマ、アニメーション

rendererは表示中に地図の事実を修正しない。編集操作がある場合は、確定時にengine commandへ変換する。

### Q5. 動機づけ、報酬、物語、演出を変えるか

それはexperience/gameである。

- Fogの見せ方
- 経験値、レベル、実績
- 収集物、宝箱
- クエスト、ストーリー
- キャラクター反応
- 音、演出、テーマ

experienceはread-only snapshotとdomain eventを受け取り、別管理のgame state、overlay、cueを返す。地図の真実を書き換えない。

## 「どちらか」ではなく分割する代表例

### Fog of War

| 責務 | 配置 |
|---|---|
| 観測に基づく探索済み領域の幾何 | mapping-derived data |
| 不確実性を含むcoverage計算規則 | mapping-coreまたは専用mapping analytics |
| 黒い霧、光り方、アニメーション | renderer / experience |
| 霧を晴らした時の経験値 | game |
| 探索率ランキング | game / optional service |

### 発見・POI

| 責務 | 配置 |
|---|---|
| ユーザーが現地で記録した入口・危険・メモ | mapping-core evidence |
| 保存、ID発行、event発行 | mapping-engine |
| アイコンの形と色 | renderer |
| ゲーム上の宝箱・NPC | game overlay |
| 宝箱を現実のmarkerへ昇格 | ユーザー確認後にengine command |

### 階段候補の自動推定

| 責務 | 配置 |
|---|---|
| センサー推定 | tracking / inference adapter |
| 候補とconfidenceの表現 | mapping inference model |
| 候補の表示 | renderer |
| ユーザーによる確定 | engine command |
| 確定後の階段marker | core evidence |
| 階段発見の実績 | game |

### 探索率

- 「観測済みcoverage / 対象領域」という測定値はmapping analytics。
- 対象領域が既存地図由来なら、補助レイヤーであることを明示する。
- 探索率をレベル・報酬・ストーリー解放へ使う処理はgame。
- 報酬の都合でcoverageやaccepted sampleを変えてはならない。

## 迷った時のdecision tree

```text
地図の事実・不確実性・接続を決める？
  ├─ Yes → mapping-core
  └─ No
      複数操作を安全なcommand/queryとして完結させる？
        ├─ Yes → mapping-engine
        └─ No
            OS / DB / sensor / file / networkに触れる？
              ├─ Yes → adapter
              └─ No
                  見た目だけを変える？
                    ├─ Yes → renderer
                    └─ No
                        報酬・物語・演出・動機づけ？
                          ├─ Yes → experience/game
                          └─ No → 責務をさらに分解してADRで判断
```

## coreへ入れる根拠にならないもの

次だけではcoreへ入れない。

- 2つ以上の画面で使う
- 将来ほかのゲームでも使いそう
- 名前に「map」「exploration」が付く
- 性能上まとめた方が楽
- 既存コードから呼びやすい
- game側に置くとファイルが増える

coreへ入れる根拠は、**製品横断で守るべき地図の真実・不変条件を所有すること**である。

## packageを増やす条件

責務を分けることと、すぐ別packageへすることは同義ではない。

package化するのは次のいずれかを満たす時に限る。

- 依存方向をCIで強制する必要がある
- 二つ以上のapp shellで実際に利用する
- platform依存を隔離しないとテストできない
- versioned public APIが必要になる

二つ目のゲームアプリがない段階では、UI component library、動的plugin loader、npm公開、remote plugin配布を先行実装しない。

## 新機能Issueに残す最小記録

```text
User problem:
Map truth affected:
Passive UX impact:
Split responsibilities:
  - core:
  - engine:
  - adapter:
  - renderer:
  - experience/game:
Build / Adopt / Benchmark:
Validation and stop criteria:
```
