// 希少度。統計表(rarity_table.js)で、惑星の「分類 × タグの組み合わせ」と、惑星系の「型」の出現率を引く。
// 階級は 5 段階。惑星は出現率の低い組み合わせから累積した割合（上位 2% / 8% / 20% / 45%）で区切る。
import { RARITY_TABLE } from './rarity_table.js';
import { comboKey, planetFeatures, systemPatterns, SYSTEM_PATTERNS } from './features.js';

export const TIER_LABELS = ['', 'ふつう', 'すこし珍しい', '珍しい', 'とても珍しい', '超希少'];

/** ★の表示（階級 1〜5） */
export const stars = (tier) => '★'.repeat(tier) + '☆'.repeat(5 - tier);

/** 惑星の組み合わせの階級。統計に 1 度も出てこなかった組み合わせは、最上位 */
export function tierOfCombo(key, table = RARITY_TABLE) {
  const count = table.combos[key];
  if (!count) return 5;
  const p = count / table.planets;
  const [t5, t4, t3, t2] = table.tierMaxP;
  if (p <= t5) return 5;
  if (p <= t4) return 4;
  if (p <= t3) return 3;
  if (p <= t2) return 2;
  return 1;
}

/** 惑星 1 個の希少度 */
export function rarityOfPlanet(planet, star, table = RARITY_TABLE) {
  const f = planetFeatures(planet, star);
  const key = comboKey(f.class, f.tags);
  const count = table.combos[key] ?? 0;
  const tier = tierOfCombo(key, table);
  return { tier, label: TIER_LABELS[tier], stars: stars(tier), key, class: f.class, tags: f.tags, share: count / table.planets, count };
}

/** 惑星系の型の階級（出現率が低いほど高い。統計に出てこない型は最上位） */
export function tierOfPattern(id, table = RARITY_TABLE) {
  const p = (table.patterns[id] ?? 0) / table.systems;
  if (p >= 0.25) return 1;
  if (p >= 0.12) return 2;
  if (p >= 0.05) return 3;
  if (p >= 0.02) return 4;
  return 5;
}

/** 惑星系の希少度 = 含まれる最も珍しい惑星と、当てはまる最も珍しい型の、高いほう */
export function rarityOfSystem(final, star, table = RARITY_TABLE) {
  const planetTiers = final.map((p) => ({ p, r: rarityOfPlanet(p, star, table) }));
  const best = planetTiers.reduce((a, b) => (!a || b.r.tier > a.r.tier ? b : a), null);
  const patterns = systemPatterns(final, star).map((id) => ({ id, label: SYSTEM_PATTERNS[id], tier: tierOfPattern(id, table) }));
  const bestPattern = patterns.reduce((a, b) => (!a || b.tier > a.tier ? b : a), null);
  const tier = Math.max(best?.r.tier ?? 1, bestPattern?.tier ?? 1);
  // どれが決め手か（共有文や表示で「なぜ珍しいか」を言うため）
  const reason = bestPattern && bestPattern.tier >= (best?.r.tier ?? 0)
    ? { kind: 'pattern', label: bestPattern.label }
    : best ? { kind: 'planet', label: `${best.r.class}${best.r.tags.length ? '（' + best.r.tags.join('・') + '）' : ''}`, planet: best.p } : { kind: 'none', label: '' };
  return { tier, label: TIER_LABELS[tier], stars: stars(tier), patterns, reason, planetTiers };
}
