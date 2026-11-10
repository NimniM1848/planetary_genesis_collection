// 画面の組み立て: 入口（プリセット/ランダム/詳細設定）→ 実行(Worker) → 上から見た再生 → 結果。
import { describePlanet } from '../sim/physics.js';
import { createView, drawPlanetSprite, MARKER_STYLE } from './render.js';
import { FIELDS, rangeWarning, typicalText } from './fields.js';
import { newMarkers } from './markers.js';
import { createSound } from './sound.js';
import { frameState, stageOf, eventFrames, playbackRate, frameOfTime, INTRO_SECONDS, seedBirthStart } from './layout.js';
import { PLANET_LEGEND, planetKey, planetColor } from './look.js';
import { PRESETS, presetInput, randomInput, newSeed } from './presets.js';
import { planetNames, systemName } from './naming.js';
import { eventText, explainResult, explainSimple } from './explain.js';
import { fmtTime, fmtMass, fmtPos } from './units.js';
import { planetCardNodes, textEl } from './cards.js';
import { createStore } from '../dex/store.js';
import { buildSystemRecord, buildPlanetRecords } from '../dex/records.js';
import { rarityOfSystem, rarityOfPlanet } from '../dex/rarity.js';
import { parseShareHash, buildShareUrl, isPublicUrl, systemShareText, planetShareText, modelMatches } from '../dex/share.js';
import { createDexUi } from './dex_ui.js';
import { createShareUi } from './share_ui.js';
import { createIntroUi } from './intro_ui.js';
import { drawDiskPreview, solidTotal, plannedSeeds } from './diskpreview.js';
import { snowline } from '../sim/disk.js';
import { MODEL_VERSION } from '../sim/params.js';
import { drawSystemCard, drawPlanetCard } from './shareimg.js';

const $ = (id) => document.getElementById(id);
const sound = createSound();

const state = {
  input: null, structures: [], result: null, view: null, names: null,
  f: 0, playing: false, speed: 1, selectedId: null, wall: 0, last: 0, logIndex: -1, finished: false, raf: 0,
  markers: [], lastT: 0, popKey: '', eventFrames: [], slow: false, scatterSeen: new Set(), slowLevel: 0.06, logKey: '', introT: INTRO_SECONDS, randomMode: true, rollFresh: true, // rollFresh: いま見えているランダムな条件が、まだ使われていない（つくる前）
};

// ---------- 入口 ----------
function buildPresets() {
  const box = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.name; b.dataset.id = p.id; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => selectPreset(p.id));
    box.appendChild(b);
  }
}

/** 条件をランダムに引き直して、フォームに入れる。ランダム設定のモードになる */
function applyRandom() {
  fillForm(randomInput(newSeed()));
  for (const b of $('presets').children) b.setAttribute('aria-pressed', 'false');
  $('preset-note').textContent = 'ランダム設定（恒星・円盤・初期構造）。';
  state.rollFresh = true; // 引き直したばかりの条件は、まだ使われていない。「つくる」を押すと、この条件でつくる
  setRandomMode(true);
}

/**
 * ランダム設定のモードの切り替え。オンのあいだ、「つくる」は、
 *  - 見えている条件がまだ使われていなければ（開いた直後・「条件を引き直す」の直後）、その条件でつくる（引き直さない）
 *  - すでに使ったあとなら、新しい条件に引き直してつくる（押すたびにランダム）
 * （確かめた円盤が、「つくる」で別の円盤に変わってしまわないようにするため）
 */
function setRandomMode(on) {
  state.randomMode = on;
  $('opt-random').checked = on;
  $('btn-again').textContent = on ? 'もう一度、ランダムでつくる' : '同じ条件で、別のシードでつくる';
  updateRollUi();
}

/** 「つくる」を押すと何が起きるかを、ボタンの文字と説明で伝える */
function updateRollUi() {
  const used = state.randomMode && !state.rollFresh;
  $('btn-run').textContent = used ? '新しい条件で、惑星系をつくる' : '惑星系をつくる';
  $('roll-note').textContent = !state.randomMode ? '' : used ? 'この条件でつくりました。もう一度押すと、新しい条件になります。' : 'いま見えている条件で、つくります。';
}

function initSound() {
  sound.enabled = true; // 既定はオン。オフにした設定だけを記憶する
  try { if (localStorage.getItem('planet_create_sound') === '0') sound.enabled = false; } catch { /* 保存できない環境では、既定のオン */ }
  $('opt-sound').checked = sound.enabled;
  $('opt-sound').addEventListener('change', () => {
    sound.enabled = $('opt-sound').checked;
    if (sound.enabled) { sound.unlock(); sound.play('merge'); } // 押した操作の中で音を出せる状態にし、確認の音を鳴らす
    try { localStorage.setItem('planet_create_sound', sound.enabled ? '1' : '0'); } catch { /* 無視 */ }
  });
}

function selectPreset(id) {
  setRandomMode(false); // プリセットを選んだら、ランダムではなく、その条件でつくる
  const input = presetInput(id, Number($('f-seed').value) || newSeed());
  state.structures = [];
  fillForm(input);
  for (const b of $('presets').children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  $('preset-note').textContent = PRESETS.find((p) => p.id === id).note;
}

function fillForm(input) {
  $('f-mstar').value = round(input.star.mass, 2);
  $('f-lum').value = round(input.star.luminosity, 2);
  $('f-z').value = round(input.star.Z, 2);
  $('f-dmass').value = round(input.disk.mass, 3);
  $('f-rin').value = round(input.disk.rIn, 3);
  $('f-rout').value = round(input.disk.rOut, 1);
  $('f-tlife').value = round(input.disk.tLife / 1e6, 2);
  $('f-p').value = round(input.disk.p, 2);
  $('f-seed').value = input.seed;
  // 円盤の構造は 3 桁に丸める（共有リンクが短くなり、画面の値と実行する値が一致する）
  state.structures = (input.disk.structures ?? []).map((x) => ({ r: round(x.r, 3), width: round(x.width, 3), amp: round(x.amp, 3) }));
  const n = state.structures.length;
  redrawPreview(); // 条件が変わったので、初期の円盤を描き直す
  refreshHints();
  $('structures-note').textContent = n ? `円盤の初期構造: リング/ギャップ ${n} 個（ランダム設定で追加）` : '円盤の初期構造: なし';
}

const round = (x, d) => Number(x.toFixed(d));

function readForm() {
  const num = (id) => Number($(id).value);
  const input = presetInput('standard', Math.floor(num('f-seed')));
  input.star = { mass: num('f-mstar'), luminosity: num('f-lum'), Z: num('f-z') };
  input.disk = {
    mass: num('f-dmass'), rIn: num('f-rin'), rOut: num('f-rout'),
    tLife: num('f-tlife') * 1e6, p: num('f-p'), structures: state.structures,
  };
  const bad = (cond, msg) => { if (cond) throw new Error(msg); };
  for (const id of ['f-mstar', 'f-lum', 'f-z', 'f-dmass', 'f-rin', 'f-rout', 'f-tlife', 'f-p', 'f-seed']) {
    const el = $(id);
    bad(!Number.isFinite(num(id)) || $(id).value === '', `${el.closest('label').firstChild.textContent.trim()} に数値を入れてください`);
    bad(num(id) < Number(el.min) || num(id) > Number(el.max), `${el.closest('label').firstChild.textContent.trim()} は ${el.min}〜${el.max} の範囲で入れてください`);
  }
  bad(input.disk.rIn >= input.disk.rOut / 5, '円盤の外縁は、内縁の 5 倍以上にしてください');
  return input;
}

// ---------- 実行 ----------
let worker = null;
function runInWorker(input) {
  return new Promise((resolve, reject) => {
    try {
      worker?.terminate();
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      import('../sim/sim.js').then((m) => resolve(m.runSimulation(input)), reject); // Worker が使えない環境ではメインスレッドで実行
      return;
    }
    worker.onmessage = (e) => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)));
    worker.onerror = () => {
      import('../sim/sim.js').then((m) => resolve(m.runSimulation(input)), reject);
    };
    worker.postMessage({ input });
  });
}

async function start(input) {
  state.rollFresh = false; // この条件は使った。ランダム設定のあいだ、次に「つくる」を押すと、新しい条件になる
  updateRollUi();
  $('err').textContent = '';
  cancelAnimationFrame(state.raf);
  $('btn-run').disabled = true;
  $('result').hidden = true;
  $('viewer').hidden = false;
  $('status').textContent = '惑星系を計算しています…';
  hidePop();
  $('viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  let result;
  try {
    result = await runInWorker(input);
  } catch (e) {
    $('status').textContent = '';
    $('err').textContent = `計算に失敗しました: ${e.message}`;
    $('viewer').hidden = true;
    $('btn-run').disabled = false;
    return;
  }
  $('btn-run').disabled = false;
  state.input = input;
  state.prevF = 0;
  state.result = result;
  state.names = planetNames(result);
  state.view = createView($('canvas'), result);
  state.f = 0; state.playing = true; state.finished = false; state.selectedId = null; state.logIndex = -1; state.wall = 0; state.last = 0; state.markers = []; state.lastT = 0; state.popKey = ''; state.eventFrames = eventFrames(result); state.slow = false; state.scatterSeen = new Set(); state.logKey = ''; state.introT = 0; // 冒頭の「種が生まれる」演出から始める
  const n = result.snapshots.length;
  $('seek').max = String(n - 1);
  $('seek').value = '0';
  $('status').textContent = result.warnings.length ? result.warnings.join(' ') : '';
  updatePlayButton();
  state.raf = requestAnimationFrame(tick);
}

// ---------- 再生 ----------
const nameOf = (id) => state.names.get(id) ?? `惑星#${id}`;

function tick(ts) {
  const r = state.result;
  if (!r) return;
  const dt = state.last ? Math.min(0.1, (ts - state.last) / 1000) : 0;
  state.last = ts;
  const n = r.snapshots.length;
  // playing = 「止めていない」こと。公転の見た目とマーカーは、止めない限り（完成後も）動き続ける
  if (state.playing) {
    state.wall += dt;
    if (state.introT < INTRO_SECONDS) {
      // 冒頭: 円盤の中に種が 1 つずつ生まれる演出。この間、時間（シミュレーション）は進めない
      const prevU = state.introT / INTRO_SECONDS;
      state.introT = Math.min(INTRO_SECONDS, state.introT + dt);
      const u = state.introT / INTRO_SECONDS;
      const n0 = r.snapshots[0].planets.length;
      let born = false;
      for (let k = 0; k < n0; k++) { const s0 = seedBirthStart(k, n0); if (prevU < s0 && s0 <= u) born = true; }
      if (born) sound.play('seed');
    } else if (!state.finished) {
      // できごとの前後は、時間の進みをゆっくりにする
      const rate = playbackRate(state.f, state.eventFrames, { slow: state.slowLevel });
      state.slow = rate < 1;
      state.f += dt * state.speed * rate * (n / 35); // 速度 1× で約 35 秒で最後まで（スローの分は除く）
      if (state.f >= n - 1) { state.f = n - 1; state.finished = true; state.slow = false; showResult(); }
    }
  }
  render();
  state.raf = requestAnimationFrame(tick);
}

function render() {
  const r = state.result;
  spawnMarkers();
  const intro = state.introT < INTRO_SECONDS ? { u: state.introT / INTRO_SECONDS } : null;
  const fs = state.view.draw(state.f, state.wall, state.selectedId, state.markers, { hz: $('opt-hz').checked, intro });
  state.lastT = fs.t;
  $('seek').value = String(state.f);
  const atEnd = state.f >= r.snapshots.length - 1;
  $('stage').textContent = intro ? '種の誕生' : stageOf(fs.t, r.input.disk.tLife, atEnd);
  $('clock').textContent = `t = ${fmtTime(fs.t)}`;
  $('slowtag').hidden = !(state.slow && state.playing && !state.finished);
  if (fs.index !== state.logIndex) { state.logIndex = fs.index; updateLog(fs.t); updatePlanetLegend(fs); }
  if (state.selectedId !== null && !state.playing) showPop(fs); else hidePop();
}

/** 再生が進んで通過したできごとに、起きた場所のマーカーを付ける（シーク時などの大きな飛びでは付けない） */
function spawnMarkers() {
  const r = state.result;
  const fs = frameState(r, state.f);
  const jumped = fs.t <= state.lastT || state.f - state.prevF > 4;
  state.prevF = state.f;
  if (!state.playing || jumped) return;
  const fresh = newMarkers(r.events, state.lastT, fs.t, (id) => state.view.hitOf(id), letter, state.wall, state.scatterSeen);
  state.markers = [...state.markers, ...fresh].filter((m) => state.wall - m.born < 3.3).slice(-12);
  for (const kind of new Set(fresh.map((m) => m.kind))) sound.play(kind); // 同じ種類は 1 フレームに 1 回だけ鳴らす
}

const letter = (id) => nameOf(id).split(' ').pop();

/** できごとの一覧（新しいものが上）。押すと、その時に戻る。一覧の内容が変わったときだけ作り直す（スクロール位置を保つため） */
function updateLog(t) {
  const seen = new Set(); // 同じペアの散乱は続けて起きるので、最初の 1 回だけ載せる
  const items = state.result.events.filter((e) => {
    if (e.t > t) return false;
    if (e.kind !== 'scatter') return true;
    const key = [...e.ids].sort((a, b) => a - b).join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();
  const key = `${state.result.input.seed}:${items.length}:${items[0]?.t ?? 0}`;
  if (key === state.logKey) return;
  state.logKey = key;
  $('eventlog').replaceChildren(...items.map((e) => eventButton(e)));
}

/** できごと 1 件の、押せる行（時刻つき） */
function eventButton(e) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'evbtn';
  const time = document.createElement('time');
  time.textContent = fmtTime(e.t);
  b.append(time, eventText(e, nameOf));
  b.setAttribute('aria-label', `${fmtTime(e.t)}のできごとに戻る: ${eventText(e, nameOf)}`);
  b.addEventListener('click', () => jumpToEvent(e));
  li.append(b);
  return li;
}

/** できごとの少し前に戻って、そこから再生する（起きる瞬間を、スローで見られる） */
function jumpToEvent(e) {
  const r = state.result;
  const f = Math.max(0, frameOfTime(r, e.t) - 3);
  state.f = f;
  state.prevF = f;
  state.lastT = frameState(r, f).t;
  state.finished = false;
  state.playing = true;
  state.introT = INTRO_SECONDS;
  state.markers = [];
  state.scatterSeen = new Set();
  state.selectedId = null;
  state.logKey = ''; // 一覧は「いまの時刻まで」なので、作り直す
  updatePlayButton();
  $('viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 軌道上にいる惑星を、系統ごとに数えて凡例に出す（0 個の系統は薄く） */
function updatePlanetLegend(fs) {
  const counts = new Map();
  for (const p of fs.planets) {
    const k = planetKey(describePlanet(p, state.result.input.star));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const row of legendRows) {
    const n = counts.get(row.key) ?? 0;
    row.cnt.textContent = n ? `${n}` : '';
    row.li.className = n ? '' : 'off';
  }
}

const legendRows = [];
function buildPlanetLegend() {
  const items = PLANET_LEGEND.map((e) => {
    const col = planetColor(e.cls, e.teq);
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = col.fill;
    if (col.glow) dot.style.boxShadow = `0 0 6px 2px ${col.glow}`;
    const txt = document.createElement('div');
    const name = textEl('span', e.key, 'name');
    const desc = textEl('span', e.desc, 'desc');
    desc.style.display = 'block';
    txt.append(name, desc);
    const cnt = textEl('span', '', 'cnt');
    li.append(dot, txt, cnt);
    legendRows.push({ key: e.key, li, cnt });
    return li;
  });
  $('planet-legend').replaceChildren(...items);
}

function updatePlayButton() {
  $('btn-play').textContent = state.playing ? '一時停止' : '再開';
}

/** 惑星の情報カードを、その惑星のすぐ横（軌道図の上）に出す。停止中だけ表示する */
function showPop(fs) {
  const pop = $('pop');
  const p = fs.planets.find((q) => q.id === state.selectedId);
  const hit = state.view.hitOf(state.selectedId);
  if (!p || !hit) {
    pop.replaceChildren(textEl('p', `${nameOf(state.selectedId)} はこの時点では存在しません。`));
    pop.hidden = false;
    return;
  }
  const key = `${p.id}:${fs.index}`;
  if (state.popKey !== key) {
    state.popKey = key;
    const d = describePlanet(p, state.result.input.star);
    const sprite = document.createElement('canvas');
    sprite.className = 'sprite';
    const dpr = window.devicePixelRatio || 1;
    sprite.width = 56 * dpr; sprite.height = 56 * dpr;
    const sc = sprite.getContext('2d');
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlanetSprite(sc, 28, 28, 22, d, state.result.input.seed, p.id);
    const close = textEl('button', '×', 'close');
    close.type = 'button';
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', () => { state.selectedId = null; });
    const nodes = planetCardNodes(p, nameOf(p.id), state.result.input.star);
    pop.replaceChildren(close, sprite, ...nodes);
  }
  pop.hidden = false;
  // 惑星の右隣に置き、はみ出すなら左隣に置く。図の中に収める
  const wrap = $('canvas-wrap');
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = hit.x + 16;
  if (x + w > wrap.clientWidth - 4) x = hit.x - 16 - w;
  x = Math.max(4, Math.min(wrap.clientWidth - w - 4, x));
  const y = Math.max(4, Math.min(wrap.clientHeight - h - 4, hit.y - h / 2));
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
}

function hidePop() { const p = $('pop'); if (p) p.hidden = true; }

// ---------- 結果 ----------
function showResult() {
  const r = state.result;
  const input = r.input;
  $('res-title').textContent = `${systemName(input.seed)} 系`;
  $('res-sub').textContent =
    `恒星の重さ 太陽の${input.star.mass.toFixed(2)}倍・金属量 ${input.star.Z.toFixed(2)}（太陽 = 1）・円盤の重さ 太陽の${input.disk.mass.toFixed(3)}倍・シード ${input.seed}`;
  const rar = rarityOfSystem(r.final, input.star);
  $('res-rarity').textContent = `希少度 ${rar.stars} ${rar.label}` + (rar.reason.label ? `（決め手: ${rar.reason.label}）` : '');
  $('res-rarity').className = `rarity t${rar.tier}`;
  $('res-simple').replaceChildren(...explainSimple(r, nameOf).map((x) => textEl('li', x)));
  $('res-reasons').replaceChildren(...explainResult(r, nameOf).map((x) => textEl('li', x)));
  $('res-timeline').replaceChildren(...r.events.filter((e) => e.kind !== 'scatter').slice(0, 40).map((e) => eventButton(e)));
  const finals = [...r.final].sort((a, b) => a.a - b.a);
  const records = new Map(buildPlanetRecords(r, nameOf).map((rec) => [rec.planet.id, rec]));
  $('res-planets').replaceChildren(...finals.map((p) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.append(...planetCardNodes(p, nameOf(p.id), input.star));
    const rec = records.get(p.id);
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const sh = textEl('button', '共有');
    sh.type = 'button';
    sh.addEventListener('click', () => sharePlanet(rec));
    actions.append(sh);
    c.append(actions);
    return c;
  }));
  autoRegister(); // 完成したら、図鑑に自動で登録する
  $('result').hidden = false;
}

// ---------- 図鑑への登録・共有 ----------
const safeStorage = () => { try { const st = globalThis.localStorage; st.getItem('planet_create_probe'); return st; } catch { return null; } };
const store = createStore(safeStorage());
let dexUi = null;
let shareUi = null;
let introUi = null;

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function refreshBadge() {
  const n = store.planets().length + store.systems().length;
  $('dex-badge').textContent = n ? String(n) : '';
}

/**
 * 完成した惑星系と、その惑星を、図鑑に自動で登録する（同じ条件は 1 度だけ。何度呼ばれても増えない）。
 * 新しく登録されたときだけ知らせる。
 */
function autoRegister() {
  const r = state.result;
  if (!r) return;
  const before = store.grid().done;
  const first = store.systems().length === 0 && store.planets().length === 0;
  const sres = store.addSystem(buildSystemRecord(r, systemName(r.input.seed)));
  if (!sres.ok) { toast(sres.error); $('res-reg').textContent = '図鑑に登録できませんでした。'; return; }
  let added = 0;
  for (const rec of buildPlanetRecords(r, nameOf)) {
    const pr = store.addPlanet(rec);
    if (!pr.ok) { toast(pr.error); $('res-reg').textContent = '図鑑に登録できませんでした。'; return; }
    if (pr.added) added++;
  }
  $('res-reg').textContent = '図鑑に登録されています（惑星系と、できた惑星すべて）。';
  if (sres.added || added) {
    const parts = [];
    if (sres.added) parts.push('惑星系 1 件');
    if (added) parts.push(`惑星 ${added} 個`);
    const after = store.grid().done;
    toast(`図鑑に登録しました（${parts.join('・')}）` + (after > before ? `。図鑑のマスが ${after - before} つ埋まりました！` : '。') +
      (sres.dropped ? `（保存の上限のため、古い惑星系 ${sres.dropped} 件を入れ替えました）` : '') +
      (first ? ' 上の「図鑑」で、集めた惑星と惑星系を見られます。' : ''));
    refreshBadge();
    if (!$('dex').hidden) dexUi.render();
  }
}

const shareLink = (input) => (isPublicUrl(globalThis.location) ? buildShareUrl(globalThis.location.origin + globalThis.location.pathname, input) : '');

function shareSystem(rec) {
  const rarity = rarityOfSystem(rec.final, rec.input.star);
  const url = shareLink(rec.input);
  shareUi.open({
    draw: (ctx) => drawSystemCard(ctx, { name: rec.name, input: rec.input, final: rec.final, rarity }),
    text: systemShareText({ name: rec.name, nPlanets: rec.final.length, rarity, seed: rec.input.seed }, !!url),
    url, filename: `wakusei-system-${rec.input.seed}`,
  });
}

function sharePlanet(rec) {
  const rarity = rarityOfPlanet(rec.planet, rec.star);
  const sys = store.systems().find((x) => x.id === rec.systemId)?.input ?? (state.result && buildSystemRecord(state.result, '').id === rec.systemId ? state.result.input : null);
  const url = sys ? shareLink(sys) : '';
  shareUi.open({
    draw: (ctx) => drawPlanetCard(ctx, { name: rec.name, planet: rec.planet, star: rec.star, rarity, seed: rec.seed }),
    text: planetShareText({ name: rec.name, cls: rec.cls, tags: rec.tags, tier: rarity.tier }, !!url, rec.seed),
    url, filename: `wakusei-planet-${rec.seed}-${rec.planet.id}`,
  });
}

/** 図鑑の惑星系を、もう一度見る（条件から再計算する。モデルが更新されていれば、結果が少し変わることを知らせる） */
function replayFromDex(input) {
  showView('make');
  fillForm(input);
  setRandomMode(false);
  for (const b of $('presets').children) b.setAttribute('aria-pressed', 'false');
  $('preset-note').textContent = '図鑑から再生しています。';
  if (!modelMatches(input)) toast('この惑星系は古いバージョンで作られたため、結果が少し変わる場合があります。');
  sound.unlock();
  try { start(readForm()); } catch (e) { $('err').textContent = e.message; }
}

function showView(v) {
  $('view-make').hidden = v !== 'make';
  $('dex').hidden = v !== 'dex';
  $('tab-make').setAttribute('aria-pressed', String(v === 'make'));
  $('tab-dex').setAttribute('aria-pressed', String(v === 'dex'));
  if (v === 'dex') {
    if (state.playing) { state.playing = false; updatePlayButton(); } // 図鑑を見ている間は、再生を止めておく
    dexUi.render();
  } else {
    state.view?.resize();
    redrawPreview(); // 図鑑を見ている間は大きさが 0 だったので、描き直す
  }
}

/** 共有リンク(#s=...)で開かれたら、その条件をフォームに入れる */
function loadSharedFromHash() {
  const res = parseShareHash(globalThis.location?.hash);
  if (!res) return;
  const banner = $('share-note-banner');
  banner.hidden = false;
  if (!res.ok) { banner.textContent = res.error; return; }
  fillForm(res.input);
  setRandomMode(false);
  for (const b of $('presets').children) b.setAttribute('aria-pressed', 'false');
  $('preset-note').textContent = '共有された条件です。';
  banner.textContent = '共有された惑星系の条件を読み込みました。「惑星系をつくる」を押すと、同じ惑星系が再現されます。' +
    (modelMatches(res.input) ? '' : '（作られたときと計算のバージョンが違うため、結果が少し変わる場合があります）');
  try { globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search); } catch { /* 無視 */ }
}

const hintRefreshers = []; // fillForm のあとに、目安の注意表示を更新する
function refreshHints() { for (const fn of hintRefreshers) fn(); }

function buildFieldGuide() {
  for (const f of FIELDS) {
    const hint = $(`h-${f.id}`);
    const input = $(f.id);
    const base = [typicalText(f), f.hint].filter(Boolean).join('。 ').replace(/。。/g, '。');
    hint.textContent = base;
    const refresh = () => {
      const warn = input.value === '' ? '' : rangeWarning(f, Number(input.value));
      hint.textContent = warn ? `${warn} ${f.hint}` : base;
      hint.className = warn ? 'hint-f warn' : 'hint-f';
      input.className = warn ? 'warn' : '';
    };
    hintRefreshers.push(refresh);
    input.addEventListener('input', () => { refresh(); setRandomMode(false); redrawPreview(); }); // 自分で値を変えたら、ランダムは止める。初期の円盤を描き直す
  }
}

function buildLegend() {
  $('legend').replaceChildren(...Object.values(MARKER_STYLE).map((st) => {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.style.borderColor = `rgb(${st.color})`;
    li.append(dot, `${st.label}: ${st.legend}`);
    return li;
  }));
}

function initSlowSetting() {
  try { const v = Number(localStorage.getItem('planet_create_slow')); if ([1, 0.12, 0.06].includes(v)) state.slowLevel = v; } catch { /* 保存できない環境では既定のまま */ }
  const buttons = document.querySelectorAll('[data-slow]');
  const mark = () => { for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.slow) === state.slowLevel)); };
  mark();
  for (const b of buttons) {
    b.addEventListener('click', () => {
      state.slowLevel = Number(b.dataset.slow);
      try { localStorage.setItem('planet_create_slow', String(state.slowLevel)); } catch { /* 無視 */ }
      mark();
    });
  }
}

/** いまのフォームの条件（恒星・円盤）。まだ入力の途中などで不正なら null */
function formConditions() {
  const n = (id) => Number($(id).value);
  const v = { star: { mass: n('f-mstar'), luminosity: n('f-lum'), Z: n('f-z') }, disk: { mass: n('f-dmass'), rIn: n('f-rin'), rOut: n('f-rout'), tLife: n('f-tlife') * 1e6, p: n('f-p'), structures: state.structures } };
  const ok = [v.star.mass, v.star.luminosity, v.star.Z, v.disk.mass, v.disk.rIn, v.disk.rOut, v.disk.tLife, v.disk.p].every(Number.isFinite)
    && ['f-mstar', 'f-lum', 'f-z', 'f-dmass', 'f-rin', 'f-rout', 'f-tlife', 'f-p'].every((id) => $(id).value !== '')
    && v.star.luminosity > 0 && v.disk.rIn > 0 && v.disk.rOut > v.disk.rIn * 2 && v.disk.mass > 0;
  return ok ? v : null;
}

/** 設定の画面の「初期の円盤」を描き直す（条件を引き直す・値を変えるたびに呼ぶ） */
function redrawPreview() {
  const canvas = $('diskpreview');
  const cond = formConditions();
  const s = Math.max(120, Math.floor(canvas.clientWidth || 300));
  const dpr = globalThis.window?.devicePixelRatio || 1;
  canvas.width = Math.floor(s * dpr);
  canvas.height = Math.floor(s * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
  const seedNum = Number($('f-seed').value);
  const seeds = cond && Number.isInteger(seedNum) ? plannedSeeds(cond, seedNum) : [];
  drawDiskPreview(ctx, s, cond, seeds, seedNum);
  const total = cond ? solidTotal(cond) : null;
  $('diskpreview-note').textContent = total === null ? '条件を確かめてください。'
    : `惑星の種: ${seeds.length} 個。円盤の固体の総量: ${fmtMass(total)}。スノーライン: ${fmtPos(snowline(cond.star.luminosity))}。`;
}

function init() {
  dexUi = createDexUi({ $, store, onReplay: replayFromDex, onShareSystem: shareSystem, onSharePlanet: sharePlanet });
  shareUi = createShareUi({ $, toast });
  introUi = createIntroUi({ $, storage: safeStorage() });
  $('btn-howto').addEventListener('click', () => introUi.open());
  $('tab-make').addEventListener('click', () => showView('make'));
  $('tab-dex').addEventListener('click', () => showView('dex'));
  $('btn-share-system').addEventListener('click', () => {
    const r = state.result;
    if (r) shareSystem({ name: systemName(r.input.seed), input: r.input, final: r.final });
  });
  refreshBadge();
  // 開いた詳細設定・凡例は、いちばん下のボタンで閉じられる（閉じたら、見出しの位置に戻る）
  for (const [btn, box] of [['close-advanced', 'advanced'], ['close-planet-legend', 'planet-legend-box'], ['close-legend', 'legend-box']]) {
    $(btn).addEventListener('click', () => { $(box).open = false; $(box).scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); });
  }
  $('foot-version').textContent = MODEL_VERSION;
  window.addEventListener('resize', () => redrawPreview());
  buildFieldGuide();
  buildLegend();
  buildPlanetLegend();
  initSlowSetting();
  $('opt-hz').checked = true; // 既定はオン。オフにした設定だけを記憶する
  try { if (localStorage.getItem('planet_create_hz') === '0') $('opt-hz').checked = false; } catch { /* 保存できない環境では、既定のオン */ }
  $('opt-hz').addEventListener('change', () => {
    try { localStorage.setItem('planet_create_hz', $('opt-hz').checked ? '1' : '0'); } catch { /* 無視 */ }
  });
  buildPresets();
  applyRandom(); // 起動時の既定はランダム設定
  const fromShare = !!parseShareHash(globalThis.location?.hash);
  loadSharedFromHash(); // 共有リンクで開かれたら、その条件にする
  if (!fromShare && introUi.shouldAutoOpen()) introUi.open(); // 初めての人には、案内を出す（共有リンクから来た人には出さない。「遊び方」でいつでも見られる）
  initSound();

  $('btn-random').addEventListener('click', applyRandom);
  $('btn-run').addEventListener('click', () => {
    sound.unlock();
    if (state.randomMode && !state.rollFresh) applyRandom(); // 使ったあとの条件なら、新しく引き直す（見えている新しい条件は、そのままつくる）
    try { start(readForm()); } catch (e) { $('err').textContent = e.message; $('advanced').open = true; }
  });
  $('opt-random').addEventListener('change', () => { if ($('opt-random').checked) applyRandom(); else setRandomMode(false); });
  $('btn-play').addEventListener('click', () => {
    if (!state.result) return;
    state.playing = !state.playing;
    sound.unlock();
    updatePlayButton();
  });
  $('btn-replay').addEventListener('click', () => {
    if (!state.result) return;
    state.f = 0; state.finished = false; state.playing = true; state.markers = []; state.lastT = 0; state.prevF = 0; state.scatterSeen = new Set(); state.logKey = ''; state.introT = 0;
    updatePlayButton();
  });
  $('btn-skip').addEventListener('click', () => {
    if (!state.result) return;
    state.f = state.result.snapshots.length - 1; state.finished = true; state.slow = false; state.introT = INTRO_SECONDS;
    updatePlayButton(); showResult();
  });
  for (const b of document.querySelectorAll('[data-speed]')) {
    b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed);
      for (const o of document.querySelectorAll('[data-speed]')) o.setAttribute('aria-pressed', String(o === b));
    });
  }
  $('seek').addEventListener('input', () => {
    state.f = Number($('seek').value);
    state.introT = INTRO_SECONDS; // 時間バーを動かしたら、冒頭の演出は終える
    state.scatterSeen = new Set();
    state.finished = state.f >= state.result.snapshots.length - 1;
    if (state.finished) showResult();
  });
  $('canvas').addEventListener('pointerup', (e) => {
    if (!state.view) return;
    const rect = $('canvas').getBoundingClientRect();
    const id = state.view.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (id !== null) {
      state.selectedId = id;
      state.popKey = '';
      if (state.playing) { state.playing = false; updatePlayButton(); } // 動いている間は触れないので、タップで止める
    } else {
      state.selectedId = null;
    }
  });
  $('btn-detail').addEventListener('click', () => {
    const open = $('res-detail').hidden;
    $('res-detail').hidden = !open;
    $('btn-detail').setAttribute('aria-expanded', String(open));
    $('btn-detail').textContent = open ? '閉じる' : 'くわしく見る';
  });
  $('btn-again').addEventListener('click', () => {
    if (state.randomMode) { if (!state.rollFresh) applyRandom(); } else $('f-seed').value = newSeed();
    try { start(readForm()); } catch (e) { $('err').textContent = e.message; }
  });
  $('btn-back').addEventListener('click', () => $('setup').scrollIntoView({ behavior: 'smooth' }));
  window.addEventListener('resize', () => state.view?.resize());
  if (window.ResizeObserver) new ResizeObserver(() => state.view?.resize()).observe($('canvas-wrap'));
}

init();
