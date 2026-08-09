#!/usr/bin/env bash
set -euo pipefail

app_apk="${1:?app APK path required}"
test_apk="${2:?test APK path required}"
evidence_dir="${3:?evidence directory required}"
package="com.personalexplorationmap.pdrcapture"
runner="${package}.test/androidx.test.runner.AndroidJUnitRunner"

mkdir -p "$evidence_dir/bundle"
adb install -r "$app_apk"
adb install -r "$test_apk"
adb shell pm grant "$package" android.permission.POST_NOTIFICATIONS || true

set +e
adb shell am instrument -w "$runner" | tee "$evidence_dir/instrumentation.txt"
instrument_status="${PIPESTATUS[0]}"
set -e

adb shell dumpsys package "$package" > "$evidence_dir/package.txt"
adb shell dumpsys notification > "$evidence_dir/notification.txt"
adb shell dumpsys sensorservice > "$evidence_dir/sensorservice.txt"
adb logcat -d -v threadtime > "$evidence_dir/logcat.txt"

if [[ "$instrument_status" -ne 0 ]] || ! grep -q "OK (1 test)" "$evidence_dir/instrumentation.txt"; then
  exit 1
fi

bundle_root="files/pdr-captures/emulator-e2e.complete"
adb exec-out run-as "$package" cat "$bundle_root/session_manifest.json" \
  > "$evidence_dir/bundle/session_manifest.json"
adb exec-out run-as "$package" cat "$bundle_root/COMPLETED" \
  > "$evidence_dir/bundle/COMPLETED"

while IFS= read -r relative; do
  adb exec-out run-as "$package" cat "$bundle_root/$relative" \
    > "$evidence_dir/bundle/$relative"
done < <(
  python - "$evidence_dir/bundle/session_manifest.json" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
seen = set()
for entry in manifest["files"]:
    relative = entry["path"]
    path = pathlib.PurePosixPath(relative)
    if path.is_absolute() or len(path.parts) != 1 or relative in seen:
        raise SystemExit(f"unsafe or duplicate manifest evidence path: {relative!r}")
    seen.add(relative)
    print(relative)
PY
)

python research/pdr/scripts/validate_emulator_capture.py "$evidence_dir/bundle" \
  --quality-output "$evidence_dir/capture-quality.json" \
  --gate-output "$evidence_dir/emulator-plumbing-gate.json"
