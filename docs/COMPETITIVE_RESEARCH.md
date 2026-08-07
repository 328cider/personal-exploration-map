# 既存アプリ・研究の再調査とBuild / Buy判断

調査日: 2026-08-07

この文書は「似た機能が存在するか」ではなく、**想定する利用フロー全体を既存製品で代替できるか**を判定する。網羅的なストア一覧ではなく、近いカテゴリの代表例と一次情報を中心に確認した。

## 欲しい体験

- 自分の探索結果が地図の正本
- 白紙またはローカル座標から始められる
- スマホをポケットに入れた受動記録
- 初回の一回の移動で地図ができる
- GPSあり / なしを同じ個人地図モデルで扱える
- 必要な時だけ短いメモ、発見、接続情報を追加
- ゲームは交換可能な上位レイヤー

## 製品カテゴリ比較

| カテゴリ / 例 | 代替できること | 代替できないこと | 判断 |
|---|---|---|---|
| Fog of World / Stomped | 既存の世界地図上で訪問済み領域を開放し、探索をゲーム化 | 地図自体は既に存在し、GPSのない未知空間を白紙から形成しない | 屋外Fogだけなら利用推奨 |
| Crumb Trails | 開始後にスマホをポケットへ入れ、GPSの足跡とマーカーを保存 | GPS座標列を既存地図で見る製品で、個人ローカル地図やGPSなし空間を扱わない | UX参考、コア代替不可 |
| QField / SW Maps | 点・線・面を現地で作成し、地理データとして保存 | GISの作図が主作業。受動探索や一回の自動経路形成ではない | 専門用途なら利用推奨 |
| Mappedin / magicplan | 既存平面図がない建物をスキャンし、詳細な図面を作成 | カメラ / LiDARを構えてスキャンする作業が必要 | 図面目的なら利用推奨 |
| 一般的GPSロガー | バックグラウンドで屋外軌跡を保存 | 「自分が知った空間」という正本、局所座標、ゲーム拡張境界がない | 技術部品として代替可 |

### 代表的な一次情報

- Fog of World: <https://fogofworld.app/>
- Stomped: <https://stomped.app/>
- Crumb Trails: <https://apps.apple.com/us/app/crumb-trails/id1572385584>
- QField digitizing: <https://docs.qfield.org/how-to/data-collection/digitize/>
- SW Maps: <https://aviyaantechnologies.com/sw-maps/>
- Mappedin Scan: <https://www.mappedin.com/scan/>
- magicplan scan workflow: <https://help.magicplan.app/scan-a-room>

## 研究が示していること

### Map as a By-product

スマホIMUと、作業中にユーザーが入力するテキストを組み合わせ、活動の副産物としてランドマーク地図を作る研究。マッピングを主作業にしない発想は近いが、複数人の業務タスク向けであり、個人の探索地図製品ではない。

- Paper: <https://arxiv.org/abs/2509.03792>

### Phone-in-pocket indoor backtracking

スマホをポケットに入れ、慣性・磁気センサーを使って事前地図なしの復路案内を行う研究。カメラやインフラなしで一回の屋内移動を扱える可能性を示す一方、歩行推定のドリフト、端末姿勢、利用者差が製品リスクになる。

- Paper: <https://arxiv.org/abs/2401.08021>

### Walk2Map

歩行軌跡から屋内フロアプランを推定する研究。歩行だけから構造を推測できる可能性はあるが、機械学習による推定であり、未知空間の壁や扉を観測した事実とは限らない。MVPで確定地物として表示すべきではない。

- Paper: <https://arxiv.org/abs/2103.00262>

## OS上の制約

ポケット内の継続記録は、単にセンサーAPIを呼ぶだけでは成立しない。

- Androidはバックグラウンドでの連続センサーイベントに制約があり、長時間位置記録には適切なforeground serviceと権限設計が必要。
- iOSもバックグラウンド位置更新は構成できるが、モーション更新や実行継続には制約がある。
- Expoのバックグラウンド位置タスクは開発ビルドが必要で、ユーザーがアプリを終了した場合などの挙動を実機で検証する必要がある。

一次情報:

- Android sensor overview: <https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview>
- Android foreground service types: <https://developer.android.com/develop/background-work/services/fgs/service-types>
- Android location permissions: <https://developer.android.com/develop/sensors-and-location/location/permissions>
- Apple Core Location background updates: <https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background>
- Expo Location: <https://docs.expo.dev/versions/latest/sdk/location/>
- Expo TaskManager: <https://docs.expo.dev/versions/latest/sdk/task-manager/>

## 結論

### 既存製品を使うべき場合

- 欲しいものが「訪れた街をFogで塗る」だけなら Fog of World / Stomped を使う。
- 欲しいものが「屋外GPSログとピン」だけなら既存GPSロガーを使う。
- 欲しいものが「正確な建物図面」なら Mappedin / magicplan を使う。
- 欲しいものが「編集可能な地理データ」なら QField / SW Maps を使う。

### 自作が必要な理由

次の組み合わせを一つの一般向けUXとして提供する製品は、今回確認した範囲では見つからなかった。

> 白紙の個人地図 × ポケット内受動記録 × 一回の探索で生成 × GPSなしへの拡張 × 必要時だけ意味入力

したがってBuild判断は **Go**。ただし、屋内PDRの高精度化を成功前提にしない。まず既存の位置APIでエンドツーエンドの価値を検証し、PDRは独立した技術ゲートにする。

## 判断を見直す条件

次のいずれかが起きたらBuild / Buyを再評価する。

- 既存製品が白紙ローカル座標、受動記録、GPSなし探索を一般向けに統合した
- 実探索で、既存GPSログとの差がユーザーに価値として認識されなかった
- ポケット内PDRが許容できず、GNSS限定では独自価値が弱かった
- 権限、電池、プラットフォーム制約により「しまって歩く」が安定しなかった
