"""Fetch bounded official metadata for the learned PDR training-data gate.

This script intentionally downloads no sensor rows, archives, or model weights.
It records byte hashes and machine-checkable claims for official metadata pages
whose contents establish (or fail to establish) Android semantics, target
fitness, split keys, and artifact-specific rights.
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import urllib.request


MAX_SOURCE_BYTES = 3 * 1024 * 1024
USER_AGENT = "personal-exploration-map-pdr-research/1"


SOURCES = (
    {
        "id": "idol-zenodo-api",
        "kind": "json",
        "url": "https://zenodo.org/api/records/4484093",
        "maximum_bytes": 512 * 1024,
    },
    {
        "id": "advio-zenodo-api",
        "kind": "json",
        "url": "https://zenodo.org/api/records/1476931",
        "maximum_bytes": 512 * 1024,
    },
    {
        "id": "dryad-walking-api",
        "kind": "json",
        "url": (
            "https://datadryad.org/api/v2/datasets/"
            "doi%3A10.5061%2Fdryad.n2z34tn5q"
        ),
        "maximum_bytes": 512 * 1024,
    },
    {
        "id": "fda-wearables-page",
        "kind": "html",
        "url": (
            "https://cdrh-rst.fda.gov/open-access-wearables-dataset-"
            "evaluate-factors-impacting-accuracy-smartphone-gait-metrics"
        ),
        "maximum_bytes": 1024 * 1024,
    },
    {
        "id": "fda-synapse-access-wiki",
        "kind": "json",
        "url": (
            "https://repo-prod.prod.sagebase.org/repo/v1/entity/"
            "syn51664250/wiki/623160"
        ),
        "maximum_bytes": 512 * 1024,
    },
    {
        "id": "rudacop-official-page",
        "kind": "html",
        "url": "http://gartseev.ru/projects/ipin2019",
        "maximum_bytes": MAX_SOURCE_BYTES,
    },
    {
        "id": "ridi-official-page",
        "kind": "html",
        "url": "https://yanhangpublic.github.io/ridi/index.html",
        "maximum_bytes": 1024 * 1024,
    },
    {
        "id": "oxiod-official-page",
        "kind": "html",
        "url": "http://deepio.cs.ox.ac.uk/",
        "maximum_bytes": 1024 * 1024,
    },
)


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._suppressed_depth = 0
        self.text_parts: list[str] = []
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._suppressed_depth += 1
        if tag.lower() == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._suppressed_depth = max(0, self._suppressed_depth - 1)

    def handle_data(self, data: str) -> None:
        if not self._suppressed_depth:
            stripped = " ".join(data.split())
            if stripped:
                self.text_parts.append(stripped)


def fetch_bounded(url: str, maximum_bytes: int) -> tuple[bytes, str, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        resolved_url = response.geturl()
        content_type = response.headers.get_content_type()
        chunks: list[bytes] = []
        total = 0
        while chunk := response.read(64 * 1024):
            total += len(chunk)
            if total > maximum_bytes:
                raise ValueError(f"{url} exceeds bounded fetch: {total} bytes")
            chunks.append(chunk)
    return b"".join(chunks), resolved_url, content_type


def json_path(value: object, *parts: str) -> object:
    current = value
    for part in parts:
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def analyze_json(source_id: str, content: bytes) -> dict[str, object]:
    payload = json.loads(content.decode("utf-8"))
    if source_id == "idol-zenodo-api":
        return {
            "record_id": payload.get("id"),
            "version": json_path(payload, "metadata", "version"),
            "license_id": json_path(payload, "metadata", "license", "id"),
            "access_right": json_path(payload, "metadata", "access_right"),
            "file_count": len(payload.get("files", [])),
            "claim_checks": {
                "record_is_idol": "IDOL" in str(json_path(payload, "metadata", "title")),
                "license_is_cc_by_4": json_path(payload, "metadata", "license", "id")
                == "cc-by-4.0",
                "access_is_open": json_path(payload, "metadata", "access_right") == "open",
            },
        }
    if source_id == "advio-zenodo-api":
        return {
            "record_id": payload.get("id"),
            "version": json_path(payload, "metadata", "version"),
            "license_id": json_path(payload, "metadata", "license", "id"),
            "access_right": json_path(payload, "metadata", "access_right"),
            "file_count": len(payload.get("files", [])),
            "claim_checks": {
                "record_is_advio": "ADVIO" in str(json_path(payload, "metadata", "title")),
                "license_is_cc_by_nc_4": json_path(payload, "metadata", "license", "id")
                == "cc-by-nc-4.0",
                "access_is_open": json_path(payload, "metadata", "access_right") == "open",
            },
        }
    if source_id == "dryad-walking-api":
        license_value = str(payload.get("license", ""))
        return {
            "identifier": payload.get("identifier"),
            "version_number": payload.get("versionNumber"),
            "publication_date": payload.get("publicationDate"),
            "license": license_value,
            "status": payload.get("status"),
            "storage_size": payload.get("storageSize"),
            "claim_checks": {
                "record_is_walking_dataset": "walking activity"
                in str(payload.get("title", "")).lower(),
                "license_is_cc0": "CC0-1.0" in license_value,
                "version_is_six": payload.get("versionNumber") == 6,
            },
        }
    if source_id == "fda-synapse-access-wiki":
        markdown = normalize_text(str(payload.get("markdown", "")))
        return {
            "wiki_id": payload.get("id"),
            "etag": payload.get("etag"),
            "markdown_length": len(markdown),
            "claim_checks": {
                "research_development_or_education_scope": (
                    "research & development" in markdown
                    and "educational purposes" in markdown
                ),
                "redistribution_prohibited": "may not be redistributed" in markdown,
                "synapse_account_required": "synapse account" in markdown,
                "commercial_ml_training_explicit": (
                    "commercial machine learning" in markdown
                    or "commercial ml" in markdown
                ),
                "derived_weight_rights_explicit": "derived weight" in markdown,
            },
        }
    raise ValueError(f"Unknown JSON source: {source_id}")


def analyze_html(source_id: str, content: bytes) -> dict[str, object]:
    parser = VisibleTextParser()
    parser.feed(content.decode("utf-8", errors="replace"))
    visible = normalize_text(" ".join(parser.text_parts))
    license_terms = re.findall(r"\b(?:licen[cs]e|terms of use)\b", visible)
    download_links = sorted(
        {
            link
            for link in parser.links
            if any(marker in link.lower() for marker in ("download", "drive.google", "box.com"))
        }
    )
    if source_id == "fda-wearables-page":
        checks = {
            "android_samsung_s22": "samsung galaxy s22" in visible,
            "iphone_10": "iphone 10" in visible,
            "uncalibrated_phone_imu": "uncalibrated data" in visible,
            "rate_100_hz": "100 hz" in visible,
            "participants_20": "20 healthy participants" in visible,
            "placements_limited": "lower back and right thigh" in visible,
            "straight_and_curved": "straight-line and curved trajectories" in visible,
            "continuous_2d_truth_claimed": "continuous 2d" in visible,
        }
    elif source_id == "rudacop-official-page":
        checks = {
            "dataset_named": "rudacop dataset" in visible,
            "download_freely_claimed": "downloaded freely" in visible,
            "email_purpose_required": "purpose explanation" in visible,
            "dataset_license_present": bool(license_terms),
            "commercial_ml_training_explicit": "commercial machine learning" in visible,
            "derived_weight_rights_explicit": "derived weight" in visible,
        }
    elif source_id == "ridi-official-page":
        checks = {
            "dataset_named": "robust imu double integration" in visible,
            "data_download_present": "download here" in visible,
            "dataset_license_present": bool(license_terms),
            "commercial_ml_training_explicit": "commercial machine learning" in visible,
            "derived_weight_rights_explicit": "derived weight" in visible,
        }
    elif source_id == "oxiod-official-page":
        checks = {
            "dataset_named": "oxford inertial odometry dataset" in visible,
            "dataset_download_present": "dataset (1.01g)" in visible,
            "dataset_license_present": bool(license_terms),
            "commercial_ml_training_explicit": "commercial machine learning" in visible,
            "derived_weight_rights_explicit": "derived weight" in visible,
        }
    else:
        raise ValueError(f"Unknown HTML source: {source_id}")
    return {
        "visible_text_length": len(visible),
        "visible_license_term_count": len(license_terms),
        "download_links": download_links,
        "claim_checks": checks,
    }


def evidence_digest(source_id: str, analysis: dict[str, object]) -> str:
    """Hash stable extracted evidence, excluding dynamic page scaffolding."""

    if source_id in {
        "fda-wearables-page",
        "rudacop-official-page",
        "ridi-official-page",
        "oxiod-official-page",
    }:
        evidence = {
            "claim_checks": analysis["claim_checks"],
            "download_links": analysis["download_links"],
        }
    else:
        evidence = analysis
    canonical = json.dumps(
        evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    snapshots = []
    for source in SOURCES:
        content, resolved_url, content_type = fetch_bounded(
            source["url"], int(source["maximum_bytes"])
        )
        analysis = (
            analyze_json(source["id"], content)
            if source["kind"] == "json"
            else analyze_html(source["id"], content)
        )
        snapshots.append(
            {
                "id": source["id"],
                "kind": source["kind"],
                "requested_url": source["url"],
                "resolved_url": resolved_url,
                "content_type": content_type,
                "download_bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
                "evidence_sha256": evidence_digest(source["id"], analysis),
                "analysis": analysis,
            }
        )

    payload = {
        "schema_version": 1,
        "audit": "learned-pdr-training-data-source-snapshot-v1",
        "artifact_download_policy": "bounded official metadata only; zero sensor rows",
        "source_count": len(snapshots),
        "raw_sensor_rows_downloaded": 0,
        "sources": snapshots,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "source_count": len(snapshots),
                "download_bytes": sum(item["download_bytes"] for item in snapshots),
                "raw_sensor_rows_downloaded": 0,
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
