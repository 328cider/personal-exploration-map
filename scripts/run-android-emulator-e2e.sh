#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path is required}"
EVIDENCE_DIR="${2:?Evidence directory is required}"

python3 scripts/android-emulator-smoke.py \
  --apk "$APK_PATH" \
  --artifacts "$EVIDENCE_DIR"

python3 scripts/android-emulator-interaction-smoke.py \
  --artifacts "$EVIDENCE_DIR"
