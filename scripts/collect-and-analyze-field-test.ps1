<#
.SYNOPSIS
Collects a USB Field-test bundle and generates the coordinate-free objective report.

.DESCRIPTION
Runs the existing USB collector, restarts the Field-test app by default, then
uses Docker Desktop to analyze the newest local bundle. No host Node.js, npm,
JDK, Android SDK, or Android Studio is required. Raw location remains local.

.EXAMPLE
.\scripts\collect-and-analyze-field-test.ps1

.EXAMPLE
.\scripts\collect-and-analyze-field-test.ps1 -Serial <adb-device-serial>

.EXAMPLE
.\scripts\collect-and-analyze-field-test.ps1 -NoFailExit
#>
param(
    [string]$OutputRoot = "artifacts\device-bundles",
    [string]$PackageName = "com.cider328.personalexplorationmap.fieldtest",
    [string]$Serial = "",
    [ValidateSet("s0", "generic")]
    [string]$Mode = "s0",
    [switch]$NoFailExit,
    [switch]$DoNotRestartApp
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedOutputRoot = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
    [System.IO.Path]::GetFullPath($OutputRoot)
}
else {
    [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputRoot))
}

$repoPrefix = $repositoryRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (
    -not $resolvedOutputRoot.Equals($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $resolvedOutputRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
    throw "Field-test bundles must stay inside the repository: $resolvedOutputRoot"
}

$pullScript = Join-Path $PSScriptRoot "pull-field-test-bundle.ps1"
$analyzeScript = Join-Path $PSScriptRoot "analyze-latest-field-test.ps1"
if (-not (Test-Path -LiteralPath $pullScript)) {
    throw "USB collector was not found: $pullScript"
}
if (-not (Test-Path -LiteralPath $analyzeScript)) {
    throw "Objective analyzer wrapper was not found: $analyzeScript"
}

$collectionArguments = @{
    OutputRoot = $resolvedOutputRoot
    PackageName = $PackageName
}
if ($Serial.Length -gt 0) {
    $collectionArguments.Serial = $Serial
}
if (-not $DoNotRestartApp) {
    $collectionArguments.RestartApp = $true
}

Write-Host "Step 1/2: collecting the USB Field-test bundle..."
& $pullScript @collectionArguments

$analysisArguments = @{
    BundlePath = $resolvedOutputRoot
    Mode = $Mode
}
if ($NoFailExit) {
    $analysisArguments.NoFailExit = $true
}

Write-Host "Step 2/2: generating the coordinate-free objective report..."
& $analyzeScript @analysisArguments

Write-Host "Field-test collection and objective analysis completed."
Write-Host "Raw bundle remains local under: $resolvedOutputRoot"
