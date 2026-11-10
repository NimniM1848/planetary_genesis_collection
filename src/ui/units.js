// 画面に出す数値の表記。専門の記号（M⊕, MJ, R⊕, Myr, K など）は使わず、日常の言葉で言い換える。
// 内部の単位は sim と同じ（質量 M⊕ = 地球の質量、距離 AU = 地球と太陽の距離、時間 yr）。

const M_MOON = 0.0123;
const M_JUPITER = 318;
const R_JUPITER = 11.2; // 地球半径の倍数

/** 太陽系の惑星の質量 [地球 = 1]。「〜くらい」という例えに使う */
const LIKE = [['水星', 0.0553], ['火星', 0.107], ['天王星', 14.5], ['海王星', 17.1], ['土星', 95.2]];

/** 有効数字 2 桁（0.0512 → 0.051、5.234 → 5.2、27.46 → 27） */
export const sig2 = (x) => String(Number(x.toPrecision(2)));

/** 質量 [M⊕] → 「地球の約 12 倍」「木星の約 1.3 倍（地球の約 400 倍）」。近い惑星があれば「（海王星くらい）」を添える */
export function fmtMass(m) {
  if (m < 0.05) return `月の約${sig2(m / M_MOON)}倍`;
  if (m >= 100) {
    const j = m / M_JUPITER;
    return `木星の約${j < 10 ? j.toFixed(1) : Math.round(j)}倍（地球の約${Math.round(m)}倍）`;
  }
  let like = '';
  let best = 0.25; // 対数で ±25% 以内
  for (const [name, ref] of LIKE) {
    const d = Math.abs(Math.log(m / ref));
    if (d < best) { best = d; like = `（${name}くらい）`; }
  }
  return `地球の約${m < 10 ? Number(m.toPrecision(2)) : Math.round(m)}倍${like}`;
}

/** 半径 [R⊕] → 「地球の約 1.6 倍」「木星の約 1.2 倍」 */
export function fmtRadius(r) {
  if (r >= 8) return `木星の約${(r / R_JUPITER).toFixed(1)}倍`;
  return `地球の約${sig2(r)}倍`;
}

/** 密度 [g/cm³] → 「水の約 5.5 倍」（地球は 5.5 倍） */
export const fmtDensity = (d) => `水の約${d < 10 ? d.toFixed(1) : Math.round(d)}倍`;

/** 温度 [K] → 「約 −18℃」 */
export const fmtTemp = (k) => `約${Math.round(k - 273.15)}℃`;

/** 軌道の位置 [AU] → 「地球の軌道の約 5.2 倍の位置」（ログや文章用の短い言い方） */
export const fmtPos = (a) => `地球の軌道の約${sig2(a)}倍の位置`;

/** 恒星からの距離 [AU] → 「太陽〜地球の約 5.2 倍（5.2 AU）」（カード用。AU は括弧で補足） */
export const fmtDist = (a) => `地球〜太陽の約${sig2(a)}倍（${sig2(a)} AU）`;

/** 時間 [yr] → 「300万年」「1,200万年」「1.03億年」 */
export function fmtTime(t) {
  if (t < 1e4) return `${Math.round(t)}年`;
  if (t < 1e8) return `${Math.round(t / 1e4).toLocaleString('ja-JP')}万年`;
  return `${(t / 1e8).toFixed(2)}億年`;
}

/** 離心率 → 「0.12（少し楕円）」 */
export function fmtEcc(e) {
  const word = e < 0.05 ? 'ほぼ円' : e < 0.3 ? '少し楕円' : '大きくつぶれた楕円';
  return `${e.toFixed(2)}（${word}）`;
}

/** 公転周期 [yr] */
export const fmtPeriod = (yr) => (yr < 1 ? `${(yr * 365.25).toFixed(1)} 日` : `${yr.toFixed(1)} 年`);
