// チューニング対象の値はここに外出しする（コードに埋め込まない）。
// 数値はすべて初期値で、検証ハーネスで調整する前提（仕様書 §6）。

// 乱数の消費順・式・既定値を変えたら必ず上げる。
export const MODEL_VERSION = '0.7.0-disk-seeds';

export const DEFAULT_PARAMS = Object.freeze({
  // --- 円盤 (§1) ---
  nCells: 200,
  gasDustRatio0: 0.01, // M_gas = M_disk / (1 + 0.01 Z)
  zetaRock: 0.0045, // スノーライン内側の固体/ガス比 (Z=1)
  zetaIce: 0.0055, // スノーライン外側で加わる氷の分
  fMetal: 0.3, // rock+metal のうち metal の質量分率

  // --- 種 (§2) ---
  seedModel: 'disk', // 'disk' = 種の数・位置・質量を円盤の条件から決める（既定）。'random' = 従来の、個数を指定して乱数で置く方法（比較・検証用）
  seedCountRef: 7, // 基準の円盤（固体 約 94 M⊕、広がり 0.05〜30 AU）での、種の数
  seedCountRefSolid: 94, // M⊕ 基準の固体の総量
  seedCountSolidExp: 0.5, // 種の数 ∝ (固体の総量)^この値。固体が多いほど、種は多い
  seedCountExtentExp: 0.5, // 種の数 ∝ (円盤の広がり ln(外縁/内縁))^この値。広い円盤ほど、種は多い
  seedMinCount: 3,
  seedMaxCount: 16,
  seedOverlap: 0.5, // 種の位置を選ぶ範囲を、自分の区間の前後に、区間の幅のこの割合だけ広げる（0 = 区間の中だけ。大きいほど、隣の種に近づきやすく、合体が増える）
  seedEps: 0.001, // 種の質量 = その種が代表する範囲の固体量 × この値（ゆらぎ付き）
  seedJitterMass: 0.6, // 質量のゆらぎ（対数の標準偏差）
  seedMassMin: 0.001, // M⊕
  seedMassMax: 0.1,
  seedMinSepHill: 10, // 相互ヒル半径の何倍以内に置かないか
  seedPosExp: 0.8, // 種の位置の重み = 固体質量 / r^seedPosExp。仕様書 §2 は 0。外側偏重だと岩石惑星が出にくいため、内側寄りにする（1 ≈ 対数半径で一様）。新しい種の決め方で、岩石惑星・太陽系風・放出の多さを見て 0.5 → 0.8
  seedPlaceAttempts: 200,
  seedMassRedraws: 50,

  // --- 固体獲得 (§2) ---
  eta: 1e-5,
  b: 10,

  // --- ガス獲得 (§3) ---
  mCrit: 14, // M⊕ 臨界コア質量
  tauCrit: 3e6, // yr  τ_KH = τ_crit (M/M_crit)^(-khExp)
  khExp: 3,
  fGas: 0.1, // 供給制限の係数 f_g
  mGap: 30, // M⊕ ギャップを開く質量（仕様書は 100。散乱導入後に重い円盤で 13 MJ 超が出たため 30、合意済みの調整対象）

  // --- 軌道移動 (§4) ---
  fMig: 0.3, // Type I 移動を弱める係数（仕様書は 0.1）
  tauMig0: 1e6, // yr
  tauII0: 1e5, // yr（仕様書は 1e6。巨星が内縁まで届くホットジュピターを少数出すため）
  migDtFactor: 0.1, // Δt ≤ 0.1 τ_mig

  // --- 衝突・合体 (§5) ---
  t0: 1e4, // yr  t_inst = t0 10^(β(Δ-3.5))
  beta: 1,
  deltaUnstable: 3.5,
  c0: 0.1, // ガス円盤が残る間の衝突率係数の下限
  tauE: 1e5, // yr  ガス円盤による離心率の減衰
  eMergeSigma: 0.02, // 合体時の離心率 Rayleigh σ
  scatterKick: 0.2, // 散乱の離心率キックの係数
  scatterThetaMax: 3, // min(√Θ, 3)
  ejectE: 0.8, // e がこれ以上になった惑星は系外へ放出

  // --- 時間刻み (§7, §9) ---
  dtInit: 1e4,
  dtMin: 10, // 仕様書の1,000年から緩和（ガス暴走時に必要。合意済み）
  dtAfterLife: 1e5,
  tEndAfterLife: 1e8, // T_end = T_life + 100 Myr
  maxRelChange: 0.5, // 1ステップの質量変化率の上限
  massChangeFloor: 0.01, // M⊕。種のような極小質量では絶対量で判定する（仕様書にない追加、要確認）
  snapshotEveryAfterLife: 10, // 円盤寿命後は何ステップごとに保存するか

  // --- 検証 ---
  massTolerance: 1e-9,
});

/**
 * 基準シナリオ（仕様書 §0）。
 * @param {number} seed
 * @returns {import('./types.js').SimInput}
 */
export function baselineInput(seed) {
  return {
    seed,
    modelVersion: MODEL_VERSION,
    star: { mass: 1.0, luminosity: 1.0, Z: 1.0 },
    disk: { mass: 0.03, rIn: 0.05, rOut: 30, tLife: 3e6, p: 1.0, structures: [] },
    seeds: [],
    nRandomSeeds: 8,
  };
}
