# Validation

実施日: 2026-08-07

## 完了した検証

環境:

- Node.js `v22.16.0`
- npm `10.9.2`
- TypeScript `5.8.3`

結果:

- `npm test`: mapping-core 10件すべて成功
- `npm run typecheck:core`: 成功
- モバイル側のTypeScript / TSX 18ファイルを `transpileModule` で構文変換: 成功
- `git status -sb`: clean
- ローカルGit履歴: 3コミット

テストで固定している主な性質:

- 初回の一度の軌跡から直ちに地図が作られる
- 再訪を登録条件にしない
- 異常なGPSジャンプや低精度点は派生経路から除外する
- 除外されたサンプルもraw evidenceとして残す
- 地理座標とローカル座標を暗黙に混在させない
- 発見マーカーを記録時点の位置へ復元する
- ゲーム拡張は地図の読み取り専用スナップショットから派生表示だけを返す

## この環境では未実施

### モバイル依存関係のインストール

実行環境のnpmが内部レジストリへ固定されており、`typescript@5.8.3` の取得が404となったため、Expo依存関係をインストールできなかった。したがってAndroid / iOSのnative buildは未実施。

これはソースコードの成功を意味しない。次の検証は、通常のnpmレジストリへアクセスできる開発PCで行う。

```bash
npm install
npm run typecheck:mobile
npm run mobile:android
```

### 実機バックグラウンド記録

以下は未検証であり、M0の残作業である。

- Android画面OFF時の継続
- 端末メーカーごとのプロセス終了挙動
- 権限拒否・設定変更からの復帰
- 30分以上の記録欠落率
- バッテリー消費
- GPSドリフトの実地評価

### GitHub remote

この実行環境ではGitHubコネクタが読み取り専用で、認証済みGitHub CLIもないため、remote repositoryの作成とpushは未実施。ローカルリポジトリはcleanなmainブランチとコミット履歴を持つ。公開手順は `PUBLISH_TO_GITHUB.md` に記載している。
