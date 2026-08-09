"""Range-fetch exactly one licensed RoNIN sequence; intended for Docker."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.remote_zip import (  # noqa: E402
    HttpRangeReader,
    extract_members,
    read_verified_small_file,
    resolve_sequence,
    sequence_members,
    write_manifest,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--artifact",
        type=Path,
        default=ROOT / "datasets" / "artifacts" / "ronin-unseen-test.json",
    )
    parser.add_argument("--sequence")
    parser.add_argument("--list-sequences", action="store_true")
    parser.add_argument("--output-root", type=Path, default=Path("/data/ronin"))
    args = parser.parse_args()
    if not args.list_sequences and not args.sequence:
        parser.error("--sequence is required unless --list-sequences is used")

    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    if artifact["terms"]["product_decision"] != "benchmark-only":
        raise ValueError("RoNIN public artifact must remain benchmark-only")
    read_verified_small_file(artifact["license_url"], artifact["license_sha256"])
    read_verified_small_file(artifact["readme_url"], artifact["readme_sha256"])

    remote = HttpRangeReader(
        artifact["archive_url"], expected_size=artifact["archive_size_bytes"]
    )
    if remote.metadata.size_bytes != artifact["archive_size_bytes"]:
        raise ValueError("Official archive size changed; refresh the artifact audit")
    with zipfile.ZipFile(remote) as archive:
        available = sequence_members(item.filename for item in archive.infolist())
        if args.list_sequences:
            for sequence in sorted(available):
                data_member, info_member = available[sequence]
                data = archive.getinfo(data_member)
                info = archive.getinfo(info_member)
                print(
                    json.dumps(
                        {
                            "sequence": sequence,
                            "data_hdf5_uncompressed_bytes": data.file_size,
                            "data_hdf5_compressed_bytes": data.compress_size,
                            "info_json_uncompressed_bytes": info.file_size,
                        },
                        sort_keys=True,
                    )
                )
            print(
                json.dumps(
                    {
                        "sequence_count": len(available),
                        "http_range_requests": remote.request_count,
                        "http_bytes_transferred": remote.bytes_transferred,
                    },
                    sort_keys=True,
                )
            )
            return

        sequence, members = resolve_sequence(available, args.sequence)
        destination_name = PurePosixPath(sequence).name
        destination = args.output_root / destination_name
        extracted = extract_members(archive, members, destination)

    manifest = {
        "schema_version": 1,
        "dataset": "RoNIN",
        "evidence_kind": "public-sequence-benchmark-only",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "sequence": sequence,
        "destination_name": destination_name,
        "artifact_spec": str(args.artifact),
        "official_record_url": artifact["official_record_url"],
        "archive": {
            "requested_url": remote.metadata.requested_url,
            "resolved_url": remote.metadata.resolved_url,
            "size_bytes": remote.metadata.size_bytes,
            "official_sha256": artifact["archive_sha256"],
            "hash_verification": artifact["archive_hash_verification"],
            "http_range_requests": remote.request_count,
            "http_bytes_transferred": remote.bytes_transferred,
        },
        "license": {
            "url": artifact["license_url"],
            "sha256": artifact["license_sha256"],
            **artifact["terms"],
        },
        "members": [asdict(member) for member in extracted],
    }
    manifest_path = destination / "artifact_manifest.json"
    write_manifest(manifest_path, manifest)
    print(
        json.dumps(
            {
                "sequence": sequence,
                "manifest": str(manifest_path),
                "http_range_requests": remote.request_count,
                "http_bytes_transferred": remote.bytes_transferred,
                "extracted_uncompressed_bytes": sum(
                    member.uncompressed_size_bytes for member in extracted
                ),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
