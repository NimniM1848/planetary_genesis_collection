// app.js を偽の DOM で実際に動かす検査（画面のつなぎ込みの例外を拾う）。実行: node tests/app_smoke.js
// ブラウザではないので見た目は確認できないが、init → 実行 → 再生ループ → 完成 → 停止/再開 → タップ → 図鑑 → 共有 のロジックは通る。
import assert from 'node:assert/strict';
import { calls, els, rafQueue, audio, slowButtons, speedButtons, errors, origErr, counter, test, frames, lastResult, sleep, $, storage, opened } from './fake_dom.js';
import { runSimulation } from '../src/sim/sim.js';
import { MODEL_VERSION } from '../src/sim/params.js';
import { frameOfTime } from '../src/ui/layout.js';

console.log('app.js smoke');
await test('init が例外なく終わり、プリセットとフォームが埋まる', async () => {
  await import('../src/ui/app.js');
  assert.equal($('presets').children.length, 4);
  assert.ok(Number($('f-mstar').value) > 0 && $('f-seed').value !== '');
});
await test('はじめに: 初めてなら自動で開き、次へ・戻る・スキップ・はじめるで進む。閉じたら記録され、「遊び方」で開き直せる', async () => {
  assert.equal($('intro').hidden, false, '初回は自動で開く');
  assert.equal($('intro-step').textContent, '1 / 5');
  assert.equal($('intro-title').textContent, '創る');
  assert.equal($('intro-prev').disabled, true);
  assert.equal($('intro-next').textContent, '次へ');
  $('intro-next').click();
  assert.equal($('intro-step').textContent, '2 / 5');
  assert.equal($('intro-title').textContent, '見守る');
  assert.equal($('intro-prev').disabled, false);
  assert.equal($('intro-art').children.length, 1, '軌道図が出る');
  $('intro-prev').click();
  assert.equal($('intro-step').textContent, '1 / 5');
  for (let i = 0; i < 4; i++) $('intro-next').click();
  assert.equal($('intro-step').textContent, '5 / 5');
  assert.equal($('intro-next').textContent, 'はじめる');
  assert.equal($('intro-skip').textContent, '閉じる');
  assert.ok($('intro-art').children[0].children.length >= 9, 'ことばのメモが並ぶ');
  assert.equal(storage.get('planet_create_intro_seen'), undefined, '最後まで見るか閉じるまでは、記録しない');
  $('intro-next').click(); // はじめる
  assert.equal($('intro').hidden, true);
  assert.equal(storage.get('planet_create_intro_seen'), '1');
  $('btn-howto').click(); // 遊び方で開き直す（いつでも）
  assert.equal($('intro').hidden, false);
  assert.equal($('intro-step').textContent, '1 / 5');
  $('intro-skip').click();
  assert.equal($('intro').hidden, true);
  assert.equal(errors.length, 0, errors.join('\n'));
});
await test('起動時の既定はランダム設定（プリセット未選択）。効果音は既定でオン、凡例はスマホ幅では閉じている', async () => {
  assert.ok($('preset-note').textContent.includes('ランダム'), $('preset-note').textContent);
  for (const b of $('presets').children) assert.equal(b.attrs['aria-pressed'], 'false');
  assert.ok(Number($('f-seed').value) > 0 || $('f-seed').value !== '');
  assert.equal($('opt-sound').checked, true);
  assert.equal($('opt-hz').checked, true, 'ハビタブルゾーンの表示は既定でオン');
  assert.equal($('foot-version').textContent, MODEL_VERSION, '画面の下に計算のバージョンが出る');
  assert.equal($('bootMsg').hidden, true, 'ふつうに開いたときは、起動時のメッセージは出ない');
  assert.equal($('planet-legend-box').open, false); // matchMedia が無い（スマホ幅相当）環境では閉じたまま
});
await test('ランダム設定: 見えている条件でつくる（引き直さない）。使ったあとは、新しい条件に引き直す。ボタンと説明が、それを伝える', async () => {
  const sig = () => ['f-seed', 'f-mstar', 'f-lum', 'f-z', 'f-dmass', 'f-rin', 'f-rout', 'f-tlife', 'f-p'].map((id) => $(id).value).join('/');
  const waitRun = async () => { for (let k = 0; k < 200 && rafQueue.length === 0; k++) await sleep(20); assert.ok(rafQueue.length > 0, '再生が始まらない'); };
  const run = async () => { rafQueue.length = 0; $('btn-run').click(); await waitRun(); };
  assert.equal($('opt-random').checked, true);
  assert.equal($('btn-run').textContent, '惑星系をつくる');
  assert.ok($('roll-note').textContent.includes('いま見えている条件で'), $('roll-note').textContent);
  // 開いた直後: 見えている条件でつくる（引き直さない）
  const shown = sig(), shownDisk = $('diskpreview-note').textContent;
  await run();
  assert.equal(sig(), shown, '開いた直後の条件は、そのままつくる');
  assert.equal($('diskpreview-note').textContent, shownDisk, '確かめた初期の円盤が、つくるときに変わらない');
  assert.equal($('btn-run').textContent, '新しい条件で、惑星系をつくる');
  assert.ok($('roll-note').textContent.includes('この条件でつくりました') && $('roll-note').textContent.includes('新しい条件'));
  // 使ったあと: 押すと、新しい条件に引き直してつくる（押すたびにランダム）
  await run();
  const second = sig();
  assert.notEqual(second, shown, '使ったあとは、新しい条件になる');
  await run();
  assert.notEqual(sig(), second, '押すたびに、新しい条件');
  // 「条件を引き直す」で確かめた条件は、そのままつくる
  $('btn-random').click();
  const rolled = sig(), rolledDisk = $('diskpreview-note').textContent;
  assert.equal($('btn-run').textContent, '惑星系をつくる', '引き直したら、ボタンは元の文字に戻る');
  assert.ok($('roll-note').textContent.includes('いま見えている条件で'));
  await run();
  assert.equal(sig(), rolled, '引き直して確かめた条件を、つくるときに引き直してしまわない');
  assert.equal($('diskpreview-note').textContent, rolledDisk);
  // 引き直しを続けると、毎回変わる
  const seen = new Set();
  for (let i = 0; i < 5; i++) { $('btn-random').click(); seen.add(sig()); }
  assert.equal(seen.size, 5);
  // 結果の画面の「もう一度」: 引き直したあとなら、その条件で。使ったあとなら、新しい条件で
  const before = sig();
  rafQueue.length = 0; $('btn-again').click(); await waitRun();
  assert.equal(sig(), before, '引き直した条件（まだ使っていない）は、そのままつくる');
  const used = sig();
  rafQueue.length = 0; $('btn-again').click(); await waitRun();
  assert.notEqual(sig(), used, '使ったあとは、新しい条件');
  // ランダムを止めると、ボタンの文字と説明は元に戻る
  $('presets').children[0].click();
  assert.equal($('opt-random').checked, false);
  assert.equal($('btn-run').textContent, '惑星系をつくる');
  assert.equal($('roll-note').textContent, '');
  const fixed = sig();
  await run(); await run();
  assert.equal(sig(), fixed, 'ランダムでなければ、押しても条件は変わらない');
  assert.equal($('btn-run').textContent, '惑星系をつくる');
  $('opt-random').checked = true;
  for (const f of $('opt-random').listeners.change ?? []) f({}); // ランダムに戻す → 引き直した条件が見える
  assert.ok($('roll-note').textContent.includes('いま見えている条件で'));
  assert.equal(errors.length, 0, errors.join('\n'));
});
await test('ランダム設定: オンのあいだは「つくる」を押すたびに条件が変わる。自分で値を変える・プリセットを選ぶと止まり、チェックを入れ直すと引き直す', async () => {
  assert.equal($('opt-random').checked, true, '起動時はオン');
  assert.equal($('btn-again').textContent, 'もう一度、ランダムでつくる');
  const sig = () => ['f-seed', 'f-mstar', 'f-lum', 'f-z', 'f-dmass', 'f-rout', 'f-tlife'].map((id) => $(id).value).join('/');
  const waitRun = async () => { for (let k = 0; k < 200 && rafQueue.length === 0; k++) await sleep(20); assert.ok(rafQueue.length > 0, '再生が始まらない'); };
  const seen = new Set();
  for (let i = 0; i < 4; i++) { rafQueue.length = 0; $('btn-run').click(); seen.add(sig()); await waitRun(); }
  assert.equal(seen.size, 4, `押すたびに条件が変わっていない: ${seen.size}`);
  assert.equal($('opt-random').checked, true, '実行してもオンのまま');
  // 自分で値を変えたら止まる
  $('f-z').value = '1.5';
  for (const f of $('f-z').listeners.input ?? []) f({});
  assert.equal($('opt-random').checked, false);
  assert.equal($('btn-again').textContent, '同じ条件で、別のシードでつくる');
  const fixed = sig();
  rafQueue.length = 0; $('btn-run').click(); await waitRun();
  assert.equal(sig(), fixed, '止めたあとは、押しても条件が変わらない');
  // チェックを入れると、引き直す
  $('opt-random').checked = true;
  for (const f of $('opt-random').listeners.change ?? []) f({});
  assert.notEqual(sig(), fixed);
  assert.equal($('btn-again').textContent, 'もう一度、ランダムでつくる');
  // プリセットを選ぶと止まる
  $('presets').children[1].click();
  assert.equal($('opt-random').checked, false);
  assert.equal($('btn-again').textContent, '同じ条件で、別のシードでつくる');
  // 「条件を引き直す」はオンに戻す
  $('btn-random').click();
  assert.equal($('opt-random').checked, true);
  assert.equal(errors.length, 0, errors.join('\n'));
});
await test('開いた詳細設定・凡例は、下の閉じるボタンで閉じられる', async () => {
  for (const [btn, box] of [['close-advanced', 'advanced'], ['close-planet-legend', 'planet-legend-box'], ['close-legend', 'legend-box']]) {
    assert.ok($(btn) && $(box), `${btn} / ${box} が無い`);
    $(box).open = true;
    $(btn).click();
    assert.equal($(box).open, false, `${box} が閉じない`);
  }
});
await test('詳細設定: 各欄に目安の説明が出て、目安の外の値には注意が出る。凡例は 6 種類', async () => {
  assert.ok($('h-f-rout').textContent.includes('直径ではありません'), $('h-f-rout').textContent);
  assert.ok($('h-f-rout').textContent.includes('目安 25〜60 AU'));
  $('f-rout').value = '70';
  for (const f of $('f-rout').listeners.input ?? []) f({});
  assert.ok($('h-f-rout').textContent.includes('大きい値'), $('h-f-rout').textContent);
  assert.equal($('h-f-rout').className, 'hint-f warn');
  $('f-rout').value = '30';
  for (const f of $('f-rout').listeners.input ?? []) f({});
  assert.equal($('h-f-rout').className, 'hint-f');
  assert.equal($('legend').children.length, 6);
});
await test('「惑星系をつくる」→ 計算 → 再生ループが動き、軌道図が毎フレーム描かれ続ける', async () => {
  $('presets').children[0].click(); // 「標準」（この検査は、標準の設定と結果を前提にする）
  $('f-seed').value = '5';
  $('btn-run').click();
  for (let i = 0; i < 200 && rafQueue.length === 0; i++) await sleep(20);
  assert.ok(rafQueue.length > 0, '計算が終わらない、または再生ループが始まらない');
  assert.equal($('viewer').hidden, false);
  const before = calls.clear;
  frames(60);
  assert.ok(calls.clear - before >= 60, `毎フレーム描かれていない: ${calls.clear - before}`);
  assert.ok(calls.drawn > 1000, '円や惑星が描かれていない');
  // 冒頭の 3.6 秒（約 110 フレーム）は「種が生まれる」演出で、時間は進まない
  assert.equal($('stage').textContent, '種の誕生');
  assert.equal(Number($('seek').value), 0, '演出の間は時間が進まないはず');
  frames(90); // 演出が終わって、時間が進み始める
  assert.notEqual($('stage').textContent, '種の誕生');
  frames(30);
  assert.ok(Number($('seek').value) > 0, '演出のあと、時間が進んでいない');
  assert.equal(errors.length, 0, errors.join('\n'));
});
await test('最後まで再生すると結果が出て、その後も公転は動き続ける（描画ループは止まらない）', async () => {
  for (let i = 0; i < 4000 && $('result').hidden; i++) frames(1, 100);
  assert.equal($('result').hidden, false, '結果が表示されない');
  assert.ok($('res-simple').children.length >= 3);
  assert.ok($('res-planets').children.length >= 1);
  const c0 = calls.clear;
  frames(20);
  assert.equal(calls.clear - c0, 20, '完成後に描画が止まった');
  assert.equal($('btn-play').textContent, '一時停止');
});
await test('惑星の系統の凡例: 10 行あり、完成した系の惑星の個数と合う。スローの既定は「ゆっくり」', async () => {
  assert.equal($('planet-legend').children.length, 10);
  const total = $('planet-legend').children.reduce((sum, li) => sum + (Number(li.children[2].textContent) || 0), 0);
  assert.ok(total >= 1, '凡例の個数が出ていない');
  const r = lastResult();
  assert.equal(total, r.final.length, '凡例の合計が、軌道上の惑星の数と違う');
  assert.equal(slowButtons[2].attrs['aria-pressed'], 'true');
  slowButtons[0].click();
  assert.equal(slowButtons[0].attrs['aria-pressed'], 'true');
  assert.equal(slowButtons[2].attrs['aria-pressed'], 'false');
  slowButtons[2].click();
});
await test('できごとの一覧を押すと、その時に戻って再生し直す（ログと年表の両方）', async () => {
  const r = lastResult();
  const n = r.snapshots.length;
  assert.ok($('eventlog').children.length >= 1);
  assert.ok($('res-timeline').children.length >= 1);
  assert.equal(Number($('seek').value), n - 1, '完成状態から始める');
  const firstLog = $('eventlog').children.at(-1).children[0]; // 一覧は新しいものが上。末尾が最初のできごと
  firstLog.click();
  frames(1);
  const f1 = Number($('seek').value);
  assert.ok(f1 < n - 1 - 10, `戻っていない: ${f1}/${n - 1}`);
  assert.equal($('btn-play').textContent, '一時停止', '戻ったあとは再生が始まる');
  // 戻った時刻の一覧は「そこまで」に縮む
  assert.ok($('eventlog').children.length < r.events.filter((e) => e.kind !== 'scatter').length + 1);
  // 年表のボタンでも、そのできごとの少し前に移る（どの系でも成り立つ確認: 押したできごとの位置 − 3 フレーム付近）
  const timeline = r.events.filter((e) => e.kind !== 'scatter').slice(0, 40);
  const last = $('res-timeline').children.at(-1).children[0];
  assert.ok(last.listeners.click.length >= 1);
  const expected = Math.max(0, frameOfTime(r, timeline.at(-1).t) - 3);
  last.click();
  frames(1);
  assert.ok(Math.abs(Number($('seek').value) - expected) < 2, `年表のボタンで、そのできごとの少し前に移っていない: ${$('seek').value} / 期待 ${expected}`);
  assert.equal($('btn-play').textContent, '一時停止');
});
await test('ハビタブルゾーン: 既定でオンで描かれ、オフにすると描かれず、オンに戻すと描かれる。オフにした設定だけが記憶される', async () => {
  assert.equal($('opt-hz').checked, true);
  const withHz = () => { const c0 = calls.fillText; frames(3); return calls.fillText - c0; };
  const on = withHz();
  $('opt-hz').checked = false;
  for (const f of $('opt-hz').listeners.change ?? []) f({});
  assert.equal(storage.get('planet_create_hz'), '0', 'オフにした設定は記憶する');
  const off = withHz();
  assert.ok(on > off, `オンのほうが文字（ハビタブルゾーンの名前）が多いはず: オン ${on} / オフ ${off}`);
  $('opt-hz').checked = true;
  for (const f of $('opt-hz').listeners.change ?? []) f({});
  assert.equal(storage.get('planet_create_hz'), '1');
  assert.ok(withHz() > off);
});
await test('一時停止で止まり、再開で動く。くわしく見るで詳細が開く', async () => {
  $('btn-play').click();
  assert.equal($('btn-play').textContent, '再開');
  frames(3);
  $('btn-play').click();
  assert.equal($('btn-play').textContent, '一時停止');
  assert.equal($('res-detail').hidden, true);
  $('btn-detail').click();
  assert.equal($('res-detail').hidden, false);
  assert.ok($('res-timeline').children.length > 0);
});
await test('動いている間に惑星をタップすると止まり、図の上にカードが出る。×で閉じられる', async () => {
  frames(2);
  let hit = null;
  for (let y = 10; y < 400 && !hit; y += 6) for (let x = 10; x < 400 && !hit; x += 6) {
    const before = $('pop').hidden;
    // タップを模擬（当たったかは、停止したかで判定）
    for (const f of $('canvas').listeners.pointerup ?? []) f({ clientX: x, clientY: y });
    if ($('btn-play').textContent === '再開') hit = { x, y };
  }
  assert.ok(hit, '惑星をタップできる位置が見つからない');
  frames(2);
  assert.equal($('pop').hidden, false, 'カードが出ない');
  assert.ok($('pop').children.length > 2);
  $('btn-play').click(); // 再開するとカードは隠れる
  frames(2);
  assert.equal($('pop').hidden, true);
});
await test('最初から見る → もう一度最後まで再生でき、シークバーで途中へ戻せる', async () => {
  $('btn-replay').click();
  frames(10);
  assert.ok(Number($('seek').value) < 30, '最初に戻っていない');
  $('seek').value = '100';
  for (const f of $('seek').listeners.input ?? []) f({});
  frames(2);
  assert.ok(Number($('seek').value) >= 100);
});
await test('効果音: 既定でオン。できごとを通過すると音が出て、オフにすると鳴らず、オンに戻すと確認の音が鳴る', async () => {
  assert.equal($('opt-sound').checked, true);
  const before = audio.oscillators;
  $('btn-replay').click();
  frames(1500, 100);
  assert.ok(audio.contexts >= 1, '音を出せる状態になっていない');
  assert.ok(audio.oscillators > before, 'できごとの音が鳴らない（既定でオンのはず）');
  assert.equal(audio.started, audio.oscillators, '作った音がすべて開始されている');
  $('opt-sound').checked = false;
  for (const f of $('opt-sound').listeners.change ?? []) f({});
  const off = audio.oscillators;
  $('btn-replay').click();
  frames(1500, 100);
  assert.equal(audio.oscillators, off, 'オフにしたのに鳴った');
  $('opt-sound').checked = true;
  for (const f of $('opt-sound').listeners.change ?? []) f({});
  assert.ok(audio.oscillators > off, 'オンに戻したときの確認の音が鳴らない');
});
// ---- 図鑑・共有 ----
const findAll = (el, pred, out = []) => { if (el && typeof el === 'object') { if (pred(el)) out.push(el); for (const c of el.children ?? []) findAll(c, pred, out); } return out; };
const runToResult = async (seed) => {
  $('presets').children[0].click(); // 標準プリセット（ランダム設定は止まる）
  $('f-seed').value = String(seed);
  $('btn-run').click();
  for (let i = 0; i < 200 && rafQueue.length === 0; i++) await sleep(20);
  for (let i = 0; i < 4000 && $('result').hidden; i++) frames(1, 100);
  assert.equal($('result').hidden, false);
};
const cardButtons = (card, label) => findAll(card, (e) => e.textContent === label && e.listeners?.click);

await test('図鑑: 完成すると、惑星系と惑星が自動で登録される（ボタンは無い）。重ねて見ても増えない', async () => {
  await runToResult(5);
  const r = lastResult();
  assert.equal($('btn-reg-system'), undefined, '登録ボタンは無い');
  assert.ok($('res-rarity').textContent.includes('希少度'), $('res-rarity').textContent);
  assert.ok($('toast').textContent.includes('図鑑に登録しました'), $('toast').textContent);
  assert.ok($('toast').textContent.includes('上の「図鑑」で'), '初めての登録には、図鑑の場所を知らせる');
  assert.ok($('res-reg').textContent.includes('登録されています'));
  const saved = JSON.parse(storage.get('planet_create_dex_v1'));
  assert.equal(saved.systems.length, 1);
  assert.equal(saved.planets.length, r.final.length);
  assert.ok(saved.systems[0].final.length === r.final.length && !('snapshots' in saved.systems[0]), '保存するのは条件と最終結果だけ');
  assert.equal($('dex-badge').textContent, String(1 + r.final.length));
  for (const card of $('res-planets').children) {
    assert.equal(cardButtons(card, '図鑑に登録').length, 0, '惑星ごとの登録ボタンも無い');
    assert.equal(cardButtons(card, '共有').length, 1, '共有のボタンはある');
  }
  // 完成まで飛ばす・時間バーで最後へ → 何度 showResult が呼ばれても、増えない
  $('btn-skip').click();
  $('btn-skip').click();
  assert.equal(JSON.parse(storage.get('planet_create_dex_v1')).systems.length, 1);
  assert.equal(JSON.parse(storage.get('planet_create_dex_v1')).planets.length, r.final.length);
});
await test('図鑑: 別の惑星系を完成させると、2 件目が登録される。保存できないときは知らせて、図鑑は壊さない', async () => {
  await runToResult(11);
  const saved = JSON.parse(storage.get('planet_create_dex_v1'));
  assert.equal(saved.systems.length, 2);
  const before = storage.get('planet_create_dex_v1');
  const orig = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  await runToResult(12);
  assert.ok($('toast').textContent.includes('保存できません'), $('toast').textContent);
  assert.ok($('res-reg').textContent.includes('登録できませんでした'));
  globalThis.localStorage.setItem = orig;
  assert.equal(storage.get('planet_create_dex_v1'), before, '失敗しても、保存済みの図鑑はそのまま');
  await runToResult(12); // 保存できる状態に戻ったら、登録される
  assert.equal(JSON.parse(storage.get('planet_create_dex_v1')).systems.length, 3);
});
await test('図鑑の画面（惑星図鑑）: 完成度・マス・希少度順の一覧・絞り込み', async () => {
  $('tab-dex').click();
  assert.equal($('dex').hidden, false);
  assert.equal($('view-make').hidden, true);
  assert.equal($('btn-play').textContent, '再開', '図鑑を見ている間は再生を止める');
  assert.ok(/完成度: \d+ \/ \d+ マス/.test($('dex-progress').textContent), $('dex-progress').textContent);
  const tbody = $('dex-grid').children[1];
  assert.equal(tbody.children.length, 8, '行は 8 分類');
  const onCells = findAll($('dex-grid'), (e) => String(e.className).includes('cell on'));
  assert.ok(onCells.length >= 1, '埋まったマスがある');
  const n = $('dex-plist').children.length;
  assert.ok(n >= 2);
  // 希少度順（高い順）に並んでいる
  const tiers = $('dex-plist').children.map((c) => Number(/t(\d)/.exec(findAll(c, (e) => /^rarity t\d/.test(e.className ?? ''))[0].className)[1]));
  assert.deepEqual(tiers, [...tiers].sort((a, b) => b - a), `希少度順になっていない: ${tiers}`);
  onCells[0].click(); // 絞り込み
  assert.ok($('dex-filter').children.length >= 1 && String($('dex-filter').children[0]).length >= 0);
  assert.ok($('dex-plist').children.length >= 1 && $('dex-plist').children.length <= n);
  const sel = findAll($('dex-grid'), (e) => String(e.className).includes('sel'));
  assert.equal(sel.length, 1, '選んだマスに印');
  sel[0].click(); // 解除
  assert.equal($('dex-plist').children.length, n);
});
await test('共有: 結果から共有ダイアログが開き、画像が描かれ、X の投稿画面を開く。localhost ではリンクを付けず、シードを入れる', async () => {
  $('tab-make').click();
  const fills = calls.fillText;
  $('btn-share-system').click();
  assert.equal($('share-dialog').hidden, false);
  assert.ok(calls.fillText > fills + 5, '共有画像が描かれていない');
  const text = $('share-text').value;
  assert.ok(text.includes('#惑星系創造') && text.includes('希少度') && text.includes('シード'), text);
  assert.ok($('share-note').textContent.includes('リンクは付けず'));
  assert.ok($('share-note').textContent.includes('画像を保存') && $('share-note').textContent.includes('添付'), '画像を添付する案内が出る');
  const o = opened.length;
  $('share-x').click();
  assert.equal(opened.length, o + 1);
  assert.ok(opened.at(-1).startsWith('https://twitter.com/intent/tweet?text='));
  assert.ok(!opened.at(-1).includes('&url='), 'localhost のリンクは付けない');
  $('share-close').click();
  assert.equal($('share-dialog').hidden, true);
});
await test('共有の画像: 普通の画像としても表示され（長押し・右クリックで保存できる）、保存先を選べる環境ではその画面を開き、使えない環境ではダウンロードにする', async () => {
  $('btn-share-system').click();
  assert.ok(String($('share-img').src).startsWith('data:image/png'), '画像として表示される');
  assert.equal($('share-img').hidden, false);
  assert.equal($('share-canvas').hidden, true, '描画用の canvas は隠す');
  // 保存先を選べる環境（Chrome / Edge）
  const written = []; let asked = null;
  globalThis.showSaveFilePicker = async (opts) => { asked = opts; return { createWritable: async () => ({ write: async (b) => { written.push(b); }, close: async () => {} }) }; };
  $('share-save').click();
  await sleep(30);
  assert.ok(asked && asked.suggestedName.endsWith('.png') && asked.types[0].accept['image/png'], '保存の画面に、名前と種類を渡す');
  assert.equal(written.length, 1, '選んだ場所に、画像が書かれる');
  assert.ok($('toast').textContent.includes('保存しました'));
  // 保存の画面を閉じたら（キャンセル）、何もしない（ダウンロードもしない）
  let downloads = 0;
  const origCreate = globalThis.document.createElement;
  globalThis.URL.createObjectURL = () => 'blob:test'; globalThis.URL.revokeObjectURL = () => {};
  globalThis.document.createElement = (tag) => { const e = origCreate(tag); if (tag === 'a') e.click = () => { downloads++; }; return e; };
  globalThis.showSaveFilePicker = async () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; };
  $('share-save').click(); await sleep(30);
  assert.equal(downloads, 0, 'キャンセルでは、ダウンロードしない');
  // 使えない・失敗する環境は、ダウンロードにする
  globalThis.showSaveFilePicker = async () => { const e = new Error('denied'); e.name = 'SecurityError'; throw e; };
  $('share-save').click(); await sleep(30);
  assert.equal(downloads, 1, '失敗したら、ダウンロードにする');
  delete globalThis.showSaveFilePicker;
  $('share-save').click(); await sleep(30);
  assert.equal(downloads, 2, '保存の画面が無い環境（Safari・Firefox・スマホ）は、ダウンロード');
  globalThis.document.createElement = origCreate;
  $('share-close').click();
});
await test('共有の画像の保存のしかた: パソコンでは右クリック、スマホ（指で操作する画面）では長押しの案内が出る', async () => {
  $('btn-share-system').click();
  assert.ok($('share-hint').textContent.includes('右クリック') && !$('share-hint').textContent.includes('長押し'), $('share-hint').textContent);
  $('share-close').click();
  globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' });
  $('btn-share-system').click();
  assert.ok($('share-hint').textContent.includes('長押し') && $('share-hint').textContent.includes('写真に追加') && !$('share-hint').textContent.includes('右クリック'), $('share-hint').textContent);
  $('share-close').click();
  delete globalThis.matchMedia;
});
await test('共有: 公開アドレスなら、同じ惑星系を再現するリンクが付く。惑星の共有もできる', async () => {
  Object.assign(globalThis.location, { protocol: 'https:', hostname: 'example.com', origin: 'https://example.com' });
  $('btn-share-system').click();
  assert.ok(!$('share-text').value.includes('シード'));
  assert.ok($('share-note').textContent.includes('同じ条件の惑星系を再現') && $('share-note').textContent.includes('共通の画像'), 'カードの画像は共通であることを伝える');
  const url = decodeURIComponent(opened.length ? '' : '');
  $('share-x').click();
  assert.ok(opened.at(-1).includes('&url=' + encodeURIComponent('https://example.com/planet_create/#s=')), opened.at(-1));
  $('share-close').click();
  const card = $('res-planets').children[0];
  cardButtons(card, '共有')[0].click();
  assert.equal($('share-dialog').hidden, false);
  assert.ok($('share-text').value.includes('#惑星系創造') && $('share-text').value.includes('希少度'));
  $('share-close').click();
  Object.assign(globalThis.location, { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8000' });
});
await test('図鑑（惑星系図鑑）: 一覧が出て、共有でき、削除のボタンは無い', async () => {
  $('tab-dex').click();
  $('dex-tab-systems').click();
  const card = $('dex-slist').children[0];
  assert.ok($('dex-scount').textContent.includes('3 件'), $('dex-scount').textContent);
  assert.equal($('dex-slist').children.length, 3);
  cardButtons(card, '共有')[0].click();
  assert.equal($('share-dialog').hidden, false);
  $('share-close').click();
  assert.equal(cardButtons(card, '削除').length, 0, '削除のボタンは無い');
  $('dex-tab-planets').click();
  assert.equal(cardButtons($('dex-plist').children[0], '削除').length, 0, '惑星にも削除のボタンは無い');
  assert.equal(cardButtons($('dex-plist').children[0], '共有').length, 1);
});
await test('図鑑から「もう一度見る」: 条件から再計算して再生し、作る画面に戻る', async () => {
  $('tab-make').click();
  $('tab-dex').click();
  $('dex-tab-systems').click();
  const card = $('dex-slist').children[0];
  rafQueue.length = 0;
  cardButtons(card, 'もう一度見る')[0].click();
  assert.equal($('view-make').hidden, false);
  assert.ok($('preset-note').textContent.includes('図鑑から再生'));
  for (let i = 0; i < 200 && rafQueue.length === 0; i++) await sleep(20);
  assert.ok(rafQueue.length > 0, '再生が始まらない');
  frames(5);
  assert.equal($('stage').textContent, '種の誕生');
  assert.equal(errors.length, 0, errors.join('\n'));
});

// ---- 初期の円盤の図 ----
await test('初期の円盤の図: 起動時に描かれ、条件を引き直す・値を変えるたびに描き直されて説明が変わる。不正な値ではメッセージ', async () => {
  const note = () => $('diskpreview-note').textContent;
  assert.ok(note().includes('惑星の種:') && note().includes('固体の総量') && note().includes('スノーライン'), note());
  assert.ok(!('f-nseed' in {}) && $('f-nseed') === undefined, '惑星の種の数の入力欄は無い（条件から決まる）');
  const arcs0 = calls.drawn;
  const seen = new Set([note()]);
  for (let i = 0; i < 6; i++) { $('btn-random').click(); seen.add(note()); }
  assert.ok(seen.size >= 4, `引き直しても円盤の説明が変わらない: ${seen.size}`);
  assert.ok(calls.drawn > arcs0 + 6 * 300, '引き直すたびに、円盤が描かれている');
  // 自分で値を変えると、描き直される（ランダムは止まる）
  $('presets').children[0].click();
  const before = note();
  $('f-z').value = '2';
  for (const f of $('f-z').listeners.input ?? []) f({});
  assert.notEqual(note(), before, '金属量を変えると、固体の総量が変わる');
  const nSeeds = () => Number(/惑星の種: (\d+) 個/.exec(note())[1]);
  const n1 = nSeeds();
  $('f-z').value = '0.4';
  for (const f of $('f-z').listeners.input ?? []) f({});
  const nLow = nSeeds();
  $('f-z').value = '2.4';
  for (const f of $('f-z').listeners.input ?? []) f({});
  assert.ok(nLow < nSeeds(), `金属量が高いほど、種が多い: ${nLow} → ${nSeeds()}`);
  $('f-z').value = '2';
  for (const f of $('f-z').listeners.input ?? []) f({});
  assert.equal($('opt-random').checked, false);
  $('f-lum').value = '4';
  for (const f of $('f-lum').listeners.input ?? []) f({});
  assert.ok(note().includes('スノーライン'));
  // 入力の途中（空）は、メッセージ
  const rin = $('f-rin').value;
  $('f-rin').value = '';
  for (const f of $('f-rin').listeners.input ?? []) f({});
  assert.equal(note(), '条件を確かめてください。');
  $('f-rin').value = rin;
  for (const f of $('f-rin').listeners.input ?? []) f({});
  assert.ok(note().includes('固体の総量'));
  // 図鑑を見たあと、作る画面に戻ると描き直す
  $('tab-dex').click(); const a1 = calls.drawn; $('tab-make').click();
  assert.ok(calls.drawn > a1, '作る画面に戻ったら、円盤を描き直す');
  assert.equal(errors.length, 0, errors.join('\n'));
});
await test('置く機能は無い: 種を自分で置くパネルは画面に無く、保存される条件にも置いた種は入らない', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('seedpanel') && !html.includes('惑星の種を自分で置く'));
  const sys = JSON.parse(storage.get('planet_create_dex_v1') ?? '{"systems":[]}').systems[0];
  if (sys) assert.deepEqual(sys.input.seeds, []);
});

await test('入れられる範囲の外の値は、画面にエラーが出て、実行されない', async () => {
  $('presets').children[0].click(); // ランダム設定を止める（オンのままだと、押すたびに値が引き直される）
  const before = rafQueue.length;
  $('f-rout').value = '200';
  $('btn-run').click();
  assert.ok($('err').textContent.includes('15〜80'), $('err').textContent);
  $('f-rout').value = '30';
  $('f-dmass').value = '0.5'; // とんでもなく重い円盤
  $('btn-run').click();
  assert.ok($('err').textContent.includes('0.005〜0.08'), $('err').textContent);
  $('f-dmass').value = '';
  $('btn-run').click();
  assert.ok($('err').textContent.includes('数値'), $('err').textContent);
});

console.error = origErr;
console.log(counter.failed ? `\n${counter.failed} 件失敗` : '\nすべて成功');
process.exit(counter.failed ? 1 : 0);
