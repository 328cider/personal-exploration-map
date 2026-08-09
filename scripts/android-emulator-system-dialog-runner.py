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

# Keep this allow-list deliberately narrow. These are emulator/system
# components observed to fail transiently on GitHub-hosted API 35 images while
# the Field-test app is healthy underneath. Never match arbitrary Android or
# Google package names because doing so could hide a real application failure.
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


smoke.dump_ui = dialog_safe_dump_ui

if __name__ == "__main__":
    sys.exit(smoke.main())
