// 惑星系・惑星の名前。seed と惑星の軌道順から決まる純粋関数（同じ結果なら同じ名前）。
import { createRng } from '../sim/rng.js';

const SYLLABLES = ['カ', 'リ', 'ト', 'ナ', 'ム', 'セ', 'ロ', 'ヴィ', 'ズ', 'ネ', 'ハ', 'ミ', 'ラ', 'ク', 'オ', 'ソ'];
const LETTERS = 'bcdefghijklmnop';

export function systemName(seed) {
  const rng = createRng(seed ^ 0x5bd1e995);
  const n = 3 + Math.floor(rng.next() * 2);
  let s = '';
  for (let i = 0; i < n; i++) s += SYLLABLES[Math.floor(rng.next() * SYLLABLES.length)];
  return s;
}

/**
 * 惑星 id → 名前。初期の軌道長半径の小さい順に b, c, d... を割り当てる
 * （合体や放出で最終的にいなくなる惑星にも名前が付く）。
 * @param {import('../sim/types.js').SimResult} result
 * @returns {Map<number, string>}
 */
export function planetNames(result) {
  const sys = systemName(result.input.seed);
  const sorted = [...result.snapshots[0].planets].sort((x, y) => x.a - y.a);
  return new Map(sorted.map((p, i) => [p.id, `${sys} ${LETTERS[i] ?? `#${p.id}`}`]));
}
