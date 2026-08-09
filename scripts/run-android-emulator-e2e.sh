#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path is required}"
EVIDENCE_DIR="${2:?Evidence directory is required}"

python3 scripts/android-emulator-background-growth-runner.py \
  "$APK_PATH" \
  --artifacts "$EVIDENCE_DIR"

python3 scripts/android-emulator-coverage-modes.py \
  --artifacts "$EVIDENCE_DIR"

python3 scripts/android-emulator-interaction-runner.py \
  --artifacts "$EVIDENCE_DIR"
