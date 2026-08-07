#!/usr/bin/env python3
"""Extend the base emulator lifecycle with marker and notification checks.

The base smoke test leaves the installed app on a persisted PersonalMap Review.
This script continues through the normal UI, starts a second exploration, checks
the Android foreground-service notification, records a confirmed marker, and
verifies the marker in Review. It never writes directly to SQLite or mapping
internals.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import xml.etree.ElementTree as ET


SCRIPT_PATH = Path(__file__).with_name("android-emulator-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_android_emulator_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load base smoke helpers: {SCRIPT_PATH}")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


def fresh_dump_ui(artifacts: Path, name: str) -> tuple[ET.Element, Path]:
    """Dump to a unique remote path so UI Automator cannot return stale XML."""

    last_error = ""
    for attempt in range(5):
        remote_path = f"/sdcard/pem-window-{time.time_ns()}-{attempt}.xml"
        smoke.adb_shell("rm", "-f", remote_path, check=False, timeout=15)
        result = smoke.run(
            [
                "adb",
                "shell",
                "uiautomator",
                "dump",
                "--compressed",
                remote_path,
            ],
            check=False,
            timeout=30,
        )
        if result.returncode == 0:
            xml_text = smoke.adb_shell("cat", remote_path, timeout=30)
            smoke.adb_shell("rm", "-f", remote_path, check=False, timeout=15)
            if "<hierarchy" in xml_text:
                path = artifacts / f"{name}.xml"
                path.write_text(xml_text, encoding="utf-8")
                return ET.fromstring(xml_text), path
        last_error = f"stdout={result.stdout!r} stderr={result.stderr!r}"
        time.sleep(1)
    raise smoke.SmokeFailure(f"could not dump fresh UI hierarchy: {last_error}")


# The base lifecycle used a fixed remote file name. On long, sequential suites
# UI Automator can report success while the old file remains, so the screenshot
# and hierarchy describe different screens. Replace the module-global helper;
# wait_for_node and screenshot resolve it dynamically.
smoke.dump_ui = fresh_dump_ui


def exact_text_exists(root: ET.Element, expected: str) -> bool:
    return any(
        node.attrib.get("text", "").strip() == expected
        for node in root.iter("node")
    )


def assert_no_known_runtime_errors(log_text: str) -> None:
    patterns = [
        r"FATAL EXCEPTION",
        r"Cannot use shared object that was already released",
        r"NativeDatabase\.prepareAsync",
        r"NativeStatement",
        r"ReactNativeJS.*(?:Error|Unhandled)",
    ]
    matches = [pattern for pattern in patterns if re.search(pattern, log_text, re.I)]
    if matches:
        raise smoke.SmokeFailure(
            "known fatal/runtime error appeared in logcat: " + ", ".join(matches)
        )


def notification_dump(artifacts: Path, name: str) -> str:
    output = smoke.adb_shell(
        "dumpsys",
        "notification",
        "--noredact",
        timeout=60,
    )
    (artifacts / f"{name}-notification.txt").write_text(
        output,
        encoding="utf-8",
    )
    return output


def assert_tracking_notification(artifacts: Path) -> None:
    output = notification_dump(artifacts, "09-tracking")
    if smoke.PACKAGE not in output:
        raise smoke.SmokeFailure(
            "foreground-service notification does not reference the field-test package"
        )
    if "探索を記録中" not in output:
        raise smoke.SmokeFailure(
            "foreground-service notification does not contain the recording title"
        )


def open_tracking_notification(artifacts: Path) -> None:
    smoke.adb_shell("cmd", "statusbar", "expand-notifications")
    node = smoke.wait_for_node(
        artifacts,
        "探索を記録中",
        timeout_seconds=30,
        dump_prefix="notification-shade",
    )
    smoke.screenshot(artifacts, "09-notification-shade")
    smoke.tap_node(node)
    smoke.wait_for_node(
        artifacts,
        "探索を記録中",
        timeout_seconds=45,
        dump_prefix="notification-return",
    )


def run_interaction_smoke(artifacts: Path) -> dict[str, object]:
    started_at = time.time()
    smoke.log("continue persisted PersonalMap for notification and marker checks")

    smoke.wait_for_node(
        artifacts,
        "YOUR PERSONAL MAP",
        timeout_seconds=45,
        dump_prefix="interaction-review-start",
    )
    smoke.tap_text(
        artifacts,
        "この地図の続きを探索",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="interaction-continue",
    )
    smoke.wait_for_node(
        artifacts,
        "ポケット記録を許可して開始",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="interaction-permission",
    )
    smoke.tap_text(
        artifacts,
        "ポケット記録を許可して開始",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="interaction-start",
    )
    smoke.wait_for_node(
        artifacts,
        "探索を記録中",
        timeout_seconds=60,
        dump_prefix="interaction-recording",
    )

    smoke.inject_route(
        [
            (139.767540, 35.681260),
            (139.767600, 35.681300),
            (139.767660, 35.681340),
        ],
        delay_seconds=6,
    )
    assert_tracking_notification(artifacts)
    open_tracking_notification(artifacts)

    smoke.tap_text(
        artifacts,
        "＋ 発見を記録",
        timeout_seconds=30,
        dump_prefix="marker-open",
    )
    smoke.wait_for_node(
        artifacts,
        "発見を記録",
        timeout_seconds=30,
        dump_prefix="marker-modal",
    )
    smoke.wait_for_node(
        artifacts,
        "気になる",
        timeout_seconds=30,
        dump_prefix="marker-category",
    )
    smoke.screenshot(artifacts, "10-marker-modal")

    smoke.tap_text(
        artifacts,
        "この場所に保存",
        timeout_seconds=30,
        dump_prefix="marker-save",
    )
    smoke.wait_for_node(
        artifacts,
        "探索を記録中",
        timeout_seconds=45,
        dump_prefix="marker-recording-return",
    )

    # The recording screen has one explicit numeric marker metric. Confirm the
    # user-visible count, not a direct database value.
    marker_count_deadline = time.monotonic() + 45
    attempt = 0
    while time.monotonic() < marker_count_deadline:
        root, _ = smoke.dump_ui(
            artifacts,
            f"marker-count-{attempt:02d}",
        )
        if exact_text_exists(root, "1") and smoke.find_node(root, "発見") is not None:
            break
        time.sleep(1)
        attempt += 1
    else:
        raise smoke.SmokeFailure("recording screen did not show marker count 1")
    smoke.screenshot(artifacts, "11-marker-saved")

    smoke.tap_text(
        artifacts,
        "探索を終了して地図を見る",
        timeout_seconds=45,
        dump_prefix="marker-end",
    )
    smoke.wait_for_node(
        artifacts,
        "YOUR PERSONAL MAP",
        timeout_seconds=75,
        dump_prefix="marker-review",
    )
    smoke.wait_for_node(
        artifacts,
        "気になる",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="marker-review-item",
    )
    smoke.screenshot(artifacts, "12-marker-review")

    log_text = smoke.adb("logcat", "-d", "-v", "threadtime", timeout=60)
    (artifacts / "interaction-final-logcat.txt").write_text(
        log_text,
        encoding="utf-8",
    )
    assert_no_known_runtime_errors(log_text)

    elapsed = round(time.time() - started_at, 2)
    result = {
        "status": "passed",
        "package": smoke.PACKAGE,
        "elapsedSeconds": elapsed,
        "assertions": [
            "continued-existing-personal-map",
            "foreground-service-notification-visible",
            "notification-returned-to-active-recording",
            "marker-modal-opened",
            "marker-count-updated",
            "marker-persisted-to-review",
            "no-known-runtime-error",
        ],
    }
    (artifacts / "interaction-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)

    try:
        result = run_interaction_smoke(artifacts)
        smoke.save_debug_state(artifacts, "interaction-final")
        smoke.log(f"INTERACTION PASS in {result['elapsedSeconds']}s")
        return 0
    except Exception as error:  # noqa: BLE001 - keep complete CI evidence
        (artifacts / "interaction-failure.txt").write_text(
            f"{type(error).__name__}: {error}\n",
            encoding="utf-8",
        )
        smoke.save_debug_state(artifacts, "interaction-failure")
        smoke.log(f"INTERACTION FAIL: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
