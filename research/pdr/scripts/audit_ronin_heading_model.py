"""Metadata-only audit of the official RoNIN body-heading checkpoint archive.

The checkpoint is never deserialized.  PyTorch checkpoint formats may contain
pickle payloads, and this research gate needs only provenance, configuration,
member hashes, input semantics, and licensing.
"""

from __future__ import annotations

import argparse
from io import BytesIO
import hashlib
import json
from pathlib import Path, PurePosixPath
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_SPEC = ROOT / "datasets" / "artifacts" / "ronin-unseen-test.json"
MODEL_URL = (
    "https://www.frdr-dfdr.ca/repo/files/8/published/publication_538/"
    "submitted_data/Pretrained_Models/ronin_body_heading.zip"
)
MODEL_SHA256 = "83ea966b21e14ab9605511033e398aeb8b2e4ecfbc771624df4fdaa5e20a5634"
MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
AUDITED_CODE_REVISION = "805b7f0f28bb164ce89ada9ac05a9470dbe3d715"


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def fetch_bounded(url: str, *, maximum_bytes: int) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "pdr-research/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        resolved_url = response.geturl()
        chunks = []
        size = 0
        while chunk := response.read(64 * 1024):
            size += len(chunk)
            if size > maximum_bytes:
                raise ValueError(f"Artifact exceeds bounded download: {size} bytes")
            chunks.append(chunk)
    return b"".join(chunks), resolved_url


def safe_member_name(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    artifact = json.loads(ARTIFACT_SPEC.read_text(encoding="utf-8"))
    readme, readme_resolved = fetch_bounded(
        artifact["readme_url"], maximum_bytes=256 * 1024
    )
    license_text, license_resolved = fetch_bounded(
        artifact["license_url"], maximum_bytes=256 * 1024
    )
    if sha256_bytes(readme) != artifact["readme_sha256"]:
        raise ValueError("Official RoNIN README hash changed")
    if sha256_bytes(license_text) != artifact["license_sha256"]:
        raise ValueError("Official RoNIN LICENSE hash changed")
    model_zip, resolved_url = fetch_bounded(
        MODEL_URL, maximum_bytes=MAX_DOWNLOAD_BYTES
    )
    if sha256_bytes(model_zip) != MODEL_SHA256:
        raise ValueError("Official RoNIN body-heading model hash changed")

    members = []
    configs = []
    checkpoint_member_count = 0
    with zipfile.ZipFile(BytesIO(model_zip)) as archive:
        for info in archive.infolist():
            if not safe_member_name(info.filename):
                raise ValueError(f"Unsafe ZIP member name: {info.filename}")
            if info.flag_bits & 0x1:
                raise ValueError(f"Encrypted ZIP member: {info.filename}")
            if info.is_dir():
                continue
            with archive.open(info) as stream:
                content = stream.read()
            if len(content) != info.file_size:
                raise ValueError(f"Truncated ZIP member: {info.filename}")
            suffix = PurePosixPath(info.filename).suffix.lower()
            if suffix in {".pt", ".pth", ".pkl", ".pickle"}:
                checkpoint_member_count += 1
            if PurePosixPath(info.filename).name == "config.json":
                if len(content) > 64 * 1024:
                    raise ValueError("Unexpectedly large model config")
                configs.append(
                    {
                        "member": info.filename,
                        "content": json.loads(content.decode("utf-8")),
                    }
                )
            members.append(
                {
                    "name": info.filename,
                    "uncompressed_bytes": info.file_size,
                    "compressed_bytes": info.compress_size,
                    "sha256": sha256_bytes(content),
                    "deserialized": False,
                }
            )
    if checkpoint_member_count < 1:
        raise ValueError("Official archive contains no checkpoint member")
    if not configs:
        raise ValueError("Official archive contains no config.json")

    readme_text = readme.decode("utf-8")
    required_readme_evidence = {
        "custom_noncommercial_license": (
            "custom license for non-commercial" in readme_text
        ),
        "private_training_data_prevents_full_reproduction": (
            "cannot be fully reproduced" in readme_text
            and "private data" in readme_text
        ),
        "heading_model_listed": "ronin_body_heading.zip" in readme_text,
    }
    if not all(required_readme_evidence.values()):
        raise ValueError("Official README no longer supports locked audit claims")

    payload = {
        "schema_version": 1,
        "model": "official RoNIN body-heading LSTM",
        "evidence_kind": "metadata-only-benchmark-audit",
        "artifact": {
            "requested_url": MODEL_URL,
            "resolved_url": resolved_url,
            "download_bytes": len(model_zip),
            "sha256": MODEL_SHA256,
            "members": members,
            "checkpoint_member_count": checkpoint_member_count,
            "checkpoint_deserialized": False,
        },
        "official_text_evidence": {
            "readme_requested_url": artifact["readme_url"],
            "readme_resolved_url": readme_resolved,
            "readme_sha256": artifact["readme_sha256"],
            "license_requested_url": artifact["license_url"],
            "license_resolved_url": license_resolved,
            "license_sha256": artifact["license_sha256"],
            "claim_checks": required_readme_evidence,
        },
        "configuration": configs,
        "code": {
            "repository": "https://github.com/Sachini/ronin",
            "revision": AUDITED_CODE_REVISION,
            "license": "GPL-3.0",
            "entrypoint": "source/ronin_body_heading.py",
            "feature_loader": "source/data_glob_heading.py via data_glob_speed.py",
        },
        "input_contract": {
            "model_features": [
                "3-axis angular rate",
                "3-axis acceleration including gravity",
            ],
            "test_orientation_source": "Android Game Rotation Vector",
            "required_rate_hz": 200,
            "unroll_frames": 1000,
            "unroll_seconds": 5.0,
            "training_target": "sin/cos of evaluation-only body-heading label",
            "android_obtainable_subset": [
                "TYPE_GYROSCOPE",
                "TYPE_ACCELEROMETER",
                "TYPE_GAME_ROTATION_VECTOR",
                "SensorEvent.timestamp",
            ],
        },
        "compatibility_findings": [
            "Required raw sensors are Android-obtainable only on devices exposing Game Rotation Vector.",
            "The official 200 Hz contract exceeds the project's 50-100 Hz capture target and has no published frozen 50/100 Hz robustness result.",
            "The official loader uses dataset calibration/alignment metadata; a product adapter must replace that path with Android-raw-only initialization.",
            "The published checkpoint cannot be fully reproduced because its training set includes unpublished private data.",
            "The public README describes released models as trained on the entire dataset, so the checkpoint is not untouched evidence for the released test sequences.",
            "The custom data/model license prohibits commercial product use; GPL code must stay isolated from product packages.",
            "The checkpoint was hashed but never deserialized because PyTorch checkpoint loading can execute pickle payloads.",
        ],
        "decision": "benchmark-demo-only-do-not-run-or-ship",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "model_zip_sha256": MODEL_SHA256,
                "download_bytes": len(model_zip),
                "member_count": len(members),
                "checkpoint_member_count": checkpoint_member_count,
                "checkpoint_deserialized": False,
                "decision": payload["decision"],
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
