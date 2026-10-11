# Downloads the Node version in .nvmrc into ./.node (gitignored), then installs dependencies with it.
# Nothing is installed system-wide. Delete ./.node and ./node_modules to undo everything.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Windows PowerShell 5.1 downloads/extracts ~50x slower with the progress bar
$root = Split-Path -Parent $PSScriptRoot
$ver = (Get-Content (Join-Path $root '.nvmrc') -Raw).Trim().TrimStart('v')
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$name = "node-v$ver-win-$arch"
$nodeDir = Join-Path $root ".node\$name"

if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    $base = "https://nodejs.org/dist/v$ver"
    $tmp = Join-Path $root '.node'
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $zip = Join-Path $tmp "$name.zip"
    Write-Host "Downloading $name ..."
    Invoke-WebRequest -UseBasicParsing "$base/$name.zip" -OutFile $zip
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    $want = ($sums -split "`n" | Where-Object { $_ -match "$name\.zip" } | Select-Object -First 1).Split(' ')[0]
    $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($want -ne $got) { Remove-Item $zip; throw "Checksum mismatch for $name.zip" }
    Expand-Archive $zip -DestinationPath $tmp -Force
    Remove-Item $zip
}

& (Join-Path $PSScriptRoot 'run.ps1') npm ci
