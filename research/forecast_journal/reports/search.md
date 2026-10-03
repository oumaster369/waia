# Formula search

WAIA-S holdout mean R is not significantly above 0.

Trials: 28. Selected on the ranking window only: `squeeze_break_strict`.

Every searched rule except WAIA-S uses the same card: market entry at the decision price, stop at 1·ATR_1h, target at 2·ATR_1h, and the card is submitted only when the net reward/risk after the taker fee on both sides is at least 1.8. An unfilled limit scores R = 0.

No trial is crowned because it won a multiple-testing screen. Benjamini–Hochberg at q = 0.05 is applied to the ranking-window p-values. If none reject, the id above is simply the highest ranking-window mean R among trials with at least 30 cards. That selection does not use the holdout. A positive ranking mean with a negative holdout, or a deflated-Sharpe probability near zero, means the formula did not survive confirmation.

HTX publishes only the latest ~2000 index bars and ~200 official basis bars, so basis is absent on most of a multi-year ranking window. A basis rule with zero ranking cards is a data limit.

Formula:

Same breakout, but ATR_1h<=0.85× its trailing 20th percentile.

Ranking window:

- submitted cards: 608
- filled: 599 (fill rate 0.9852)
- expectancy R, unfilled counted as 0: 0.0386
- expectancy R, filled only: 0.0391
- hit rate among fills (R>0): 0.3823
- target first / stop first: 0.3756 / 0.6160
- t = 0.65, one-sided p = 0.2588, per-trade Sharpe = 0.0263, significant = False

Holdout (one look, after selection):

- submitted cards: 470
- filled: 466 (fill rate 0.9915)
- expectancy R, unfilled counted as 0: -0.1849
- expectancy R, filled only: -0.1865
- hit rate among fills (R>0): 0.3112
- target first / stop first: 0.3047 / 0.6867
- t = -2.84, one-sided p = 0.9977, per-trade Sharpe = -0.1312, significant = False

Deflated Sharpe on the ranking-window R: `{'sharpe': 0.026259933734971017, 'sr_star': 0.08112801007594178, 'dsr': 0.0867776326719108, 'n': 608, 'n_trials': 28, 'skew': 0.5074883171123237, 'kurtosis': 1.2958888569210611}`.

Top candidates by ranking-window expectancy. Holdout columns for everyone except the selected id are descriptive.

| model | ranking mean R | ranking n | ranking p | q | BH | holdout mean R | holdout n |
|---|---:|---:|---:|---:|---|---:|---:|
| `squeeze_break_strict` | 0.0386 | 608 | 0.2588 | 1.0000 | False | -0.1849 | 470 |
| `funding_fade_2` | -0.0084 | 1305 | 0.5839 | 1.0000 | False | -0.0847 | 1581 |
| `funding_fade_1.5` | -0.0205 | 1727 | 0.7239 | 1.0000 | False | -0.0985 | 2178 |
| `highvol_trend` | -0.0318 | 9137 | 0.9837 | 1.0000 | False | -0.0436 | 8450 |
| `weekday_momentum` | -0.0558 | 14850 | 1.0000 | 1.0000 | False | -0.0903 | 14129 |
| `wick_continuation` | -0.0665 | 2464 | 0.9899 | 1.0000 | False | -0.0997 | 2475 |
| `relative_strength` | -0.0679 | 19437 | 1.0000 | 1.0000 | False | -0.0802 | 17841 |
| `trend_T_0.40` | -0.0751 | 14640 | 1.0000 | 1.0000 | False | -0.0890 | 13783 |

## Formulas

### `waia_s_v1`

WAIA-S pre-specified formula.

### `trend_stack`

LONG if price>EMA50_4h and EMA20>EMA50>EMA200; SHORT the mirror.

### `trend_T_0.40`

LONG if T>=0.40; SHORT if T<=-0.40. T is the WAIA-S trend component.

### `trend_T_0.25`

LONG if T>=0.25; SHORT if T<=-0.25.

### `momentum_1h_4h`

LONG if ret_1h>0 and ret_4h>0; SHORT if both are negative.

### `momentum_24h`

LONG if ret_24h>0; SHORT if ret_24h<0.

### `mr_atr_2`

LONG if (price-EMA20_4h)/ATR_4h<=-2; SHORT if >=+2.

### `mr_atr_1.5`

LONG if (price-EMA20_4h)/ATR_4h<=-1.5; SHORT if >=+1.5.

### `mr_close_extreme`

LONG if close is in the bottom 15% of the bar and ret_1h<0; SHORT the mirror.

### `squeeze_break`

LONG if ATR_1h<=its trailing 20th percentile and price>prior 24-bar high; SHORT the mirror.

### `squeeze_break_strict`

Same breakout, but ATR_1h<=0.85× its trailing 20th percentile.

### `funding_fade_1.5`

LONG if funding_z<=-1.5; SHORT if funding_z>=1.5.

### `funding_fade_2`

LONG if funding_z<=-2; SHORT if funding_z>=2.

### `basis_fade`

LONG if basis<=-0.002; SHORT if basis>=0.002. basis=(swap-index)/index.

### `funding_basis_fade`

LONG if funding_z<=-1 and basis<=-0.001; SHORT the mirror.

### `btc_lead_1h`

For alts with beta_BTC>0.3: LONG if BTC ret_1h>0.001; SHORT if <-0.001. BTC itself is flat.

### `btc_lead_4h`

For alts with beta_BTC>0.3: LONG if BTC ret_4h>0.002; SHORT if <-0.002.

### `session_us_trend`

trend_stack, but only during the US session (16:00–24:00 UTC).

### `session_eu_trend`

trend_stack, but only during the Europe session (08:00–16:00 UTC).

### `session_asia_mr`

mr_atr_2, but only during the Asia session (00:00–08:00 UTC).

### `wick_reversal`

LONG after a high-volume bar that closes in the bottom 20% of its range; SHORT the mirror. Wick + volume is the liquidation-cascade proxy.

### `wick_continuation`

LONG after a high-volume bar that closes in the top 20% and ret_1h>0; SHORT the mirror.

### `vol_spike_fade`

Fade ret_1h when turnover z>=2.5 and |ret_1h| exceeds ATR_1h/price.

### `highvol_trend`

trend_T at 0.25, only in the high ATR regime (ATR above its trailing 66th percentile).

### `lowvol_revert`

mr_atr_1.5, only in the low ATR regime.

### `relative_strength`

LONG if ret_4h>0 and ret_4h exceeds BTC ret_4h by 0.5pp; SHORT the mirror.

### `weekday_momentum`

momentum_1h_4h on Monday–Thursday UTC only.

### `logistic_l2`

P(up) = L2 logistic on the feature snapshot, l2=0.1 chosen on the inner split by log loss. LONG if P>=0.55, SHORT if P<=0.45. Coefficients refit every 14 days on the ranking window and frozen at the holdout boundary. Card is the shared 1·ATR stop / 2·ATR target.
