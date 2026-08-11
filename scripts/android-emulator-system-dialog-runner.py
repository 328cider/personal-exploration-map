#!/usr/bin/env python3
"""Run the current emulator smoke suite while ignoring known emulator system ANRs.

GitHub-hosted Android emulators occasionally display a transient system-process
"isn't responding" dialog over an otherwise healthy app. Those known emulator
process failures must not be mistaken for an application failure, but Field-test
or any unrecognised app-process crash dialog must remain visible and fail the
suite.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import struct
import sys
import time
import xml.etree.ElementTree as ET
import zlib


RUNNER_PATH = Path(__file__).with_name("android-emulator-smoke-runner.py")
SPEC = importlib.util.spec_from_file_location(
    "pem_android_emulator_smoke_runner",
    RUNNER_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load emulator runner: {RUNNER_PATH}")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)

smoke = runner.smoke
_base_dump_ui = smoke.dump_ui
_base_screenshot = smoke.screenshot
_base_assert_screen_changed = smoke.assert_screen_changed

# Keep this allow-list deliberately narrow. These are emulator/system
# components observed to fail transiently on GitHub-hosted API 35 images while
# the Field-test app is healthy underneath. Never match arbitrary Android or
# Google package names because doing so could hide a real application failure.
_TRANSIENT_SYSTEM_PROCESSES = (
    "Pixel Launcher",
    "System UI",
    "com.google.android.googlesdksetup",
)
_MAP_VISUAL_LABELS = {
    "foreground live map",
    "background recovered live map",
}


def _node_value(node: ET.Element, key: str) -> str:
    return node.attrib.get(key, "").strip()


def _find_node(
    root: ET.Element,
    *,
    resource_ids: tuple[str, ...] = (),
    texts: tuple[str, ...] = (),
) -> ET.Element | None:
    for node in root.iter("node"):
        resource_id = _node_value(node, "resource-id")
        text = _node_value(node, "text")
        if resource_id in resource_ids or text in texts:
            return node
    return None


def _dialog_title(root: ET.Element) -> str:
    explicit = next(
        (
            _node_value(node, "text")
            for node in root.iter("node")
            if _node_value(node, "resource-id") == "android:id/alertTitle"
        ),
        "",
    )
    if explicit:
        return explicit

    # Some emulator images omit alertTitle while retaining the dialog text.
    return " ".join(
        _node_value(node, "text")
        for node in root.iter("node")
        if _node_value(node, "text")
    )


def _transient_dialog_action(
    root: ET.Element,
) -> tuple[ET.Element, str, str | None] | None:
    title = _dialog_title(root)
    normalized = title.replace("’", "'").lower()
    matched_process = next(
        (
            process
            for process in _TRANSIENT_SYSTEM_PROCESSES
            if process.lower() in normalized
        ),
        None,
    )
    if matched_process is None:
        return None

    # googlesdksetup is non-essential in this test image and repeatedly showing
    # "Wait" can keep the ANR above the app. Close only that exact allow-listed
    # process. For launcher/System UI prefer Wait so the emulator remains usable.
    if matched_process == "com.google.android.googlesdksetup":
        close_node = _find_node(
            root,
            resource_ids=("android:id/aerr_close",),
            texts=("Close app", "OK"),
        )
        if close_node is not None:
            return close_node, title, matched_process

    if any(
        phrase in normalized
        for phrase in ("isn't responding", "is not responding", "not responding")
    ):
        wait_node = _find_node(
            root,
            resource_ids=("android:id/aerr_wait",),
            texts=("Wait",),
        )
        if wait_node is not None:
            return wait_node, title, matched_process

    if any(
        phrase in normalized
        for phrase in ("keeps stopping", "has stopped", "stopped working")
    ):
        close_node = _find_node(
            root,
            resource_ids=("android:id/aerr_close",),
            texts=("Close app", "OK"),
        )
        if close_node is not None:
            return close_node, title, matched_process

    # The title matched an allow-listed system process but the image used an
    # unfamiliar button layout. Do not guess at coordinates or dismiss it.
    return None


def dialog_safe_dump_ui(
    artifacts: Path,
    name: str,
) -> tuple[ET.Element, Path]:
    latest_title = ""
    for attempt in range(6):
        root, raw_path = _base_dump_ui(artifacts, f"{name}-raw-{attempt:02d}")
        action = _transient_dialog_action(root)
        if action is None:
            final_path = artifacts / f"{name}.xml"
            final_path.write_text(raw_path.read_text(encoding="utf-8"), encoding="utf-8")
            return root, final_path

        action_node, latest_title, process = action
        smoke.log(f"dismiss transient emulator system dialog: {latest_title}")
        smoke.tap_node(action_node)
        if process == "com.google.android.googlesdksetup":
            smoke.adb_shell(
                "am",
                "force-stop",
                "com.google.android.googlesdksetup",
                check=False,
            )
        time.sleep(1.5)

    raise smoke.SmokeFailure(
        "allow-listed emulator system dialog remained after six dismiss "
        f"attempts: {latest_title}"
    )


def dialog_safe_screenshot(artifacts: Path, name: str) -> Path:
    # Dismiss an allow-listed system ANR before screencap. The base screenshot
    # dumps UI only after capturing pixels, which otherwise lets a transient
    # launcher dialog contaminate the visual-growth comparison.
    dialog_safe_dump_ui(artifacts, f"{name}-pre")
    return _base_screenshot(artifacts, name)


def _decode_png_rows(path: Path) -> tuple[int, int, int, int, list[bytearray]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise smoke.SmokeFailure(f"not a PNG screenshot: {path}")

    offset = 8
    width = height = bit_depth = color_type = None
    compressed = bytearray()
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(
                ">IIBB", chunk_data[:10]
            )
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if None in (width, height, bit_depth, color_type) or bit_depth != 8:
        raise smoke.SmokeFailure(f"unsupported PNG screenshot: {path}")
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise smoke.SmokeFailure(
            f"unsupported PNG color type {color_type}: {path}"
        )

    raw = zlib.decompress(bytes(compressed))
    stride = width * channels
    previous = bytearray(stride)
    rows: list[bytearray] = []
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        row = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for index in range(stride):
            left = row[index - channels] if index >= channels else 0
            up = previous[index]
            up_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                row[index] = (row[index] + left) & 0xFF
            elif filter_type == 2:
                row[index] = (row[index] + up) & 0xFF
            elif filter_type == 3:
                row[index] = (row[index] + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                estimate = left + up - up_left
                distance_left = abs(estimate - left)
                distance_up = abs(estimate - up)
                distance_up_left = abs(estimate - up_left)
                predictor = (
                    left
                    if distance_left <= distance_up
                    and distance_left <= distance_up_left
                    else up
                    if distance_up <= distance_up_left
                    else up_left
                )
                row[index] = (row[index] + predictor) & 0xFF
            elif filter_type != 0:
                raise smoke.SmokeFailure(
                    f"unsupported PNG filter {filter_type}: {path}"
                )
        rows.append(row)
        previous = row

    return width, height, color_type, channels, rows


def _rgb_at(
    row: bytearray,
    pixel_index: int,
    color_type: int,
    channels: int,
) -> tuple[int, int, int]:
    offset = pixel_index * channels
    if color_type in (0, 4):
        value = row[offset]
        return value, value, value
    return row[offset], row[offset + 1], row[offset + 2]


def _map_region_changed_pixel_ratio(first: Path, second: Path) -> float | None:
    first_png = _decode_png_rows(first)
    second_png = _decode_png_rows(second)
    if first_png[:4] != second_png[:4]:
        return None

    width, height, color_type, channels, first_rows = first_png
    second_rows = second_png[4]
    # Recording keeps fixed controls at the bottom. The actual live-map card is
    # in the lower-middle 40% of the screen; compare that viewport rather than
    # diluting real map growth across timer, status, and button pixels.
    top = int(height * 0.48)
    bottom = min(height, top + max(1, int(height * 0.40)))
    total = width * max(0, bottom - top)
    if total <= 0:
        return None

    changed = 0
    for row_index in range(top, bottom):
        first_row = first_rows[row_index]
        second_row = second_rows[row_index]
        for pixel_index in range(width):
            if _rgb_at(
                first_row,
                pixel_index,
                color_type,
                channels,
            ) != _rgb_at(
                second_row,
                pixel_index,
                color_type,
                channels,
            ):
                changed += 1
    return changed / total


def dialog_safe_assert_screen_changed(
    before: Path,
    after: Path,
    *,
    minimum_ratio: float,
    label: str,
) -> float:
    if label in _MAP_VISUAL_LABELS:
        ratio = _map_region_changed_pixel_ratio(before, after)
        if ratio is not None:
            smoke.log(f"{label} map-region changed-pixel ratio={ratio:.6f}")
            if ratio < minimum_ratio:
                raise smoke.SmokeFailure(
                    f"{label} map region did not change enough: "
                    f"ratio={ratio:.6f}, expected >= {minimum_ratio}"
                )
            return ratio
    return _base_assert_screen_changed(
        before,
        after,
        minimum_ratio=minimum_ratio,
        label=label,
    )


smoke.dump_ui = dialog_safe_dump_ui
smoke.screenshot = dialog_safe_screenshot
smoke.assert_screen_changed = dialog_safe_assert_screen_changed

if __name__ == "__main__":
    sys.exit(smoke.main())
