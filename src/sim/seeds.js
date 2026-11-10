// 種の生成 (§2)。手動指定とランダム生成は同じ計算を使う。
// 種の初期質量は、その位置のセルから固体として差し引く（質量保存のため）。
import { MSUN_IN_MEARTH } from './constants.js';
import { cellIndexAt, withdrawSolids } from './disk.js';

function mutualHill(a1, m1, a2, m2, mStar) {
  return ((a1 + a2) / 2) * Math.cbrt((m1 + m2) / (3 * mStar));
}

/** ほぼ正規分布する乱数（一様乱数 4 個の和。標準偏差 1 に揃える）。超越関数を使わず、環境に依らず同じ値になる */
function approxNormal(rng) {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.sqrt(3);
}

/** 条件から決まる、種の数。固体が多いほど・円盤が広いほど多い（基準で seedCountRef 個） */
export function seedCount(disk, params) {
  const solid = disk.solid0.reduce((s, x) => s + x, 0);
  const extent = Math.log(disk.rOut / disk.rIn) / Math.log(30 / 0.05); // 基準の広がり（0.05〜30 AU）を 1 とする
  const n = params.seedCountRef * Math.pow(solid / params.seedCountRefSolid, params.seedCountSolidExp) * Math.pow(extent, params.seedCountExtentExp);
  return Math.min(params.seedMaxCount, Math.max(params.seedMinCount, Math.round(n)));
}

/**
 * 円盤の条件から、種の数・位置・質量を決める（簡易版）。1 つの種は、円盤のある範囲を代表する。
 *  - 数: 固体が多いほど・円盤が広いほど多い（seedCount）。
 *  - 位置: 固体の量（を r^seedPosExp で割った重み）の累積分布を、種の数で等分した区間ごとに 1 つずつ。区間（と前後の seedOverlap の余裕）の中で、シードから決まる位置。
 *  - 質量: その区間に含まれる固体の量 × seedEps（対数正規のゆらぎ付き）。固体が多いほど、重い。
 * 乱数の消費順は固定（種ごとに: 位置 1 回、質量 4 回）。
 * （物理的に厳密に、近接した胚の間隔から決めると、種は何百個にもなり、このゲームの規模に合わないため、1 つの種に範囲を代表させている）
 * @returns {{ a: number, mass: number }[]}
 */
export function planSeeds(rng, disk, star, params) {
  const n = seedCount(disk, params);
  const w = new Float64Array(disk.N); // 位置の重み
  const cum = new Float64Array(disk.N + 1);
  const cumSolid = new Float64Array(disk.N + 1);
  for (let j = 0; j < disk.N; j++) {
    w[j] = disk.solid0[j] / Math.pow(disk.center[j], params.seedPosExp);
    cum[j + 1] = cum[j] + w[j];
    cumSolid[j + 1] = cumSolid[j] + disk.solid0[j];
  }
  const total = cum[disk.N];
  /** 重みの累積が x（0〜1）になるセルの位置（セルの中は、重みの累積に沿って補間） */
  const at = (x) => {
    const target = x * total;
    let lo = 0, hi = disk.N - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] < target) lo = mid + 1; else hi = mid; }
    const f = w[lo] > 0 ? (target - cum[lo]) / w[lo] : 0.5;
    return { j: lo, a: disk.edges[lo] + Math.min(1, Math.max(0, f)) * disk.width[lo] };
  };
  const out = [];
  for (let k = 0; k < n; k++) {
    const x0 = k / n, x1 = (k + 1) / n;
    const p0 = at(x0), p1 = at(x1);
    const w01 = x1 - x0;
    const lo = Math.max(0, x0 - params.seedOverlap * w01), hi = Math.min(1, x1 + params.seedOverlap * w01);
    const pos = at(lo + (hi - lo) * rng.next()); // 区間（と、その前後の余裕）の中の位置（シードで決まる）
    const zone = (cumSolid[p1.j + 1] - cumSolid[p0.j]) || disk.solid0[pos.j]; // 区間の固体の量（セル単位）
    const mass = params.seedEps * zone * Math.exp(params.seedJitterMass * approxNormal(rng));
    out.push({ a: pos.a, mass });
  }
  out.sort((x, y) => x.a - y.a); // 区間の前後の余裕で順序が入れ替わることがあるので、位置の順（内側から）に並べ直す。id は、この順に付く
  return out;
}

/**
 * @param {ReturnType<typeof import('./rng.js').createRng>} rng
 * @param {import('./disk.js').Disk} disk
 * @param {import('./types.js').SimInput} input
 * @param {typeof import('./params.js').DEFAULT_PARAMS} params
 * @returns {{ planets: import('./types.js').Planet[], warnings: string[] }}
 */
export function generateSeeds(rng, disk, input, params) {
  const warnings = [];
  const mStar = input.star.mass * MSUN_IN_MEARTH;
  // 'disk': 円盤の条件から決めた種（位置・質量とも決まっている）+ 手動で指定した種。'random': 従来の、個数を指定する方法
  const specs = params.seedModel === 'disk'
    ? [...planSeeds(rng, disk, input.star, params), ...input.seeds]
    : [...input.seeds, ...Array.from({ length: input.nRandomSeeds }, () => ({}))];
  const solidTotal = disk.solid0.reduce((s, x) => s + x, 0);

  // --- 質量の決定 ---
  const masses = new Array(specs.length).fill(0);
  let manualSum = 0;
  specs.forEach((s, i) => {
    if (s.mass !== undefined) manualSum += s.mass;
  });
  let scale = 1;
  if (manualSum > solidTotal) {
    scale = solidTotal / manualSum;
    warnings.push(`手動指定の質量合計 ${manualSum.toFixed(2)} M⊕ が円盤の固体量 ${solidTotal.toFixed(2)} M⊕ を超えたため切り詰めました`);
  }
  let used = 0;
  specs.forEach((s, i) => {
    if (s.mass !== undefined) {
      masses[i] = s.mass * scale;
      used += masses[i];
    }
  });
  specs.forEach((s, i) => {
    if (s.mass !== undefined) return;
    for (let k = 0; k < params.seedMassRedraws; k++) {
      const m = rng.logUniform(params.seedMassMin, params.seedMassMax);
      if (used + m <= solidTotal) {
        masses[i] = m;
        used += m;
        return;
      }
    }
    masses[i] = 0;
    warnings.push(`種 #${i + 1} の質量を抽選できませんでした（円盤の固体量が不足）`);
  });

  // --- 位置の決定（指定ありを先に確定し、未指定は間隔制約つきで抽選） ---
  const cum = new Float64Array(disk.N);
  let acc = 0;
  for (let j = 0; j < disk.N; j++) cum[j] = acc += disk.solid0[j] / Math.pow(disk.center[j], params.seedPosExp);
  const pickCell = () => {
    const x = rng.next() * acc;
    let lo = 0;
    let hi = disk.N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const placed = []; // { i, a }
  const aOf = new Array(specs.length).fill(null);
  specs.forEach((s, i) => {
    if (s.a === undefined || masses[i] <= 0) return;
    let a = s.a;
    if (a < disk.rIn || a > disk.rOut) {
      a = Math.min(disk.rOut, Math.max(disk.rIn, a));
      warnings.push(`種 #${i + 1} の軌道長半径を円盤の範囲内 (${a} AU) に補正しました`);
    }
    aOf[i] = a;
    placed.push({ i, a });
  });
  specs.forEach((s, i) => {
    if (s.a !== undefined || masses[i] <= 0) return;
    for (let k = 0; k < params.seedPlaceAttempts; k++) {
      const j = pickCell();
      const a = rng.range(disk.edges[j], disk.edges[j + 1]);
      const ok = placed.every((q) => {
        const rh = mutualHill(a, masses[i], q.a, masses[q.i], mStar);
        return Math.abs(a - q.a) >= params.seedMinSepHill * rh;
      });
      if (ok) {
        aOf[i] = a;
        placed.push({ i, a });
        return;
      }
    }
    warnings.push(`種 #${i + 1} の置き場所が見つかりませんでした`);
  });

  // --- 円盤から固体を差し引いて惑星を作る ---
  const planets = [];
  specs.forEach((s, i) => {
    if (aOf[i] === null) return;
    const got = withdrawSolids(disk, cellIndexAt(disk, aOf[i]), masses[i]);
    planets.push({ id: i + 1, a: aOf[i], e: 0, mass: { ...got, gas: 0 } });
  });
  return { planets, warnings };
}
