# Android Emulator E2E gate

更新日: 2026-08-08

## 目的

実地試験は、ユーザーの移動、時間、端末操作、位置履歴を伴う高コストな検証である。

したがって、Android Emulatorで確認できる不具合を実地試験へ持ち込まない。Field-test APKを実端末へ渡す前に、GitHub Actions上の黒箱E2Eを必須ゲートとする。

## 役割分担

```text
Pure TypeScript tests
  └─ map truth、品質判定、frame、transaction、replay

Android Emulator E2E
  └─ APK起動、基本UI、権限済み記録、擬似GNSS、live preview、終了、再起動後の保持

Android実端末
  └─ 実GNSS、画面OFF継続、OEM省電力、通知、電池、ポケット内UX
```

エミュレータ合格は実端末成立を証明しない。ただし、エミュレータ不合格のAPKを実地試験可能とは扱わない。

## Build / Adopt

エミュレータのSDK導入、AVD作成、hardware acceleration、boot待ち、終了処理は製品固有価値ではないため、自作しない。

- **Adopt:** `ReactiveCircus/android-emulator-runner@v2.37.0`
- License: Apache-2.0
- 担当: emulator provisioning / boot / teardown
- 本リポジトリで自作する範囲: PersonalMap固有の黒箱ユーザーシナリオとassertion

この境界により、CIの低レベルなAVD lifecycleを再発明せず、ユーザーへ渡すAPKの動作意味だけをリポジトリ側で固定する。

## 自動シナリオ

`devex-field-test` workflowの`Android emulator user-flow gate`は、同じworkflowで作成したField-test APKを使用して次を実行する。

1. disposable Android 15 / API 35 emulatorをcold boot
2. Field-test APKをclean install
3. foreground、background location、notification権限をADBで付与
4. Homeを表示
5. 新しいPersonalMapのポケット記録を開始
6. emulatorへ徒歩速度相当の擬似GNSS経路を投入
7. foregroundでlive PersonalMap previewに経路が現れることを確認
8. Homeへ移動し、画面を消した状態で追加経路を投入
9. appへ戻り、記録中ExplorationSessionが復元されることを確認
10. `探索を終了して地図を見る`からReviewへ進めることを確認
11. appをforce-stopして再起動
12. PersonalMapがHomeとReviewに残ることを確認

## 証跡

成功・失敗を問わず、workflow artifact `personal-exploration-map-emulator-e2e`へ次を保存する。

- 各段階のPNG screenshot
- UI Automator hierarchy XML
- logcat
- activity / package / location / notification dumpsys
- harness version metadata
- assertion結果JSON
- 失敗時の例外

スクリーンショットは位置座標を既存地図へ重ねたものではないが、実際の位置履歴を含む可能性があるため、public Issueへ無条件に添付しない。

## 実装原則

- test scriptはADBとPython標準ライブラリだけを使用する
- app内部のmutable objectへ直接触れず、インストール済みAPKをユーザーと同じ導線で操作する
- 擬似GNSSはmap truthへ通常のraw observationとして入る
- emulator専用の位置をproduction PersonalMapへ混ぜない
- rendererはread-onlyのまま
- live previewを確認するためにbackground中のpollingを追加しない
- UI文言変更でtestが失敗した場合、単にselectorを緩めず、ユーザー導線の意味が維持されているか確認する
- emulator provisioningの独自shell実装を増やさず、採用Actionの設定へ寄せる

## 実地試験へ進む条件

次をすべて満たしたAPKだけを実端末候補とする。

- `Docker mobile check`: success
- `Standalone field-test APK`: success
- `Android emulator user-flow gate`: success
- product governance / architecture / mobile write boundary: success
- 既知のP0 UI blockerがopenではない
- emulator artifactの主要画面を目視レビュー済み

実端末では、エミュレータで代替できない以下だけを優先して検証する。

- 実GNSSの欠落・精度・ジャンプ
- 画面OFF・30〜60分継続
- OEMによるbackground kill
- foreground service notificationと復帰
- 電池消費
- スマホをしまった状態の身体的UX
- explored-space表現の実用上の差別化
