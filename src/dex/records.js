// 図鑑に保存するレコードの作成。保存するのは条件と最終結果だけ（スナップショットは保存しない）。
import { planetFeatures } from './features.js';
import { rarityOfPlanet, rarityOfSystem } from './rarity.js';
import { systemId } from './store.js';

const r7 = (x) => Number(x.toPrecision(7)); // 保存容量を減らすため 7 桁に丸める（表示には十分）
const roundPlanet = (p) => ({ id: p.id, a: r7(p.a), e: r7(p.e), mass: { metal: r7(p.mass.metal), rock: r7(p.mass.rock), ice: r7(p.mass.ice), gas: r7(p.mass.gas) }, ...(p.moons?.length ? { moons: p.moons.map((m) => ({ mass: r7(m.mass) })) } : {}) });
const slimInput = (i) => ({ seed: i.seed, modelVersion: i.modelVersion, star: { ...i.star }, disk: { ...i.disk, structures: (i.disk.structures ?? []).map((s) => ({ ...s })) }, seeds: [], nRandomSeeds: i.nRandomSeeds });

/** @param {import('../sim/types.js').SimResult} result */
export function buildSystemRecord(result, name, now = Date.now()) {
  const input = result.input;
  const rarity = rarityOfSystem(result.final, input.star);
  return {
    id: systemId(input), savedAt: now, name, input: slimInput(input), final: result.final.map(roundPlanet),
    nPlanets: result.final.length, tier: rarity.tier, reason: rarity.reason.label, patterns: rarity.patterns.map((p) => p.id),
  };
}

/** @param {(id: number) => string} nameOf */
export function buildPlanetRecords(result, nameOf, now = Date.now()) {
  const input = result.input;
  const sid = systemId(input);
  return result.final.map((p) => {
    const f = planetFeatures(p, input.star);
    const r = rarityOfPlanet(p, input.star);
    return {
      id: `${sid}:${p.id}`, systemId: sid, savedAt: now, name: nameOf(p.id), planet: roundPlanet(p),
      star: { ...input.star }, seed: input.seed, cls: f.class, tags: f.tags, tier: r.tier,
    };
  });
}
