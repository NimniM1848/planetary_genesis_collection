// 衝突・合体 (§5): 軌道長半径で並べた隣接ペアだけを、相互ヒル半径の間隔 Δ から確率で合体させる。
// 抽選に当たったペアは、サフロノフ数 Θ で「合体」か「散乱」かを決める。
import { MSUN_IN_MEARTH, AU_M, REARTH_M } from './constants.js';
import { totalMass, planetRadius } from './physics.js';
import { snapToEdge } from './migration.js';

/** 相互ヒル半径 [AU] */
export function mutualHillRadius(a1, m1, a2, m2, mStarEarth) {
  return ((a1 + a2) / 2) * Math.cbrt((m1 + m2) / (3 * mStarEarth));
}

/** 間隔 Δ = |a2-a1| / R_H,m */
export function hillSeparation(a1, m1, a2, m2, mStarEarth) {
  return Math.abs(a2 - a1) / mutualHillRadius(a1, m1, a2, m2, mStarEarth);
}

/** 軌道不安定時間 t_inst [yr] */
export function instabilityTime(delta, params) {
  return params.t0 * Math.pow(10, params.beta * (delta - params.deltaUnstable));
}

/** ガスの残り割合による衝突率係数 c(t)。ガスが晴れると 1 */
export function gasClearingFactor(t, disk, params) {
  if (t >= disk.tLife) return 1;
  return params.c0 + (1 - params.c0) * (1 - Math.exp(-t / disk.tauD));
}

/** 合体確率 P = 1 - exp(-c Δt / t_inst) */
export function mergeProbability(delta, c, dt, params) {
  return 1 - Math.exp((-c * dt) / instabilityTime(delta, params));
}

/** 完全合体。質量・組成は合算、軌道は角運動量保存 (√a の質量加重平均)。id は重い方を引き継ぐ */
export function mergePlanets(p1, p2, rng, params) {
  const m1 = totalMass(p1.mass);
  const m2 = totalMass(p2.mass);
  const sqrtA = (m1 * Math.sqrt(p1.a) + m2 * Math.sqrt(p2.a)) / (m1 + m2);
  const heavy = m1 >= m2 ? p1 : p2;
  return {
    id: heavy.id,
    ...(heavy.moons?.length ? { moons: heavy.moons.map((m) => ({ ...m })) } : {}), // 衛星は、重いほうのものだけが残る
    a: sqrtA * sqrtA,
    e: rng.rayleigh(params.eMergeSigma),
    mass: {
      metal: p1.mass.metal + p2.mass.metal,
      rock: p1.mass.rock + p2.mass.rock,
      ice: p1.mass.ice + p2.mass.ice,
      gas: p1.mass.gas + p2.mass.gas,
    },
  };
}

/** サフロノフ数 Θ = (M1+M2)/M★ · ā/(R1+R2)。質量 M⊕、半径 R⊕、a は AU */
export function safronovNumber(m1, m2, a1, a2, r1, r2, mStarEarth) {
  return ((m1 + m2) / mStarEarth) * (((a1 + a2) / 2) * AU_M) / ((r1 + r2) * REARTH_M);
}

/** 合体確率 P_merge = 1/(1+Θ²) */
export function mergeFraction(theta) {
  return 1 / (1 + theta * theta);
}

/** 散乱で惑星 i が受ける離心率キックの σ_i（軽い方ほど大きく蹴られる） */
export function scatterSigma(theta, mi, mj, params) {
  return params.scatterKick * Math.min(Math.sqrt(theta), params.scatterThetaMax) * (mj / (mi + mj));
}

/** e' = sqrt(e² + Δe²)、Δe ~ Rayleigh(σ) */
export function kickEccentricity(e, sigma, rng) {
  const de = rng.rayleigh(sigma);
  return Math.sqrt(e * e + de * de);
}

const ORDER_STRIP = ['rock', 'ice', 'gas', 'metal']; // 衝突で剥がれやすい順（岩石のマントル → 氷 → ガス → 金属の核）

/** 質量 mass の組成から、amount だけを、剥がれやすい順に取り除く。取り除いた組成を返す */
function stripMass(mass, amount) {
  const removed = { metal: 0, rock: 0, ice: 0, gas: 0 };
  let rest = amount;
  for (const k of ORDER_STRIP) {
    const x = Math.min(mass[k], rest);
    mass[k] -= x; removed[k] += x; rest -= x;
  }
  return removed;
}

/**
 * 固体の惑星どうしの衝突の結果（v2）。衝突の角度 b（0 = 真正面、1 = かすめる。b² が一様）と、質量比 q を使う。
 *  - graze: かすめるだけ。合体せず、互いに生き残る。
 *  - perfect: 完全合体（破片なし）。
 *  - partial: 破片が出る。破片のうち、一部は飛び散って失われ、一部は集まって衛星になり、残りは惑星に戻る。
 * 乱数は、固体どうしのとき 1 回だけ使う。
 * @returns {{ kind: 'graze'|'perfect'|'partial', b: number, q: number, debris: number, lost: number, moon: number }}
 */
export function impactOutcome(p1, p2, rng, params) {
  const m1 = totalMass(p1.mass), m2 = totalMass(p2.mass);
  const small = Math.min(m1, m2), big = Math.max(m1, m2);
  const gas = (p) => p.mass.gas / totalMass(p.mass);
  if (gas(p1) >= params.impactSolidMaxGas || gas(p2) >= params.impactSolidMaxGas) return { kind: 'perfect', b: 0, q: small / big, debris: 0, lost: 0, moon: 0 };
  const b = Math.sqrt(rng.next());
  const q = small / big;
  if (b >= params.impactGrazeB && q < params.impactGrazeQ) return { kind: 'graze', b, q, debris: 0, lost: 0, moon: 0 };
  if (b < params.impactPerfectB) return { kind: 'perfect', b, q, debris: 0, lost: 0, moon: 0 };
  const debris = params.impactLossCoef * small * ((b - params.impactPerfectB) / (1 - params.impactPerfectB));
  const lost = debris * params.impactLossFrac;
  let moon = 0;
  if (q >= params.moonQmin && q <= params.moonQmax && m1 + m2 >= params.moonTotalMin) {
    moon = debris * params.moonFrac;
    if (moon < params.moonMassMin) moon = 0;
  }
  return { kind: 'partial', b, q, debris, lost, moon };
}

/**
 * ステップ 6: 離心率の減衰と、隣接ペアの合体抽選。
 * 同じステップで同じ惑星が複数回合体する場合は、順番に処理して再計算する。
 * @returns {{ planets: import('./types.js').Planet[], events: import('./types.js').SimEvent[] }}
 */
export function processCollisions(planets, disk, params, star, t, dt, rng) {
  const mStarEarth = star.mass * MSUN_IN_MEARTH;
  const events = [];
  const list = planets.map((p) => ({ id: p.id, a: p.a, e: p.e, mass: { ...p.mass }, ...(p.moons?.length ? { moons: p.moons.map((m) => ({ ...m })) } : {}) })).sort((x, y) => x.a - y.a);

  if (t < disk.tLife) {
    const damp = Math.exp(-(dt / params.tauE) * Math.exp(-t / disk.tauD));
    for (const p of list) p.e *= damp;
  }

  const c = gasClearingFactor(t, disk, params);
  let i = 0;
  while (i < list.length - 1) {
    const p1 = list[i];
    const p2 = list[i + 1];
    const m1 = totalMass(p1.mass);
    const m2 = totalMass(p2.mass);
    const delta = hillSeparation(p1.a, m1, p2.a, m2, mStarEarth);
    const prob = mergeProbability(delta, c, dt, params);
    if (rng.next() < prob) {
      const theta = safronovNumber(m1, m2, p1.a, p2.a, planetRadius(p1.mass), planetRadius(p2.mass), mStarEarth);
      if (rng.next() < mergeFraction(theta)) {
        const out = impactOutcome(p1, p2, rng, params);
        if (out.kind === 'graze') {
          // かすめるだけ: 合体しない。軌道長半径は変えず、離心率だけ蹴る（散乱と同じ）
          p1.e = kickEccentricity(p1.e, scatterSigma(theta, m1, m2, params), rng);
          p2.e = kickEccentricity(p2.e, scatterSigma(theta, m2, m1, params), rng);
          events.push({ t: t + dt, kind: 'graze', ids: [p1.id, p2.id], data: { b: out.b, q: out.q, a: (p1.a + p2.a) / 2 } });
          i++;
          continue;
        }
        const merged = mergePlanets(p1, p2, rng, params);
        merged.a = snapToEdge(merged.a, disk.rIn); // 内縁に張り付いた惑星どうしの合体は、内縁ちょうどに
        if (out.lost > 0) { // 飛び散った破片: 小さいほうの、剥がれやすい物質から失う。質量保存のため、系外へ出た質量に加える
          const smaller = m1 <= m2 ? p1 : p2;
          const removed = stripMass(smaller.mass, out.lost);
          for (const k of Object.keys(removed)) merged.mass[k] = p1.mass[k] + p2.mass[k]; // stripMass が、小さいほうの組成から、すでに取り除いている
          disk.lost.ejected += out.lost;
        }
        if (out.moon > 0) {
          merged.moons = merged.moons ?? [];
          if (merged.moons.length < params.moonMaxCount) merged.moons.push({ mass: out.moon });
        }
        const gone = merged.id === p1.id ? p2.id : p1.id;
        events.push({ t: t + dt, kind: 'merge', ids: [merged.id, gone], data: { mass: m1 + m2, a: merged.a, m1, m2, delta, theta, outcome: out.kind, lost: out.lost, moonMass: out.moon } });
        list.splice(i, 2, merged); // 合体後の惑星と次の隣を、同じ位置から再評価する
      } else {
        // 散乱: 軌道長半径は変えず、離心率だけ蹴る（v1）。e が上限を超えたら系外へ放出
        p1.e = kickEccentricity(p1.e, scatterSigma(theta, m1, m2, params), rng);
        p2.e = kickEccentricity(p2.e, scatterSigma(theta, m2, m1, params), rng);
        events.push({ t: t + dt, kind: 'scatter', ids: [p1.id, p2.id], data: { theta, e1: p1.e, e2: p2.e, a: (p1.a + p2.a) / 2 } });
        const ejected = [p2, p1].filter((p) => p.e >= params.ejectE); // 後ろから消す
        for (const p of ejected) {
          const m = totalMass(p.mass);
          disk.lost.ejected += m;
          events.push({ t: t + dt, kind: 'eject', ids: [p.id], data: { mass: m, a: p.a, e: p.e } });
          list.splice(list.indexOf(p), 1);
        }
        if (ejected.length === 0) i++; // 放出があれば、残った惑星と次の隣を同じ位置から再評価する
      }
    } else {
      i++;
    }
  }
  return { planets: list, events };
}
