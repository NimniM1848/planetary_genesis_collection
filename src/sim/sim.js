// シミュレーションのメインループ (§7)。UI 非依存の純粋関数。
// 現在: 円盤散逸 → 固体獲得 → ガス獲得 → 軌道移動 → 合体。散乱と放出は v1 後半で追加する。
import { DEFAULT_PARAMS, MODEL_VERSION } from './params.js';
import { createRng } from './rng.js';
import { createDisk, dissipateGas, totalRemaining } from './disk.js';
import { generateSeeds } from './seeds.js';
import { accreteSolids, computeWeights } from './accretion.js';
import { accreteGas } from './gas.js';
import { migrate, migrationDtLimit } from './migration.js';
import { processCollisions } from './collision.js';
import { MSUN_IN_MEARTH } from './constants.js';

const COMPONENTS = ['metal', 'rock', 'ice', 'gas'];

const planetTotal = (p) => p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas;
const clonePlanet = (p) => ({ id: p.id, a: p.a, e: p.e, mass: { ...p.mass } });

/** 質量保存と非負性の検査。破れていたら例外を投げる */
export function checkInvariants(disk, planets, params) {
  for (const key of ['gas', 'rock', 'metal', 'ice']) {
    for (let j = 0; j < disk.N; j++) {
      if (!(disk[key][j] >= 0)) throw new Error(`cell ${key}[${j}] is negative or NaN: ${disk[key][j]}`);
    }
  }
  let inPlanets = 0;
  for (const p of planets) {
    for (const c of COMPONENTS) {
      if (!(p.mass[c] >= 0)) throw new Error(`planet ${p.id} ${c} is negative or NaN`);
    }
    inPlanets += planetTotal(p);
  }
  const remaining = totalRemaining(disk);
  const lost = disk.lost.dispersed + disk.lost.ejected;
  const err = Math.abs(disk.mInitial - (inPlanets + remaining + lost)) / disk.mInitial;
  if (!(err <= params.massTolerance)) throw new Error(`mass not conserved: relative error ${err}`);
  return { initial: disk.mInitial, planets: inPlanets, remaining, lost, relError: err };
}

function saveState(disk, planets, rng) {
  return {
    rng: rng.getState(),
    gas: disk.gas.slice(), rock: disk.rock.slice(), metal: disk.metal.slice(), ice: disk.ice.slice(),
    lost: { ...disk.lost },
    planets: planets.map(clonePlanet),
  };
}

function restoreState(disk, saved, rng) {
  rng.setState(saved.rng);
  disk.gas.set(saved.gas); disk.rock.set(saved.rock); disk.metal.set(saved.metal); disk.ice.set(saved.ice);
  disk.lost = { ...saved.lost };
  return saved.planets.map(clonePlanet);
}

function snapshot(t, disk, planets) {
  const solid = new Float32Array(disk.N);
  for (let j = 0; j < disk.N; j++) solid[j] = disk.rock[j] + disk.metal[j] + disk.ice[j];
  return { t, planets: planets.map(clonePlanet), disk: { gas: Float32Array.from(disk.gas), solid } };
}

/** 1ステップの質量変化率が上限以下か。種のような極小質量は massChangeFloor を基準にする */
function withinChangeLimit(before, after, params) {
  const old = new Map(before.map((p) => [p.id, p]));
  for (const p of after) {
    const b = old.get(p.id);
    const m0 = planetTotal(b);
    if (planetTotal(p) - m0 > params.maxRelChange * Math.max(m0, params.massChangeFloor)) return false;
    if ((b.a - p.a) / b.a > params.maxRelChange) return false;
  }
  return true;
}

/**
 * @param {import('./types.js').SimInput} input
 * @param {Partial<typeof DEFAULT_PARAMS>} [paramsOverride]
 * @returns {import('./types.js').SimResult}
 */
export function runSimulation(input, paramsOverride = {}) {
  const params = { ...DEFAULT_PARAMS, ...paramsOverride };
  const rng = createRng(input.seed);
  const disk = createDisk(input.star, input.disk, params);
  const seeded = generateSeeds(rng, disk, input, params);
  let planets = seeded.planets;
  const warnings = [...seeded.warnings];

  const snapshots = [snapshot(0, disk, planets)];
  const events = [];
  const stats = { steps: 0, retries: 0, minDtHits: 0 };
  const tEnd = input.disk.tLife + params.tEndAfterLife;
  checkInvariants(disk, planets, params);

  const atEdge = new Set(); // 内縁に達した惑星（innerEdge イベントは初回のみ）
  const runaway = new Set(); // ガス割合が 0.5 に達した惑星（gasRunaway イベントは初回のみ）
  const mStarEarth = input.star.mass * MSUN_IN_MEARTH;
  let t = 0;
  let sinceSnapshot = 0;
  let dtCarry = Infinity; // 前のステップで細かくした刻みを、少しずつ元に戻す
  while (t < tEnd) {
    let dt = t < disk.tLife ? params.dtInit : params.dtAfterLife;
    dt = Math.min(dt, dtCarry, Math.max(params.dtMin, migrationDtLimit(planets, disk, params, input.star, t)));
    if (t < disk.tLife) dt = Math.min(dt, disk.tLife - t); // 円盤寿命ちょうどで刻みを区切る
    dt = Math.min(dt, tEnd - t);

    const saved = saveState(disk, planets, rng);
    let dispersedNow = false;
    for (;;) {
      // 1. ガス散逸  2. 獲得帯と重み  3. 固体獲得  4. ガス獲得  5. 軌道移動  （6. 合体は変化率の判定のあとで行う。合体は質量が一度に増えるため判定の対象外）
      dispersedNow = dissipateGas(disk, t, dt).dispersedNow;
      const weights = computeWeights(planets, disk, params, mStarEarth);
      accreteSolids(planets, disk, params, input.star, dt, weights);
      accreteGas(planets, disk, params, input.star, dt, weights);
      migrate(planets, disk, params, input.star, t, dt);
      if (withinChangeLimit(saved.planets, planets, params)) break;
      if (dt <= params.dtMin) {
        stats.minDtHits++;
        break;
      }
      stats.retries++;
      dt /= 2;
      planets = restoreState(disk, saved, rng);
    }

    // 6. 離心率の減衰と合体
    const col = processCollisions(planets, disk, params, input.star, t, dt, rng);
    planets = col.planets;
    events.push(...col.events);
    dtCarry = dt * 2;
    t += dt;
    stats.steps++;
    checkInvariants(disk, planets, params);

    for (const p of planets) {
      if (!atEdge.has(p.id) && p.a <= disk.rIn * (1 + 1e-9)) {
        atEdge.add(p.id);
        events.push({ t, kind: 'innerEdge', ids: [p.id], data: { mass: planetTotal(p), a: p.a } });
      }
      if (!runaway.has(p.id) && p.mass.gas >= 0.5 * planetTotal(p)) {
        runaway.add(p.id);
        events.push({ t, kind: 'gasRunaway', ids: [p.id], data: { mass: planetTotal(p), a: p.a } });
      }
    }
    if (dispersedNow) events.push({ t, kind: 'dispersal', ids: [], data: { gasLost: disk.lost.dispersed } });
    sinceSnapshot++;
    if (t <= disk.tLife + 1e-6 || sinceSnapshot >= params.snapshotEveryAfterLife || t >= tEnd) {
      snapshots.push(snapshot(t, disk, planets));
      sinceSnapshot = 0;
    }
  }

  const ledger = checkInvariants(disk, planets, params);
  return {
    input: { ...input, modelVersion: input.modelVersion ?? MODEL_VERSION },
    snapshots, events, final: planets.map(clonePlanet), ledger, warnings, stats,
  };
}
