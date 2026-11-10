// 惑星のカード（結果の画面・図の上のカード・図鑑で共通）。
import { planetFeatures } from '../dex/features.js';
import { rarityOfPlanet } from '../dex/rarity.js';
import { fmtMass, fmtRadius, fmtDensity, fmtTemp, fmtDist, fmtEcc, fmtPeriod } from './units.js';

export const COMP = [['metal', '金属', '#b9a48a'], ['rock', '岩石', '#8c6b52'], ['ice', '氷', '#a9d8ff'], ['gas', 'ガス', '#e0b66b']];

export const textEl = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };

/** 希少度の表示（★と言葉）。階級ごとに色が変わる */
export function rarityEl(r) {
  return textEl('div', `希少度 ${r.stars} ${r.label}`, `rarity t${r.tier}`);
}

/**
 * 惑星のカードの中身。
 * @param {{ id: number, a: number, e: number, mass: any }} p
 * @param {string} name
 * @param {{ mass: number, luminosity: number, Z: number }} star
 */
export function planetCardNodes(p, name, star) {
  const d = planetFeatures(p, star);
  const rar = rarityOfPlanet(p, star);
  const nodes = [textEl('h4', name)];
  const meta = document.createElement('div');
  meta.append(textEl('span', d.class, 'cls'));
  const tags = document.createElement('span');
  tags.className = 'tags';
  for (const t of d.tags) tags.append(textEl('span', t, 'tag'));
  meta.append(tags);
  nodes.push(meta, rarityEl(rar));
  const dl = document.createElement('dl');
  dl.className = 'stats';
  const row = (k, v) => { const w = document.createElement('div'); w.append(textEl('dt', k), textEl('dd', v)); dl.append(w); };
  row('重さ（質量）', fmtMass(d.mass));
  row('大きさ（半径）', fmtRadius(d.radius));
  row('密度', fmtDensity(d.density));
  row('温度の目安', fmtTemp(d.teq));
  row('恒星からの距離', fmtDist(p.a));
  row('1周にかかる時間', fmtPeriod(d.period));
  row('軌道の形（離心率）', fmtEcc(p.e));
  nodes.push(dl);
  const total = d.mass;
  const bar = document.createElement('div');
  bar.className = 'compbar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', '組成: ' + COMP.map(([k, l]) => `${l} ${Math.round((100 * p.mass[k]) / total)}%`).join('、'));
  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const [k, label, color] of COMP) {
    const frac = p.mass[k] / total;
    const s = document.createElement('span');
    s.style.width = `${(frac * 100).toFixed(2)}%`;
    s.style.background = color;
    bar.append(s);
    if (frac >= 0.005) {
      const l = document.createElement('span');
      const i = document.createElement('i');
      i.style.background = color;
      l.append(i, `${label} ${Math.round(frac * 100)}%`);
      legend.append(l);
    }
  }
  nodes.push(bar, legend);
  return nodes;
}
