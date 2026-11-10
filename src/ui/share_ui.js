// 共有ダイアログ: 画像のプレビュー、X への投稿、端末の共有機能、画像の保存、文とリンクのコピー。
import { xIntentUrl } from '../dex/share.js';
import { CARD_W, CARD_H } from './shareimg.js';

/**
 * @param {{ $: (id: string) => any, toast: (msg: string) => void, env?: any }} deps
 */
export function createShareUi({ $, toast, env = globalThis }) {
  let current = null;

  const toBlob = () => new Promise((resolve) => $('share-canvas').toBlob((b) => resolve(b), 'image/png'));
  const fullText = () => $('share-text').value + (current?.url ? `\n${current.url}` : '');

  async function nativeShare() {
    const nav = env.navigator;
    if (!nav?.share) return;
    const data = { text: $('share-text').value };
    if (current.url) data.url = current.url;
    try {
      const blob = await toBlob();
      if (blob && typeof env.File === 'function') {
        const file = new env.File([blob], `${current.filename}.png`, { type: 'image/png' });
        if (nav.canShare?.({ files: [file] })) data.files = [file];
      }
      await nav.share(data);
    } catch (e) {
      if (e?.name !== 'AbortError') toast('共有できませんでした。「画像を保存」や「コピー」を使ってください。');
    }
  }

  async function saveImage() {
    const blob = await toBlob();
    if (!blob) { toast('画像を作れませんでした。'); return; }
    const url = env.URL.createObjectURL(blob);
    const a = env.document.createElement('a');
    a.href = url; a.download = `${current.filename}.png`;
    a.click();
    setTimeout(() => env.URL.revokeObjectURL(url), 1000);
  }

  async function copyText() {
    try {
      await env.navigator.clipboard.writeText(fullText());
      toast('コピーしました。');
    } catch {
      toast('コピーできませんでした。投稿する文を長押しして、コピーしてください。');
    }
  }

  function close() { $('share-dialog').hidden = true; current = null; }

  $('share-x').addEventListener('click', () => { if (current) env.open?.(xIntentUrl($('share-text').value, current.url), '_blank', 'noopener'); });
  $('share-native').addEventListener('click', () => { if (current) nativeShare(); });
  $('share-save').addEventListener('click', () => { if (current) saveImage(); });
  $('share-copy').addEventListener('click', () => { if (current) copyText(); });
  $('share-close').addEventListener('click', close);
  $('share-dialog').addEventListener('click', (e) => { if (e.target === $('share-dialog')) close(); }); // 外側を押したら閉じる
  env.document?.addEventListener?.('keydown', (e) => { if (e.key === 'Escape' && current) close(); });

  return {
    /** @param {{ draw: (ctx: any) => void, text: string, url: string, filename: string }} spec */
    open(spec) {
      current = spec;
      const c = $('share-canvas');
      c.width = CARD_W; c.height = CARD_H;
      spec.draw(c.getContext('2d'));
      $('share-text').value = spec.text;
      $('share-note').textContent = spec.url ? 'リンクを開くと、同じ条件の惑星系を再現できます。' : 'このページのアドレスは他の人が開けないため、リンクは付けず、シードを文に入れています（公開した場所で開くと、リンクも付きます）。';
      $('share-native').hidden = !env.navigator?.share;
      $('share-dialog').hidden = false;
    },
    close,
    get isOpen() { return current !== null; },
  };
}
