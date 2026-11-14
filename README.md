# btc-cent-forecast-01 — damped mean-reversion forecast

Entry for the make.fun competition **btc-cent-forecast-01**: forecast Bitcoin's
US-dollar price 240 minutes after each of twelve checkpoints, 4 hours apart over
the 48 hours after the deadline. Score is mean absolute error in cents; a prize
needs a score strictly below the house persistence baseline.

## The program

`main.ts` (Node 22, standard library only, no network) reads each case's 4,320
one-minute closes (72 h up to the checkpoint) and writes one forecast:

```
anchor   = 0.5 * median(last 480 closes) + 0.5 * mean(last 360 closes)
forecast = last close + 0.25 * (anchor - last close)
```

The price is one thin Orca Whirlpool's (cbBTC/USDC) mid price, not a deep
exchange index: a large trade displaces it and it then drifts back toward the
broader market. The 8 h median / 6 h mean proxy that broader level from the
case's own history, and the median is robust to the pool's jumpy prints. The
25% shrinkage is deliberately mild — the in-sample regression implies a much
larger coefficient, but the effect is regime-dependent (it pays in choppy
stretches, costs in hard trends), so the forecast stays close to persistence.
Trend extrapolation was tested and rejected: it loses to persistence on the
rolling backtest at every horizon/damping tried. Full design and backtest
numbers: [MODEL.md](MODEL.md).

Deterministic (no randomness, no clock), runs in ~1 s per case against the
8 s cap, and falls back to persistence (the checkpoint close) if the model
computation ever fails, so a case is never invalidated by the model.

## Test locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Backtest summary (honest numbers)

| Test set | Model MAE | Persistence MAE | vs baseline |
|---|---|---|---|
| Practice recording, 33 rolling checkpoints (30 min apart) | 47,525 cents | 50,162 cents | **−5.3%** |
| Six official practice cases p00–p05 | 43,437 cents | 44,522 cents | **−2.4%** |
| Binance BTC/USDT, 162 non-overlapping 4 h checkpoints | 43,036 cents | 42,125 cents | +2.2% |

The Binance row is the cost if the final window behaves like a deep liquid
market instead of the pool: the mean-reversion edge is pool-specific
(regression of the 4 h-ahead return on the deviation from the 8 h median:
coefficient −0.71, t = −3.6 on the pool series vs −0.09, t = −1.0 on Binance).
The practice score is no guide to the final — the final is scored on prices
nobody has seen.

## Prize structure

$250 in USDC over 100 places: 1st $40, 2nd $25, 3rd $15, 4th–10th $5 each,
11th–100th $1.50 each. One place per entrant; a prize needs every case valid
and a score strictly below the house baseline's on the final.

## License

MIT — see [LICENSE](LICENSE).
