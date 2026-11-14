# btc-cent-forecast-01 — damped mean-reversion forecast

Entry for the make.fun competition **btc-cent-forecast-01**: forecast Bitcoin's
US-dollar price 240 minutes after each of twelve checkpoints, 4 hours apart over
the 48 hours after the deadline. Score is mean absolute error in cents; a prize
needs a score strictly below the house persistence baseline.

## The program

`main.ts` (Node 22, standard library only, no network) reads each case's 4,320
one-minute closes (72 h up to the checkpoint) and writes one forecast:

```
anchor   = median(last 240 closes)
forecast = last close + 0.25 * (anchor - last close)
```

The price is one thin Orca Whirlpool's (cbBTC/USDC) mid price, not a deep
exchange index: a large trade displaces it and it then drifts back toward the
broader market. The 4 h median proxies that broader level from the case's
own history, and the median is robust to the pool's jumpy prints. The 25%
shrinkage is deliberately mild — the in-sample regression implies a much
larger coefficient, but the effect is regime-dependent (it pays in choppy
stretches, costs in hard trends), so the forecast stays close to persistence.
The 4 h median anchor was chosen over the earlier 8 h median / 6 h mean
anchor on 617 pool checkpoints across 4 months: it wins on the pool in
every month and beats the earlier anchor in every pool month and every
Binance month. Trend extrapolation, ensembles, vol-adjusted and regime-gated
shrinkage, adaptive in-window regression and time-of-day effects were all
tested and rejected — none robustly beats this. Full design and backtest
numbers: [MODEL.md](MODEL.md).

Deterministic (no randomness, no clock), runs in ~0.1 s per case against the
8 s cap, and falls back to persistence (the checkpoint close) if the model
computation ever fails, so a case is never invalidated by the model.

## Test locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Backtest summary (honest numbers)

| Test set | Model MAE | Persistence MAE | vs baseline |
|---|---|---|---|
| Pool (GeckoTerminal), 617 non-overlapping 4 h checkpoints | 45,079 cents | 46,154 cents | **−2.3%** |
| Pool, Aug / Sep / Oct / Nov 2026 | — | — | −0.5% / −2.9% / −3.8% / −1.8% |
| Binance BTC/USDT, 612 non-overlapping 4 h checkpoints | 38,068 cents | 37,881 cents | +0.5% (not significant) |
| Practice recording, 33 rolling checkpoints (30 min apart) | 48,790 cents | 50,162 cents | **−2.7%** |
| Six official practice cases p00–p05 | 45,502 cents | 44,522 cents | +2.2% (n=6, not significant) |

The Binance row is the cost if the final window behaves like a deep liquid
market instead of the pool: the mean-reversion edge is pool-specific
(regression of the 4 h-ahead return on the deviation from the 8 h median:
coefficient −0.71, t = −3.6 on the pool series vs −0.09, t = −1.0 on Binance).
No variant tested beats persistence on Binance by a clear margin — BTC on a
deep market is near-random-walk at 4 h — so the Binance test is about
limiting the downside, and this model's +0.5% is statistically
indistinguishable from persistence. The 6-case practice result is the honest
caveat: on that one 4-day window the earlier anchor wins, driven by a single
case; the 617-checkpoint pooled edge is the reliable guide, and the
GeckoTerminal pool series carries ~$185 of spread noise the recorder's
series does not, so the true pool edge is likely larger than −2.3%.
The practice score is no guide to the final — the final is scored on prices
nobody has seen.

## Prize structure

$250 in USDC over 100 places: 1st $40, 2nd $25, 3rd $15, 4th–10th $5 each,
11th–100th $1.50 each. One place per entrant; a prize needs every case valid
and a score strictly below the house baseline's on the final.

## License

MIT — see [LICENSE](LICENSE).
