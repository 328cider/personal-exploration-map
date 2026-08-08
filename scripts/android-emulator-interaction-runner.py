#!/usr/bin/env python3
"""Run the interaction suite with notification-shade-safe assertions.

Android's legacy `uiautomator dump` waits for the current UI to become idle.
The Android 15 notification shade may keep emitting accessibility/window events,
so a structurally valid foreground-service notification can make the dump command
fail forever with `could not get idle state`.

The notification itself is asserted through `dumpsys notification`. This wrapper
opens the shade, captures raw screenshots without requesting an accessibility
hierarchy, taps the only app notification on the fixed CI Pixel profile, and
verifies that the field-test activity becomes top-resumed. The normal app UI is
then checked by the existing black-box interaction suite.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import time


SCRIPT_PATH = Path(__file__).with_name("android-emulator-interaction-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_interaction_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load interaction smoke suite: {SCRIPT_PATH}")
interaction = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(interaction)
smoke = interaction.smoke
ORIGINAL_EXACT_TEXT_EXISTS = interaction.exact_text_exists


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
            "raw notification screenshot failed: "
            + result.stderr.decode("utf-8", errors="replace")
        )
    return path


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


def click_tracking_notification(artifacts: Path) -> None:
    """Click the first app notification without dumping the shade hierarchy."""

    return_to_home()
    width, height = smoke.parse_screen_size()

    # Android 15's Pixel profile places the first collapsed notification below
    # the compact quick-settings header. Several vertical candidates make the
    # test robust to minor SystemUI layout changes without assuming app internals.
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
            smoke.wait_for_node(
                artifacts,
                "探索を記録中",
                timeout_seconds=45,
                dump_prefix="notification-return",
            )
            smoke.screenshot(artifacts, "13-notification-returned")
            return

        # A wrong coordinate may have toggled a quick-setting or opened another
        # system surface. Reset to Home before trying the next stable row.
        return_to_home()

    raise smoke.SmokeFailure(
        "notification content intent did not return to the active recording "
        f"screen after taps at {', '.join(attempts)}"
    )


def marker_metric_is_one(root, expected: str) -> bool:
    """Match the numeric value positioned directly above the `発見` metric label."""

    if expected != "1":
        return ORIGINAL_EXACT_TEXT_EXISTS(root, expected)

    labels = [
        node
        for node in root.iter("node")
        if node.attrib.get("text", "").strip() == "発見"
    ]
    values = [
        node
        for node in root.iter("node")
        if node.attrib.get("text", "").strip() == expected
    ]
    for label in labels:
        label_left, label_top, label_right, _ = smoke.parse_bounds(label)
        label_center_x = (label_left + label_right) / 2
        for value in values:
            value_left, _, value_right, value_bottom = smoke.parse_bounds(value)
            value_center_x = (value_left + value_right) / 2
            horizontally_aligned = abs(value_center_x - label_center_x) <= max(
                24,
                (label_right - label_left) * 0.35,
            )
            vertically_above = 0 <= label_top - value_bottom <= 180
            if horizontally_aligned and vertically_above:
                return True
    return False


interaction.open_tracking_notification = click_tracking_notification
interaction.exact_text_exists = marker_metric_is_one


if __name__ == "__main__":
    sys.exit(interaction.main())
