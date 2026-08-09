#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:?APK path is required}"
EVIDENCE_DIR="${2:?Evidence directory is required}"
FIELD_TEST_PACKAGE="${3:?Field-test package is required}"

bash scripts/run-android-emulator-e2e.sh "$APK_PATH" "$EVIDENCE_DIR"

pwsh -NoProfile -File scripts/pull-field-test-bundle.ps1 \
  -OutputRoot "$EVIDENCE_DIR/device-bundles" \
  -PackageName "$FIELD_TEST_PACKAGE"

bundle_dir="$(find "$EVIDENCE_DIR/device-bundles" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
test -n "$bundle_dir"
test -s "$bundle_dir/app/app-private-data.tar"
test -s "$bundle_dir/coordinate-free-diagnostics.txt"
test -s "$bundle_dir/manifest.json"
test -s "$bundle_dir/SHA256SUMS.txt"
test -f "$bundle_dir.zip"

grep -q "device_model=" "$bundle_dir/coordinate-free-diagnostics.txt"
grep -q "session_started_at_iso_utc=" "$bundle_dir/coordinate-free-diagnostics.txt"
grep -q "start_battery_percent=" "$bundle_dir/coordinate-free-diagnostics.txt"
if grep -Eiq "latitude|longitude" "$bundle_dir/coordinate-free-diagnostics.txt"; then
  echo "Coordinate-free summary unexpectedly contains coordinate field names." >&2
  exit 1
fi

extracted_app_data="$EVIDENCE_DIR/extracted-app-data"
mkdir -p "$extracted_app_data"
tar -xf "$bundle_dir/app/app-private-data.tar" -C "$extracted_app_data"

python3 - "$EVIDENCE_DIR" <<'PY'
import json
import pathlib
import sqlite3
import sys


evidence = pathlib.Path(sys.argv[1])
root = evidence / "extracted-app-data"
database = next(root.rglob("personal-exploration-map.db"))
connection = sqlite3.connect(database)
rows = connection.execute(
    "SELECT kind, payload_json FROM tracking_diagnostic_events "
    "WHERE kind IN ('environment.session.started','environment.session.ended') "
    "ORDER BY occurred_at"
).fetchall()
connection.close()

kinds = [row[0] for row in rows]
assert "environment.session.started" in kinds, kinds
assert "environment.session.ended" in kinds, kinds
payloads = [json.loads(row[1]) for row in rows if row[1]]
required = {
    "manufacturer",
    "model",
    "androidVersion",
    "batteryLevelPercent",
    "elapsedRealtimeMs",
    "backgroundLocationGranted",
    "notificationGranted",
    "isDebuggable",
}
assert payloads, "environment payloads are missing"
assert required.issubset(payloads[0]), sorted(payloads[0])
assert payloads[0]["isDebuggable"] is True, payloads[0]
(evidence / "environment-events.json").write_text(
    json.dumps(payloads, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
PY
