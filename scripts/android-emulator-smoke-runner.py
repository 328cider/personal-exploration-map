#!/usr/bin/env python3
"""Run the base emulator lifecycle with race-safe UI hierarchy dumps.

`uiautomator dump` can return success before its requested file is visible through
`adb shell cat`. A shared fixed remote path can also leave stale evidence between
retries. This wrapper keeps the product scenario unchanged while replacing only
the black-box hierarchy transport with unique files and non-fatal retries.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET


SCRIPT_PATH = Path(__file__).with_name("android-emulator-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_android_emulator_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load base smoke suite: {SCRIPT_PATH}")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


def race_safe_dump_ui(artifacts: Path, name: str) -> tuple[ET.Element, Path]:
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
        if dump_result.returncode == 0 and cat_result.returncode == 0 and "<hierarchy" in xml_text:
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


smoke.dump_ui = race_safe_dump_ui


if __name__ == "__main__":
    sys.exit(smoke.main())
