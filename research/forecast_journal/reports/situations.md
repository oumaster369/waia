# Situational strategies

Each row is a dedicated rule for one situation, then the same rule inside a trend, range, or high-vol regime.
Costs: taker fee 0.05% per side and slippage on entry and exit. The last 20% of the clock is an untouched holdout.
Rules have no fitted thresholds. One position per symbol. Same-bar stop and target counts as a stop.
Benjamini–Hochberg runs across the 24 situation trials of a timeframe. When several timeframes are in one run, the live scorer arms a row only if it also survives the joint pass.

Публичные ликвидации HTX — это короткий недавний буфер, не история с 2024 года. S5 поэтому смотрит на всплеск объёма и перерастяжение больше 2 ATR, а не на ленту ликвидаций.

Armed: `{'15m': [], '5m': [], '1m': []}`.

Ни одна ситуация не прошла строгую проверку. Живой скор не включает ни одну из них.

## 15m

Symbols: BTC, ETH, SOL, XAU, USOIL, DOGE, XRP, BNB, HYPE, ZEC, ADA, LTC, SUI, FIL, TRX, PEPE, LINK, BRENTOIL. 2024-01-01T00:00:00Z → 2026-10-02T15:00:00Z.
Ranking 2024-01-21T00:00:00Z → 2026-03-15T12:00:00Z. Holdout from 2026-03-15T12:00:00Z.
Path: 15m. Slippage: max(2 bp of price, 0.10 * decision-bar ATR) per fill, entry and exit. Not 10% of the hourly ATR.
Trials: 24. Leader: `S5_trend`. Deflated Sharpe: `{'sharpe': -0.14041863962202256, 'sr_star': 0.10345277996367826, 'dsr': 1.46691559288481e-07, 'n': 507, 'n_trials': 24, 'skew': 0.9669570921555434, 'kurtosis': 2.77992859800686}`.

| setup | rank n | hit | mean R | p | trades/day | max DD | q | BH | holdout n | holdout mean R | holdout p |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| `S1` | 23561 | 0.3823 | -0.2508 | 1.0000 | 30.033 | 5929.74 | 1.0000 | False | 7508 | -0.3097 | 1.0000 |
| `S2` | 3750 | 0.2443 | -0.2724 | 1.0000 | 4.780 | 1022.64 | 1.0000 | False | 1023 | -0.4329 | 1.0000 |
| `S3` | 15273 | 0.3246 | -0.2864 | 1.0000 | 19.468 | 4383.38 | 1.0000 | False | 4812 | -0.3874 | 1.0000 |
| `S4` | 5998 | 0.2914 | -0.3753 | 1.0000 | 7.646 | 2255.03 | 1.0000 | False | 1701 | -0.3701 | 1.0000 |
| `S5` | 5262 | 0.3368 | -0.2781 | 1.0000 | 6.707 | 1466.94 | 1.0000 | False | 1737 | -0.2916 | 1.0000 |
| `S6` | 7017 | 0.3137 | -0.3024 | 1.0000 | 8.945 | 2140.19 | 1.0000 | False | 2054 | -0.4551 | 1.0000 |
| `S1_trend` | 9196 | 0.3777 | -0.2553 | 1.0000 | 11.722 | 2367.60 | 1.0000 | False | 2807 | -0.3021 | 1.0000 |
| `S1_range` | 8638 | 0.3803 | -0.2593 | 1.0000 | 11.011 | 2264.64 | 1.0000 | False | 2813 | -0.3103 | 1.0000 |
| `S1_highvol` | 8076 | 0.3886 | -0.2198 | 1.0000 | 10.294 | 1783.52 | 1.0000 | False | 2466 | -0.2724 | 1.0000 |
| `S2_trend` | 1700 | 0.2288 | -0.2608 | 1.0000 | 2.167 | 443.04 | 1.0000 | False | 489 | -0.4833 | 1.0000 |
| `S2_range` | 2109 | 0.2546 | -0.2464 | 1.0000 | 2.688 | 520.07 | 1.0000 | False | 579 | -0.3643 | 1.0000 |
| `S2_highvol` | 0 | — | — | — | 0.000 | — | 1.0000 | False | 0 | — | — |
| `S3_trend` | 15273 | 0.3246 | -0.2864 | 1.0000 | 19.468 | 4383.38 | 1.0000 | False | 4812 | -0.3874 | 1.0000 |
| `S3_range` | 4874 | 0.3342 | -0.2970 | 1.0000 | 6.213 | 1446.71 | 1.0000 | False | 1533 | -0.4423 | 1.0000 |
| `S3_highvol` | 5234 | 0.3116 | -0.2891 | 1.0000 | 6.672 | 1515.12 | 1.0000 | False | 1625 | -0.3527 | 1.0000 |
| `S4_trend` | 694 | 0.2781 | -0.4128 | 1.0000 | 0.885 | 289.89 | 1.0000 | False | 212 | -0.3020 | 0.9987 |
| `S4_range` | 5998 | 0.2914 | -0.3753 | 1.0000 | 7.646 | 2255.03 | 1.0000 | False | 1701 | -0.3701 | 1.0000 |
| `S4_highvol` | 1072 | 0.2920 | -0.3554 | 1.0000 | 1.366 | 398.05 | 1.0000 | False | 297 | -0.0982 | 0.8635 |
| `S5_trend` | 507 | 0.3708 | -0.1831 | 0.9992 | 0.646 | 121.53 | 1.0000 | False | 234 | -0.2214 | 0.9949 |
| `S5_range` | 1922 | 0.3127 | -0.3415 | 1.0000 | 2.450 | 660.88 | 1.0000 | False | 660 | -0.3293 | 1.0000 |
| `S5_highvol` | 1998 | 0.3559 | -0.2323 | 1.0000 | 2.547 | 490.95 | 1.0000 | False | 669 | -0.3044 | 1.0000 |
| `S6_trend` | 2278 | 0.2959 | -0.3747 | 1.0000 | 2.904 | 854.91 | 1.0000 | False | 654 | -0.4745 | 1.0000 |
| `S6_range` | 2603 | 0.3046 | -0.3517 | 1.0000 | 3.318 | 919.22 | 1.0000 | False | 772 | -0.4484 | 1.0000 |
| `S6_highvol` | 2063 | 0.3175 | -0.2734 | 1.0000 | 2.630 | 589.15 | 1.0000 | False | 596 | -0.4266 | 1.0000 |

## 5m

Symbols: BTC, ETH, SOL. 2024-01-01T00:00:00Z → 2026-10-02T15:30:00Z.
Ranking 2024-01-21T00:00:00Z → 2026-03-15T12:24:00Z. Holdout from 2026-03-15T12:24:00Z.
Path: 5m. Slippage: max(2 bp of price, 0.10 * decision-bar ATR) per fill, entry and exit. Not 10% of the hourly ATR.
Trials: 24. Leader: `S2_range`. Deflated Sharpe: `{'sharpe': -0.06949325880064154, 'sr_star': 0.12785736340872686, 'dsr': 1.900617793759718e-06, 'n': 639, 'n_trials': 24, 'skew': 2.2322944785403536, 'kurtosis': 7.66275362360133}`.

| setup | rank n | hit | mean R | p | trades/day | max DD | q | BH | holdout n | holdout mean R | holdout p |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| `S1` | 9927 | 0.3685 | -0.2870 | 1.0000 | 12.654 | 2851.57 | 1.0000 | False | 2327 | -0.3340 | 1.0000 |
| `S2` | 1189 | 0.2204 | -0.2609 | 0.9998 | 1.516 | 326.32 | 1.0000 | False | 310 | -0.5462 | 1.0000 |
| `S3` | 4633 | 0.2968 | -0.3432 | 1.0000 | 5.906 | 1593.40 | 1.0000 | False | 1081 | -0.4609 | 1.0000 |
| `S4` | 1630 | 0.2718 | -0.3411 | 1.0000 | 2.078 | 570.29 | 1.0000 | False | 412 | -0.3765 | 1.0000 |
| `S5` | 3105 | 0.2847 | -0.3216 | 1.0000 | 3.958 | 1001.33 | 1.0000 | False | 801 | -0.2447 | 1.0000 |
| `S6` | 3226 | 0.2843 | -0.3505 | 1.0000 | 4.112 | 1140.51 | 1.0000 | False | 864 | -0.3464 | 1.0000 |
| `S1_trend` | 4150 | 0.3733 | -0.2740 | 1.0000 | 5.290 | 1149.79 | 1.0000 | False | 950 | -0.3151 | 1.0000 |
| `S1_range` | 3431 | 0.3731 | -0.2886 | 1.0000 | 4.373 | 1002.66 | 1.0000 | False | 878 | -0.3841 | 1.0000 |
| `S1_highvol` | 3584 | 0.3767 | -0.2390 | 1.0000 | 4.568 | 855.18 | 1.0000 | False | 679 | -0.2055 | 1.0000 |
| `S2_trend` | 540 | 0.1963 | -0.3145 | 0.9980 | 0.688 | 176.45 | 1.0000 | False | 130 | -0.6347 | 0.9992 |
| `S2_range` | 639 | 0.2363 | -0.1790 | 0.9603 | 0.815 | 124.44 | 1.0000 | False | 174 | -0.5111 | 0.9985 |
| `S2_highvol` | 0 | — | — | — | 0.000 | — | 1.0000 | False | 0 | — | — |
| `S3_trend` | 4633 | 0.2968 | -0.3432 | 1.0000 | 5.906 | 1593.40 | 1.0000 | False | 1081 | -0.4609 | 1.0000 |
| `S3_range` | 1454 | 0.2985 | -0.3828 | 1.0000 | 1.853 | 559.59 | 1.0000 | False | 366 | -0.4947 | 1.0000 |
| `S3_highvol` | 1519 | 0.2923 | -0.2912 | 1.0000 | 1.936 | 441.13 | 1.0000 | False | 307 | -0.3984 | 1.0000 |
| `S4_trend` | 221 | 0.2534 | -0.4441 | 1.0000 | 0.282 | 101.15 | 1.0000 | False | 47 | -0.6055 | 0.9963 |
| `S4_range` | 1630 | 0.2718 | -0.3411 | 1.0000 | 2.078 | 570.29 | 1.0000 | False | 412 | -0.3765 | 1.0000 |
| `S4_highvol` | 298 | 0.3054 | -0.2582 | 0.9980 | 0.380 | 87.98 | 1.0000 | False | 59 | -0.5473 | 0.9995 |
| `S5_trend` | 389 | 0.2648 | -0.4609 | 1.0000 | 0.496 | 182.51 | 1.0000 | False | 124 | -0.3957 | 0.9997 |
| `S5_range` | 1074 | 0.2579 | -0.4295 | 1.0000 | 1.369 | 467.79 | 1.0000 | False | 326 | -0.2902 | 0.9997 |
| `S5_highvol` | 1029 | 0.3168 | -0.2288 | 1.0000 | 1.312 | 249.81 | 1.0000 | False | 219 | -0.3422 | 0.9999 |
| `S6_trend` | 1160 | 0.2810 | -0.4152 | 1.0000 | 1.479 | 494.79 | 1.0000 | False | 290 | -0.2761 | 0.9956 |
| `S6_range` | 1096 | 0.2719 | -0.4318 | 1.0000 | 1.397 | 478.37 | 1.0000 | False | 325 | -0.4027 | 1.0000 |
| `S6_highvol` | 919 | 0.2753 | -0.3205 | 1.0000 | 1.171 | 309.82 | 1.0000 | False | 179 | -0.3884 | 0.9986 |

## 1m

Symbols: BTC, ETH, SOL. 2024-01-01T00:00:00Z → 2026-10-02T15:30:00Z.
Ranking 2024-01-21T00:00:00Z → 2026-03-15T12:24:00Z. Holdout from 2026-03-15T12:24:00Z.
Path: 1m. Slippage: max(2 bp of price, 0.10 * decision-bar ATR) per fill, entry and exit. Not 10% of the hourly ATR.
Trials: 24. Leader: `S5_highvol`. Deflated Sharpe: `{'sharpe': -0.11827453804650373, 'sr_star': 0.10274881324073622, 'dsr': 0.0, 'n': 2303, 'n_trials': 24, 'skew': 2.0602332810293, 'kurtosis': 6.861307515164406}`.

| setup | rank n | hit | mean R | p | trades/day | max DD | q | BH | holdout n | holdout mean R | holdout p |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| `S1` | 17959 | 0.3321 | -0.3404 | 1.0000 | 22.892 | 6129.86 | 1.0000 | False | 4267 | -0.4553 | 1.0000 |
| `S2` | 1536 | 0.1803 | -0.3410 | 1.0000 | 1.958 | 543.64 | 1.0000 | False | 390 | -0.6154 | 1.0000 |
| `S3` | 6239 | 0.2625 | -0.3928 | 1.0000 | 7.953 | 2453.57 | 1.0000 | False | 1416 | -0.5430 | 1.0000 |
| `S4` | 2374 | 0.2165 | -0.4244 | 1.0000 | 3.026 | 1032.16 | 1.0000 | False | 614 | -0.4435 | 1.0000 |
| `S5` | 6569 | 0.2267 | -0.3524 | 1.0000 | 8.373 | 2318.93 | 1.0000 | False | 1577 | -0.3527 | 1.0000 |
| `S6` | 5480 | 0.2533 | -0.3712 | 1.0000 | 6.985 | 2046.23 | 1.0000 | False | 1445 | -0.3238 | 1.0000 |
| `S1_trend` | 7793 | 0.3331 | -0.3412 | 1.0000 | 9.934 | 2670.80 | 1.0000 | False | 1749 | -0.4526 | 1.0000 |
| `S1_range` | 6140 | 0.3251 | -0.3868 | 1.0000 | 7.826 | 2394.30 | 1.0000 | False | 1637 | -0.5140 | 1.0000 |
| `S1_highvol` | 6319 | 0.3366 | -0.2672 | 1.0000 | 8.055 | 1690.42 | 1.0000 | False | 1219 | -0.2787 | 1.0000 |
| `S2_trend` | 690 | 0.1594 | -0.4355 | 1.0000 | 0.880 | 306.23 | 1.0000 | False | 160 | -0.4749 | 0.9803 |
| `S2_range` | 810 | 0.1938 | -0.2527 | 0.9930 | 1.032 | 208.79 | 1.0000 | False | 218 | -0.5454 | 0.9990 |
| `S2_highvol` | 0 | — | — | — | 0.000 | — | 1.0000 | False | 0 | — | — |
| `S3_trend` | 6239 | 0.2625 | -0.3928 | 1.0000 | 7.953 | 2453.57 | 1.0000 | False | 1416 | -0.5430 | 1.0000 |
| `S3_range` | 1961 | 0.2642 | -0.4441 | 1.0000 | 2.500 | 874.07 | 1.0000 | False | 458 | -0.5409 | 1.0000 |
| `S3_highvol` | 2067 | 0.2574 | -0.3173 | 1.0000 | 2.635 | 656.55 | 1.0000 | False | 409 | -0.4468 | 1.0000 |
| `S4_trend` | 327 | 0.2232 | -0.4460 | 1.0000 | 0.417 | 153.40 | 1.0000 | False | 91 | -0.2847 | 0.9180 |
| `S4_range` | 2374 | 0.2165 | -0.4244 | 1.0000 | 3.026 | 1032.16 | 1.0000 | False | 614 | -0.4435 | 1.0000 |
| `S4_highvol` | 418 | 0.2344 | -0.2848 | 0.9990 | 0.533 | 133.66 | 1.0000 | False | 79 | -0.5057 | 0.9977 |
| `S5_trend` | 882 | 0.2438 | -0.3525 | 1.0000 | 1.124 | 324.59 | 1.0000 | False | 256 | -0.5255 | 1.0000 |
| `S5_range` | 2231 | 0.2057 | -0.4960 | 1.0000 | 2.844 | 1125.77 | 1.0000 | False | 619 | -0.4428 | 1.0000 |
| `S5_highvol` | 2303 | 0.2523 | -0.2249 | 1.0000 | 2.936 | 547.69 | 1.0000 | False | 417 | -0.4108 | 1.0000 |
| `S6_trend` | 2063 | 0.2559 | -0.3791 | 1.0000 | 2.630 | 800.44 | 1.0000 | False | 541 | -0.2630 | 0.9988 |
| `S6_range` | 1861 | 0.2386 | -0.4702 | 1.0000 | 2.372 | 882.84 | 1.0000 | False | 548 | -0.3749 | 1.0000 |
| `S6_highvol` | 1558 | 0.2574 | -0.2822 | 1.0000 | 1.986 | 464.47 | 1.0000 | False | 329 | -0.5054 | 1.0000 |

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

