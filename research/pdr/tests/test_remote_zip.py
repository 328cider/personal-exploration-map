from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.remote_zip import resolve_sequence, sequence_members  # noqa: E402


class RemoteZipTests(unittest.TestCase):
    def test_sequence_members_require_data_and_info(self) -> None:
        members = sequence_members(
            (
                "unseen/a001_1/data.hdf5",
                "unseen/a001_1/info.json",
                "unseen/a002_1/data.hdf5",
                "README.txt",
            )
        )
        self.assertEqual(
            members,
            {
                "unseen/a001_1": (
                    "unseen/a001_1/data.hdf5",
                    "unseen/a001_1/info.json",
                )
            },
        )

    def test_sequence_member_paths_reject_traversal(self) -> None:
        with self.assertRaises(ValueError):
            sequence_members(("../escape/data.hdf5", "../escape/info.json"))

    def test_resolve_sequence_accepts_unique_basename(self) -> None:
        available = {
            "unseen/a001_1": (
                "unseen/a001_1/data.hdf5",
                "unseen/a001_1/info.json",
            )
        }
        sequence, members = resolve_sequence(available, "a001_1")
        self.assertEqual(sequence, "unseen/a001_1")
        self.assertEqual(members, available[sequence])


if __name__ == "__main__":
    unittest.main()
