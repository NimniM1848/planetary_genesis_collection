// バッチ統計 (§6): node harness/batch.js [系の数=200] [--Z 1] [--disk 0.03] [--seed0 1]
import { runSimulation } from '../src/sim/sim.js';
import { baselineInput } from '../src/sim/params.js';
import { describePlanet } from '../src/sim/physics.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const Z = opt('Z', 1), diskMass = opt('disk', 0.03), seed0 = opt('seed0', 1);

const countHist = new Map(), classes = new Map();
let clamped = 0, planetsTotal = 0, maxRel = 0, retries = 0, minDt = 0, accreted = 0, solidTotal = 0;
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  const input = baselineInput(seed0 + i);
  input.star = { ...input.star, Z };
  input.disk = { ...input.disk, mass: diskMass };
  const r = runSimulation(input);
  countHist.set(r.final.length, (countHist.get(r.final.length) ?? 0) + 1);
  for (const p of r.final) {
    const d = describePlanet(p, input.star);
    classes.set(d.class, (classes.get(d.class) ?? 0) + 1);
    if (p.a <= input.disk.rIn * 1.0001) clamped++;
    accreted += p.mass.metal + p.mass.rock + p.mass.ice;
  }
  planetsTotal += r.final.length;
  maxRel = Math.max(maxRel, r.ledger.relError);
  retries += r.stats.retries; minDt += r.stats.minDtHits;
  solidTotal += r.snapshots[0].disk.solid.reduce((s, x) => s + x, 0) + r.snapshots[0].planets.reduce((s, p) => s + p.mass.metal + p.mass.rock + p.mass.ice, 0);
}
const pct = (x, d) => ((100 * x) / d).toFixed(1) + '%';
console.log(`系の数 ${n}  Z=${Z}  円盤質量=${diskMass} M☉  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log('\n惑星数の分布');
for (const [k, v] of [...countHist].sort((a, b) => a[0] - b[0])) console.log(`  ${String(k).padStart(2)} 個: ${pct(v, n).padStart(6)} ${'#'.repeat(Math.round((50 * v) / n))}`);
console.log(`\n内縁クランプの割合: ${pct(clamped, planetsTotal)}   (目標 < 20%)`);
console.log('\n惑星分類の割合');
for (const [k, v] of [...classes].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${pct(v, planetsTotal)}`);
console.log(`\n固体の惑星化率: ${pct(accreted, solidTotal)}`);
console.log(`質量保存の最大相対誤差: ${maxRel.toExponential(2)}   刻みの再試行: ${retries}  下限刻みでの打ち切り: ${minDt}`);
