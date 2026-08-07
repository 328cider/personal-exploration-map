# ADR 0007: canonicalな個人地図への書き込み権限を制御する

- Status: Accepted
- Date: 2026-08-07
- Constitution change: Invariant 6
- Owner approval: Issue #12

## Context

ADR 0006では、`mapping-core`、headless application boundary、adapter、renderer、experience/gameの責務を分離した。

この具体構造は将来の技術選択に応じて変更できる。一方、ゲームアプリやUIが低レベルなdomain mutationを直接呼べると、保存、イベント、ユーザー確認、地図の真実が分散し、次の設計ドリフトが起こり得る。

- game都合でaccepted / rejected判定が変わる
- 未観測区間が暗黙に接続される
- UI上の編集候補が確認なしでcanonical evidenceになる
- DB更新とderived map更新が不整合になる
- アプリごとに異なる地図規則が生まれる

これはpackage構成の問題ではなく、canonical mapへの権限モデルという恒久的な製品原則である。

## Decision

製品憲章Invariant 6を次の内容へ強化する。

1. canonicalな個人地図への変更は、明示的に制御されたapplication boundaryを通す。
2. UI、renderer、game、experienceはcanonical domain stateを直接mutationしない。
3. game / experienceはread-only map snapshotとdomain eventから、別管理のstate、overlay、cueを生成する。
4. game起点の現実地図修正は、ユーザー確認後に明示的な地図commandへ変換する。
5. boundaryの具体的なpackage名、API、技術スタックは憲章に固定せず、Accepted ADRで変更できる。

現在はADR 0006に従い、`mapping-engine`を明示command/queryの境界として使う。ただし名称や内部構造は将来交換可能である。

## Alternatives considered

### A. ADRだけに残す

却下。package構造はADRで十分だが、gameやUIへcanonical write権限を渡さない原則は技術スタック変更後も守る必要があり、憲章級である。

### B. `mapping-engine`というpackage名を憲章へ固定する

却下。実装方式を過剰に固定し、将来のネイティブ化、service化、別言語化を妨げる。

### C. gameへ限定的なcore mutationを公開する

却下。どのmutationが安全かがgameごとに分散し、map truthが体験レイヤーへ侵食する。必要な修正はユーザー確認後のapplication commandで表現する。

## Consequences

### Positive

- explorer appとgame appが同じ地図の真実を共有できる
- gameを削除・置換してもPersonalMapが残る
- transaction、保存、event、確認を一箇所で扱える
- 新機能の配置を再利用予想ではなくwrite authorityで判断できる

### Costs

- command/query境界とadapter実装が必要になる
- UIだけで完結して見える編集もapplication boundaryを通す必要がある
- 小規模機能でも責務分割の検討が必要になる

## Migration impact

- raw data、DB schema、既存PersonalMapへの移行なし
- PR #11で導入済みの`mapping-engine` / `experience-sdk`設計と整合する
- Issue #1のSQLite統合はこの権限モデルに従う

## Reconsideration conditions

具体的なpackage構造は、複数appでの利用、性能、platform制約を根拠にADRで変更できる。

ただしgame/UIがcanonical mapを直接変更する方式へ戻す場合は、憲章変更として所有者承認、専用Issue、移行・安全・プライバシー評価を必要とする。

## Related

- Issue #12
- ADR 0001
- ADR 0006
- `docs/FEATURE_PLACEMENT.md`
