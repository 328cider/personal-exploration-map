#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path is required}"
EVIDENCE_DIR="${2:?Evidence directory is required}"
FIELD_TEST_PACKAGE="${3:?Field-test package is required}"

bash scripts/run-android-emulator-e2e.sh "$APK_PATH" "$EVIDENCE_DIR"
bash scripts/verify-field-test-usb-export.sh \
  "$EVIDENCE_DIR" \
  "$FIELD_TEST_PACKAGE"
