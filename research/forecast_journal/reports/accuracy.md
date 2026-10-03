# Calibration, baselines, feature groups

Scores below are on the ranking window (after the inner cut, before the holdout), so they are not fit on the rows they score.

## Baselines

- `base_rate`: Brier 0.2500, log loss 0.6931, hit rate 0.5089
- `momentum_isotonic`: Brier 0.2568, log loss 0.7773, hit rate 0.5088
- `mean_reversion_isotonic`: Brier 0.2607, log loss 0.8617, hit rate 0.5035

## Feature groups (WAIA-S raw probability)

A group is 'present' when at least one of its columns is finite. Liquidity is missing on history.

- `price`: present 1.0000 (n=652670), Brier with 0.2654, Brier without —
- `volume`: present 0.9991 (n=652094), Brier with 0.2654, Brier without —
- `flow`: present 0.9995 (n=652325), Brier with 0.2654, Brier without 0.2703
- `funding`: present 1.0000 (n=652651), Brier with 0.2654, Brier without —
- `open_interest`: present 0.0220 (n=14328), Brier with 0.2699, Brier without 0.2653
- `basis`: present 0.2081 (n=135840), Brier with 0.2681, Brier without 0.2647
- `positioning`: present 0.0008 (n=540), Brier with 0.2319, Brier without 0.2654
- `cross_asset`: present 1.0000 (n=652662), Brier with 0.2654, Brier without —
- `session`: present 1.0000 (n=652670), Brier with 0.2654, Brier without —
- `liquidity`: present 0.0000 (n=0), Brier with —, Brier without 0.2654

## Feature lift

The split threshold is the training-window median. Lift is the test-window difference in P(up) above that median versus the test base rate. q-values are Benjamini–Hochberg across the scanned columns. A small q is a claim that survived multiple testing; it is not a trading rule.

| feature | OOS lift | corr | p | q | BH reject |
|---|---:|---:|---:|---:|---|
| `funding_rate` | -0.0449 | -0.0257 | 0.0000 | 0.0000 | True |
| `corr_btc` | 0.0201 | 0.0382 | 0.0000 | 0.0000 | True |
| `btc_ret_24h` | -0.0149 | -0.0476 | 0.0000 | 0.0000 | True |
| `ema20_slope_4h` | -0.0141 | -0.0319 | 0.0000 | 0.0000 | True |
| `ret_24h` | -0.0136 | -0.0382 | 0.0000 | 0.0000 | True |
| `atr_4h` | 0.0108 | 0.0138 | 0.0000 | 0.0000 | True |
| `atr_q20` | 0.0107 | 0.0099 | 0.0000 | 0.0000 | True |
| `atr_1h` | 0.0106 | 0.0158 | 0.0000 | 0.0000 | True |
| `atr_q33` | 0.0106 | 0.0108 | 0.0000 | 0.0000 | True |
| `atr_q66` | 0.0102 | 0.0116 | 0.0000 | 0.0000 | True |
| `dow` | 0.0101 | 0.0201 | 0.0000 | 0.0000 | True |
| `atr_15m` | 0.0097 | 0.0155 | 0.0000 | 0.0000 | True |
| `btc_ret_4h` | -0.0092 | -0.0306 | 0.0000 | 0.0000 | True |
| `dist_high_atr` | 0.0086 | 0.0177 | 0.0000 | 0.0000 | True |
| `ema200_4h` | 0.0081 | 0.0088 | 0.0000 | 0.0000 | True |
| `ema20_slope_15m` | -0.0076 | -0.0173 | 0.0000 | 0.0000 | True |
| `ema50_4h` | 0.0073 | 0.0089 | 0.0000 | 0.0000 | True |
| `funding_z` | 0.0071 | -0.0166 | 0.0025 | 0.0030 | True |
| `prior_high` | 0.0069 | 0.0089 | 0.0000 | 0.0000 | True |
| `swing_high` | 0.0069 | 0.0089 | 0.0000 | 0.0000 | True |
| `ema20_4h` | 0.0068 | 0.0087 | 0.0000 | 0.0000 | True |
| `vwap_4h` | 0.0064 | 0.0087 | 0.0000 | 0.0000 | True |
| `price` | 0.0063 | 0.0084 | 0.0000 | 0.0000 | True |
| `ret_4h` | -0.0063 | -0.0273 | 0.0000 | 0.0000 | True |
| `ema20_15m` | 0.0063 | 0.0085 | 0.0000 | 0.0000 | True |
