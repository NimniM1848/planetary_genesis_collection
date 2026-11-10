// 図鑑で使う「惑星の特徴」と「惑星系の型」。希少度の統計表(rarity_table.js)を作る側(harness)と、
// 図鑑を引く側(UI)の両方がこのファイルを使うので、定義を変えたら統計表を作り直すこと。
import { describePlanet } from '../sim/physics.js';
import { habitableZone } from '../ui/layout.js';

/** 図鑑の行（惑星分類）と列（特徴タグ）の並び順 */
export const DEX_CLASSES = ['巨大ガス惑星', '巨大氷惑星', 'ネプチューン級', 'ミニネプチューン', '氷惑星', 'スーパーアース', '岩石惑星', '巨大岩石惑星'];
export const DEX_TAGS = ['ホットジュピター', '溶岩惑星', '高温', '低温', '氷主体', '低密度', '高離心率', 'ハビタブルゾーン内'];

/** 惑星 1 個の物理量・分類・タグ（sim のタグに、図鑑用の「ハビタブルゾーン内」を加える） */
export function planetFeatures(planet, star) {
  const d = describePlanet(planet, star);
  const tags = [...d.tags];
  const hz = habitableZone(star.luminosity);
  if (planet.a >= hz.inner && planet.a <= hz.outer) tags.push('ハビタブルゾーン内');
  return { ...d, tags };
}

/** 「分類 × タグの組み合わせ」の鍵。タグは並び順に依らない */
export const comboKey = (cls, tags) => `${cls}|${[...tags].sort().join('+') || 'なし'}`;

/**
 * 太陽系風（厳密）: 岩石惑星/スーパーアースが 2 個以上すべて 2 AU より内側、巨星（巨大ガス・巨大氷・ネプチューン級）が 2 個以上で
 * そのうち巨大ガス惑星が 1 個以上、巨星はすべて 3 AU より外側かつ岩石惑星より外側。
 * @param {[{ a: number }, string][]} pairs [惑星, 分類] の配列
 */
export function isSolarLike(pairs) {
  const terr = pairs.filter(([, c]) => c === '岩石惑星' || c === 'スーパーアース');
  const giants = pairs.filter(([, c]) => c === '巨大ガス惑星' || c === '巨大氷惑星' || c === 'ネプチューン級');
  if (terr.length < 2 || giants.length < 2) return false;
  if (!giants.some(([, c]) => c === '巨大ガス惑星')) return false;
  const maxTerr = Math.max(...terr.map(([p]) => p.a));
  const minGiant = Math.min(...giants.map(([p]) => p.a));
  return maxTerr < 2 && minGiant >= 3 && minGiant > maxTerr;
}

/** 惑星系の「型」。1 つの系が複数の型に当てはまってよい */
export const SYSTEM_PATTERNS = {
  solar: '太陽系風',
  hotJ: 'ホットジュピターのある系',
  gg2: '巨大ガス惑星が複数ある系',
  habitable: 'ハビタブルゾーンに岩石惑星がある系',
  lonely: '惑星がひとつだけの系',
  crowded: '惑星が 8 個以上の系',
  barren: '惑星が残らなかった系',
};

/** @returns {string[]} 当てはまる型の id */
export function systemPatterns(final, star) {
  const feats = final.map((p) => ({ p, f: planetFeatures(p, star) }));
  const out = [];
  if (isSolarLike(feats.map(({ p, f }) => [p, f.class]))) out.push('solar');
  if (feats.some(({ f }) => f.tags.includes('ホットジュピター'))) out.push('hotJ');
  if (feats.filter(({ f }) => f.class === '巨大ガス惑星').length >= 2) out.push('gg2');
  if (feats.some(({ f }) => ['岩石惑星', 'スーパーアース'].includes(f.class) && f.tags.includes('ハビタブルゾーン内') && !f.tags.includes('高温') && !f.tags.includes('溶岩惑星'))) out.push('habitable');
  if (final.length === 1) out.push('lonely');
  if (final.length >= 8) out.push('crowded');
  if (final.length === 0) out.push('barren');
  return out;
}
