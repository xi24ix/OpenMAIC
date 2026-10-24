#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/scripts/bin/vision-ocr}"

mkdir -p "$(dirname "$out")"
swiftc -O "$root/scripts/vision-ocr.swift" -o "$out"
printf '%s\n' "$out"
