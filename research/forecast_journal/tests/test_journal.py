"""Append-only journal is idempotent and tolerates a torn line."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from research.forecast_journal.journal.store import JournalStore, iter_jsonl


class JournalTests(unittest.TestCase):
    def test_duplicate_id_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "journal.jsonl"
            with JournalStore(path) as store:
                self.assertTrue(store.append({"id": "a", "record_type": "forecast", "ts": 1}))
                self.assertFalse(store.append({"id": "a", "record_type": "forecast", "ts": 1}))
            with JournalStore(path) as store:
                self.assertFalse(store.append({"id": "a", "record_type": "forecast", "ts": 2}))
                self.assertTrue(store.append({"id": "b", "record_type": "reality", "ts": 2}))
            rows = list(iter_jsonl(path))
            self.assertEqual([row["id"] for row in rows], ["a", "b"])

    def test_broken_line_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "journal.jsonl"
            path.write_text('{"id": "a"}\nnot-json\n{"id": "b"}\n', encoding="utf-8")
            self.assertEqual([row["id"] for row in iter_jsonl(path)], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
