// 共有: 条件を URL に入れて、同じ惑星系を再現できるようにする。X 等への投稿文・リンクも作る。
import { FIELDS } from '../ui/fields.js';
import { MODEL_VERSION } from '../sim/params.js';
import { TIER_LABELS, stars } from './rarity.js';

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

const hard = (id) => FIELDS.find((f) => f.id === id).hard;
const inRange = (id, v) => Number.isFinite(v) && v >= hard(id)[0] - 1e-9 && v <= hard(id)[1] + 1e-9;

/** 条件 → 短い文字列（URL の # の後に入れる） */
export function encodeShare(input) {
  const s = input.star, d = input.disk;
  return b64url(JSON.stringify({
    v: 1, m: input.modelVersion, s: input.seed, a: [s.mass, s.luminosity, s.Z],
    d: [d.mass, d.rIn, d.rOut, d.tLife, d.p], t: (d.structures ?? []).map((x) => [x.r, x.width, x.amp]), n: input.nRandomSeeds,
  }));
}

/**
 * 文字列 → 条件。外から来る値なので、入れられる範囲を確かめ、外れていたら受け付けない。
 * @returns {{ ok: true, input: any } | { ok: false, error: string }}
 */
export function decodeShare(str) {
  let o;
  try { o = JSON.parse(unb64url(str)); } catch { return { ok: false, error: '共有リンクを読み取れませんでした。' }; }
  const bad = (msg) => ({ ok: false, error: `共有リンクの内容が正しくありません（${msg}）。` });
  if (!o || o.v !== 1 || !Array.isArray(o.a) || !Array.isArray(o.d) || !Array.isArray(o.t)) return bad('形式');
  const [mass, lum, Z] = o.a;
  const [dmass, rIn, rOut, tLife, p] = o.d;
  const checks = [['f-mstar', mass], ['f-lum', lum], ['f-z', Z], ['f-dmass', dmass], ['f-rin', rIn], ['f-rout', rOut], ['f-tlife', tLife / 1e6], ['f-p', p],
    ['f-seed', o.s]];
  for (const [id, v] of checks) if (!inRange(id, v)) return bad(FIELDS.find((f) => f.id === id).label);
  if (!Number.isInteger(o.n) || !Number.isInteger(o.s) || o.n < 0 || o.n > 16) return bad('整数'); // n は、旧形式（種の数を指定した計算）との互換のためだけに残している
  if (typeof o.m !== 'string' || o.m.length > 40) return bad('モデル');
  if (o.t.length > 4) return bad('円盤の構造');
  const structures = [];
  for (const x of o.t) {
    if (!Array.isArray(x) || x.length !== 3 || !x.every(Number.isFinite)) return bad('円盤の構造');
    const [r, width, amp] = x;
    if (!(r > rIn && r < rOut && width >= 0.05 && width <= 0.5 && amp > -1 && amp <= 3)) return bad('円盤の構造');
    structures.push({ r, width, amp });
  }
  return { ok: true, input: { seed: o.s, modelVersion: o.m, star: { mass, luminosity: lum, Z }, disk: { mass: dmass, rIn, rOut, tLife, p, structures }, seeds: [], nRandomSeeds: o.n } };
}

export const buildShareUrl = (base, input) => `${base}#s=${encodeShare(input)}`;

/** `#s=...` を含むハッシュから条件を取り出す。無ければ null */
export function parseShareHash(hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash ?? '');
  return m ? decodeShare(m[1]) : null;
}

/** 他の人が開けるアドレスか（localhost・ファイル・家庭内のアドレスは、共有しても開けない） */
export function isPublicUrl(loc) {
  if (!/^https?:$/.test(loc.protocol)) return false;
  const h = loc.hostname;
  return !(h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local') || h === '[::1]');
}

const HASHTAG = '#惑星系創造';

/** 惑星系の投稿文 */
export function systemShareText({ name, nPlanets, rarity, seed }, hasUrl) {
  const why = rarity.reason?.label ? `「${rarity.reason.label}」` : '';
  return [`惑星系「${name}系」ができた！ 惑星${nPlanets}個`, `希少度 ${stars(rarity.tier)}（${TIER_LABELS[rarity.tier]}）${why}`, hasUrl ? '' : `シード ${seed}（同じ条件で再現できます）`, HASHTAG].filter(Boolean).join('\n');
}

/** 惑星の投稿文 */
export function planetShareText({ name, cls, tags, tier }, hasUrl, seed) {
  const t = tags.length ? `（${tags.slice(0, 3).join('・')}）` : '';
  return [`${name} は ${cls}${t}！`, `希少度 ${stars(tier)}（${TIER_LABELS[tier]}）`, hasUrl ? '' : `シード ${seed}`, HASHTAG].filter(Boolean).join('\n');
}

/** X の投稿画面を開くアドレス */
export function xIntentUrl(text, url) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}${url ? `&url=${encodeURIComponent(url)}` : ''}`;
}

export const modelMatches = (input) => input.modelVersion === MODEL_VERSION;
