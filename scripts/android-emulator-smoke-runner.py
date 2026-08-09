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
import struct
import subprocess
import sys
import time
from typing import Any
import xml.etree.ElementTree as ET
import zlib

SCRIPT_PATH = Path(__file__).with_name("android-emulator-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_android_emulator_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load base smoke suite: {SCRIPT_PATH}")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

_base_tap_text = smoke.tap_text
_base_screenshot = smoke.screenshot

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
SYSTEM_ANR_LABELS = (
    "Pixel Launcher isn't responding",
    "System UI isn't responding",
    "Process system isn't responding",
)
# Fixed Android 15 Pixel CI profile. This rectangle excludes the timer,
# sample-count cards, and bottom actions, and measures only the visible map.
MAP_CANVAS_CROP_RATIOS = (0.09, 0.65, 0.91, 0.88)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


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


def dismiss_blocking_system_anr(root: ET.Element) -> bool:
    label = next(
        (candidate for candidate in SYSTEM_ANR_LABELS if smoke.find_node(root, candidate)),
        None,
    )
    if label is None:
        return False

    smoke.log(f"dismiss emulator system ANR dialog: {label}")
    action = (
        smoke.find_node(root, "Close app")
        or smoke.find_node(root, "アプリを閉じる")
        or smoke.find_node(root, "Wait")
        or smoke.find_node(root, "待機")
    )
    if action is not None:
        smoke.tap_node(action)
    else:
        smoke.adb_shell(
            "am",
            "force-stop",
            "com.google.android.apps.nexuslauncher",
            check=False,
            timeout=30,
        )

    # The launch intent may have been hidden behind the system dialog. Start
    # the known Field-test activity directly instead of depending on Launcher.
    smoke.adb_shell(
        "am",
        "start",
        "-W",
        "-n",
        f"{smoke.PACKAGE}/.MainActivity",
        check=False,
        timeout=30,
    )
    time.sleep(2)
    return True


def wait_for_node(
    artifacts: Path,
    needle: str,
    *,
    timeout_seconds: int = 45,
    scroll: bool = False,
    dump_prefix: str = "wait",
):
    if needle == "YOUR PERSONAL MAP" and dump_prefix == "home-ready":
        needle = "PERSONAL EXPLORATION MAP"
    else:
        needle = STATIC_LABEL_ALIASES.get(needle, needle)

    if needle == "探索を記録中" and dump_prefix in RECORDING_PREFIXES:
        wait_for_tracking_notification(
            artifacts,
            dump_prefix,
            timeout_seconds=timeout_seconds,
        )
        return ET.Element(
            "node",
            {
                "text": needle,
                "bounds": "[0,0][1,1]",
            },
        )

    width, height = smoke.parse_screen_size()
    deadline = time.monotonic() + timeout_seconds
    attempt = 0
    while time.monotonic() < deadline:
        root, _ = smoke.dump_ui(artifacts, f"{dump_prefix}-{attempt:02d}")
        node = smoke.find_node(root, needle)
        if node is not None:
            return node
        if dismiss_blocking_system_anr(root):
            attempt += 1
            continue
        if scroll:
            smoke.swipe_up(width, height)
        else:
            time.sleep(1)
        attempt += 1
    raise smoke.SmokeFailure(
        f"UI element did not appear within {timeout_seconds}s: {needle}"
    )


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


def decode_png_rgb(path: Path) -> tuple[int, int, bytes]:
    """Decode the non-interlaced 8-bit RGB/RGBA PNG emitted by screencap."""

    png = path.read_bytes()
    if not png.startswith(PNG_SIGNATURE):
        raise smoke.SmokeFailure(f"screencap is not a PNG: {path}")

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
        raise smoke.SmokeFailure(f"PNG is missing IHDR: {path}")
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

    cursor = 0
    previous = bytearray(stride)
    rgb = bytearray(width * height * 3)
    output = 0
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

        for index in range(0, stride, bytes_per_pixel):
            rgb[output : output + 3] = decoded[index : index + 3]
            output += 3
        previous = decoded

    return width, height, bytes(rgb)


def changed_pixel_ratio(
    first: Path,
    second: Path,
    *,
    crop_ratios: tuple[float, float, float, float] | None = None,
) -> float:
    first_width, first_height, before = decode_png_rgb(first)
    second_width, second_height, after = decode_png_rgb(second)
    if (first_width, first_height) != (second_width, second_height):
        raise smoke.SmokeFailure(
            f"screen size changed from {first_width}x{first_height} to "
            f"{second_width}x{second_height}"
        )

    if crop_ratios is None:
        minimum_x = 0
        minimum_y = 0
        maximum_x = first_width
        maximum_y = first_height
    else:
        minimum_x = int(first_width * crop_ratios[0])
        minimum_y = int(first_height * crop_ratios[1])
        maximum_x = int(first_width * crop_ratios[2])
        maximum_y = int(first_height * crop_ratios[3])

    changed = 0
    total = max(1, (maximum_x - minimum_x) * (maximum_y - minimum_y))
    for y in range(minimum_y, maximum_y):
        row_start = (y * first_width + minimum_x) * 3
        for x_offset in range(maximum_x - minimum_x):
            index = row_start + x_offset * 3
            if before[index : index + 3] != after[index : index + 3]:
                changed += 1
    return changed / total


def assert_screen_changed(
    before: Path,
    after: Path,
    *,
    minimum_ratio: float,
    label: str,
) -> float:
    live_map_assertion = "live map" in label
    crop = MAP_CANVAS_CROP_RATIOS if live_map_assertion else None
    ratio = changed_pixel_ratio(before, after, crop_ratios=crop)
    source = "stdlib-png-map-canvas" if live_map_assertion else "stdlib-png-full"
    smoke.log(f"{label} changed-pixel ratio={ratio:.6f} source={source}")
    if ratio < minimum_ratio:
        raise smoke.SmokeFailure(
            f"{label} did not change enough: ratio={ratio:.6f}, "
            f"expected >= {minimum_ratio}"
        )
    return ratio


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
smoke.assert_screen_changed = assert_screen_changed
smoke.tap_text = tap_text

if __name__ == "__main__":
    sys.exit(smoke.main())
