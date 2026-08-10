#!/usr/bin/env python3
"""Compatibility entry point for notification and marker black-box checks.

The interaction suite historically received two helper functions from an older
base smoke module. Keep those helpers in a thin harness adapter rather than
reintroducing test-only APIs into application code.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import time


RUNNER_PATH = Path(__file__).with_name("android-emulator-interaction-runner.py")
SPEC = importlib.util.spec_from_file_location(
    "pem_android_emulator_interaction_runner",
    RUNNER_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load interaction runner: {RUNNER_PATH}")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)

smoke = runner.smoke
interaction = runner.interaction


def inject_route(
    route: list[tuple[float, float]],
    *,
    delay_seconds: float = 2,
) -> None:
    for longitude, latitude in route:
        smoke.log(
            f"inject location lon={longitude:.6f} lat={latitude:.6f}"
        )
        smoke.adb(
            "emu",
            "geo",
            "fix",
            f"{longitude:.6f}",
            f"{latitude:.6f}",
        )
        time.sleep(delay_seconds)


def save_debug_state(artifacts: Path, prefix: str) -> None:
    artifacts.mkdir(parents=True, exist_ok=True)
    try:
        runner.raw_screenshot(artifacts, prefix)
    except Exception as error:  # best-effort failure evidence
        (artifacts / f"{prefix}-screenshot-error.txt").write_text(
            repr(error) + "\n",
            encoding="utf-8",
        )

    commands = {
        "logcat": ("logcat", "-d", "-v", "threadtime"),
        "activity": ("shell", "dumpsys", "activity", "activities"),
        "notification": (
            "shell",
            "dumpsys",
            "notification",
            "--noredact",
        ),
        "package": (
            "shell",
            "dumpsys",
            "package",
            smoke.PACKAGE,
        ),
    }
    for name, arguments in commands.items():
        try:
            output = smoke.adb(*arguments, check=False, timeout=60)
        except Exception as error:  # best-effort failure evidence
            output = repr(error)
        (artifacts / f"{prefix}-{name}.txt").write_text(
            output,
            encoding="utf-8",
        )


def restore_review_top() -> None:
    """Remove scroll-position coupling between sequential Review test suites."""

    width, height = smoke.parse_screen_size()
    x = width // 2
    start_y = max(120, height // 4)
    end_y = min(height - 120, (height * 9) // 10)
    for _ in range(5):
        smoke.adb_shell(
            "input",
            "touchscreen",
            "swipe",
            str(x),
            str(start_y),
            str(x),
            str(end_y),
            "350",
        )
        time.sleep(0.25)


smoke.inject_route = inject_route
smoke.save_debug_state = save_debug_state

if __name__ == "__main__":
    restore_review_top()
    sys.exit(interaction.main())
