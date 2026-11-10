// パラメータ掃引: node harness/sweep.js [n=40] key=v1,v2,... [key2=...]  (最初のキーで掃引、その他は固定値)
// 例: node harness/sweep.js 40 fGas=0.03,0.1 mGap=100   /  --scen base,Z2
import { runScenario, summarize, SCENARIOS } from './metrics.js';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);
const scenArg = args.find((a) => a.startsWith('--scen='));
const scen = scenArg ? scenArg.slice(7).split(',') : Object.keys(SCENARIOS);
const kv = args.filter((a) => a.includes('=') && !a.startsWith('--'));
const fixed = {};
let sweepKey = null, sweepVals = [null];
for (const a of kv) {
  const [k, v] = a.split('=');
  const vals = v.split(',').map(Number);
  if (vals.length > 1 && sweepKey === null) { sweepKey = k; sweepVals = vals; } else fixed[k] = vals[0];
}
for (const v of sweepVals) {
  const params = { ...fixed, ...(sweepKey ? { [sweepKey]: v } : {}) };
  console.log(`\n### ${JSON.stringify(params)}`);
  const rows = scen.map((s) => ({ sc: s, ...summarize(runScenario(SCENARIOS[s], n, 1, params)) }));
  console.table(rows);
}
