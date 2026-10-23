# WAIA-S

S = 100*tanh(renormalised 0.30*T + 0.25*M + 0.30*L + 0.15*P)*Q; LONG if S>=40 and T>=-0.3; SHORT if S<=-40 and T<=0.3; entry = price ∓ 0.3*ATR_1h; stop = swing ∓ 0.5*ATR_1h; target = nearer of opposite swing and 2*ATR with net RR>=1.8

Decision grid: `1h` · management horizon: `24h` · fee per side: 0.0005 · span: 2021-01-01T01:00:00Z → 2026-10-02T15:00:00Z

Holdout starts 2025-08-08T12:12:00Z (last 20% of the clock). The ranking window used by the search starts 2024-03-22T08:50:24Z.

L is absent on historical bars, so its 0.30 weight is removed and T/M/P are renormalised (0.30/0.70, 0.25/0.70, 0.15/0.70). Q is 1 when every required atom of the active components is present.

A card is submitted only when the symbol is flat. An unfilled limit scores R = 0 and still occupies the book until the horizon. If stop and target are both inside one bar, the stop is taken. Path uses 1-minute bars when that window is cached, else 15-minute.

This run did not cache 1-minute bars, so every card below was resolved on 15-minute bars.

## Full available history

- submitted cards: 431
- filled: 394 (fill rate 0.9142)
- expectancy R, unfilled counted as 0: -0.1371
- expectancy R, filled only: -0.1500
- hit rate among fills (R>0): 0.3655
- target first / stop first: 0.1599 / 0.5584
- t = -2.31, one-sided p = 0.9892, per-trade Sharpe = -0.1110, significant = False

## Development (before the holdout cut)

- submitted cards: 235
- filled: 208 (fill rate 0.8851)
- expectancy R, unfilled counted as 0: -0.1807
- expectancy R, filled only: -0.2042
- hit rate among fills (R>0): 0.3606
- target first / stop first: 0.1346 / 0.5769
- t = -2.38, one-sided p = 0.9909, per-trade Sharpe = -0.1552, significant = False

## Holdout (confirmatory for this pre-specified rule)

- submitted cards: 196
- filled: 186 (fill rate 0.9490)
- expectancy R, unfilled counted as 0: -0.0848
- expectancy R, filled only: -0.0893
- hit rate among fills (R>0): 0.3710
- target first / stop first: 0.1882 / 0.5376
- t = -0.90, one-sided p = 0.8161, per-trade Sharpe = -0.0645, significant = False

Gate (holdout mean R > 0, p < 0.05, at least 30 cards): **False**.

## Probability scores

- Brier raw / isotonic / Platt: 0.2654 / 0.2560 / 0.2502
- Log loss raw / isotonic / Platt: 0.7257 / 0.7719 / 0.6935
- Hit rate raw / isotonic: 0.4861 / 0.4900

Raw P(up) = (clip(S, −100, 100)/100 + 1) / 2. Isotonic and Platt maps are fit only on rows whose horizon had already ended.

## Quantile coverage of the forward return

- nominal 0.1: empirical 0.0761 (n=650726)
- nominal 0.5: empirical 0.5097 (n=650726)
- nominal 0.9: empirical 0.9310 (n=650726)

## S buckets

| bucket | n | mean S | raw P | realised up | mean fwd return | mean trade R |
|---|---:|---:|---:|---:|---:|---:|
| [-100, -60] | 127 | -62.3 | 0.1883 | 0.5748 | 0.0122 | — |
| [-60, -40] | 12668 | -44.9 | 0.2756 | 0.5445 | 0.0019 | -0.0529 |
| [-40, -20] | 119683 | -28.0 | 0.3601 | 0.5298 | 0.0010 | — |
| [-20, 20] | 386217 | -0.4 | 0.4981 | 0.4987 | 0.0016 | — |
| [20, 40] | 115946 | 28.2 | 0.6411 | 0.4805 | 0.0039 | — |
| [40, 60] | 16843 | 45.4 | 0.7269 | 0.4846 | 0.0054 | -0.2224 |
| [60, 100] | 216 | 62.2 | 0.8109 | 0.5370 | 0.0097 | — |

## Ablation on the ranking window

Ablation cards are resolved on 15-minute bars so the variants differ by the score, not by the path. The headline book above uses 1-minute bars when they are cached.

- `full`: mean R -0.1470, n=101, p=0.9160
- `no_T`: mean R -0.1703, n=128, p=0.9608
- `no_M`: mean R -0.1943, n=263, p=0.9941
- `no_P`: mean R -0.0887, n=810, p=0.9773
- `no_L`: mean R -0.1470, n=101, p=0.9160
- `T_only`: mean R -0.2085, n=2235, p=1.0000
- `M_only`: mean R -0.1026, n=1479, p=0.9990
- `P_only`: mean R —, n=0, p=—

## By symbol

- SOL: mean R -0.2049, filled hit 0.3077, n=47
- DOGE: mean R -0.2414, filled hit 0.3953, n=46
- PEPE: mean R 0.1056, filled hit 0.4419, n=45
- TRX: mean R -0.2865, filled hit 0.3243, n=43
- BNB: mean R -0.4109, filled hit 0.3103, n=33
- XRP: mean R -0.4607, filled hit 0.2609, n=27
- HYPE: mean R 0.2591, filled hit 0.4000, n=22
- ADA: mean R 0.1282, filled hit 0.4500, n=21
- LTC: mean R -0.0806, filled hit 0.4500, n=21
- SUI: mean R 0.1035, filled hit 0.3684, n=20
- BTC: mean R 0.0644, filled hit 0.4118, n=19
- LINK: mean R -0.0012, filled hit 0.4000, n=16
- USOIL: mean R -0.4763, filled hit 0.1875, n=16
- BRENTOIL: mean R 0.0192, filled hit 0.4286, n=14
- XAU: mean R -0.3873, filled hit 0.3333, n=13
- ZEC: mean R 0.0504, filled hit 0.5000, n=11
- FIL: mean R -0.0188, filled hit 0.3333, n=9
- ETH: mean R -0.3436, filled hit 0.2500, n=8

## By month

- 2021-03: mean R 0.1337, n=1
- 2021-05: mean R 2.3702, n=2
- 2021-07: mean R 0.2657, n=2
- 2021-08: mean R 0.0000, n=1
- 2021-10: mean R -1.0768, n=1
- 2021-12: mean R -1.0355, n=2
- 2022-01: mean R -0.4186, n=7
- 2022-03: mean R 0.6814, n=3
- 2022-04: mean R 0.4661, n=2
- 2022-06: mean R 0.5169, n=3
- 2022-08: mean R 0.4457, n=2
- 2022-09: mean R -1.0618, n=3
- 2022-10: mean R -0.7943, n=4
- 2022-11: mean R 0.1135, n=4
- 2022-12: mean R 0.2122, n=1
- 2023-01: mean R -0.8533, n=3
- 2023-02: mean R -1.1420, n=1
- 2023-03: mean R -0.2759, n=6
- 2023-04: mean R 0.5971, n=3
- 2023-05: mean R -0.4643, n=10
- 2023-06: mean R -0.7020, n=14
- 2023-07: mean R -0.7381, n=10
- 2023-08: mean R -0.6681, n=13
- 2023-09: mean R -0.4283, n=5
- 2023-10: mean R 0.9992, n=14
- 2023-11: mean R -0.1019, n=3
- 2023-12: mean R -0.7198, n=3
- 2024-01: mean R -0.8197, n=3
- 2024-02: mean R 0.0035, n=6
- 2024-03: mean R 0.2812, n=3
- 2024-05: mean R 0.3668, n=1
- 2024-06: mean R -0.6792, n=5
- 2024-07: mean R -0.2287, n=11
- 2024-08: mean R -0.5400, n=3
- 2024-09: mean R -0.0973, n=4
- 2024-10: mean R -1.2080, n=2
- 2024-11: mean R 0.5493, n=1
- 2024-12: mean R 1.8706, n=1
- 2025-01: mean R -0.0624, n=12
- 2025-02: mean R 0.2314, n=14
- 2025-03: mean R -0.2014, n=12
- 2025-04: mean R 0.1791, n=4
- 2025-05: mean R 0.3562, n=5
- 2025-06: mean R -0.6110, n=19
- 2025-07: mean R 0.2301, n=6
- 2025-08: mean R -1.0550, n=4
- 2025-09: mean R 0.0526, n=16
- 2025-10: mean R -0.3460, n=3
- 2025-11: mean R 1.4723, n=3
- 2025-12: mean R -1.1054, n=3
- 2026-01: mean R -0.3721, n=15
- 2026-02: mean R 0.5197, n=4
- 2026-03: mean R 0.1861, n=16
- 2026-04: mean R 0.0719, n=26
- 2026-05: mean R -0.0651, n=28
- 2026-06: mean R 0.2145, n=24
- 2026-07: mean R -0.6378, n=10
- 2026-08: mean R 0.0867, n=22
- 2026-09: mean R -0.6134, n=22

## By session and volatility regime

- session europe: mean R -0.1180, n=172
- session asia: mean R -0.0074, n=147
- session us: mean R -0.3366, n=112
- vol low: mean R -0.2603, n=156
- vol high: mean R -0.0504, n=141
- vol mid: mean R -0.0849, n=134

## Other decision grids

### 15m

Full history:
- submitted cards: 846
- filled: 779 (fill rate 0.9208)
- expectancy R, unfilled counted as 0: -0.1465
- expectancy R, filled only: -0.1591
- hit rate among fills (R>0): 0.3530
- target first / stop first: 0.1515 / 0.5571
- t = -3.49, one-sided p = 0.9997, per-trade Sharpe = -0.1200, significant = False

Holdout:
- submitted cards: 411
- filled: 385 (fill rate 0.9367)
- expectancy R, unfilled counted as 0: -0.1567
- expectancy R, filled only: -0.1673
- hit rate among fills (R>0): 0.3532
- target first / stop first: 0.1558 / 0.5558
- t = -2.60, one-sided p = 0.9952, per-trade Sharpe = -0.1283, significant = False

## Same signals, 4h management horizon

- submitted cards: 502
- filled: 379 (fill rate 0.7550)
- expectancy R, unfilled counted as 0: -0.0607
- expectancy R, filled only: -0.0803
- hit rate among fills (R>0): 0.4406
- target first / stop first: 0.0211 / 0.1979
- t = -2.06, one-sided p = 0.9803, per-trade Sharpe = -0.0922, significant = False

