// チューニング対象の値はここに外出しする（コードに埋め込まない）。
// 数値はすべて初期値で、検証ハーネスで調整する前提（仕様書 §6）。

// 乱数の消費順・式・既定値を変えたら必ず上げる。
export const MODEL_VERSION = '1.0.0-v2';

export const DEFAULT_PARAMS = Object.freeze({
  // --- 円盤 (§1) ---
  nCells: 200,
  gasDustRatio0: 0.01, // M_gas = M_disk / (1 + 0.01 Z)
  zetaRock: 0.0045, // スノーライン内側の固体/ガス比 (Z=1)
  zetaIce: 0.0055, // スノーライン外側で加わる氷の分
  fMetal: 0.3, // rock+metal のうち metal の質量分率

  // --- 小石の流入（v2。内側の円盤の固体を増やす簡易版） ---
  // 円盤ができて間もない頃、外側の固体（小石）は、内側へ流れ込み、スノーライン内側に溜まる。氷はスノーラインで気化するので、岩石・金属だけが溜まる。
  // 流れ込む小石は、シミュレーションの外縁より外側の遠い円盤からも来るので、外側の固体は減らさず、外から入る分として、内側に足す。
  // 足す量 = スノーライン外側の固体の質量 × 岩石・金属の割合 × pebbleFrac（金属量・円盤の質量・広がりに比例して増える）。
  pebbleFrac: 0.3, // 0 で無効
  pebbleKappa: 2, // 内側に溜まる固体の表面密度 ∝ r^(-この値)

  // --- 種 (§2) ---
  seedModel: 'disk', // 'disk' = 種の数・位置・質量を円盤の条件から決める（既定）。'random' = 従来の、個数を指定して乱数で置く方法（比較・検証用）
  seedCountRef: 7, // 基準の円盤（固体 約 94 M⊕、広がり 0.05〜30 AU）での、種の数
  seedCountRefSolid: 114, // M⊕ 基準の固体の総量（小石の流入を含む。流入なしの仕様書 §1 の基準は 94）
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
  seedPosExp: 0.5, // 種の位置の重み = 固体質量 / r^seedPosExp。仕様書 §2 は 0。v2 では、小石の流入で内側の固体が増えるため、0.5 に戻す（0.8 だと内側に偏りすぎる）
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
  gapExp: 4, // Type I と Type II の混ぜ方 s = M^k / (M^k + M_gap^k) の k（仕様書は 2。ギャップを開いていない惑星に Type II が効かないよう、切り替えを急にする）
  mGap: 30, // M⊕ ギャップを開く質量（仕様書は 100。散乱導入後に重い円盤で 13 MJ 超が出たため 30、合意済みの調整対象）

  // --- 軌道移動 (§4) ---
  fMig: 0.3, // Type I 移動を弱める係数（仕様書は 0.1）
  tauMig0: 1e6, // yr
  tauII0: 4e4, // yr（仕様書は 1e6。巨星が内縁まで届くホットジュピターを少数出すため。v2 では、Type II への切り替えを急にした分（gapExp）を見込んで 1e5 → 4e4）
  migDtFactor: 0.1, // Δt ≤ 0.1 τ_mig

  // --- 軌道トラップと外向き移動（v2） ---
  // スノーライン付近に、惑星が止まりやすい場所（トラップ）を作る。質量が trapMassMin〜trapMassMax の惑星だけが、これを感じる。
  // トラップの範囲に入った惑星は、内向きの移動が弱まって止まる。範囲の内側で、トラップより内側の惑星は、外向きに動いて、トラップへ引き寄せられる。
  snowTrap: true, // スノーライン付近のトラップ。false にすると、トラップだけを切れる（内側の連なりの規則は残る。比較・検証用）
  trapMassMin: 2, // M⊕
  trapMassMax: 60, // M⊕
  trapSigma: 0.8, // トラップの範囲の広さ（ln(a / スノーライン) の幅）
  trapWidth: 0.35, // トラップの中心の近くで、動く向きが切り替わる幅（ln の幅。小さいほど、きつく引き寄せる）
  chainDelta: 7, // 内向きに動く惑星（質量 trapMassMax 以下）は、内側の隣の惑星から、相互ヒル半径のこの倍数までしか近づけない（共鳴の連なり）
  trapCatchLn: 0.12, // トラップに捕まったとみなす範囲（ln(a / スノーライン) がこれ以内）。「トラップ」のできごとを記録する

  // --- 衝突の細かさ（v2: 部分合体・質量損失・衛星） ---
  // 固体の惑星どうしの合体に、衝突の角度（b: 0 = 真正面、1 = かすめる）を乱数で決める。
  impactSolidMaxGas: 0.1, // 両方のガスの割合がこれ未満のときだけ、細かい衝突を計算する（ガスの多い惑星は、完全合体）
  impactPerfectB: 0.4, // b がこれ未満なら、完全合体（破片なし）
  impactGrazeB: 0.85, // b がこれ以上で、質量比が impactGrazeQ 未満なら、かすめるだけ（合体しない）
  impactGrazeQ: 0.5,
  impactLossCoef: 0.3, // 破片の質量 = 小さいほうの質量 × この値 × (b - impactPerfectB) / (1 - impactPerfectB)
  impactLossFrac: 0.5, // 破片のうち、飛び散って失われる割合
  moonFrac: 0.3, // 破片のうち、集まって衛星になる割合（残りは、惑星に戻る）
  moonQmin: 0.02, // 衛星ができる、質量比（小さいほう / 大きいほう）の範囲
  moonQmax: 1,
  moonTotalMin: 0.02, // M⊕ 衛星ができる、衝突後の惑星の質量の下限
  moonMassMin: 0.0005, // M⊕ 衛星の質量の下限
  moonMaxCount: 3,
  moonMinA: 0.08, // AU これより内側の惑星は、潮汐で衛星を失う

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
