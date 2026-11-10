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

  /**
   * 画像を保存する。保存先を選べる環境（パソコンの Chrome / Edge）では、保存の画面を開く。
   * 使えない環境・キャンセル以外の失敗では、ダウンロード（ダウンロードのフォルダ）にする。
   */
  async function saveImage() {
    const name = `${current.filename}.png`;
    if (typeof env.showSaveFilePicker === 'function') {
      try {
        // ボタンを押した直後に開く（ブラウザは、ユーザーの操作の直後でないと、保存の画面を開かせない）
        const handle = await env.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PNG 画像', accept: { 'image/png': ['.png'] } }] });
        const blob = await toBlob();
        if (!blob) { toast('画像を作れませんでした。'); return; }
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        toast('保存しました。');
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // 保存の画面を、自分で閉じた
        // それ以外（対応していない・許可されない）は、ダウンロードにする
      }
    }
    const blob = await toBlob();
    if (!blob) { toast('画像を作れませんでした。'); return; }
    const url = env.URL.createObjectURL(blob);
    const a = env.document.createElement('a');
    a.href = url; a.download = name;
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
      // 普通の画像としても見せる: パソコンでは右クリック「名前を付けて画像を保存」、スマホでは長押しで、保存先を選んで保存できる（canvas では、これができない）
      const img = $('share-img');
      if (img && c.toDataURL) { img.src = c.toDataURL('image/png'); img.hidden = false; c.hidden = true; }
      $('share-text').value = spec.text;
      const attach = '画像を投稿に付けるには、「画像を保存」して、投稿に添付してください（スマホで「ほかのアプリで共有」が出るときは、画像と文がまとめて渡されます）。リンクを貼ったときのカードには、ゲームの共通の画像が出ます。';
      $('share-note').textContent = (spec.url ? 'リンクを開くと、同じ条件の惑星系を再現できます。' : 'このページのアドレスは他の人が開けないため、リンクは付けず、シードを文に入れています（公開した場所で開くと、リンクも付きます）。') + attach;
      // 画像の保存のしかた: 指で操作する画面（スマホ・タブレット）では「長押し」、パソコンでは「右クリック」
      const touch = !!env.matchMedia?.('(pointer: coarse)')?.matches;
      $('share-hint').textContent = touch
        ? '画像を長押しすると、「写真に追加」や「画像を保存」などの保存メニューが出ます。（機種によって、表示は少し違います）'
        : '画像を右クリックして、「名前を付けて画像を保存」を選ぶと、保存先を選べます。';
      $('share-native').hidden = !env.navigator?.share;
      $('share-dialog').hidden = false;
    },
    close,
    get isOpen() { return current !== null; },
  };
}
