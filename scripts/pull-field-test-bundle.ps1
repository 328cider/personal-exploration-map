param(
    [string]$OutputRoot = "artifacts\device-bundles",
    [string]$PackageName = "com.cider328.personalexplorationmap.fieldtest",
    [string]$Serial = "",
    [switch]$RestartApp
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-Utf8NoBomEncoding {
    return New-Object System.Text.UTF8Encoding($false)
}

function Write-Utf8File([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, (Get-Utf8NoBomEncoding))
}

function Get-Sha256Text([string]$Value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Quote-ProcessArgument([string]$Value) {
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Start-CapturedProcess {
    param(
        [string]$FileName,
        [string[]]$Arguments,
        [string]$StdoutPath,
        [switch]$Binary,
        [switch]$AllowFailure
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FileName
    $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " ")
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start $FileName"
    }

    if ($Binary) {
        $stream = [System.IO.File]::Open(
            $StdoutPath,
            [System.IO.FileMode]::Create,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $process.StandardOutput.BaseStream.CopyTo($stream)
        }
        finally {
            $stream.Dispose()
        }
        $stderr = $process.StandardError.ReadToEnd()
    }
    else {
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        Write-Utf8File $StdoutPath $stdout
    }

    $process.WaitForExit()
    $exitCode = $process.ExitCode
    $process.Dispose()

    if ($stderr.Length -gt 0) {
        Write-Utf8File ($StdoutPath + ".stderr.txt") $stderr
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "$FileName exited with code $exitCode. See $StdoutPath.stderr.txt"
    }
    return $exitCode
}

function Resolve-Adb {
    $existing = Get-Command adb -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        return $existing.Source
    }

    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $toolRoot = Join-Path $repoRoot ".local\android-platform-tools"
    $adbPath = Join-Path $toolRoot "platform-tools\adb.exe"
    if (Test-Path $adbPath) {
        return $adbPath
    }

    Write-Host "adb was not found. Downloading official Android platform-tools locally..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
    $zipPath = Join-Path $toolRoot "platform-tools-latest-windows.zip"
    $download = @{
        Uri = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
        OutFile = $zipPath
        UseBasicParsing = $true
    }
    Invoke-WebRequest @download
    Expand-Archive -Path $zipPath -DestinationPath $toolRoot -Force
    Remove-Item $zipPath -Force
    if (-not (Test-Path $adbPath)) {
        throw "Official platform-tools were downloaded but adb.exe was not found."
    }
    return $adbPath
}

$adb = Resolve-Adb
$deviceListPath = [System.IO.Path]::GetTempFileName()
try {
    Start-CapturedProcess -FileName $adb -Arguments @("devices", "-l") -StdoutPath $deviceListPath | Out-Null
    $deviceLines = @(Get-Content $deviceListPath | Where-Object {
        $_ -match '^\S+\s+device(?:\s|$)'
    })
}
finally {
    Remove-Item $deviceListPath -Force -ErrorAction SilentlyContinue
}

if ($Serial.Length -gt 0) {
    $selected = @($deviceLines | Where-Object {
        $_ -match ('^' + [Regex]::Escape($Serial) + '\s')
    })
    if ($selected.Count -eq 0) {
        throw "Authorized Android device '$Serial' was not found."
    }
    $deviceSerial = $Serial
}
else {
    if ($deviceLines.Count -eq 0) {
        throw "No authorized Android device found. Enable USB debugging and approve this PC."
    }
    if ($deviceLines.Count -gt 1) {
        throw "Multiple Android devices found. Re-run with -Serial <device-serial>."
    }
    $deviceSerial = ($deviceLines[0] -split '\s+')[0]
}

$adbPrefix = @("-s", $deviceSerial)
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$outputDirectory = Join-Path $OutputRoot ("pem-field-test-" + $timestamp)
$systemDirectory = Join-Path $outputDirectory "system"
$appDirectory = Join-Path $outputDirectory "app"
New-Item -ItemType Directory -Force -Path $systemDirectory, $appDirectory | Out-Null

Write-Host "Collecting Field-test bundle from the connected device..."
Start-CapturedProcess -FileName $adb -Arguments ($adbPrefix + @("shell", "am", "force-stop", $PackageName)) -StdoutPath (Join-Path $systemDirectory "force-stop.txt") -AllowFailure | Out-Null
Start-Sleep -Seconds 2

$runAsPath = Join-Path $systemDirectory "run-as.txt"
Start-CapturedProcess -FileName $adb -Arguments ($adbPrefix + @("shell", "run-as", $PackageName, "id")) -StdoutPath $runAsPath | Out-Null
if ((Get-Content $runAsPath -Raw) -notmatch 'uid=') {
    throw "run-as failed. Install the USB-debuggable Field-test APK, not the normal build."
}

$appTarPath = Join-Path $appDirectory "app-private-data.tar"
$privateDataArguments = $adbPrefix + @(
    "exec-out", "run-as", $PackageName,
    "tar", "-cf", "-", "."
)
Start-CapturedProcess -FileName $adb -Arguments $privateDataArguments -StdoutPath $appTarPath -Binary | Out-Null

$summaryPath = Join-Path $outputDirectory "coordinate-free-diagnostics.txt"
$summaryArguments = $adbPrefix + @(
    "exec-out", "run-as", $PackageName,
    "cat", "files/field-test-exports/latest-coordinate-free-diagnostics.txt"
)
Start-CapturedProcess -FileName $adb -Arguments $summaryArguments -StdoutPath $summaryPath -AllowFailure | Out-Null

$textCommands = @(
    @{ Name = "adb-version.txt"; Args = @("version") },
    @{ Name = "device-date.txt"; Args = $adbPrefix + @("shell", "date", "+%Y-%m-%dT%H:%M:%S%z") },
    @{ Name = "getprop.txt"; Args = $adbPrefix + @("shell", "getprop") },
    @{ Name = "battery.txt"; Args = $adbPrefix + @("shell", "dumpsys", "battery") },
    @{ Name = "batterystats-charged.txt"; Args = $adbPrefix + @("shell", "dumpsys", "batterystats", "--charged", $PackageName) },
    @{ Name = "batterystats-history.txt"; Args = $adbPrefix + @("shell", "dumpsys", "batterystats", "--history") },
    @{ Name = "power.txt"; Args = $adbPrefix + @("shell", "dumpsys", "power") },
    @{ Name = "deviceidle.txt"; Args = $adbPrefix + @("shell", "dumpsys", "deviceidle") },
    @{ Name = "thermalservice.txt"; Args = $adbPrefix + @("shell", "dumpsys", "thermalservice") },
    @{ Name = "package.txt"; Args = $adbPrefix + @("shell", "dumpsys", "package", $PackageName) },
    @{ Name = "appops.txt"; Args = $adbPrefix + @("shell", "cmd", "appops", "get", $PackageName) },
    @{ Name = "low-power-setting.txt"; Args = $adbPrefix + @("shell", "settings", "get", "global", "low_power") }
)

foreach ($command in $textCommands) {
    $capture = @{
        FileName = $adb
        Arguments = $command.Args
        StdoutPath = (Join-Path $systemDirectory $command.Name)
        AllowFailure = $true
    }
    Start-CapturedProcess @capture | Out-Null
}

$manifest = [ordered]@{
    formatVersion = 1
    collectedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    packageName = $PackageName
    deviceSerialSha256 = Get-Sha256Text $deviceSerial
    appPrivateArchive = "app/app-private-data.tar"
    coordinateFreeSummary = "coordinate-free-diagnostics.txt"
    containsRawLocation = $true
    autoUpload = $false
    warning = "This bundle contains raw location and app-private data. Keep it local and do not attach it to a public issue."
}
$manifestPath = Join-Path $outputDirectory "manifest.json"
Write-Utf8File $manifestPath ($manifest | ConvertTo-Json -Depth 5)

$resolvedOutput = (Resolve-Path $outputDirectory).Path
$hashLines = Get-ChildItem -Path $outputDirectory -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($resolvedOutput.Length + 1).Replace("\", "/")
    $hash = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLowerInvariant()
    "$hash  $relative"
}
Write-Utf8File (Join-Path $outputDirectory "SHA256SUMS.txt") (($hashLines -join "`n") + "`n")

$zipPath = $outputDirectory + ".zip"
Compress-Archive -Path (Join-Path $outputDirectory "*") -DestinationPath $zipPath -Force

if ($RestartApp) {
    Start-CapturedProcess -FileName $adb -Arguments ($adbPrefix + @("shell", "monkey", "-p", $PackageName, "1")) -StdoutPath (Join-Path $systemDirectory "restart-app.txt") -AllowFailure | Out-Null
}

Write-Host "Coordinate-free summary: $summaryPath"
Write-Host "Raw local bundle: $zipPath"
Write-Warning "The ZIP contains raw coordinates. Keep it local unless you intentionally share it through a private channel."
