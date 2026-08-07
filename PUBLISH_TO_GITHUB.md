# GitHub公開手順

このディレクトリはローカルGitリポジトリとして初期化・コミット済みである。

GitHub CLIを認証したPCで、リポジトリ直下から次を実行する。

```powershell
gh auth login
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
