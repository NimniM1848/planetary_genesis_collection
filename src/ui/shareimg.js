// 共有用の画像（X など向け 1200×630）と、図鑑の一覧に出す小さな軌道図を、最終結果だけから描く（再計算は不要）。
import { planetFeatures } from '../dex/features.js';
import { stars, TIER_LABELS } from '../dex/rarity.js';
import { radialMap } from './layout.js';
import { planetColor, initialPhase, initialPeriapsis } from './look.js';
import { drawPlanetSprite, dotRadius, tracePlanetOrbit, planetPosition } from './render.js';
import { ECC_VISIBLE, habitableZone } from './layout.js';
import { fmtMass, fmtRadius, fmtTemp, fmtDist, fmtPeriod } from './units.js';

export const CARD_W = 1200;
export const CARD_H = 630;
const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
const TIER_COLOR = ['', '#9aa6c8', '#7fd1a0', '#6fb4ff', '#c58bff', '#ffd36b'];

/** 完成した惑星系の軌道図（円盤は淡く、惑星は最終位置）。中心 (cx, cy)、外周の半径 R */
export function drawSystemOrbit(ctx, cx, cy, R, input, final) {
  const star = input.star;
  const rStar = Math.max(5, R * 0.05);
  const rad = (r) => radialMap(r, input.disk.rIn, input.disk.rOut, R, rStar * 1.8);
  ctx.fillStyle = '#05070f';
  ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(110,150,255,0.07)';
  ctx.lineWidth = R - rStar * 1.8;
  ctx.beginPath(); ctx.arc(cx, cy, (R + rStar * 1.8) / 2, 0, Math.PI * 2); ctx.stroke();
  // ハビタブルゾーン（液体の水が存在できる範囲）: 緑の帯。大きい図には名前も添える
  const hz = habitableZone(star.luminosity);
  const h1 = rad(Math.min(input.disk.rOut, Math.max(input.disk.rIn, hz.inner)));
  const h2 = rad(Math.min(input.disk.rOut, Math.max(input.disk.rIn, hz.outer)));
  if (h2 > h1) {
    ctx.strokeStyle = 'rgba(90,220,140,0.26)';
    ctx.lineWidth = h2 - h1;
    ctx.beginPath(); ctx.arc(cx, cy, (h1 + h2) / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,240,160,0.6)';
    ctx.lineWidth = Math.max(1, R / 140);
    for (const r of [h1, h2]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    if (R >= 150) {
      ctx.fillStyle = 'rgba(150,245,180,0.95)';
      ctx.font = `600 ${Math.round(R / 14)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('ハビタブルゾーン', cx, cy - (h1 + h2) / 2 - R / 40 - 4);
      ctx.textAlign = 'start';
    }
  }
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rStar * 2.4);
  g.addColorStop(0, 'rgba(255,245,200,1)'); g.addColorStop(0.4, 'rgba(255,220,130,0.9)'); g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, rStar * 2.4, 0, Math.PI * 2); ctx.fill();
  const scale = Math.max(0.5, R / 170);
  for (const p of [...final].sort((a, b) => b.a - a.a)) {
    const omega = initialPeriapsis(input.seed, p.id);
    const pos = planetPosition(p, initialPhase(input.seed, p.id), omega);
    const pr = rad(pos.r);
    const f = planetFeatures(p, star);
    ctx.strokeStyle = p.e >= ECC_VISIBLE ? 'rgba(255,200,150,0.3)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    tracePlanetOrbit(ctx, cx, cy, p, omega, rad); ctx.stroke();
    drawPlanetSprite(ctx, cx + pr * Math.cos(pos.th), cy + pr * Math.sin(pos.th), dotRadius(p.mass) * scale, f, input.seed, p.id);
  }
}

function pill(ctx, x, y, text, color, size = 22) {
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + 24;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, size + 14);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 12, y + (size + 14) / 2);
  ctx.textBaseline = 'alphabetic';
  return w + 10;
}

function frame(ctx, title) {
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#0b1230'); bg.addColorStop(1, '#05070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = '#9aa6c8';
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText('惑星系創造', 48, 56);
  ctx.fillStyle = '#e8ecf8';
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText(title, 48, 124);
}

/**
 * 惑星系の共有画像
 * @param {{ name: string, input: any, final: any[], rarity: { tier: number, reason: { label: string } } }} d
 */
export function drawSystemCard(ctx, d) {
  frame(ctx, `${d.name} 系`);
  drawSystemOrbit(ctx, 880, 330, 250, d.input, d.final);
  ctx.fillStyle = 'rgba(150,245,180,0.85)';
  ctx.font = `500 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('緑の帯 = ハビタブルゾーン（液体の水が存在できる範囲）', 880, 618);
  ctx.textAlign = 'start';
  ctx.fillStyle = TIER_COLOR[d.rarity.tier];
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(`${stars(d.rarity.tier)}  ${TIER_LABELS[d.rarity.tier]}`, 48, 190);
  if (d.rarity.reason?.label) {
    ctx.fillStyle = '#c9d2ee';
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(`「${d.rarity.reason.label}」`.slice(0, 26), 48, 232);
  }
  ctx.fillStyle = '#9aa6c8';
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText(`惑星 ${d.final.length} 個`, 48, 284);
  let y = 330;
  for (const p of [...d.final].sort((a, b) => a.a - b.a).slice(0, 6)) {
    const f = planetFeatures(p, d.input.star);
    const col = planetColor(f.class, f.teq);
    ctx.fillStyle = col.fill;
    ctx.beginPath(); ctx.arc(64, y - 8, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8ecf8';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(f.class, 90, y);
    ctx.fillStyle = '#9aa6c8';
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(f.tags.slice(0, 2).join('・'), 300, y);
    y += 44;
  }
  if (d.final.length > 6) { ctx.fillStyle = '#9aa6c8'; ctx.font = `500 22px ${FONT}`; ctx.fillText(`ほか ${d.final.length - 6} 個`, 64, y); }
  ctx.fillStyle = '#6f7aa0';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(`シード ${d.input.seed}   #惑星系創造`, 48, CARD_H - 32);
}

/**
 * 惑星の共有画像
 * @param {{ name: string, planet: any, star: any, rarity: { tier: number }, systemName?: string, seed: number }} d
 */
export function drawPlanetCard(ctx, d) {
  frame(ctx, d.name);
  const f = planetFeatures(d.planet, d.star);
  const g = ctx.createRadialGradient(880, 315, 0, 880, 315, 280);
  g.addColorStop(0, 'rgba(110,150,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(880, 315, 280, 0, Math.PI * 2); ctx.fill();
  drawPlanetSprite(ctx, 880, 315, 150, f, d.seed, d.planet.id);
  ctx.fillStyle = TIER_COLOR[d.rarity.tier];
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(`${stars(d.rarity.tier)}  ${TIER_LABELS[d.rarity.tier]}`, 48, 190);
  ctx.fillStyle = '#e8ecf8';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(f.class, 48, 246);
  let x = 48;
  for (const t of f.tags.slice(0, 4)) x += pill(ctx, x, 268, t, '#c9d2ee', 22);
  const rows = [['重さ', fmtMass(f.mass)], ['大きさ', fmtRadius(f.radius)], ['温度の目安', fmtTemp(f.teq)], ['恒星からの距離', fmtDist(d.planet.a)], ['1周', fmtPeriod(f.period)]];
  let y = 360;
  for (const [k, v] of rows) {
    ctx.fillStyle = '#9aa6c8'; ctx.font = `500 22px ${FONT}`; ctx.fillText(k, 48, y);
    ctx.fillStyle = '#e8ecf8'; ctx.font = `600 26px ${FONT}`; ctx.fillText(v, 250, y);
    y += 44;
  }
  ctx.fillStyle = '#6f7aa0';
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(`シード ${d.seed}   #惑星系創造`, 48, CARD_H - 32);
}
