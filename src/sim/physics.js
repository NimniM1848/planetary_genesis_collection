// 惑星の物理量 (§8): 平衡温度、公転周期、半径、密度、分類、特徴タグ。純粋関数。
import { T_EQ_1AU, DAYS_PER_YEAR } from './constants.js';

export const ALBEDO = 0.3;

/** 平衡温度 [K]。e を渡すと時間平均受熱量の補正 (1-e²)^{-1/8} を掛ける */
export function equilibriumTemperature(a, luminosity, e = 0) {
  const t = T_EQ_1AU * Math.pow(luminosity, 0.25) * Math.pow(1 - ALBEDO, 0.25) / Math.sqrt(a);
  return t * Math.pow(1 - e * e, -1 / 8);
}

/** 公転周期 [yr]。mStarSun は M☉ */
export function orbitalPeriod(a, mStarSun) {
  return Math.pow(a, 1.5) / Math.sqrt(mStarSun);
}

/** Chen & Kipping (2017) の質量-半径関係 (Forecaster 平均式)。地球単位 */
export function radiusForecaster(m) {
  if (m < 2.04) return 1.008 * Math.pow(m, 0.279);
  if (m < 131.6) return 0.808 * Math.pow(m, 0.589);
  return 17.74 * Math.pow(m, -0.044);
}

export function totalMass(mass) {
  return mass.metal + mass.rock + mass.ice + mass.gas;
}

/** 固体だけの惑星の半径（氷による膨張つき） */
export function solidRadius(m, fIce) {
  return 1.008 * Math.pow(m, 0.279) * (1 + 0.5 * fIce);
}

/** 半径 [R⊕]。固体の式とガスを持つ惑星の式を、ガス割合で混ぜる */
export function planetRadius(mass) {
  const m = totalMass(mass);
  if (!(m > 0)) return 0;
  const fGas = mass.gas / m;
  const fIce = mass.ice / m;
  const w = fGas / (fGas + 0.02);
  return Math.pow(solidRadius(m, fIce), 1 - w) * Math.pow(radiusForecaster(m), w);
}

/** 密度 [g/cm³] */
export function planetDensity(m, r) {
  return (5.51 * m) / (r * r * r);
}

/** 惑星分類。上から順に評価して最初に当てはまるものを返す */
export function classify(mass) {
  const m = totalMass(mass);
  const fGas = mass.gas / m;
  const fIce = mass.ice / m;
  if (fGas >= 0.5 && m >= 30) return '巨大ガス惑星';
  if (m >= 10 && fIce >= 0.4 && fGas < 0.3) return '巨大氷惑星';
  if (fGas >= 0.01 && m >= 30) return 'ネプチューン級';
  if (fGas >= 0.01) return 'ミニネプチューン';
  if (fIce >= 0.4) return '氷惑星';
  if (m >= 20) return '巨大岩石惑星';
  if (m >= 2) return 'スーパーアース';
  return '岩石惑星';
}

/**
 * 表示用の量と分類・タグをまとめて返す。
 * @param {import('./types.js').Planet} planet
 * @param {import('./types.js').Star} star
 */
export function describePlanet(planet, star) {
  const m = totalMass(planet.mass);
  const radius = planetRadius(planet.mass);
  const density = planetDensity(m, radius);
  const teq = equilibriumTemperature(planet.a, star.luminosity, planet.e);
  const period = orbitalPeriod(planet.a, star.mass); // yr
  const cls = classify(planet.mass);
  const fIce = planet.mass.ice / m;
  const tags = [];
  const rocky = cls === '岩石惑星' || cls === 'スーパーアース' || cls === '巨大岩石惑星';
  if (cls === '巨大ガス惑星' && period * DAYS_PER_YEAR < 10) tags.push('ホットジュピター');
  if (rocky && teq > 1500) tags.push('溶岩惑星');
  if (teq > 1000) tags.push('高温');
  if (teq < 150) tags.push('低温');
  if (fIce >= 0.4) tags.push('氷主体');
  if (density < 0.5) tags.push('低密度');
  if (planet.e >= 0.3) tags.push('高離心率');
  return { mass: m, radius, density, teq, period, class: cls, tags };
}
