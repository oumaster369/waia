"""Журнал и лента непрочитанных событий. Формат строки как у fexec."""

from __future__ import annotations

import json
import os
import re
import urllib.request
from pathlib import Path

from .timeutil import Clock

_SECRET = re.compile(r"(AccessKeyId|Signature|API_KEY|API_SECRET)=([^&\s]+)")


def sanitize(text: str) -> str:
    return _SECRET.sub(r"\1=***", text)[:500]


def emit(
    kind: str,
    *,
    journal_path: Path,
    events_path: Path,
    clock: Clock | None = None,
    webhook_url: str | None = None,
    echo: bool = True,
    **fields,
) -> dict:
    moment = (clock or Clock()).now()
    row = {
        "ts": moment.isoformat(timespec="seconds"),
        "market": "futures",
        "kind": kind,
        **fields,
    }
    line = json.dumps(row, ensure_ascii=False, default=str) + "\n"
    for path in (journal_path, events_path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line)
    if echo:
        print(json.dumps(row, ensure_ascii=False, default=str))
    if webhook_url:
        _webhook(webhook_url, row)
    return row


def _webhook(url: str, row: dict) -> None:
    try:
        data = json.dumps(row, ensure_ascii=False, default=str).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "committee-autoexec"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception as exc:
        print(json.dumps({"kind": "webhook_error", "error": sanitize(str(exc))}, ensure_ascii=False))


def webhook_from_env() -> str | None:
    url = os.environ.get("AUTOEXEC_WEBHOOK_URL") or ""
    return url or None
