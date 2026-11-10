// 再現性の検査: ブラウザの種類（Chrome / Safari / Firefox）によって、指数・対数・べき乗などの結果が最後の 1 桁だけ
// 違っても、結果の中身（散乱を除くできごとの順番・惑星の数と分類・希少度）が変わらないことを確かめる。
// （散乱の繰り返しの回数は、乱数の判定がきわどいとき、約 1,000 系に 1 系の割合でずれることがある。他は変わらない）
// 実行: node tests/robustness.js   （計算に、きわどい分岐が増えて壊れやすくなったら、ここで気づける）
import assert from 'node:assert/strict';
import { runSimulation } from '../src/sim/sim.js';
import { randomInput } from '../src/ui/presets.js';
import { planetFeatures } from '../src/dex/features.js';
import { rarityOfSystem } from '../src/dex/rarity.js';

const names = ['exp', 'log', 'pow', 'cbrt', 'sin', 'cos', 'atan2'];
const orig = Object.fromEntries(names.map((n) => [n, Math[n]]));
const EPS = 2 ** -52;
const perturb = (on, salt) => {
  for (const n of names) {
    Math[n] = on ? (...a) => {
      const v = orig[n](...a);
      const h = (Math.abs(a[0]) * 1e7 + salt) % 3; // 引数から決まる擬似乱数で、約 2/3 の呼び出しを 1 ulp ずらす
      return h < 1 ? v * (1 + EPS) : h < 2 ? v * (1 - EPS) : v;
    } : orig[n];
  }
};

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } finally { perturb(false, 0); } };

console.log('再現性（関数の結果が 1 ulp ずれても、結果の中身が変わらない）');
test('60 系: 散乱を除くできごとの順番・惑星の数と分類・希少度の階級が同じで、数値のずれは 1e-9 未満（まれな例外は 1 系まで）', () => {
  const seq = (r) => r.events.filter((e) => e.kind !== 'scatter').map((e) => `${e.kind}:${e.ids.join('-')}`).join(','); // 散乱の回数は除く（上の注）
  const cls = (r) => r.final.map((p) => planetFeatures(p, r.input.star).class).sort().join(',');
  const tot = (m) => m.metal + m.rock + m.ice + m.gas;
  const odd = []; // 基準を満たさなかった系（約 1,000 系に 1 系の例外。散乱の回数がずれると、弾き出される時刻が 1 ステップずれ、質量が 0.2% ほど変わることがある）
  for (let i = 0; i < 60; i++) {
    const input = randomInput(31000 + i);
    perturb(false, 0); const a = runSimulation(input);
    perturb(true, 17 + i); const b = runSimulation(input);
    let why = null;
    if (seq(a) !== seq(b)) why = 'できごとが変わった';
    else if (cls(a) !== cls(b)) why = '惑星の分類が変わった';
    else if (rarityOfSystem(a.final, a.input.star).tier !== rarityOfSystem(b.final, b.input.star).tier) why = '希少度が変わった';
    else {
      let rel = 0;
      for (let k = 0; k < a.final.length; k++) rel = Math.max(rel, Math.abs(tot(a.final[k].mass) - tot(b.final[k].mass)) / tot(a.final[k].mass), Math.abs(a.final[k].a - b.final[k].a) / a.final[k].a);
      if (rel >= 1e-9) why = `数値のずれが大きい (${rel.toExponential(1)})`;
    }
    if (why) odd.push(`seed ${input.seed}: ${why}`);
  }
  assert.ok(odd.length <= 1, `例外が多すぎる（${odd.length} 系）: ${odd.join(' / ')}`);
  if (odd.length) console.log(`       （例外 1 系: ${odd[0]}）`);
});
test('ずらしても、質量保存は保たれる', () => {
  perturb(true, 5);
  for (let i = 0; i < 10; i++) assert.ok(runSimulation(randomInput(32000 + i)).ledger.relError <= 1e-9);
});

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
