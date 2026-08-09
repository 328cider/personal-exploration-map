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

files=(session_start.json session_manifest.json COMPLETED)
while IFS= read -r path; do files+=("$path"); done < <(
  adb shell run-as "$package" sh -c 'ls files/pdr-captures/emulator-e2e.complete/*.jsonl' \
    | tr -d '\r' \
    | sed 's#^files/pdr-captures/emulator-e2e.complete/##'
)

for relative in "${files[@]}"; do
  adb exec-out run-as "$package" cat "files/pdr-captures/emulator-e2e.complete/$relative" \
    > "$evidence_dir/bundle/$relative"
done

python research/pdr/scripts/validate_capture_bundle.py "$evidence_dir/bundle" \
  --output "$evidence_dir/capture-quality.json"
