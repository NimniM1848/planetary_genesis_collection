// 図鑑の画面: 惑星図鑑（マス目の完成度・希少度ランキング）と、惑星系図鑑。
import { rarityOfPlanet, rarityOfSystem } from '../dex/rarity.js';
import { SYSTEM_PATTERNS, planetFeatures } from '../dex/features.js';
import { planetCardNodes, rarityEl, textEl } from './cards.js';
import { drawPlanetSprite, dotRadius } from './render.js';
import { drawSystemOrbit } from './shareimg.js';
import { fmtMass } from './units.js';

/**
 * @param {{ $: (id: string) => any, store: ReturnType<typeof import('../dex/store.js').createStore>,
 *   onReplay: (input: any) => void, onShareSystem: (rec: any) => void, onSharePlanet: (rec: any) => void,
 *   }} deps
 */
export function createDexUi({ $, store, onReplay, onShareSystem, onSharePlanet }) {
  const ui = { tab: 'planets', filter: null, sort: 'rarity', ssort: 'rarity' };

  const dpr = () => (globalThis.window?.devicePixelRatio) || 1;
  function canvasEl(size, cls, draw) {
    const c = document.createElement('canvas');
    c.className = cls;
    c.width = size * dpr(); c.height = size * dpr();
    const ctx = c.getContext('2d');
    ctx.setTransform?.(dpr(), 0, 0, dpr(), 0, 0);
    draw(ctx, size);
    return c;
  }
  const actionButton = (label, fn, cls = '') => { const b = textEl('button', label, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const dateText = (t) => { try { return new Date(t).toLocaleDateString('ja-JP'); } catch { return ''; } };

  function renderGrid() {
    const g = store.grid();
    $('dex-progress').textContent = `図鑑の完成度: ${g.done} / ${g.total} マス（${g.total ? Math.round((100 * g.done) / g.total) : 0}%）`;
    const head = document.createElement('tr');
    head.append(textEl('th', ''));
    for (const c of g.cols) head.append(textEl('th', c));
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const row of g.rows) {
      const tr = document.createElement('tr');
      tr.append(textEl('th', row.cls));
      for (const cell of row.cells) {
        const td = document.createElement('td');
        const b = textEl('button', cell.filled ? String(cell.count) : cell.possible ? '・' : '—', 'cell');
        b.type = 'button';
        if (cell.filled) {
          b.className = 'cell on';
          b.setAttribute('aria-label', `${row.cls}・${cell.tag}: ${cell.count} 個`);
          const sel = ui.filter && ui.filter.cls === row.cls && ui.filter.tag === cell.tag;
          if (sel) b.className += ' sel';
          b.addEventListener('click', () => { ui.filter = sel ? null : { cls: row.cls, tag: cell.tag }; render(); });
        } else {
          b.className = `cell ${cell.possible ? '' : 'no'}`;
          b.disabled = true;
          b.setAttribute('aria-label', `${row.cls}・${cell.tag}: ${cell.possible ? 'まだ' : '見つかっていない組み合わせ'}`);
        }
        td.append(b);
        tr.append(td);
      }
      tbody.append(tr);
    }
    $('dex-grid').replaceChildren(thead, tbody);
  }

  function renderPlanets() {
    renderGrid();
    let list = store.planets().map((rec) => ({ rec, r: rarityOfPlanet(rec.planet, rec.star) }));
    if (ui.filter) list = list.filter(({ rec }) => rec.cls === ui.filter.cls && (ui.filter.tag === 'なし' ? rec.tags.length === 0 : rec.tags.includes(ui.filter.tag)));
    list.sort(ui.sort === 'rarity' ? (a, b) => b.r.tier - a.r.tier || a.r.share - b.r.share || b.rec.savedAt - a.rec.savedAt : (a, b) => b.rec.savedAt - a.rec.savedAt);
    $('dex-filter').replaceChildren(...(ui.filter ? [`絞り込み: ${ui.filter.cls} × ${ui.filter.tag} `, actionButton('解除', () => { ui.filter = null; render(); })] : [`登録した惑星 ${store.planets().length} 個`]));
    if (!list.length) {
      $('dex-plist').replaceChildren(textEl('p', store.planets().length ? '該当する惑星がありません。' : 'まだ惑星が登録されていません。惑星系をつくると、完成したときに自動で登録されます。', 'dex-empty'));
      return;
    }
    $('dex-plist').replaceChildren(...list.map(({ rec }) => {
      const card = document.createElement('article');
      card.className = 'card dex-item';
      const f = planetFeatures(rec.planet, rec.star);
      const thumb = canvasEl(72, 'thumb', (ctx, s) => drawPlanetSprite(ctx, s / 2, s / 2, Math.min(s / 2 - 4, 4 + dotRadius(rec.planet.mass) * 2.6), f, rec.seed, rec.planet.id));
      const body = document.createElement('div');
      body.className = 'body';
      body.append(...planetCardNodes(rec.planet, rec.name, rec.star));
      body.append(textEl('p', `登録: ${dateText(rec.savedAt)}`, 'meta-line'));
      const actions = document.createElement('div');
      actions.className = 'card-actions actions';
      actions.append(actionButton('共有', () => onSharePlanet(rec)));
      card.append(thumb, body, actions);
      return card;
    }));
  }

  function renderSystems() {
    const systems = store.systems();
    $('dex-scount').textContent = `登録した惑星系 ${systems.length} 件`;
    const list = systems.map((rec) => ({ rec, r: rarityOfSystem(rec.final, rec.input.star) }));
    list.sort(ui.ssort === 'rarity' ? (a, b) => b.r.tier - a.r.tier || b.rec.savedAt - a.rec.savedAt : (a, b) => b.rec.savedAt - a.rec.savedAt);
    if (!list.length) {
      $('dex-slist').replaceChildren(textEl('p', 'まだ惑星系が登録されていません。惑星系をつくると、完成したときに自動で登録されます。', 'dex-empty'));
      return;
    }
    $('dex-slist').replaceChildren(...list.map(({ rec, r }) => {
      const card = document.createElement('article');
      card.className = 'card dex-item';
      const thumb = canvasEl(72, 'thumb', (ctx, s) => drawSystemOrbit(ctx, s / 2, s / 2, s / 2 - 3, rec.input, rec.final));
      const body = document.createElement('div');
      body.className = 'body';
      body.append(textEl('h4', `${rec.name} 系`), rarityEl(r));
      if (r.reason.label) body.append(textEl('p', `決め手: ${r.reason.label}`, 'meta-line'));
      const pats = r.patterns.map((p) => p.label);
      body.append(textEl('p', `惑星 ${rec.final.length} 個${pats.length ? ' ・ ' + pats.join('・') : ''}`, 'meta-line'));
      body.append(textEl('p', `恒星の重さ 太陽の${rec.input.star.mass.toFixed(2)}倍・金属量 ${rec.input.star.Z.toFixed(2)}・円盤の重さ 太陽の${rec.input.disk.mass.toFixed(3)}倍・登録 ${dateText(rec.savedAt)}`, 'meta-line'));
      const biggest = [...rec.final].sort((a, b) => (b.mass.metal + b.mass.rock + b.mass.ice + b.mass.gas) - (a.mass.metal + a.mass.rock + a.mass.ice + a.mass.gas))[0];
      if (biggest) body.append(textEl('p', `いちばん重い惑星: ${fmtMass(biggest.mass.metal + biggest.mass.rock + biggest.mass.ice + biggest.mass.gas)}`, 'meta-line'));
      const actions = document.createElement('div');
      actions.className = 'card-actions actions';
      actions.append(
        actionButton('もう一度見る', () => onReplay(rec.input), 'primary'),
        actionButton('共有', () => onShareSystem(rec)),
      );
      card.append(thumb, body, actions);
      return card;
    }));
  }

  function render() {
    $('dex-planets').hidden = ui.tab !== 'planets';
    $('dex-systems').hidden = ui.tab !== 'systems';
    $('dex-tab-planets').setAttribute('aria-pressed', String(ui.tab === 'planets'));
    $('dex-tab-systems').setAttribute('aria-pressed', String(ui.tab === 'systems'));
    if (ui.tab === 'planets') renderPlanets(); else renderSystems();
    for (const b of document.querySelectorAll('[data-dex-sort]')) b.setAttribute('aria-pressed', String(b.dataset.dexSort === ui.sort));
    for (const b of document.querySelectorAll('[data-dex-ssort]')) b.setAttribute('aria-pressed', String(b.dataset.dexSsort === ui.ssort));
  }

  $('dex-tab-planets').addEventListener('click', () => { ui.tab = 'planets'; render(); });
  $('dex-tab-systems').addEventListener('click', () => { ui.tab = 'systems'; render(); });
  for (const b of document.querySelectorAll('[data-dex-sort]')) b.addEventListener('click', () => { ui.sort = b.dataset.dexSort; render(); });
  for (const b of document.querySelectorAll('[data-dex-ssort]')) b.addEventListener('click', () => { ui.ssort = b.dataset.dexSsort; render(); });

  return { render, state: ui };
}
