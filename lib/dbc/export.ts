/**
 * Server-side bridge from a CurveForge config to Meteora's official SDK.
 *
 * The SDK's `buildCurveWithCustomSqrtPrices` derives liquidity from the token
 * supply and computes `migrationQuoteThreshold` as a *consequence* of the curve.
 * CurveForge's simulator works the other way round: it fixes the graduation
 * threshold and derives liquidity. The SDK derivation additionally folds in a
 * migration-fee factor term, so its threshold is independent of the one we
 * requested and supply cannot reconcile them (leftover absorbs any change).
 * This module therefore reports both values and their delta rather than
 * pretending they are identical.
 *
 * Derived from the SDK source (dist/index.js):
 *   totalSwapAndMigrationAmount = totalSupply - vesting - leftover
 *   w1 = (s_i - s_i-1) / (s_i * s_i-1)          // base sold per segment
 *   w2 = (s_i - s_i-1) * feeFactor / pmax^2      // quote per segment
 *   liquidity_i = (totalSwapAndMigrationAmount / sum(k_j*(w1_j+w2_j))) * k_i
 */

import BN from "bn.js";
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  CollectFeeMode,
  createSqrtPrices,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

import {
  baseAtGraduation,
  buildSegments,
  liquidityWeight,
  migrationThreshold,
  type LaunchConfig,
} from "./formulas";

/** Quote mint decimals — SOL is 9, everything else in the menu is 6. */
export const QUOTE_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  JUP: 6,
  USD1: 6,
  MET: 6,
  JupUSD: 6,
  VIRTUAL: 6,
  TRUMP: 6,
};

/**
 * DBC's dynamic supply model seeds initial supply from the curve's swap amount
 * plus a 25% buffer (see "Supply" on the DBC Launch Configuration page).
 */
export const SUPPLY_BUFFER = 1.25;

export interface BuildConfigResult {
  ok: boolean;
  /** ConfigParameters, BN-safe for JSON transport. */
  payload: unknown;
  /** What CurveForge's simulator believes the threshold is, in quote units. */
  simulatorThreshold: number;
  /** What Meteora's SDK derived from supply + curve, in quote units. */
  sdkThreshold: number | null;
  /** Relative disagreement between the two, or null when unavailable. */
  thresholdDeltaPct: number | null;
  /** Base the curve can sell before migration, in base units. */
  sellableBase: number;
  /**
   * The dynamic-supply model's mint amount (`sellable × 1.25`). This is a
   * supply recommendation only — it does NOT reconcile the two thresholds.
   */
  requiredSupply: number;
  curve: {
    prices: number[];
    liquidityWeights: number[];
    sqrtPrices: string[];
  };
  error: string | null;
}

/** Recursively replace BN and PublicKey-like values with strings. */
function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof BN) return value.toString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

function toTokenDecimal(d: number): TokenDecimal {
  switch (d) {
    case 6:
      return TokenDecimal.SIX;
    case 7:
      return TokenDecimal.SEVEN;
    case 8:
      return TokenDecimal.EIGHT;
    default:
      return TokenDecimal.NINE;
  }
}

export function buildConfigParameters(config: LaunchConfig): BuildConfigResult {
  const segments = buildSegments(config);

  // Curve checkpoints: start price, then each segment's upper bound.
  const prices = [config.startPrice, ...segments.map((s) => s.upperPrice)];
  const weights = segments.map((_, i) =>
    liquidityWeight(config.profile, segments.length === 1 ? 0.5 : i / (segments.length - 1), config.bias),
  );

  const quoteDecimals = QUOTE_DECIMALS[config.quote] ?? 6;
  const sellable = baseAtGraduation(segments);
  const requiredSupply = Math.ceil(sellable * SUPPLY_BUFFER);
  const leftoverAmount = Math.max(0, Math.floor(config.baseSupply - sellable));
  const simulatorThreshold = migrationThreshold(segments);

  const base: Omit<BuildConfigResult, "ok" | "payload" | "sdkThreshold" | "thresholdDeltaPct" | "error"> = {
    simulatorThreshold,
    sellableBase: sellable,
    requiredSupply,
    curve: {
      prices,
      liquidityWeights: weights,
      sqrtPrices: [] as string[],
    },
  };

  let sqrtPrices: BN[] = [];
  try {
    sqrtPrices = createSqrtPrices(prices, toTokenDecimal(config.tokenDecimals), quoteDecimals);
    base.curve.sqrtPrices = sqrtPrices.map((s) => s.toString());

    const payload = buildCurveWithCustomSqrtPrices({
      token: {
        tokenType: TokenType.SPLToken,
        tokenBaseDecimal: toTokenDecimal(config.tokenDecimals),
        tokenQuoteDecimal: quoteDecimals,
        tokenAuthorityOption: TokenAuthorityOption.PartnerUpdateAuthority,
        totalTokenSupply: Math.floor(config.baseSupply),
        leftover: leftoverAmount,
      },
      fee: {
        baseFeeParams: {
          baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
          // A decaying scheduler needs numberOfPeriod + totalDuration > 0;
          // a flat fee requires both to be exactly zero, which the SDK enforces.
          feeSchedulerParam: {
            startingFeeBps: config.baseFeeBps,
            endingFeeBps: config.baseFeeBps,
            numberOfPeriod: 0,
            totalDuration: 0,
          },
        },
        dynamicFeeEnabled: config.dynamicFee,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: config.creatorShareBps,
        poolCreationFee: config.poolCreationFeeSol,
        enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        migrationFeeOption: MigrationFeeOption.Customizable,
        migrationFee: {
          feePercentage: config.migrationFeePct,
          // Splits the migration fee between creator and partner; mapped from
          // the same creator share used for trading fees.
          creatorFeePercentage: Math.round(config.creatorShareBps / 100),
        },
        migratedPoolFee: {
          collectFeeMode: MigratedCollectFeeMode.QuoteToken,
          dynamicFee: DammV2DynamicFeeMode.Disabled,
          // 1% — inside the 0.1%–10% band the program accepts.
          poolFeeBps: 100,
          baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
        },
      },
      liquidityDistribution: {
        // Sums to 100%, with 90% permanently locked — comfortably above the
        // "at least 10% locked after one day" requirement.
        partnerPermanentLockedLiquidityPercentage: 90,
        partnerLiquidityPercentage: 10,
        creatorPermanentLockedLiquidityPercentage: 0,
        creatorLiquidityPercentage: 0,
      },
      lockedVesting: {
        totalLockedVestingAmount: 0,
        numberOfVestingPeriod: 0,
        cliffUnlockAmount: 0,
        totalVestingDuration: 0,
        cliffDurationFromMigrationTime: 0,
      },
      activationType: ActivationType.Timestamp,
      sqrtPrices,
      liquidityWeights: weights,
    });

    // The SDK computes the threshold from supply + curve, in lamports.
    const rawThreshold = (payload as { migrationQuoteThreshold?: { toString(): string } })
      .migrationQuoteThreshold;
    const sdkLamports = rawThreshold ? Number(rawThreshold.toString()) : null;
    const sdkThreshold =
      sdkLamports === null ? null : sdkLamports / Math.pow(10, quoteDecimals);

    const thresholdDeltaPct =
      sdkThreshold && simulatorThreshold > 0
        ? ((sdkThreshold - simulatorThreshold) / simulatorThreshold) * 100
        : null;

    return {
      ...base,
      ok: true,
      payload: toJsonSafe(payload),
      sdkThreshold,
      thresholdDeltaPct,
      error: null,
    };
  } catch (e) {
    return {
      ...base,
      curve: { ...base.curve, sqrtPrices: base.curve.sqrtPrices },
      ok: false,
      payload: null,
      sdkThreshold: null,
      thresholdDeltaPct: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
