// seed 固定の PRNG (mulberry32)。Math.random は使わない。
// 乱数の消費順は再現性に直結するので、呼び出し順を変える変更は modelVersion を上げること。

/**
 * @param {number} seed
 */
export function createRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** 内部状態の保存/復元（刻みの再試行で乱数列を巻き戻すため） */
    getState: () => s,
    setState: (v) => { s = v >>> 0; },
    /** [0,1) */
    next,
    /** [lo,hi) 一様 */
    range: (lo, hi) => lo + (hi - lo) * next(),
    /** [lo,hi) 対数一様 */
    logUniform: (lo, hi) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * next()),
    /** Rayleigh(sigma) */
    rayleigh: (sigma) => sigma * Math.sqrt(-2 * Math.log(1 - next())),
  };
}
