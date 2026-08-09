#!/usr/bin/env python3
"""Run the installed-APK smoke suite against the current Field-test UI.

The legacy base smoke still contains several labels from the first prototype.
This adapter keeps product copy unchanged and translates those harness-only
selectors to the current Japanese UI. RecordingScreen updates once per second,
so its lifecycle is verified through the foreground-service notification and
raw screenshots instead of asking legacy uiautomator to reach an idle state.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any
import xml.etree.ElementTree as ET

SCRIPT_PATH = Path(__file__).with_name("android-emulator-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_android_emulator_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load base smoke suite: {SCRIPT_PATH}")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

_base_wait_for_node = smoke.wait_for_node
_base_tap_text = smoke.tap_text
_base_screenshot = smoke.screenshot
_base_changed_pixel_ratio = smoke.changed_pixel_ratio

STATIC_LABEL_ALIASES = {
    "POCKET-FIRST RECORDING": "探索を邪魔しないために",
    "スマホをしまって探索する": "ポケット記録を許可して開始",
    "Field Test": "タップして地図を見る",
}
RECORDING_PREFIXES = {"recording-ready", "recording-recovered"}
RAW_RECORDING_SCREENSHOTS = {
    "03-recording-start",
    "04-live-before-route",
    "05-live-after-route",
    "06-recording-recovered",
}


def field_app_is_top_resumed() -> bool:
    output = smoke.adb_shell("dumpsys", "activity", "activities", timeout=60)
    patterns = (
        rf"mResumedActivity:.*{re.escape(smoke.PACKAGE)}",
        rf"topResumedActivity=.*{re.escape(smoke.PACKAGE)}",
        rf"ResumedActivity.*{re.escape(smoke.PACKAGE)}",
    )
    return any(re.search(pattern, output) for pattern in patterns)


def wait_for_field_app(*, timeout_seconds: int = 60) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if field_app_is_top_resumed():
            return
        time.sleep(1)
    raise smoke.SmokeFailure("field-test app did not become top-resumed")


def wait_for_tracking_notification(
    artifacts: Path,
    dump_prefix: str,
    *,
    timeout_seconds: int = 60,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    latest = ""
    while time.monotonic() < deadline:
        latest = smoke.adb_shell(
            "dumpsys",
            "notification",
            "--noredact",
            timeout=60,
        )
        if smoke.PACKAGE in latest and "探索を記録中" in latest:
            (artifacts / f"{dump_prefix}-notification.txt").write_text(
                latest,
                encoding="utf-8",
            )
            wait_for_field_app(timeout_seconds=timeout_seconds)
            return
        time.sleep(1)
    raise smoke.SmokeFailure(
        "foreground-service notification did not expose the field-test package "
        "and recording title"
    )


def wait_for_node(
    artifacts: Path,
    needle: str,
    **kwargs: Any,
):
    dump_prefix = str(kwargs.get("dump_prefix", "wait"))

    if needle == "YOUR PERSONAL MAP" and dump_prefix == "home-ready":
        needle = "PERSONAL EXPLORATION MAP"
    else:
        needle = STATIC_LABEL_ALIASES.get(needle, needle)

    if needle == "探索を記録中" and dump_prefix in RECORDING_PREFIXES:
        wait_for_tracking_notification(
            artifacts,
            dump_prefix,
            timeout_seconds=int(kwargs.get("timeout_seconds", 60)),
        )
        return ET.Element(
            "node",
            {
                "text": needle,
                "bounds": "[0,0][1,1]",
            },
        )

    return _base_wait_for_node(artifacts, needle, **kwargs)


def raw_screenshot(artifacts: Path, name: str) -> Path:
    path = artifacts / f"{name}.png"
    with path.open("wb") as output:
        result = subprocess.run(
            ["adb", "exec-out", "screencap", "-p"],
            check=False,
            stdout=output,
            stderr=subprocess.PIPE,
            timeout=30,
        )
    if result.returncode != 0:
        raise smoke.SmokeFailure(
            "raw screenshot failed: "
            + result.stderr.decode("utf-8", errors="replace")
        )
    return path


def screenshot(artifacts: Path, name: str) -> Path:
    if name in RAW_RECORDING_SCREENSHOTS:
        return raw_screenshot(artifacts, name)
    return _base_screenshot(artifacts, name)


def changed_pixel_ratio(first: Path, second: Path) -> float:
    """Parse ImageMagick AE output as an absolute changed-pixel count.

    ImageMagick 7 commonly prints both the absolute count and a normalized
    value, for example ``73788 (0.0355845)``. The legacy harness selected the
    final parenthesized token, failed to convert it, and silently fell back to
    average screen colour. That understated a visibly grown map by almost an
    order of magnitude.
    """

    available = smoke.run(
        ["bash", "-lc", "command -v compare >/dev/null"],
        check=False,
    ).returncode == 0
    if available:
        metric = smoke.run(
            [
                "compare",
                "-metric",
                "AE",
                str(first),
                str(second),
                "null:",
            ],
            check=False,
        )
        output = f"{metric.stdout}\n{metric.stderr}".strip()
        count_match = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", output)
        if count_match is not None:
            changed = float(count_match.group(1))
            total_text = smoke.run(
                ["identify", "-format", "%[fx:w*h]", str(first)],
                check=True,
            ).stdout.strip()
            total = float(total_text)
            if total > 0:
                return changed / total

    return _base_changed_pixel_ratio(first, second)


def tap_at_ratio(x_ratio: float, y_ratio: float) -> None:
    width, height = smoke.parse_screen_size()
    smoke.adb_shell(
        "input",
        "tap",
        str(int(width * x_ratio)),
        str(int(height * y_ratio)),
    )
    time.sleep(1)


def tap_text(
    artifacts: Path,
    needle: str,
    **kwargs: Any,
) -> None:
    if needle == "探索を終了して地図を見る":
        # The two RecordingScreen actions are fixed at the bottom of the
        # Android 15 Pixel CI profile. Avoid a non-idle hierarchy dump here.
        tap_at_ratio(0.70, 0.918)
        return
    _base_tap_text(artifacts, needle, **kwargs)


smoke.wait_for_node = wait_for_node
smoke.screenshot = screenshot
smoke.changed_pixel_ratio = changed_pixel_ratio
smoke.tap_text = tap_text

if __name__ == "__main__":
    sys.exit(smoke.main())
