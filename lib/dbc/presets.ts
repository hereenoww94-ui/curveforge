import type { LaunchConfig, QuoteSymbol } from "./formulas";
import { MIGRATION_THRESHOLDS } from "./formulas";

/**
 * CurveForge preset library.
 *
 * Each preset is a complete, opinionated DBC launch configuration with a
 * written rationale. These map onto the build directions Meteora asked for:
 *   - "Launch Mechanics tuned for Equity / Stocks paired launches"
 *   - "Novel Curve or Fee Configurations (Flat, Exponential, Long Curve)"
 *   - "DBC Config Preset Marketplace"
 */

export interface Preset {
  id: string;
  name: string;
  /** One-line description shown on the preset card. */
  tagline: string;
  /** Why this configuration behaves the way it does — shown to judges. */
  rationale: string;
  /** The economic problem it solves. */
  suits: string;
  config: Partial<LaunchConfig>;
}

const withThreshold = (quote: QuoteSymbol, base: Partial<LaunchConfig> = {}) => ({
  quote,
  migrationQuoteThreshold: MIGRATION_THRESHOLDS[quote],
  ...base,
});

export const PRESETS: Preset[] = [
  {
    id: "rwa-equity",
    name: "Tokenized Equity",
    tagline: "Tight band, deep liquidity, low slippage",
    rationale:
      "Equity pairs are judged against a real-world reference price, so the curve must not drift far from it. Liquidity is deep and evenly spread with a gentle thinning, keeping round-trip slippage low across the whole band. Fee sits at 25 bps — exactly MIN_FEE_BPS, the lowest the program will accept and the level at which market makers still quote.",
    suits: "xStocks, Backpack Onchain, Ondo RFQ and other tokenized stock pairs",
    config: withThreshold("USDC", {
      baseSymbol: "sAAPL",
      startPrice: 100,
      endPrice: 104,
      segments: 16,
      profile: "rwa",
      bias: 0,
      baseFeeBps: 25,
      dynamicFee: false,
      migrationFeePct: 1,
      creatorShareBps: 3000,
      baseSupply: 10_000_000,
      poolCreationFeeSol: 1,
    }),
  },
  {
    id: "fast-discovery",
    name: "Fast Discovery",
    tagline: "Thin liquidity early — price finds level fast",
    rationale:
      "Liquidity is deliberately thin at the open and deepens toward graduation. Small early flow therefore moves price a long way, so the market spends its first minutes discovering a price instead of grinding sideways. Back-loaded depth also makes a late dump expensive.",
    suits: "Meme launches and any asset that needs rapid price discovery",
    config: withThreshold("SOL", {
      baseSymbol: "WOJAK",
      startPrice: 0.0000004,
      endPrice: 0.000012,
      segments: 12,
      profile: "discovery",
      bias: 0.6,
      baseFeeBps: 100,
      dynamicFee: true,
      migrationFeePct: 3,
      creatorShareBps: 7000,
      baseSupply: 1_000_000_000,
      poolCreationFeeSol: 0.5,
    }),
  },
  {
    id: "gradual-accumulation",
    name: "Gradual Accumulation",
    tagline: "Deep liquidity early — steady, dump-resistant climb",
    rationale:
      "The mirror of Fast Discovery: heavy virtual liquidity at the open means early buyers cannot spike the price, so entry cost stays near the start price and the curve rewards patience. Late thinning keeps graduation reachable within the same threshold.",
    suits: "Community launches where fair, even entry matters more than hype",
    config: withThreshold("SOL", {
      baseSymbol: "COMMON",
      startPrice: 0.000001,
      endPrice: 0.000006,
      segments: 16,
      profile: "accumulation",
      bias: -0.5,
      baseFeeBps: 50,
      dynamicFee: false,
      migrationFeePct: 2,
      creatorShareBps: 4000,
      baseSupply: 500_000_000,
      poolCreationFeeSol: 0.2,
    }),
  },
  {
    id: "flat-schedule",
    name: "Flat Curve",
    tagline: "Uniform price impact across every range",
    rationale:
      "The neutral baseline: liquidity is split evenly over sqrt-price bins, so each unit of quote demand moves price by the same amount regardless of where you are on the curve. Useful as a control when comparing any custom shape against a fair, shape-agnostic launch.",
    suits: "Benchmarking a custom curve, and simple launches with no narrative",
    config: withThreshold("USDC", {
      baseSymbol: "FLAT",
      startPrice: 0.01,
      endPrice: 0.05,
      segments: 10,
      profile: "uniform",
      bias: 0,
      baseFeeBps: 25,
      dynamicFee: false,
      migrationFeePct: 2,
      creatorShareBps: 5000,
      baseSupply: 100_000_000,
      poolCreationFeeSol: 0.5,
    }),
  },
  {
    id: "conviction-tail",
    name: "Long Conviction Tail",
    tagline: "16 ranges, slow grind, hard to break",
    rationale:
      "Splits the curve into the maximum 16 ranges with liquidity weighted late. Price advances in small, costly steps and the final stretch is the most expensive part of the curve, so graduating requires sustained demand rather than a single burst.",
    suits: "Long-duration launches that want to filter for committed buyers",
    config: withThreshold("USDC", {
      baseSymbol: "LONG",
      startPrice: 0.001,
      endPrice: 0.02,
      segments: 16,
      profile: "accumulation",
      bias: 0.7,
      baseFeeBps: 30,
      dynamicFee: true,
      migrationFeePct: 4,
      creatorShareBps: 6000,
      baseSupply: 200_000_000,
      poolCreationFeeSol: 0.75,
    }),
  },
  {
    id: "stock-pair-lp",
    name: "Stock-Paired Launch",
    tagline: "USDC quote at Meteora's real 750 USDC threshold",
    rationale:
      "Uses the exact migration threshold Meteora's mainnet keeper enforces for USDC pools (750 USDC), with a 1% migration fee so the creator realises value at graduation. A 5000 bps creator share keeps partner economics balanced for a launchpad running many pairs.",
    suits: "Launchpads spinning up multiple equity or RWA pairs from one config",
    config: withThreshold("USDC", {
      baseSymbol: "sTSLA",
      startPrice: 420,
      endPrice: 430,
      segments: 16,
      profile: "rwa",
      bias: -0.2,
      baseFeeBps: 25,
      dynamicFee: false,
      migrationFeePct: 1,
      creatorShareBps: 5000,
      baseSupply: 5_000_000,
      poolCreationFeeSol: 2,
    }),
  },
];

export function applyPreset(current: LaunchConfig, preset: Preset): LaunchConfig {
  return { ...current, ...preset.config };
}

/** Preset that best matches a config, or null when the config is custom. */
export function matchPreset(config: LaunchConfig): Preset | null {
  for (const preset of PRESETS) {
    const merged = { ...config, ...preset.config };
    const keys = Object.keys(preset.config) as (keyof LaunchConfig)[];
    const same = keys.every(
      (k) => JSON.stringify(merged[k]) === JSON.stringify(config[k]),
    );
    if (same) return preset;
  }
  return null;
}
