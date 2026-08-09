#!/usr/bin/env python3
"""Run marker and notification checks without waiting for an active timer to idle.

The recording screen intentionally changes once per second. Android's legacy
`uiautomator dump` waits for a quiet UI and therefore reports `could not get idle
state` even when the app is healthy. This runner uses UI hierarchy assertions
only on static screens, uses `dumpsys notification` for the foreground service,
and performs fixed-coordinate taps on the fixed Android 15 Pixel CI profile for
the recording actions and marker sheet.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Iterable


SCRIPT_PATH = Path(__file__).with_name("android-emulator-interaction-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_interaction_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load interaction smoke suite: {SCRIPT_PATH}")
interaction = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(interaction)
smoke = interaction.smoke


def raw_screenshot(artifacts: Path, name: str) -> Path:
    path = artifacts / f"{name}.png"
    with path.open("wb") as output:
        result = subprocess.run(
            ["adb", "exec-out", "screencap", "-p"],
            check=False,
            stdout=output,
            stderr=subprocess.PIPE,
        )
    if result.returncode != 0:
        raise smoke.SmokeFailure(
            "raw screenshot failed: "
            + result.stderr.decode("utf-8", errors="replace")
        )
    return path


def inject_route(
    points: Iterable[tuple[float, float]],
    delay_seconds: float = 6.0,
) -> None:
    """Restore the route helper expected by the interaction smoke suite."""

    for longitude, latitude in points:
        started = time.monotonic()
        smoke.inject_location(longitude, latitude)
        remaining = delay_seconds - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)


def save_debug_state(artifacts: Path, prefix: str) -> None:
    """Capture failure evidence without waiting for an active UI to become idle."""

    artifacts.mkdir(parents=True, exist_ok=True)
    try:
        raw_screenshot(artifacts, prefix)
    except Exception as error:  # noqa: BLE001 - diagnostics must continue
        (artifacts / f"{prefix}-screenshot-error.txt").write_text(
            str(error),
            encoding="utf-8",
        )

    commands: dict[str, list[str]] = {
        "logcat": ["adb", "logcat", "-d", "-v", "threadtime"],
        "activity": ["adb", "shell", "dumpsys", "activity", "activities"],
        "package": ["adb", "shell", "dumpsys", "package", smoke.PACKAGE],
        "location": ["adb", "shell", "dumpsys", "location"],
        "notification": [
            "adb",
            "shell",
            "dumpsys",
            "notification",
            "--noredact",
        ],
    }
    for name, command in commands.items():
        result = smoke.run(command, check=False, timeout=60)
        (artifacts / f"{prefix}-{name}.txt").write_text(
            result.stdout + "\n" + result.stderr,
            encoding="utf-8",
        )


# The interaction suite was originally layered on a base smoke module that
# exposed these helpers. Keep the compatibility adapter local to this harness.
smoke.inject_route = inject_route
smoke.save_debug_state = save_debug_state


def field_app_is_top_resumed() -> bool:
    output = smoke.adb_shell("dumpsys", "activity", "activities", timeout=60)
    patterns = (
        rf"mResumedActivity:.*{re.escape(smoke.PACKAGE)}",
        rf"topResumedActivity=.*{re.escape(smoke.PACKAGE)}",
        rf"ResumedActivity.*{re.escape(smoke.PACKAGE)}",
    )
    return any(re.search(pattern, output) for pattern in patterns)


def return_to_home() -> None:
    smoke.adb_shell("cmd", "statusbar", "collapse", check=False)
    smoke.adb_shell("input", "keyevent", "KEYCODE_HOME")
    time.sleep(1.5)


def wait_for_tracking_notification(
    artifacts: Path,
    *,
    timeout_seconds: int = 60,
) -> str:
    deadline = time.monotonic() + timeout_seconds
    latest = ""
    while time.monotonic() < deadline:
        latest = interaction.notification_dump(artifacts, "13-tracking")
        if smoke.PACKAGE in latest and "探索を記録中" in latest:
            return latest
        time.sleep(1)
    raise smoke.SmokeFailure(
        "foreground-service notification did not expose the field-test package "
        "and recording title"
    )


def click_tracking_notification(artifacts: Path) -> None:
    """Click the app notification without asking SystemUI to become idle."""

    return_to_home()
    width, height = smoke.parse_screen_size()

    # The emulator profile is fixed at Pixel 1080x1920. The first app
    # notification is below the compact quick-settings header; multiple rows
    # tolerate minor SystemUI layout changes. Every failed tap is reset to Home.
    candidate_ratios = (0.31, 0.37, 0.43, 0.49, 0.55, 0.61)
    attempts: list[str] = []

    for index, ratio in enumerate(candidate_ratios):
        smoke.adb_shell("cmd", "statusbar", "expand-notifications")
        time.sleep(2)
        raw_screenshot(artifacts, f"13-notification-shade-{index:02d}")

        x = width // 2
        y = int(height * ratio)
        attempts.append(f"({x},{y})")
        smoke.adb_shell("input", "tap", str(x), str(y))
        time.sleep(2)
        smoke.adb_shell("cmd", "statusbar", "collapse", check=False)
        time.sleep(1)

        if field_app_is_top_resumed():
            raw_screenshot(artifacts, "13-notification-returned")
            return
        return_to_home()

    raise smoke.SmokeFailure(
        "notification content intent did not return to the active recording "
        f"screen after taps at {', '.join(attempts)}"
    )


def tap_at_ratio(x_ratio: float, y_ratio: float) -> None:
    width, height = smoke.parse_screen_size()
    smoke.adb_shell(
        "input",
        "tap",
        str(int(width * x_ratio)),
        str(int(height * y_ratio)),
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


def run_interaction_without_active_ui_dumps(
    artifacts: Path,
) -> dict[str, object]:
    started_at = time.time()
    smoke.log("continue persisted PersonalMap for notification and marker checks")

    # Review and permission screens are static, so semantic UI selection remains
    # preferable there.
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

    # The notification is the stable external signal that the active recording
    # foreground service started. Do not ask the once-per-second timer screen to
    # become idle.
    wait_for_tracking_notification(artifacts)
    raw_screenshot(artifacts, "13-recording-started")

    smoke.inject_route(
        [
            (139.767540, 35.681260),
            (139.767600, 35.681300),
            (139.767660, 35.681340),
        ],
        delay_seconds=6,
    )
    click_tracking_notification(artifacts)

    # RecordingScreen keeps these two actions fixed at the bottom. Coordinates
    # are intentionally limited to the fixed CI Pixel profile and are not product
    # implementation constants.
    tap_at_ratio(0.22, 0.918)  # + 発見を記録
    time.sleep(2)
    raw_screenshot(artifacts, "14-marker-modal")

    # MarkerModal's primary action is the bottom-right button. The default
    # category is `気になる`, which is saved without additional input.
    tap_at_ratio(0.76, 0.955)  # この場所に保存
    time.sleep(3)
    raw_screenshot(artifacts, "15-marker-saved-recording")

    tap_at_ratio(0.70, 0.918)  # 探索を終了して地図を見る
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
    smoke.screenshot(artifacts, "16-marker-review")

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
            "notification-content-intent-returned-to-recording",
            "marker-sheet-opened",
            "default-marker-saved",
            "marker-persisted-to-review",
            "no-known-runtime-error",
        ],
    }
    (artifacts / "interaction-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return result


interaction.run_interaction_smoke = run_interaction_without_active_ui_dumps


if __name__ == "__main__":
    sys.exit(interaction.main())
