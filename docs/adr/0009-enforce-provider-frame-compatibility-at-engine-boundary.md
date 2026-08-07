# ADR 0009: TrackingProviderとPersonalMapのframe互換性をengineで強制する

- Status: Accepted
- Date: 2026-08-07

## Context

PersonalMapは複数のExplorationSessionから育つが、座標系を統合する根拠がないsessionを混在させてはならない。

モバイルUIはlocal-coordinate PersonalMapへGNSS探索を追加しない事前確認を持つ。しかし、UI確認だけでは将来のゲームアプリ、別のexplorer shell、background処理から同じ不変条件を迂回できる。製品憲章ではcanonical map writeを明示的なapplication boundaryへ集約しているため、座標互換性もその境界で保証する必要がある。

## Decision

`TrackingProviderPort`は、供給する観測の座標種別を`geographic`または`local`として宣言する。

`mapping-engine.startExploration`は、ExplorationSession recordを作成したりproviderを開始したりする前に、既存PersonalMapのframeとprovider capabilityを検査する。

- geographic providerは、空またはunresolvedなPersonalMap、およびgeographic PersonalMapへ追加できる。
- geographic providerは、明示的なanchor transformなしにlocal PersonalMapへ追加できない。
- local providerは、非空の`localFrameLabel`を必須とする。
- local providerは、空またはunresolvedなPersonalMapへ最初のlocal frameを作れる。
- local providerは、同じ明示的なframe labelを持つlocal PersonalMapへだけ追加できる。
- local providerは、明示的なanchor transformなしにgeographic PersonalMapへ追加できない。
- geographic providerへ`localFrameLabel`を渡すことは禁止する。

不適合時はrepository write、provider start、active tracking context、mapping eventを一切発生させない。

モバイル等のapp shellは、同じ条件を早めに確認して理解しやすい説明を表示してよい。ただし、その事前確認はUX補助であり、canonical invariantの正本ではない。

## Consequences

- 将来の`apps/game-*`もmobile UIと同じframe不変条件に従う。
- provider interfaceのAPI versionを更新し、すべてのproviderがcoordinate capabilityを宣言する必要がある。
- local providerは「どの局所空間か」を安定したframe labelで表す必要がある。
- 自動anchor推定やgeographic/local変換を追加する場合は、暗黙変換ではなく新しい明示的なtransform modelとして設計する。
- 互換性エラーを早期に返せる一方、未アンカーの探索を便宜的に同じPersonalMapへ追加することはできなくなる。

## Rejected alternatives

### UIだけで検査する

別app shellやbackground経路から迂回できるため却下する。

### 最初の位置サンプル到着時に拒否する

すでに空session recordやprovider side effectが発生し、回復処理とユーザー理解が複雑になるため却下する。

### すべてをlocal座標へ自動変換する

変換根拠のない別空間を同一frameとして偽装し、未観測接続や誤った地図を生むため却下する。

## Follow-up

PDRや手動anchorを製品化する際は、単純なframe labelを、検証可能なanchor transformとconfidenceを持つモデルへ拡張する。その場合も推定を確認済み接続として暗黙昇格させない。
