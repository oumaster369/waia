# Situational strategies

Each row is a dedicated rule for one situation, then the same rule inside a trend, range, or high-vol regime.
Costs: taker fee 0.05% per side and slippage on entry and exit. The last 20% of the clock is an untouched holdout.
Rules have no fitted thresholds. One position per symbol. Same-bar stop and target counts as a stop.
Benjamini–Hochberg runs across the 24 situation trials of a timeframe. When several timeframes are in one run, the live scorer arms a row only if it also survives the joint pass.

Публичные ликвидации HTX — это короткий недавний буфер, не история с 2024 года. S5 поэтому смотрит на всплеск объёма и перерастяжение больше 2 ATR, а не на ленту ликвидаций.

Armed: `{'15m': []}`.

Ни одна ситуация не прошла строгую проверку. Живой скор не включает ни одну из них.

## 15m

Symbols: BTC, ETH, SOL. 2024-01-01T00:00:00Z → 2026-10-02T15:00:00Z.
Ranking 2024-01-21T00:00:00Z → 2026-03-15T12:00:00Z. Holdout from 2026-03-15T12:00:00Z.
Path: 15m. Slippage: max(2 bp of price, 0.10 * decision-bar ATR) per fill, entry and exit. Not 10% of the hourly ATR.
Trials: 24. Leader: `S4_highvol`. Deflated Sharpe: `{'sharpe': -0.14829704971743185, 'sr_star': 0.10946672684374599, 'dsr': 0.0004366314504591351, 'n': 199, 'n_trials': 24, 'skew': 1.1780252791832737, 'kurtosis': 3.322381964117626}`.

| setup | rank n | hit | mean R | p | trades/day | max DD | q | BH | holdout n | holdout mean R | holdout p |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| `S1` | 4994 | 0.3821 | -0.2733 | 1.0000 | 6.366 | 1370.33 | 1.0000 | False | 1197 | -0.3488 | 1.0000 |
| `S2` | 877 | 0.2452 | -0.3391 | 1.0000 | 1.118 | 296.03 | 1.0000 | False | 219 | -0.5571 | 1.0000 |
| `S3` | 3365 | 0.3284 | -0.3157 | 1.0000 | 4.289 | 1065.09 | 1.0000 | False | 770 | -0.4543 | 1.0000 |
| `S4` | 1124 | 0.2980 | -0.3859 | 1.0000 | 1.433 | 438.35 | 1.0000 | False | 255 | -0.3981 | 1.0000 |
| `S5` | 1379 | 0.3503 | -0.2650 | 1.0000 | 1.758 | 369.91 | 1.0000 | False | 399 | -0.2598 | 1.0000 |
| `S6` | 1894 | 0.3168 | -0.3275 | 1.0000 | 2.414 | 623.78 | 1.0000 | False | 478 | -0.4475 | 1.0000 |
| `S1_trend` | 2028 | 0.3743 | -0.2838 | 1.0000 | 2.585 | 585.24 | 1.0000 | False | 462 | -0.2738 | 1.0000 |
| `S1_range` | 1690 | 0.3834 | -0.2805 | 1.0000 | 2.154 | 478.72 | 1.0000 | False | 453 | -0.3513 | 1.0000 |
| `S1_highvol` | 1836 | 0.3862 | -0.2441 | 1.0000 | 2.340 | 449.17 | 1.0000 | False | 352 | -0.3225 | 1.0000 |
| `S2_trend` | 392 | 0.2194 | -0.4155 | 1.0000 | 0.500 | 161.53 | 1.0000 | False | 98 | -0.5907 | 0.9980 |
| `S2_range` | 479 | 0.2526 | -0.3001 | 0.9990 | 0.611 | 143.63 | 1.0000 | False | 122 | -0.3928 | 0.9844 |
| `S2_highvol` | 0 | — | — | — | 0.000 | — | 1.0000 | False | 0 | — | — |
| `S3_trend` | 3365 | 0.3284 | -0.3157 | 1.0000 | 4.289 | 1065.09 | 1.0000 | False | 770 | -0.4543 | 1.0000 |
| `S3_range` | 1020 | 0.3343 | -0.3305 | 1.0000 | 1.300 | 336.85 | 1.0000 | False | 241 | -0.4310 | 1.0000 |
| `S3_highvol` | 1150 | 0.3157 | -0.2985 | 1.0000 | 1.466 | 342.10 | 1.0000 | False | 227 | -0.4286 | 1.0000 |
| `S4_trend` | 130 | 0.2769 | -0.4631 | 1.0000 | 0.166 | 61.27 | 1.0000 | False | 33 | -0.5884 | 0.9965 |
| `S4_range` | 1124 | 0.2980 | -0.3859 | 1.0000 | 1.433 | 438.35 | 1.0000 | False | 255 | -0.3981 | 1.0000 |
| `S4_highvol` | 199 | 0.3618 | -0.2048 | 0.9811 | 0.254 | 44.89 | 1.0000 | False | 45 | -0.4281 | 0.9934 |
| `S5_trend` | 159 | 0.3648 | -0.2133 | 0.9758 | 0.203 | 42.98 | 1.0000 | False | 63 | -0.3343 | 0.9899 |
| `S5_range` | 469 | 0.3369 | -0.3113 | 1.0000 | 0.598 | 151.98 | 1.0000 | False | 150 | -0.3676 | 1.0000 |
| `S5_highvol` | 497 | 0.3581 | -0.2389 | 1.0000 | 0.634 | 121.21 | 1.0000 | False | 123 | -0.3881 | 1.0000 |
| `S6_trend` | 633 | 0.2765 | -0.4502 | 1.0000 | 0.807 | 284.13 | 1.0000 | False | 157 | -0.2556 | 0.9812 |
| `S6_range` | 634 | 0.3091 | -0.3751 | 1.0000 | 0.808 | 237.50 | 1.0000 | False | 189 | -0.4111 | 0.9999 |
| `S6_highvol` | 551 | 0.2940 | -0.4281 | 1.0000 | 0.702 | 238.09 | 1.0000 | False | 101 | -0.4859 | 0.9998 |

## Formulas

### `S1`

Swing high/low confirmed with a 30-minute wing on each side, or two such swings within 0.15·ATR_1h (equal highs/lows). A later bar trades through that level and, one to three bars after the sweep — not on the sweep bar itself — closes back through it. Entry is the next open. Stop is the sweep extreme ± 0.3·ATR_1h. Target is the nearer opposite pool (last opposite swing or the prior 24h extreme) at least 0.25·ATR away.

### `S2`

ATR_1h is at or below its own trailing 20-day 20th percentile. Close breaks the prior 24h high or low, the previous close had not, and volume z-score on the break bar is at least 1. Stop is 0.3·ATR_1h back through the broken level. Target is a measured move of one 24h-range height.

### `S3`

4h trend: EMA20 vs EMA50, slope in the same direction, price beyond EMA50. The decision bar tags 1h EMA20 or 1h VWAP (24h) and closes back with the trend. Stop is 0.3·ATR_1h beyond the pullback extreme. Target is the nearer pool in the trend direction.

### `S4`

4h regime is range: ADX14 < 20, or |EMA20−EMA50| < 0.50·ATR and |slope| < 0.08. Fade a wick through the prior 24h extreme that closes back inside. Stop is 0.3·ATR_1h beyond that extreme. Target is the range mid.

### `S5`

Previous bar has volume z-score ≥ 2.5 (liquidation prints are not a 2024 history on the public API, so they are not required) and price is more than 2·ATR_1h from the 1h EMA20. This bar is the first reversal bar. Stop is 0.3·ATR_1h beyond the spike extreme. Target is the EMA or the next pool.

### `S6`

Clock is 13:30–15:30 UTC, or a weekday 12:25–13:05 UTC data slot, or 18:00–18:30 UTC on a pre-listed FOMC date. Close breaks the prior 30-minute high or low with volume z-score ≥ 1. Stop is 0.3·ATR_1h beyond the broken level. Target is the next 24h or swing pool, else one 30-minute range beyond the break.

