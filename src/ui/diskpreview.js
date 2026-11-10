// 設定の画面に出す「初期の円盤」の図。条件（恒星・円盤）を引き直す・変えるたびに、円盤がどんな形になるかが見える。
// ガス（青）と固体（橙）の濃淡、リングやギャップ、スノーライン、ハビタブルゾーンを、上から見た対数スケールで描く。
import { createDisk, snowline } from '../sim/disk.js';
import { DEFAULT_PARAMS } from '../sim/params.js';
import { createRng } from '../sim/rng.js';
import { planSeeds } from '../sim/seeds.js';
import { radialMap, habitableZone } from './layout.js';
import { initialPhase } from './look.js';
import { dotRadius } from './render.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** 図の寸法: 外周の半径 R、恒星の外側の半径 rStar（再生の軌道図と同じ） */
export function mapMetrics(size) {
  return { R: size / 2 - 6, rStar: Math.max(7, size * 0.025) * 1.6 };
}

/** 円盤の固体の総量 [M⊕]。条件が不正なら null */
export function solidTotal(cond) {
  try {
    const t = createDisk(cond.star, cond.disk, DEFAULT_PARAMS).solid0.reduce((s, x) => s + x, 0);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/**
 * この条件・シードで、計算が最初に置く種（位置と質量）。計算と同じ手順（シード → 円盤 → 種）なので、実際の種と一致する。
 * @returns {{ id: number, a: number, mass: number }[]} 条件が不正なら空
 */
export function plannedSeeds(cond, seed) {
  try {
    const disk = createDisk(cond.star, cond.disk, DEFAULT_PARAMS);
    return planSeeds(createRng(seed), disk, cond.star, DEFAULT_PARAMS).map((s, i) => ({ id: i + 1, a: s.a, mass: s.mass }));
  } catch { return []; }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size 図の一辺 [px]
 * @param {{ star: any, disk: any } | null} cond 条件（不正なら、メッセージだけ描く）
 * @param {{ id: number, a: number, mass: number }[]} [seeds] 種ができる位置（plannedSeeds）
 * @param {number} [seed] シード（種の向きを、再生の最初の絵と同じにするため）
 */
export function drawDiskPreview(ctx, size, cond, seeds = [], seed = 0) {
  const cx = size / 2, cy = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, size, size);
  let disk = null;
  if (cond) { try { disk = createDisk(cond.star, cond.disk, DEFAULT_PARAMS); } catch { disk = null; } }
  if (!disk || !(cond.disk.rOut > cond.disk.rIn)) {
    ctx.fillStyle = '#9aa6c8';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('条件を確かめてください', cx, cy);
    ctx.textAlign = 'start';
    return;
  }
  const { R, rStar } = mapMetrics(size);
  const rad = (r) => radialMap(r, cond.disk.rIn, cond.disk.rOut, R, rStar);

  // 円盤の濃淡（ガス = 青、固体 = 橙）。濃さは、この円盤の中での最大を 1 とする
  let maxGas = 0, maxSolid = 0;
  for (let j = 0; j < disk.N; j++) { maxGas = Math.max(maxGas, disk.gas[j] / disk.area[j]); maxSolid = Math.max(maxSolid, disk.solid0[j] / disk.area[j]); }
  for (let j = 0; j < disk.N; j++) {
    const r1 = rad(disk.edges[j]), r2 = rad(disk.edges[j + 1]);
    const mid = (r1 + r2) / 2, w = r2 - r1 + 0.6;
    const g = Math.sqrt(disk.gas[j] / disk.area[j] / maxGas);
    const s = Math.sqrt(disk.solid0[j] / disk.area[j] / maxSolid);
    ctx.strokeStyle = `rgba(110,150,255,${(0.6 * g).toFixed(3)})`;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(cx, cy, mid, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(255,170,90,${(0.35 * s).toFixed(3)})`;
    ctx.lineWidth = w * 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, mid, 0, Math.PI * 2); ctx.stroke();
  }
  // ハビタブルゾーン（緑の帯）とスノーライン（点線）
  const hz = habitableZone(cond.star.luminosity);
  const h1 = rad(clamp(hz.inner, cond.disk.rIn, cond.disk.rOut)), h2 = rad(clamp(hz.outer, cond.disk.rIn, cond.disk.rOut));
  if (h2 > h1) {
    ctx.strokeStyle = 'rgba(90,220,140,0.22)';
    ctx.lineWidth = h2 - h1;
    ctx.beginPath(); ctx.arc(cx, cy, (h1 + h2) / 2, 0, Math.PI * 2); ctx.stroke();
  }
  const rs = rad(clamp(snowline(cond.star.luminosity), cond.disk.rIn, cond.disk.rOut));
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(190,225,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, rs, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(190,225,255,0.75)';
  ctx.fillText('スノーライン', cx + rs * 0.707 + 4, cy - rs * 0.707);
  if (h2 > h1) { ctx.fillStyle = 'rgba(150,245,180,0.9)'; ctx.fillText('ハビタブルゾーン', cx - h2 * 0.707 - 84, cy - h2 * 0.707 + 12); }
  // 恒星
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rStar * 1.6);
  g.addColorStop(0, 'rgba(255,245,200,1)'); g.addColorStop(0.5, 'rgba(255,220,130,0.9)'); g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, rStar * 1.6, 0, Math.PI * 2); ctx.fill();
  // 惑星の種（白い点）: 位置は計算が置く位置、大きさは質量。向きは、再生の最初の絵と同じ
  for (const s of seeds) {
    const pr = rad(clamp(s.a, cond.disk.rIn, cond.disk.rOut));
    const ang = initialPhase(seed, s.id);
    const x = cx + pr * Math.cos(ang), y = cy + pr * Math.sin(ang);
    const dot = Math.max(2.4, dotRadius({ metal: 0, rock: s.mass, ice: 0, gas: 0 }) * 0.9);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff4d0';
    ctx.beginPath(); ctx.arc(x, y, dot, 0, Math.PI * 2); ctx.fill();
  }
}
