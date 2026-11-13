// 惑星の見た目（色と模様）。組成比・平衡温度・分類から決める純粋関数。
// 模様の乱数は、系の seed と惑星 ID から決める（同じ惑星は何度見ても同じ見た目）。
import { createRng } from '../sim/rng.js';

const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;

/**
 * @param {string} cls 惑星分類
 * @param {number} teq 平衡温度 [K]
 * @returns {{ fill: string, accent: string, glow: string | null }}
 */
export function planetColor(cls, teq) {
  switch (cls) {
    case '巨大ガス惑星':
      if (teq > 1400) return { fill: hsl(12, 70, 38), accent: hsl(330, 50, 28), glow: 'rgba(255,90,30,0.55)' };
      if (teq > 800) return { fill: hsl(28, 65, 48), accent: hsl(18, 60, 34), glow: 'rgba(255,150,60,0.35)' };
      if (teq > 150) return { fill: hsl(38, 50, 64), accent: hsl(28, 45, 46), glow: null };
      return { fill: hsl(200, 35, 72), accent: hsl(215, 40, 55), glow: null };
    case '巨大氷惑星':
      return { fill: hsl(205, 60, 58), accent: hsl(220, 55, 42), glow: null };
    case 'ネプチューン級':
      return { fill: hsl(220, 55, 52), accent: hsl(230, 50, 38), glow: null };
    case 'ミニネプチューン':
      return { fill: hsl(195, 42, 62), accent: hsl(205, 40, 46), glow: null };
    case '海洋惑星':
      return { fill: hsl(205, 75, 38), accent: hsl(190, 60, 55), glow: teq > 600 ? 'rgba(120,200,255,0.4)' : null }; // 深い青（高温なら、水蒸気で白っぽく光る）
    case '氷惑星':
      return { fill: hsl(200, 30, 82), accent: hsl(210, 30, 65), glow: null };
    default: // 岩石惑星・スーパーアース・巨大岩石惑星
      if (teq > 1500) return { fill: hsl(12, 85, 46), accent: hsl(40, 90, 55), glow: 'rgba(255,100,20,0.6)' };
      if (teq < 200) return { fill: hsl(210, 12, 72), accent: hsl(210, 10, 55), glow: null };
      if (cls === 'スーパーアース') return { fill: hsl(34, 38, 40), accent: hsl(30, 30, 28), glow: null };
      if (cls === '巨大岩石惑星') return { fill: hsl(16, 45, 32), accent: hsl(12, 38, 22), glow: null };
      return { fill: hsl(25, 22, 48), accent: hsl(20, 18, 34), glow: null };
  }
}

/** 縞模様の位置と濃さ（ガス・氷の巨大惑星用）。0〜1 の縦位置を返す */
export function bandPattern(seed, planetId, count = 3) {
  const rng = createRng((seed * 1000 + planetId) >>> 0);
  return Array.from({ length: count }, () => ({ y: 0.2 + 0.6 * rng.next(), w: 0.06 + 0.1 * rng.next() }));
}

/** 初期位相 [rad]。惑星 id と seed だけで決まる */
export function initialPhase(seed, planetId) {
  return createRng((seed * 7919 + planetId * 104729) >>> 0).next() * Math.PI * 2;
}

/**
 * 惑星の系統（種類）の凡例。色は軌道図と同じ planetColor で決まる。
 * key は planetKey() の戻り値。高温の巨星と溶岩惑星は、色が変わるので別の行にする。
 */
export const PLANET_LEGEND = [
  { key: '巨大ガス惑星', cls: '巨大ガス惑星', teq: 300, desc: '木星のように、ガスが主体の巨大な惑星' },
  { key: 'ホットジュピター', cls: '巨大ガス惑星', teq: 1500, desc: '恒星のすぐそばを回る、高温の巨大ガス惑星（赤く光る）' },
  { key: '巨大氷惑星', cls: '巨大氷惑星', teq: 80, desc: '天王星や海王星のように、氷とガスでできた巨大な惑星' },
  { key: 'ネプチューン級', cls: 'ネプチューン級', teq: 80, desc: '海王星くらいの、ガスをまとった惑星' },
  { key: 'ミニネプチューン', cls: 'ミニネプチューン', teq: 200, desc: '地球より大きく、厚い大気をもつ小さめの惑星' },
  { key: '氷惑星', cls: '氷惑星', teq: 80, desc: '氷が主体の、固体の惑星' },
  { key: '海洋惑星', cls: '海洋惑星', teq: 350, desc: '氷（水）を多く含み、氷が解ける温度の、固体の惑星' },
  { key: 'スーパーアース', cls: 'スーパーアース', teq: 300, desc: '地球より重い、岩石の惑星' },
  { key: '岩石惑星', cls: '岩石惑星', teq: 300, desc: '地球のような、岩石の惑星' },
  { key: '巨大岩石惑星', cls: '巨大岩石惑星', teq: 300, desc: 'とても重い岩石の惑星' },
  { key: '溶岩惑星', cls: '岩石惑星', teq: 1800, desc: '高温で表面が溶けた岩石の惑星（赤く光る）' },
];

/** describePlanet の結果から、凡例の行（key）を決める。ホットジュピターと溶岩惑星は別の行 */
export function planetKey(d) {
  if (d.tags.includes('ホットジュピター')) return 'ホットジュピター';
  if (d.tags.includes('溶岩惑星')) return '溶岩惑星';
  return d.class;
}

/** 近点の向き [rad]。惑星 id と seed だけで決まる（同じ惑星は、いつも同じ向きの楕円） */
export function initialPeriapsis(seed, planetId) {
  return createRng((seed * 31 + planetId * 17 + 5) >>> 0).next() * Math.PI * 2;
}
