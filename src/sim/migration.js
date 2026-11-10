// 軌道移動 (§4): Type I と Type II を s = M²/(M²+M_gap²) で混ぜ、指数更新する。
import { MSUN_IN_MEARTH } from './constants.js';
import { cellIndexAt } from './disk.js';
import { gapFactorsFromOthers } from './gas.js';
import { totalMass } from './physics.js';

/** Type I の移動時間 [yr]。ガスが無ければ Infinity */
export function typeITimescale(mass, sigmaRatio, params) {
  const x = params.fMig * mass * sigmaRatio;
  return x > 0 ? params.tauMig0 / x : Infinity;
}

/** Type II の移動時間 [yr] */
export function typeIITimescale(a, mass, params) {
  return params.tauII0 * a * Math.max(1, mass / params.mGap);
}

/** 1/τ_mig [1/yr]。Σ_g(a) には自分以外の惑星のギャップだけを掛ける */
export function migrationRate(planet, planets, disk, params, mStarEarth) {
  const m = totalMass(planet.mass);
  const j = cellIndexAt(disk, planet.a);
  const g = gapFactorsFromOthers(planets, planet, disk, j, 1, params, mStarEarth)[0];
  const ratio = (g * disk.gas[j]) / disk.area[j] / disk.sigmaRef;
  const s = (m * m) / (m * m + params.mGap * params.mGap);
  const invI = 1 / typeITimescale(m, ratio, params);
  const invII = 1 / typeIITimescale(planet.a, m, params);
  return (1 - s) * invI + s * invII;
}

/** Δt ≤ 0.1 τ_mig を満たす刻みの上限。円盤寿命を過ぎていれば制限なし */
export function migrationDtLimit(planets, disk, params, star, t) {
  if (t >= disk.tLife) return Infinity;
  const mStarEarth = star.mass * MSUN_IN_MEARTH;
  let maxRate = 0;
  for (const p of planets) {
    if (p.a > disk.rIn) maxRate = Math.max(maxRate, migrationRate(p, planets, disk, params, mStarEarth));
  }
  return maxRate > 0 ? params.migDtFactor / maxRate : Infinity;
}

/**
 * a(t+Δt) = a exp(-Δt/τ_mig)。内縁でクランプ（恒星への落下は起こさない）。内向きのみ。
 * 円盤寿命を過ぎたら円盤由来の移動は止める。
 */
export function migrate(planets, disk, params, star, t, dt) {
  if (t >= disk.tLife) return;
  const mStarEarth = star.mass * MSUN_IN_MEARTH;
  // 全惑星の移動時間を更新前の配置で求めてから、まとめて動かす
  const rates = planets.map((p) => migrationRate(p, planets, disk, params, mStarEarth));
  planets.forEach((p, i) => {
    p.a = Math.max(disk.rIn, p.a * Math.exp(-dt * rates[i]));
  });
}
