// Score = logistic model on three unevenness features (weights from 85 people in
// two clinic studies). Meaning = where that score falls among browser typists of
// the same age and typing speed (9,145 people). Made by research/final.py.
import data from '../../model.json';
import type { Features } from './features';

interface Linear { mean: number[]; scale: number[]; coef: number[]; intercept: number }
export interface Model { model: Linear; grid: number[][][] }

export const FLAG = data.flag;
export const TYPICAL = data.typical as Record<string, number[]>;
export const MAIN: Model = { model: data.model, grid: data.grid };
/** Trained on one clinic study only; used for the example people, who come from the other. */
export const HELDOUT: Model = data.heldout;
export const AGE_RANGE = [data.ages[0], data.ages[data.ages.length - 1]];
export const GAP_RANGE = [data.gaps[0], data.gaps[data.gaps.length - 1]];

const { ages, gaps, pcts } = data;

export function score(f: Features, m: Model = MAIN): number {
  return (data.features as ('iqr' | 'wsd' | 'adj')[]).reduce((s, k, i) => s + m.model.coef[i] * ((Math.log(Math.max(f[k], 1e-4)) - m.model.mean[i]) / m.model.scale[i]), m.model.intercept);
}

const cell = (arr: number[], x: number) => {
  let i = 0;
  while (i < arr.length - 2 && x >= arr[i + 1]) i++;
  return i;
};
const clamp = (x: number, a: number[]) => Math.min(Math.max(x, a[0]), a[a.length - 1]);

/** Score at each reference percentile for people of this age and speed. */
export function referenceRow(age: number, gap: number, m: Model = MAIN): number[] {
  const a = clamp(age, ages);
  const lg = gaps.map(Math.log);
  const g = Math.log(clamp(gap, gaps));
  const i = cell(ages, a), j = cell(lg, g);
  const u = (a - ages[i]) / (ages[i + 1] - ages[i]), v = (g - lg[j]) / (lg[j + 1] - lg[j]);
  return pcts.map((_, k) => (1 - u) * (1 - v) * m.grid[i][j][k] + u * (1 - v) * m.grid[i + 1][j][k] + (1 - u) * v * m.grid[i][j + 1][k] + u * v * m.grid[i + 1][j + 1][k]);
}

export function percentile(s: number, age: number, gap: number, m: Model = MAIN): number {
  const r = referenceRow(age, gap, m);
  if (s <= r[0]) return pcts[0];
  if (s >= r[r.length - 1]) return pcts[pcts.length - 1];
  let k = 0;
  while (s >= r[k + 1]) k++;
  return pcts[k] + ((pcts[k + 1] - pcts[k]) * (s - r[k])) / (r[k + 1] - r[k]);
}

export type Band = 'usual' | 'little' | 'flag';
export const band = (p: number): Band => (p >= FLAG ? 'flag' : p >= 80 ? 'little' : 'usual');
