// 円盤モデル (§1)。対数等間隔のセルごとに gas / rock / metal / ice [M⊕] を管理する。
import { MSUN_IN_MEARTH, SNOWLINE_1LSUN } from './constants.js';

export function snowline(luminosity) {
  return SNOWLINE_1LSUN * Math.sqrt(luminosity);
}

/** ∫ r^{1-p} dr */
function radialIntegral(p, r1, r2) {
  if (Math.abs(p - 2) < 1e-12) return Math.log(r2 / r1);
  return (Math.pow(r2, 2 - p) - Math.pow(r1, 2 - p)) / (2 - p);
}

/** 初期構造（リング/ギャップ）による係数 */
function structureFactor(structures, r) {
  let f = 1;
  for (const s of structures) {
    const x = Math.log(r / s.r);
    f *= 1 + s.amp * Math.exp(-(x * x) / (2 * s.width * s.width));
  }
  return f;
}

/**
 * @param {import('./types.js').Star} star
 * @param {import('./types.js').DiskParams} dp
 * @param {typeof import('./params.js').DEFAULT_PARAMS} params
 */
export function createDisk(star, dp, params) {
  const N = params.nCells;
  const { rIn, rOut, p } = dp;
  for (const s of dp.structures) {
    if (!(s.amp > -1)) throw new Error('structure.amp must be > -1');
  }
  const edges = new Float64Array(N + 1);
  const center = new Float64Array(N);
  const width = new Float64Array(N);
  const area = new Float64Array(N);
  for (let j = 0; j <= N; j++) edges[j] = rIn * Math.pow(rOut / rIn, j / N);
  for (let j = 0; j < N; j++) {
    center[j] = Math.sqrt(edges[j] * edges[j + 1]);
    width[j] = edges[j + 1] - edges[j];
    area[j] = Math.PI * (edges[j + 1] ** 2 - edges[j] ** 2);
  }

  const mDisk = dp.mass * MSUN_IN_MEARTH;
  const mGas = mDisk / (1 + params.gasDustRatio0 * star.Z);
  const snow = snowline(star.luminosity);

  // ガスの質量分布: 滑らかなべき法則 × 構造 を、総量が M_gas に戻るよう再規格化
  const gas = new Float64Array(N);
  const outerFrac = new Float64Array(N); // セルのうち r >= スノーライン にあるガスの割合
  let sum = 0;
  for (let j = 0; j < N; j++) {
    const smooth = radialIntegral(p, edges[j], edges[j + 1]);
    gas[j] = smooth * structureFactor(dp.structures, center[j]);
    sum += gas[j];
    if (snow <= edges[j]) outerFrac[j] = 1;
    else if (snow < edges[j + 1]) outerFrac[j] = radialIntegral(p, snow, edges[j + 1]) / smooth;
  }
  for (let j = 0; j < N; j++) gas[j] *= mGas / sum;

  // 固体: Σ_s = Z ζ(r) Σ_g。rock+metal は全域、ice はスノーライン外側のみ
  const rock = new Float64Array(N);
  const metal = new Float64Array(N);
  const ice = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const refractory = star.Z * params.zetaRock * gas[j];
    metal[j] = refractory * params.fMetal;
    rock[j] = refractory * (1 - params.fMetal);
    ice[j] = star.Z * params.zetaIce * gas[j] * outerFrac[j];
  }

  // Type I 移動の基準: t=0 の 1 AU のガス表面密度（1 AU が円盤外ならクランプ）
  const jRef = Math.min(N - 1, Math.max(0, Math.floor((N * Math.log(1 / rIn)) / Math.log(rOut / rIn))));
  const sigmaRef = gas[jRef] / area[jRef];

  // 小石の流入（v2）: 外から流れ込む小石が、スノーライン内側に溜まる。内側の岩石・金属の表面密度が増え、そこで育つ種（孤立質量）が重くなる。
  // 足す量 = スノーライン外側の固体の質量 × 岩石・金属の割合 × pebbleFrac。外側の固体は減らさない（遠い円盤から来る分として足す）。
  // 足した分は、初期の総量（mInitial）に含めるので、質量保存の検査は、そのまま成り立つ。
  if (params.pebbleFrac > 0) {
    let outerSolid = 0;
    for (let j = 0; j < N; j++) outerSolid += (rock[j] + metal[j] + ice[j]) * outerFrac[j];
    const refractoryShare = params.zetaRock / (params.zetaRock + params.zetaIce);
    const inflow = params.pebbleFrac * refractoryShare * outerSolid;
    const recv = new Float64Array(N); // 受け取る重み（スノーライン内側のセル。固体の表面密度 ∝ r^-κ）
    let wSum = 0;
    for (let j = 0; j < N; j++) {
      if (edges[j + 1] <= snow) { recv[j] = area[j] * Math.pow(center[j], -params.pebbleKappa); wSum += recv[j]; }
    }
    if (wSum > 0) {
      for (let j = 0; j < N; j++) {
        const add = (inflow * recv[j]) / wSum;
        metal[j] += add * params.fMetal;
        rock[j] += add * (1 - params.fMetal);
      }
    }
  }

  const solid0 = new Float64Array(N);
  let mInitial = 0;
  for (let j = 0; j < N; j++) {
    solid0[j] = rock[j] + metal[j] + ice[j];
    mInitial += gas[j] + solid0[j];
  }

  return {
    N, rIn, rOut, edges, center, width, area,
    gas, rock, metal, ice,
    sigmaRef,
    solid0, // 初期の固体総量（M_iso 用の Σ_s と、種の位置抽選に使う）
    tauD: dp.tLife / Math.log(100), // T_life = ガスが1%になる時間
    tLife: dp.tLife,
    snow,
    mInitial,
    lost: { dispersed: 0, ejected: 0 }, // 散逸で失われたガス / 系外へ放出された質量
  };
}

/** @typedef {ReturnType<typeof createDisk>} Disk */

/** 半径 a を含むセル番号（範囲外はクランプ） */
export function cellIndexAt(disk, a) {
  const j = Math.floor((disk.N * Math.log(a / disk.rIn)) / Math.log(disk.rOut / disk.rIn));
  return Math.min(disk.N - 1, Math.max(0, j));
}

/** 初期の固体表面密度 Σ_s [M⊕/AU²] */
export function solidSurfaceDensity0(disk, a) {
  const j = cellIndexAt(disk, a);
  return disk.solid0[j] / disk.area[j];
}

/** 現在のガス表面密度 Σ_g [M⊕/AU²] */
export function gasSurfaceDensity(disk, j) {
  return disk.gas[j] / disk.area[j];
}

export function solidInCell(disk, j) {
  return disk.rock[j] + disk.metal[j] + disk.ice[j];
}

export function totalRemaining(disk) {
  let s = 0;
  for (let j = 0; j < disk.N; j++) s += disk.gas[j] + disk.rock[j] + disk.metal[j] + disk.ice[j];
  return s;
}

/**
 * ガスを散逸則で更新する。t+dt >= T_life ならゼロに打ち切る。
 * 減った分は disk.lost.dispersed に加算（質量保存）。
 * @returns {{ lost: number, dispersedNow: boolean }}
 */
export function dissipateGas(disk, t, dt) {
  let lost = 0;
  const dispersedNow = t < disk.tLife && t + dt >= disk.tLife;
  const factor = t + dt >= disk.tLife ? 0 : Math.exp(-dt / disk.tauD);
  for (let j = 0; j < disk.N; j++) {
    const g = disk.gas[j];
    const rest = g * factor;
    lost += g - rest;
    disk.gas[j] = rest;
  }
  disk.lost.dispersed += lost;
  return { lost, dispersedNow };
}

/**
 * セル j から固体を amount 取り出す。足りなければ隣のセルへ広げる。
 * 種の初期質量を円盤から差し引くために使う。
 * @returns {{ metal: number, rock: number, ice: number }}
 */
export function withdrawSolids(disk, j, amount) {
  const got = { metal: 0, rock: 0, ice: 0 };
  let remaining = amount;
  for (let k = 0; k < 2 * disk.N && remaining > 1e-15; k++) {
    // j, j+1, j-1, j+2, j-2, ... の順
    const offset = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2;
    const c = j + offset;
    if (c < 0 || c >= disk.N) continue;
    const avail = solidInCell(disk, c);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    const frac = take / avail;
    for (const key of ['metal', 'rock', 'ice']) {
      const x = Math.min(disk[key][c], disk[key][c] * frac);
      disk[key][c] -= x;
      got[key] += x;
    }
    remaining -= take;
  }
  if (remaining > 1e-9) throw new Error('withdrawSolids: not enough solids in disk');
  return got;
}
