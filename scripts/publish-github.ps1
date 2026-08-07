[CmdletBinding()]
param(
    [string]$Repository = "328cider/personal-exploration-map",
    [ValidateSet("private", "public")]
    [string]$Visibility = "private"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) が見つかりません。https://cli.github.com/ からインストールしてください。"
}

& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLIが未認証です。先に 'gh auth login' を実行してください。"
}

$root = (& git rev-parse --show-toplevel 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
    throw "Gitリポジトリ直下で実行してください。"
}
Set-Location $root

$changes = & git status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "git statusに失敗しました。"
}
if ($changes) {
    throw "未コミット変更があります。内容を確認してcommitしてから公開してください。"
}

& gh repo view $Repository --json nameWithOwner *> $null
$repositoryExists = $LASTEXITCODE -eq 0

if (-not $repositoryExists) {
    & gh repo create $Repository "--$Visibility" --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) {
        throw "GitHubリポジトリの作成または初回pushに失敗しました。"
    }
} else {
    $expectedRemote = "https://github.com/$Repository.git"
    & git remote get-url origin *> $null
    if ($LASTEXITCODE -ne 0) {
        & git remote add origin $expectedRemote
        if ($LASTEXITCODE -ne 0) {
            throw "origin remoteの追加に失敗しました。"
        }
    }

    & git push -u origin main
    if ($LASTEXITCODE -ne 0) {
        throw "既存リポジトリへのpushに失敗しました。originと権限を確認してください。"
    }
}

Write-Host "Published: https://github.com/$Repository"
& gh repo view $Repository --web
