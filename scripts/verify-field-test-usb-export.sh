#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_DIR="${1:?evidence directory is required}"
FIELD_TEST_PACKAGE="${2:?field-test package is required}"
EXPECTED_DATABASE_VERSION="${3:-}"
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

summary="$bundle_dir/coordinate-free-diagnostics.txt"
grep -q '^personal_exploration_map_diagnostics_format=3$' "$summary"
grep -q '^report_version=3$' "$summary"
grep -q '^device_model=' "$summary"
grep -q '^session_started_at_iso_utc=' "$summary"
grep -q '^start_battery_percent=' "$summary"
grep -q '^sample_before_start_count=' "$summary"
grep -q '^sample_after_end_count=' "$summary"
grep -q '^callback_gap_ms_count=' "$summary"
grep -q '^callback_newest_observation_age_ms_count=' "$summary"
grep -q '^callback_future_observation_batches=' "$summary"
if grep -Eiq '(^|_)(latitude|longitude)(_|=)' "$summary"; then
  echo "Coordinate-free summary unexpectedly contains coordinate field names." >&2
  exit 1
fi

extracted="$EVIDENCE_DIR/extracted-app-data"
rm -rf "$extracted"
mkdir -p "$extracted"
tar -xf "$bundle_dir/app/app-private-data.tar" -C "$extracted"

python3 - \
  "$EVIDENCE_DIR" \
  "$bundle_dir" \
  "$EXPECTED_DATABASE_VERSION" <<'PY'
import json
import pathlib
import sqlite3
import sys


evidence = pathlib.Path(sys.argv[1])
bundle = pathlib.Path(sys.argv[2])
expected_database_version = int(sys.argv[3]) if sys.argv[3] else None
root = evidence / "extracted-app-data"
databases = list(root.rglob("personal-exploration-map.db"))
assert len(databases) == 1, [str(path) for path in databases]

database = databases[0]
connection = sqlite3.connect(database)
try:
    user_version = connection.execute("PRAGMA user_version").fetchone()[0]
    diagnostic_rows = connection.execute(
        "SELECT kind, payload_json FROM tracking_diagnostic_events "
        "WHERE kind IN ('environment.session.started','environment.session.ended') "
        "ORDER BY occurred_at"
    ).fetchall()
    callback_rows = connection.execute(
        "SELECT payload_json FROM tracking_diagnostic_events "
        "WHERE kind = 'callback.received' ORDER BY occurred_at"
    ).fetchall()
    if user_version >= 4:
        raw_rows = connection.execute(
            "SELECT exploration_id, id, sample_ordinal, ordinal_provenance, "
            "raw_payload_format, raw_payload_json, source, coordinate_kind "
            "FROM position_samples "
            "ORDER BY exploration_id, sample_ordinal"
        ).fetchall()
    else:
        raw_rows = []
finally:
    connection.close()

if expected_database_version is not None:
    assert user_version == expected_database_version, (
        user_version,
        expected_database_version,
    )
else:
    assert user_version in {3, 4}, user_version

kinds = [row[0] for row in diagnostic_rows]
assert "environment.session.started" in kinds, kinds
assert "environment.session.ended" in kinds, kinds
payloads = [json.loads(row[1]) for row in diagnostic_rows if row[1]]
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

callback_payloads = [json.loads(row[0]) for row in callback_rows if row[0]]
assert callback_payloads, "callback.received diagnostics are missing"
for payload in callback_payloads:
    assert isinstance(payload.get("sampleCount"), (int, float)), payload
    assert isinstance(payload.get("callbackReceivedAtMs"), (int, float)), payload
    assert isinstance(payload.get("firstSampleAtMs"), (int, float)), payload
    assert isinstance(payload.get("lastSampleAtMs"), (int, float)), payload

ordinals_by_exploration = {}
if user_version >= 4:
    assert raw_rows, "field-test database contains no canonical raw observations"
    for (
        exploration_id,
        sample_id,
        sample_ordinal,
        ordinal_provenance,
        raw_payload_format,
        raw_payload_json,
        source,
        coordinate_kind,
    ) in raw_rows:
        assert raw_payload_format == "raw-position-sample-exact-v1", (
            exploration_id,
            sample_id,
            raw_payload_format,
        )
        assert ordinal_provenance == "ingest-sequence-v1", (
            exploration_id,
            sample_id,
            ordinal_provenance,
        )
        assert sample_ordinal is not None
        assert raw_payload_json is not None
        raw_payload = json.loads(raw_payload_json)
        assert raw_payload["schema"] == "raw-position-sample-exact-v1"
        assert raw_payload["id"] == sample_id
        assert raw_payload["source"] == source
        assert raw_payload["position"]["kind"] == coordinate_kind
        assert isinstance(raw_payload["recordedAtMs"], str)
        assert isinstance(raw_payload["confidence"], str)
        ordinals_by_exploration.setdefault(exploration_id, []).append(
            sample_ordinal
        )

    for exploration_id, ordinals in ordinals_by_exploration.items():
        assert ordinals == list(range(len(ordinals))), (
            exploration_id,
            ordinals,
        )

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
            "databaseUserVersion": user_version,
            "expectedDatabaseVersion": expected_database_version,
            "diagnosticsFormat": 3,
            "callbackReceivedBatchCount": len(callback_payloads),
            "callbackObservationTimingStatus": "verified",
            "exactRawEvidenceStatus": (
                "verified" if user_version >= 4 else "not-available-schema-v3"
            ),
            "exactRawSampleCount": len(raw_rows),
            "exactRawExplorationCount": len(ordinals_by_exploration),
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
