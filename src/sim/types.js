// 型定義 (JSDoc)。実体のない型だけのファイル。

/**
 * @typedef {{ mass: number, luminosity: number, Z: number }} Star  mass[M☉] luminosity[L☉] Z=太陽金属量を1とした相対値
 * @typedef {{ r: number, width: number, amp: number }} Structure  リング(amp>0)/ギャップ(-1<amp<0)
 * @typedef {{ mass: number, rIn: number, rOut: number, tLife: number, p: number, structures: Structure[] }} DiskParams  mass[M☉] r[AU] tLife[yr]
 * @typedef {{ a?: number, mass?: number }} SeedSpec  未指定の項目は seed から乱数で決める
 * @typedef {{ seed: number, modelVersion: string, star: Star, disk: DiskParams, seeds: SeedSpec[], nRandomSeeds: number }} SimInput
 * @typedef {{ metal: number, rock: number, ice: number, gas: number }} Composition  [M⊕]
 * @typedef {{ id: number, a: number, e: number, mass: Composition, moons?: { mass: number }[] }} Planet  moons = 衛星（質量は、惑星の mass に含まれる）
 * @typedef {{ t: number, planets: Planet[], disk: { gas: Float32Array, solid: Float32Array } }} Snapshot
 * @typedef {{ t: number, kind: 'merge'|'graze'|'scatter'|'eject'|'trap'|'gasRunaway'|'dispersal'|'innerEdge', ids: number[], data?: Record<string, number> }} SimEvent
 * @typedef {{ input: SimInput, snapshots: Snapshot[], events: SimEvent[], final: Planet[], ledger: any, warnings: string[], stats: any }} SimResult
 */
export {};
