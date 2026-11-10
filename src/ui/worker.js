// シミュレーションを Web Worker で実行する（UI を止めない）。
import { runSimulation } from '../sim/sim.js';

self.onmessage = (e) => {
  try {
    postMessage({ ok: true, result: runSimulation(e.data.input) });
  } catch (err) {
    postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
