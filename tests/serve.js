// 手元用のサーバー(harness/serve.py)の検査: キャッシュを使わせず、JS などの種類が正しいこと。実行: node tests/serve.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn('python3', [join(ROOT, 'harness', 'serve.py'), String(PORT)], { stdio: 'ignore' });
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const get = async (p) => { for (let i = 0; i < 50; i++) { try { return await fetch(`http://127.0.0.1:${PORT}/${p}`); } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('サーバーに繋がらない'); };

console.log('手元用のサーバー');
await test('すべての応答が Cache-Control: no-store で、ファイルの種類が正しい', async () => {
  for (const [path, type] of [['index.html', 'text/html'], ['src/ui/app.js', 'text/javascript'], ['src/ui/shareimg.js', 'text/javascript'], ['css/style.css', 'text/css'], ['manifest.webmanifest', 'application/manifest+json'], ['icon.svg', 'image/svg+xml'], ['og-image.png', 'image/png']]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('cache-control'), 'no-store', `${path}: キャッシュを使わせていない`);
    assert.ok((r.headers.get('content-type') ?? '').startsWith(type), `${path}: ${r.headers.get('content-type')}`);
    await r.arrayBuffer();
  }
  assert.equal((await get('存在しない.js')).status, 404);
});
await test('プロジェクトのフォルダの、いまの内容がそのまま返る', async () => {
  const a = await (await get('src/ui/shareimg.js')).text();
  assert.ok(a.includes('ハビタブルゾーン'), '共有画像のコードが返っている');
});
srv.kill();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
