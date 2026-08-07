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
    for _ in range(5):
        result = run(
            ["adb", "shell", "uiautomator", "dump", "--compressed", REMOTE_UI_XML],
            check=False,
            timeout=30,
        )
        if result.returncode == 0:
            xml_text = adb_shell("cat", REMOTE_UI_XML, timeout=30)
            if "<hierarchy" in xml_text:
                path = artifacts / f"{name}.xml"
                path.write_text(xml_text, encoding="utf-8")
                return ET.fromstring(xml_text), path
        last_error = f"stdout={result.stdout!r} stderr={result.stderr!r}"
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


def grant_runtime_permissions() -> None:
    permissions = [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
    ]
    for permission in permissions:
        result = run(
            ["adb", "shell", "pm", "grant", PACKAGE, permission],
            check=False,
            timeout=30,
        )
        if result.returncode != 0:
            log(
                f"permission grant returned {result.returncode} for {permission}: "
                f"{result.stderr.strip()}"
            )

    # Keep the CI device deterministic. These operations affect only the
    # disposable emulator and do not change production permission handling.
    adb_shell("cmd", "deviceidle", "whitelist", f"+{PACKAGE}", check=False)
    adb_shell("cmd", "location", "set-location-enabled", "true", check=False)
    adb_shell("settings", "put", "secure", "location_mode", "3", check=False)

    package_dump = adb_shell("dumpsys", "package", PACKAGE)
    required = permissions[:3]
    missing = [
        permission
        for permission in required
        if f"{permission}: granted=true" not in package_dump
    ]
    if missing:
        raise SmokeFailure(
            "emulator did not grant required location permissions: " + ", ".join(missing)
        )


def inject_location(longitude: float, latitude: float, delay_seconds: float = 6.0) -> None:
    log(f"inject location lon={longitude:.6f} lat={latitude:.6f}")
    adb("emu", "geo", "fix", f"{longitude:.6f}", f"{latitude:.6f}")
    time.sleep(delay_seconds)


def inject_route(points: Iterable[tuple[float, float]], delay_seconds: float = 6.0) -> None:
    for longitude, latitude in points:
        inject_location(longitude, latitude, delay_seconds)


def save_debug_state(artifacts: Path, prefix: str) -> None:
    artifacts.mkdir(parents=True, exist_ok=True)
    try:
        screenshot(artifacts, prefix)
    except Exception as error:  # noqa: BLE001 - failure diagnostics must continue
        (artifacts / f"{prefix}-screenshot-error.txt").write_text(
            str(error), encoding="utf-8"
        )
    commands: dict[str, list[str]] = {
        "logcat": ["adb", "logcat", "-d", "-v", "threadtime"],
        "activity": ["adb", "shell", "dumpsys", "activity", "activities"],
        "package": ["adb", "shell", "dumpsys", "package", PACKAGE],
        "location": ["adb", "shell", "dumpsys", "location"],
        "notification": ["adb", "shell", "dumpsys", "notification", "--noredact"],
    }
    for name, command in commands.items():
        result = run(command, check=False, timeout=60)
        (artifacts / f"{prefix}-{name}.txt").write_text(
            result.stdout + "\n" + result.stderr,
            encoding="utf-8",
        )


def run_smoke(apk: Path, artifacts: Path) -> dict[str, object]:
    started_at = time.time()
    artifacts.mkdir(parents=True, exist_ok=True)
    adb("logcat", "-c", check=False)

    log(f"install {apk}")
    adb("uninstall", PACKAGE, check=False, timeout=60)
    adb("install", "-r", str(apk), timeout=180)
    grant_runtime_permissions()

    # Seed an initial stable GPS fix before the location subscription starts.
    inject_location(139.767000, 35.681000, delay_seconds=2)

    log("cold start")
    launch_app()
    wait_for_node(artifacts, "新しい地図を探索する", dump_prefix="home-ready")
    screenshot(artifacts, "01-home")

    tap_text(artifacts, "新しい地図を探索する", dump_prefix="home-start")
    wait_for_node(
        artifacts,
        "ポケット記録を許可して開始",
        scroll=True,
        dump_prefix="permission-ready",
    )
    screenshot(artifacts, "02-permission")

    tap_text(
        artifacts,
        "ポケット記録を許可して開始",
        scroll=True,
        dump_prefix="permission-start",
    )
    wait_for_node(artifacts, "探索を記録中", timeout_seconds=60, dump_prefix="recording")
    screenshot(artifacts, "03-recording-start")

    foreground_route = [
        (139.767060, 35.681000),
        (139.767120, 35.681000),
        (139.767180, 35.681040),
        (139.767180, 35.681100),
        (139.767240, 35.681100),
        (139.767300, 35.681140),
    ]
    inject_route(foreground_route)

    wait_for_node(
        artifacts,
        "探索中の地図",
        timeout_seconds=60,
        scroll=True,
        dump_prefix="live-preview-card",
    )
    wait_for_node(
        artifacts,
        "探索1の開始地点",
        timeout_seconds=90,
        dump_prefix="live-preview-track",
    )
    screenshot(artifacts, "04-live-map-grown")

    log("move app to background and turn screen off")
    adb_shell("input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    adb_shell("input", "keyevent", "KEYCODE_SLEEP", check=False)

    background_route = [
        (139.767360, 35.681180),
        (139.767420, 35.681180),
        (139.767480, 35.681220),
    ]
    inject_route(background_route)

    adb_shell("input", "keyevent", "KEYCODE_WAKEUP", check=False)
    adb_shell("wm", "dismiss-keyguard", check=False)
    relaunch_without_force_stop()
    wait_for_node(
        artifacts,
        "探索を記録中",
        timeout_seconds=60,
        dump_prefix="recovered-recording",
    )
    wait_for_node(
        artifacts,
        "探索中の地図",
        timeout_seconds=60,
        scroll=True,
        dump_prefix="recovered-preview",
    )
    wait_for_node(
        artifacts,
        "探索1の開始地点",
        timeout_seconds=60,
        dump_prefix="recovered-track",
    )
    screenshot(artifacts, "05-background-recovered")

    tap_text(
        artifacts,
        "探索を終了して地図を見る",
        timeout_seconds=60,
        scroll=True,
        dump_prefix="end-exploration",
    )
    wait_for_node(
        artifacts,
        "YOUR PERSONAL MAP",
        timeout_seconds=75,
        dump_prefix="review-ready",
    )
    wait_for_node(
        artifacts,
        "各探索の開始",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="review-map",
    )
    screenshot(artifacts, "06-review-after-end")

    log("force-stop and verify persisted PersonalMap")
    adb_shell("am", "force-stop", PACKAGE)
    time.sleep(1)
    relaunch_without_force_stop()
    wait_for_node(artifacts, "自分の地図", timeout_seconds=60, dump_prefix="persisted-home")
    persisted_card = wait_for_node(
        artifacts,
        "タップして地図を見る",
        timeout_seconds=45,
        scroll=True,
        dump_prefix="persisted-card",
    )
    screenshot(artifacts, "07-persisted-home")
    tap_node(persisted_card)
    wait_for_node(
        artifacts,
        "YOUR PERSONAL MAP",
        timeout_seconds=60,
        dump_prefix="persisted-review",
    )
    screenshot(artifacts, "08-persisted-review")

    elapsed = round(time.time() - started_at, 2)
    result = {
        "status": "passed",
        "package": PACKAGE,
        "elapsedSeconds": elapsed,
        "assertions": [
            "cold-start-home",
            "background-recording-started",
            "foreground-live-map-grew",
            "screen-off-background-recovery",
            "exploration-ended-to-review",
            "force-stop-persistence",
        ],
    }
    (artifacts / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()

    apk = args.apk.resolve()
    artifacts = args.artifacts.resolve()
    if not apk.is_file():
        raise SmokeFailure(f"APK does not exist: {apk}")

    try:
        result = run_smoke(apk, artifacts)
        save_debug_state(artifacts, "final")
        log(f"PASS in {result['elapsedSeconds']}s")
        return 0
    except Exception as error:  # noqa: BLE001 - preserve full CI evidence
        artifacts.mkdir(parents=True, exist_ok=True)
        (artifacts / "failure.txt").write_text(
            f"{type(error).__name__}: {error}\n",
            encoding="utf-8",
        )
        save_debug_state(artifacts, "failure")
        log(f"FAIL: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
