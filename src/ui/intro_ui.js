// 初めて遊ぶ人への案内（はじめに）。初回の起動時に自動で開き、あとから「遊び方」で開き直せる。
import { INTRO_SLIDES, INTRO_TERMS, INTRO_SAMPLE } from './intro_slides.js';
import { textEl } from './cards.js';
import { runSimulation } from '../sim/sim.js';
import { presetInput } from './presets.js';
import { planetNames, systemName } from './naming.js';
import { rarityOfSystem, rarityOfPlanet } from '../dex/rarity.js';
import { drawSystemOrbit, drawSystemCard, drawPlanetCard, CARD_W, CARD_H } from './shareimg.js';

export const SEEN_KEY = 'planet_create_intro_seen';

/**
 * @param {{ $: (id: string) => any, storage: Pick<Storage,'getItem'|'setItem'>|null, env?: any }} deps
 */
export function createIntroUi({ $, storage, env = globalThis }) {
  let step = 0;
  let sample = null;
  let isOpen = false;

  /** 絵に使う見本の惑星系（初めて必要になったときに、1 度だけ計算する） */
  const getSample = () => {
    if (!sample) {
      const result = runSimulation(presetInput(INTRO_SAMPLE.preset, INTRO_SAMPLE.seed));
      const names = planetNames(result);
      const rarest = result.final
        .map((p) => ({ p, r: rarityOfPlanet(p, result.input.star) }))
        .sort((a, b) => b.r.tier - a.r.tier)[0];
      sample = { result, names, rarest, name: systemName(result.input.seed), rarity: rarityOfSystem(result.final, result.input.star) };
    }
    return sample;
  };

  const canvas = (w, h, cls, draw) => {
    const c = document.createElement('canvas');
    c.className = cls;
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    return c;
  };

  function art(kind) {
    if (kind === 'none') return [];
    if (kind === 'terms') {
      const dl = document.createElement('dl');
      dl.className = 'terms';
      for (const [k, v] of INTRO_TERMS) { const w = document.createElement('div'); w.append(textEl('dt', k), textEl('dd', v)); dl.append(w); }
      return [dl];
    }
    const s = getSample();
    if (kind === 'orbit') return [canvas(480, 480, 'intro-orbit', (ctx) => drawSystemOrbit(ctx, 240, 240, 228, s.result.input, s.result.final))];
    if (kind === 'planet') {
      const p = s.rarest.p;
      return [canvas(CARD_W, CARD_H, 'intro-card', (ctx) => drawPlanetCard(ctx, { name: s.names.get(p.id), planet: p, star: s.result.input.star, rarity: s.rarest.r, seed: s.result.input.seed }))];
    }
    return [canvas(CARD_W, CARD_H, 'intro-card', (ctx) => drawSystemCard(ctx, { name: s.name, input: s.result.input, final: s.result.final, rarity: s.rarity }))];
  }

  function render() {
    const n = INTRO_SLIDES.length;
    const slide = INTRO_SLIDES[step];
    $('intro-step').textContent = `${step + 1} / ${n}`;
    $('intro-title').textContent = slide.title;
    $('intro-art').replaceChildren(...art(slide.art));
    $('intro-body').replaceChildren(...slide.body.map((t) => textEl('p', t)));
    $('intro-dots').replaceChildren(...INTRO_SLIDES.map((_, i) => { const d = textEl('span', '', i === step ? 'dot on' : 'dot'); return d; }));
    $('intro-prev').disabled = step === 0;
    $('intro-next').textContent = step === n - 1 ? 'はじめる' : '次へ';
    $('intro-skip').textContent = step === n - 1 ? '閉じる' : 'スキップ';
  }

  function markSeen() { try { storage?.setItem(SEEN_KEY, '1'); } catch { /* 保存できない環境では、毎回開くだけ */ } }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    $('intro').hidden = true;
    markSeen();
  }

  function open(at = 0) {
    step = at;
    isOpen = true;
    $('intro').hidden = false;
    render();
    $('intro-next').focus?.();
  }

  const next = () => { if (step >= INTRO_SLIDES.length - 1) close(); else { step++; render(); } };
  const prev = () => { if (step > 0) { step--; render(); } };

  $('intro-next').addEventListener('click', next);
  $('intro-prev').addEventListener('click', prev);
  $('intro-skip').addEventListener('click', close);
  $('intro').addEventListener('click', (e) => { if (e.target === $('intro')) close(); }); // 外側を押したら閉じる
  env.document?.addEventListener?.('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Tab') { // 案内の中だけで、Tab を回す
      const items = ['intro-prev', 'intro-next', 'intro-skip'].map($).filter((b) => !b.disabled);
      const i = items.indexOf(env.document.activeElement);
      e.preventDefault?.();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus?.();
    }
  });

  return {
    open,
    close,
    get isOpen() { return isOpen; },
    /** 初めて開いた人にだけ、自動で出す */
    shouldAutoOpen() { try { return storage?.getItem(SEEN_KEY) !== '1'; } catch { return true; } },
    get step() { return step; },
  };
}
