"""Venue status classification. Geo blocks are unavailable, not stale."""

from __future__ import annotations

GEO_MARKERS = (
    "restricted location",
    "restricted area",
    "restricted region",
    "unavailable in your",
    "not available in your",
    "service unavailable from",
    "eligibility",
    "geo-block",
    "geoblock",
    "cloudfront",
)

# Public labels, same order as the /book toolbar.
VENUE_ORDER = (
    "binance_perp",
    "bybit_perp",
    "okx_perp",
    "htx_perp",
    "bitget_perp",
    "gate_perp",
    "binance_spot",
    "coinbase_spot",
    "okx_spot",
    "bybit_spot",
)

VENUE_LABELS = {
    "binance_perp": "Binance perp",
    "bybit_perp": "Bybit perp",
    "okx_perp": "OKX perp",
    "htx_perp": "HTX",
    "bitget_perp": "Bitget",
    "gate_perp": "Gate",
    "binance_spot": "Binance spot",
    "coinbase_spot": "Coinbase",
    "okx_spot": "OKX spot",
    "bybit_spot": "Bybit spot",
}


class GeoBlocked(Exception):
    pass


class RateLimited(Exception):
    pass


def classify_http(status: int, body: str = "") -> str:
    """Map an HTTP failure to unavailable / rate_limited / error / ok."""
    text = (body or "").lower()
    if status == 451 or (status == 403 and any(m in text for m in GEO_MARKERS)):
        return "unavailable"
    if status == 403 and "restricted" in text:
        return "unavailable"
    if status == 429 or "too many requests" in text or "rate limit" in text:
        return "rate_limited"
    if status >= 400:
        return "error"
    return "ok"


def classify_handshake(status: int) -> str:
    """A public market websocket should not 401/403/451 except for geo or WAF."""
    if status in (401, 403, 451):
        return "unavailable"
    if status == 429:
        return "rate_limited"
    return "error"


def health_line(rows: list[dict]) -> str:
    """One readable status fragment per venue, in toolbar order."""
    by_id = {r["venue"]: r for r in rows}
    parts: list[str] = []
    for vid in VENUE_ORDER:
        row = by_id.get(vid)
        if row is None:
            continue
        label = VENUE_LABELS.get(vid, vid)
        status = row.get("status") or "reconnecting"
        gaps = int(row.get("gaps") or 0)
        if status == "live":
            extra = f", дыр {gaps} (resync ok)" if gaps else ""
            parts.append(f"{label} ok{extra}")
        elif status == "unavailable":
            parts.append(f"{label} unavailable")
        elif status == "rate_limited":
            parts.append(f"{label} rate limit")
        elif status == "resync":
            extra = f", дыр {gaps}" if gaps else ""
            parts.append(f"{label} resync{extra}")
        elif status == "stale":
            extra = f", дыр {gaps}" if gaps else ""
            parts.append(f"{label} stale{extra}")
        else:
            parts.append(f"{label} {status}")
    return " · ".join(parts)


def service_ok(rows: list[dict]) -> bool:
    """True when no tracked venue is stale. Unavailable does not fail the service."""
    if not rows:
        return False
    for row in rows:
        if row.get("status") in ("stale", "resync", "reconnecting", "connecting"):
            return False
    return any(row.get("status") in ("live", "unavailable", "rate_limited") for row in rows)
