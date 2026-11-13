// 上から見た軌道図の描画。円盤は同心円状の濃淡で描き、惑星が作るギャップも見せる。
import { describePlanet, planetRadius } from '../sim/physics.js';
import { planetColor, bandPattern, initialPhase, initialPeriapsis } from './look.js';
import { radialMap, diskGeometry, referenceDensity, solidReferenceDensity, diskShading, frameState, habitableZone, initialGasTotal, seedBirth, keplerState, orbitRadiusAt, ECC_VISIBLE } from './layout.js';

export const MARKER_LIFE = 3.2; // 秒（描画上の時計 wall で数える。停止中は wall が止まるので、マーカーも止まって残る）
export const MARKER_STYLE = {
  gasRunaway: { color: '255,211,107', label: 'ガス暴走', legend: 'ガスを一気に集め始めた（巨大ガス惑星になる）' },
  merge: { color: '255,122,217', label: '合体', legend: '惑星どうしがぶつかって一つになった' },
  eject: { color: '255,107,107', label: '放出', legend: '惑星が系の外へ弾き飛ばされた' },
  innerEdge: { color: '255,154,77', label: '内縁に到達', legend: '円盤の一番内側まで動いてきた' },
  graze: { color: '190,170,255', label: 'かすめた', legend: '惑星どうしがかすめて、合体せずに離れた' },
  trap: { color: '120,220,200', label: '軌道のわな', legend: 'スノーライン付近で、移動が止まった（内向きの移動が弱まる場所）' },
  scatter: { color: '154,209,255', label: '散乱', legend: '惑星どうしが近づき、重力で軌道が乱れた（ぶつかってはいない）' },
  dispersal: { color: '122,162,255', label: 'ガス円盤が散逸', legend: '円盤のガスが消えた（画面上部に表示）' },
};

/** 惑星 1 個の見た目（色・発光・縞模様）を (x, y) に半径 rr で描く。軌道図とカードで共通 */
export function drawPlanetSprite(ctx, x, y, rr, d, seed, id) {
  const col = planetColor(d.class, d.teq);
  if (col.glow) {
    const gg = ctx.createRadialGradient(x, y, 0, x, y, rr * 3);
    gg.addColorStop(0, col.glow);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(x, y, rr * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = col.fill;
  ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  if (rr >= 5 && (d.class === '巨大ガス惑星' || d.class === '巨大氷惑星' || d.class === 'ネプチューン級')) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = col.accent;
    ctx.globalAlpha = 0.55;
    for (const b of bandPattern(seed, id)) ctx.fillRect(x - rr, y - rr + 2 * rr * b.y, 2 * rr, 2 * rr * b.w);
    ctx.restore();
  }
}

/** 惑星の画面上の半径 [px]（質量が変わっても、半径 R⊕ から決まる） */
/**
 * 軌道を描く道筋を作る。離心率が大きければ楕円（恒星は焦点）、小さければ円。
 * 恒星からの距離は対数で画面の半径に変換するので、画面上は楕円そのものではないが、細長さと向きは伝わる。
 */
export function tracePlanetOrbit(ctx, cx, cy, p, omega, rad) {
  ctx.beginPath();
  if (p.e < ECC_VISIBLE) { ctx.arc(cx, cy, rad(p.a), 0, Math.PI * 2); return; }
  const N = 72;
  for (let k = 0; k <= N; k++) {
    const nu = (2 * Math.PI * k) / N;
    const pr = rad(orbitRadiusAt(p.a, p.e, nu));
    const th = omega + nu;
    const x = cx + pr * Math.cos(th);
    const y = cy + pr * Math.sin(th);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 惑星の、いまの位置（恒星からの距離 [AU] と、画面上の向き [rad]）。M = 平均近点角 */
export function planetPosition(p, M, omega) {
  if (p.e < ECC_VISIBLE) return { r: p.a, th: M };
  const { r, nu } = keplerState(p.a, p.e, M);
  return { r, th: omega + nu };
}

export const dotRadius = (mass) => 2 + 7 * (Math.log(1 + planetRadius(mass)) / Math.log(17));

/**
 * 放出された惑星が、起きた場所から外へ弾き飛ばされていく様子（残像つき）。age は 0〜1。
 * 速さは時間とともに増し、図の外まで飛んで消える。
 */
function drawEjection(ctx, m, age, pr0, cx, cy, R, seed) {
  const at = (u) => {
    const dist = pr0 + (R * 1.5 - pr0) * Math.pow(u, 1.8);
    const ang = m.ang + 0.35 * u; // 少し曲がって飛んでいく
    return [cx + dist * Math.cos(ang), cy + dist * Math.sin(ang)];
  };
  const rr = m.rr ?? 4;
  for (let k = 9; k >= 1; k--) { // 残像
    const u = Math.max(0, age - k * 0.025);
    const [x, y] = at(u);
    ctx.globalAlpha = Math.max(0, (1 - k / 10) * 0.35 * (1 - age * age));
    ctx.fillStyle = `rgba(255,150,120,1)`;
    ctx.beginPath(); ctx.arc(x, y, rr * (1 - k / 14), 0, Math.PI * 2); ctx.fill();
  }
  const [x, y] = at(age);
  ctx.globalAlpha = Math.max(0, 1 - Math.pow(age, 3));
  drawPlanetSprite(ctx, x, y, rr, m.desc, seed, m.id ?? 0);
  ctx.globalAlpha = 1;
}

export function createView(canvas, result) {
  const input = result.input;
  const geom = diskGeometry(input);
  const ref = referenceDensity(result, geom);
  const solidRef = solidReferenceDensity(result, geom);
  const gas0 = initialGasTotal(result, geom);
  const descCache = new Map(); // `${id}:${snapshotIndex}` → 物理量
  let hits = new Map(); // id → { x, y, r, a, ang }
  let size = 300;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    size = Math.max(200, Math.floor(canvas.clientWidth));
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /**
   * @param {number} f フレーム位置
   * @param {number} wall 描画上の時計（秒。公転の見た目とマーカーの寿命に使う）
   * @param {number|null} selectedId
   * @param {{ kind: string, a: number|null, ang: number, born: number, label: string, desc?: any, rr?: number }[]} markers
   * @param {{ hz?: boolean, intro?: { u: number } | null }} opts hz = ハビタブルゾーンを表示する / intro = 「種が生まれる」演出の進み具合 u（0〜1）
   */
  function draw(f, wall, selectedId, markers = [], opts = {}) {
    const ctx = canvas.getContext('2d');
    const fs = frameState(result, f);
    const cx = size / 2, cy = size / 2;
    const R = size / 2 - 6;
    const rStar = Math.max(7, size * 0.025);
    const rad = (r) => radialMap(r, input.disk.rIn, input.disk.rOut, R, rStar * 1.6);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, size, size);

    // 円盤: ガス(青)と固体(橙)をセルごとの同心円で描く
    const sh = diskShading(fs.snapshot, geom, ref, solidRef, input, gas0);
    // ガスが消えたあとに残る固体は薄いデブリ程度なので、淡くする（リングやギャップもガスの分布なので、ガスとともに消える）
    const solidVis = 0.12 + 0.88 * sh.gasFrac;
    ctx.lineCap = 'butt';
    for (let j = 0; j < geom.N; j++) {
      const r1 = rad(geom.edges[j]);
      const r2 = rad(geom.edges[j + 1]);
      const mid = (r1 + r2) / 2;
      const w = r2 - r1 + 0.6;
      const ag = Math.min(0.7, 0.6 * Math.sqrt(Math.max(0, sh.gas[j])));
      if (ag > 0.01) {
        ctx.strokeStyle = `rgba(110,150,255,${ag.toFixed(3)})`;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.arc(cx, cy, mid, 0, Math.PI * 2); ctx.stroke();
      }
      const as = Math.min(0.5, 0.35 * Math.sqrt(Math.max(0, sh.solid[j]))) * solidVis;
      if (as > 0.01) {
        ctx.strokeStyle = `rgba(255,170,90,${as.toFixed(3)})`;
        ctx.lineWidth = w * 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, mid, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // ハビタブルゾーン（オンのときだけ）
    if (opts.hz) {
      const hz = habitableZone(input.star.luminosity);
      const h1 = rad(Math.max(hz.inner, input.disk.rIn));
      const h2 = rad(Math.min(hz.outer, input.disk.rOut));
      if (h2 > h1) {
        ctx.strokeStyle = 'rgba(90,220,140,0.22)';
        ctx.lineWidth = h2 - h1;
        ctx.beginPath(); ctx.arc(cx, cy, (h1 + h2) / 2, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,240,160,0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        for (const rr of [h1, h2]) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(150,245,180,0.9)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('ハビタブルゾーン', cx - h2 * 0.707 - 2 - 78, cy - h2 * 0.707 + 12);
      }
    }

    // スノーライン
    const rs = rad(geom.snow);
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(190,225,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, rs, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(190,225,255,0.7)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('スノーライン', cx + rs * 0.707 + 4, cy - rs * 0.707);

    // 恒星
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rStar * 2.4);
    g.addColorStop(0, 'rgba(255,245,200,1)');
    g.addColorStop(0.4, 'rgba(255,220,130,0.9)');
    g.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, rStar * 2.4, 0, Math.PI * 2); ctx.fill();

    // 惑星
    const next = new Map();
    const sorted = [...fs.planets].sort((x, y) => y.a - x.a);
    const order = new Map([...fs.planets].sort((x, y) => x.id - y.id).map((p, k) => [p.id, k])); // 種が現れる順番（id 順）
    for (const p of sorted) {
      let birth = null;
      if (opts.intro) {
        birth = seedBirth(opts.intro.u, order.get(p.id), fs.planets.length);
        if (birth.p <= 0) continue; // まだ生まれていない種は描かない（軌道線も、タップの当たり判定も無い）
      }
      const key = `${p.id}:${fs.index}`;
      let d = descCache.get(key);
      if (!d) { d = describePlanet(p, input.star); descCache.set(key, d); }
      const omega = initialPeriapsis(input.seed, p.id);
      const pos = planetPosition(p, initialPhase(input.seed, p.id) + (wall * 1.2) / Math.sqrt(p.a + 0.3), omega);
      const pr = rad(pos.r);
      const ang = pos.th;
      const x = cx + pr * Math.cos(ang);
      const y = cy + pr * Math.sin(ang);
      const rr = dotRadius(p.mass) * (birth ? birth.scale : 1);

      ctx.strokeStyle = p.id === selectedId ? 'rgba(255,255,255,0.45)' : p.e >= ECC_VISIBLE ? 'rgba(255,200,150,0.3)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      tracePlanetOrbit(ctx, cx, cy, p, omega, rad); ctx.stroke();
      if (birth && birth.p < 1) { // 生まれる瞬間: 広がる光の輪
        ctx.strokeStyle = `rgba(255,236,180,${(1 - birth.p).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, rr + 4 + 22 * birth.p, 0, Math.PI * 2); ctx.stroke();
      }
      drawPlanetSprite(ctx, x, y, rr, d, input.seed, p.id);
      if (p.moons?.length) { // 衛星: 惑星のまわりを回る小さな点（見た目だけ。惑星が小さくても見えるよう、少し離して描く）
        p.moons.forEach((mo, k) => {
          const mr = rr + 4 + 3.5 * k, mth = wall * (2.2 - 0.4 * k) + k * 2.1 + p.id;
          ctx.fillStyle = 'rgba(225,225,235,0.9)';
          ctx.beginPath(); ctx.arc(x + mr * Math.cos(mth), y + mr * Math.sin(mth), 1.6, 0, Math.PI * 2); ctx.fill();
        });
      }
      if (p.id === selectedId) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, rr + 3, 0, Math.PI * 2); ctx.stroke();
      }
      next.set(p.id, { x, y, r: Math.max(rr, 14), rr, a: pos.r, ang, desc: d }); // a = いまの恒星からの距離 [AU]（軌道長半径ではない。できごとの印を、起きた場所に付けるため） // 当たり判定は小さな惑星でも 14px
    }
    hits = next;

    // できごとのマーカー: 起きた場所（軌道と向き）に広がる輪とラベルを出す
    const drawn = markers.slice(-10);
    for (const m of drawn) {
      const age = (wall - m.born) / MARKER_LIFE;
      if (age < 0 || age > 1) continue;
      const st = MARKER_STYLE[m.kind] ?? MARKER_STYLE.merge;
      const alpha = 1 - age * age;
      if (m.a === null) { // 場所のないできごと（円盤の散逸）は上部に帯で出す
        ctx.font = '600 13px system-ui, sans-serif';
        const tw = ctx.measureText(m.label).width + 20;
        ctx.fillStyle = `rgba(16,22,42,${(0.85 * alpha).toFixed(3)})`;
        ctx.fillRect(cx - tw / 2, 8, tw, 26);
        ctx.fillStyle = `rgba(${st.color},${alpha.toFixed(3)})`;
        ctx.textAlign = 'center';
        ctx.fillText(m.label, cx, 26);
        ctx.textAlign = 'start';
        continue;
      }
      const pr = rad(m.a);
      const x = cx + pr * Math.cos(m.ang);
      const y = cy + pr * Math.sin(m.ang);
      if (m.kind === 'eject' && m.desc) drawEjection(ctx, m, age, pr, cx, cy, R, input.seed);
      ctx.strokeStyle = `rgba(${st.color},${alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 8 + 26 * age, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${st.color},${alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      {
        ctx.font = '600 12px system-ui, sans-serif';
        const tw = ctx.measureText(m.label).width + 12;
        const lx = Math.min(size - tw - 4, Math.max(4, x + 10));
        const ly = Math.min(size - 8, Math.max(18, y - 12));
        ctx.fillStyle = `rgba(16,22,42,${(0.85 * alpha).toFixed(3)})`;
        ctx.fillRect(lx, ly - 13, tw, 18);
        ctx.fillStyle = `rgba(${st.color},${alpha.toFixed(3)})`;
        ctx.fillText(m.label, lx + 6, ly);
      }
    }
    if (opts.intro) { // 冒頭の説明の帯（ここから先は計算）
      const u = opts.intro.u;
      const a = Math.min(1, u / 0.1, (1 - u) / 0.15);
      const text = '円盤の中で、惑星の種が生まれる';
      ctx.font = '600 13px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 24;
      ctx.fillStyle = `rgba(16,22,42,${(0.85 * a).toFixed(3)})`;
      ctx.fillRect(cx - tw / 2, 8, tw, 28);
      ctx.fillStyle = `rgba(255,236,180,${a.toFixed(3)})`;
      ctx.textAlign = 'center';
      ctx.fillText(text, cx, 27);
      ctx.textAlign = 'start';
    }
    return fs;
  }

  /** タップ位置に近い惑星の id */
  function hitTest(px, py) {
    let best = null;
    let bd = Infinity;
    for (const [id, h] of hits) {
      const d = Math.hypot(h.x - px, h.y - py);
      if (d <= h.r && d < bd) { best = id; bd = d; }
    }
    return best;
  }

  /** 直近に描いた惑星の位置と物理量（マーカーとカードの位置決めに使う） */
  const hitOf = (id) => hits.get(id) ?? null;

  resize();
  return { draw, hitTest, hitOf, resize, get size() { return size; } };
}
