"""Fetch bounded official evidence for the PDR evidence-unblocker v2 audit.

The script opens no raw sensor-log member and downloads no model weights or full
dataset archive. ZIP central directories and explicitly allowed README/parser or
aggregate metadata members are read with verified HTTP Range requests.
"""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pdr_research.remote_zip import HttpRangeReader


USER_AGENT = "personal-exploration-map-pdr-research/2"
MAX_METADATA_BYTES = 3 * 1024 * 1024

IPIN = (
    {
        "id": "ipin-2022-t3",
        "record": "7612915",
        "archive_size": 444265064,
        "year": "2022",
        "readme": "2022_IPIN_Competition_Track03/ZZ_README.txt",
        "parser": (
            "2022_IPIN_Competition_Track03/02 Supplementary Files/"
            "02 - Files for MatLab Tools/parser/ReadLogFile2022.m"
        ),
    },
    {
        "id": "ipin-2023-t3",
        "candidate_id": "ipin-2023-2024-t3",
        "record": "8362205",
        "archive_size": 99458898,
        "year": "2023",
        "readme": "2023_IPIN_Competition_Track03/ZZ_README.txt",
        "parser": (
            "2023_IPIN_Competition_Track03/02 Supplementary Materials/"
            "03 - Files for Matlab Tools/Parser/ReadLogFile2022.m"
        ),
    },
    {
        "id": "ipin-2024-t3",
        "candidate_id": "ipin-2023-2024-t3",
        "record": "13931119",
        "archive_size": 95126038,
        "year": "2024",
        "readme": "2024_IPIN_Competition_Track03/ZZ_README.txt",
        "parser": (
            "2024_IPIN_Competition_Track03/02 Supplementary Materials/"
            "03 - Files for Matlab Tools/Parser/ReadLogFile2022.m"
        ),
    },
)

REPOSITORIES = (
    {
        "id": "wang-sle",
        "owner": "Archeries",
        "repo": "StrideLengthEstimation",
        "commit": "c96f67c79a81a8f2098eee051dd41c0c1ba1d102",
    },
    {
        "id": "wang-wde",
        "owner": "wq1989",
        "repo": "WalkingDistanceEstimation",
        "commit": "634ac708a71aeae30d41814546f85ebfc71e1411",
    },
)


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.suppressed = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self.suppressed += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self.suppressed = max(0, self.suppressed - 1)

    def handle_data(self, data: str) -> None:
        if not self.suppressed:
            value = " ".join(data.split())
            if value:
                self.parts.append(value)


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return sha256_bytes(payload)


def fetch_bounded(
    url: str, *, maximum_bytes: int = MAX_METADATA_BYTES, allow_404: bool = False
) -> tuple[int, bytes, str, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    try:
        with urlopen(request, timeout=60) as response:
            status = getattr(response, "status", response.getcode())
            resolved = response.geturl()
            content_type = response.headers.get_content_type()
            payload = response.read(maximum_bytes + 1)
    except HTTPError as error:
        if not allow_404 or error.code != 404:
            raise
        return error.code, b"", url, ""
    if len(payload) > maximum_bytes:
        raise ValueError(f"Bounded metadata fetch exceeded {maximum_bytes}: {url}")
    return status, payload, resolved, content_type


def visible_html(payload: bytes) -> str:
    parser = VisibleTextParser()
    parser.feed(payload.decode("utf-8", errors="replace"))
    return normalize(" ".join(parser.parts))


def ipin_source(config: dict[str, object]) -> dict[str, object]:
    record = str(config["record"])
    status, api_bytes, api_url, _ = fetch_bounded(
        f"https://zenodo.org/api/records/{record}", maximum_bytes=512 * 1024
    )
    if status != 200:
        raise ValueError(f"Zenodo API failed for {record}: {status}")
    api = json.loads(api_bytes.decode("utf-8"))
    files = api.get("files", [])
    if len(files) != 1:
        raise ValueError(f"Expected one IPIN archive for {record}")
    archive = files[0]
    if archive["size"] != config["archive_size"]:
        raise ValueError(f"IPIN archive size changed for {record}")

    reader = HttpRangeReader(
        archive["links"]["self"],
        expected_size=int(config["archive_size"]),
        chunk_size=64 * 1024,
    )
    with zipfile.ZipFile(reader) as zipped:
        infos = zipped.infolist()
        readme = zipped.read(str(config["readme"]))
        parser = zipped.read(str(config["parser"]))

    year = str(config["year"])
    training = [
        info
        for info in infos
        if "TrainingTrial" in info.filename and info.filename.endswith(".txt")
    ]
    validation = [
        info
        for info in infos
        if any(marker in info.filename for marker in ("TestingTrial", "Validation"))
        and info.filename.endswith(".txt")
    ]
    ground_truth = [
        info
        for info in infos
        if "/03 Evaluation/GT/" in info.filename and info.filename.endswith(".csv")
    ]
    normalized_training = [
        {
            "path": info.filename.replace(year, "YEAR"),
            "size": info.file_size,
            "crc32": f"{info.CRC:08x}",
        }
        for info in sorted(training, key=lambda item: item.filename)
    ]
    parser_text = normalize(parser.decode("utf-8", errors="replace"))
    user_ids = sorted(
        set(re.findall(r"_User(\d+)", " ".join(info.filename for info in training)))
    )
    analysis = {
        "record_id": api.get("id"),
        "title": api.get("metadata", {}).get("title"),
        "license_id": api.get("metadata", {}).get("license", {}).get("id"),
        "access_right": api.get("metadata", {}).get("access_right"),
        "archive_name": archive.get("key"),
        "archive_size": archive.get("size"),
        "archive_checksum": archive.get("checksum"),
        "archive_member_count": len(infos),
        "training_log_count": len(training),
        "validation_log_count": len(validation),
        "training_user_ids_from_paths": user_ids,
        "readme_sha256": sha256_bytes(readme),
        "parser_sha256": sha256_bytes(parser),
        "training_index_sha256": canonical_hash(normalized_training),
        "ground_truth_files": [
            {
                "path": info.filename,
                "size": info.file_size,
                "crc32": f"{info.CRC:08x}",
            }
            for info in ground_truth
        ],
        "claim_checks": {
            "license_is_cc_by_4": api.get("metadata", {}).get("license", {}).get("id")
            == "cc-by-4.0",
            "access_is_open": api.get("metadata", {}).get("access_right") == "open",
            "android_app_parser": "android app" in parser_text,
            "raw_accelerometer_schema": "acce;apptimestamp(s);sensortimestamp(s);acc_x(m/s^2)"
            in parser_text,
            "raw_gyroscope_schema": "gyro;apptimestamp(s);sensortimestamp(s);gyr_x(rad/s)"
            in parser_text,
            "raw_magnetometer_schema": "magn;apptimestamp(s);sensortimestamp(s);mag_x(ut)"
            in parser_text,
            "sensor_timestamp_preferred": "better for integrating inertial data"
            in parser_text,
            "platform_ahrs_present": "ahrs;apptimestamp(s);sensortimestamp(s)" in parser_text,
            "position_reference_present": "posi reference" in parser_text,
            "ground_truth_is_sparse": sum(info.file_size for info in ground_truth) < 20_000,
            "raw_sensor_member_opened": False,
        },
    }
    return {
        "id": str(config["id"]),
        "candidate_id": str(config.get("candidate_id", config["id"])),
        "urls": [api_url, reader.metadata.resolved_url],
        "metadata_bytes_transferred": len(api_bytes) + reader.bytes_transferred,
        "analysis": analysis,
        "evidence_sha256": canonical_hash(analysis),
    }


def repository_source(config: dict[str, str]) -> dict[str, object]:
    owner, repo, commit = config["owner"], config["repo"], config["commit"]
    raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}/{commit}"
    status, readme, readme_url, _ = fetch_bounded(
        f"{raw_base}/README.md", maximum_bytes=256 * 1024
    )
    if status != 200:
        raise ValueError(f"README fetch failed: {owner}/{repo}")
    license_statuses: dict[str, int] = {}
    transferred = len(readme)
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"):
        license_status, license_bytes, _, _ = fetch_bounded(
            f"{raw_base}/{name}", maximum_bytes=128 * 1024, allow_404=True
        )
        license_statuses[name] = license_status
        transferred += len(license_bytes)
    tree_status, tree_bytes, tree_url, _ = fetch_bounded(
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{commit}?recursive=1",
        maximum_bytes=2 * 1024 * 1024,
    )
    if tree_status != 200:
        raise ValueError(f"Tree fetch failed: {owner}/{repo}")
    transferred += len(tree_bytes)
    tree = json.loads(tree_bytes.decode("utf-8"))
    paths = [item.get("path", "") for item in tree.get("tree", [])]
    text = normalize(readme.decode("utf-8", errors="replace"))
    if config["id"] == "wang-sle":
        checks = {
            "android_dataset": "dataset created by android smartphone" in text,
            "rate_100_hz": "sampled at 100 hz" in text,
            "raw_imu9_units": all(
                marker in text for marker in ("acc_x(m/s^2)", "gyr_x(rad/s)", "mag_x(ut)")
            ),
            "per_stride_truth": "stride-length(m)" in text and "stride number" in text,
            "foot_imu_label_source": "x-imu" in text and "right foot" in text,
            "single_phone_placement": "hand in front of their chest" in text,
            "subject_ids_explicit_in_readme": bool(re.search(r"subject[_ -]?id", text)),
            "artifact_license_present": any(status == 200 for status in license_statuses.values()),
        }
    else:
        checks = {
            "huawei_mate_9_phone": "huawei mate 9 smartphone" in text,
            "rate_100_hz": "sampling rate of 100 hz" in text,
            "raw_accelerometer_gyroscope": "tri-axial linear acceleration" in text
            and "angular velocity" in text,
            "per_stride_truth": "corresponding stride number" in text
            and "stride-length" in text,
            "foot_imu_label_source": "ngimu" in text and "right foot" in text,
            "five_phone_modes": all(
                marker in text
                for marker in ("handheld", "armhand", "pocket", "calling", "swing")
            ),
            "subject_ids_explicit_in_readme": bool(re.search(r"subject[_ -]?id", text)),
            "artifact_license_present": any(status == 200 for status in license_statuses.values()),
        }
    analysis = {
        "repository": f"{owner}/{repo}",
        "commit": commit,
        "readme_sha256": sha256_bytes(readme),
        "tree_sha": tree.get("sha"),
        "tree_entry_count": len(paths),
        "license_statuses": license_statuses,
        "license_like_paths": [
            path
            for path in paths
            if re.search(r"(^|/)(license|copying)(\.|$)", path, flags=re.IGNORECASE)
        ],
        "claim_checks": checks,
    }
    return {
        "id": config["id"],
        "candidate_id": config["id"],
        "urls": [readme_url, tree_url],
        "metadata_bytes_transferred": transferred,
        "analysis": analysis,
        "evidence_sha256": canonical_hash(analysis),
    }


def xdr_source() -> dict[str, object]:
    url = "https://unit.aist.go.jp/rihsa/xDR-Challenge-2023/"
    status, payload, resolved, _ = fetch_bounded(url)
    if status != 200:
        raise ValueError(f"xDR page failed: {status}")
    visible = visible_html(payload)
    checks = {
        "android_collection": "we measured pedestrian movement by using android devices" in visible,
        "raw_accelerometer": "acceleration aquos sense 6 approx. 100 hz yes yes" in visible,
        "raw_gyroscope": "angular velocity aquos sense 6 approx. 100 hz yes yes" in visible,
        "raw_magnetometer": "magnetism aquos sense 6 approx. 100 hz yes yes" in visible,
        "lidar_position_truth_100_hz": "ground truth location (x, y, z) zeb-horizon approx. 100 hz" in visible,
        "lidar_orientation_truth_100_hz": "ground truth orientation (quaternion) zeb-horizon approx. 100 hz" in visible,
        "registration_required": "id and password are provided after pre-registration" in visible,
        "dataset_license_present": bool(re.search(r"\b(?:license|licence)\b", visible)),
        "commercial_ml_training_explicit": "commercial machine learning" in visible,
        "derived_weight_rights_explicit": "derived weight" in visible,
    }
    analysis = {
        "visible_text_length": len(visible),
        "claim_checks": checks,
    }
    return {
        "id": "xdr-2023",
        "candidate_id": "xdr-2023",
        "urls": [resolved],
        "metadata_bytes_transferred": len(payload),
        "analysis": analysis,
        "evidence_sha256": canonical_hash(analysis),
    }


def forestback_source() -> dict[str, object]:
    owner, repo = "Aueaphum2541", "ForestBack-Dataset"
    commit = "02924917f21ea218d464649494197058d6d51cbe"
    tree_status, tree_bytes, tree_url, _ = fetch_bounded(
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{commit}?recursive=1",
        maximum_bytes=512 * 1024,
    )
    if tree_status != 200:
        raise ValueError("ForestBack tree fetch failed")
    tree = json.loads(tree_bytes.decode("utf-8"))
    paths = [item.get("path", "") for item in tree.get("tree", [])]
    raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}/{commit}"
    statuses: dict[str, int] = {}
    for name in ("README.md", "LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"):
        status, _, _, _ = fetch_bounded(
            f"{raw_base}/{name}", maximum_bytes=128 * 1024, allow_404=True
        )
        statuses[name] = status
    archive_url = f"{raw_base}/Dataset.zip"
    reader = HttpRangeReader(archive_url, expected_size=11245952, chunk_size=64 * 1024)
    with zipfile.ZipFile(reader) as zipped:
        members = [
            {
                "path": info.filename,
                "size": info.file_size,
                "compressed_size": info.compress_size,
                "crc32": f"{info.CRC:08x}",
            }
            for info in zipped.infolist()
        ]
    atom_status, atom_bytes, atom_url, _ = fetch_bounded(
        "https://export.arxiv.org/api/query?id_list=2606.14421",
        maximum_bytes=512 * 1024,
    )
    if atom_status != 200:
        raise ValueError("ForestBack arXiv metadata fetch failed")
    atom_text = normalize(atom_bytes.decode("utf-8", errors="replace"))
    checks = {
        "paper_claims_36_trials": "36 walking trials" in atom_text,
        "paper_claims_42474_samples": "42,474 time-series samples" in atom_text,
        "paper_claims_dataset_and_notebook": "released dataset and analysis notebook" in atom_text,
        "repository_has_readme": statuses["README.md"] == 200,
        "repository_has_license": any(
            statuses[name] == 200 for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING")
        ),
        "archive_has_notebook": any(item["path"].endswith(".ipynb") for item in members),
        "archive_has_raw_and_summary_csv": {
            item["path"] for item in members if item["path"].endswith(".csv")
        }
        == {
            "Dataset/forestback_indoor_pdr_dataset.csv",
            "Dataset/forestback_indoor_pdr_summary.csv",
        },
        "raw_sensor_member_opened": False,
    }
    analysis = {
        "repository": f"{owner}/{repo}",
        "commit": commit,
        "tree_entry_count": len(paths),
        "repository_paths": paths,
        "metadata_file_statuses": statuses,
        "archive_size": reader.metadata.size_bytes,
        "archive_members": members,
        "claim_checks": checks,
    }
    return {
        "id": "forestback",
        "candidate_id": "forestback",
        "urls": [tree_url, reader.metadata.resolved_url, atom_url],
        "metadata_bytes_transferred": len(tree_bytes) + reader.bytes_transferred + len(atom_bytes),
        "analysis": analysis,
        "evidence_sha256": canonical_hash(analysis),
    }


def el_sle_source() -> dict[str, object]:
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9501393/fullTextXML"
    status, payload, resolved, _ = fetch_bounded(url)
    if status != 200:
        raise ValueError(f"EL-SLE XML failed: {status}")
    root = ET.fromstring(payload)
    full_text = normalize(" ".join(root.itertext()))
    titles = [normalize(" ".join(title.itertext())) for title in root.findall(".//sec/title")]
    external_links = [
        link.attrib.get("{http://www.w3.org/1999/xlink}href", "")
        for link in root.findall(".//ext-link")
    ]
    dataset_links = [
        link
        for link in external_links
        if any(marker in link.lower() for marker in ("github", "zenodo", "figshare", "mendeley", "dryad"))
    ]
    checks = {
        "five_android_smartphones": "we used five android smartphones" in full_text,
        "distance_31_5_km": "31.5 km" in full_text,
        "duration_8_1_h": "8.1 h" in full_text,
        "vio_label_collection": any(
            "vision-aided training data collection" in title for title in titles
        )
        and "visual-inertial odometry" in full_text,
        "data_availability_section_present": any("data availability" in title for title in titles),
        "supplementary_material_present": bool(root.findall(".//supplementary-material")),
        "public_dataset_link_present": bool(dataset_links),
    }
    analysis = {
        "article": "PMC9501393",
        "section_titles": titles,
        "supplementary_material_count": len(root.findall(".//supplementary-material")),
        "dataset_external_links": dataset_links,
        "claim_checks": checks,
    }
    return {
        "id": "el-sle",
        "candidate_id": "el-sle",
        "urls": [resolved],
        "metadata_bytes_transferred": len(payload),
        "analysis": analysis,
        "evidence_sha256": canonical_hash(analysis),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    sources = [ipin_source(config) for config in IPIN]
    sources.append(xdr_source())
    sources.extend(repository_source(config) for config in REPOSITORIES)
    sources.append(forestback_source())
    sources.append(el_sle_source())

    by_id = {source["id"]: source for source in sources}
    duplicate = (
        by_id["ipin-2023-t3"]["analysis"]["training_log_count"]
        == by_id["ipin-2024-t3"]["analysis"]["training_log_count"]
        == 54
        and by_id["ipin-2023-t3"]["analysis"]["training_index_sha256"]
        == by_id["ipin-2024-t3"]["analysis"]["training_index_sha256"]
    )
    total_bytes = sum(int(source["metadata_bytes_transferred"]) for source in sources)
    snapshot = {
        "schema_version": 1,
        "audit": "pdr-evidence-unblocker-v2-source-snapshot",
        "audited_on": "2026-08-09",
        "source_count": len(sources),
        "raw_sensor_rows_downloaded": 0,
        "model_weights_downloaded": 0,
        "full_dataset_archives_downloaded": 0,
        "metadata_bytes_transferred": total_bytes,
        "sources": sources,
        "cross_source_checks": {
            "ipin_2023_2024_training_members_byte_identical": duplicate,
            "ipin_2023_training_count": by_id["ipin-2023-t3"]["analysis"]["training_log_count"],
            "ipin_2024_training_count": by_id["ipin-2024-t3"]["analysis"]["training_log_count"],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "source_count": len(sources),
                "metadata_bytes_transferred": total_bytes,
                "raw_sensor_rows_downloaded": 0,
                "model_weights_downloaded": 0,
                "full_dataset_archives_downloaded": 0,
                "ipin_2023_2024_duplicate": duplicate,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
