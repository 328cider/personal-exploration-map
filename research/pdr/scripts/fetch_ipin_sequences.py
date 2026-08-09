"""Range-fetch the preregistered IPIN 2022 phase; intended for Docker only."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.remote_zip import HttpRangeReader, write_manifest  # noqa: E402


ARCHIVE_URL = (
    "https://zenodo.org/api/records/7612915/files/"
    "2022_IPIN_Competition_Track03.zip/content"
)
PREREGISTRATION = (
    ROOT / "datasets" / "manifests" / "ipin-classical-preregistration-v1.json"
)
DEVELOPMENT_FREEZE = (
    ROOT / "datasets" / "manifests" / "ipin-classical-development-v1.json"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def selected_sequences(
    preregistration: dict[str, object], phase: str
) -> list[dict[str, object]]:
    role = "development" if phase == "development" else "untouched-validation"
    return [item for item in preregistration["sequences"] if item["role"] == role]


def validate_phase_unlock(
    *, phase: str, preregistration: dict[str, object], development_freeze: Path
) -> dict[str, object] | None:
    if phase == "development":
        return None
    if not development_freeze.is_file():
        raise ValueError("Validation remains sealed: development freeze is absent")
    freeze = json.loads(development_freeze.read_text(encoding="utf-8"))
    if freeze.get("status") != "development-frozen":
        raise ValueError("Validation remains sealed: development is not frozen")
    if freeze.get("validation_authorized") is not True:
        raise ValueError("Validation remains sealed: authorization is false")
    if freeze.get("protocol_sha256") != preregistration.get("protocol_sha256"):
        raise ValueError("Validation remains sealed: protocol hash changed")
    if freeze.get("parameter_search_performed") is not False:
        raise ValueError("Validation remains sealed: parameter search was recorded")
    return freeze


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("development", "validation"), required=True)
    parser.add_argument("--preregistration", type=Path, default=PREREGISTRATION)
    parser.add_argument("--development-freeze", type=Path, default=DEVELOPMENT_FREEZE)
    parser.add_argument("--output-root", type=Path, default=Path("/data/ipin2022"))
    args = parser.parse_args()

    preregistration = json.loads(args.preregistration.read_text(encoding="utf-8"))
    protocol_path = ROOT / str(preregistration["protocol"])
    if sha256_file(protocol_path) != preregistration["protocol_sha256"]:
        raise ValueError("IPIN protocol changed after preregistration")
    freeze = validate_phase_unlock(
        phase=args.phase,
        preregistration=preregistration,
        development_freeze=args.development_freeze,
    )
    selected = selected_sequences(preregistration, args.phase)
    if len(selected) != 2:
        raise ValueError(f"Expected exactly two {args.phase} members")

    artifact = preregistration["artifact"]
    remote = HttpRangeReader(
        ARCHIVE_URL,
        expected_size=int(artifact["archive_size_bytes"]),
        chunk_size=1024 * 1024,
    )
    extracted: list[dict[str, object]] = []
    with zipfile.ZipFile(remote) as archive:
        for sequence in selected:
            member = str(sequence["member"])
            path = PurePosixPath(member)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Unsafe preregistered member: {member}")
            info = archive.getinfo(member)
            expected = {
                "uncompressed_bytes": info.file_size,
                "compressed_bytes": info.compress_size,
                "crc32": f"{info.CRC:08x}",
            }
            for key, actual in expected.items():
                if sequence[key] != actual:
                    raise ValueError(f"Member metadata changed: {sequence['id']}/{key}")

            destination = args.output_root / str(sequence["id"])
            destination.mkdir(parents=True, exist_ok=True)
            target = destination / path.name
            digest = hashlib.sha256()
            with archive.open(info) as source, target.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
            member_result = {
                "id": sequence["id"],
                "role": sequence["role"],
                "user": sequence["user"],
                "trial": sequence["trial"],
                "archive_path": member,
                "output_name": path.name,
                **expected,
                "sha256": digest.hexdigest(),
            }
            extracted.append(member_result)
            write_manifest(
                destination / "artifact_manifest.json",
                {
                    "schema_version": 1,
                    "dataset": "IPIN 2022 Track 3",
                    "phase": args.phase,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "license": artifact["license"],
                    "preregistration": str(args.preregistration),
                    "protocol_sha256": preregistration["protocol_sha256"],
                    "development_freeze_sha256": (
                        sha256_file(args.development_freeze) if freeze is not None else None
                    ),
                    "archive": {
                        "requested_url": remote.metadata.requested_url,
                        "resolved_url": remote.metadata.resolved_url,
                        "size_bytes": remote.metadata.size_bytes,
                        "full_archive_downloaded": False,
                    },
                    "member": member_result,
                },
            )

    print(
        json.dumps(
            {
                "phase": args.phase,
                "sequence_count": len(extracted),
                "sequence_ids": [item["id"] for item in extracted],
                "http_range_requests": remote.request_count,
                "http_bytes_transferred": remote.bytes_transferred,
                "extracted_uncompressed_bytes": sum(
                    int(item["uncompressed_bytes"]) for item in extracted
                ),
                "full_archive_downloaded": False,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
