# Experiment 002: GPSなしポケット内PDR

## Status

Planned. 製品機能ではなく技術ゲート。

## Hypothesis

カメラを構えず、ポケット内の一般的なスマホセンサーだけで、一度の100–300mの探索について、正確な平面図ではなく「経路形状・曲がり・接続を思い出せるローカル地図」を生成できる。

## Scope

- Android-first
- foreground service中のaccelerometer / gyroscope / magnetometer / step data
- 端末姿勢の変化を含む
- 入り口を原点 `(0, 0)` にする
- 壁や部屋は推定しない
- 必要時の手動アンカーを比較条件に含める

## Baselines

1. 歩数 × 固定歩幅 + 方位
2. センサー融合によるheading + step detection
3. 手動の「ここで曲がった」「ここは接続」アンカー付き
4. 研究実装を利用できる場合は、再現可能性を確認した上で比較

## Test routes

- 単純な矩形
- 複数の90度ターン
- 緩い曲線
- 階段 / 階層移動
- 端末を一度取り出してメモし、戻す
- ポケット位置や向きを変える

## Metrics

- endpoint drift / traveled distance
- turn detection precision / recall
- topology correctness
- route self-intersection error
- user-specific calibration dependence
- 手動アンカー回数
- 地図を見て元の経路を識別できるか

## Decision

### Go

複数端末・複数利用者で、短い探索の経路理解に安定して役立ち、手動補正が少ない。

### Narrow

短距離backtracking、手動アンカー付きトポロジー、または特定端末に限定すれば有用。

### Stop

誤差が大きく、誤った地図の方が危険・不快で、補正操作が手描きより重い。

Stopでもmapping-core、GNSS探索、発見記録、白紙地図は維持できる。
