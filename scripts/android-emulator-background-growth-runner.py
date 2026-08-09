#!/usr/bin/env python3
"""Require real map-canvas growth after screen-off/background delivery.

The recording screen refreshes asynchronously after Android resumes. A single
screenshot taken immediately after the activity becomes foreground can still
show the pre-background point set even though the queued GNSS callback is
persisted moments later. This wrapper waits for a change inside the map canvas
only, excluding the timer, refresh spinner and status text.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import sys
import time


SYSTEM_RUNNER_PATH = Path(__file__).with_name(
    "android-emulator-system-dialog-runner.py"
)
SPEC = importlib.util.spec_from_file_location(
    "pem_android_emulator_system_dialog_runner",
    SYSTEM_RUNNER_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load emulator runner: {SYSTEM_RUNNER_PATH}")
system_runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(system_runner)

smoke = system_runner.smoke
ui_runner = system_runner.runner
_base_assert_screen_changed = smoke.assert_screen_changed

PIXEL_DELTA_THRESHOLD = 18
MAP_INCREMENT_THRESHOLD = 0.01
BACKGROUND_REFRESH_TIMEOUT_SECONDS = 75


def map_canvas_change_ratio(first: Path, second: Path) -> float:
    first_width, first_height, before = ui_runner.decode_png_rgb(first)
    second_width, second_height, after = ui_runner.decode_png_rgb(second)
    if (first_width, first_height) != (second_width, second_height):
        raise smoke.SmokeFailure(
            f"screen size changed from {first_width}x{first_height} to "
            f"{second_width}x{second_height}"
        )

    # Fixed Android 15 Pixel CI profile. This crop contains only the map
    # canvas; the once-per-second timer, refresh icon, point count and actions
    # are intentionally excluded so they cannot produce a false pass.
    minimum_x = int(first_width * 0.10)
    maximum_x = int(first_width * 0.90)
    minimum_y = int(first_height * 0.64)
    maximum_y = int(first_height * 0.88)

    changed = 0
    total = (maximum_x - minimum_x) * (maximum_y - minimum_y)
    for y in range(minimum_y, maximum_y):
        row_start = (y * first_width + minimum_x) * 3
        for x_offset in range(maximum_x - minimum_x):
            index = row_start + x_offset * 3
            if max(
                abs(before[index] - after[index]),
                abs(before[index + 1] - after[index + 1]),
                abs(before[index + 2] - after[index + 2]),
            ) > PIXEL_DELTA_THRESHOLD:
                changed += 1
    return changed / max(1, total)


def assert_screen_changed(
    before: Path,
    after: Path,
    *,
    minimum_ratio: float,
    label: str,
) -> float:
    if label != "background recovered live map":
        return _base_assert_screen_changed(
            before,
            after,
            minimum_ratio=minimum_ratio,
            label=label,
        )

    deadline = time.monotonic() + BACKGROUND_REFRESH_TIMEOUT_SECONDS
    attempt = 0
    latest_ratio = map_canvas_change_ratio(before, after)
    latest_path = after

    while latest_ratio < MAP_INCREMENT_THRESHOLD and time.monotonic() < deadline:
        time.sleep(2)
        candidate = after.with_name(
            f"{after.stem}-wait-{attempt:02d}{after.suffix}"
        )
        ui_runner.raw_screenshot(after.parent, candidate.stem)
        latest_path = candidate
        latest_ratio = map_canvas_change_ratio(before, candidate)
        smoke.log(
            "background recovered map-canvas changed-pixel ratio="
            f"{latest_ratio:.6f} attempt={attempt}"
        )
        attempt += 1

    if latest_ratio < MAP_INCREMENT_THRESHOLD:
        raise smoke.SmokeFailure(
            "background GNSS did not produce new visible map geometry within "
            f"{BACKGROUND_REFRESH_TIMEOUT_SECONDS}s: ratio={latest_ratio:.6f}, "
            f"expected >= {MAP_INCREMENT_THRESHOLD}"
        )

    if latest_path != after:
        shutil.copyfile(latest_path, after)
    smoke.log(
        "background recovered live map passed map-canvas growth: "
        f"ratio={latest_ratio:.6f}"
    )
    return latest_ratio


smoke.assert_screen_changed = assert_screen_changed

if __name__ == "__main__":
    sys.exit(smoke.main())
