// 詳細設定の入力欄ごとの「入れられる範囲」と「目安」。index.html の min/max はここと一致させる（テストで確認）。
// hard = 計算が破綻せず、結果が極端になりすぎない範囲（ランダムに 300 通り試して確認済み）。typical = ふつうの目安。
export const FIELDS = [
  { id: 'f-mstar', label: '恒星の重さ', hard: [0.5, 1.5], typical: [0.6, 1.4], unit: '倍',
    hint: '太陽の何倍の重さか（太陽 = 1）。重いほど明るく熱い恒星になります。' },
  { id: 'f-lum', label: '恒星の明るさ', hard: [0.1, 5], typical: [0.2, 3], unit: '倍',
    hint: '太陽の何倍の明るさか（太陽 = 1）。ふつうは、重い星ほど急に明るくなります。明るいほど、氷ができる境目（スノーライン）が外へ動きます。' },
  { id: 'f-z', label: '金属量', hard: [0.2, 2.5], typical: [0.3, 2], unit: '',
    hint: '水素・ヘリウム以外の重い元素の量（太陽 = 1）。高いほど惑星の材料（固体）が増え、巨大ガス惑星ができやすくなります。' },
  { id: 'f-dmass', label: '円盤の重さ', hard: [0.005, 0.08], typical: [0.01, 0.06], unit: '倍',
    hint: '恒星に対する円盤の重さ（太陽の何倍か）。標準は 0.03（太陽の3%）。重いほど巨星が大きく育ち、内側へ移動しやすくなります。' },
  { id: 'f-rin', label: '円盤の内縁', hard: [0.02, 0.2], typical: [0.03, 0.1], unit: 'AU',
    hint: '恒星からの距離（半径）。1 AU は地球と太陽の距離です。惑星はこれより内側へは入れません。水星は 0.39 AU です。' },
  { id: 'f-rout', label: '円盤の外縁', hard: [15, 80], typical: [25, 60], unit: 'AU',
    hint: '恒星からの距離（半径。直径ではありません）。1 AU は地球と太陽の距離です。海王星は 30 AU、冥王星あたりは 40 AU です。' },
  { id: 'f-tlife', label: '円盤の寿命', hard: [1, 6], typical: [1.5, 5], unit: '百万年',
    hint: 'ガスが消えるまでの時間（百万年）。標準は 3（300万年）。長いほど、惑星がガスを集める時間が増えます。' },
  { id: 'f-p', label: '表面密度の指数 p', hard: [0.5, 1.5], typical: [0.7, 1.3], unit: '',
    hint: '標準は 1。大きいほど、円盤の材料が内側に集まります。' },
  { id: 'f-seed', label: 'シード', hard: [0, 999999999], typical: null, unit: '',
    hint: '同じ値なら、同じ条件で同じ結果になります。' },
];

/** 入力値が目安の範囲外（ただし入れられる範囲内）かどうかの注意文。問題なければ空文字 */
export function rangeWarning(field, value) {
  if (!field.typical || !Number.isFinite(value)) return '';
  const [lo, hi] = field.typical;
  if (value < lo) return `目安（${lo}〜${hi}）より小さい値です。結果が極端になることがあります。`;
  if (value > hi) return `目安（${lo}〜${hi}）より大きい値です。結果が極端になることがあります。`;
  return '';
}

/** 表示用の「目安: a〜b 単位」 */
export function typicalText(field) {
  return field.typical ? `目安 ${field.typical[0]}〜${field.typical[1]} ${field.unit}`.trim() : '';
}
