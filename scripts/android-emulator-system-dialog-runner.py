#!/usr/bin/env python3
"""Run the current emulator smoke suite while ignoring emulator system ANRs.

GitHub-hosted Android emulators occasionally display a transient system-process
"isn't responding" dialog over an otherwise healthy app. Those known emulator
process failures must not be mistaken for an application failure, but Field-test
or any unrecognised app-process crash dialog must remain visible and fail the
suite.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET


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

# Keep this list deliberately narrow. These are emulator/system components seen
# to fail transiently on GitHub-hosted API 35 images while the Field-test app is
# already healthy underneath. Never match arbitrary com.google/android package
# names because doing so could hide a real application failure.
_TRANSIENT_SYSTEM_PROCESSES = (
    "Pixel Launcher",
    "System UI",
    "com.google.android.googlesdksetup",
)


def _node_value(node: ET.Element, key: str) -> str:
    return node.attrib.get(key, "").strip()


def _find_node(
    root: ET.Element,
    *,
    resource_id: str | None = None,
    text: str | None = None,
) -> ET.Element | None:
    for node in root.iter("node"):
        if resource_id is not None and _node_value(node, "resource-id") == resource_id:
            return node
        if text is not None and _node_value(node, "text") == text:
            return node
    return None


def _transient_dialog_action(root: ET.Element) -> tuple[ET.Element, str] | None:
    title = next(
        (
            _node_value(node, "text")
            for node in root.iter("node")
            if _node_value(node, "resource-id") == "android:id/alertTitle"
        ),
        "",
    )
    if not any(process in title for process in _TRANSIENT_SYSTEM_PROCESSES):
        return None

    if "isn't responding" in title:
        wait_node = _find_node(root, resource_id="android:id/aerr_wait")
        if wait_node is None:
            wait_node = _find_node(root, text="Wait")
        if wait_node is not None:
            return wait_node, title

    if "keeps stopping" in title:
        close_node = _find_node(root, resource_id="android:id/aerr_close")
        if close_node is None:
            close_node = _find_node(root, text="Close app")
        if close_node is not None:
            return close_node, title

    return None


def dialog_safe_dump_ui(
    artifacts: Path,
    name: str,
) -> tuple[ET.Element, Path]:
    for attempt in range(5):
        root, raw_path = _base_dump_ui(artifacts, f"{name}-raw-{attempt:02d}")
        action = _transient_dialog_action(root)
        if action is None:
            final_path = artifacts / f"{name}.xml"
            final_path.write_text(raw_path.read_text(encoding="utf-8"), encoding="utf-8")
            return root, final_path

        action_node, title = action
        smoke.log(f"dismiss transient emulator system dialog: {title}")
        smoke.tap_node(action_node)
        time.sleep(1.5)

    raise smoke.SmokeFailure(
        "transient emulator system dialog remained after five dismiss attempts"
    )


smoke.dump_ui = dialog_safe_dump_ui

if __name__ == "__main__":
    sys.exit(smoke.main())
