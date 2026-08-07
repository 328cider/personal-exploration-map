# ADR 0001: マッピング・コアとゲームレイヤーを分離する

- Status: Accepted
- Date: 2026-08-07
- Clarified by: [ADR 0006](0006-headless-mapping-engine-and-experience-boundary.md)

## Context

将来、Fog、探索率、実績、収集、物語などを追加したい。一方、ゲーム要素は変更・置換されやすく、位置データの真実や地図保存形式まで巻き込むと、地図アプリとしての価値が失われる。

## Decision

`mapping-core`は探索、サンプル品質、座標変換、経路、発見、PersonalMap、domain eventだけを扱う。

ゲームは`experience-sdk`を通じてdomain eventと読み取り専用PersonalMap snapshotを受け取り、派生overlay、presentation cue、独自stateだけを返す。ゲーム契約自体もmapping-coreには置かない。

explorer / game appから地図を変更する場合は、ADR 0006で定義する`mapping-engine` commandを経由する。experience moduleへ直接のmap mutation権限を与えない。

## Consequences

- ゲームなしでアプリが完成する
- 複数テーマを差し替えられる
- ゲームのルール変更で過去地図を移行しなくてよい
- experience APIとmapping-engine APIのversioningが必要になる
- コアから直接「経験値」などを参照できない
- game appはcore mutationを直接組み立てられない
