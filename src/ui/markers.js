// できごとのマーカー: 再生が (tFrom, tTo] を通過したときに、起きた場所へ付ける印を作る（純粋関数）。
import { MARKER_STYLE } from './render.js';

/**
 * @param {import('../sim/types.js').SimEvent[]} events
 * @param {number} tFrom 前のフレームの時刻（この時刻は含まない）
 * @param {number} tTo 今のフレームの時刻（含む）
 * @param {(id: number) => ({ a: number, ang: number } | null)} hitOf 直近に描いた惑星の位置
 * @param {(id: number) => string} letterOf 惑星の短い呼び名（例: b）
 * @param {number} born 描画上の時計
 * @param {Set<string>} [seenPairs] すでに印を付けた散乱のペア（同じペアの散乱は続けて起きるので、最初の 1 回だけ印を付ける）
 */
export function newMarkers(events, tFrom, tTo, hitOf, letterOf, born, seenPairs = new Set()) {
  const out = [];
  let scatters = 0;
  for (const e of events) {
    if (e.t <= tFrom || e.t > tTo) continue;
    const st = MARKER_STYLE[e.kind];
    if (!st) continue;
    if (e.kind === 'scatter') {
      const key = [...e.ids].sort((x, y) => x - y).join('-');
      if (seenPairs.has(key) || ++scatters > 2) continue; // 同じペアの散乱は最初の 1 回だけ。1 フレームに 2 個まで
      seenPairs.add(key);
    }
    if (e.kind === 'dispersal') {
      out.push({ kind: e.kind, a: null, ang: 0, born, label: st.label });
      continue;
    }
    const hit = hitOf(e.ids[0]);
    const a = hit?.a ?? e.data?.a ?? null;
    if (a === null) continue;
    const ang = hit?.ang ?? (e.ids[0] * 2.399963) % (Math.PI * 2);
    const label = e.kind === 'merge' ? `${st.label} ${letterOf(e.ids[0])}+${letterOf(e.ids[1])}`
      : e.kind === 'scatter' ? `${st.label} ${letterOf(e.ids[0])}・${letterOf(e.ids[1])}` : `${st.label} ${letterOf(e.ids[0])}`;
    out.push({ kind: e.kind, id: e.ids[0], a, ang, born, label, desc: hit?.desc ?? null, rr: hit?.rr ?? 4 });
  }
  return out;
}
