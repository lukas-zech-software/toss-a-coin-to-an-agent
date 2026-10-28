#!/bin/bash
# Usage: scripts/hwcheck/shoot.sh <name> [/main/path=value ...]
# Captures RAW+JPG into samples/<name>.jpg and samples/<name>.cr2 (camera RAM only, card untouched).
set -euo pipefail
name="$1"; shift
root="$(cd "$(dirname "$0")/../.." && pwd)"; out="$root/samples"; mkdir -p "$out"
args=(--set-config-value "/main/imgsettings/imageformat=RAW + L" --set-config-value "/main/settings/capturetarget=Internal RAM")
for kv in "$@"; do args+=(--set-config-value "$kv"); done
killall ptpcamerad 2>/dev/null || true; killall "EOS Utility" 2>/dev/null || true
start=$(date +%s)
gphoto2 "${args[@]}" --capture-image-and-download --filename "$out/$name.%C" --force-overwrite
echo "capture took $(( $(date +%s) - start ))s"
for ext in JPG CR2; do if [ -f "$out/$name.$ext" ]; then mv "$out/$name.$ext" "$out/$name.$(echo "$ext" | tr A-Z a-z)"; fi; done
ls -la "$out/$name".*
