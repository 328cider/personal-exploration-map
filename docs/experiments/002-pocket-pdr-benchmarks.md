# Experiment 002 Companion: Pocket PDR Baselines

- Status: Required before implementing a product PDR
- Parent: `002-pocket-pdr.md`

## Purpose

GPSなし空間でポケット内スマホから一度の探索を地図化できるかを検証する。独自sensor fusionを先に実装せず、公開研究・製品・単純baselineを同じraw logで比較する。

## Product constraints

比較対象が高精度でも、次に反する場合はdefault product pathへ採用しない。

- 常時カメラを構える
- 事前floor planを必須にする
- beacon / infrastructure設置を必須にする
- 複数回通過を登録条件にする
- 推定した壁・部屋・接続をconfirmed factとして表示する
- correction操作が手描きより重い
- licenseがproduct inclusionを許さない

## Common raw dataset

同一Android端末で次をraw保存する。

- monotonic timestamp
- accelerometer
- gyroscope
- rotation vector / attitude
- magnetic field
- step detector / step counter when available
- pressure when available
- device orientation / pocket placement metadata
- manual ground-truth anchors
- GNSS reference where available outside the denied area

raw logはalgorithm outputで上書きしない。すべてのbaselineを同じlogから再生可能にする。

## Routes

- straight 100 m
- rectangle / loop
- out-and-back
- multiple turns
- branch and return
- stair transition
- one-time path with no repeat traversal
- different pocket orientation
- stop / start / phone handling event

各routeでstart/end ground truth、known distance、turn points、floor transitionsを記録する。

## Baseline A: Step-and-heading PDR

最小baseline。

- step count × estimated stride
- rotation / heading change
- `(0, 0)` origin
- optional manual anchor correction

目的は高精度化ではなく、複雑なmodelが単純baselineをどれだけ上回るか測ること。

## Baseline B: Microsoft Research Path Guide concept

比較する性質:

- infrastructure-free trace
- inertial / magnetic cues
- one recorded routeをfollowする
- checkpoint / landmark concept

Path GuideはPersonalMap aggregateそのものではない。single traversal indoor traceとreturn/follow experienceの比較対象にする。

product codeへ取り込む前に、現在利用可能なsource、license、mobile runtime、maintenance状態を確認する。公開論文やproject pageだけでは組み込み許可とみなさない。

## Baseline C: RoNIN

比較する性質:

- device orientation variation
- learned inertial velocity / trajectory
- public dataset / codeによるoffline baseline

既定方針:

- GPL-3.0 codeをproduct packageへ直接組み込まない
- offline evaluation / research comparisonに限定
- model size、inference latency、training domain shiftを記録

## Baseline D: TLIO

比較する性質:

- learned displacement estimate
- filtering / uncertainty
- long sequence drift

確認項目:

- exact repository and license
- model artifact license
- mobile inference feasibility
- required sensor rate
- calibration and training assumptions
- reproducibility on our raw logs

licenseが不明確な場合、product inclusionはStopとし、論文baselineとしてのみ扱う。

## Baseline E: camera / AR-assisted products

SIMT Track+等のweak-GPS trackingを比較する。

評価目的:

- camera/ARを使うとどこまで改善するか
- phone-in-pocket制約によるaccuracy tradeoff
- future smart glassesで再評価する価値

現在のdefault UXへは採用しない。カメラ使用は明示opt-inの別mode候補であり、MVP成立条件にしない。

## Metrics

### Geometry

- endpoint error
- loop closure error
- distance error
- heading / turn error
- shape similarity
- branch topology correctness
- floor transition correctness
- drift per 100 m

### Uncertainty

- confidence calibration
- error band coverage
- catastrophic wrong connection count
- unknown / gapをunknownとして残せた割合

### UX

- required calibration time
- manual anchor count
- interruption time
- device placement restrictions
- correction count
- correction total time
- camera / screen attention time

### Runtime

- CPU / battery
- model size
- memory
- sensor rate
- on-device latency
- offline availability

### Legal / maintenance

- exact license
- model/data license
- transitive dependencies
- maintenance status
- reproducibility

## Decision thresholds

数値はpilot前の仮説であり、結果に合わせて後から動かさない。

### Go

- common 100–300 m routesでshapeとturn sequenceを再利用できる
- light anchor操作だけでcatastrophic connectionを避けられる
- correctionが手描きより軽い
- uncertaintyをUIへ正直に出せる
- on-device runtimeとlicenseが現実的

### Narrow

- short backtracking
- known-anchor間
- start point return
- floor transition event detection

のいずれかに限定すれば価値がある。

### Stop

- false topologyが頻発
- correctionが探索を妨げる
- pocket orientation差で再現しない
- cameraをdefaultにしないと成立しない
- model/license/runtimeがproductへ不適合

StopでもGNSS PersonalMap、markers、blank renderer、manual confirmed connectionsは維持する。

## Output

- raw dataset manifest
- baseline implementations / exact versions
- license table
- per-route metric table
- failure examples
- correction time log
- Go / Narrow / Stop decision
- product scope change proposal if needed
