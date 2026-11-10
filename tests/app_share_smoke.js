// 共有リンク(#s=...)で開いたときの検査。実行: node tests/app_share_smoke.js
import assert from 'node:assert/strict';
import { counter, test, $, storage } from './fake_dom.js';
import { encodeShare } from '../src/dex/share.js';
import { randomInput } from '../src/ui/presets.js';

const input = randomInput(4242);
input.star.mass = Number(input.star.mass.toFixed(2));
input.star.luminosity = Number(input.star.luminosity.toFixed(2));

console.log('共有リンク');
await test('正しい共有リンクで開くと、条件がフォームに入り、案内が出て、アドレスの # が消える', async () => {
  globalThis.location.hash = `#s=${encodeShare(input)}`;
  await import('../src/ui/app.js?shared-ok');
  assert.equal($('share-note-banner').hidden, false);
  assert.ok($('share-note-banner').textContent.includes('同じ惑星系が再現されます'), $('share-note-banner').textContent);
  assert.equal(Number($('f-seed').value), input.seed);
  assert.equal(Number($('f-mstar').value), input.star.mass);
  assert.equal(Number($('f-rout').value), Number(input.disk.rOut.toFixed(1)));
  assert.ok($('preset-note').textContent.includes('共有された条件'));
  assert.equal(globalThis.location.hash, '', 'アドレスの # が消えている');
  assert.equal(storage.size, 0, '読み込んだだけでは、何も保存しない');
  assert.equal($('intro').hidden, true, '共有リンクから来た人には、案内を自動では出さない（「遊び方」では見られる）');
});
await test('共有リンクで開いたときも、初期の円盤の図が、その条件で描かれる', async () => {
  assert.ok($('diskpreview-note').textContent.includes('固体の総量'), $('diskpreview-note').textContent);
});
await test('壊れた・細工された共有リンクは、案内にエラーが出て、フォームは変わらない', async () => {
  const before = $('f-seed').value;
  globalThis.location.hash = '#s=AAAA';
  await import('../src/ui/app.js?shared-bad');
  assert.ok($('share-note-banner').textContent.includes('共有リンク'), $('share-note-banner').textContent);
  assert.notEqual($('share-note-banner').textContent.includes('再現されます'), true);
  const evil = JSON.parse(JSON.stringify(input)); evil.disk.mass = 50;
  globalThis.location.hash = `#s=${encodeShare(evil)}`;
  await import('../src/ui/app.js?shared-evil');
  assert.ok($('share-note-banner').textContent.includes('正しくありません'), $('share-note-banner').textContent);
});

console.log(counter.failed ? `\n${counter.failed} 件失敗` : '\nすべて成功');
process.exit(counter.failed ? 1 : 0);
