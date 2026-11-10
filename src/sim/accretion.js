// 固体獲得 (§2): ヒル半径で決まる獲得帯、重なりの正規化、孤立質量による抑制。
import { MSUN_IN_MEARTH } from './constants.js';
import { cellIndexAt, solidInCell, solidSurfaceDensity0 } from './disk.js';

export function hillRadius(a, mass, mStarEarth) {
  return a * Math.cbrt(mass / (3 * mStarEarth));
}

/** 公転角速度 Ω [rad/yr]。mStarSun は M☉ */
export function omega(a, mStarSun) {
  return 2 * Math.PI * Math.sqrt(mStarSun / (a * a * a));
}

/** M_iso = (2π b a² Σ_s)^{3/2} / (3 M★)^{1/2} */
export function isolationMass(a, sigmaS, b, mStarEarth) {
  return Math.pow(2 * Math.PI * b * a * a * sigmaS, 1.5) / Math.sqrt(3 * mStarEarth);
}

export const solidMass = (p) => p.mass.metal + p.mass.rock + p.mass.ice;

/**
 * 各惑星の獲得帯と、重なりを正規化した割合 w_ij を求める。
 * @returns {{ j0: number, w: Float64Array }[]}
 */
export function computeWeights(planets, disk, params, mStarEarth) {
  const bands = planets.map((p) => {
    const half = (params.b * hillRadius(p.a, p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas, mStarEarth)) / 2;
    const lo = Math.max(disk.rIn, p.a - half);
    const hi = Math.min(disk.rOut, p.a + half);
    if (hi <= lo) return { j0: cellIndexAt(disk, p.a), f: new Float64Array(0) };
    const j0 = cellIndexAt(disk, lo);
    const j1 = cellIndexAt(disk, hi);
    const f = new Float64Array(j1 - j0 + 1);
    for (let j = j0; j <= j1; j++) {
      const overlap = Math.min(hi, disk.edges[j + 1]) - Math.max(lo, disk.edges[j]);
      f[j - j0] = Math.max(0, overlap) / disk.width[j];
    }
    return { j0, f };
  });
  const sumF = new Float64Array(disk.N);
  for (const bd of bands) bd.f.forEach((v, k) => (sumF[bd.j0 + k] += v));
  return bands.map((bd) => {
    const w = new Float64Array(bd.f.length);
    bd.f.forEach((v, k) => (w[k] = v / Math.max(1, sumF[bd.j0 + k])));
    return { j0: bd.j0, w };
  });
}

/**
 * 固体を獲得する。セルから実際に差し引き、惑星に加算する（質量保存）。
 * 速度式 η Ω M_feed g(Mc/M_iso) を、刻みが長くても破綻しないよう
 * ΔM = M_feed (1 - exp(-η Ω g Δt)) の形で積分する（Δt が小さい極限は仕様書の式と一致）。
 */
export function accreteSolids(planets, disk, params, star, dt, weights = computeWeights(planets, disk, params, star.mass * MSUN_IN_MEARTH)) {
  const mStarEarth = star.mass * MSUN_IN_MEARTH;

  // 全惑星の取り分を、更新前のセル内容から先に計算する（惑星の処理順に依存させない）
  const plan = planets.map((p, i) => {
    const { j0, w } = weights[i];
    let feed = 0;
    for (let k = 0; k < w.length; k++) feed += w[k] * solidInCell(disk, j0 + k);
    const mc = solidMass(p);
    const miso = isolationMass(p.a, solidSurfaceDensity0(disk, p.a), params.b, mStarEarth);
    const g = miso > 0 ? 1 / (1 + Math.pow(mc / miso, 4)) : 0;
    const rate = params.eta * omega(p.a, star.mass) * g;
    const delta = feed * (1 - Math.exp(-rate * dt));
    return { j0, w, feed, delta };
  });

  const orig = {
    metal: Float64Array.from(disk.metal),
    rock: Float64Array.from(disk.rock),
    ice: Float64Array.from(disk.ice),
  };
  planets.forEach((p, i) => {
    const { j0, w, feed, delta } = plan[i];
    if (!(delta > 0) || !(feed > 0)) return;
    for (let k = 0; k < w.length; k++) {
      const j = j0 + k;
      const m = orig.metal[j] + orig.rock[j] + orig.ice[j];
      if (!(m > 0)) continue;
      // セル j からの取り分: delta × (w m_j / feed)。取り分は w m_j 以下なので重なりの二重取得は起きない
      const frac = Math.min(1, (delta * w[k]) / feed);
      for (const key of ['metal', 'rock', 'ice']) {
        const x = Math.min(disk[key][j], orig[key][j] * frac);
        disk[key][j] -= x;
        p.mass[key] += x;
      }
    }
  });
}
