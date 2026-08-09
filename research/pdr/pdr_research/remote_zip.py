"""Bounded HTTP-range access to one member group in a large public ZIP.

The reader prevents the public-data gate from turning into an implicit multi-GB
download. It is intentionally standard-library only and records transferred
bytes so the resulting artifact manifest can disclose the retrieval scope.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
from typing import Iterable
from urllib.request import Request, urlopen
import zipfile


DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024


@dataclass(frozen=True)
class RemoteArchiveMetadata:
    requested_url: str
    resolved_url: str
    size_bytes: int
    accept_ranges: str


@dataclass(frozen=True)
class ExtractedMember:
    archive_path: str
    output_name: str
    uncompressed_size_bytes: int
    compressed_size_bytes: int
    crc32: str
    sha256: str


class HttpRangeReader(io.RawIOBase):
    """Seekable read-only file facade backed by verified HTTP byte ranges."""

    def __init__(
        self,
        url: str,
        *,
        expected_size: int | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ):
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        request = Request(url, method="HEAD", headers={"Accept-Encoding": "identity"})
        with urlopen(request, timeout=60) as response:
            content_length = response.headers.get("Content-Length")
            accept_ranges = response.headers.get("Accept-Ranges", "")
            resolved_url = response.geturl()
        probe_requests = 0
        probe_bytes = 0
        if content_length is None or "bytes" not in accept_ranges.lower():
            probe = Request(
                resolved_url,
                headers={"Accept-Encoding": "identity", "Range": "bytes=0-0"},
            )
            with urlopen(probe, timeout=60) as response:
                status = getattr(response, "status", response.getcode())
                content_range = response.headers.get("Content-Range", "")
                payload = response.read()
                resolved_url = response.geturl()
            match = re.fullmatch(r"bytes 0-0/(\d+|\*)", content_range)
            if status != 206 or match is None or len(payload) != 1:
                raise ValueError(
                    "Remote archive did not prove bounded range support: "
                    f"status={status}, Content-Range={content_range!r}"
                )
            reported_size = match.group(1)
            if reported_size == "*":
                if expected_size is None:
                    raise ValueError(
                        "Range endpoint hid total size and no expected_size was supplied"
                    )
                content_length = str(expected_size)
            else:
                content_length = reported_size
            accept_ranges = "bytes (verified by 0-0 probe)"
            probe_requests = 1
            probe_bytes = 1
        self.metadata = RemoteArchiveMetadata(
            requested_url=url,
            resolved_url=resolved_url,
            size_bytes=int(content_length),
            accept_ranges=accept_ranges,
        )
        if expected_size is not None and int(content_length) != expected_size:
            raise ValueError(
                f"Remote archive size changed: {content_length} != {expected_size}"
            )
        self._position = 0
        self._chunk_size = chunk_size
        self._cache_start = 0
        self._cache = b""
        self.request_count = probe_requests
        self.bytes_transferred = probe_bytes

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            position = offset
        elif whence == io.SEEK_CUR:
            position = self._position + offset
        elif whence == io.SEEK_END:
            position = self.metadata.size_bytes + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if position < 0:
            raise ValueError("Cannot seek before the archive start")
        self._position = position
        return position

    def _fetch(self, start: int, minimum_size: int) -> None:
        end_exclusive = min(
            self.metadata.size_bytes,
            start + max(minimum_size, self._chunk_size),
        )
        if end_exclusive <= start:
            self._cache_start = start
            self._cache = b""
            return
        request = Request(
            self.metadata.resolved_url,
            headers={
                "Accept-Encoding": "identity",
                "Range": f"bytes={start}-{end_exclusive - 1}",
            },
        )
        with urlopen(request, timeout=120) as response:
            status = getattr(response, "status", response.getcode())
            content_range = response.headers.get("Content-Range", "")
            payload = response.read()
        expected_prefix = f"bytes {start}-{end_exclusive - 1}/"
        if status != 206 or not content_range.startswith(expected_prefix):
            raise ValueError(
                "Server did not honor the bounded range request: "
                f"status={status}, Content-Range={content_range!r}"
            )
        if len(payload) != end_exclusive - start:
            raise ValueError("Range response length did not match the requested interval")
        self._cache_start = start
        self._cache = payload
        self.request_count += 1
        self.bytes_transferred += len(payload)

    def read(self, size: int = -1) -> bytes:
        if self._position >= self.metadata.size_bytes:
            return b""
        if size is None or size < 0:
            size = self.metadata.size_bytes - self._position
        size = min(size, self.metadata.size_bytes - self._position)
        result = bytearray()
        while len(result) < size:
            cache_end = self._cache_start + len(self._cache)
            if not (self._cache_start <= self._position < cache_end):
                self._fetch(self._position, size - len(result))
                cache_end = self._cache_start + len(self._cache)
            cache_offset = self._position - self._cache_start
            available = min(size - len(result), cache_end - self._position)
            result.extend(self._cache[cache_offset : cache_offset + available])
            self._position += available
        return bytes(result)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_verified_small_file(url: str, expected_sha256: str) -> bytes:
    request = Request(url, headers={"Accept-Encoding": "identity"})
    with urlopen(request, timeout=60) as response:
        payload = response.read()
    actual = sha256_bytes(payload)
    if actual != expected_sha256:
        raise ValueError(
            f"Official metadata hash mismatch for {url}: {actual} != {expected_sha256}"
        )
    return payload


def sequence_members(names: Iterable[str]) -> dict[str, tuple[str, str]]:
    grouped: dict[str, dict[str, str]] = {}
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"Unsafe ZIP member path: {name}")
        if path.name not in {"data.hdf5", "info.json"}:
            continue
        sequence = str(path.parent)
        grouped.setdefault(sequence, {})[path.name] = name
    return {
        sequence: (members["data.hdf5"], members["info.json"])
        for sequence, members in grouped.items()
        if {"data.hdf5", "info.json"} <= set(members)
    }


def resolve_sequence(
    available: dict[str, tuple[str, str]], requested: str
) -> tuple[str, tuple[str, str]]:
    exact = available.get(requested)
    if exact is not None:
        return requested, exact
    by_basename = [
        (sequence, members)
        for sequence, members in available.items()
        if PurePosixPath(sequence).name == requested
    ]
    if len(by_basename) != 1:
        raise ValueError(
            f"Sequence {requested!r} matched {len(by_basename)} entries; use an exact path"
        )
    return by_basename[0]


def extract_members(
    archive: zipfile.ZipFile,
    members: tuple[str, str],
    output_directory: Path,
) -> tuple[ExtractedMember, ...]:
    output_directory.mkdir(parents=True, exist_ok=True)
    extracted: list[ExtractedMember] = []
    for member in members:
        info = archive.getinfo(member)
        output_name = PurePosixPath(member).name
        target = output_directory / output_name
        digest = hashlib.sha256()
        with archive.open(info) as source, target.open("wb") as destination:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                destination.write(chunk)
        extracted.append(
            ExtractedMember(
                archive_path=member,
                output_name=output_name,
                uncompressed_size_bytes=info.file_size,
                compressed_size_bytes=info.compress_size,
                crc32=f"{info.CRC:08x}",
                sha256=digest.hexdigest(),
            )
        )
    return tuple(extracted)


def write_manifest(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
