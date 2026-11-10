// app.js を動かすための偽の DOM（ブラウザではないので、見た目や CSS は確認できない）。app_smoke.js と app_share_smoke.js が使う。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

// ---- 最小の DOM ----
export const calls = { drawn: 0, clear: 0, fillText: 0 };
const ctx = new Proxy({}, {
  get: (_, k) => {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 40 });
    if (k === 'clearRect') return () => { calls.clear++; };
    if (k === 'arc') return () => { calls.drawn++; };
    if (k === 'fillText') return () => { calls.fillText++; };
    return () => {};
  },
  set: () => true,
});
function makeEl(id) {
  const el = {
    id, hidden: false, value: '', textContent: '', className: '', style: {}, dataset: {}, children: [], attrs: {}, listeners: {},
    min: '0', max: '1e9', open: false, disabled: false, clientWidth: 400, clientHeight: 400, offsetWidth: 240, offsetHeight: 200,
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); },
    replaceChildren(...c) { this.children = c; },
    scrollIntoView() {},
    closest() { return { firstChild: { textContent: id } }; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 400 }; },
    getContext() { return ctx; },
    toDataURL() { return 'data:image/png;base64,AAAA'; },
    toBlob(cb) { cb({ size: 4, type: 'image/png' }); },
    click() { for (const f of this.listeners.click ?? []) f({}); },
  };
  return el;
}
export const els = new Map(ids.map((id) => [id, makeEl(id)]));
for (const m of html.matchAll(/<[a-z0-9]+\s[^>]*id="([^"]+)"[^>]*>/g)) if (/\shidden(\s|>|=)/.test(m[0])) els.get(m[1]).hidden = true; // HTML の hidden 属性
for (const id of ['f-mstar', 'f-lum', 'f-z', 'f-dmass', 'f-rin', 'f-rout', 'f-tlife', 'f-p', 'f-seed']) {
  const e = els.get(id);
  const label = html.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
  e.min = label.match(/min="([^"]+)"/)[1]; e.max = label.match(/max="([^"]+)"/)[1];
}
export const speedButtons = ['1', '2', '4'].map((s) => { const b = makeEl('speed' + s); b.dataset.speed = s; return b; });
export const slowButtons = ['1', '0.12', '0.06'].map((v) => { const b = makeEl('slow' + v); b.dataset.slow = v; return b; });
globalThis.document = {
  getElementById: (id) => { if (!els.has(id)) throw new Error(`index.html に id="${id}" が無い`); return els.get(id); },
  createElement: (tag) => makeEl(tag),
  querySelectorAll: (sel) => (sel === '[data-speed]' ? speedButtons : sel === '[data-slow]' ? slowButtons : []),
};
export const rafQueue = [];
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.requestAnimationFrame = (f) => { rafQueue.push(f); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => { rafQueue.length = 0; };
export const audio = { contexts: 0, oscillators: 0, started: 0, resumed: 0 };
globalThis.AudioContext = class {
  constructor() { audio.contexts++; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
  resume() { audio.resumed++; this.state = 'running'; }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  createOscillator() { audio.oscillators++; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() { audio.started++; }, stop() {} }; }
};
const storageMap = new Map();
globalThis.localStorage = { getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null), setItem: (k, v) => { storageMap.set(k, String(v)); }, removeItem: (k) => { storageMap.delete(k); } };
export const storage = storageMap;
export const opened = [];
globalThis.open = (url) => { opened.push(url); };
globalThis.location = { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8000', pathname: '/planet_create/', search: '', hash: '' };
globalThis.history = { replaceState(_s, _t, url) { globalThis.location.hash = ''; globalThis.__replaced = url; } };
globalThis.confirm = () => true;
globalThis.Worker = undefined; // メインスレッド実行の予備経路を使う
globalThis.ResizeObserver = undefined;
export const errors = [];
export const origErr = console.error; console.error = (...a) => { errors.push(a.join(' ')); };

export const counter = { failed: 0 };
export const test = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { counter.failed++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 3).join(' | ') ?? e.message}`); }
};
/** 再生ループを手動で n フレーム進める（1 フレーム 1/30 秒） */
let clock = 1000;
export const frames = (n, step = 33) => { for (let i = 0; i < n; i++) { const f = rafQueue.shift(); assert.ok(f, '再生ループが止まっている（requestAnimationFrame が予約されていない）'); clock += step; f(clock); } };
import { runSimulation } from '../src/sim/sim.js';
import { presetInput } from '../src/ui/presets.js';
export const lastResult = () => runSimulation(presetInput('standard', Number($('f-seed').value))); // 画面と同じ入力から再計算（同じ seed なら同じ結果）
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const $ = (id) => els.get(id);

