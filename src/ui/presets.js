// 入口: プリセットとランダム設定。ランダム設定は seed だけから決まる（同じ seed なら同じ条件）。
import { MODEL_VERSION, baselineInput } from '../sim/params.js';
import { createRng } from '../sim/rng.js';

/** @type {{ id: string, name: string, note: string, patch: (i: any) => void }[]} */
export const PRESETS = [
  { id: 'standard', name: '標準', note: '太陽と同じ恒星と標準的な円盤', patch: () => {} },
  {
    id: 'giants', name: '巨星の多い系', note: '金属量が高く、固体の多い円盤',
    patch: (i) => { i.star.Z = 2; },
  },
  {
    id: 'hotjup', name: 'ホットジュピター系', note: '金属量が高く重い円盤。巨星が内側へ移動しやすい',
    patch: (i) => { i.star.Z = 2; i.disk.mass = 0.07; },
  },
  {
    id: 'ice', name: '巨大氷惑星の多い系', note: '軽くて広い円盤。外側で氷の惑星が育つ',
    patch: (i) => { i.disk.mass = 0.02; i.disk.rOut = 50; },
  },
];

export function presetInput(id, seed) {
  const input = baselineInput(seed);
  (PRESETS.find((p) => p.id === id) ?? PRESETS[0]).patch(input);
  return input;
}

/** ランダム設定。主系列の光度 L ≈ M^3.5 は粗い近似。円盤の初期構造（リング/ギャップ）は 0〜2 個 */
export function randomInput(seed) {
  const rng = createRng(seed ^ 0x9e3779b9);
  const input = baselineInput(seed);
  const mass = rng.logUniform(0.6, 1.4);
  input.star = { mass, luminosity: Math.pow(mass, 3.5), Z: rng.logUniform(0.3, 2.5) };
  const rIn = rng.logUniform(0.03, 0.1);
  const rOut = rng.logUniform(25, 60);
  input.disk = {
    mass: rng.logUniform(0.01, 0.07), rIn, rOut,
    tLife: rng.logUniform(1.5e6, 6e6), p: rng.range(0.7, 1.3), structures: [],
  };
  const k = Math.floor(rng.next() * 3); // 0, 1, 2
  for (let i = 0; i < k; i++) {
    input.disk.structures.push({
      r: rng.logUniform(rIn * 4, rOut / 2), width: rng.range(0.1, 0.3), amp: rng.range(-0.8, 2),
    });
  }
  input.modelVersion = MODEL_VERSION;
  return input;
}

/** UI で使う乱数 seed（シミュレーション内部では使わない） */
export function newSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] % 1000000000;
}
