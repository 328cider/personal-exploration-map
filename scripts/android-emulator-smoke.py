#!/usr/bin/env python3
"""Black-box Android emulator smoke test for the standalone field-test APK.

The script intentionally uses only ADB and Python's standard library. It tests
what a user can observe from the installed APK rather than importing application
internals:

- cold start and Home rendering
- background exploration start with pre-granted runtime permissions
- emulator GNSS route ingestion
- foreground live PersonalMap growth
- screen-off/background delivery and recording-session recovery
- exploration completion and Review navigation
- force-stop/relaunch persistence

Real GNSS accuracy, OEM process killing, battery consumption, and physical pocket
UX remain physical-device tests.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Callable, Iterable
import xml.etree.ElementTree as ET

PACKAGE = "com.cider328.personalexplorationmap.fieldtest"
REMOTE_UI_XML = "/sdcard/pem-window.xml"


class SmokeFailure(RuntimeError):
    pass


def log(message: str) -> None:
    print(f"[emulator-smoke] {message}", flush=True)


def run(
    command: list[str],
    *,
    check: bool = True,
    capture: bool = True,
    timeout: int | None = 120,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        check=False,
        text=True,
        capture_output=capture,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise SmokeFailure(
            f"command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def adb(*args: str, check: bool = True, timeout: int | None = 120) -> str:
    return run(["adb", *args], check=check, timeout=timeout).stdout


def adb_shell(*args: str, check: bool = True, timeout: int | None = 120) -> str:
    return adb("shell", *args, check=check, timeout=timeout)


def parse_screen_size() -> tuple[int, int]:
    output = adb_shell("wm", "size")
    match = re.search(r"Physical size:\s*(\d+)x(\d+)", output)
    if match is None:
        match = re.search(r"Override size:\s*(\d+)x(\d+)", output)
    if match is None:
        raise SmokeFailure(f"could not parse emulator screen size: {output}")
    return int(match.group(1)), int(match.group(2))


def dump_ui(artifacts: Path, name: str) -> tuple[ET.Element, Path]:
    last_error = ""
    for _ in range(7):
        dump_result = run(
            ["adb", "shell", "uiautomator", "dump", "--compressed", REMOTE_UI_XML],
            check=False,
            timeout=30,
        )
        if dump_result.returncode == 0:
            # uiautomator may report success a fraction of a second before the
            # output file becomes visible through a subsequent adb shell.
            for _ in range(5):
                cat_result = run(
                    ["adb", "shell", "cat", REMOTE_UI_XML],
                    check=False,
                    timeout=30,
                )
                xml_text = cat_result.stdout
                if cat_result.returncode == 0 and "<hierarchy" in xml_text:
                    path = artifacts / f"{name}.xml"
                    path.write_text(xml_text, encoding="utf-8")
                    return ET.fromstring(xml_text), path
                last_error = (
                    f"dump_stdout={dump_result.stdout!r} "
                    f"dump_stderr={dump_result.stderr!r} "
                    f"cat_stdout={cat_result.stdout!r} "
                    f"cat_stderr={cat_result.stderr!r}"
                )
                time.sleep(0.4)
        else:
            last_error = (
                f"dump_stdout={dump_result.stdout!r} "
                f"dump_stderr={dump_result.stderr!r}"
            )
        time.sleep(1)
    raise SmokeFailure(f"could not dump UI hierarchy: {last_error}")


def node_values(node: ET.Element) -> Iterable[str]:
    for key in ("text", "content-desc", "resource-id"):
        value = node.attrib.get(key, "").strip()
        if value:
            yield value


def find_node(root: ET.Element, needle: str) -> ET.Element | None:
    for node in root.iter("node"):
        if any(needle == value or needle in value for value in node_values(node)):
            return node
    return None


def parse_bounds(node: ET.Element) -> tuple[int, int, int, int]:
    bounds = node.attrib.get("bounds", "")
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if match is None:
        raise SmokeFailure(f"node has invalid bounds {bounds!r}: {node.attrib}")
    return tuple(int(value) for value in match.groups())  # type: ignore[return-value]


def tap_node(node: ET.Element) -> None:
    left, top, right, bottom = parse_bounds(node)
    x = (left + right) // 2
    y = (top + bottom) // 2
    adb_shell("input", "tap", str(x), str(y))
    time.sleep(1)


def swipe_up(width: int, height: int) -> None:
    adb_shell(
        "input",
        "swipe",
        str(width // 2),
        str(int(height * 0.78)),
        str(width // 2),
        str(int(height * 0.28)),
        "350",
    )
    time.sleep(0.8)


def wait_for_node(
    artifacts: Path,
    needle: str,
    *,
    timeout_seconds: int = 45,
    scroll: bool = False,
    dump_prefix: str = "wait",
) -> ET.Element:
    width, height = parse_screen_size()
    deadline = time.monotonic() + timeout_seconds
    attempt = 0
    while time.monotonic() < deadline:
        root, _ = dump_ui(artifacts, f"{dump_prefix}-{attempt:02d}")
        node = find_node(root, needle)
        if node is not None:
            return node
        if scroll:
            swipe_up(width, height)
        else:
            time.sleep(1)
        attempt += 1
    raise SmokeFailure(f"UI element did not appear within {timeout_seconds}s: {needle}")


def tap_text(
    artifacts: Path,
    needle: str,
    *,
    timeout_seconds: int = 45,
    scroll: bool = False,
    dump_prefix: str = "tap",
) -> None:
    node = wait_for_node(
        artifacts,
        needle,
        timeout_seconds=timeout_seconds,
        scroll=scroll,
        dump_prefix=dump_prefix,
    )
    tap_node(node)


def screenshot(artifacts: Path, name: str) -> Path:
    path = artifacts / f"{name}.png"
    with path.open("wb") as output:
        result = subprocess.run(
            ["adb", "exec-out", "screencap", "-p"],
            check=False,
            stdout=output,
            stderr=subprocess.PIPE,
        )
    if result.returncode != 0:
        raise SmokeFailure(
            f"screenshot failed: {result.stderr.decode('utf-8', errors='replace')}"
        )
    dump_ui(artifacts, name)
    return path


def launch_app() -> None:
    adb_shell("am", "force-stop", PACKAGE, check=False)
    result = run(
        [
            "adb",
            "shell",
            "monkey",
            "-p",
            PACKAGE,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
        check=False,
        timeout=30,
    )
    if result.returncode != 0:
        raise SmokeFailure(
            f"could not launch app: stdout={result.stdout} stderr={result.stderr}"
        )
    time.sleep(2)


def relaunch_without_force_stop() -> None:
    result = run(
        [
            "adb",
            "shell",
            "monkey",
            "-p",
            PACKAGE,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
        check=False,
        timeout=30,
    )
    if result.returncode != 0:
        raise SmokeFailure(
            f"could not relaunch app: stdout={result.stdout} stderr={result.stderr}"
        )
    time.sleep(2)


def inject_location(longitude: float, latitude: float) -> None:
    log(f"inject location lon={longitude:.6f} lat={latitude:.6f}")
    adb("emu", "geo", "fix", f"{longitude:.6f}", f"{latitude:.6f}")
    time.sleep(2)


def grant_runtime_permissions() -> None:
    for permission in (
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
    ):
        adb_shell("pm", "grant", PACKAGE, permission, check=False)
    adb_shell("appops", "set", PACKAGE, "android:fine_location", "allow", check=False)
    adb_shell("appops", "set", PACKAGE, "android:coarse_location", "allow", check=False)
    adb_shell("appops", "set", PACKAGE, "android:background_location", "allow", check=False)
    adb_shell("appops", "set", PACKAGE, "android:post_notification", "allow", check=False)


def set_screen_awake(awake: bool) -> None:
    current = adb_shell("dumpsys", "power")
    is_awake = "Wakefulness=Awake" in current
    if awake != is_awake:
        adb_shell("input", "keyevent", "26")
        time.sleep(1)
        if awake:
            adb_shell("input", "keyevent", "82", check=False)
            time.sleep(0.5)


def visible_point_count(artifacts: Path, prefix: str) -> int:
    root, _ = dump_ui(artifacts, prefix)
    for node in root.iter("node"):
        for value in node_values(node):
            match = re.search(r"(\d+)\s*points", value, flags=re.IGNORECASE)
            if match is not None:
                return int(match.group(1))
    return 0


def average_rgb(path: Path) -> tuple[float, float, float]:
    # PNG decoding without third-party packages. The screenshot helper stores
    # unmodified ADB screencaps, so standard library zlib is sufficient.
    import struct
    import zlib

    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SmokeFailure(f"not a PNG screenshot: {path}")
    offset = 8
    width = height = color_type = bit_depth = None
    compressed = bytearray()
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk_data[:10])
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break
    if None in (width, height, color_type, bit_depth) or bit_depth != 8:
        raise SmokeFailure(f"unsupported PNG screenshot: {path}")
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise SmokeFailure(f"unsupported PNG color type {color_type}: {path}")
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
                    if distance_left <= distance_up and distance_left <= distance_up_left
                    else up
                    if distance_up <= distance_up_left
                    else up_left
                )
                row[index] = (row[index] + predictor) & 0xFF
            elif filter_type != 0:
                raise SmokeFailure(f"unsupported PNG filter {filter_type}: {path}")
        rows.append(row)
        previous = row
    totals = [0, 0, 0]
    count = 0
    for row in rows:
        for index in range(0, len(row), channels):
            if color_type in (0, 4):
                rgb = (row[index], row[index], row[index])
            else:
                rgb = (row[index], row[index + 1], row[index + 2])
            totals[0] += rgb[0]
            totals[1] += rgb[1]
            totals[2] += rgb[2]
            count += 1
    return tuple(total / count for total in totals)  # type: ignore[return-value]


def changed_pixel_ratio(first: Path, second: Path) -> float:
    # Use ImageMagick when available. It is preinstalled on GitHub's Ubuntu
    # runner and avoids a runtime Python dependency in the repository.
    if run(["bash", "-lc", "command -v compare >/dev/null"], check=False).returncode == 0:
        metric = run(
            [
                "bash",
                "-lc",
                f"compare -metric AE {first} {second} null: 2>&1 || true",
            ],
            check=False,
        ).stdout.strip()
        try:
            changed = float(metric.split()[-1])
            identify = run(
                ["identify", "-format", "%[fx:w*h]", str(first)],
                check=True,
            ).stdout.strip()
            total = float(identify)
            return changed / total if total > 0 else 0.0
        except (ValueError, IndexError):
            pass
    first_rgb = average_rgb(first)
    second_rgb = average_rgb(second)
    difference = sum(abs(a - b) for a, b in zip(first_rgb, second_rgb))
    return min(1.0, difference / (255 * 3))


def assert_screen_changed(
    before: Path,
    after: Path,
    *,
    minimum_ratio: float,
    label: str,
) -> float:
    ratio = changed_pixel_ratio(before, after)
    log(f"{label} changed-pixel ratio={ratio:.6f}")
    if ratio < minimum_ratio:
        raise SmokeFailure(
            f"{label} did not change enough: ratio={ratio:.6f}, expected >= {minimum_ratio}"
        )
    return ratio


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    artifacts: Path = args.artifacts
    artifacts.mkdir(parents=True, exist_ok=True)

    result: dict[str, object] = {
        "status": "started",
        "package": PACKAGE,
        "startedAt": time.time(),
    }

    try:
        log(f"install {args.apk.resolve()}")
        adb("install", "-r", "-t", str(args.apk.resolve()), timeout=240)
        grant_runtime_permissions()
        inject_location(139.767000, 35.681000)
        log("cold start")
        launch_app()
        wait_for_node(artifacts, "YOUR PERSONAL MAP", dump_prefix="home-ready")
        screenshot(artifacts, "01-home")

        tap_text(
            artifacts,
            "新しい地図を探索する",
            dump_prefix="open-permission",
        )
        wait_for_node(artifacts, "POCKET-FIRST RECORDING", dump_prefix="permission")
        screenshot(artifacts, "02-permission")

        tap_text(
            artifacts,
            "スマホをしまって探索する",
            dump_prefix="start-background",
        )
        wait_for_node(
            artifacts,
            "探索を記録中",
            timeout_seconds=60,
            dump_prefix="recording-ready",
        )
        screenshot(artifacts, "03-recording-start")

        live_before = screenshot(artifacts, "04-live-before-route")
        route = [
            (139.767050, 35.681000),
            (139.767100, 35.681020),
            (139.767150, 35.681040),
            (139.767200, 35.681060),
            (139.767250, 35.681080),
            (139.767300, 35.681100),
        ]
        for longitude, latitude in route:
            inject_location(longitude, latitude)
        time.sleep(10)
        live_after = screenshot(artifacts, "05-live-after-route")
        live_ratio = assert_screen_changed(
            live_before,
            live_after,
            minimum_ratio=0.03,
            label="foreground live map",
        )

        log("move app to background and turn screen off")
        adb_shell("input", "keyevent", "3")
        set_screen_awake(False)
        background_route = [
            (139.767350, 35.681120),
            (139.767400, 35.681140),
            (139.767450, 35.681160),
        ]
        for longitude, latitude in background_route:
            inject_location(longitude, latitude)

        log("resume app")
        set_screen_awake(True)
        relaunch_without_force_stop()
        wait_for_node(
            artifacts,
            "探索を記録中",
            timeout_seconds=60,
            dump_prefix="recording-recovered",
        )
        recovered = screenshot(artifacts, "06-recording-recovered")
        recovered_ratio = assert_screen_changed(
            live_after,
            recovered,
            minimum_ratio=0.03,
            label="background recovered live map",
        )

        tap_text(
            artifacts,
            "探索を終了して地図を見る",
            timeout_seconds=60,
            scroll=True,
            dump_prefix="complete-exploration",
        )
        wait_for_node(
            artifacts,
            "YOUR PERSONAL MAP",
            timeout_seconds=60,
            dump_prefix="review-ready",
        )
        screenshot(artifacts, "07-review")

        log("force stop and relaunch for persistence")
        adb_shell("am", "force-stop", PACKAGE)
        launch_app()
        tap_text(
            artifacts,
            "Field Test",
            timeout_seconds=60,
            scroll=True,
            dump_prefix="open-persisted-map",
        )
        wait_for_node(
            artifacts,
            "YOUR PERSONAL MAP",
            timeout_seconds=60,
            dump_prefix="persisted-review",
        )
        screenshot(artifacts, "08-review-after-restart")

        result.update(
            {
                "status": "passed",
                "completedAt": time.time(),
                "liveMapChangedPixelRatio": live_ratio,
                "recoveredMapChangedPixelRatio": recovered_ratio,
            }
        )
        (artifacts / "smoke-result.json").write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        log("PASS")
        return 0
    except Exception as error:  # noqa: BLE001 - preserve full failure evidence
        result.update(
            {
                "status": "failed",
                "completedAt": time.time(),
                "error": str(error),
            }
        )
        (artifacts / "smoke-result.json").write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (artifacts / "smoke-failure.txt").write_text(
            str(error), encoding="utf-8"
        )
        try:
            screenshot(artifacts, "smoke-failure")
        except Exception:
            pass
        log(f"FAIL: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
