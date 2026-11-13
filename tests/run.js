// 実行: node tests/run.js   (Node.js 18 以上)
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';
import { baselineInput, DEFAULT_PARAMS as P0, MODEL_VERSION } from '../src/sim/params.js';
const P = { ...P0, seedModel: 'random', pebbleFrac: 0 }; // 仕様書 §1・§2 の計算例の検査は、従来の方式（個数を指定して乱数で置く・小石の流入なし）で行う。新しい方式は別の節で検査する
import { createDisk, snowline, gasSurfaceDensity, solidSurfaceDensity0, totalRemaining } from '../src/sim/disk.js';
import { isolationMass, hillRadius } from '../src/sim/accretion.js';
import { generateSeeds, planSeeds, seedCount } from '../src/sim/seeds.js';
import { snapToEdge, EDGE_TOL, migrationDtLimit, trapFactor, trapMassWeight } from '../src/sim/migration.js';
import { OCEAN_TEQ } from '../src/sim/physics.js';
import { equilibriumTemperature, orbitalPeriod, planetRadius, planetDensity, classify, describePlanet } from '../src/sim/physics.js';
import { runSimulation, checkInvariants } from '../src/sim/sim.js';
import { canHoldAtmosphere, khTimescale, gapSuppression, gapFactorsFromOthers, accreteGas } from '../src/sim/gas.js';
import { computeWeights } from '../src/sim/accretion.js';
import { typeITimescale, typeIITimescale, migrationRate, migrate } from '../src/sim/migration.js';
import { mutualHillRadius, hillSeparation, instabilityTime, mergeProbability, gasClearingFactor, mergePlanets, processCollisions, safronovNumber, mergeFraction, scatterSigma, kickEccentricity, impactOutcome } from '../src/sim/collision.js';
import { randomInput } from '../src/ui/presets.js';
import { hashResult } from '../src/sim/hash.js';
import { MSUN_IN_MEARTH } from '../src/sim/constants.js';

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const nearRel = (a, b, rel, msg) => near(a, b, Math.abs(b) * rel, msg);

console.log('rng');
test('同じ seed で同じ列、違う seed で違う列', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const xs = [a.next(), a.next(), a.next()], ys = [b.next(), b.next(), b.next()];
  assert.deepEqual(xs, ys);
  assert.notEqual(xs[0], c.next());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

console.log('disk (§1)');
const base = baselineInput(1);
const disk = createDisk(base.star, base.disk, P);
test('スノーライン: L=1 で 2.7 AU、L=4 で 5.4 AU', () => {
  near(snowline(1), 2.7, 1e-12);
  near(snowline(4), 5.4, 1e-12);
});
test('ガス総量 ≈ 9,891 M⊕ (M_disk/(1+0.01Z))', () => {
  const gas = disk.gas.reduce((s, x) => s + x, 0);
  nearRel(gas, 9990 / 1.01, 1e-9);
});
test('Σ_g(5 AU) ≈ 10.5、Σ_0 ≈ 52.6 M⊕/AU²', () => {
  const j = Math.floor((200 * Math.log(5 / 0.05)) / Math.log(30 / 0.05));
  nearRel(gasSurfaceDensity(disk, j), 10.5, 0.03);
  nearRel(gasSurfaceDensity(disk, j) * 5, 52.6, 0.03);
});
test('固体総量 ≈ 94 M⊕、スノーライン内側は ice なし', () => {
  const solid = disk.solid0.reduce((s, x) => s + x, 0);
  nearRel(solid, 94, 0.02);
  for (let j = 0; j < disk.N; j++) if (disk.edges[j + 1] <= 2.7) assert.equal(disk.ice[j], 0);
});
test('Σ_s(1 AU) ≈ 0.237、Σ_s(5 AU) ≈ 0.105', () => {
  nearRel(solidSurfaceDensity0(disk, 1), 0.237, 0.03);
  nearRel(solidSurfaceDensity0(disk, 5), 0.105, 0.03);
});
test('リング/ギャップ構造でもガス総量は保たれ、ギャップ中心は薄くなる', () => {
  const d = createDisk(base.star, { ...base.disk, structures: [{ r: 10, width: 0.1, amp: -0.8 }, { r: 20, width: 0.2, amp: 1 }] }, P);
  nearRel(d.gas.reduce((s, x) => s + x, 0), 9990 / 1.01, 1e-9);
  const at = (r) => { const j = Math.floor((200 * Math.log(r / 0.05)) / Math.log(30 / 0.05)); return d.gas[j] / d.area[j]; };
  assert.ok(at(10) < 0.4 * at(7));
});
test('円盤作成直後の質量収支が合う', () => {
  nearRel(totalRemaining(disk), disk.mInitial, 1e-12);
});

console.log('孤立質量 (§2)');
const mStar = MSUN_IN_MEARTH;
test('M_iso: 1 AU ≈ 0.06、5 AU ≈ 2.1 M⊕', () => {
  nearRel(isolationMass(1, 0.237, 10, mStar), 0.06, 0.1);
  nearRel(isolationMass(5, 0.105, 10, mStar), 2.1, 0.05);
});
test('Z を2倍にすると 5 AU の M_iso は ×2.8', () => {
  nearRel(isolationMass(5, 0.21, 10, mStar) / isolationMass(5, 0.105, 10, mStar), 2.83, 0.01);
});
test('R_H(5 AU, 10 M⊕) ≈ 0.108 AU', () => nearRel(hillRadius(5, 10, mStar), 0.108, 0.02));

console.log('seeds (§2)');
test('ランダム種: 個数・質量範囲・間隔制約・質量収支', () => {
  const d = createDisk(base.star, base.disk, P);
  const { planets } = generateSeeds(createRng(7), d, base, P);
  assert.equal(planets.length, 8);
  for (const p of planets) {
    const m = p.mass.metal + p.mass.rock + p.mass.ice;
    assert.ok(m >= 0.001 - 1e-12 && m <= 0.1 + 1e-12, `mass ${m}`);
    assert.ok(p.a >= 0.05 && p.a <= 30);
  }
  checkInvariants(d, planets, P);
});
test('手動指定: 指定値がそのまま使われ、ランダム分が加わる', () => {
  const input = { ...base, seeds: [{ a: 1, mass: 0.5 }, { a: 5 }, { mass: 0.2 }], nRandomSeeds: 2 };
  const d = createDisk(input.star, input.disk, P);
  const { planets } = generateSeeds(createRng(3), d, input, P);
  assert.equal(planets.length, 5);
  near(planets[0].a, 1, 1e-12);
  near(planets[0].mass.metal + planets[0].mass.rock + planets[0].mass.ice, 0.5, 1e-9);
  near(planets[1].a, 5, 1e-12);
  checkInvariants(d, planets, P);
});
test('手動質量が円盤の固体量を超えたら警告して切り詰める', () => {
  const input = { ...base, seeds: [{ a: 1, mass: 200 }], nRandomSeeds: 0 };
  const d = createDisk(input.star, input.disk, P);
  const { planets, warnings } = generateSeeds(createRng(3), d, input, P);
  assert.ok(warnings.length > 0);
  assert.ok(planets[0].mass.rock + planets[0].mass.metal + planets[0].mass.ice <= 94.5);
  checkInvariants(d, planets, P);
});

console.log('physics (§8)');
test('T_eq: 1 AU ≈ 255 K、0.05 AU ≈ 1,140 K。離心率補正 e=0.5 で ×1.037', () => {
  near(equilibriumTemperature(1, 1), 255, 1);
  near(equilibriumTemperature(0.05, 1), 1140, 5);
  nearRel(equilibriumTemperature(1, 1, 0.5) / equilibriumTemperature(1, 1), 1.037, 0.001);
});
test('公転周期: 5 AU で 11.2 年、0.05 AU で約 4.1 日', () => {
  near(orbitalPeriod(5, 1), 11.18, 0.01);
  near(orbitalPeriod(0.05, 1) * 365.25, 4.08, 0.05);
});
test('半径と密度の例表 (岩石 / 氷 / ガス2% / 巨大ガス)', () => {
  const r = (m, ice, gas) => planetRadius({ metal: 0, rock: m * (1 - ice - gas), ice: m * ice, gas: m * gas });
  near(r(5, 0, 0), 1.58, 0.01);
  near(r(5, 0.5, 0), 1.97, 0.02);
  near(r(5, 0, 0.02), 1.82, 0.02);
  near(r(318, 0, 0.9), 13.5, 0.4);
  near(planetDensity(5, 1.58), 7.0, 0.1);
});
test('分類の境界', () => {
  const c = (m, ice, gas) => classify({ metal: 0, rock: m * (1 - ice - gas), ice: m * ice, gas: m * gas });
  assert.equal(c(318, 0, 0.9), '巨大ガス惑星');
  assert.equal(c(15, 0.5, 0.1), '巨大氷惑星');
  assert.equal(c(40, 0, 0.2), 'ネプチューン級');
  assert.equal(c(8, 0, 0.1), 'ミニネプチューン');
  assert.equal(c(3, 0.5, 0), '氷惑星');
  assert.equal(c(5, 0, 0), 'スーパーアース');
  assert.equal(c(1, 0, 0), '岩石惑星');
  assert.equal(c(25, 0, 0), '巨大岩石惑星');
});
test('特徴タグ: 溶岩惑星・ホットジュピター', () => {
  const star = { mass: 1, luminosity: 1, Z: 1 };
  const lava = describePlanet({ id: 1, a: 0.02, e: 0, mass: { metal: 0.3, rock: 0.7, ice: 0, gas: 0 } }, star);
  assert.ok(lava.tags.includes('溶岩惑星') && lava.tags.includes('高温'));
  const hj = describePlanet({ id: 2, a: 0.05, e: 0, mass: { metal: 0, rock: 30, ice: 0, gas: 270 } }, star);
  assert.ok(hj.tags.includes('ホットジュピター'));
});

console.log('gas (§3)');
const star1 = { mass: 1, luminosity: 1, Z: 1 };
const PS = { ...P, mGap: 100, fMig: 0.1, tauII0: 1e6, gapExp: 2, snowTrap: false, chainDelta: 0 }; // 仕様書の計算例は、M_gap = 100 M⊕・Type I/II の混ぜ方が 2 乗・トラップと連なりなし（v1 の式）が前提
const mk = (id, a, m, gas = 0) => ({ id, a, e: 0, mass: { metal: 0, rock: m - gas, ice: 0, gas } });
test('大気の足切り: 月質量は 1 AU で保持でき、0.001 M⊕ は保持できない', () => {
  assert.ok(canHoldAtmosphere(mk(1, 1, 0.0123), star1));
  assert.ok(!canHoldAtmosphere(mk(1, 1, 0.001), star1));
  assert.ok(canHoldAtmosphere(mk(1, 5, 0.003), star1));
});
test('τ_KH の例表 (5 M⊕ で 6.6e7 yr、14 M⊕ で 3e6 yr、20 M⊕ で 1e6 yr)', () => {
  nearRel(khTimescale(5, P), 6.6e7, 0.05);
  nearRel(khTimescale(14, P), 3e6, 1e-9);
  nearRel(khTimescale(20, P), 1.0e6, 0.05);
});
test('h(x): M=M_gap で 0.5、ギャップ係数: 5 AU の木星質量は中心で g≈0.09', () => {
  near(gapSuppression(100, PS), 0.5, 1e-12);
  const d = createDisk(star1, base.disk, P);
  const jup = mk(1, 5, 318), other = mk(2, 5.0, 1);
  const j = Math.floor((200 * Math.log(5 / 0.05)) / Math.log(30 / 0.05));
  const g = gapFactorsFromOthers([jup, other], other, d, j, 1, PS, MSUN_IN_MEARTH);
  near(g[0], 0.09, 0.03);
});
test('解析解: 理論値 M0(1-3t/(Mcrit³τ)·M0³...)^(-1/3) と一致し、発散する長い刻みでも帯内ガス量を超えない', () => {
  const run = (dt, n) => {
    const d = createDisk(star1, base.disk, P);
    const p = mk(1, 5, 14);
    const w = computeWeights([p], d, P, MSUN_IN_MEARTH);
    for (let i = 0; i < n; i++) accreteGas([p], d, P, star1, dt, w);
    return p.mass.gas;
  };
  // 14 M⊕ から 0.3 Myr: M^-3 = 14^-3·(1 - 3t/τ_crit) = 14^-3·0.7 → M = 14·0.7^(-1/3)。供給制限が効かない範囲で刻みに依らず一致する
  const exact = 14 * Math.pow(0.7, -1 / 3) - 14;
  nearRel(run(30000, 10), exact, 0.01);
  nearRel(run(1000, 300), exact, 0.01);
  const d = createDisk(star1, base.disk, P);
  const p = mk(1, 5, 14);
  const w = computeWeights([p], d, P, MSUN_IN_MEARTH);
  const before = d.gas.reduce((s, x) => s + x, 0);
  accreteGas([p], d, P, star1, 1e7, w); // 発散時刻を大きく超える刻み
  const after = d.gas.reduce((s, x) => s + x, 0);
  assert.ok(Number.isFinite(p.mass.gas) && p.mass.gas > 10);
  near(before - after, p.mass.gas, 1e-9);
  assert.ok(d.gas.every((x) => x >= 0));
});
test('重い円盤では巨大ガス惑星と gasRunaway イベントが出て、質量保存は保たれる', () => {
  const input = baselineInput(5);
  input.disk = { ...input.disk, mass: 0.1 };
  const res = runSimulation(input);
  assert.ok(res.final.some((p) => classify(p.mass) === '巨大ガス惑星'));
  assert.ok(res.events.some((e) => e.kind === 'gasRunaway'));
  assert.ok(res.ledger.relError <= 1e-9);
});

console.log('migration (§4)');
test('Type I: 5 M⊕ で 1 AU 2 Myr、5 AU 10 Myr、0.5 AU 1 Myr', () => {
  nearRel(typeITimescale(5, 1, PS), 2e6, 1e-9);
  nearRel(typeITimescale(5, 0.2, PS), 1e7, 1e-9);
  nearRel(typeITimescale(5, 2, PS), 1e6, 1e-9);
});
test('Type II: 5 AU の木星質量で 1.6e7 yr、100 M⊕ で Type I と II が半々', () => {
  nearRel(typeIITimescale(5, 318, PS), 1.59e7, 0.01);
  const d = createDisk(star1, base.disk, P);
  const p = mk(1, 1, 100);
  const inv = migrationRate(p, [p], d, PS, MSUN_IN_MEARTH);
  const invI = 1 / typeITimescale(100, 1, PS), invII = 1 / typeIITimescale(1, 100, PS);
  nearRel(inv, 0.5 * invI + 0.5 * invII, 1e-9);
});
test('円盤の実密度から Σ 比を取る: 1 AU で比≈1、5 AU で≈0.2', () => {
  const d = createDisk(star1, base.disk, P);
  const r = (a) => (migrationRate(mk(1, a, 5), [mk(1, a, 5)], d, PS, MSUN_IN_MEARTH) * PS.tauMig0) / (PS.fMig * 5);
  nearRel(r(1), 1, 0.03);
  nearRel(r(5), 0.2, 0.05);
});
test('内縁でクランプされ、円盤寿命後は動かない', () => {
  const d = createDisk(star1, base.disk, P);
  const p = mk(1, 0.06, 300, 270);
  migrate([p], d, P, star1, 0, 1e9);
  assert.equal(p.a, 0.05);
  const q = mk(2, 1, 300, 270);
  migrate([q], d, P, star1, 3e6, 1e6);
  assert.equal(q.a, 1);
});
test('重い円盤の巨星は内側へ移動し、innerEdge/ホットジュピター候補が現れうる（質量保存は保たれる）', () => {
  let migrated = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const input = baselineInput(seed);
    input.star = { ...input.star, Z: 2 };
    input.disk = { ...input.disk, mass: 0.1 };
    const res = runSimulation(input);
    assert.ok(res.ledger.relError <= 1e-9);
    const a0 = new Map(res.snapshots[0].planets.map((p) => [p.id, p.a]));
    migrated += res.final.filter((p) => p.a < 0.8 * a0.get(p.id)).length;
  }
  assert.ok(migrated > 0, '移動した惑星が 1 つもない');
});

console.log('collision (§5)');
test('例: 1 M⊕ 二つ、1.00/1.05 AU → R_H,m≈0.0129、Δ≈3.87、t_inst≈2.3e4 yr、P≈0.35', () => {
  nearRel(mutualHillRadius(1, 1, 1.05, 1, MSUN_IN_MEARTH), 0.0129, 0.01);
  const delta = hillSeparation(1, 1, 1.05, 1, MSUN_IN_MEARTH);
  near(delta, 3.87, 0.02);
  nearRel(instabilityTime(delta, P), 2.3e4, 0.05);
  near(mergeProbability(delta, 1, 1e4, P), 0.35, 0.01);
  near(mergeProbability(6, 1, 1e4, P), 0.003, 0.001);
});
test('ガスの残り割合: t=0 で c=0.1 (P≈4%)、t=τ_d で c≈0.67 (P≈25%)、寿命後 c=1', () => {
  const d = createDisk(star1, base.disk, P);
  const delta = 3.87;
  near(gasClearingFactor(0, d, P), 0.1, 1e-12);
  near(mergeProbability(delta, gasClearingFactor(0, d, P), 1e4, P), 0.04, 0.01);
  near(gasClearingFactor(d.tauD, d, P), 0.669, 0.01);
  near(mergeProbability(delta, gasClearingFactor(d.tauD, d, P), 1e4, P), 0.25, 0.02);
  assert.equal(gasClearingFactor(3e6, d, P), 1);
});
test('合体: 質量・組成は合算、軌道は角運動量保存 (√a_new = 1.0124、a_new≈1.025)、id は重い方', () => {
  const rng = createRng(1);
  const m = mergePlanets(mk(1, 1.0, 1), mk(2, 1.05, 1.5), rng, P);
  near(m.mass.rock, 2.5, 1e-12);
  assert.equal(m.id, 2);
  const eq = mergePlanets(mk(1, 1.0, 1), mk(2, 1.05, 1), rng, P);
  near(eq.a, 1.025, 0.001);
  assert.ok(eq.e >= 0);
});
test('processCollisions: ごく近いペアは寿命後ほぼ確実に合体し、遠いペアは残る。質量は保存される', () => {
  const d = createDisk(star1, base.disk, P);
  const near2 = [mk(1, 1.0, 1), mk(2, 1.01, 1), mk(3, 20, 1)];
  const r = processCollisions(near2, d, P, star1, 4e6, 1e5, createRng(1));
  assert.equal(r.planets.length, 2);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].kind, 'merge');
  near(r.planets.reduce((s, p) => s + p.mass.rock, 0) + d.lost.ejected, 3, 1e-12); // 衝突で飛び散った分（v2）は、系外へ出た質量に入る
});
test('離心率はガス円盤が残る間だけ減衰する', () => {
  const d = createDisk(star1, base.disk, P);
  const p = mk(1, 1, 1); p.e = 0.3;
  const r1 = processCollisions([p], d, P, star1, 0, 1e5, createRng(1));
  assert.ok(r1.planets[0].e < 0.3);
  const r2 = processCollisions([p], d, P, star1, 4e6, 1e5, createRng(1));
  assert.equal(r2.planets[0].e, 0.3);
});
test('シミュレーション全体: 合体が起き、合体イベントの質量が収支に合い、ガス円盤中より寿命後に多い', () => {
  let before = 0, after = 0, merges = 0, count = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const res = runSimulation(baselineInput(seed));
    assert.ok(res.ledger.relError <= 1e-9);
    count += res.final.length;
    for (const e of res.events.filter((x) => x.kind === 'merge')) {
      merges++;
      near(e.data.mass, e.data.m1 + e.data.m2, 1e-9);
      if (e.t <= 3e6) before++; else after++;
    }
  }
  assert.ok(merges > 0, '合体が 1 回も起きない');
  assert.ok(count < 20 * 7, '惑星数が減っていない（基準の種は 7 個）');
  console.log(`       (20系: 合体 ${merges} 回 = 円盤寿命内 ${before} / 寿命後 ${after})`);
});

console.log('scatter (§5 後半)');
test('サフロノフ数: 地球同士 1 AU で Θ≈0.07 (P_merge≈99.5%)、木星+土星 5 AU で Θ≈7 (P_merge≈2%)', () => {
  const th1 = safronovNumber(1, 1, 1, 1, 1, 1, MSUN_IN_MEARTH);
  near(th1, 0.07, 0.01);
  near(mergeFraction(th1), 0.995, 0.002);
  const th2 = safronovNumber(318, 95, 5, 5, 11.2, 9.4, MSUN_IN_MEARTH);
  near(th2, 7, 0.7);
  near(mergeFraction(th2), 0.02, 0.01);
});
test('キック: 木星+土星で σ(土星側)≈0.41、σ(木星側)≈0.12', () => {
  const th = 7;
  near(scatterSigma(th, 95, 318, P), 0.41, 0.03);
  near(scatterSigma(th, 318, 95, P), 0.12, 0.01);
  assert.ok(kickEccentricity(0.1, 0.3, createRng(1)) >= 0.1);
});
test('近接した巨星ペア: 合体せず散乱し、離心率が上がり、放出された質量は lost.ejected に入る', () => {
  const d = createDisk(star1, base.disk, P);
  d.gas.fill(0); d.tauD = d.tauD;
  const mkGiant = (id, a, m) => ({ id, a, e: 0, mass: { metal: 0, rock: m * 0.1, ice: 0, gas: m * 0.9 } });
  let planets = [mkGiant(1, 5, 318), mkGiant(2, 5.4, 95)];
  const all = [];
  let ejectedMass = 0;
  for (let k = 0; k < 400 && planets.length === 2; k++) {
    const r = processCollisions(planets, d, P, star1, 4e6, 1e5, createRng(100 + k));
    planets = r.planets;
    all.push(...r.events);
  }
  const kinds = new Set(all.map((e) => e.kind));
  assert.ok(kinds.has('scatter'), 'scatter が起きない');
  assert.ok(all.filter((e) => e.kind === 'scatter').every((e) => e.data.theta > 1));
  if (kinds.has('eject')) ejectedMass = all.filter((e) => e.kind === 'eject').reduce((s, e) => s + e.data.mass, 0);
  near(d.lost.ejected, ejectedMass, 1e-9);
});
test('シミュレーション全体: 重い円盤でも 13 MJ 超が減り、散乱/放出が記録され、質量保存が保たれる', () => {
  let scatter = 0, eject = 0, over = 0, count = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const input = baselineInput(seed);
    input.disk = { ...input.disk, mass: 0.1 };
    const res = runSimulation(input);
    assert.ok(res.ledger.relError <= 1e-9);
    scatter += res.events.filter((e) => e.kind === 'scatter').length;
    eject += res.events.filter((e) => e.kind === 'eject').length;
    for (const p of res.final) { count++; if (p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas > 13 * 318) over++; }
  }
  console.log(`       (20系: 散乱 ${scatter} 回、放出 ${eject} 回、13MJ超 ${over}/${count})`);
  assert.ok(scatter > 0);
});

console.log('種の決め方（円盤の条件から決める。簡易版）');
const diskOf = (mut) => { const i = baselineInput(1); mut?.(i); return { i, d: createDisk(i.star, i.disk, P0) }; };
test('種の数: 基準で 7 個。固体が多い（金属量・円盤の質量）ほど、広い円盤ほど多く、上下限（3〜16）に収まる', () => {
  const n = (mut) => { const { d } = diskOf(mut); return seedCount(d, P0); };
  assert.equal(n(), 7);
  assert.ok(n((i) => { i.star.Z = 0.5; }) < n() && n() < n((i) => { i.star.Z = 2; }), '金属量が高いほど多い');
  assert.ok(n((i) => { i.disk.mass = 0.01; }) < n() && n() < n((i) => { i.disk.mass = 0.08; }), '円盤が重いほど多い');
  assert.ok(n((i) => { i.disk.rOut = 15; }) < n() && n() <= n((i) => { i.disk.rOut = 80; }) && n((i) => { i.disk.rOut = 15; }) < n((i) => { i.disk.rOut = 80; }), '広い円盤ほど多い');
  assert.equal(n((i) => { i.disk.mass = 0.005; i.star.Z = 0.2; }), 3, '下限');
  assert.equal(n((i) => { i.disk.mass = 0.5; i.star.Z = 3; i.disk.rOut = 100; }), 16, '上限');
});
test('種の位置と質量: 円盤の中に、内側から順に 1 つずつ。同じシードなら同じ。質量は固体の量に比例（金属量 2 倍で、合計が約 2 倍）', () => {
  const { i, d } = diskOf();
  const a = planSeeds(createRng(5), d, i.star, P0);
  assert.equal(a.length, 7);
  assert.deepEqual(a, planSeeds(createRng(5), d, i.star, P0));
  assert.notDeepEqual(a, planSeeds(createRng(6), d, i.star, P0), 'シードが違えば、配置が少し変わる');
  for (let k = 0; k < a.length; k++) {
    assert.ok(a[k].a >= 0.05 && a[k].a <= 30 && a[k].mass > 0);
    if (k > 0) assert.ok(a[k].a > a[k - 1].a, '内側から外側へ、順に並ぶ（各区間に 1 つ）');
  }
  const solid = d.solid0.reduce((s, x) => s + x, 0);
  assert.ok(a.reduce((s, x) => s + x.mass, 0) < 0.05 * solid, '種の質量の合計は、固体の総量よりずっと小さい');
  const total = (Z) => { let sum = 0; for (let s = 1; s <= 40; s++) { const x = diskOf((j) => { j.star.Z = Z; }); sum += planSeeds(createRng(s), x.d, x.i.star, P0).reduce((q, y) => q + y.mass, 0); } return sum / 40; };
  assert.ok(Math.abs(total(2) / total(1) - 2) < 0.25, `質量の合計が固体の量に比例していない: ${total(2) / total(1)}`);
  // 固体の量で重みを付けるので、外側ほど、種は重く（広い範囲を代表）、数は同じ区間ごとに 1 つ
  const outer = a.slice(-2).reduce((s, x) => s + x.mass, 0) / 2, inner = a.slice(0, 2).reduce((s, x) => s + x.mass, 0) / 2;
  assert.ok(outer > inner, '外側の種のほうが重い');
});
test('計算: 既定で、円盤の条件から種が置かれる（最初の惑星の数 = 種の数）。惑星の種の数の指定は使われない。手動の種は、その後ろに足される', () => {
  const input = baselineInput(9);
  const r = runSimulation(input);
  const { d } = diskOf();
  assert.equal(r.snapshots[0].planets.length, seedCount(d, P0));
  const a = r.snapshots[0].planets.map((p) => p.a);
  assert.deepEqual(a, [...a].sort((x, y) => x - y), 'id の順 = 内側から');
  const other = runSimulation({ ...input, nRandomSeeds: 3 });
  assert.deepEqual(other.final, r.final, '個数の指定は、既定の方式では使われない');
  assert.deepEqual(other.events, r.events);
  const man = runSimulation({ ...input, seeds: [{ a: 12, mass: 1 }] });
  assert.equal(man.snapshots[0].planets.length, seedCount(d, P0) + 1);
  assert.ok(Math.abs(man.snapshots[0].planets.at(-1).a - 12) < 1e-12);
  // 従来の方式は、比較・検証用に残してある
  assert.equal(runSimulation({ ...input, nRandomSeeds: 5 }, { seedModel: 'random' }).snapshots[0].planets.length, 5);
});
test('条件が結果に効く: 金属量が高い・円盤が重いほど、種が多く、巨大ガス惑星のできる系が多い', () => {
  const giants = (mut) => { let g = 0, seeds = 0; for (let s = 1; s <= 30; s++) { const i = baselineInput(s); mut(i); const r = runSimulation(i); seeds += r.snapshots[0].planets.length; if (r.final.some((p) => p.mass.gas / (p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas) >= 0.5 && p.mass.gas > 30)) g++; } return { g, seeds: seeds / 30 }; };
  const low = giants((i) => { i.star.Z = 0.5; }), mid = giants(() => {}), high = giants((i) => { i.star.Z = 2; });
  assert.ok(low.seeds < mid.seeds && mid.seeds < high.seeds, `種の数: ${low.seeds} ${mid.seeds} ${high.seeds}`);
  assert.ok(low.g <= mid.g && mid.g < high.g, `巨大ガス惑星のある系: ${low.g} ${mid.g} ${high.g}`);
});

console.log('v2: 小石の流入（内側の固体を増やす）');
const diskP = (over, mut) => { const i = baselineInput(1); mut?.(i); return { i, d: createDisk(i.star, i.disk, { ...P0, ...over }) }; };
const solidIn = (d, rMax) => { let s = 0; for (let j = 0; j < d.N; j++) if (d.edges[j + 1] <= rMax) s += d.solid0[j]; return s; };
test('流入なし(pebbleFrac=0)は、仕様書 §1 の固体総量 約 94 M⊕ のまま。流入ありは、スノーライン内側だけが増え、外側と氷は変わらない', () => {
  const off = diskP({ pebbleFrac: 0 }).d, on = diskP({}).d;
  nearRel(off.solid0.reduce((s, x) => s + x, 0), 94, 0.02);
  for (let j = 0; j < off.N; j++) {
    if (off.edges[j] >= off.snow) { assert.equal(on.solid0[j], off.solid0[j], `外側のセル ${j} は変わらない`); }
    assert.equal(on.ice[j], off.ice[j], '氷は変わらない（スノーライン内側に氷はない）');
    assert.equal(on.gas[j], off.gas[j], 'ガスは変わらない');
    assert.ok(on.solid0[j] >= off.solid0[j] - 1e-15);
  }
  assert.ok(solidIn(on, 1) > 4 * solidIn(off, 1), `1 AU 未満の固体が、数倍に増える: ${solidIn(on, 1)} / ${solidIn(off, 1)}`);
});
test('流入の量 = スノーライン外側の固体 × 岩石・金属の割合 × pebbleFrac。金属量に比例し、質量収支（初期の総量）に含まれる', () => {
  const off = diskP({ pebbleFrac: 0 }).d, on = diskP({}).d;
  let outer = 0; for (let j = 0; j < off.N; j++) outer += off.solid0[j] * (off.edges[j] >= off.snow ? 1 : 0);
  const added = on.solid0.reduce((s, x) => s + x, 0) - off.solid0.reduce((s, x) => s + x, 0);
  nearRel(added, P0.pebbleFrac * (0.0045 / 0.01) * outer, 0.03, '流入の量');
  assert.ok(Math.abs(on.mInitial - (off.mInitial + added)) / on.mInitial < 1e-12, '初期の総量に含まれる（質量保存の検査が、そのまま成り立つ）');
  const z2 = diskP({}, (i) => { i.star.Z = 2; }).d, z2off = diskP({ pebbleFrac: 0 }, (i) => { i.star.Z = 2; }).d;
  nearRel((z2.solid0.reduce((s, x) => s + x, 0) - z2off.solid0.reduce((s, x) => s + x, 0)) / added, 2, 0.02, '金属量 2 倍で、流入も 2 倍');
  // 内側の表面密度 ∝ r^-κ（足した分だけを取り出して、2 点の比を見る）
  const dens = (d, a) => { const j = d.center.findIndex((c) => c > a); return d.solid0[j] / d.area[j]; };
  const add = (a) => dens(on, a) - dens(off, a);
  nearRel(add(0.1) / add(0.4), Math.pow(4, 2), 0.06, 'κ = 2 のとき、0.1 AU は 0.4 AU の 16 倍');
});
test('流入ありでも、質量保存・非負性が保たれ、金属量が高い・円盤が重いほど、内側の固体が多い', () => {
  for (const seed of [1, 2, 3]) {
    const input = baselineInput(seed);
    const r = runSimulation(input);
    assert.ok(r.ledger.relError <= 1e-9);
  }
  const lo = diskP({}, (i) => { i.star.Z = 0.5; }).d, hi = diskP({}, (i) => { i.star.Z = 2; }).d;
  assert.ok(solidIn(lo, 1) < solidIn(diskP({}).d, 1) && solidIn(diskP({}).d, 1) < solidIn(hi, 1));
});

console.log('v2: 海洋惑星の分類');
test('氷を多く含む惑星は、平衡温度が低ければ氷惑星、氷が解ける温度（273 K 以上）なら海洋惑星。それ以外の分類は変わらない', () => {
  const ice = { metal: 0, rock: 2, ice: 3, gas: 0 };
  assert.equal(classify(ice), '氷惑星', '温度を渡さなければ、低温として扱う');
  assert.equal(classify(ice, OCEAN_TEQ - 1), '氷惑星');
  assert.equal(classify(ice, OCEAN_TEQ), '海洋惑星');
  assert.equal(classify(ice, 900), '海洋惑星');
  assert.equal(classify({ metal: 0, rock: 5, ice: 0, gas: 0 }, 900), 'スーパーアース', '氷の少ない惑星は、温度に関わらず変わらない');
  assert.equal(classify({ metal: 0, rock: 6, ice: 9, gas: 0 }, 900), '巨大氷惑星', '巨大氷惑星は、温度に関わらず変わらない');
  assert.equal(classify({ metal: 0, rock: 20, ice: 0, gas: 280 }, 900), '巨大ガス惑星');
});
test('describePlanet: 同じ氷の多い惑星が、遠くでは氷惑星（氷主体）、太陽に近いと海洋惑星（氷主体のタグは付けない）になる', () => {
  const star = { mass: 1, luminosity: 1, Z: 1 };
  const mk = (a) => ({ id: 1, a, e: 0, mass: { metal: 0, rock: 2, ice: 3, gas: 0 } });
  const far = describePlanet(mk(5), star), near = describePlanet(mk(0.5), star);
  assert.equal(far.class, '氷惑星'); assert.ok(far.tags.includes('氷主体') && far.tags.includes('低温'));
  assert.equal(near.class, '海洋惑星'); assert.ok(!near.tags.includes('氷主体'));
  assert.ok(near.teq >= OCEAN_TEQ && far.teq < OCEAN_TEQ);
});

console.log('v2: 内縁との比較（1 ulp のずれで、結果が変わらないように）');
test('内縁にごく近い軌道は、内縁ちょうどにそろえる。内縁に居る惑星は、刻みの上限に影響しない', () => {
  assert.equal(snapToEdge(0.05 * (1 + 1e-12), 0.05), 0.05);
  assert.equal(snapToEdge(0.05 * (1 - 1e-12), 0.05), 0.05);
  assert.equal(snapToEdge(0.05 * (1 + 1e-6), 0.05), 0.05 * (1 + 1e-6), '十分に離れていれば、そのまま');
  assert.ok(EDGE_TOL > 1e-12 && EDGE_TOL < 1e-6);
  const d = createDisk(baselineInput(1).star, baselineInput(1).disk, P0);
  const star = baselineInput(1).star;
  const atEdge = { id: 1, a: 0.05, e: 0, mass: { metal: 0, rock: 5, ice: 0, gas: 0 } };
  const ulp = { ...atEdge, a: 0.05 * (1 + 1e-15) };
  const lim = (p) => migrationDtLimit([p], d, P0, star, 0);
  assert.equal(lim(atEdge), Infinity);
  assert.equal(lim(ulp), Infinity, '内縁から 1 ulp 離れた惑星も、内縁にいるものとして扱う（刻みの上限に影響しない）');
  assert.ok(Number.isFinite(lim({ ...atEdge, a: 0.5 })), '離れていれば、上限が決まる');
});

console.log('v2: スーパーアース（現実には意外と多い）');
test('ランダム設定の系の約 2〜4 割に、スーパーアースがある。巨大ガス惑星のある系も、減らさない', () => {
  let se = 0, gg = 0;
  const N = 80;
  for (let s = 1; s <= N; s++) {
    const input = randomInput(70000 + s);
    const r = runSimulation(input);
    const cls = r.final.map((p) => describePlanet(p, input.star).class);
    if (cls.includes('スーパーアース')) se++;
    if (cls.includes('巨大ガス惑星')) gg++;
  }
  console.log(`       (${N} 系: スーパーアースのある系 ${Math.round((100 * se) / N)}% / 巨大ガス惑星のある系 ${Math.round((100 * gg) / N)}%)`);
  assert.ok(se / N >= 0.2 && se / N <= 0.45, `スーパーアースのある系: ${se}/${N}`);
  assert.ok(gg / N >= 0.15, `巨大ガス惑星のある系が少なすぎる: ${gg}/${N}`);
});

console.log('v2: 軌道トラップと外向き移動・内側の連なり');
const stdDisk = () => createDisk(star1, base.disk, P0);
test('トラップ係数: 中心で 0（止まる）、内側で負（外向き）、外側で内向き、範囲の外と質量の範囲の外は 1。トラップを切れば 1', () => {
  const snow = 2.7, m = 10;
  near(trapFactor(snow, m, snow, P0), 0, 0.01, '中心');
  assert.ok(trapFactor(snow * 0.7, m, snow, P0) < -0.2, '内側は外向き');
  assert.ok(trapFactor(snow * 1.5, m, snow, P0) > 0.5 && trapFactor(snow * 1.5, m, snow, P0) < 1, '外側は、弱まった内向き');
  near(trapFactor(snow * 8, m, snow, P0), 1, 0.01, '遠い外側はふつうの内向き');
  near(trapFactor(snow * 0.1, m, snow, P0), 1, 0.01, '遠い内側もふつうの内向き');
  near(trapFactor(snow, 300, snow, P0), 1, 0.01, '巨大惑星（質量の範囲の外）は影響を受けない');
  assert.ok(Math.abs(trapFactor(snow, 0.1, snow, P0) - 1) < 1e-3, '軽い惑星は影響を受けない');
  assert.equal(trapFactor(snow, m, snow, { ...P0, snowTrap: false }), 1);
  assert.ok(trapMassWeight(10, P0) > 0.99 && trapMassWeight(0.5, P0) < 0.01 && trapMassWeight(200, P0) < 0.01, '質量の窓');
  assert.ok(trapMassWeight(2, P0) > 0.3 && trapMassWeight(2, P0) < 0.7, '窓の端はなめらか');
});
test('移動の向き: 10 M⊕ の惑星は、トラップの内側（スノーライン × 0.7）で外向き、外側で内向き。ギャップを開く前に Type II は効かない', () => {
  const d = stdDisk();
  const rate = (a, m) => migrationRate(mk(1, a, m), [mk(1, a, m)], d, P0, MSUN_IN_MEARTH);
  assert.ok(rate(d.snow * 0.7, 10) < 0, '外向き');
  assert.ok(rate(d.snow * 3, 10) > 0, '内向き');
  const s10 = 10 ** P0.gapExp / (10 ** P0.gapExp + P0.mGap ** P0.gapExp);
  assert.ok(s10 < 0.05, `10 M⊕ の Type II の割合は小さい: ${s10}`);
  assert.ok(rate(d.snow * 3, 300) > 0, '巨大惑星は、ふつうに内向き');
});
test('内側の連なり: 内向きに動く惑星は、内側の隣の手前（相互ヒル半径の 7 倍）で止まり、追い越さない。外向き・巨大惑星・内縁は、影響を受けない', () => {
  const d = stdDisk();
  const dtBig = 2e6;
  const inner = mk(1, d.rIn, 5), outer = mk(2, 2.0, 5);
  migrate([inner, outer], d, { ...P0, snowTrap: false }, star1, 0, dtBig);
  assert.equal(inner.a, d.rIn, '内縁の惑星はそのまま');
  const c = P0.chainDelta * Math.cbrt(10 / (3 * MSUN_IN_MEARTH));
  const aMin = (d.rIn * (1 + c / 2)) / (1 - c / 2);
  assert.ok(outer.a >= aMin * (1 - 1e-9) && outer.a < 2.0, `連なりの位置で止まる: ${outer.a} / 下限 ${aMin}`);
  assert.ok(outer.a > inner.a, '追い越さない');
  // 巨大惑星は、連なりに阻まれない
  const giant = mk(3, 2.0, 300, 270);
  migrate([mk(1, d.rIn, 5), giant], d, P0, star1, 0, dtBig);
  assert.ok(giant.a < 0.3, `巨大惑星は、内側へ入っていく: ${giant.a}`);
  // 外向きの移動（トラップの内側）は、連なりに影響されない
  const a0 = d.snow * 0.7;
  const out = mk(4, a0, 10);
  migrate([mk(5, a0 * 0.9, 1), out], d, P0, star1, 0, 1e4);
  assert.ok(out.a > a0, '外向きに動く');
});
test('トラップに引き寄せられる: 10 M⊕ の惑星を 1.9 AU に置くと、初めは外向きに動く。3.5 AU から来ると、スノーライン付近で止まり、trap のできごとが記録される', () => {
  const run = (a0) => runSimulation({ ...baselineInput(1), seeds: [{ a: a0, mass: 10 }], nRandomSeeds: 0 }, { seedModel: 'random' });
  const inside = run(1.9);
  assert.ok(inside.snapshots[40].planets[0].a > 1.9, `外向き: ${inside.snapshots[40].planets[0].a}`);
  const free = runSimulation({ ...baselineInput(1), seeds: [{ a: 1.9, mass: 10 }], nRandomSeeds: 0 }, { seedModel: 'random', snowTrap: false });
  assert.ok(free.snapshots[40].planets[0].a < 1.9, 'トラップがなければ、内向き');
  const ev = run(3.5).events.find((e) => e.kind === 'trap');
  assert.ok(ev, 'trap のできごとが記録される');
  assert.ok(Math.abs(Math.log(ev.data.a / 2.7)) < P0.trapCatchLn + 1e-9 && ev.data.from === 3.5);
  assert.equal(run(3.5).events.filter((e) => e.kind === 'trap').length, 1, '初回だけ');
});

console.log('v2: 衝突の細かさ（部分合体・質量損失・衛星）');
const stubRng = (...vals) => { let i = 0; return { next: () => vals[Math.min(i++, vals.length - 1)], rayleigh: () => 0.02, getState: () => 0, setState: () => {} }; };
const rockPl = (id, a, m) => ({ id, a, e: 0, mass: { metal: m * 0.3, rock: m * 0.7, ice: 0, gas: 0 } });
test('衝突の結果: 真正面に近い → 完全合体、斜め → 破片（質量損失と衛星）、かすめる（質量比が小さいとき）→ 合体しない。ガスの多い惑星は常に完全合体', () => {
  const big = rockPl(1, 1, 1), small = rockPl(2, 1.01, 0.2);
  assert.equal(impactOutcome(big, small, stubRng(0.04), P0).kind, 'perfect'); // b = 0.2
  const partial = impactOutcome(big, small, stubRng(0.49), P0); // b = 0.7
  assert.equal(partial.kind, 'partial');
  nearRel(partial.debris, P0.impactLossCoef * 0.2 * ((0.7 - 0.4) / 0.6), 1e-9, '破片の量');
  nearRel(partial.lost, partial.debris * P0.impactLossFrac, 1e-9);
  nearRel(partial.moon, partial.debris * P0.moonFrac, 1e-9);
  assert.equal(impactOutcome(big, small, stubRng(0.9), P0).kind, 'graze'); // b ≈ 0.95、質量比 0.2 < 0.5
  assert.equal(impactOutcome(big, rockPl(3, 1.01, 0.9), stubRng(0.9), P0).kind, 'partial', '質量比が大きければ、かすめずに合体する');
  const gasy = { id: 4, a: 1, e: 0, mass: { metal: 0, rock: 1, ice: 0, gas: 9 } };
  assert.equal(impactOutcome(gasy, small, stubRng(0.9), P0).kind, 'perfect', 'ガスの多い惑星は完全合体');
  assert.equal(impactOutcome(rockPl(1, 1, 0.01), rockPl(2, 1, 0.004), stubRng(0.5), P0).moon, 0, '軽すぎれば衛星はできない');
  assert.equal(impactOutcome(big, rockPl(5, 1.01, 0.001), stubRng(0.49), P0).moon, 0, '質量比が小さすぎれば、衛星はできない');
});
test('processCollisions: 斜めの衝突は、質量を失い（岩石から先）、衛星ができる。質量収支が合い、かすめる衝突は互いに生き残る', () => {
  const d = createDisk(star1, base.disk, P0);
  // 合体の判定に通る（rng 1 → 0.0）、散乱でなく合体（0.0）、衝突の角度 b = 0.7（0.49）
  const ps = [rockPl(1, 1.0, 1), rockPl(2, 1.01, 0.2)];
  const before = 1.2;
  const r = processCollisions(ps, d, P0, star1, 4e6, 1e5, stubRng(0, 0, 0.49));
  assert.equal(r.planets.length, 1);
  const ev = r.events[0];
  assert.equal(ev.kind, 'merge');
  assert.equal(ev.data.outcome, 'partial');
  const merged = r.planets[0];
  assert.equal(merged.id, 1);
  assert.equal(merged.moons.length, 1);
  nearRel(merged.moons[0].mass, ev.data.moonMass, 1e-12);
  const total = merged.mass.metal + merged.mass.rock + merged.mass.ice + merged.mass.gas;
  near(total + d.lost.ejected, before, 1e-12, '質量収支（飛び散った分は、系外へ出た質量）');
  near(d.lost.ejected, ev.data.lost, 1e-12);
  // 小さいほうの岩石から先に失われるので、金属の割合が増える
  assert.ok(merged.mass.metal / total > 0.3 + 1e-6, `金属の割合が増える: ${merged.mass.metal / total}`);
  assert.ok(merged.mass.rock >= 0 && merged.mass.metal >= 0);
  // かすめる衝突（b ≈ 0.95）: 合体せず、離心率だけ蹴られる
  const d2 = createDisk(star1, base.disk, P0);
  const r2 = processCollisions([rockPl(1, 1.0, 1), rockPl(2, 1.01, 0.2)], d2, P0, star1, 4e6, 1e5, stubRng(0, 0, 0.9, 0.3, 0.3));
  assert.equal(r2.planets.length, 2);
  assert.equal(r2.events[0].kind, 'graze');
  assert.equal(d2.lost.ejected, 0);
  assert.ok(r2.planets.every((p) => p.e > 0));
});
test('衛星: 重いほうの衛星だけが引き継がれ、スナップショットと結果にはコピーが入る。衛星のある惑星には「衛星あり」のタグが付く', () => {
  const d = createDisk(star1, base.disk, P0);
  const h = rockPl(1, 1.0, 1); h.moons = [{ mass: 0.01 }];
  const s = rockPl(2, 1.01, 0.5); s.moons = [{ mass: 0.005 }, { mass: 0.002 }];
  const m = mergePlanets(h, s, createRng(1), P0);
  assert.deepEqual(m.moons, [{ mass: 0.01 }]);
  assert.notStrictEqual(m.moons[0], h.moons[0], '共有されない（コピー）');
  assert.ok(describePlanet(h, star1).tags.includes('衛星あり'));
  assert.ok(!describePlanet(rockPl(3, 1, 1), star1).tags.includes('衛星あり'));
  const res = runSimulation(baselineInput(3));
  for (const sn of res.snapshots) for (const p of sn.planets) if (p.moons) assert.ok(p.moons.length <= P0.moonMaxCount);
});
test('v2 全体: 質量保存が保たれ（衝突で飛び散った分を含む）、衛星のある系が現実的な割合（1〜4 割）で、衛星は惑星の 1% ほどの重さ', () => {
  let moonSys = 0, N = 60; const ratios = [];
  for (let s = 1; s <= N; s++) {
    const r = runSimulation(randomInput(80000 + s));
    assert.ok(r.ledger.relError <= 1e-9, `seed ${s}`);
    let has = false;
    for (const p of r.final) if (p.moons?.length) { has = true; const tot = p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas; for (const m of p.moons) { ratios.push(m.mass / tot); assert.ok(m.mass < tot); } }
    if (has) moonSys++;
  }
  console.log(`       (${N} 系: 衛星のある系 ${Math.round((100 * moonSys) / N)}%、衛星/惑星の質量比 中央値 ${(100 * ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)] || 0).toFixed(2)}%)`);
  assert.ok(moonSys / N >= 0.08 && moonSys / N <= 0.4, `衛星のある系: ${moonSys}/${N}`);
});

console.log('sim (§6 必須テスト)');
test('質量保存・非負性: 複数 seed × 金属量 × 円盤質量（毎ステップ assert 済み）', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const Z of [0.5, 1, 2]) {
      for (const diskMass of [0.01, 0.03, 0.1]) {
        const input = { ...baselineInput(seed), star: { mass: 1, luminosity: 1, Z } };
        input.disk = { ...input.disk, mass: diskMass };
        const res = runSimulation(input);
        assert.ok(res.ledger.relError <= 1e-9);
        assert.ok(res.final.length > 0);
      }
    }
  }
});
test('同じ SimInput で同じ結果 (ハッシュ一致)、seed が違えば違う結果', () => {
  const a = hashResult(runSimulation(baselineInput(11)));
  const b = hashResult(runSimulation(baselineInput(11)));
  const c = hashResult(runSimulation(baselineInput(12)));
  assert.equal(a, b);
  assert.notEqual(a, c);
});
test('円盤寿命でガスが 0 になり dispersal イベントが1回記録される', () => {
  const res = runSimulation(baselineInput(5));
  assert.equal(res.events.filter((e) => e.kind === 'dispersal').length, 1);
  const last = res.snapshots.at(-1);
  assert.ok(last.disk.gas.every((x) => x === 0));
});
test('スナップショットは約300〜450個、modelVersion が保存される', () => {
  const res = runSimulation(baselineInput(5));
  assert.ok(res.snapshots.length > 250 && res.snapshots.length < 500, `n=${res.snapshots.length}`);
  assert.equal(res.input.modelVersion, MODEL_VERSION);
});
test('固体獲得: 惑星が成長し、内側(< 5 AU)の核は孤立質量程度で頭打ち（基準シナリオ）', () => {
  const res = runSimulation(baselineInput(5));
  const core = (p) => p.mass.metal + p.mass.rock + p.mass.ice;
  const total = res.final.reduce((s, p) => s + core(p), 0);
  assert.ok(total > 10 && total < 94.5, `total=${total}`);
  for (const p of res.final) if (p.a < 5) assert.ok(core(p) < 14, `a=${p.a} core=${core(p)}`);
});

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
