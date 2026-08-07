param(
    [string]$HostAddress
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($HostAddress)) {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.InterfaceAlias -notmatch "vEthernet|WSL|Docker|Loopback" -and
            -not $_.SkipAsSource
        }

    $HostAddress = $candidates |
        Sort-Object InterfaceMetric, PrefixLength |
        Select-Object -First 1 -ExpandProperty IPAddress
}

if ([string]::IsNullOrWhiteSpace($HostAddress)) {
    throw "Could not detect a LAN IPv4 address. Run again with -HostAddress <PC-LAN-IP>."
}

$env:REACT_NATIVE_PACKAGER_HOSTNAME = $HostAddress
Write-Host "Metro will advertise $HostAddress`:8081"
Write-Host "Keep the Android device and this PC on the same Wi-Fi network."

docker compose up metro
