// 上から見た軌道図のレイアウト計算（描画から分離した純粋関数）。
import { MSUN_IN_MEARTH } from '../sim/constants.js';
import { DEFAULT_PARAMS } from '../sim/params.js';
import { gapFactorsFromOthers } from '../sim/gas.js';
import { snowline } from '../sim/disk.js';

/** 半径 r[AU] を、対数スケールで画面上の半径 [px] に変換する */
export function radialMap(r, rMin, rMax, R, rStar) {
  const u = Math.log(r / rMin) / Math.log(rMax / rMin);
  return rStar + (R - rStar) * Math.min(1, Math.max(0, u));
}

/** セルの境界・中心・面積（sim の createDisk と同じ式。再生側で円盤の見た目を作るため） */
export function diskGeometry(input, N = DEFAULT_PARAMS.nCells) {
  const { rIn, rOut } = input.disk;
  const edges = Array.from({ length: N + 1 }, (_, j) => rIn * Math.pow(rOut / rIn, j / N));
  const center = Array.from({ length: N }, (_, j) => Math.sqrt(edges[j] * edges[j + 1]));
  const area = Array.from({ length: N }, (_, j) => Math.PI * (edges[j + 1] ** 2 - edges[j] ** 2));
  return { N, edges, center, area, snow: snowline(input.star.luminosity) };
}

/** 初期のガス表面密度の最大値（円盤の濃淡を正規化する基準） */
export function referenceDensity(result, geom) {
  const g0 = result.snapshots[0].disk.gas;
  let max = 0;
  for (let j = 0; j < geom.N; j++) max = Math.max(max, g0[j] / geom.area[j]);
  return max;
}

/**
 * 円盤の濃淡（0〜1 前後）。ガスの密度に、惑星が作るギャップ（§1）を掛けて「縮まった分布」として描く。
 * @returns {{ gas: Float64Array, solid: Float64Array }}
 */
export function diskShading(snapshot, geom, ref, solidRef, input, gasInitial) {
  const mStar = input.star.mass * MSUN_IN_MEARTH;
  const g = gapFactorsFromOthers(snapshot.planets, null, { center: geom.center }, 0, geom.N, DEFAULT_PARAMS, mStar);
  const gas = new Float64Array(geom.N);
  const solid = new Float64Array(geom.N);
  for (let j = 0; j < geom.N; j++) {
    gas[j] = ((snapshot.disk.gas[j] / geom.area[j]) / ref) * g[j];
    solid[j] = (snapshot.disk.solid[j] / geom.area[j]) / solidRef;
  }
  // ガスの残り割合。ガスが消えると、残った固体（塵・小石）は見えにくくなるので、描画の濃さに使う
  let gasNow = 0;
  for (let j = 0; j < geom.N; j++) gasNow += snapshot.disk.gas[j];
  return { gas, solid, gasFrac: gasInitial > 0 ? Math.min(1, gasNow / gasInitial) : 0 };
}

/** 初期のガス総量 */
export function initialGasTotal(result, geom) {
  const g0 = result.snapshots[0].disk.gas;
  let s = 0;
  for (let j = 0; j < geom.N; j++) s += g0[j];
  return s;
}

export function solidReferenceDensity(result, geom) {
  const s0 = result.snapshots[0].disk.solid;
  let max = 0;
  for (let j = 0; j < geom.N; j++) max = Math.max(max, s0[j] / geom.area[j]);
  return max;
}

/** フレーム位置 f（スナップショット番号の実数）での時刻と、惑星の位置（隣接スナップショット間を線形補間） */
export function frameState(result, f) {
  const n = result.snapshots.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(f)));
  const k = Math.min(n - 1, i + 1);
  const frac = i === k ? 0 : Math.min(1, Math.max(0, f - i));
  const s0 = result.snapshots[i];
  const s1 = result.snapshots[k];
  const next = new Map(s1.planets.map((p) => [p.id, p]));
  const planets = s0.planets.map((p) => {
    const q = next.get(p.id);
    const a = q ? p.a + (q.a - p.a) * frac : p.a;
    const e = q ? p.e + (q.e - p.e) * frac : p.e;
    return { ...p, a, e, mass: p.mass };
  });
  return { index: i, t: s0.t + (s1.t - s0.t) * frac, snapshot: s0, planets };
}

/** 再生段階の表示名（仕様書: 円盤と種 → 固体の取り込みと成長 → ガス獲得と移動 → 衝突・合体と円盤散逸 → 完成） */
export function stageOf(t, tLife, finished) {
  if (finished) return '完成';
  if (t < 0.1 * tLife) return '円盤と種';
  if (t < 0.4 * tLife) return '固体の取り込みと成長';
  if (t < tLife) return 'ガス獲得と軌道移動';
  return '衝突・合体と円盤散逸';
}

/** スローにするできごと（散乱は多すぎるので除く） */
export const SLOW_KINDS = new Set(['gasRunaway', 'merge', 'graze', 'eject', 'innerEdge', 'dispersal']);

/** 時刻 t [yr] に当たるフレーム位置（スナップショット番号の実数） */
export function frameOfTime(result, t) {
  const snaps = result.snapshots;
  let lo = 0;
  let hi = snaps.length - 1;
  while (lo < hi) { // t_i <= t を満たす最後のスナップショット
    const mid = (lo + hi + 1) >> 1;
    if (snaps[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  const next = Math.min(snaps.length - 1, lo + 1);
  const span = snaps[next].t - snaps[lo].t;
  return lo + (span > 0 ? Math.min(1, Math.max(0, (t - snaps[lo].t) / span)) : 0);
}

/** できごとが起きるフレーム位置の昇順の配列（スローの対象のみ） */
export function eventFrames(result) {
  return result.events.filter((e) => SLOW_KINDS.has(e.kind)).map((e) => frameOfTime(result, e.t)).sort((a, b) => a - b);
}

/** 再生速度の倍率。できごとの前後 window フレーム以内では slow 倍に遅くする */
export function playbackRate(f, frames, { window = 1.5, slow = 0.06 } = {}) {
  for (const fe of frames) {
    if (fe < f - window) continue;
    if (fe > f + window) break;
    return slow;
  }
  return 1;
}

/**
 * ハビタブルゾーン（液体の水が存在しうる軌道の範囲）の目安 [AU]。
 * 光度だけから求める簡易版: 内側 0.95√L、外側 1.67√L（Kopparapu ら 2013 の太陽の値を √L で拡大縮小。恒星のスペクトルの違いは無視）。
 */
export function habitableZone(luminosity) {
  const s = Math.sqrt(luminosity);
  return { inner: 0.95 * s, outer: 1.67 * s };
}

/** 再生の冒頭、「種が生まれる」演出の長さ [秒]。この間は時間（シミュレーション）は進まない */
export const INTRO_SECONDS = 3.6;
const INTRO_FIRST = 0.1; // 最初の種が現れ始める進み具合（0〜1）
const INTRO_SPREAD = 0.6; // 最後の種が現れ始めるまでの広がり
const INTRO_POP = 0.17; // 1 つの種が現れきるまでの長さ

/** k 番目（0 始まり）の種が現れ始める進み具合 u（0〜1） */
export const seedBirthStart = (k, n) => INTRO_FIRST + (n <= 1 ? 0 : (INTRO_SPREAD * k) / (n - 1));

/**
 * 演出の進み具合 u での、k 番目の種の見え方。
 * @returns {{ p: number, scale: number }} p = 現れる進み具合（0 = まだ無い、1 = 現れきった）、scale = 大きさの倍率（少し大きくなってから戻る）
 */
export function seedBirth(u, k, n) {
  const p = Math.min(1, Math.max(0, (u - seedBirthStart(k, n)) / INTRO_POP));
  if (p <= 0) return { p: 0, scale: 0 };
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = p - 1;
  return { p, scale: 1 + c3 * x * x * x + c1 * x * x }; // easeOutBack
}

/**
 * 離心率 e の軌道の上の位置。平均近点角 M [rad]（時間に比例して進む角度）から、ケプラー方程式で
 * 離心近点角 E を求め、距離 r（軌道長半径 a に対する倍数をかけた値）と真近点角 nu を返す。
 * 近点（恒星にいちばん近い点）で nu = 0。
 */
export function keplerState(a, e, M) {
  const m = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return { r: a * (1 - e * Math.cos(E)), nu };
}

/** 軌道の曲線: 真近点角 nu のときの恒星からの距離 */
export const orbitRadiusAt = (a, e, nu) => (a * (1 - e * e)) / (1 + e * Math.cos(nu));

/** 軌道が円に見えない（楕円に描く）しきい値。これ未満は円として描く */
export const ECC_VISIBLE = 0.03;
