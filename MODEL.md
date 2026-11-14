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
anchor   = median(prices[-240:])
forecast = last + 0.25 * (anchor - last)
```

i.e. shrink the checkpoint close 25% of the way toward the median of the
last 4 hours of closes. One anchor, one parameter — the simplest model that
wins on the pooled evidence.

## Why this anchor (v2, 2026-11-14)

The v1 model used `0.5 * median(last 480) + 0.5 * mean(last 360)` with the
same 0.25 shrinkage. It looked good on the 6 official practice cases
(-2.4%) but that is one 4-day regime driven by a single case (p03), and it
cost +1.8% pooled on Binance. The v2 anchor was chosen on much larger
evidence: **617 non-overlapping 4 h checkpoints of the pool itself**
(GeckoTerminal 1-min OHLCV of the same Whirlpool, 2026-08-01 → 2026-11-13,
forward-filled onto a 1-minute grid exactly as the recorder does) plus
**612 checkpoints of Binance BTC/USDT** over the same months. The
GeckoTerminal series was validated against the kit's practice recording:
same model ranking on the same window (it reproduces the v1 edge's sign
and order), with magnitudes attenuated ~2x by ~$185 of spread noise that
the recorder's series does not carry — so the pool numbers below are
conservative estimates of the edge on the recorder's series.

The 4 h median beats the v1 anchor in **every pool month and every Binance
month**, and wins on the pool in every month:

| Pool month | v2 (4 h median, k=0.25) | v1 (8 h med / 6 h mean) |
|---|---|---|
| Aug 2026 (n=167) | -0.5% | -0.2% |
| Sep 2026 (n=161) | -2.9% | -2.4% |
| Oct 2026 (n=167) | -3.8% | -1.8% |
| Nov 2026 (n=61) | -1.8% | +0.1% |
| Pooled (n=617) | **-2.3%** (95% CI [-3.9%, -0.7%]) | -1.2% (CI includes 0) |

The mechanism: the shorter anchor tracks the recent level with less lag.
In a sustained trend a long anchor lags badly and the forecast fights the
trend too hard (v1 loses the Nov pool window and does poorly on Binance
Aug/Sep); in a reversal the long anchor wins — but reversals are less
common than trend continuations, and the pooled data says so.

## Evidence

Practice data: the six kit cases were merged into one continuous minute
series (2026-11-07 06:01Z → 2026-11-11 02:00Z, 5,520 minutes, no gaps).
Actuals for p00–p04 are the next case's checkpoint close; p05's actual
($73,864.44) was recovered from the published baseline total (267,129.46
cents over six cases) with the direction (up) confirmed against Binance
BTC/USDT. The recovered actuals reproduce the published persistence
baseline (44,521.58 cents) to within rounding.

Regression diagnostic (33 rolling checkpoints, 30 min apart):
regressing the 4 h-ahead log return on log(last / 8 h median) gives a
coefficient of −0.71 (t = −3.6, R² = 0.29) on the pool series, vs −0.09
(t = −1.0, R² = 0.006) on 162 non-overlapping Binance BTC/USDT checkpoints.
The reversion is real on the pool and absent on a deep market — it is a
pool-microstructure effect, which is exactly the series being scored. (The
t-statistic overstates significance: the 33 checkpoints overlap, so the
effective sample is smaller.)

## What was tried and rejected (v2 sweep, 2026-11-14)

All variants were scored on the same checkpoints: pool 617 + Binance 612
non-overlapping, kit practice 33 rolling. A variant had to win on the pool
pooled AND in every pool window to be considered; Binance was the
robustness check (no variant beats persistence on Binance by a clear
margin — BTC on a deep market is near-random-walk at 4 h, so the Binance
test is about limiting the downside, not finding an edge there).

- **Stronger shrinkage (k = 0.30–0.50, 4 h median)**: pool pooled improves
  only to -2.4%/-2.5% (diminishing returns) while the Binance cost rises
  to +1.0%/+1.7%. k = 0.25 is the sweet spot; k = 0.20 (-2.1% pool,
  +0.1% Binance) is nearly as good.
- **Longer median anchors (360/480/720/1440 min)**: worse on pooled pool
  data (-1.6%/-0.6%/+0.5%/+4.0%) and much worse on Binance (+1.6%/+2.5%/
  +4.8%/+10.7%). The long anchor only wins in the single practice window
  (a downtrend that reverses) — one regime, not a general property.
- **EWMA anchors**: worse than medians everywhere (h=720: +4.2% pool,
  +9.4% Binance).
- **Trend extrapolation** (OLS log-slope over 60–1440 min, damping 0.1–1.0;
  EWMA drift; AR on past 4 h returns): loses to persistence on the pool
  (+2.5% to +6.0% pooled) and on Binance at every setting. On the six
  official practice cases a short-window trend looks great (−19%) — that
  is 6-point noise contradicting the 617-point backtest, and it was not
  trusted.
- **Ensemble (persistence + mean-reversion + momentum, averaged)**: the
  most robust profile (wins or ties on every dataset) but a small pool
  edge (-0.6% pooled) — it dilutes the one real signal with two dead ones.
- **Median-of-last-K as the base price** (instead of the last close):
  loses on the kit series (-5.3% worse than persistence for K=60) and is
  neutral-to-negative pooled; the last price carries real information.
- **Volatility-adjusted shrinkage** (shrink k when recent volatility is
  high): -1.2% pool pooled, worse than fixed k; it shrinks exactly when
  the displacement signal is largest.
- **Regime gates** (OLS-slope t-stat, drift-ratio, variance-ratio,
  deviation-size): all fail. The t-stat gate never fires (n=4320 makes
  every slope "significant"); the variance ratio is < 1 almost always
  (a microstructure artifact of 1-min noise, not a reversion signal);
  the deviation-size gate fires only on large deviations — which are
  real trends, where reverting loses (+1.5% pooled).
- **Adaptive in-window regression** (estimate the reversion coefficient
  from the case's own 72 h, shrunk toward a prior): -0.4% pool pooled,
  loses the Nov window (+2.5%) — the coefficient estimate from 72 h of
  overlapping checkpoints is too noisy to help.
- **Asymmetric shrinkage** (different k above/below the anchor):
  no consistent gain in either direction across windows.
- **Time-of-day / day-of-week effects**: no significant 4 h-ahead return
  by checkpoint hour on either dataset (the largest |t| is 2.07 in one
  of 12 hour-bins tested — expected by chance, and it does not replicate
  across datasets or align with the final's checkpoint hours). Weekend
  vs weekday: nothing. Rejected as noise.

## Backtest results (MAE, cents) — v2 model

| Test set | Model | Persistence | Difference |
|---|---|---|---|
| Pool (GeckoTerminal), 617 non-overlapping 4 h checkpoints | 45,079 | 46,154 | **-2.3%** |
| Pool, Aug 2026 (n=167) | — | — | -0.5% |
| Pool, Sep 2026 (n=161) | — | — | -2.9% |
| Pool, Oct 2026 (n=167) | — | — | -3.8% |
| Pool, Nov 2026 (n=61) | — | — | -1.8% |
| Binance BTC/USDT, 612 non-overlapping 4 h checkpoints | 38,068 | 37,881 | +0.5% (n.s.) |
| Kit practice, 33 rolling checkpoints | 48,790 | 50,162 | -2.7% |
| Kit practice, 6 official cases p00–p05 | 45,502 | 44,522 | +2.2% (n=6, n.s.) |

The 6-case practice result is the honest caveat: on that one 4-day
window the v1 anchor wins (-2.4%) and v2 loses (+2.2%), driven by a
single case (p03). The paired difference on 6 cases is not significant
(t ≈ 0.8), while the 617-checkpoint pooled pool edge is (95% CI excludes
0, wins in all 4 months). The final is 12 checkpoints on the pool over
48 h; the pooled evidence is the better guide, and the GeckoTerminal
attenuation means the true recorder-series edge is likely larger than
-2.3% (on the practice window the same model scores -2.7% on the kit
series vs -1.2% on GeckoTerminal data).

Win rate vs persistence on the pooled pool data: 57% of checkpoints
(54–59% in every month). The edge is small and the final's 12
checkpoints carry large sampling variance — no model can guarantee a
top-3 finish; this one maximizes the expected improvement over
persistence subject to a small, statistically insignificant downside
if the final window behaves like a deep market.

## Runtime properties

- Node 22, standard library only, no network, no randomness, no clock:
  two runs produce byte-identical output.
- ~0.1 s per case locally (mostly Node startup) vs the 8 s cap.
- Any model failure falls back to persistence; output is always exactly
  `{"forecasts":[{"case":"<id>","price":<number>}]}` with the price on the
  5-decimal grid inside (0, 10,000,000).

## Reproducing the backtest

Harness and data (not part of the entry): `~/workspace/makefun/btc-cent-improve/` —
`backtest.py` (models + evaluation), `data/binance_1m.npz` (Binance
BTC/USDT 1 m, Aug 1 – Nov 13 2026, from data.binance.vision),
`data/pool_1m.json` / `data/pool_gecko_1m.npz` (GeckoTerminal 1-min OHLCV
of Whirlpool HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM, Jul 31 – Nov 14
2026), `data/results_round2.json` (full per-window tables).
