// ガス獲得 (§3): 速度 = min(M_p/τ_KH, 供給制限)。固定の臨界質量では場合分けしない。
import { MSUN_IN_MEARTH, T_EQ_1AU, K_B, M_H, MU_GAS, V_ESC_EARTH } from './constants.js';
import { hillRadius, omega } from './accretion.js';
import { solidRadius, totalMass } from './physics.js';

/** 円盤ガスの温度 [K] (アルベド0の平衡温度) */
export function diskTemperature(a, luminosity) {
  return (T_EQ_1AU * Math.pow(luminosity, 0.25)) / Math.sqrt(a);
}

/** 大気を保持できるか: v_esc² ≥ 2 c_s² */
export function canHoldAtmosphere(planet, star) {
  const m = totalMass(planet.mass);
  if (!(m > 0)) return false;
  const r = solidRadius(m, planet.mass.ice / m);
  const vEsc2 = (V_ESC_EARTH * V_ESC_EARTH * m) / r;
  const cs2 = (K_B * diskTemperature(planet.a, star.luminosity)) / (MU_GAS * M_H);
  return vEsc2 >= 2 * cs2;
}

/** τ_KH [yr] */
export function khTimescale(m, params) {
  return params.tauCrit * Math.pow(m / params.mCrit, -params.khExp);
}

/** ギャップによる供給の低下 h(x) = 1/(1+x²) */
export function gapSuppression(m, params) {
  const x = m / params.mGap;
  return 1 / (1 + x * x);
}

/**
 * 他の惑星が作るギャップの到達しやすさ係数 g (§1)。自分のギャップは h と s で反映済みなので除く。
 * @returns {Float64Array} 獲得帯の各セルについての g
 */
export function gapFactorsFromOthers(planets, self, disk, j0, len, params, mStarEarth) {
  const g = new Float64Array(len).fill(1);
  for (const q of planets) {
    if (q === self) continue;
    const mq = totalMass(q.mass);
    const x = mq / params.mGap;
    const depth = (x * x) / (1 + x * x);
    const sigma = 2 * hillRadius(q.a, mq, mStarEarth);
    for (let k = 0; k < len; k++) {
      const d = disk.center[j0 + k] - q.a;
      g[k] -= depth * Math.exp(-(d * d) / (2 * sigma * sigma));
    }
  }
  for (let k = 0; k < len; k++) g[k] = Math.max(0, g[k]);
  return g;
}

/**
 * ガスを獲得する。KH 側は dM/dt = M^{q+1}/(M_crit^q τ_crit) の解析解で積分する
 * （有限時間で発散し得るため。発散する場合は供給制限と帯内ガス量が上限になる）。
 * 供給側は固体と同様 ΔM = M_feed (1 - exp(-f_g Ω h Δt))。セルから実際に差し引く。
 */
export function accreteGas(planets, disk, params, star, dt, weights) {
  const mStarEarth = star.mass * MSUN_IN_MEARTH;
  const q = params.khExp;
  const origGas = Float64Array.from(disk.gas);

  const plan = planets.map((p, i) => {
    if (!canHoldAtmosphere(p, star)) return null;
    const { j0, w } = weights[i];
    const g = gapFactorsFromOthers(planets, p, disk, j0, w.length, params, mStarEarth);
    let feed = 0;
    for (let k = 0; k < w.length; k++) feed += w[k] * g[k] * origGas[j0 + k];
    if (!(feed > 0)) return null;

    const m0 = totalMass(p.mass);
    const inv = Math.pow(m0, -q) - (q * dt) / (Math.pow(params.mCrit, q) * params.tauCrit);
    const dKH = inv > 0 ? Math.pow(inv, -1 / q) - m0 : Infinity;
    const rateSup = params.fGas * omega(p.a, star.mass) * gapSuppression(m0, params);
    const dSup = feed * (1 - Math.exp(-rateSup * dt));
    return { j0, w, g, feed, delta: Math.min(dKH, dSup) };
  });

  planets.forEach((p, i) => {
    const pl = plan[i];
    if (!pl || !(pl.delta > 0)) return;
    for (let k = 0; k < pl.w.length; k++) {
      const j = pl.j0 + k;
      const frac = Math.min(1, (pl.delta * pl.w[k] * pl.g[k]) / pl.feed);
      const x = Math.min(disk.gas[j], origGas[j] * frac);
      disk.gas[j] -= x;
      p.mass.gas += x;
    }
  });
}
