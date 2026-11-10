// できごとの効果音。音声ファイルは使わず、Web Audio で合成する（読み込みが要らず、容量も増えない）。
// ブラウザは、ユーザーの操作の前に音を出せない。unlock() をボタン操作の中で呼ぶ。

/** 音のしくみ: 1 つのできごとは、複数の音（音色・周波数の変化・長さ・音量）の重ね合わせ。純粋なデータなのでテストできる */
export const SOUND_SPECS = {
  merge: [ // ゴン: 低い音が沈む
    { type: 'sine', f0: 140, f1: 55, at: 0, dur: 0.5, gain: 0.5 },
    { type: 'triangle', f0: 280, f1: 110, at: 0, dur: 0.3, gain: 0.25 },
  ],
  eject: [ // ヒュン: 高い音から下がって遠ざかる
    { type: 'sine', f0: 1500, f1: 180, at: 0, dur: 0.7, gain: 0.3 },
    { type: 'triangle', f0: 750, f1: 90, at: 0.05, dur: 0.6, gain: 0.15 },
  ],
  gasRunaway: [ // ゴォー: 音が上がっていく
    { type: 'sine', f0: 220, f1: 880, at: 0, dur: 1.0, gain: 0.28 },
    { type: 'sine', f0: 330, f1: 1320, at: 0.1, dur: 0.9, gain: 0.14 },
  ],
  innerEdge: [ // ピピッ
    { type: 'square', f0: 880, f1: 880, at: 0, dur: 0.1, gain: 0.12 },
    { type: 'square', f0: 880, f1: 880, at: 0.16, dur: 0.1, gain: 0.12 },
  ],
  seed: [ // ポッ（小さく）
    { type: 'sine', f0: 520, f1: 880, at: 0, dur: 0.14, gain: 0.1 },
  ],
  scatter: [ // チッ（小さく）
    { type: 'sine', f0: 1320, f1: 1100, at: 0, dur: 0.1, gain: 0.12 },
  ],
  dispersal: [ // ふわっと広がる和音
    { type: 'sine', f0: 392, f1: 392, at: 0, dur: 1.6, gain: 0.12 },
    { type: 'sine', f0: 494, f1: 494, at: 0.05, dur: 1.6, gain: 0.12 },
    { type: 'sine', f0: 587, f1: 587, at: 0.1, dur: 1.6, gain: 0.12 },
  ],
};

export const MASTER_GAIN = 0.6; // 全体の音量（大きすぎないように）

/**
 * @param {{ AudioContext?: any }} [env] テスト用に差し替えられる
 */
export function createSound(env = globalThis) {
  let ctx = null;
  let master = null;
  let enabled = false;

  const Ctx = () => env.AudioContext ?? env.webkitAudioContext ?? null;
  const ensure = () => {
    if (ctx) return ctx;
    const C = Ctx();
    if (!C) return null;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  };

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    /** ユーザーの操作（ボタン）の中で呼ぶ。音を出せる状態にする */
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume?.();
      return !!c;
    },
    /** できごとの音を鳴らす。オフのとき、音の出せない環境のときは何もしない */
    play(kind) {
      if (!enabled) return false;
      const spec = SOUND_SPECS[kind];
      const c = ensure();
      if (!spec || !c) return false;
      const now = c.currentTime;
      for (const t of spec) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = t.type;
        const start = now + t.at;
        osc.frequency.setValueAtTime(t.f0, start);
        if (t.f1 !== t.f0) osc.frequency.exponentialRampToValueAtTime(t.f1, start + t.dur);
        // 急な立ち上がり・立ち下がりでプチッと鳴らないよう、短く上げて、指数的に下げる
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(t.gain, start + Math.min(0.03, t.dur / 4));
        g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
        osc.connect(g);
        g.connect(master);
        osc.start(start);
        osc.stop(start + t.dur + 0.05);
      }
      return true;
    },
  };
}
