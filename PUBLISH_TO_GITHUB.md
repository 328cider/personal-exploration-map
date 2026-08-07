# GitHub公開手順

このディレクトリはローカルGitリポジトリとして初期化・コミット済みである。

GitHub CLIを認証したWindows PCで、リポジトリ直下から用意済みスクリプトを実行する。

```powershell
gh auth login
.\scripts\publish-github.ps1
```

スクリプトを使わない場合:

```powershell
gh repo create 328cider/personal-exploration-map --private --source . --remote origin --push
```

公開後の確認:

```powershell
git remote -v
git status -sb
gh repo view --web
```

既に同名リポジトリを作成した場合:

```powershell
git remote add origin https://github.com/328cider/personal-exploration-map.git
git push -u origin main
```
