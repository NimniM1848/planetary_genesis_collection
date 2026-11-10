// シナリオ別の指標計算 (§6)。batch.js と sweep.js から使う。
import { runSimulation } from '../src/sim/sim.js';
import { baselineInput } from '../src/sim/params.js';
import { describePlanet } from '../src/sim/physics.js';
import { isSolarLike } from '../src/dex/features.js';

export const M_JUP = 318;

export const SCENARIOS = {
  base: {},
  'Z0.5': { Z: 0.5 },
  Z2: { Z: 2 },
  'd0.01': { disk: 0.01 },
  'd0.1': { disk: 0.1 },
};

/** @returns {import('../src/sim/types.js').SimInput} */
export function makeInput(seed, sc) {
  const input = baselineInput(seed);
  if (sc.Z !== undefined) input.star = { ...input.star, Z: sc.Z };
  if (sc.disk !== undefined) input.disk = { ...input.disk, mass: sc.disk };
  return input;
}

export { isSolarLike };

export function runScenario(sc, n, seed0, params) {
  const m = {
    n, planets: 0, one: 0, eightPlus: 0, countSum: 0, clamped: 0, hotJ: 0, giants: 0, overMass: 0,
    classes: {}, solarLike: 0, hotJSys: 0, clampSys: 0, ejectedSys: 0, mergesInLife: 0, mergesAfter: 0, accreted: 0, solid: 0, gasKept: 0, maxRel: 0, retries: 0, minDt: 0,
    giantMasses: [],
  };
  for (let i = 0; i < n; i++) {
    const input = makeInput(seed0 + i, sc);
    const r = runSimulation(input, params);
    const k = r.final.length;
    const cls = r.final.map((p) => [p, describePlanet(p, input.star).class]);
    if (isSolarLike(cls)) m.solarLike++;
    if (cls.some(([p]) => describePlanet(p, input.star).tags.includes('ホットジュピター'))) m.hotJSys++;
    if (cls.some(([p]) => p.a <= input.disk.rIn * 1.0001)) m.clampSys++;
    if (r.events.some((e) => e.kind === 'eject')) m.ejectedSys++;
    m.countSum += k; m.planets += k;
    if (k === 1) m.one++;
    if (k >= 8) m.eightPlus++;
    for (const p of r.final) {
      const d = describePlanet(p, input.star);
      m.classes[d.class] = (m.classes[d.class] ?? 0) + 1;
      if (p.a <= input.disk.rIn * 1.0001) m.clamped++;
      if (d.tags.includes('ホットジュピター')) m.hotJ++;
      if (d.class === '巨大ガス惑星') { m.giants++; m.giantMasses.push(d.mass / M_JUP); }
      if (d.mass / M_JUP > 13) m.overMass++;
      m.accreted += p.mass.metal + p.mass.rock + p.mass.ice;
      m.gasKept += p.mass.gas;
    }
    const s0 = r.snapshots[0];
    m.solid += s0.disk.solid.reduce((a, x) => a + x, 0) + s0.planets.reduce((a, p) => a + p.mass.metal + p.mass.rock + p.mass.ice, 0);
    for (const e of r.events) if (e.kind === 'merge') (e.t <= input.disk.tLife ? m.mergesInLife++ : m.mergesAfter++);
    m.maxRel = Math.max(m.maxRel, r.ledger.relError);
    m.retries += r.stats.retries; m.minDt += r.stats.minDtHits;
  }
  return m;
}

const pct = (x, d) => (d > 0 ? Math.round((100 * x) / d) : 0);
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

/** 1行の要約 */
export function summarize(m) {
  const cls = m.classes;
  const share = (name) => pct(cls[name] ?? 0, m.planets);
  const merges = m.mergesInLife + m.mergesAfter;
  return {
    '惑星数': (m.countSum / m.n).toFixed(1),
    '1個%': pct(m.one, m.n),
    '8+%': pct(m.eightPlus, m.n),
    '巨星%': share('巨大ガス惑星'),
    '巨星中央MJ': median(m.giantMasses).toFixed(1),
    '>13MJ%': pct(m.overMass, m.planets),
    '氷巨%': share('巨大氷惑星'),
    'ネプ%': share('ネプチューン級') + share('ミニネプチューン'),
    '岩%': share('岩石惑星') + share('スーパーアース') + share('巨大岩石惑星'),
    '太陽系風%': pct(m.solarLike, m.n),
    'HJ系%': pct(m.hotJSys, m.n),
    'clamp系%': pct(m.clampSys, m.n),
    '放出あり%': pct(m.ejectedSys, m.n),
    '寿命内合体%': pct(m.mergesInLife, merges),
  };
}
