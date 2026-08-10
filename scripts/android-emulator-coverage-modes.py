#!/usr/bin/env python3
"""Black-box comparison of explored-space modes and Review map viewport controls.

This script runs after android-emulator-smoke.py in the same emulator session.
The first script leaves the app on a persisted PersonalMap Review. Here we only
exercise renderer-derived controls and capture evidence; canonical map data is
never changed.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

REMOTE_UI_XML = "/sdcard/pem-coverage-window.xml"


class CoverageFailure(RuntimeError):
    pass


def run(command: list[str], *, check: bool = True, timeout: int = 60) -> str:
    result = subprocess.run(
        command,
        check=False,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise CoverageFailure(
            f"command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result.stdout


def adb(*args: str, check: bool = True, timeout: int = 60) -> str:
    return run(["adb", *args], check=check, timeout=timeout)


def adb_shell(*args: str, check: bool = True, timeout: int = 60) -> str:
    return adb("shell", *args, check=check, timeout=timeout)


def dump_ui(artifacts: Path, name: str) -> ET.Element:
    last_error = ""
    for _ in range(5):
        result = subprocess.run(
            ["adb", "shell", "uiautomator", "dump", "--compressed", REMOTE_UI_XML],
            check=False,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0:
            xml_text = adb_shell("cat", REMOTE_UI_XML, timeout=30)
            if "<hierarchy" in xml_text:
                (artifacts / f"{name}.xml").write_text(xml_text, encoding="utf-8")
                return ET.fromstring(xml_text)
        last_error = f"stdout={result.stdout!r} stderr={result.stderr!r}"
        time.sleep(1)
    raise CoverageFailure(f"could not dump UI hierarchy: {last_error}")


def node_values(node: ET.Element) -> tuple[str, ...]:
    return tuple(
        value
        for key in ("text", "content-desc", "resource-id")
        if (value := node.attrib.get(key, "").strip())
    )


def find_node(root: ET.Element, needle: str) -> ET.Element | None:
    for node in root.iter("node"):
        if any(needle == value or needle in value for value in node_values(node)):
            return node
    return None


def parse_bounds(node: ET.Element) -> tuple[int, int, int, int]:
    match = re.fullmatch(
        r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",
        node.attrib.get("bounds", ""),
    )
    if match is None:
        raise CoverageFailure(f"node has invalid bounds: {node.attrib}")
    return tuple(int(value) for value in match.groups())  # type: ignore[return-value]


def tap_node(node: ET.Element) -> None:
    left, top, right, bottom = parse_bounds(node)
    adb_shell("input", "tap", str((left + right) // 2), str((top + bottom) // 2))
    time.sleep(1)


def swipe_inside(node: ET.Element) -> None:
    left, top, right, bottom = parse_bounds(node)
    width = right - left
    height = bottom - top
    start_x = left + (width * 3) // 5
    start_y = top + height // 2
    end_x = left + width // 3
    end_y = top + height // 2
    adb_shell(
        "input",
        "touchscreen",
        "swipe",
        str(start_x),
        str(start_y),
        str(end_x),
        str(end_y),
        "450",
    )
    time.sleep(1)


def swipe_up_inside(node: ET.Element) -> None:
    left, top, right, bottom = parse_bounds(node)
    width = right - left
    height = bottom - top
    x = left + width // 2
    start_y = bottom - max(24, height // 5)
    end_y = top + max(24, height // 5)
    adb_shell(
        "input",
        "touchscreen",
        "swipe",
        str(x),
        str(start_y),
        str(x),
        str(end_y),
        "500",
    )
    time.sleep(1)


def wait_for_node(
    artifacts: Path,
    needle: str,
    *,
    timeout_seconds: int = 45,
    prefix: str,
) -> ET.Element:
    deadline = time.monotonic() + timeout_seconds
    attempt = 0
    while time.monotonic() < deadline:
        root = dump_ui(artifacts, f"{prefix}-{attempt:02d}")
        node = find_node(root, needle)
        if node is not None:
            return node
        time.sleep(1)
        attempt += 1
    raise CoverageFailure(f"UI element did not appear: {needle}")


def screenshot(artifacts: Path, name: str) -> None:
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
        raise CoverageFailure(
            result.stderr.decode("utf-8", errors="replace")
        )
    dump_ui(artifacts, name)


def select_mode(
    artifacts: Path,
    accessibility_label: str,
    expected_text: str,
    screenshot_name: str,
) -> None:
    button = wait_for_node(
        artifacts,
        accessibility_label,
        prefix=f"mode-button-{screenshot_name}",
    )
    tap_node(button)
    wait_for_node(
        artifacts,
        expected_text,
        prefix=f"mode-content-{screenshot_name}",
    )
    screenshot(artifacts, screenshot_name)


def exercise_viewport(artifacts: Path) -> None:
    enter_button = wait_for_node(
        artifacts,
        "地図操作を開始",
        prefix="viewport-enter-mode",
    )
    screenshot(artifacts, "09a-review-scroll-priority")
    tap_node(enter_button)
    wait_for_node(
        artifacts,
        "地図操作を終了してページスクロールへ戻る",
        prefix="viewport-mode-active",
    )

    zoom_button = wait_for_node(
        artifacts,
        "地図を拡大",
        prefix="viewport-zoom-button",
    )
    tap_node(zoom_button)
    zoom_button = wait_for_node(
        artifacts,
        "地図を拡大",
        prefix="viewport-zoom-button-second",
    )
    tap_node(zoom_button)
    wait_for_node(
        artifacts,
        "地図の倍率 4×",
        prefix="viewport-zoom-readout",
    )
    screenshot(artifacts, "09b-review-map-mode-zoom-4x")

    canvas = wait_for_node(
        artifacts,
        "探索地図。2本指で拡大し、拡大中は1本指で移動できます。",
        prefix="viewport-canvas",
    )
    swipe_inside(canvas)
    wait_for_node(
        artifacts,
        "地図の倍率 4×",
        prefix="viewport-pan-retains-zoom",
    )
    screenshot(artifacts, "09c-review-map-mode-panned")

    fit_button = wait_for_node(
        artifacts,
        "地図を全体表示",
        prefix="viewport-fit-button",
    )
    tap_node(fit_button)
    wait_for_node(
        artifacts,
        "地図の倍率 1×",
        prefix="viewport-fit-readout",
    )
    screenshot(artifacts, "09d-review-map-fit-restored")

    exit_button = wait_for_node(
        artifacts,
        "地図操作を終了してページスクロールへ戻る",
        prefix="viewport-exit-mode",
    )
    tap_node(exit_button)
    wait_for_node(
        artifacts,
        "地図操作を開始",
        prefix="viewport-scroll-restored",
    )
    screenshot(artifacts, "09e-review-scroll-mode-restored")


def verify_scroll_from_map(artifacts: Path) -> None:
    interaction_button = wait_for_node(
        artifacts,
        "地図操作を開始",
        prefix="scroll-check-button-before",
    )
    before_top = parse_bounds(interaction_button)[1]
    canvas = wait_for_node(
        artifacts,
        "探索地図",
        prefix="scroll-check-canvas",
    )
    swipe_up_inside(canvas)

    root = dump_ui(artifacts, "09f-review-scrolled-from-map")
    interaction_after = find_node(root, "地図操作を開始")
    if interaction_after is not None:
        after_top = parse_bounds(interaction_after)[1]
        if after_top >= before_top - 48:
            raise CoverageFailure(
                "one-finger vertical swipe from the non-interactive map did not scroll Review"
            )
    if find_node(root, "地図の根拠") is None and interaction_after is not None:
        raise CoverageFailure(
            "Review did not reveal lower content after scrolling from the map"
        )
    screenshot(artifacts, "09f-review-scrolled-from-map")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    artifacts: Path = args.artifacts
    artifacts.mkdir(parents=True, exist_ok=True)

    try:
        wait_for_node(
            artifacts,
            "YOUR PERSONAL MAP",
            prefix="coverage-review-ready",
        )
        wait_for_node(
            artifacts,
            "位置の不確実性",
            prefix="coverage-default",
        )
        screenshot(artifacts, "09-location-uncertainty")
        exercise_viewport(artifacts)

        select_mode(
            artifacts,
            "地図表示 通過セル",
            "推定通過セル",
            "10-passage-cells",
        )
        select_mode(
            artifacts,
            "地図表示 軌跡",
            "採用済み位置の中心線",
            "11-point-estimate-track",
        )
        select_mode(
            artifacts,
            "地図表示 不確実性",
            "位置の不確実性",
            "12-location-uncertainty-restored",
        )
        verify_scroll_from_map(artifacts)
        (artifacts / "coverage-modes-result.json").write_text(
            '{"status":"passed","semantics":"uncertainty-separated-from-coverage",'
            '"modes":["uncertainty","cells","track"],'
            '"viewport":["explicit-map-mode","zoom-4x","pan","fit-reset",'
            '"scroll-restored"]}\n',
            encoding="utf-8",
        )
        print("[coverage-modes] passed", flush=True)
        return 0
    except Exception as error:  # noqa: BLE001 - artifact must explain failure
        (artifacts / "coverage-modes-failure.txt").write_text(
            str(error), encoding="utf-8"
        )
        try:
            screenshot(artifacts, "coverage-modes-failure")
        except Exception:
            pass
        print(f"[coverage-modes] failed: {error}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
