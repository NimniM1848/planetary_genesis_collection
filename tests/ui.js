// UI の純粋ロジックのテスト (DOM に依存しない部分)。実行: node tests/ui.js
import assert from 'node:assert/strict';
import { runSimulation } from '../src/sim/sim.js';
import { baselineInput } from '../src/sim/params.js';
import { systemName, planetNames } from '../src/ui/naming.js';
import { planetColor, bandPattern, initialPhase, PLANET_LEGEND, planetKey } from '../src/ui/look.js';
import { describePlanet } from '../src/sim/physics.js';
import { radialMap, diskGeometry, frameState, stageOf, diskShading, referenceDensity, solidReferenceDensity, initialGasTotal, eventFrames, playbackRate, frameOfTime, seedBirth, seedBirthStart, INTRO_SECONDS, keplerState, orbitRadiusAt, ECC_VISIBLE } from '../src/ui/layout.js';
import { PRESETS, presetInput, randomInput } from '../src/ui/presets.js';
import { explainResult, eventText, explainSimple, eventTimeline } from '../src/ui/explain.js';
import { fmtMass, fmtRadius, fmtDensity, fmtTemp, fmtPos, fmtDist, fmtTime, fmtEcc, fmtPeriod } from '../src/ui/units.js';
import { newMarkers } from '../src/ui/markers.js';
import { createView, MARKER_STYLE } from '../src/ui/render.js';
import { FIELDS, rangeWarning, typicalText } from '../src/ui/fields.js';
import { habitableZone } from '../src/ui/layout.js';
import { readFileSync, existsSync } from 'node:fs';
import { mapMetrics, drawDiskPreview, solidTotal, plannedSeeds } from '../src/ui/diskpreview.js';
import { INTRO_SLIDES, INTRO_TERMS, INTRO_SAMPLE } from '../src/ui/intro_slides.js';
import { drawSystemCard, drawPlanetCard, drawSystemOrbit, CARD_W, CARD_H } from '../src/ui/shareimg.js';
import { rarityOfSystem, rarityOfPlanet } from '../src/dex/rarity.js';
import { createSound, SOUND_SPECS, MASTER_GAIN } from '../src/ui/sound.js';

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log('naming / look');
test('系の名前は seed で決まり、惑星名は初期の軌道順に b, c, d... が付く', () => {
  assert.equal(systemName(5), systemName(5));
  assert.notEqual(systemName(5), systemName(6));
  const res = runSimulation(baselineInput(5));
  const names = planetNames(res);
  assert.equal(names.size, res.snapshots[0].planets.length);
  const sorted = [...res.snapshots[0].planets].sort((x, y) => x.a - y.a);
  assert.ok(names.get(sorted[0].id).endsWith(' b'));
  assert.ok(names.get(sorted[1].id).endsWith(' c'));
});
test('見た目: 模様と位相は seed と ID だけで決まり、温度で色が変わる', () => {
  assert.deepEqual(bandPattern(7, 3), bandPattern(7, 3));
  assert.notDeepEqual(bandPattern(7, 3), bandPattern(7, 4));
  assert.equal(initialPhase(7, 3), initialPhase(7, 3));
  assert.notEqual(planetColor('巨大ガス惑星', 100).fill, planetColor('巨大ガス惑星', 1600).fill);
  assert.ok(planetColor('岩石惑星', 1800).glow, '溶岩惑星は発光する');
  assert.equal(planetColor('岩石惑星', 300).glow, null);
});

console.log('layout');
test('radialMap: 内縁→恒星の外側、外縁→最外周、単調増加', () => {
  assert.equal(radialMap(0.05, 0.05, 30, 100, 10), 10);
  assert.ok(Math.abs(radialMap(30, 0.05, 30, 100, 10) - 100) < 1e-9);
  assert.ok(radialMap(1, 0.05, 30, 100, 10) < radialMap(5, 0.05, 30, 100, 10));
  assert.equal(radialMap(100, 0.05, 30, 100, 10), 100); // 範囲外はクランプ
});
const res = runSimulation(baselineInput(5));
test('frameState: 端のクランプと、隣接スナップショット間の補間', () => {
  const n = res.snapshots.length;
  assert.equal(frameState(res, -3).index, 0);
  assert.equal(frameState(res, n + 5).index, n - 1);
  const mid = frameState(res, 10.5);
  assert.ok(mid.t > res.snapshots[10].t && mid.t < res.snapshots[11].t);
});
test('stageOf: 時間と寿命から再生段階が決まる', () => {
  assert.equal(stageOf(0, 3e6, false), '円盤と種');
  assert.equal(stageOf(0.2 * 3e6, 3e6, false), '固体の取り込みと成長');
  assert.equal(stageOf(2e6, 3e6, false), 'ガス獲得と軌道移動');
  assert.equal(stageOf(5e6, 3e6, false), '衝突・合体と円盤散逸');
  assert.equal(stageOf(5e6, 3e6, true), '完成');
});
test('円盤の濃淡: 初期は最大 1 以下、ガス散逸後は 0、惑星の位置でギャップができる', () => {
  const geom = diskGeometry(res.input);
  const ref = referenceDensity(res, geom), sref = solidReferenceDensity(res, geom);
  const gas0 = initialGasTotal(res, geom);
  const s0 = diskShading(res.snapshots[0], geom, ref, sref, res.input, gas0);
  assert.ok(Math.max(...s0.gas) <= 1 + 1e-6 && Math.max(...s0.gas) > 0.9);
  const last = diskShading(res.snapshots.at(-1), geom, ref, sref, res.input, gas0);
  assert.equal(Math.max(...last.gas), 0);
  assert.ok(Math.abs(s0.gasFrac - 1) < 1e-6 && last.gasFrac === 0, 'ガスの残り割合: 初期 1、完成時 0');
  const mid = diskShading(res.snapshots[Math.floor(res.snapshots.length / 3)], geom, ref, sref, res.input, gas0);
  assert.ok(mid.gasFrac > 0 && mid.gasFrac < 1);
  // 巨大な惑星を置くとその軌道のガスが薄くなる
  const fake = { ...res.snapshots[0], planets: [{ id: 1, a: 5, e: 0, mass: { metal: 0, rock: 30, ice: 0, gas: 288 } }] };
  const g = diskShading(fake, geom, ref, sref, res.input, gas0);
  const j = geom.center.findIndex((c) => c > 5);
  assert.ok(g.gas[j] < 0.3 * s0.gas[j]);
});

test('スロー再生: できごとの前後だけ遅くなり、それ以外は等速。散乱では遅くならない', () => {
  const r = runSimulation(presetInput('hotjup', 3));
  const frames = eventFrames(r);
  const slowKinds = r.events.filter((e) => ['gasRunaway', 'merge', 'eject', 'innerEdge', 'dispersal'].includes(e.kind)).length;
  assert.equal(frames.length, slowKinds);
  assert.ok(frames.every((x, i) => i === 0 || x >= frames[i - 1]), '昇順');
  const disp = r.events.find((e) => e.kind === 'dispersal');
  const fd = frames[frames.findIndex((x) => Math.abs(frameState(r, x).t - disp.t) < 1)];
  assert.equal(playbackRate(fd, frames), 0.06); // 既定は「ゆっくり」
  assert.equal(playbackRate(fd - 1, frames), 0.06); // 直前からゆっくりにして、起きる瞬間を見せる
  assert.equal(playbackRate(fd + 1, frames), 0.06); // 起きた後もしばらくゆっくり
  assert.equal(playbackRate(fd, frames, { slow: 0.12 }), 0.12); // 「ふつう」
  assert.equal(playbackRate(fd, frames, { slow: 1 }), 1); // 「オフ」
  assert.equal(playbackRate(-100, frames), 1);
  assert.equal(playbackRate(1e6, frames), 1);
  assert.equal(playbackRate(5, []), 1);
  // 全体で見て、遅い区間は少数（できごとが無いところは等速）
  let slow = 0;
  const n = r.snapshots.length;
  for (let f = 0; f < n; f += 0.5) if (playbackRate(f, frames) < 1) slow++;
  assert.ok(slow < n * 2 * 0.7, `遅い区間が多すぎる ${slow}/${n * 2}`);
});

console.log('入力欄の目安・ハビタブルゾーン・凡例');
test('FIELDS: index.html の min/max と一致し、目安は入れられる範囲の中にある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const f of FIELDS) {
    const tag = html.match(new RegExp(`<input id="${f.id}"[^>]*>`))[0];
    assert.equal(Number(tag.match(/min="([^"]+)"/)[1]), f.hard[0], `${f.id} min`);
    assert.equal(Number(tag.match(/max="([^"]+)"/)[1]), f.hard[1], `${f.id} max`);
    assert.ok(html.includes(`id="h-${f.id}"`), `${f.id} の説明欄`);
    if (f.typical) assert.ok(f.typical[0] >= f.hard[0] && f.typical[1] <= f.hard[1], f.id);
    assert.ok(f.hint.length > 5);
  }
  assert.ok(FIELDS.find((f) => f.id === 'f-rout').hint.includes('直径ではありません'));
});
test('目安の外の値には注意が出る。プリセットとランダム設定は、すべて入れられる範囲の中', () => {
  const rout = FIELDS.find((f) => f.id === 'f-rout');
  assert.equal(rangeWarning(rout, 30), '');
  assert.ok(rangeWarning(rout, 70).includes('大きい'));
  assert.ok(rangeWarning(rout, 18).includes('小さい'));
  assert.equal(typicalText(rout), '目安 25〜60 AU');
  const inputs = [...PRESETS.map((p) => presetInput(p.id, 1)), ...Array.from({ length: 200 }, (_, i) => randomInput(i + 1))];
  const get = { 'f-mstar': (i) => i.star.mass, 'f-lum': (i) => i.star.luminosity, 'f-z': (i) => i.star.Z, 'f-dmass': (i) => i.disk.mass,
    'f-rin': (i) => i.disk.rIn, 'f-rout': (i) => i.disk.rOut, 'f-tlife': (i) => i.disk.tLife / 1e6, 'f-p': (i) => i.disk.p };
  for (const i of inputs) for (const [id, fn] of Object.entries(get)) {
    const f = FIELDS.find((x) => x.id === id);
    const v = fn(i);
    assert.ok(v >= f.hard[0] - 1e-9 && v <= f.hard[1] + 1e-9, `${id}=${v}`);
  }
});
test('入れられる範囲の中なら、どこでも計算が成功し、質量が保存される（端の組み合わせを含む）', () => {
  const rngv = (k, i) => { const [lo, hi] = FIELDS.find((f) => f.id === k).hard; return lo + ((hi - lo) * (((i * 2654435761) >>> 0) % 1000)) / 1000; };
  for (let i = 0; i < 40; i++) {
    const corner = (bit, k) => FIELDS.find((f) => f.id === k).hard[(i >> bit) & 1];
    const input = baselineInput(500 + i);
    input.star = { mass: corner(0, 'f-mstar'), luminosity: corner(1, 'f-lum'), Z: corner(2, 'f-z') };
    input.disk = { mass: corner(3, 'f-dmass'), rIn: corner(4, 'f-rin'), rOut: corner(5, 'f-rout'), tLife: 1e6 * rngv('f-tlife', i), p: rngv('f-p', i + 1), structures: [] };
    input.nRandomSeeds = i % 2 ? 16 : 3;
    const r = runSimulation(input);
    assert.ok(r.ledger.relError <= 1e-9, `corner ${i}`);
  }
});
test('ハビタブルゾーン: 太陽で約 0.95〜1.67 AU、明るい星ほど外側へ', () => {
  const sun = habitableZone(1);
  assert.ok(Math.abs(sun.inner - 0.95) < 1e-9 && Math.abs(sun.outer - 1.67) < 1e-9);
  assert.ok(habitableZone(4).inner > habitableZone(1).outer * 0.99);
  assert.ok(habitableZone(0.25).outer < sun.inner * 2);
});
test('図の見かた: すべての印に説明がある', () => {
  for (const [k, st] of Object.entries(MARKER_STYLE)) assert.ok(st.legend.length > 5 && st.label && st.color, k);
  assert.ok(MARKER_STYLE.scatter.legend.includes('ぶつかってはいない'));
});
test('描画: ハビタブルゾーンの帯と、放出された惑星の飛翔も例外なく描ける', () => {
  globalThis.window = { devicePixelRatio: 1 };
  const log = { arc: 0, text: [] };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : k === 'arc' ? () => { log.arc++; } : k === 'fillText' ? (s) => { log.text.push(s); } : () => {}), set: () => true });
  const r = runSimulation(presetInput('giants', 4));
  const view = createView({ clientWidth: 400, getContext: () => ctx }, r);
  const f = r.snapshots.length - 1;
  view.draw(f, 1, null, [], { hz: false });
  const off = log.arc;
  assert.ok(!log.text.includes('ハビタブルゾーン'));
  view.draw(f, 1, null, [], { hz: true });
  assert.ok(log.text.includes('ハビタブルゾーン'), 'ハビタブルゾーンのラベルが無い');
  const hit = view.hitOf(r.final[0].id);
  const eject = { kind: 'eject', id: 9, a: 5, ang: 1, born: 0, label: '放出 b', desc: hit.desc, rr: 6 };
  const before = log.arc;
  for (const wall of [0.1, 1, 2, 3]) view.draw(f, wall, null, [eject]);
  assert.ok(log.arc - before > 4 * (off + 5), '放出のアニメーション（残像・本体）が描かれていない');
});

test('frameOfTime: スナップショットの時刻とフレーム位置が対応し、端でクランプされる', () => {
  const n = res.snapshots.length;
  assert.equal(frameOfTime(res, -5), 0);
  assert.equal(frameOfTime(res, 1e12), n - 1);
  for (const i of [0, 10, 200, n - 1]) assert.ok(Math.abs(frameOfTime(res, res.snapshots[i].t) - i) < 1e-9);
  const mid = frameOfTime(res, (res.snapshots[10].t + res.snapshots[11].t) / 2);
  assert.ok(Math.abs(mid - 10.5) < 1e-9);
  // 往復: フレーム位置 → 時刻 → フレーム位置
  assert.ok(Math.abs(frameOfTime(res, frameState(res, 57.3).t) - 57.3) < 1e-6);
});

console.log('惑星の系統の凡例');
test('凡例: シミュレーションで出る分類・タグのすべてに行があり、色が互いに違う', () => {
  const keys = new Set(PLANET_LEGEND.map((e) => e.key));
  assert.equal(keys.size, PLANET_LEGEND.length);
  const colors = PLANET_LEGEND.map((e) => planetColor(e.cls, e.teq).fill);
  assert.equal(new Set(colors).size, colors.length, `色が重なっている行がある: ${colors}`);
  const seen = new Set();
  for (const id of ['standard', 'giants', 'hotjup', 'ice']) for (let seed = 1; seed <= 30; seed++) {
    const r = runSimulation(presetInput(id, seed));
    for (const p of r.final) { const k = planetKey(describePlanet(p, r.input.star)); assert.ok(keys.has(k), `凡例に無い系統: ${k}`); seen.add(k); }
  }
  assert.ok(seen.size >= 6, `出現した系統が少ない: ${[...seen]}`);
  assert.ok(seen.has('ホットジュピター'), 'ホットジュピターの行が使われる');
  for (const e of PLANET_LEGEND) assert.ok(e.desc.length > 8);
});
test('凡例: 高温の巨星と溶岩惑星は、通常の行と色が違う', () => {
  const col = (k) => { const e = PLANET_LEGEND.find((x) => x.key === k); return planetColor(e.cls, e.teq); };
  assert.notEqual(col('ホットジュピター').fill, col('巨大ガス惑星').fill);
  assert.notEqual(col('溶岩惑星').fill, col('岩石惑星').fill);
  assert.ok(col('ホットジュピター').glow && col('溶岩惑星').glow);
  const d = describePlanet({ id: 1, a: 0.05, e: 0, mass: { metal: 0, rock: 30, ice: 0, gas: 270 } }, { mass: 1, luminosity: 1, Z: 1 });
  assert.equal(planetKey(d), 'ホットジュピター');
});

console.log('表記（専門の記号を使わない）');
test('質量: 地球・月・木星の倍数で言い、近い惑星があれば「くわしい例え」を添える', () => {
  assert.equal(fmtMass(1), '地球の約1倍');
  assert.equal(fmtMass(0.0123), '月の約1倍');
  assert.equal(fmtMass(0.005), '月の約0.41倍');
  assert.equal(fmtMass(10), '地球の約10倍');
  assert.equal(fmtMass(12), '地球の約12倍（天王星くらい）');
  assert.equal(fmtMass(17), '地球の約17倍（海王星くらい）');
  assert.equal(fmtMass(0.107), '地球の約0.11倍（火星くらい）');
  assert.equal(fmtMass(95), '地球の約95倍（土星くらい）');
  assert.equal(fmtMass(318), '木星の約1.0倍（地球の約318倍）');
  assert.equal(fmtMass(4134), '木星の約13倍（地球の約4134倍）');
  assert.ok(!/(M⊕|MJ|M☉)/.test(fmtMass(50)));
});
test('半径・密度・温度・位置・距離・時間・離心率・周期の表記', () => {
  assert.equal(fmtRadius(1.58), '地球の約1.6倍');
  assert.equal(fmtRadius(11.2), '木星の約1.0倍');
  assert.equal(fmtDensity(5.51), '水の約5.5倍');
  assert.equal(fmtTemp(255), '約-18℃');
  assert.equal(fmtTemp(1140), '約867℃');
  assert.equal(fmtPos(5.234), '地球の軌道の約5.2倍の位置');
  assert.equal(fmtPos(0.0512), '地球の軌道の約0.051倍の位置');
  assert.equal(fmtDist(1), '地球〜太陽の約1倍（1 AU）');
  assert.equal(fmtTime(0), '0年');
  assert.equal(fmtTime(3e6), '300万年');
  assert.equal(fmtTime(1.2e7), '1,200万年');
  assert.equal(fmtTime(1.03e8), '1.03億年');
  assert.equal(fmtEcc(0.02), '0.02（ほぼ円）');
  assert.equal(fmtEcc(0.5), '0.50（大きくつぶれた楕円）');
  assert.equal(fmtPeriod(0.5), '182.6 日');
  assert.equal(fmtPeriod(11.2), '11.2 年');
});
test('画面に出る文字（HTML と説明文）に、専門の記号が残っていない', () => {
  const sym = /M⊕|M☉|L☉|R⊕|\bMJ\b|\bMyr\b|\d\s?K\b/;
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!sym.test(html.replace(/<!--[\s\S]*?-->/g, '')), `index.html: ${html.match(sym)}`);
  for (const f of FIELDS) assert.ok(!sym.test(f.label + f.hint + f.unit), f.id);
  const nameOf = (id) => `P${id}`;
  for (const id of ['standard', 'giants', 'hotjup', 'ice']) for (let seed = 1; seed <= 8; seed++) {
    const r = runSimulation(presetInput(id, seed));
    const texts = [...explainSimple(r, nameOf), ...explainResult(r, nameOf), ...r.events.map((e) => eventText(e, nameOf))];
    for (const x of texts) assert.ok(!sym.test(x), `${id}/${seed}: ${x}`);
    for (const p of r.final) { const d = describePlanet(p, r.input.star); assert.ok(!sym.test([fmtMass(d.mass), fmtRadius(d.radius), fmtTemp(d.teq)].join(' '))); }
  }
});

console.log('効果音・スマホ幅の並び');
test('効果音: すべてのできごとに音があり、長さ・音量・周波数が常識的な範囲', () => {
  for (const kind of Object.keys(MARKER_STYLE)) assert.ok(SOUND_SPECS[kind]?.length >= 1, `${kind} の音が無い`);
  for (const [kind, tones] of Object.entries(SOUND_SPECS)) for (const t of tones) {
    assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(t.type));
    assert.ok(t.f0 >= 40 && t.f0 <= 4000 && t.f1 >= 40 && t.f1 <= 4000, `${kind}: 周波数`);
    assert.ok(t.dur > 0 && t.at + t.dur <= 2, `${kind}: 長さ`);
    assert.ok(t.gain > 0 && t.gain * MASTER_GAIN <= 0.35, `${kind}: 音量が大きすぎる`);
  }
  const loud = (k) => SOUND_SPECS[k].reduce((s, t) => s + t.gain, 0);
  assert.ok(loud('scatter') < loud('merge'), '散乱は小さな音');
});
test('効果音: オフでは鳴らず、音を出せない環境でも例外にならない', () => {
  const made = [];
  class Fake {
    constructor() { this.state = 'suspended'; this.currentTime = 1; this.destination = {}; }
    resume() { this.state = 'running'; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { const o = { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start(t) { o.t = t; }, stop() {} }; made.push(o); return o; }
  }
  const snd = createSound({ AudioContext: Fake });
  assert.equal(snd.enabled, false);
  assert.equal(snd.play('merge'), false);
  assert.equal(made.length, 0);
  snd.enabled = true;
  assert.equal(snd.play('merge'), true);
  assert.equal(made.length, SOUND_SPECS.merge.length);
  assert.equal(snd.play('存在しない'), false);
  snd.enabled = false;
  assert.equal(snd.play('eject'), false);
  const none = createSound({});
  none.enabled = true;
  assert.equal(none.unlock(), false);
  assert.equal(none.play('merge'), false);
});
test('スマホ幅: 操作ボタンは図のすぐ下に並び、凡例は既定で閉じている', () => {
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 899px)'));
  const order = (sel) => Number(mobile.match(new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\s*\\{\\s*order:\\s*(\\d+)'))?.[1]);
  const o = { canvas: order('.canvas-wrap'), seek: order('#seek'), controls: order('.controls'), legend: order('.viewer-main .planet-legend'), log: order('#eventlog'), legendMarks: order('.viewer-side .legend-box') };
  for (const [k, v] of Object.entries(o)) assert.ok(Number.isFinite(v), `${k} の order が無い`);
  assert.ok(o.canvas < o.seek && o.seek < o.controls, '図 → 時間 → 操作ボタン の順');
  assert.ok(o.controls < o.legend && o.controls < o.legendMarks && o.controls < o.log, '操作ボタンが、凡例・ログより先');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(/<details id="planet-legend-box"(?![^>]*\bopen\b)/.test(html), '凡例の details は、既定で閉じている');
  assert.ok(html.includes('id="opt-sound"'));
});

console.log('種が生まれる演出');
test('seedBirth: 種は 1 つずつ順に現れ、演出の終わりまでにすべて現れきる。現れるときは少し大きくなってから戻る', () => {
  for (const n of [1, 3, 8, 16]) {
    let prev = -1;
    for (let k = 0; k < n; k++) {
      const s = seedBirthStart(k, n);
      assert.ok(s > prev, '順に現れる');
      prev = s;
      assert.equal(seedBirth(s - 1e-9, k, n).p, 0, 'まだ無い');
      assert.equal(seedBirth(1, k, n).p, 1, '最後には現れきる');
      assert.ok(Math.abs(seedBirth(1, k, n).scale - 1) < 1e-9, '最終的な大きさは 1 倍');
    }
    assert.ok(seedBirthStart(n - 1, n) + 0.17 <= 1 + 1e-9, `n=${n}: 演出の終わりまでに間に合う`);
  }
  let max = 0;
  for (let u = 0; u <= 1; u += 0.001) max = Math.max(max, seedBirth(u, 0, 8).scale);
  assert.ok(max > 1.05 && max < 1.5, `大きくなってから戻る: ${max}`);
  assert.ok(INTRO_SECONDS >= 2 && INTRO_SECONDS <= 6);
});
test('描画: 演出中は、まだ生まれていない種は描かれず、タップもできない。終わるとすべて現れる', () => {
  globalThis.window = { devicePixelRatio: 1 };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : () => {}), set: () => true });
  const r = runSimulation(presetInput('standard', 5));
  const view = createView({ clientWidth: 400, getContext: () => ctx }, r);
  const n = r.snapshots[0].planets.length;
  const count = (u) => { view.draw(0, 0, null, [], { intro: u === null ? null : { u } }); return r.snapshots[0].planets.filter((p) => view.hitOf(p.id)).length; };
  assert.equal(count(0), 0, '始めは 1 つも無い');
  const mid = count(0.45);
  assert.ok(mid > 0 && mid < n, `途中は一部だけ: ${mid}/${n}`);
  assert.ok(count(0.45) <= count(0.7), '時間とともに増える');
  assert.equal(count(1), n);
  assert.equal(count(null), n, '演出なし = すべて見える');
});

console.log('共有画像');
test('共有画像: 惑星系・惑星のカードと小さな軌道図が、例外なく描ける（文字・円・枠が描かれる）', () => {
  const log = { text: [], arc: 0, rect: 0 };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? (s) => ({ width: s.length * 12 }) : k === 'fillText' ? (s) => { log.text.push(s); } : k === 'arc' ? () => { log.arc++; } : k === 'fillRect' ? () => { log.rect++; } : () => {}), set: () => true });
  for (const [preset, seed] of [['standard', 5], ['hotjup', 3], ['giants', 9], ['ice', 2]]) {
    const r = runSimulation(presetInput(preset, seed));
    const rarity = rarityOfSystem(r.final, r.input.star);
    log.text.length = 0; log.arc = 0;
    drawSystemCard(ctx, { name: 'テスト', input: r.input, final: r.final, rarity });
    assert.ok(log.text.some((x) => x.includes('テスト 系')) && log.text.some((x) => x.includes(rarity.stars)), '系の名前と希少度');
    assert.ok(log.text.some((x) => x.includes('#惑星系創造')));
    assert.ok(log.arc >= r.final.length * 2, '惑星が描かれている');
    if (r.final.length) {
      log.text.length = 0;
      const p = r.final[0];
      drawPlanetCard(ctx, { name: 'テスト b', planet: p, star: r.input.star, rarity: rarityOfPlanet(p, r.input.star), seed: r.input.seed });
      assert.ok(log.text.some((x) => x === 'テスト b') && log.text.some((x) => x.includes('重さ')));
    }
  }
  assert.equal(CARD_W / CARD_H, 1200 / 630);
  drawSystemOrbit(ctx, 36, 36, 33, runSimulation(presetInput('standard', 1)).input, []); // 惑星が 0 個でも描ける
});

console.log('楕円軌道');
test('ケプラー: 円(e=0)では距離は一定、楕円では近点と遠点の間を動き、周期は 2π', () => {
  for (const M of [0, 1, 2.5, 4, 6]) {
    const c = keplerState(2, 0, M);
    assert.ok(Math.abs(c.r - 2) < 1e-9);
  }
  const e = 0.6;
  assert.ok(Math.abs(keplerState(1, e, 0).r - (1 - e)) < 1e-9, '近点');
  assert.ok(Math.abs(keplerState(1, e, Math.PI).r - (1 + e)) < 1e-9, '遠点');
  assert.ok(Math.abs(keplerState(1, e, 0).nu) < 1e-9);
  assert.ok(Math.abs(Math.abs(keplerState(1, e, Math.PI).nu) - Math.PI) < 1e-9);
  assert.ok(Math.abs(keplerState(1, e, 1.3).r - keplerState(1, e, 1.3 + 2 * Math.PI).r) < 1e-9);
  assert.ok(Math.abs(keplerState(1, e, -1).r - keplerState(1, e, 2 * Math.PI - 1).r) < 1e-9, '負の角度も扱える');
  let lo = 9, hi = 0;
  for (let M = 0; M < 6.3; M += 0.05) { const r = keplerState(1, e, M).r; lo = Math.min(lo, r); hi = Math.max(hi, r); }
  assert.ok(lo >= 1 - e - 1e-9 && hi <= 1 + e + 1e-9 && hi - lo > 0.9 * 2 * e);
  // 近点で速く、遠点で遅い（同じ時間でも、近点側のほうが真近点角が大きく進む）
  const near = Math.abs(keplerState(1, e, 0.2).nu - keplerState(1, e, 0).nu);
  const far = Math.abs(keplerState(1, e, Math.PI + 0.2).nu - keplerState(1, e, Math.PI).nu);
  assert.ok(near > far * 3, `${near} vs ${far}`);
  // 曲線の式と一致
  for (const nu of [0.4, 2, 3.5]) assert.ok(Math.abs(orbitRadiusAt(1, 0.5, nu) - 0.75 / (1 + 0.5 * Math.cos(nu))) < 1e-12);
  for (const hi of [0.7, 0.79]) { const k = keplerState(1, hi, 3); assert.ok(Number.isFinite(k.r) && Number.isFinite(k.nu), '高い離心率でも収束'); }
});
test('描画: 離心率の大きい惑星は恒星からの距離が周期的に変わり、円に近い惑星は一定（止まっていれば動かない）', () => {
  globalThis.window = { devicePixelRatio: 1 };
  const strokes = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : k === 'lineTo' ? () => { strokes.push('lineTo'); } : () => {}), set: () => true });
  const r = runSimulation(presetInput('standard', 5));
  const snap = r.snapshots.at(-1);
  const input = r.input;
  const mk = (id, a, e) => ({ id, a, e, mass: { metal: 0, rock: 1, ice: 0, gas: 0 } });
  const fake = { ...r, snapshots: [{ ...snap, planets: [mk(1, 3, 0.6), mk(2, 8, 0.0)] }, { ...snap, planets: [mk(1, 3, 0.6), mk(2, 8, 0.0)], t: snap.t + 1 }] };
  const view = createView({ clientWidth: 400, getContext: () => ctx }, fake);
  const center = 200;
  const dist = (id, wall) => { view.draw(1, wall, null, [], {}); const h = view.hitOf(id); return Math.hypot(h.x - center, h.y - center); };
  const ds = Array.from({ length: 30 }, (_, i) => dist(1, i * 0.5)).slice(); // 一周以上（速さ 約 0.66 rad/s）
  assert.ok(Math.max(...ds) - Math.min(...ds) > 30, `楕円軌道の惑星が動いても距離が変わらない: ${ds}`);
  const dc = [0, 1, 2, 3, 4].map((w) => dist(2, w));
  assert.ok(Math.max(...dc) - Math.min(...dc) < 1e-6, '円軌道の距離は一定');
  assert.equal(dist(1, 2.2), dist(1, 2.2), '同じ時刻なら同じ位置（停止中は動かない）');
  assert.ok(strokes.length >= 73, '楕円の軌道線が描かれている'); // 72 分割 + 1
  assert.ok(ECC_VISIBLE > 0 && ECC_VISIBLE < 0.1);
  // できごとの印は、惑星のいまの距離（楕円なら軌道長半径と違う）に付く
  view.draw(1, 0, null, [], {});
  const h0 = view.hitOf(1);
  assert.ok(h0.a >= 3 * (1 - 0.6) - 1e-9 && h0.a <= 3 * (1 + 0.6) + 1e-9, `hit.a はいまの距離: ${h0.a}`);
});
test('共有画像の軌道図: 楕円軌道の惑星でも例外なく描ける', () => {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : () => {}), set: () => true });
  const r = runSimulation(presetInput('giants', 3));
  const final = r.final.map((p, i) => ({ ...p, e: 0.1 + 0.15 * i }));
  drawSystemOrbit(ctx, 100, 100, 90, r.input, final);
  drawSystemCard(ctx, { name: 'テスト', input: r.input, final, rarity: rarityOfSystem(final, r.input.star) });
});

console.log('タイトル・アイコン');
test('タイトルは「惑星系創造」、副題は「〜創って、見守って、集める〜」', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(/<title>惑星系創造<\/title>/.test(html));
  assert.ok(/<h1>[\s\S]*惑星系創造<\/h1>/.test(html));
  assert.ok(html.includes('<p class="lead">〜創って、見守って、集める〜</p>'));
  assert.ok(!html.includes('見届けよう'), '古い副題が残っている');
  assert.ok(html.includes('content="〜創って、見守って、集める〜"'), '共有されたときの説明（og:description）も同じ副題');
});
test('紹介カード: 公開アドレスの絶対アドレスで、og:image などが入り、画像ファイルが存在する（X に貼ったときの画像つきカード）', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const URL_ = 'https://nimnim1848.github.io/planetary_genesis_collection/';
  assert.ok(html.includes(`<meta property="og:url" content="${URL_}">`));
  assert.ok(html.includes(`<link rel="canonical" href="${URL_}">`));
  assert.ok(html.includes(`<meta property="og:image" content="${URL_}og-image.png">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${URL_}og-image.png">`));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"') && !html.includes('twitter:card" content="summary"'));
  assert.ok(html.includes('og:image:width" content="1200"') && html.includes('og:image:height" content="630"'));
  assert.ok(html.indexOf('og:image') < html.indexOf('</head>'), 'head の中にある');
  const b = readFileSync(new URL('../og-image.png', import.meta.url));
  assert.equal(b.readUInt32BE(16), 1200); assert.equal(b.readUInt32BE(20), 630);
  assert.ok(b.length < 5 * 1024 * 1024, 'X の画像の上限（5MB）以内');
});
test('アイコン: ヘッダーの参照先がすべて存在し、PNG は正しい大きさ、マニフェストの内容と一致する', () => {
  const root = new URL('../', import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 4, `リンクが少ない: ${hrefs}`);
  for (const h of hrefs) assert.ok(existsSync(new URL(h, root)), `${h} が無い`);
  assert.ok(html.includes('name="theme-color"'));
  const pngSize = (file) => {
    const b = readFileSync(new URL(file, root));
    assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} は PNG ではない`);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(pngSize('favicon-32.png'), [32, 32]);
  assert.deepEqual(pngSize('apple-touch-icon.png'), [180, 180]);
  const svg = readFileSync(new URL('icon.svg', root), 'utf8');
  assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 512 512"') && svg.trimEnd().endsWith('</svg>'));
  const man = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(man.name, '惑星系創造');
  assert.equal(man.description, '〜創って、見守って、集める〜');
  assert.ok(man.icons.length >= 3);
  for (const ic of man.icons) {
    assert.ok(existsSync(new URL(ic.src, root)), `${ic.src} が無い`);
    if (ic.type === 'image/png') { const [w, h] = pngSize(ic.src); assert.equal(`${w}x${h}`, ic.sizes, ic.src); }
  }
  assert.ok(man.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(man.start_url && man.display === 'standalone');
});

test('公開の注意書きと起動時のメッセージ: 簡易モデルであること・保存先・バージョン・JavaScript なし/古いブラウザ/ファイル直開きの案内', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('簡易モデル') && html.includes('予測するものではありません') || html.includes('再現・予測するものではありません'));
  assert.ok(html.includes('ブラウザの中にだけ保存されます') && html.includes('サーバーには送りません'));
  assert.ok(html.includes('id="foot-version"'));
  assert.ok(html.includes('<noscript>') && html.includes('<script nomodule>') && html.includes("location.protocol === 'file:'"));
  assert.ok(html.indexOf('id="bootMsg"') < html.indexOf('type="module"'), '本体より先に、案内の枠がある');
});

console.log('はじめに（案内）');
test('案内の文面: 5 枚、各枚に見出しと本文。専門用語・記号を使わず、長すぎない', () => {
  assert.equal(INTRO_SLIDES.length, 5);
  assert.deepEqual(INTRO_SLIDES.map((s) => s.title), ['創る', '見守る', '集める', '共有する', 'ことばのメモ']);
  const sym = /M⊕|M☉|L☉|R⊕|\bMJ\b|\bMyr\b|\bAU\b|シード|離心率で/;
  for (const s of INTRO_SLIDES) {
    assert.ok(['none', 'orbit', 'planet', 'share', 'terms'].includes(s.art));
    assert.ok(s.body.length >= 1 && s.body.length <= 3, s.title);
    for (const p of s.body) { assert.ok(p.length >= 10 && p.length <= 140, `${s.title}: ${p.length} 文字`); assert.ok(!sym.test(p), `${s.title}: ${p}`); }
  }
  assert.ok(INTRO_SLIDES[1].body.join('').includes('一時停止') && INTRO_SLIDES[1].body.join('').includes('その時に戻れます'));
  assert.ok(INTRO_SLIDES[2].body.join('').includes('図鑑') && INTRO_SLIDES[3].body.join('').includes('共有'));
});
test('ことばのメモ: 画面に出てくる、わかりにくい用語がすべて説明されている', () => {
  const words = INTRO_TERMS.map(([k]) => k);
  for (const w of ['スノーライン', 'ハビタブルゾーン', '巨大ガス惑星', '巨大氷惑星', '金属量', '離心率', 'ホットジュピター']) assert.ok(words.includes(w), `${w} の説明が無い`);
  for (const [k, v] of INTRO_TERMS) assert.ok(v.length >= 10 && v.length <= 110, k);
});
test('案内の見本: 計算できて、惑星が複数・希少度が高め。軌道図・惑星・共有画像の 3 つの絵が描ける', () => {
  const r = runSimulation(presetInput(INTRO_SAMPLE.preset, INTRO_SAMPLE.seed));
  assert.ok(r.final.length >= 5, `見本の惑星が少ない: ${r.final.length}`);
  const sys = rarityOfSystem(r.final, r.input.star);
  assert.ok(sys.tier >= 3, `見本の希少度が低い: ${sys.tier}`);
  const log = { text: [], arc: 0 };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : k === 'fillText' ? (s) => { log.text.push(s); } : k === 'arc' ? () => { log.arc++; } : () => {}), set: () => true });
  drawSystemOrbit(ctx, 240, 240, 228, r.input, r.final);
  assert.ok(log.arc >= r.final.length * 2);
  const rarest = r.final.map((p) => ({ p, r: rarityOfPlanet(p, r.input.star) })).sort((a, b) => b.r.tier - a.r.tier)[0];
  drawPlanetCard(ctx, { name: 'x', planet: rarest.p, star: r.input.star, rarity: rarest.r, seed: r.input.seed });
  assert.ok(log.text.some((t) => t.includes('★')), '希少度の★が見える');
  drawSystemCard(ctx, { name: 'x', input: r.input, final: r.final, rarity: sys });
});

test('共有画像の軌道図: ハビタブルゾーンが緑の帯で描かれ、大きい図には名前が付き、小さい図（一覧）には帯だけ。惑星系カードに説明が付く', () => {
  const mk = () => { const log = { text: [], stroke: [] }; const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : k === 'fillText' ? (s) => { log.text.push(s); } : () => {}), set: (_, k, v) => { if (k === 'strokeStyle') log.stroke.push(String(v)); return true; } }); return { log, ctx }; };
  const r = runSimulation(presetInput('standard', 2));
  const big = mk(); drawSystemOrbit(big.ctx, 240, 240, 228, r.input, r.final);
  assert.ok(big.log.stroke.some((s) => s.includes('90,220,140')), '緑の帯');
  assert.ok(big.log.text.includes('ハビタブルゾーン'), '大きい図には名前');
  const small = mk(); drawSystemOrbit(small.ctx, 36, 36, 33, r.input, r.final);
  assert.ok(small.log.stroke.some((s) => s.includes('90,220,140')), '小さい図にも帯');
  assert.ok(!small.log.text.includes('ハビタブルゾーン'), '小さい図には名前を出さない（読めない）');
  const card = mk(); drawSystemCard(card.ctx, { name: 'テスト', input: r.input, final: r.final, rarity: rarityOfSystem(r.final, r.input.star) });
  assert.ok(card.log.stroke.some((s) => s.includes('90,220,140')));
  assert.ok(card.log.text.some((t) => t.includes('緑の帯 = ハビタブルゾーン')), '惑星系カードに説明');
  // 恒星が明るいほど、帯は外側（半径が大きい）。円盤の範囲の外にはみ出さない
  const radius = (L) => { const arcs = []; const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : k === 'arc' ? (x, y, rr) => { arcs.push(rr); } : () => {}), set: () => true }); drawSystemOrbit(ctx, 240, 240, 228, { ...r.input, star: { ...r.input.star, luminosity: L } }, []); return arcs; };
  assert.ok(Math.max(...radius(4)) <= 228 + 4 + 1e-9 && Math.max(...radius(0.01)) <= 228 + 4 + 1e-9, '図の外にはみ出さない');
  assert.notDeepEqual(radius(4), radius(0.25), '明るさで帯の位置が変わる');
});

console.log('初期の円盤の図');
const recCtx = (log) => new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : k === 'fillText' ? (s, x, y) => { log.text.push([s, x, y]); } : k === 'arc' ? () => { log.arc++; } : () => {}), set: (_, k, v) => { if (k === 'strokeStyle') log.stroke.push(v); return true; } });
const baseCond = () => ({ star: { mass: 1, luminosity: 1, Z: 1 }, disk: { mass: 0.03, rIn: 0.05, rOut: 30, tLife: 3e6, p: 1, structures: [] } });
test('初期の円盤の図: 濃淡・スノーライン・ハビタブルゾーンが描かれ、再生の軌道図と同じ寸法', () => {
  const log = { text: [], arc: 0, stroke: [] };
  drawDiskPreview(recCtx(log), 340, baseCond());
  assert.ok(log.text.some(([s]) => s === 'スノーライン') && log.text.some(([s]) => s === 'ハビタブルゾーン'));
  assert.ok(log.arc > 400, `円盤の濃淡が描かれていない: ${log.arc}`);
  assert.ok(log.stroke.some((s) => String(s).includes('110,150,255')) && log.stroke.some((s) => String(s).includes('255,170,90')), 'ガス（青）と固体（橙）');
  assert.equal(mapMetrics(400).R, 400 / 2 - 6);
});
test('初期の円盤の図: 条件が変わると見た目が変わる（リング・ギャップ、恒星の明るさでスノーライン、ガスの量）', () => {
  const alphas = (cond) => { const log = { text: [], arc: 0, stroke: [] }; drawDiskPreview(recCtx(log), 340, cond); return log.stroke.filter((s) => String(s).includes('110,150,255')).map((s) => Number(/,([0-9.]+)\)/.exec(s)[1])); };
  const plain = alphas(baseCond());
  const gap = alphas({ ...baseCond(), disk: { ...baseCond().disk, structures: [{ r: 10, width: 0.1, amp: -0.8 }] } });
  assert.ok(Math.min(...gap) < Math.min(...plain.slice(Math.floor(plain.length * 0.5))) + 1e-9 && gap.join() !== plain.join(), 'ギャップが濃淡に出る');
  const ring = alphas({ ...baseCond(), disk: { ...baseCond().disk, structures: [{ r: 20, width: 0.2, amp: 2 }] } });
  assert.notEqual(ring.join(), plain.join(), 'リングが濃淡に出る');
  const snowX = (L) => { const log = { text: [], arc: 0, stroke: [] }; drawDiskPreview(recCtx(log), 340, { ...baseCond(), star: { mass: 1, luminosity: L, Z: 1 } }); return log.text.find(([s]) => s === 'スノーライン')[1]; };
  assert.ok(snowX(4) > snowX(0.25), '明るい星ほど、スノーラインは外側');
  const steep = alphas({ ...baseCond(), disk: { ...baseCond().disk, p: 1.5 } });
  assert.notEqual(steep.join(), plain.join(), '密度の傾きが濃淡に出る');
});
test('初期の円盤の図: 条件が不正・範囲が逆でも例外にならず、メッセージだけ描く', () => {
  const log = { text: [], arc: 0, stroke: [] };
  drawDiskPreview(recCtx(log), 340, null);
  assert.ok(log.text.some(([s]) => s === '条件を確かめてください'));
  log.text.length = 0;
  drawDiskPreview(recCtx(log), 340, { ...baseCond(), disk: { ...baseCond().disk, rOut: 0.01 } });
  assert.ok(log.text.some(([s]) => s === '条件を確かめてください'));
  drawDiskPreview(recCtx(log), 340, { star: {}, disk: {} });
});
test('初期の円盤の図: 種ができる位置が描かれ、その位置・質量は、実際の計算の最初の種と一致する', () => {
  const cond = baseCond();
  for (const seed of [1, 5, 9]) {
    const planned = plannedSeeds(cond, seed);
    const r = runSimulation({ ...baselineInput(seed), star: cond.star, disk: cond.disk });
    const s0 = r.snapshots[0].planets;
    assert.equal(planned.length, s0.length, `seed ${seed}: 種の数`);
    planned.forEach((p, k) => {
      assert.ok(Math.abs(p.a - s0[k].a) < 1e-12, `seed ${seed} 種${k + 1}: 位置`);
      assert.ok(Math.abs(p.mass - (s0[k].mass.metal + s0[k].mass.rock + s0[k].mass.ice)) / p.mass < 1e-9, `seed ${seed} 種${k + 1}: 質量`);
    });
  }
  const arcs = (seeds) => { const log = { text: [], arc: 0, stroke: [] }; drawDiskPreview(recCtx(log), 340, cond, seeds, 5); return log.arc; };
  const planned = plannedSeeds(cond, 5);
  assert.ok(arcs(planned) >= arcs([]) + 2 * planned.length, '種ごとに、軌道の輪と点が描かれる');
  assert.deepEqual(plannedSeeds({ star: {}, disk: {} }, 1), [], '条件が不正なら空');
  assert.notDeepEqual(plannedSeeds(cond, 1), plannedSeeds(cond, 2), 'シードが違えば、配置が変わる');
  assert.ok(plannedSeeds({ ...cond, star: { ...cond.star, Z: 2 } }, 1).length > plannedSeeds(cond, 1).length, '金属量が高いと、種が多い');
});
test('円盤の固体の総量: 基準で約 94 M⊕（仕様書 §1）。金属量に比例し、不正なら null', () => {
  assert.ok(Math.abs(solidTotal(baseCond()) / 94 - 1) < 0.02);
  assert.ok(solidTotal({ ...baseCond(), star: { ...baseCond().star, Z: 2 } }) > 1.9 * solidTotal(baseCond()));
  assert.equal(solidTotal({ star: {}, disk: {} }), null);
});

console.log('presets');
test('プリセットとランダム設定: 同じ seed なら同じ条件、範囲内、実行できる', () => {
  assert.deepEqual(randomInput(42), randomInput(42));
  assert.notDeepEqual(randomInput(42), randomInput(43));
  for (let seed = 1; seed <= 25; seed++) {
    const i = randomInput(seed);
    assert.ok(i.star.mass >= 0.6 && i.star.mass <= 1.4 && i.star.Z >= 0.3 && i.star.Z <= 2.5);
    assert.ok(i.disk.rOut / i.disk.rIn >= 5);
    for (const s of i.disk.structures) assert.ok(s.amp > -1 && s.r > i.disk.rIn && s.r < i.disk.rOut);
    const r = runSimulation(i);
    assert.ok(r.ledger.relError <= 1e-9, `seed ${seed}`);
  }
  for (const p of PRESETS) assert.equal(presetInput(p.id, 1).seed, 1);
});
test('プリセットの狙い: 巨星の多い系は巨大ガス惑星が基準より多く、ホットジュピター系は内側に巨星が出る', () => {
  const frac = (id, n) => {
    let giants = 0, hot = 0, planets = 0;
    for (let s = 1; s <= n; s++) {
      const r = runSimulation(presetInput(id, s));
      for (const p of r.final) {
        planets++;
        if (p.mass.gas / (p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas) >= 0.5 && p.a < 0.3) hot++;
        if (p.mass.gas > 30) giants++;
      }
    }
    return { giants: giants / planets, hot };
  };
  const std = frac('standard', 40), gi = frac('giants', 40), hj = frac('hotjup', 40);
  assert.ok(gi.giants > std.giants, `giants ${gi.giants} vs ${std.giants}`);
  assert.ok(hj.hot > 0, 'ホットジュピター系で内側の巨星が 1 つも出ない');
});

console.log('explain');
test('理由の文章: 件数・内容が条件と整合する', () => {
  const nameOf = (id) => `P${id}`;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const r = runSimulation(presetInput('hotjup', seed));
    const lines = explainResult(r, nameOf);
    assert.ok(lines.length >= 1 && lines.length <= 8);
    assert.ok(lines.every((l) => typeof l === 'string' && l.length > 5 && !l.includes('undefined') && !l.includes('NaN')));
    const hasGiant = r.final.some((p) => p.mass.gas / (p.mass.metal + p.mass.rock + p.mass.ice + p.mass.gas) >= 0.5 && p.mass.gas > 30 * 0.5);
    if (!hasGiant) assert.ok(lines[0].includes('巨大ガス惑星') || lines[0].includes('臨界質量'));
  }
  const low = runSimulation({ ...baselineInput(2), star: { mass: 1, luminosity: 1, Z: 0.5 } });
  assert.ok(explainResult(low, nameOf)[0].includes('金属量が低'));
});
test('イベントの文章と質量表記', () => {
  const nameOf = (id) => `P${id}`;
  assert.ok(eventText({ t: 1e6, kind: 'merge', ids: [1, 2], data: { mass: 5 } }, nameOf).includes('合体'));
  assert.ok(eventText({ t: 1e6, kind: 'eject', ids: [3], data: { mass: 200 } }, nameOf).includes('放出'));
  assert.equal(fmtMass(0.0123), '月の約1倍');
  assert.ok(fmtMass(318).includes('木星の約1.0倍'));
});

console.log('やさしい説明・年表・マーカー');
test('やさしい説明: 5 文以内で、専門用語や単位を使わない。条件ごとに内容が変わる', () => {
  const nameOf = (id) => `P${id}`;
  const jargon = /M⊕|M☉|L☉|MJ|R⊕|臨界質量|Myr|AU|離心率|散乱|サフロノフ|Z\s*=|金属量が/;
  const seen = new Set();
  for (const id of ['standard', 'giants', 'hotjup', 'ice']) {
    for (let seed = 1; seed <= 12; seed++) {
      const r = runSimulation(presetInput(id, seed));
      const lines = explainSimple(r, nameOf);
      assert.ok(lines.length >= 3 && lines.length <= 5, `${id}/${seed}: ${lines.length}`);
      for (const l of lines) {
        assert.ok(!jargon.test(l), `専門用語: ${l}`);
        assert.ok(!l.includes('undefined') && !l.includes('NaN'));
        seen.add(l.slice(0, 12));
      }
    }
  }
  assert.ok(seen.size > 6, '文の種類が少なすぎる');
  const low = runSimulation({ ...baselineInput(2), star: { mass: 1, luminosity: 1, Z: 0.5 } });
  assert.ok(explainSimple(low, nameOf).some((l) => l.includes('材料が足りなかった')));
});
test('できごとの文章に場所(AU)が入り、年表は散乱を除く', () => {
  const r = runSimulation(presetInput('hotjup', 3));
  const nameOf = (id) => `P${id}`;
  for (const e of r.events.filter((x) => x.kind !== 'dispersal')) assert.ok(eventText(e, nameOf).includes('の位置'), e.kind);
  const tl = eventTimeline(r, nameOf, 30);
  assert.ok(tl.length > 0 && tl.length <= 30);
  assert.ok(tl.every((x) => !x.text.includes('散乱して')));
});
test('マーカー: 通過した区間のできごとだけに付き、場所は惑星の位置、散逸は場所なし', () => {
  const events = [
    { t: 1, kind: 'merge', ids: [2, 3], data: { mass: 5, a: 1.5 } },
    { t: 2, kind: 'eject', ids: [4], data: { mass: 9, a: 7 } },
    { t: 3, kind: 'dispersal', ids: [], data: {} },
    { t: 4, kind: 'scatter', ids: [1, 2], data: { a: 2 } },
    { t: 4, kind: 'scatter', ids: [2, 1], data: { a: 2 } },
    { t: 4, kind: 'scatter', ids: [3, 4], data: { a: 2 } },
    { t: 4, kind: 'scatter', ids: [5, 6], data: { a: 2 } },
  ];
  const hitOf = (id) => (id === 2 ? { a: 1.6, ang: 0.5 } : null);
  const letter = (id) => 'bcdef'[id - 1];
  const m = newMarkers(events, 0, 2, hitOf, letter, 10);
  assert.equal(m.length, 2);
  assert.equal(m[0].label, '合体 c+d');
  assert.equal(m[0].a, 1.6); assert.equal(m[0].ang, 0.5); assert.equal(m[0].born, 10);
  assert.equal(m[1].a, 7); // 惑星の位置が分からなければ、イベントの軌道長半径を使う
  assert.equal(newMarkers(events, 2, 3, hitOf, letter, 0)[0].a, null);
  const seen = new Set();
  const sc = newMarkers(events, 3, 4, hitOf, letter, 0, seen);
  assert.equal(sc.length, 2); // 同じペア (1,2)・(2,1) は 1 回だけ、1 フレーム 2 個まで
  assert.equal(sc[0].label, '散乱 b・c'); // 散乱にもラベルが付く
  const again = newMarkers(events, 3, 4, hitOf, letter, 0, seen);
  assert.ok(again.every((x) => x.label !== '散乱 b・c' && x.label !== '散乱 d・e'), '見たペアには再度付かない');
  assert.equal(again.length, 1); // 1 フレームの上限で見送った (5,6) だけが、次に付く
  assert.equal(newMarkers(events, 4, 5, hitOf, letter, 0).length, 0); // 通過済みの区間は再度付かない
  // 放出の印には、飛んでいく惑星を描くための情報が入る
  const ej = newMarkers(events, 1, 2, (id) => ({ a: 7, ang: 1, desc: { class: '巨大氷惑星', teq: 80 }, rr: 6 }), letter, 0)[0];
  assert.equal(ej.kind, 'eject'); assert.equal(ej.desc.class, '巨大氷惑星'); assert.equal(ej.rr, 6); assert.equal(ej.id, 4);
});
test('描画: マーカーつきでも例外なく描け、タップで惑星が選べる', () => {
  globalThis.window = { devicePixelRatio: 1 };
  const calls = {};
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : (...a) => { calls[k] = (calls[k] || 0) + 1; }), set: () => true });
  const canvas = { clientWidth: 400, getContext: () => ctx };
  const r = runSimulation(presetInput('giants', 4));
  const view = createView(canvas, r);
  const f = r.snapshots.length - 1;
  const markers = [{ kind: 'merge', a: 3, ang: 1, born: 0, label: '合体 b+c' }, { kind: 'dispersal', a: null, ang: 0, born: 0, label: 'ガス円盤が散逸した' }];
  view.draw(f, 1, null, markers);
  const first = r.final[0];
  const hit = view.hitOf(first.id);
  assert.ok(hit && Number.isFinite(hit.x) && Number.isFinite(hit.a));
  assert.equal(view.hitTest(hit.x, hit.y), first.id);
  assert.equal(view.hitTest(-50, -50), null);
  assert.ok(calls.fillText >= 3, 'ラベルが描かれていない');
  // 同じ wall なら惑星の位置は同じ（停止中に動かない）
  view.draw(f, 1, null, markers);
  const again = view.hitOf(first.id);
  assert.equal(again.x, hit.x); assert.equal(again.y, hit.y);
});

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
