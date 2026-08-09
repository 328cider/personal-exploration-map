#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_DIR="${1:?evidence directory is required}"
FIELD_TEST_PACKAGE="${2:?field-test package is required}"
BUNDLE_ROOT="$EVIDENCE_DIR/device-bundles"

pwsh -NoProfile -File scripts/pull-field-test-bundle.ps1 \
  -OutputRoot "$BUNDLE_ROOT" \
  -PackageName "$FIELD_TEST_PACKAGE"

bundle_dir="$(find "$BUNDLE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'pem-field-test-*' | sort | tail -n 1)"
if [[ -z "$bundle_dir" ]]; then
  echo "USB collector did not create a field-test bundle directory under $BUNDLE_ROOT." >&2
  exit 1
fi

bundle_zip="$bundle_dir.zip"
test -s "$bundle_dir/app/app-private-data.tar"
test -s "$bundle_dir/coordinate-free-diagnostics.txt"
test -s "$bundle_dir/manifest.json"
test -s "$bundle_dir/SHA256SUMS.txt"
test -s "$bundle_zip"

grep -q '^device_model=' "$bundle_dir/coordinate-free-diagnostics.txt"
grep -q '^session_started_at_iso_utc=' "$bundle_dir/coordinate-free-diagnostics.txt"
grep -q '^start_battery_percent=' "$bundle_dir/coordinate-free-diagnostics.txt"
if grep -Eiq '(^|_)(latitude|longitude)(_|=)' "$bundle_dir/coordinate-free-diagnostics.txt"; then
  echo "Coordinate-free summary unexpectedly contains coordinate field names." >&2
  exit 1
fi

extracted="$EVIDENCE_DIR/extracted-app-data"
rm -rf "$extracted"
mkdir -p "$extracted"
tar -xf "$bundle_dir/app/app-private-data.tar" -C "$extracted"

python3 - "$EVIDENCE_DIR" "$bundle_dir" <<'PY'
import json
import pathlib
import sqlite3
import sys


evidence = pathlib.Path(sys.argv[1])
bundle = pathlib.Path(sys.argv[2])
root = evidence / "extracted-app-data"
databases = list(root.rglob("personal-exploration-map.db"))
assert len(databases) == 1, [str(path) for path in databases]

database = databases[0]
connection = sqlite3.connect(database)
try:
    rows = connection.execute(
        "SELECT kind, payload_json FROM tracking_diagnostic_events "
        "WHERE kind IN ('environment.session.started','environment.session.ended') "
        "ORDER BY occurred_at"
    ).fetchall()
finally:
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

manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
assert manifest["packageName"] == "com.cider328.personalexplorationmap.fieldtest"
assert manifest["containsRawLocation"] is True
assert manifest["autoUpload"] is False

(evidence / "environment-events.json").write_text(
    json.dumps(payloads, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
(evidence / "usb-verification.json").write_text(
    json.dumps(
        {
            "status": "passed",
            "bundleDirectory": str(bundle),
            "database": str(database),
            "eventKinds": kinds,
            "manifest": manifest,
        },
        indent=2,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
PY

echo "Field-test USB export verification passed: $bundle_dir"
