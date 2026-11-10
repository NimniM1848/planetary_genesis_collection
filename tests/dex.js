// 図鑑の部品（希少度・保存・共有）のテスト。実行: node tests/dex.js
import assert from 'node:assert/strict';
import { runSimulation } from '../src/sim/sim.js';
import { baselineInput, MODEL_VERSION } from '../src/sim/params.js';
import { randomInput, presetInput } from '../src/ui/presets.js';
import { RARITY_TABLE } from '../src/dex/rarity_table.js';
import { DEX_CLASSES, DEX_TAGS, comboKey, planetFeatures, systemPatterns, isSolarLike } from '../src/dex/features.js';
import { tierOfCombo, rarityOfPlanet, rarityOfSystem, tierOfPattern, stars, TIER_LABELS } from '../src/dex/rarity.js';
import { createStore, systemId, cellsOf, possibleCells, MAX_SYSTEMS, STORE_KEY } from '../src/dex/store.js';
import { buildSystemRecord, buildPlanetRecords } from '../src/dex/records.js';
import { encodeShare, decodeShare, parseShareHash, buildShareUrl, isPublicUrl, systemShareText, planetShareText, xIntentUrl } from '../src/dex/share.js';

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};
const T = RARITY_TABLE;

console.log('統計表');
test('統計表: 10,000 系、組み合わせの合計が惑星数と一致、階級の境目が昇順、現在のモデルで作られている', () => {
  assert.equal(T.systems, 10000);
  assert.equal(Object.values(T.combos).reduce((a, b) => a + b, 0), T.planets);
  assert.ok(T.tierMaxP.length === 4 && T.tierMaxP.every((x, i) => i === 0 || x >= T.tierMaxP[i - 1]));
  assert.equal(T.modelVersion, MODEL_VERSION, '統計表のモデルが古い。node harness/build_rarity.js で作り直す');
  for (const k of Object.keys(T.combos)) {
    const [cls, tags] = k.split('|');
    assert.ok(DEX_CLASSES.includes(cls), cls);
    for (const t of tags === 'なし' ? [] : tags.split('+')) assert.ok(DEX_TAGS.includes(t), t);
  }
});
test('階級: 5 段階がおおむね狙いの割合（上位 2% / 8% / 20% / 45% / 残り）に分かれる', () => {
  const share = [0, 0, 0, 0, 0, 0];
  for (const [k, c] of Object.entries(T.combos)) share[tierOfCombo(k)] += c / T.planets;
  assert.ok(share[5] <= 0.03 && share[5] > 0, `階級5: ${share[5]}`); // 組み合わせの粒度で、2% を少し超える
  assert.ok(share[1] > 0.3, `階級1（ふつう）が少なすぎる: ${share[1]}`);
  for (let t = 1; t <= 5; t++) assert.ok(share[t] > 0, `階級${t}が空`);
});
test('階級: いちばんありふれた組み合わせは 1、出現数の少ない組み合わせは 5、統計に無い組み合わせも 5', () => {
  const sorted = Object.entries(T.combos).sort((a, b) => b[1] - a[1]);
  assert.equal(tierOfCombo(sorted[0][0]), 1);
  assert.equal(tierOfCombo(sorted.at(-1)[0]), 5);
  assert.equal(tierOfCombo(comboKey('巨大ガス惑星', ['ハビタブルゾーン内', '溶岩惑星'])), 5);
});
test('★の表示とラベル', () => {
  assert.equal(stars(1), '★☆☆☆☆'); assert.equal(stars(5), '★★★★★');
  assert.equal(TIER_LABELS.length, 6);
});

console.log('惑星・惑星系の希少度');
const res = runSimulation(presetInput('hotjup', 3));
test('惑星の希少度: 組み合わせの鍵、階級、出現率が返る。タグの順に依らない', () => {
  const p = res.final[0];
  const r = rarityOfPlanet(p, res.input.star);
  assert.ok(r.tier >= 1 && r.tier <= 5 && r.label === TIER_LABELS[r.tier]);
  assert.equal(r.key, comboKey(r.class, [...r.tags].reverse()));
  assert.ok(r.share >= 0 && r.share <= 1);
  const f = planetFeatures(p, res.input.star);
  assert.ok(f.tags.every((t) => DEX_TAGS.includes(t)));
});
test('惑星系の希少度: 最も珍しい惑星・型のうち高いほどで決まり、決め手が分かる', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const r = runSimulation(randomInput(seed));
    const s = rarityOfSystem(r.final, r.input.star);
    const maxPlanet = Math.max(1, ...s.planetTiers.map((x) => x.r.tier));
    const maxPattern = Math.max(1, ...s.patterns.map((x) => x.tier));
    assert.equal(s.tier, Math.max(maxPlanet, maxPattern));
    assert.ok(['pattern', 'planet', 'none'].includes(s.reason.kind));
    if (r.final.length) assert.ok(s.reason.label.length > 0);
  }
  assert.equal(tierOfPattern('lonely'), 5); // ほぼ出ない型は最上位
  assert.ok(tierOfPattern('habitable') <= 2 && tierOfPattern('gg2') <= 3); // ありふれた型は低い階級
  assert.ok(tierOfPattern('solar') > tierOfPattern('habitable'), '太陽系風は、ハビタブルな岩石惑星のある系より珍しい');
  assert.ok(tierOfPattern('solar') >= 3 && tierOfPattern('hotJ') >= 3, '太陽系風・ホットジュピターのある系は、珍しい側');
});
test('惑星系の型: 太陽系風・ホットジュピター・巨大ガス惑星の複数・単独・満員・空', () => {
  const star = { mass: 1, luminosity: 1, Z: 1 };
  const mk = (id, a, m, gas = 0, ice = 0) => ({ id, a, e: 0, mass: { metal: 0, rock: m - gas - ice, ice, gas } });
  const solar = [mk(1, 0.4, 0.5), mk(2, 1, 1), mk(3, 5, 318, 300), mk(4, 9, 95, 80), mk(5, 19, 15, 2, 8)];
  assert.ok(systemPatterns(solar, star).includes('solar'));
  assert.ok(systemPatterns(solar, star).includes('habitable'));
  assert.ok(systemPatterns(solar, star).includes('gg2'));
  assert.ok(systemPatterns([mk(1, 0.05, 318, 300)], star).includes('hotJ'));
  assert.ok(systemPatterns([mk(1, 0.05, 318, 300)], star).includes('lonely'));
  assert.ok(systemPatterns([], star).includes('barren'));
  assert.ok(systemPatterns(Array.from({ length: 8 }, (_, i) => mk(i + 1, 1 + i, 1)), star).includes('crowded'));
  assert.ok(!isSolarLike([[{ a: 1 }, '岩石惑星'], [{ a: 5 }, '巨大ガス惑星']]));
});

console.log('保存');
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, _m: m }; };
const sysRec = (input, final, over = {}) => ({ id: systemId(input), savedAt: 1, input, final, name: 'テスト', ...over });
test('systemId: 同じ条件で同じ値、条件が違えば違う値', () => {
  const a = baselineInput(1), b = baselineInput(1), c = baselineInput(2);
  assert.equal(systemId(a), systemId(b));
  assert.notEqual(systemId(a), systemId(c));
  assert.notEqual(systemId({ ...a, modelVersion: 'x' }), systemId(a));
  const d = baselineInput(1); d.star = { ...d.star, Z: 1.01 };
  assert.notEqual(systemId(d), systemId(a));
});
test('保存: 追加・重複の無視・削除・再読み込みで保たれる', () => {
  const st = memStorage();
  const s1 = createStore(st);
  const r = runSimulation(baselineInput(7));
  assert.deepEqual(s1.addSystem(sysRec(r.input, r.final)), { ok: true, added: true, dropped: 0 });
  assert.deepEqual(s1.addSystem(sysRec(r.input, r.final)), { ok: true, added: false });
  assert.equal(s1.systems().length, 1);
  const s2 = createStore(st); // 再読み込み
  assert.equal(s2.systems().length, 1);
  assert.ok(s2.hasSystem(systemId(r.input)));
  assert.equal(s2.systems()[0].final.length, r.final.length);
  assert.ok(s2.removeSystem(systemId(r.input)));
  assert.equal(createStore(st).systems().length, 0);
  assert.ok(JSON.parse(st.getItem(STORE_KEY)).v === 1);
});
test('保存: 壊れたデータ・保存できない環境・容量超過でも例外にならず、追加は取り消される', () => {
  const broken = memStorage(); broken.setItem(STORE_KEY, '{壊れている');
  assert.equal(createStore(broken).systems().length, 0);
  const wrong = memStorage(); wrong.setItem(STORE_KEY, JSON.stringify({ v: 99, systems: [], planets: [] }));
  assert.equal(createStore(wrong).systems().length, 0);
  const none = createStore(null);
  const r = runSimulation(baselineInput(7));
  assert.equal(none.addSystem(sysRec(r.input, r.final)).ok, true); // メモリ上だけで動く
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const fs = createStore(full);
  const res = fs.addSystem(sysRec(r.input, r.final));
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('保存できません'));
  assert.equal(fs.systems().length, 0, '失敗したら取り消す');
});
test('保存: 惑星系が上限を超えたら、古いものから自動で入れ替わる（登録した惑星は残る）', () => {
  const st = createStore(memStorage());
  st.addPlanet({ id: 'keep', cls: '岩石惑星', tags: [], tier: 1 });
  for (let i = 0; i < MAX_SYSTEMS; i++) assert.ok(st.addSystem({ id: `s${i}`, input: {}, final: [] }).ok);
  assert.equal(st.systems().length, MAX_SYSTEMS);
  const over = st.addSystem({ id: 'new', input: {}, final: [] });
  assert.deepEqual([over.ok, over.added, over.dropped], [true, true, 1]);
  assert.equal(st.systems().length, MAX_SYSTEMS);
  assert.equal(st.systems()[0].id, 'new', '新しいものが先頭');
  assert.ok(!st.hasSystem('s0'), 'いちばん古いものが消える');
  assert.ok(st.hasSystem(`s${MAX_SYSTEMS - 1}`));
  assert.ok(st.hasPlanet('keep'), '惑星は消えない');
});
test('保存: 保存容量が足りないときは、古い惑星系を手放して入れ、それでも無理なら取り消す', () => {
  const m = new Map();
  const limit = 3000; // 全体で 3000 文字まで保存できる保存先
  const tight = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (v.length > limit) throw new Error('QuotaExceededError'); m.set(k, v); } };
  const st = createStore(tight);
  const rec = (id) => ({ id, input: {}, final: [], pad: 'x'.repeat(900) });
  for (const id of ['a', 'b', 'c']) assert.ok(st.addSystem(rec(id)).ok); // 3 件で約 2700 文字
  const r = st.addSystem(rec('d')); // 4 件目は入らない → 古いものを手放す
  assert.deepEqual([r.ok, r.added], [true, true]);
  assert.ok(r.dropped >= 1 && st.hasSystem('d') && !st.hasSystem('a'));
  assert.ok(JSON.parse(m.get(STORE_KEY)).systems.length === st.systems().length);
  const huge = st.addSystem({ id: 'huge', input: {}, final: [], pad: 'x'.repeat(5000) }); // 1 件だけでも入らない
  assert.equal(huge.ok, false);
  assert.ok(huge.error.includes('保存できません'));
  assert.ok(st.hasSystem('d') && !st.hasSystem('huge'), '失敗したら、もとの状態に戻る');
});
test('図鑑のマス: 行 = 8 分類、列 = 8 タグ + なし。登録した惑星で埋まり、完成度が数えられる', () => {
  const st = createStore(memStorage());
  const g0 = st.grid();
  assert.equal(g0.rows.length, 8);
  assert.equal(g0.cols.length, 9);
  assert.equal(g0.done, 0);
  assert.ok(g0.total > 20 && g0.total < 72, `出うるマス: ${g0.total}`);
  assert.ok(possibleCells().has('巨大ガス惑星|ホットジュピター'));
  assert.ok(!possibleCells().has('岩石惑星|ホットジュピター'), 'ホットジュピターは巨大ガス惑星だけ');
  st.addPlanet({ id: 'a', cls: '岩石惑星', tags: ['高温', '溶岩惑星'], tier: 4 });
  st.addPlanet({ id: 'b', cls: '岩石惑星', tags: [], tier: 1 });
  st.addPlanet({ id: 'c', cls: '岩石惑星', tags: [], tier: 1 });
  const g1 = st.grid();
  assert.equal(g1.done, 3); // 高温・溶岩惑星・なし
  const row = g1.rows.find((r) => r.cls === '岩石惑星');
  assert.equal(row.cells.find((c) => c.tag === 'なし').count, 2);
  assert.equal(row.cells.find((c) => c.tag === '溶岩惑星').filled, true);
  assert.deepEqual(cellsOf('氷惑星', []), ['氷惑星|なし']);
  // 統計に無かったマスでも、実際に登録できたなら「出うる」に数える
  st.addPlanet({ id: 'z', cls: '岩石惑星', tags: ['低密度'], tier: 5 });
  assert.ok(st.grid().rows.find((r) => r.cls === '岩石惑星').cells.find((c) => c.tag === '低密度').possible);
});

console.log('保存用レコード');
test('レコード: 条件と最終結果だけを持ち、惑星の ID・希少度・タグが惑星と対応する。保存しても容量が小さい', () => {
  const r = runSimulation(randomInput(31));
  const nameOf = (id) => `P${id}`;
  const sys = buildSystemRecord(r, 'テスト', 123);
  assert.equal(sys.id, systemId(r.input));
  assert.equal(sys.nPlanets, r.final.length);
  assert.ok(!('snapshots' in sys) && !('events' in sys));
  assert.ok(sys.tier >= 1 && sys.tier <= 5);
  const planets = buildPlanetRecords(r, nameOf, 123);
  assert.equal(planets.length, r.final.length);
  const ids = new Set(planets.map((p) => p.id));
  assert.equal(ids.size, planets.length);
  for (const rec of planets) {
    assert.ok(rec.id.startsWith(sys.id + ':'));
    assert.equal(rec.systemId, sys.id);
    const orig = r.final.find((p) => p.id === rec.planet.id);
    assert.ok(Math.abs(rec.planet.a - orig.a) / orig.a < 1e-6, '7 桁に丸めても十分な精度');
    assert.equal(rarityOfPlanet(rec.planet, rec.star).tier, rec.tier, '保存した惑星から同じ希少度が再現される');
    assert.equal(planetFeatures(rec.planet, rec.star).class, rec.cls);
  }
  const bytes = JSON.stringify({ sys, planets }).length;
  assert.ok(bytes < 12000, `1 系の保存が大きすぎる: ${bytes} バイト`);
  // 保存と読み込みを経ても、同じ結果の惑星系が再現できる
  const again = runSimulation(JSON.parse(JSON.stringify(sys.input)));
  assert.deepEqual(again.final.map((p) => p.id), r.final.map((p) => p.id));
});

console.log('共有');
test('共有リンク: 条件を符号化して戻すと一致する（ランダム設定・円盤の構造つき）', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const input = randomInput(seed);
    input.star.mass = Number(input.star.mass.toFixed(2)); // 画面のフォームの丸めと同じ
    input.star.luminosity = Number(input.star.luminosity.toFixed(2));
    const code = encodeShare(input);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(code));
    const out = decodeShare(code);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.input, { ...input, seeds: [] });
    assert.equal(systemId(out.input), systemId({ ...input, seeds: [] }), '同じ惑星系の識別子になる');
  }
});
test('共有リンク: 同じ条件から、同じ惑星系が再現される', () => {
  const input = randomInput(9);
  const again = decodeShare(encodeShare(input)).input;
  const a = runSimulation(input), b = runSimulation(again);
  assert.deepEqual(a.final, b.final);
});
test('共有リンク: 壊れた文字列・範囲外の値・細工された値は受け付けない', () => {
  assert.equal(decodeShare('!!!').ok, false);
  assert.equal(decodeShare('').ok, false);
  const ok = baselineInput(1);
  const code = (mut) => { const i = JSON.parse(JSON.stringify(ok)); mut(i); return encodeShare(i); };
  assert.equal(decodeShare(code(() => {})).ok, true);
  assert.equal(decodeShare(code((i) => { i.disk.mass = 5; })).ok, false); // とんでもなく重い円盤
  assert.equal(decodeShare(code((i) => { i.star.Z = NaN; })).ok, false);
  assert.equal(decodeShare(code((i) => { i.nRandomSeeds = 9999; })).ok, false);
  assert.equal(decodeShare(code((i) => { i.disk.structures = Array.from({ length: 9 }, () => ({ r: 5, width: 0.2, amp: 1 })); })).ok, false);
  assert.equal(decodeShare(code((i) => { i.disk.structures = [{ r: 5, width: 0.2, amp: -2 }]; })).ok, false);
  assert.equal(decodeShare(code((i) => { i.seed = 1.5; })).ok, false);
  assert.equal(decodeShare(btoa(JSON.stringify({ v: 2 }))).ok, false);
});
test('共有リンク: ハッシュの読み取りと、他の人が開けるアドレスかの判定', () => {
  const input = baselineInput(3);
  const url = buildShareUrl('https://example.com/planet_create/', input);
  assert.ok(url.startsWith('https://example.com/planet_create/#s='));
  assert.equal(parseShareHash(url.slice(url.indexOf('#'))).ok, true);
  assert.equal(parseShareHash('#other'), null);
  assert.equal(parseShareHash(''), null);
  assert.ok(isPublicUrl({ protocol: 'https:', hostname: 'example.com' }));
  for (const [protocol, hostname] of [['file:', ''], ['http:', 'localhost'], ['http:', '127.0.0.1'], ['http:', '192.168.1.5'], ['http:', '10.0.0.2'], ['http:', 'my.local']]) {
    assert.equal(isPublicUrl({ protocol, hostname }), false, hostname || protocol);
  }
});
test('投稿文: 惑星系・惑星とも X の文字数に収まり、ハッシュタグがあり、URL が無いときはシードが入る', () => {
  const r = runSimulation(presetInput('giants', 2));
  const rarity = rarityOfSystem(r.final, r.input.star);
  const t1 = systemShareText({ name: 'カリトナ', nPlanets: r.final.length, rarity, seed: r.input.seed }, false);
  assert.ok(t1.includes('カリトナ系') && t1.includes('#惑星系創造') && t1.includes(`シード ${r.input.seed}`));
  assert.ok(t1.length <= 200, `長すぎる: ${t1.length}`);
  const t2 = systemShareText({ name: 'カリトナ', nPlanets: 3, rarity, seed: 1 }, true);
  assert.ok(!t2.includes('シード'));
  const pr = rarityOfPlanet(r.final[0], r.input.star);
  const t3 = planetShareText({ name: 'カリトナ b', cls: pr.class, tags: pr.tags, tier: pr.tier }, false, 5);
  assert.ok(t3.includes('カリトナ b') && t3.includes(pr.stars) && t3.length <= 200);
  const x = xIntentUrl(t1, 'https://example.com/#s=abc');
  assert.ok(x.startsWith('https://twitter.com/intent/tweet?text=') && x.includes('&url=') && !x.includes('\n') && !x.includes(' '));
  assert.ok(!xIntentUrl('a', '').includes('&url='));
});

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
