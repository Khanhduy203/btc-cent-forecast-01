// btc-cent-forecast-01 entry (Node 22, standard library only): a damped
// mean-reversion forecast of Bitcoin's price 240 minutes after each checkpoint.
//
// Model: shrink the checkpoint close 25% of the way toward a short-horizon
// "fair value" anchor — the average of the median of the last 480 closes
// (8 h) and the mean of the last 360 closes (6 h):
//
//   anchor   = 0.5 * median(prices[-480:]) + 0.5 * mean(prices[-360:])
//   forecast = last + 0.25 * (anchor - last)
//
// Why: the price here is one thin Orca Whirlpool's mid price, not a deep
// exchange index. A large trade displaces it for a while and it then drifts
// back toward the broader market. The 8 h median / 6 h mean proxy that
// broader level from the case's own 72 h of closes, and the median is robust
// to the pool's jumpy prints. The 25% shrinkage is deliberately mild: the
// in-sample regression of the 4 h-ahead return on the deviation from the
// 8 h median implies a much larger coefficient, but the checkpoints overlap
// and the effect is regime-dependent (it pays in choppy stretches and costs
// in hard trends), so the forecast stays close to persistence.
//
// Backtest (see MODEL.md): on the practice recording, a rolling 30-minute
// backtest over 33 checkpoints scores 47,525 cents MAE vs 50,162 for
// persistence (-5.3%); on the six official practice cases 43,437 vs 44,522
// (-2.4%). On 162 non-overlapping 4 h checkpoints of Binance BTC/USDT the
// same model costs +2.2% vs persistence, which is the honest price if the
// final window behaves like a deep market instead of the pool. Trend
// extrapolation was tested and rejected: it loses to persistence on the
// rolling backtest at every horizon/damping tried.
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

/** Median window in minutes (8 h). */
const MEDIAN_WINDOW = 480;
/** Mean window in minutes (6 h). */
const MEAN_WINDOW = 360;
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

/** Arithmetic mean of a non-empty array. */
function mean(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
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
 * toward the anchor (mean of the 8 h median and the 6 h mean). Falls back to
 * persistence on any failure so a case is never invalidated by the model.
 */
function forecast(m: CaseMarket): number {
  const last = persistence(m); // validates the series; also the fallback value
  try {
    const prices = m.prices as number[];
    const medN = Math.min(MEDIAN_WINDOW, prices.length);
    const meanN = Math.min(MEAN_WINDOW, prices.length);
    const anchor = 0.5 * median(prices.slice(-medN)) + 0.5 * mean(prices.slice(-meanN));
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
