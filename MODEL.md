# Model note — btc-cent-forecast-01

## Task

Forecast the close 240 minutes after each checkpoint from the 4,320 one-minute
closes (72 h) up to it. Scoring is mean absolute error in cents, so the
optimal point forecast is the conditional median of the future price. The
house baseline is persistence (forecast = checkpoint close); a prize needs a
score strictly below it on the final, so the entry must deviate from
persistence — but only where the data earns it.

## What the price is

The series is the mid price of one Orca Whirlpool (Coinbase Wrapped BTC
against USDC) on Solana, sampled every 2 s and barred to 1-minute closes.
It is not an exchange average. Two consequences:

1. A single large trade can displace the pool price for a while; it then
   drifts back toward the broader BTC market. That displacement is
   mean-reverting *within* the series, and the only anchor available at
   runtime is the series' own recent level.
2. Minute bars are noisy (often no move for minutes, then a tick, sometimes
   a dollar or more). A median anchor is more robust to that noise than a
   mean.

## Model

```
anchor   = 0.5 * median(prices[-480:]) + 0.5 * mean(prices[-360:])
forecast = last + 0.25 * (anchor - last)
```

i.e. shrink the checkpoint close 25% of the way toward the average of the
8-hour median and the 6-hour mean. Two anchors (median + mean, two windows)
instead of one reduce the variance of the anchor estimate; the 25%
shrinkage keeps the forecast close to persistence.

## Evidence

Practice data: the six kit cases were merged into one continuous minute
series (2026-11-07 06:01Z → 2026-11-11 02:00Z, 5,520 minutes, no gaps).
Actuals for p00–p04 are the next case's checkpoint close; p05's actual was
recovered from the published baseline total (267,129.46 cents over six
cases) with the direction (up) confirmed against Binance BTC/USDT. The
recovered actuals reproduce the published persistence baseline
(44,521.58 cents) to within rounding.

Regression diagnostic (33 rolling checkpoints, 30 min apart):
regressing the 4 h-ahead log return on log(last / 8 h median) gives a
coefficient of −0.71 (t = −3.6, R² = 0.29) on the pool series, vs −0.09
(t = −1.0, R² = 0.006) on 162 non-overlapping Binance BTC/USDT checkpoints.
The reversion is real on the pool and absent on a deep market — it is a
pool-microstructure effect, which is exactly the series being scored. (The
t-statistic overstates significance: the 33 checkpoints overlap, so the
effective sample is smaller.)

## What was tried and rejected

- **Trend extrapolation** (OLS log-slope over 60–1440 min, damping 0.1–1.0;
  EWMA drift; AR on past 4 h returns): loses to persistence on the rolling
  backtest at every setting except heavily damped long windows (≈ neutral).
  On the six official practice cases a short-window trend looks great
  (−19%) — that is 6-point noise contradicting the 33-point backtest, and
  it was not trusted.
- **Strong reversion** (k = 0.5, or reverting only when the deviation exceeds
  1σ of recent 4 h moves): best on the pool rolling test (−9%) but costs
  +8–16% on Binance — too much downside if the effect is weaker in the
  final window.
- **Median-of-last-hour as the forecast**: −5.3% worse than persistence;
  the last price carries real information and should not be discarded.

## Backtest results (MAE, cents)

| Test set | Model | Persistence | Difference |
|---|---|---|---|
| Pool, 33 rolling checkpoints | 47,525 | 50,162 | −5.3% |
| Pool, 6 official practice cases | 43,437 | 44,522 | −2.4% |
| Binance BTC/USDT, 162 checkpoints | 43,036 | 42,125 | +2.2% |

Split-half on the pool rolling test: the model loses to persistence in the
first half (a hard down-move, 62,733 vs 58,128) and wins big in the second
(32,905 vs 42,011). The edge is regime-dependent — the honest expectation
for the final is a small improvement over persistence if the 48 h window
mixes trends and chop, and a small loss if it trends hard throughout.

## Runtime properties

- Node 22, standard library only, no network, no randomness, no clock:
  two runs produce byte-identical output.
- ~1 s per case locally (mostly Node startup) vs the 8 s cap.
- Any model failure falls back to persistence; output is always exactly
  `{"forecasts":[{"case":"<id>","price":<number>}]}` with the price on the
  5-decimal grid inside (0, 10,000,000).
