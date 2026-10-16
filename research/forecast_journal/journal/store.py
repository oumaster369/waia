"""Append-only JSONL journal. Restart-safe: ids already on disk are not rewritten."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterator

from research.forecast_journal.util import json_default

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None


class JournalStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.ids: set[str] = set()
        if self.path.exists():
            for record in iter_jsonl(self.path):
                if "id" in record:
                    self.ids.add(str(record["id"]))
        self._fh = self.path.open("a", encoding="utf-8")
        if fcntl is not None:
            fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX)

    def append(self, record: dict[str, Any]) -> bool:
        record_id = str(record["id"])
        if record_id in self.ids:
            return False
        self._fh.write(json.dumps(record, ensure_ascii=False, default=json_default) + "\n")
        self._fh.flush()
        os.fsync(self._fh.fileno())
        self.ids.add(record_id)
        return True

    def close(self) -> None:
        try:
            self._fh.close()
        except Exception:
            pass

    def __enter__(self) -> "JournalStore":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def iter_jsonl(path: Path) -> Iterator[dict]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text:
                continue
            try:
                yield json.loads(text)
            except json.JSONDecodeError:
                continue


def reality_id(forecast_id: str) -> str:
    return f"{forecast_id}:reality"
