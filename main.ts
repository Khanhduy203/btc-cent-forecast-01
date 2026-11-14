// btc-cent-forecast-01 entry (Node 22, standard library only): a damped
// mean-reversion forecast of Bitcoin's price 240 minutes after each checkpoint.
//
// Model: shrink the checkpoint close 25% of the way toward the median of
// the last 240 closes (4 h):
//
//   anchor   = median(prices[-240:])
//   forecast = last + 0.25 * (anchor - last)
//
// Why: the price here is one thin Orca Whirlpool's mid price, not a deep
// exchange index. A large trade displaces it for a while and it then drifts
// back toward the broader market. The 4 h median proxies that broader level
// from the case's own 72 h of closes, and the median is robust to the pool's
// jumpy prints. The 25% shrinkage is deliberately mild: the in-sample
// regression of the 4 h-ahead return on the deviation from the anchor
// implies a much larger coefficient, but the effect is regime-dependent (it
// pays in choppy stretches and costs in hard trends), so the forecast stays
// close to persistence.
//
// Why the 4 h median (and not the earlier 8 h median / 6 h mean anchor):
// backtested on 617 non-overlapping 4 h checkpoints of the pool itself
// (GeckoTerminal OHLCV of the same Whirlpool, Aug-Nov 2026, validated
// against the kit's practice recording) and 612 checkpoints of Binance
// BTC/USDT, the 4 h median anchor wins on the pool in every month
// (Aug -0.5%, Sep -2.9%, Oct -3.8%, Nov -1.8%; pooled -2.3%, 95% CI
// [-3.9%, -0.7%]) and beats the earlier anchor in every pool month and
// every Binance month. The earlier anchor's edge on the 6 official
// practice cases (-2.4% vs +2.2% for this model) is one 4-day regime
// driven by a single case and is not significant (paired t ~ 0.8 on 6
// cases); the 617-checkpoint pooled evidence is the reliable guide.
// See MODEL.md for the full backtest table and the variants rejected
// (momentum, ensembles, vol-adjusted and regime-gated shrinkage, adaptive
// in-window regression, time-of-day effects — none robustly beats this).
//
// Backtest (MAE, cents; see MODEL.md):
//   Pool (GeckoTerminal), 617 checkpoints: 45,079 vs 46,154 persistence (-2.3%)
//   Binance BTC/USDT, 612 checkpoints:    38,068 vs 37,881 persistence (+0.5%,
//     not significant — 95% CI [-1.3%, +2.2%])
//   Kit practice, 33 rolling checkpoints: 48,790 vs 50,162 persistence (-2.7%)
// The GeckoTerminal pool series carries ~$185 of spread noise that the
// recorder's series does not, so the pool edge above is a conservative
// (attenuated) estimate: on the practice window the same model scores
// -2.7% on the kit series vs -1.2% on GeckoTerminal data.
//
// Contract (same as the kit's starter): read every <id>.in in the input
// directory (the grader runs one case at a time, with only that case's file
// there), canonical JSON {"schema":"makefun/btc-cent-case/v1", ...} with one
// market holding 4,320 one-minute closes ending at the checkpoint; write
// <id>.out to the output directory:
// {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly one
// row, the price on the 5-decimal grid inside (0, 10,000,000).
//
// It runs offline, with no network, under the case's 8-second cap, and is
// fully deterministic: no randomness, no time or date input, so two runs
// write the same bytes. Any failure of the model computation falls back to
// persistence (the checkpoint close) rather than crashing the case, and a
// non-finite anchor does the same; only a case with no usable last price at
// all can fail, and the grader's cases always carry 4,320 closes.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Median window in minutes (4 h). */
const MEDIAN_WINDOW = 240;
/** Fraction of the way from the last close toward the anchor. */
const SHRINK = 0.25;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** Median of a non-empty array (average of the two middle values if even). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The persistence guess of one market: its last close, the price at the checkpoint. */
function persistence(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`market ${m.id}'s last price is not a finite number`);
  return price5(x);
}

/**
 * The model's guess for one market: the last close shrunk SHRINK of the way
 * toward the anchor (median of the last MEDIAN_WINDOW closes). Falls back to
 * persistence on any failure so a case is never invalidated by the model.
 */
function forecast(m: CaseMarket): number {
  const last = persistence(m); // validates the series; also the fallback value
  try {
    const prices = m.prices as number[];
    const n = Math.min(MEDIAN_WINDOW, prices.length);
    const anchor = median(prices.slice(-n));
    if (!Number.isFinite(anchor)) return last;
    const guess = prices[prices.length - 1] as number;
    return price5(guess + SHRINK * (anchor - guess));
  } catch {
    return last;
  }
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
