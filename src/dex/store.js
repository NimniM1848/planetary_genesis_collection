// 図鑑の保存 (localStorage)。保存するのは条件(SimInput)と最終結果(final)だけ（数 KB）。
// 再生用のスナップショットは、同じモデルバージョンなら再計算で復元できる。
import { fnv1a } from '../sim/hash.js';
import { comboKey, DEX_CLASSES, DEX_TAGS } from './features.js';
import { RARITY_TABLE } from './rarity_table.js';

export const STORE_KEY = 'planet_create_dex_v1';
export const MAX_SYSTEMS = 300;

/** 惑星系の識別子。同じ条件（モデルのバージョンを含む）なら同じ値 */
export function systemId(input) {
  const s = input.star, d = input.disk;
  return fnv1a(JSON.stringify([input.modelVersion, input.seed, s.mass, s.luminosity, s.Z, d.mass, d.rIn, d.rOut, d.tLife, d.p,
    (d.structures ?? []).map((x) => [x.r, x.width, x.amp]), input.nRandomSeeds, input.seeds ?? []]));
}

/** 「分類 × タグ」のマス目。タグのない惑星は「なし」の列に入る */
export function cellsOf(cls, tags) {
  return tags.length ? tags.map((t) => `${cls}|${t}`) : [`${cls}|なし`];
}

/** 統計表から「出うるマス」を求める */
export function possibleCells(table = RARITY_TABLE) {
  const set = new Set();
  for (const key of Object.keys(table.combos)) {
    const [cls, tagStr] = key.split('|');
    for (const c of cellsOf(cls, tagStr === 'なし' ? [] : tagStr.split('+'))) set.add(c);
  }
  return set;
}

/**
 * @param {Pick<Storage,'getItem'|'setItem'>|null} storage 保存先（テストで差し替える）。null や例外のときは、メモリ上だけで動く
 */
export function createStore(storage) {
  let data = { v: 1, systems: [], planets: [] };
  let lastError = '';
  try {
    const raw = storage?.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1 && Array.isArray(parsed.systems) && Array.isArray(parsed.planets)) data = parsed;
    }
  } catch { /* 壊れていたら、空から始める */ }

  const persist = () => {
    try { storage?.setItem(STORE_KEY, JSON.stringify(data)); lastError = ''; return true; }
    catch (e) { lastError = '保存できませんでした（ブラウザの保存容量がいっぱいか、保存が禁止されています）。'; return false; }
  };

  return {
    get error() { return lastError; },
    systems: () => data.systems,
    planets: () => data.planets,
    hasSystem: (id) => data.systems.some((s) => s.id === id),
    hasPlanet: (id) => data.planets.some((p) => p.id === id),
    /**
     * 惑星系を登録する。上限や保存容量を超えるときは、いちばん古い惑星系から自動で入れ替える
     * （登録した惑星は消さない。削除のボタンが無くても、登録が止まらないようにするため）。
     * @returns {{ ok: boolean, added: boolean, dropped?: number, error?: string }}
     */
    addSystem(rec) {
      if (data.systems.some((s) => s.id === rec.id)) return { ok: true, added: false };
      const kept = data.systems.slice();
      let dropped = 0;
      while (data.systems.length >= MAX_SYSTEMS) { data.systems.pop(); dropped++; }
      data.systems.unshift(rec);
      // 保存できなければ、古い惑星系を 1 件ずつ手放して、やり直す
      while (!persist()) {
        if (data.systems.length <= 1) { data.systems = kept; return { ok: false, added: false, error: lastError }; }
        data.systems.pop(); dropped++;
      }
      return { ok: true, added: true, dropped };
    },
    addPlanet(rec) {
      if (data.planets.some((p) => p.id === rec.id)) return { ok: true, added: false };
      data.planets.unshift(rec);
      if (!persist()) { data.planets.shift(); return { ok: false, added: false, error: lastError }; }
      return { ok: true, added: true };
    },
    removeSystem(id) { data.systems = data.systems.filter((s) => s.id !== id); return persist(); },
    removePlanet(id) { data.planets = data.planets.filter((p) => p.id !== id); return persist(); },
    /** マスの埋まり具合: 行 = 分類、列 = タグ（と「なし」） */
    grid(table = RARITY_TABLE) {
      const possible = possibleCells(table);
      const filled = new Map();
      for (const p of data.planets) for (const c of cellsOf(p.cls, p.tags)) filled.set(c, (filled.get(c) ?? 0) + 1);
      const cols = [...DEX_TAGS, 'なし'];
      const rows = DEX_CLASSES.map((cls) => ({
        cls,
        cells: cols.map((tag) => {
          const key = `${cls}|${tag}`;
          const n = filled.get(key) ?? 0;
          return { key, tag, count: n, filled: n > 0, possible: possible.has(key) || n > 0 };
        }),
      }));
      let total = 0, done = 0;
      for (const r of rows) for (const c of r.cells) if (c.possible) { total++; if (c.filled) done++; }
      return { cols, rows, total, done };
    },
  };
}
