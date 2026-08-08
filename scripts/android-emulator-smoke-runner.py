#!/usr/bin/env python3
"""Run the base lifecycle without asking a live timer screen to become idle.

Static Home, permission, Review and persisted-map screens continue to use
semantic UI hierarchy checks. RecordingScreen intentionally updates once per
second, so Android's legacy `uiautomator dump` may never reach an idle state.
For that screen this runner uses stable external signals and visible pixels:

- foreground-service notification proves active recording;
- `dumpsys activity` proves the field-test app is top-resumed;
- a PNG crop of the map canvas must change after GNSS observations;
- fixed-coordinate taps are limited to the fixed Android 15 Pixel CI profile.

This remains an installed-APK black-box test and never reads SQLite or app
internals.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import zlib


SCRIPT_PATH = Path(__file__).with_name("android-emulator-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_android_emulator_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load base smoke suite: {SCRIPT_PATH}")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAP_CHANGE_THRESHOLD = 0.03
PIXEL_DELTA_THRESHOLD = 18


def race_safe_dump_ui(artifacts: Path, name: str) -> tuple[ET.Element, Path]:
    """Read static-screen accessibility XML through a unique remote path."""

    last_error = ""
    for attempt in range(8):
        remote_path = f"/sdcard/pem-window-{time.time_ns()}-{attempt}.xml"
        smoke.adb_shell("rm", "-f", remote_path, check=False, timeout=15)
        dump_result = smoke.run(
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
        cat_result = smoke.run(
            ["adb", "shell", "cat", remote_path],
            check=False,
            timeout=30,
        )
        smoke.adb_shell("rm", "-f", remote_path, check=False, timeout=15)

        xml_text = cat_result.stdout
        if (
            dump_result.returncode == 0
            and cat_result.returncode == 0
            and "<hierarchy" in xml_text
        ):
            path = artifacts / f"{name}.xml"
            path.write_text(xml_text, encoding="utf-8")
            return ET.fromstring(xml_text), path

        last_error = (
            f"dump_rc={dump_result.returncode} "
            f"dump_stdout={dump_result.stdout!r} dump_stderr={dump_result.stderr!r} "
            f"cat_rc={cat_result.returncode} "
            f"cat_stdout={cat_result.stdout!r} cat_stderr={cat_result.stderr!r}"
        )
        time.sleep(1)

    raise smoke.SmokeFailure(f"could not dump fresh UI hierarchy: {last_error}")


def paeth_predictor(left: int, up: int, upper_left: int) -> int:
    prediction = left + up - upper_left
    left_distance = abs(prediction - left)
    up_distance = abs(prediction - up)
    upper_left_distance = abs(prediction - upper_left)
    if left_distance <= up_distance and left_distance <= upper_left_distance:
        return left
    if up_distance <= upper_left_distance:
        return up
    return upper_left


def decode_png_rgb(png: bytes) -> tuple[int, int, bytes]:
    """Decode the non-interlaced 8-bit RGB/RGBA PNG emitted by screencap."""

    if not png.startswith(PNG_SIGNATURE):
        raise smoke.SmokeFailure("screencap did not return a PNG")

    offset = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()
    while offset + 12 <= len(png):
        length = struct.unpack(">I", png[offset : offset + 4])[0]
        chunk_type = png[offset + 4 : offset + 8]
        chunk_data = png[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"IHDR":
            (
                width,
                height,
                bit_depth,
                color_type,
                _compression,
                _filter_method,
                interlace,
            ) = struct.unpack(">IIBBBBB", chunk_data)
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if width is None or height is None:
        raise smoke.SmokeFailure("PNG is missing IHDR")
    if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
        raise smoke.SmokeFailure(
            "unsupported screencap PNG format: "
            f"bitDepth={bit_depth} colorType={color_type} interlace={interlace}"
        )

    bytes_per_pixel = 3 if color_type == 2 else 4
    stride = width * bytes_per_pixel
    raw = zlib.decompress(bytes(compressed))
    expected = height * (stride + 1)
    if len(raw) != expected:
        raise smoke.SmokeFailure(
            f"unexpected PNG payload length: expected {expected}, got {len(raw)}"
        )

    rows: list[bytearray] = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        encoded = raw[cursor : cursor + stride]
        cursor += stride
        decoded = bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            up = previous[index]
            upper_left = (
                previous[index - bytes_per_pixel]
                if index >= bytes_per_pixel
                else 0
            )
            if filter_type == 0:
                reconstructed = value
            elif filter_type == 1:
                reconstructed = value + left
            elif filter_type == 2:
                reconstructed = value + up
            elif filter_type == 3:
                reconstructed = value + ((left + up) // 2)
            elif filter_type == 4:
                reconstructed = value + paeth_predictor(left, up, upper_left)
            else:
                raise smoke.SmokeFailure(f"unsupported PNG filter {filter_type}")
            decoded[index] = reconstructed & 0xFF
        rows.append(decoded)
        previous = decoded

    rgb = bytearray(width * height * 3)
    output = 0
    for row in rows:
        for index in range(0, len(row), bytes_per_pixel):
            rgb[output : output + 3] = row[index : index + 3]
            output += 3
    return width, height, bytes(rgb)


def capture_png() -> bytes:
    result = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    if result.returncode != 0:
        raise smoke.SmokeFailure(
            "raw screenshot failed: "
            + result.stderr.decode("utf-8", errors="replace")
        )
    return result.stdout


def raw_screenshot(artifacts: Path, name: str) -> Path:
    path = artifacts / f"{name}.png"
    path.write_bytes(capture_png())
    return path


def capture_frame() -> tuple[int, int, bytes]:
    return decode_png_rgb(capture_png())


def map_crop_change_ratio(
    baseline: tuple[int, int, bytes],
    current: tuple[int, int, bytes],
) -> float:
    width, height, before = baseline
    current_width, current_height, after = current
    if (width, height) != (current_width, current_height):
        raise smoke.SmokeFailure(
            f"screen size changed from {width}x{height} to "
            f"{current_width}x{current_height}"
        )

    # RecordingScreen keeps the PersonalMap canvas in this lower-middle region
    # on the fixed Pixel profile. The timer, status row, update time and bottom
    # action buttons are intentionally outside the crop.
    minimum_x = int(width * 0.10)
    maximum_x = int(width * 0.90)
    minimum_y = int(height * 0.64)
    maximum_y = int(height * 0.88)
    changed = 0
    total = (maximum_x - minimum_x) * (maximum_y - minimum_y)

    for y in range(minimum_y, maximum_y):
        row_start = (y * width + minimum_x) * 3
        for x_offset in range(maximum_x - minimum_x):
            index = row_start + x_offset * 3
            if max(
                abs(before[index] - after[index]),
                abs(before[index + 1] - after[index + 1]),
                abs(before[index + 2] - after[index + 2]),
            ) > PIXEL_DELTA_THRESHOLD:
                changed += 1
    return changed / max(1, total)


def wait_for_map_growth(
    baseline: tuple[int, int, bytes],
    *,
    timeout_seconds: int,
) -> float:
    deadline = time.monotonic() + timeout_seconds
    latest_ratio = 0.0
    while time.monotonic() < deadline:
        if field_app_is_top_resumed():
            latest_ratio = map_crop_change_ratio(baseline, capture_frame())
            if latest_ratio >= MAP_CHANGE_THRESHOLD:
                return latest_ratio
        time.sleep(2)
    raise smoke.SmokeFailure(
        "live PersonalMap canvas did not visibly change from its empty baseline; "
        f"latest changed-pixel ratio={latest_ratio:.4f}, "
        f"required={MAP_CHANGE_THRESHOLD:.4f}"
    )


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
    name: str,
    *,
    timeout_seconds: int = 60,
) -> str:
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
            (artifacts / f"{name}-notification.txt").write_text(
                latest,
                encoding="utf-8",
            )
            return latest
        time.sleep(1)
    raise smoke.SmokeFailure(
        "foreground-service notification did not expose the field-test package "
        "and recording title"
    )


def tap_at_ratio(x_ratio: float, y_ratio: float) -> None:
    width, height = smoke.parse_screen_size()
    smoke.adb_shell(
        "input",
        "tap",
        str(int(width * x_ratio)),
        str(int(height * y_ratio)),
    )
    time.sleep(1)


def run_smoke_without_active_ui_dumps(
    apk: Path,
    artifacts: Path,
) -> dict[str, object]:
    started_at = time.time()
    artifacts.mkdir(parents=True, exist_ok=True)
    smoke.adb("logcat", "-c", check=False)

    smoke.log(f"install {apk}")
    smoke.adb("uninstall", smoke.PACKAGE, check=False, timeout=60)
    smoke.adb("install", "-r", str(apk), timeout=180)
    smoke.grant_runtime_permissions()
    smoke.inject_location(139.767000, 35.681000, delay_seconds=2)

    smoke.log("cold start")
    smoke.launch_app()
    smoke.wait_for_node(
        artifacts,
        "新しい地図を探索する",
        dump_prefix="home-ready",
    )
    smoke.screenshot(artifacts, "01-home")

    smoke.tap_text(
        artifacts,
        "新しい地図を探索する",
        dump_prefix="home-start",
    )
    smoke.wait_for_node(
        artifacts,
        "ポケット記録を許可して開始",
        scroll=True,
        dump_prefix="permission-ready",
    )
    smoke.screenshot(artifacts, "02-permission")
    smoke.tap_text(
        artifacts,
        "ポケット記録を許可して開始",
        scroll=True,
        dump_prefix="permission-start",
    )

    # RecordingScreen is intentionally non-idle. The foreground notification
    # and top-resumed activity are stable black-box signals that it started.
    wait_for_tracking_notification(artifacts, "03-recording-start")
    wait_for_field_app()
    time.sleep(2)
    raw_screenshot(artifacts, "03-recording-start")
    empty_map_frame = capture_frame()

    foreground_route = [
        (139.767060, 35.681000),
        (139.767120, 35.681000),
        (139.767180, 35.681040),
        (139.767180, 35.681100),
        (139.767240, 35.681100),
        (139.767300, 35.681140),
    ]
    smoke.inject_route(foreground_route)
    foreground_change = wait_for_map_growth(
        empty_map_frame,
        timeout_seconds=100,
    )
    raw_screenshot(artifacts, "04-live-map-grown")

    smoke.log("move app to background and turn screen off")
    smoke.adb_shell("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    smoke.adb_shell("input", "keyevent", "KEYCODE_SLEEP", check=False)
    smoke.inject_route(
        [
            (139.767360, 35.681180),
            (139.767420, 35.681180),
            (139.767480, 35.681220),
        ]
    )

    smoke.adb_shell("input", "keyevent", "KEYCODE_WAKEUP", check=False)
    smoke.adb_shell("wm", "dismiss-keyguard", check=False)
    smoke.relaunch_without_force_stop()
    wait_for_field_app()
    wait_for_tracking_notification(artifacts, "05-background-recovered")
    time.sleep(2)
    recovered_change = wait_for_map_growth(
        empty_map_frame,
        timeout_seconds=90,
    )
    raw_screenshot(artifacts, "05-background-recovered")

    (artifacts / "live-map-pixel-evidence.json").write_text(
        json.dumps(
            {
                "crop": {
                    "x": [0.10, 0.90],
                    "y": [0.64, 0.88],
                },
                "pixelDeltaThreshold": PIXEL_DELTA_THRESHOLD,
                "requiredChangedPixelRatio": MAP_CHANGE_THRESHOLD,
                "foregroundChangedPixelRatio": round(foreground_change, 6),
                "recoveredChangedPixelRatio": round(recovered_change, 6),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    # RecordingScreen actions are fixed at the bottom on the fixed CI profile.
    tap_at_ratio(0.70, 0.918)  # 探索を終了して地図を見る
    smoke.wait_for_node(
        artifacts,
        "YOUR PERSONAL MAP",
        timeout_seconds=75,
        dump_prefix="review-ready",
    )
    smoke.wait_for_node(
        artifacts,
        "各探索の開始",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="review-map",
    )
    smoke.screenshot(artifacts, "06-review-after-end")

    smoke.log("force-stop and verify persisted PersonalMap")
    smoke.adb_shell("am", "force-stop", smoke.PACKAGE)
    time.sleep(1)
    smoke.relaunch_without_force_stop()
    smoke.wait_for_node(
        artifacts,
        "自分の地図",
        timeout_seconds=60,
        dump_prefix="persisted-home",
    )
    persisted_card = smoke.wait_for_node(
        artifacts,
        "タップして地図を見る",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="persisted-card",
    )
    smoke.screenshot(artifacts, "07-persisted-home")
    smoke.tap_node(persisted_card)
    smoke.wait_for_node(
        artifacts,
        "YOUR PERSONAL MAP",
        timeout_seconds=60,
        dump_prefix="persisted-review",
    )
    smoke.screenshot(artifacts, "08-persisted-review")

    elapsed = round(time.time() - started_at, 2)
    result = {
        "status": "passed",
        "package": smoke.PACKAGE,
        "elapsedSeconds": elapsed,
        "assertions": [
            "cold-start-home",
            "foreground-service-recording-started",
            "foreground-live-map-pixels-changed",
            "screen-off-background-recovery",
            "recovered-live-map-pixels-present",
            "exploration-ended-to-review",
            "force-stop-persistence",
        ],
    }
    (artifacts / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return result


smoke.dump_ui = race_safe_dump_ui
smoke.run_smoke = run_smoke_without_active_ui_dumps


if __name__ == "__main__":
    sys.exit(smoke.main())
