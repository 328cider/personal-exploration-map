#!/usr/bin/env python3
"""Run the installed-APK smoke suite with stable screen-specific labels.

Home uses the product brand `PERSONAL EXPLORATION MAP`, while Review uses
`YOUR PERSONAL MAP`. The base smoke suite historically used the Review label
for both screens. Keep product copy intact and adapt only the black-box harness.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from typing import Any

SCRIPT_PATH = Path(__file__).with_name("android-emulator-smoke.py")
SPEC = importlib.util.spec_from_file_location("pem_android_emulator_smoke", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load base smoke suite: {SCRIPT_PATH}")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

_base_wait_for_node = smoke.wait_for_node


def wait_for_node(
    artifacts: Path,
    needle: str,
    **kwargs: Any,
):
    if needle == "YOUR PERSONAL MAP" and kwargs.get("dump_prefix") == "home-ready":
        needle = "PERSONAL EXPLORATION MAP"
    return _base_wait_for_node(artifacts, needle, **kwargs)


smoke.wait_for_node = wait_for_node

if __name__ == "__main__":
    sys.exit(smoke.main())
