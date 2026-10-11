#!/usr/bin/env bash
# Downloads the Node version in .nvmrc into ./.node (gitignored), then installs dependencies with it.
# Nothing is installed system-wide. Delete ./.node and ./node_modules to undo everything.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
ver="$(tr -d 'v \r\n' < "$root/.nvmrc")"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "Unsupported shell/OS $(uname -s). On Windows use scripts/setup.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac

name="node-v$ver-$os-$arch"
dir="$root/.node/$name"
if [ ! -x "$dir/bin/node" ]; then
  base="https://nodejs.org/dist/v$ver"
  mkdir -p "$root/.node"
  tgz="$root/.node/$name.tar.gz"
  echo "Downloading $name ..."
  curl -fsSL "$base/$name.tar.gz" -o "$tgz"
  want="$(curl -fsSL "$base/SHASUMS256.txt" | grep " $name.tar.gz\$" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null; then got="$(sha256sum "$tgz" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$tgz" | cut -d' ' -f1)"; fi
  [ "$want" = "$got" ] || { rm -f "$tgz"; echo "Checksum mismatch for $name.tar.gz" >&2; exit 1; }
  tar -xzf "$tgz" -C "$root/.node"
  rm -f "$tgz"
fi

exec "$root/scripts/run.sh" npm ci
