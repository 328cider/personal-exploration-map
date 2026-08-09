"""Extract metadata-only RoNIN HDF5 inventory; intended to run in Docker."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics

import h5py


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--sequence")
    args = parser.parse_args()

    datasets: dict[str, dict[str, object]] = {}
    with h5py.File(args.input, "r") as handle:
        def record(name, item):
            if not isinstance(item, h5py.Dataset):
                return
            metadata: dict[str, object] = {
                "shape": list(item.shape),
                "dtype": str(item.dtype),
            }
            if name == "synced/time" and item.shape and item.shape[0] > 1:
                timestamps = item[:]
                positive_deltas = [
                    float(right - left)
                    for left, right in zip(timestamps, timestamps[1:])
                    if right > left
                ]
                metadata.update(
                    {
                        "start_time_s": float(timestamps[0]),
                        "end_time_s": float(timestamps[-1]),
                        "duplicate_timestamp_count": int(
                            sum(right == left for left, right in zip(timestamps, timestamps[1:]))
                        ),
                        "non_monotonic_timestamp_count": int(
                            sum(right < left for left, right in zip(timestamps, timestamps[1:]))
                        ),
                        "estimated_rate_hz": 1.0 / statistics.median(positive_deltas)
                        if positive_deltas
                        else None,
                    }
                )
            datasets[name] = metadata

        handle.visititems(record)

    payload = {
        "schema_version": 1,
        "sequence": args.sequence or args.input.parent.name,
        "source_file": args.input.name,
        "datasets": datasets,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
