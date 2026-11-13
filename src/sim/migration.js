// 軌道移動 (§4): Type I と Type II を s = M²/(M²+M_gap²) で混ぜ、指数更新する。
import { MSUN_IN_MEARTH } from './constants.js';
import { cellIndexAt } from './disk.js';
import { gapFactorsFromOthers } from './gas.js';
import { totalMass } from './physics.js';

/** 内縁との比較の許容差（相対）。内縁にほぼ一致する惑星は、内縁にいるものとして扱う */
export const EDGE_TOL = 1e-9;

/** 内縁にごく近い軌道は、内縁ちょうどにそろえる（合体の計算などで出る、1 ulp のずれを消す） */
export const snapToEdge = (a, rIn) => (a < rIn * (1 + EDGE_TOL) ? rIn : a);

/** Type I の移動時間 [yr]。ガスが無ければ Infinity */
export function typeITimescale(mass, sigmaRatio, params) {
  const x = params.fMig * mass * sigmaRatio;
  return x > 0 ? params.tauMig0 / x : Infinity;
}

/** Type II の移動時間 [yr] */
export function typeIITimescale(a, mass, params) {
  return params.tauII0 * a * Math.max(1, mass / params.mGap);
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** 質量がトラップを感じる程度（0〜1）。trapMassMin〜trapMassMax の間で 1、両端はなめらかに 0 へ */
export function trapMassWeight(mass, params) {
  const x = Math.log(mass);
  return sigmoid((x - Math.log(params.trapMassMin)) / 0.25) * sigmoid((Math.log(params.trapMassMax) - x) / 0.25);
}

/**
 * Type I 移動（内向き）に掛ける係数。1 = ふつうに内向き、0 = 止まる、負 = 外向き。
 * スノーライン付近（トラップ）では、トラップの外側（a > スノーライン）で内向きが弱まり、中心で 0、内側で外向きになる。
 * 質量が範囲の外の惑星・トラップの範囲の外の惑星は、1（影響を受けない）。
 */
export function trapFactor(a, mass, snow, params) {
  if (!params.snowTrap) return 1;
  const w = trapMassWeight(mass, params);
  if (w <= 1e-6) return 1;
  const x = Math.log(a / snow);
  const b = Math.exp(-((x / params.trapSigma) ** 2)); // トラップの範囲（中心 1、外側 0）
  const f = (1 - b) + b * Math.tanh(x / params.trapWidth);
  return 1 - w * (1 - f);
}

/** 1/τ_mig [1/yr]（正 = 内向き、負 = 外向き）。Σ_g(a) には自分以外の惑星のギャップだけを掛ける */
export function migrationRate(planet, planets, disk, params, mStarEarth) {
  const m = totalMass(planet.mass);
  const j = cellIndexAt(disk, planet.a);
  const g = gapFactorsFromOthers(planets, planet, disk, j, 1, params, mStarEarth)[0];
  const ratio = (g * disk.gas[j]) / disk.area[j] / disk.sigmaRef;
  const s = Math.pow(m, params.gapExp) / (Math.pow(m, params.gapExp) + Math.pow(params.mGap, params.gapExp)); // ギャップを開き始める質量の前後で、Type I から Type II へ切り替わる
  const invI = 1 / typeITimescale(m, ratio, params);
  const invII = 1 / typeIITimescale(planet.a, m, params);
  return (1 - s) * invI * trapFactor(planet.a, m, disk.snow, params) + s * invII;
}

/** Δt ≤ 0.1 τ_mig を満たす刻みの上限。円盤寿命を過ぎていれば制限なし */
export function migrationDtLimit(planets, disk, params, star, t) {
  if (t >= disk.tLife) return Infinity;
  const mStarEarth = star.mass * MSUN_IN_MEARTH;
  let maxRate = 0;
  for (const p of planets) {
    if (p.a > disk.rIn * (1 + EDGE_TOL)) maxRate = Math.max(maxRate, Math.abs(migrationRate(p, planets, disk, params, mStarEarth))); // 内縁に居る惑星は動かない（比較に許容差を付ける: 1 ulp のずれで、判定が入れ替わらないように）
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
  // 内側の惑星から順に動かす。内向きに動く惑星は、内側の隣の惑星の手前（相互ヒル半径の chainDelta 倍）で止まる（共鳴の連なり）
  const order = planets.map((p, i) => i).sort((x, y) => planets[x].a - planets[y].a);
  let inner = null; // 1 つ内側の惑星（動かしたあとの位置）
  for (const i of order) {
    const p = planets[i];
    let a = Math.min(disk.rOut, Math.max(disk.rIn, p.a * Math.exp(-dt * rates[i]))); // 負の率（外向き）も、同じ式で動く。外縁を超えない
    if (inner && a < p.a && totalMass(p.mass) <= params.trapMassMax) {
      const c = params.chainDelta * Math.cbrt((totalMass(p.mass) + totalMass(inner.mass)) / (3 * mStarEarth));
      const aMin = c < 1.8 ? (inner.a * (1 + c / 2)) / (1 - c / 2) : Infinity; // 隣との間隔が c 以上になる、いちばん内側の位置
      a = Math.min(p.a, Math.max(a, aMin)); // 内向きにだけ制限する（すでに近い惑星を、外へ押し出さない）
    }
    p.a = snapToEdge(a, disk.rIn);
    inner = p;
  }
}
