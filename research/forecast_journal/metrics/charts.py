"""PNG charts. Matplotlib is the only plotting dependency."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def reliability_chart(path: Path, table: list[dict], title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(6.2, 5.2))
    if table:
        x = [row["mean_p"] for row in table]
        y = [row["realized_rate"] for row in table]
        n = [row["n"] for row in table]
        ax.scatter(x, y, s=np.clip(n, 20, 400), zorder=3)
        ax.plot(x, y, color="#1f4b99", lw=1.2)
    ax.plot([0, 1], [0, 1], ls="--", color="#888888", lw=1)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("Predicted P(up)")
    ax.set_ylabel("Realised frequency")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def bar_chart(path: Path, labels: list[str], values: list[float], title: str, ylabel: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(max(6.5, 0.45 * len(labels) + 2), 4.8))
    colors = ["#1f4b99" if (np.isfinite(v) and v >= 0) else "#a33b3b" for v in values]
    ax.bar(range(len(labels)), [0 if not np.isfinite(v) else v for v in values], color=colors)
    ax.axhline(0, color="#444444", lw=0.8)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=60, ha="right")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def equity_chart(path: Path, ts: np.ndarray, r: np.ndarray, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7.2, 4.4))
    if len(r):
        order = np.argsort(ts)
        ax.plot(np.cumsum(np.asarray(r, dtype=float)[order]), color="#1f4b99")
    ax.axhline(0, color="#888888", lw=0.8)
    ax.set_xlabel("Trade number (non-overlapping)")
    ax.set_ylabel("Cumulative R after fees")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
