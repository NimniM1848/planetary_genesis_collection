// Event 履歴から「なぜこの惑星系になったか」を文章にする。条件を変えると結果が変わる納得感の中心。
import { describePlanet } from '../sim/physics.js';
import { fmtMass, fmtTime, fmtPos } from './units.js';

export const M_JUP = 318;

export { fmtMass };

/** 1 件のイベントの短い説明（再生中のログ用） */
export function eventText(e, nameOf) {
  const d = e.data ?? {};
  const where = d.a !== undefined ? `（${fmtPos(d.a)}）` : '';
  return eventBody(e, nameOf, d) + where;
}

function eventBody(e, nameOf, d) {
  switch (e.kind) {
    case 'gasRunaway': return `${nameOf(e.ids[0])} がガスを暴走的に集め始めた（${fmtMass(d.mass)}）`;
    case 'merge': return `${nameOf(e.ids[0])} と ${nameOf(e.ids[1])} が合体（${fmtMass(d.mass)}）`;
    case 'scatter': return `${nameOf(e.ids[0])} と ${nameOf(e.ids[1])} が散乱して軌道が乱れた`;
    case 'eject': return `${nameOf(e.ids[0])}（${fmtMass(d.mass)}）が系外へ放出された`;
    case 'innerEdge': return `${nameOf(e.ids[0])} が円盤の内縁に達した`;
    case 'dispersal': return 'ガス円盤が散逸した';
    default: return e.kind;
  }
}

/**
 * 結果の理由を文章にする。最大 8 文程度。
 * @param {import('../sim/types.js').SimResult} result
 * @param {(id: number) => string} nameOf
 * @returns {string[]}
 */
export function explainResult(result, nameOf) {
  const { input, events, final } = result;
  const lines = [];
  const star = input.star;
  const finalIds = new Set(final.map((p) => p.id));
  const a0 = new Map(result.snapshots[0].planets.map((p) => [p.id, p.a]));
  const desc = new Map(final.map((p) => [p.id, describePlanet(p, star)]));
  const core = (p) => p.mass.metal + p.mass.rock + p.mass.ice;

  // 1. 条件から見た全体像
  const giants = final.filter((p) => desc.get(p.id).class === '巨大ガス惑星');
  if (giants.length === 0) {
    const maxCore = Math.max(0, ...final.map(core));
    if (maxCore < 14) {
      lines.push(`どの惑星の核も、ガスを一気に集め始める目安の重さ（地球の約14倍）に届かなかったため、巨大ガス惑星はできなかった。` +
        (star.Z < 0.8 ? '金属量が低く、固体の材料が少なかったことが効いている。' : ''));
    } else {
      lines.push('核は臨界質量を超えたが、円盤のガスが散逸するまでにガスを十分に集められなかった。');
    }
  } else {
    const first = events.find((e) => e.kind === 'gasRunaway' && giants.some((g) => g.id === e.ids[0]));
    if (first) {
      lines.push(`${nameOf(first.ids[0])} は ${fmtTime(first.t)} に核が目安の重さ（地球の約14倍）を超え、円盤のガスを一気に集めて巨大ガス惑星になった。`);
    }
    if (star.Z >= 1.5) lines.push('金属量が高く、固体の材料が多かったため、核が早く育った。');
  }

  // 2. 軌道移動
  const moved = final
    .filter((p) => a0.has(p.id) && p.a < 0.6 * a0.get(p.id))
    .sort((x, y) => y.mass.gas + core(y) - (x.mass.gas + core(x)));
  for (const p of moved.slice(0, 2)) {
    const d = desc.get(p.id);
    const edge = p.a <= input.disk.rIn * 1.0001;
    lines.push(`${nameOf(p.id)} は円盤との相互作用で、${fmtPos(a0.get(p.id))}から${fmtPos(p.a)}へ内側に移動した` +
      (edge ? `。円盤の内縁で止まり、${d.tags.includes('ホットジュピター') ? 'ホットジュピター' : d.tags.includes('溶岩惑星') ? '溶岩惑星' : '高温の惑星'}として残った。` : '。'));
  }

  // 3. 合体
  const merges = events.filter((e) => e.kind === 'merge');
  if (merges.length) {
    const after = merges.filter((e) => e.t > input.disk.tLife).length;
    const big = merges.reduce((a, b) => (b.data.mass > a.data.mass ? b : a));
    lines.push(`惑星どうしの合体が ${merges.length} 回起き（円盤が散逸した後に ${after} 回）、最大は ${nameOf(big.ids[0])} と ${nameOf(big.ids[1])} の合体（${fmtMass(big.data.mass)}）だった。`);
  } else {
    lines.push('惑星どうしの合体は起きなかった。');
  }

  // 4. 散乱と放出
  const ejects = events.filter((e) => e.kind === 'eject');
  if (ejects.length) {
    const big = ejects.reduce((a, b) => (b.data.mass > a.data.mass ? b : a));
    lines.push(`巨大な惑星の重力で散乱され、${ejects.length} 個の惑星が系外へ放出された（最大: ${nameOf(big.ids[0])}、${fmtMass(big.data.mass)}）。`);
  } else if (events.some((e) => e.kind === 'scatter')) {
    lines.push('近接した惑星どうしが散乱して、離心率が高くなった。');
  }

  // 5. 内側の岩石惑星と外側の巨星
  const inner = final.filter((p) => p.a < 2 && ['岩石惑星', 'スーパーアース'].includes(desc.get(p.id).class));
  if (inner.length >= 2 && giants.some((g) => g.a > 3)) lines.push('内側に岩石惑星、外側に巨星が並ぶ、太陽系に近い配置になった。');
  const lost = final.length === 0 ? '惑星は 1 つも残らなかった。' : null;
  if (lost) lines.push(lost);
  return lines.slice(0, 8);
}

/**
 * 知識がなくても分かる、短い説明（最大 5 文）。専門用語と単位は使わない。
 * @param {import('../sim/types.js').SimResult} result
 * @param {(id: number) => string} nameOf
 */
export function explainSimple(result, nameOf) {
  const { input, events, final } = result;
  const star = input.star;
  const lines = [];
  const desc = new Map(final.map((p) => [p.id, describePlanet(p, star)]));
  const core = (p) => p.mass.metal + p.mass.rock + p.mass.ice;
  const giants = final.filter((p) => desc.get(p.id).class === '巨大ガス惑星');
  const a0 = new Map(result.snapshots[0].planets.map((p) => [p.id, p.a]));

  // 1. 全体
  if (final.length === 0) {
    lines.push('惑星は 1 つも残りませんでした。');
  } else {
    const rocky = final.filter((p) => ['岩石惑星', 'スーパーアース', '巨大岩石惑星'].includes(desc.get(p.id).class)).length;
    lines.push(`惑星が ${final.length} 個できました。` +
      (giants.length ? `そのうち ${giants.length} 個は、木星のようにガスをまとった巨大ガス惑星です。` : '巨大ガス惑星（木星のようにガスをまとった惑星）はできませんでした。') +
      (rocky ? `地球のような岩の惑星は ${rocky} 個です。` : ''));
  }

  // 2. 大きな惑星ができた / できなかった理由
  if (giants.length) {
    lines.push('惑星の中心にある、岩や氷でできた「核」が大きくなると、円盤のガスを一気に引き寄せて、巨大ガス惑星になります。' +
      (star.Z >= 1.5 ? '今回は材料になる固体が多い円盤だったので、核が早く育ちました。' : ''));
  } else {
    lines.push('巨大ガス惑星になるには、まず岩や氷でできた「核」が十分に大きくなる必要があります。今回は、円盤のガスが消えるまでに、核がそこまで育ちませんでした。' +
      (star.Z < 0.8 ? '恒星に重い元素が少なく、惑星の材料が足りなかったことが大きな理由です。' : input.disk.mass < 0.02 ? '円盤が軽く、材料が少なかったことが大きな理由です。' : ''));
  }

  // 3. 動いた惑星
  const moved = final.filter((p) => a0.has(p.id) && p.a < 0.6 * a0.get(p.id)).sort((x, y) => core(y) + y.mass.gas - core(x) - x.mass.gas);
  if (moved.length) {
    const p = moved[0];
    const hot = desc.get(p.id).tags.includes('ホットジュピター');
    lines.push(`円盤のガスに引きずられて、${nameOf(p.id)} は恒星のほうへ近づいていきました。` + (hot ? '恒星のすぐそばを回る、とても熱い巨大な惑星（ホットジュピター）になりました。' : ''));
  }

  // 4. ぶつかった / 弾き出された
  const merges = events.filter((e) => e.kind === 'merge').length;
  const ejects = events.filter((e) => e.kind === 'eject').length;
  const parts = [];
  if (merges) parts.push(`近くにいた惑星どうしがぶつかって一つになることが ${merges} 回ありました`);
  if (ejects) parts.push(`重い惑星の重力で弾き飛ばされ、系の外へ出ていった惑星が ${ejects} 個いました`);
  if (parts.length) lines.push(parts.join('。') + '。');

  // 5. 条件を変えると
  if (!giants.length && star.Z < 2) lines.push('試しに、金属量を上げてもう一度つくると、巨大ガス惑星ができやすくなります。');
  else if (giants.length >= 2 && ejects === 0) lines.push('大きな惑星が複数できた系は、惑星どうしの重力で軌道が乱れやすくなります。');
  return lines.slice(0, 5);
}

/** できごとの年表（くわしい説明用）。散乱は多いので除く */
export function eventTimeline(result, nameOf, limit = 40) {
  return result.events
    .filter((e) => e.kind !== 'scatter')
    .slice(0, limit)
    .map((e) => ({ t: e.t, text: eventText(e, nameOf) }));
}
