// 結果の同一性比較用 (FNV-1a 32bit)。ランキング導入時の再現確認にも使う想定。

/** @param {string} str */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** @param {{final:any, events:any, input:any}} result */
export function hashResult(result) {
  return fnv1a(JSON.stringify({ i: result.input, f: result.final, e: result.events }));
}
