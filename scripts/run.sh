#!/usr/bin/env bash
# Runs a command with the repo-local Node first on PATH (this process only).
#   ./scripts/run.sh dev            -> npm run dev   (also test, build, typecheck, preview)
#   ./scripts/run.sh npm install x  -> npm install x (also npx, node)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
ver="$(tr -d 'v \r\n' < "$root/.nvmrc")"
case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "Use scripts/run.ps1 on Windows." >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; *) arch=arm64 ;; esac
dir="$root/.node/node-v$ver-$os-$arch/bin"
[ -x "$dir/node" ] || { echo "Node $ver not found. Run scripts/setup.sh first." >&2; exit 1; }

export PATH="$dir:$PATH"
export npm_config_cache="$root/.node/npm-cache"
cd "$root"
[ $# -gt 0 ] || { echo "Usage: run.sh <script> | npm|npx|node <args>" >&2; exit 1; }
case "$1" in npm|npx|node) exec "$@" ;; *) exec npm run "$@" ;; esac
