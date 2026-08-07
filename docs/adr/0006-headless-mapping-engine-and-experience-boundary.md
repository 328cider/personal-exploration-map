# ADR 0006: Headless mapping engineとgame experienceを分離する

- Status: Accepted
- Date: 2026-08-07

## Context

将来、同じマッピング能力を使う通常の探索アプリと複数のゲームアプリを作る可能性がある。現在の `mapping-core` は純粋な地図規則を主に保持している一方、初期実装ではgame overlayの契約も同じpackageに置かれていた。また、mobile appがcore操作、SQLite、位置取得、画面遷移を直接組み合わせている。

「複数アプリから呼ぶので全部coreにする」という分割は、地図の真実、application transaction、platform I/O、表示、ゲーム状態を巨大な共通packageへ集める。逆にゲームアプリへ地図更新規則を置くと、ゲームごとにaccepted / rejected、接続、不確実性が分岐する。

必要なのは、再利用回数ではなく、**各層が地図データに対して持つ権限**で境界を決めることである。

## Decision

### 1. `mapping-core`をdomain kernelに限定する

`mapping-core` は純粋TypeScriptで、次だけを所有する。

- raw observations
- ExplorationSession
- PersonalMap aggregate
- quality、frame、segment、marker、uncertainty
- replay可能なderived map
- domain events

React、Expo、SQLite、OS権限、通知、renderer、経験値、クエスト、game stateを参照しない。

### 2. `mapping-engine`を唯一の書き込み窓口にする

explorer appとgame appは、低レベルなcore mutationを直接組み立てず、headless `MappingEngine` のcommand / query APIを使用する。

engineは次を調整する。

- map / exploration lifecycle
- repository transaction
- tracking provider lifecycle
- core replayとsnapshot生成
- event publication
- user-confirmed correction

mutableなExplorationSessionをappへ渡さない。appからの地図変更は明示commandとして受け取る。

### 3. platform機能をadapterにする

Expo Location / TaskManager、SQLite、PDR、file export、optional syncはengineのportを実装する。adapterは観測を取得・保存するが、地図の採否やゲーム報酬を決定しない。

### 4. rendererをread-onlyにする

rendererはsnapshotから白紙地図、marker、不確実性、任意basemapを描画する。編集UIは提案を作れるが、確定はengine command経由とする。

### 5. experience / gameをread-only observerにする

`experience-sdk` はPersonalMap snapshotとMappingEventを入力とし、別管理のexperience state、overlay、presentation cueだけを返す。

experience/gameは以下を行えない。

- raw observationの変更
- accepted / rejected判定変更
- track、segment、marker evidenceの直接上書き
- 未観測接続の確定
- game stateをcanonical mapの再生成条件にする

ゲーム起点の地図修正が必要な場合、gameは候補を表示し、ユーザー確認後にappがengine commandへ変換する。

### 6. 依存方向を一方向にする

```text
apps ───────────────▶ mapping-engine ─────────▶ mapping-core
  │                         ▲
  │                         │ implements ports
  ├──▶ renderer         platform adapters
  │
  └──▶ experience-sdk / game modules
```

- coreは外側の層へ依存しない。
- engineはrenderer・experienceへ依存しない。
- game appはcore mutationを直接importしない。
- renderer・experienceはread-only map contractだけを扱う。

### 7. 現在のmobile appをreference shellとする

`apps/mobile` は最初のexplorer shellである。既存の直接呼び出しは段階的にengineへ移行するが、二つ目のappがない段階でUI component library、動的plugin loader、npm公開を先行実装しない。

## Feature placement rule

機能全体を一つの層へ押し込まず、責務を分割する。

- 地図の事実を決める: core
- 安全なuse case / transaction: engine
- OS / DB / sensor / file: adapter
- 表示: renderer
- 報酬 / 物語 / 演出: experience/game

詳細と例は `docs/FEATURE_PLACEMENT.md` を正本とする。

## Consequences

### Positive

- マッピング単体とゲーム体験を独立して進化させられる。
- ゲームごとに地図の真実が分岐しない。
- platformやrendererを交換してもdomain kernelを維持できる。
- engine facadeをテストすれば、複数appで同じtransaction規則を使える。
- 機能配置の議論を「どこから使うか」ではなく「何への権限か」で行える。

### Costs

- command / query、port、adapterの変換コードが増える。
- 小さな機能でも複数層に分かれる場合がある。
- engine APIのversioningが必要になる。
- 現在のmobile repository処理を段階的に移行する必要がある。

## Rejected alternatives

### Everything in mapping-core

再利用は容易だが、platform、UI、game stateまでcoreへ流入し、地図の真実の境界が失われるため不採用。

### Each game owns its mapping implementation

ゲームごとに測位、接続、不確実性が分岐し、raw evidenceの互換性を失うため不採用。

### Game directly mutates core sessions

一見柔軟だが、persistence、events、invariantsを迂回でき、地図の真実をゲーム都合で変えられるため不採用。

### Dynamic plugin platform now

二つ目のgame appも外部plugin利用者も存在しない。現時点では過剰設計なので不採用。静的なmonorepo package境界から始める。

## Follow-up

- Issue #10でengine / experience contractとCI境界を追加する。
- Issue #1のSQLite・UI移行では、mobile appからengine facadeを利用する。
- Issue #7でrenderer、標準アルゴリズム、座標変換、export形式のOSS採用を判断する。
