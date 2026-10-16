"""Backward pagination stops at the listing and does not duplicate bars."""

from __future__ import annotations

import unittest

from research.forecast_journal.data.paginate import walk_backward


class PaginateTests(unittest.TestCase):
    def test_walks_until_the_series_starts(self) -> None:
        listing = 10_000
        end = 10_000 + 500 * 60

        def fetch(start: int, stop: int) -> list[dict]:
            rows = []
            t = max(start, listing)
            while t <= stop:
                if t >= listing:
                    rows.append({"open_time": t, "close": t})
                t += 60
            return rows

        rows = walk_backward(fetch, 0, end, 60, max_bars=100, empty_gap_sec=10 * 86400)
        self.assertEqual(rows[0]["open_time"], listing)
        self.assertEqual(rows[-1]["open_time"], end - (end - listing) % 60)
        self.assertEqual(len(rows), len({row["open_time"] for row in rows}))


if __name__ == "__main__":
    unittest.main()
