// 希少度の統計表を作る。ゲームの既定と同じ「ランダム設定」の惑星系を大量に作って、
// 惑星の「分類 × タグ」の組み合わせと、惑星系の「型」の出現率を数える。
//   集計: node harness/build_rarity.js count <最初のseed> <系の数> <出力.json>
//   統合: node harness/build_rarity.js merge <出力.js> <部分.json> <部分.json> ...
import { writeFileSync, readFileSync } from 'node:fs';
import { runSimulation } from '../src/sim/sim.js';
import { MODEL_VERSION } from '../src/sim/params.js';
import { randomInput } from '../src/ui/presets.js';
import { planetFeatures, comboKey, systemPatterns } from '../src/dex/features.js';

const [mode, ...args] = process.argv.slice(2);

if (mode === 'count') {
  const [seed0, n, out] = [Number(args[0]), Number(args[1]), args[2]];
  const combos = {}, patterns = {};
  let planets = 0;
  for (let i = 0; i < n; i++) {
    const input = randomInput(seed0 + i);
    const r = runSimulation(input);
    for (const p of r.final) {
      const f = planetFeatures(p, input.star);
      const k = comboKey(f.class, f.tags);
      combos[k] = (combos[k] ?? 0) + 1;
      planets++;
    }
    for (const id of systemPatterns(r.final, input.star)) patterns[id] = (patterns[id] ?? 0) + 1;
  }
  writeFileSync(out, JSON.stringify({ systems: n, planets, combos, patterns, modelVersion: MODEL_VERSION, seed0 }));
  console.log(`count: ${n} systems, ${planets} planets -> ${out}`);
} else if (mode === 'merge') {
  const [out, ...parts] = args;
  const acc = { systems: 0, planets: 0, combos: {}, patterns: {}, modelVersion: null, seeds: [] };
  for (const f of parts) {
    const p = JSON.parse(readFileSync(f, 'utf8'));
    acc.systems += p.systems; acc.planets += p.planets; acc.seeds.push(p.seed0);
    acc.modelVersion = acc.modelVersion ?? p.modelVersion;
    if (acc.modelVersion !== p.modelVersion) throw new Error('モデルのバージョンが違う部分が混ざっている');
    for (const [k, v] of Object.entries(p.combos)) acc.combos[k] = (acc.combos[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.patterns)) acc.patterns[k] = (acc.patterns[k] ?? 0) + v;
  }
  // 惑星の階級: 出現率の低い組み合わせから累積して、全惑星に対する割合で 5 段階に分ける（上位 2% / 8% / 20% / 45% / 残り）
  const CUT = [0.02, 0.08, 0.2, 0.45];
  const sorted = Object.entries(acc.combos).sort((a, b) => a[1] - b[1]);
  const tierMaxP = []; // tier5, tier4, tier3, tier2 の出現率の上限
  let cum = 0, ci = 0;
  for (const [, c] of sorted) {
    cum += c / acc.planets;
    while (ci < CUT.length && cum > CUT[ci]) { tierMaxP.push(c / acc.planets); ci++; }
  }
  while (tierMaxP.length < 4) tierMaxP.push(1);
  const table = {
    modelVersion: acc.modelVersion, systems: acc.systems, planets: acc.planets, seeds: acc.seeds,
    combos: Object.fromEntries(Object.entries(acc.combos).sort((a, b) => b[1] - a[1])),
    patterns: acc.patterns,
    tierMaxP, // [階級5 の上限, 階級4, 階級3, 階級2]（これより出現率が高ければ、次の階級）
  };
  const body = `// 自動生成: node harness/build_rarity.js merge ...（手で編集しない）\n// 元データ: ゲームの既定と同じランダム設定の ${acc.systems} 系・${acc.planets} 惑星（モデル ${acc.modelVersion}）。\n// 定義(features.js)かモデルが変わったら、作り直すこと。\nexport const RARITY_TABLE = ${JSON.stringify(table, null, 1)};\n`;
  writeFileSync(out, body);
  console.log(`merge: ${acc.systems} systems, ${acc.planets} planets, ${Object.keys(acc.combos).length} combos -> ${out}`);
  console.log('tierMaxP', tierMaxP.map((x) => x.toFixed(4)).join(' '));
} else {
  console.log('usage: count <seed0> <n> <out.json> | merge <out.js> <parts...>');
}
