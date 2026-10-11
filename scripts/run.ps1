# Runs a command with the repo-local Node first on PATH (this process only).
#   ./scripts/run.ps1 dev            -> npm run dev   (also test, build, typecheck, preview)
#   ./scripts/run.ps1 npm install x  -> npm install x (also npx, node)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ver = (Get-Content (Join-Path $root '.nvmrc') -Raw).Trim().TrimStart('v')
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$nodeDir = Join-Path $root ".node\node-v$ver-win-$arch"
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) { throw "Node $ver not found. Run ./scripts/setup.ps1 first." }

$env:PATH = "$nodeDir;$env:PATH"
$env:npm_config_cache = Join-Path $root '.node\npm-cache'
Set-Location $root

if ($args.Count -eq 0) { throw 'Usage: run.ps1 <script> | npm|npx|node <args>' }
$first = $args[0]
$rest = @($args | Select-Object -Skip 1)
if ($first -in 'npm', 'npx', 'node') { & $first @rest } else { $npmArgs = @("run") + @($args); & npm @npmArgs }
exit $LASTEXITCODE
