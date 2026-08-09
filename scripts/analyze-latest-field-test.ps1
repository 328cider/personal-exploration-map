param(
    [string]$BundlePath = "artifacts\device-bundles",
    [string]$OutputDirectory = "",
    [ValidateSet("s0", "generic")]
    [string]$Mode = "s0",
    [switch]$NoFailExit
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RepositoryPath {
    param(
        [string]$InputPath,
        [string]$RepositoryRoot,
        [switch]$CreateDirectory
    )

    $candidate = if ([System.IO.Path]::IsPathRooted($InputPath)) {
        $InputPath
    }
    else {
        Join-Path $RepositoryRoot $InputPath
    }

    if ($CreateDirectory -and -not (Test-Path -LiteralPath $candidate)) {
        New-Item -ItemType Directory -Force -Path $candidate | Out-Null
    }

    if (-not (Test-Path -LiteralPath $candidate)) {
        throw "Path does not exist: $candidate"
    }

    return (Resolve-Path -LiteralPath $candidate).Path
}

function Convert-ToWorkspacePath {
    param(
        [string]$HostPath,
        [string]$RepositoryRoot
    )

    $root = [System.IO.Path]::GetFullPath($RepositoryRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $resolved = [System.IO.Path]::GetFullPath($HostPath)
    $prefix = $root + [System.IO.Path]::DirectorySeparatorChar

    if (
        -not $resolved.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "Field-test analysis paths must stay inside the repository: $resolved"
    }

    if ($resolved.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return "/workspace"
    }

    $relative = $resolved.Substring($prefix.Length).Replace("\", "/")
    return "/workspace/$relative"
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBundle = Resolve-RepositoryPath -InputPath $BundlePath -RepositoryRoot $repositoryRoot
$containerBundle = Convert-ToWorkspacePath -HostPath $resolvedBundle -RepositoryRoot $repositoryRoot

$resolvedOutput = ""
$containerOutput = ""
if ($OutputDirectory.Length -gt 0) {
    $resolvedOutput = Resolve-RepositoryPath -InputPath $OutputDirectory -RepositoryRoot $repositoryRoot -CreateDirectory
    $containerOutput = Convert-ToWorkspacePath -HostPath $resolvedOutput -RepositoryRoot $repositoryRoot
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
    throw "Docker was not found. Start Docker Desktop and make sure the docker command is available."
}

$arguments = @(
    "compose",
    "run",
    "--rm",
    "-T",
    "shell",
    "node",
    "scripts/analyze-field-test-summary.mjs",
    $containerBundle,
    "--mode",
    $Mode
)
if ($containerOutput.Length -gt 0) {
    $arguments += @("--output-dir", $containerOutput)
}
if ($NoFailExit) {
    $arguments += "--no-fail-exit"
}

Write-Host "Analyzing Field-test evidence inside Docker..."
Write-Host "Input: $resolvedBundle"
& $docker.Source @arguments
$exitCode = $LASTEXITCODE

if ($containerOutput.Length -gt 0) {
    Write-Host "Reports: $resolvedOutput"
}
else {
    Write-Host "Reports are under the selected bundle's analysis directory."
}

if ($exitCode -eq 2) {
    throw "Objective S0 status is FAIL. Do not repeat the walk. Keep the bundle and return the failure to code/emulator analysis."
}
if ($exitCode -ne 0) {
    throw "Field-test analyzer failed with exit code $exitCode."
}
