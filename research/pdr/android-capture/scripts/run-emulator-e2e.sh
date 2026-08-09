#!/usr/bin/env bash
set -euo pipefail

app_apk="${1:?app APK path required}"
test_apk="${2:?test APK path required}"
evidence_dir="${3:?evidence directory required}"
package="com.personalexplorationmap.pdrcapture"
test_package="${package}.test"
runner="${test_package}/androidx.test.runner.AndroidJUnitRunner"

mkdir -p "$evidence_dir/bundle"
exec > >(tee "$evidence_dir/runner.txt") 2>&1

dump_ui() {
  local name="$1"
  local remote="/sdcard/pdr-${name}.xml"
  for attempt in 1 2 3; do
    if adb shell uiautomator dump --compressed "$remote" >/dev/null 2>&1; then
      adb exec-out cat "$remote" > "$evidence_dir/${name}.xml"
      break
    fi
    sleep 1
  done
  test -s "$evidence_dir/${name}.xml"
  adb exec-out screencap -p > "$evidence_dir/${name}.png"
}

collect_diagnostics() {
  set +e
  adb shell getprop > "$evidence_dir/getprop.txt"
  adb shell dumpsys package "$package" > "$evidence_dir/package.txt"
  adb shell dumpsys activity activities > "$evidence_dir/activities.txt"
  adb shell dumpsys activity services "$package" > "$evidence_dir/services.txt"
  adb shell dumpsys activity exit-info "$package" > "$evidence_dir/exit-info.txt"
  adb shell dumpsys notification > "$evidence_dir/notification.txt"
  adb shell dumpsys sensorservice > "$evidence_dir/sensorservice.txt"
  adb logcat -d -v threadtime > "$evidence_dir/logcat.txt"
  adb logcat -b crash -d -v threadtime > "$evidence_dir/crash-logcat.txt"
  set -e
}
trap collect_diagnostics EXIT

sha256sum "$app_apk" "$test_apk" > "$evidence_dir/installed-apk-sha256.txt"
adb uninstall "$test_package" > "$evidence_dir/uninstall-test.txt" 2>&1 || true
adb uninstall "$package" > "$evidence_dir/uninstall-app.txt" 2>&1 || true
adb install --no-streaming "$app_apk" | tee "$evidence_dir/install-app.txt"
adb install --no-streaming "$test_apk" | tee "$evidence_dir/install-test.txt"
grep -q "Success" "$evidence_dir/install-app.txt"
grep -q "Success" "$evidence_dir/install-test.txt"
adb shell pm path "$package" | tee "$evidence_dir/package-path.txt"
grep -q "package:" "$evidence_dir/package-path.txt"

adb logcat -c
adb logcat -b crash -c
adb shell am force-stop "$package"
adb shell am start -W -n "$package/.MainActivity" | tee "$evidence_dir/cold-start.txt"
grep -q "Status: ok" "$evidence_dir/cold-start.txt"
sleep 3
dump_ui "cold-start"
grep -q "PDR raw capture" "$evidence_dir/cold-start.xml"
grep -q "IMU6 capability: available" "$evidence_dir/cold-start.xml"
grep -q "c0-screen-on-live50" "$evidence_dir/cold-start.xml"
grep -q "revision" "$evidence_dir/cold-start.xml"

adb shell pm grant "$package" android.permission.POST_NOTIFICATIONS
adb shell pm revoke "$package" android.permission.ACCESS_FINE_LOCATION || true
adb shell pm revoke "$package" android.permission.ACCESS_COARSE_LOCATION || true
adb shell pm revoke "$package" android.permission.ACTIVITY_RECOGNITION || true

set +e
adb shell am instrument -w "$runner" | tee "$evidence_dir/instrumentation.txt"
instrument_status="${PIPESTATUS[0]}"
set -e
if [[ "$instrument_status" -ne 0 ]] || ! grep -Eq "OK \([0-9]+ tests?\)" "$evidence_dir/instrumentation.txt"; then
  exit 1
fi

adb shell am force-stop "$package"
adb shell am start -W -n "$package/.MainActivity" | tee "$evidence_dir/relaunch.txt"
grep -q "Status: ok" "$evidence_dir/relaunch.txt"
sleep 3
dump_ui "relaunch"
grep -Eq "Completed bundles: [3-9]" "$evidence_dir/relaunch.xml"
grep -q "Active request: none" "$evidence_dir/relaunch.xml"

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

adb exec-out run-as "$package" cat "cache/emulator-e2e.zip" \
  > "$evidence_dir/exported-emulator-e2e.zip"
test -s "$evidence_dir/exported-emulator-e2e.zip"

python research/pdr/scripts/validate_emulator_capture.py "$evidence_dir/bundle" \
  --quality-output "$evidence_dir/capture-quality.json" \
  --gate-output "$evidence_dir/emulator-plumbing-gate.json"
python research/pdr/scripts/validate_emulator_capture.py "$evidence_dir/exported-emulator-e2e.zip" \
  --quality-output "$evidence_dir/exported-capture-quality.json" \
  --gate-output "$evidence_dir/exported-emulator-plumbing-gate.json"
cmp "$evidence_dir/capture-quality.json" "$evidence_dir/exported-capture-quality.json"
cmp "$evidence_dir/emulator-plumbing-gate.json" "$evidence_dir/exported-emulator-plumbing-gate.json"

collect_diagnostics
if grep -q "$package" "$evidence_dir/crash-logcat.txt"; then
  echo "Target package crash detected" >&2
  exit 1
fi

python - "$evidence_dir" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
gate = json.loads((root / "emulator-plumbing-gate.json").read_text(encoding="utf-8"))
result = {
    "schema_version": "pdr-emulator-device-readiness/v1",
    "accepted": gate["accepted"],
    "checks": {
        "clean_install": True,
        "cold_start": True,
        "safe_c0_defaults_visible": True,
        "mandatory_imu_visible": True,
        "instrumentation_passed": True,
        "optional_permission_denial_passed": True,
        "screen_off_background_return_passed": True,
        "walking_request_rejected": True,
        "force_stop_relaunch_persistence_passed": True,
        "app_private_bundle_validated": True,
        "exported_zip_validated": True,
        "target_package_crash_free": True,
    },
    "device_candidate": False,
    "physical_sensor_evidence": False,
    "product_usable": False,
    "counts_toward_capture_kpis": False,
}
(root / "emulator-device-readiness.json").write_text(
    json.dumps(result, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
print(json.dumps(result, indent=2, sort_keys=True))
PY
