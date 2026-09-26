/**
 * CurveForge — Meteora DBC curve math.
 *
 * Every formula below is transcribed from the official Meteora documentation:
 *   https://docs.meteora.ag/core-products/dbc/formulas
 *
 * DBC uses concentrated-liquidity style math: each curve segment is a
 * constant-product price range (x*y=k) with its own virtual liquidity `L`
 * and a lower/upper sqrt price bound.
 */

/** On-chain fee numerators use a denominator of 1,000,000,000. */
export const FEE_DENOMINATOR = 1_000_000_000;

/** Protocol cut of every trading fee. */
export const PROTOCOL_FEE_SHARE = 0.2;

/** Referral share taken out of the protocol fee. */
export const REFERRAL_FEE_SHARE = 0.2;

/** Protocol share of surplus above the migration threshold. */
export const PROTOCOL_SURPLUS_SHARE = 0.2;

/** Hard cap on total trading fee: 990,000,000 / 1e9 = 99%. */
export const MAX_TRADING_FEE = 990_000_000;

/**
 * On-chain fee bounds, taken from @meteora-ag/dynamic-bonding-curve-sdk:
 *   MIN_FEE_BPS = 25, MAX_FEE_BPS = 9900
 * (equivalently MIN_FEE_NUMERATOR = 2,500,000 and MAX = 990,000,000).
 */
export const MIN_FEE_BPS = 25;
export const MAX_FEE_BPS = 9900;

/**
 * "Up to 16 curve points" — DBC's universal curve constraint.
 * @see https://docs.meteora.ag/core-products/dbc/universal-curve
 */
export const MAX_SEGMENTS = 16;
export const MIN_SEGMENTS = 1;

/**
 * The program stores sqrt price as unsigned 64.64 fixed point, bounded by
 * 4295048016 (== 1/2^32 as a Q64 value) and 79226673521066979257578248091
 * (== 2^32 as a Q64 value). Expressed back in price units that is [2^-64, 2^64].
 */
export const Q64 = 18446744073709551616;
export const MIN_SQRT_PRICE_Q64 = 4295048016;
export const MAX_SQRT_PRICE_Q64 = 79226673521066979257578248091;
export const MIN_PRICE = Math.pow(MIN_SQRT_PRICE_Q64 / Q64, 2);
export const MAX_PRICE = Math.pow(MAX_SQRT_PRICE_Q64 / Q64, 2);

/** Migration fee percentage is capped at 99%. */
export const MAX_MIGRATION_FEE_PCT = 99;

/** Token decimals accepted by the program: 6 to 9. */
export const MIN_TOKEN_DECIMALS = 6;
export const MAX_TOKEN_DECIMALS = 9;

/** Pool creation fee bounds, in SOL (docs: 0.001 – 100 SOL). */
export const MIN_POOL_CREATION_FEE_SOL = 0.001;
export const MAX_POOL_CREATION_FEE_SOL = 100;

/** Fixed protocol liquidity migration fee applied during migration. */
export const PROTOCOL_MIGRATION_FEE = 0.002;

export type QuoteSymbol =
  | "SOL"
  | "USDC"
  | "JUP"
  | "USD1"
  | "MET"
  | "JupUSD"
  | "VIRTUAL"
  | "TRUMP";

/**
 * How virtual liquidity is distributed across the curve.
 * More liquidity in a range => more quote demand is required to move price
 * through it => price moves SLOWER there.
 */
export type LiquidityProfile =
  | "uniform"
  | "discovery"
  | "accumulation"
  | "rwa";

export interface Segment {
  index: number;
  /** Lower price bound of the range, in quote-per-base. */
  lowerPrice: number;
  /** Upper price bound of the range, in quote-per-base. */
  upperPrice: number;
  /** Virtual liquidity `L` for this range. */
  liquidity: number;
}

export interface LaunchConfig {
  baseSymbol: string;
  quote: QuoteSymbol;
  /** Price at the very start of the curve (quote per base). */
  startPrice: number;
  /** Price the curve graduates at — becomes the DAMM v2 migration price. */
  endPrice: number;
  /** Number of constant-product ranges the curve is split into. */
  segments: number;
  profile: LiquidityProfile;
  /** -1 .. +1. Positive skews liquidity toward the end (fast early price). */
  bias: number;
  /**
   * Quote reserve required before the launch graduates, in quote units.
   * Meteora's mainnet keepers use fixed values per quote mint (e.g. 10 SOL,
   * 750 USDC, 1500 JUP) — see `MIGRATION_THRESHOLDS`.
   */
  migrationQuoteThreshold: number;
  /** Total base token supply minted for the launch. */
  baseSupply: number;
  /** SPL token decimals. The program accepts 6 to 9. */
  tokenDecimals: number;
  /** Trading fee, in basis points of the swap amount. */
  baseFeeBps: number;
  /** Enables the volatility-reactive dynamic fee layer. */
  dynamicFee: boolean;
  /** Creator share of the LP fee portion, in bps (0–10000). */
  creatorShareBps: number;
  /** Creator migration fee, as a percentage of the migration threshold. */
  migrationFeePct: number;
  /** Pool creation fee paid by the creator, in SOL. */
  poolCreationFeeSol: number;
  /** Attach a referral address share (20% of the protocol fee). */
  referral: boolean;
}

export const DEFAULT_CONFIG: LaunchConfig = {
  baseSymbol: "NEW",
  quote: "USDC",
  startPrice: 0.000001,
  endPrice: 0.00001,
  segments: 8,
  profile: "uniform",
  bias: 0,
  migrationQuoteThreshold: 750,
  baseSupply: 1_000_000_000,
  tokenDecimals: 9,
  baseFeeBps: 25,
  dynamicFee: false,
  creatorShareBps: 5000,
  migrationFeePct: 2,
  poolCreationFeeSol: 0.5,
  referral: false,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Relative liquidity weight for a position along the curve (t in [0, 1]).
 * Profiles encode the "shape" of price discovery; `bias` tilts any profile.
 */
export function liquidityWeight(
  profile: LiquidityProfile,
  t: number,
  bias: number,
): number {
  const x = clamp(t, 0, 1);
  let w: number;

  switch (profile) {
    case "discovery":
      // Thin liquidity early => price jumps quickly during price discovery.
      w = 0.35 + (1.65 - 0.35) * x;
      break;
    case "accumulation":
      // Deep liquidity early => steady, gradual climb; fast late.
      w = 1.65 - (1.65 - 0.35) * x;
      break;
    case "rwa":
      // Deep and even, gently thinning: tight band, low slippage.
      w = 1.25 - 0.25 * x;
      break;
    case "uniform":
    default:
      w = 1;
      break;
  }

  // Bias > 0 pushes liquidity toward the end => faster early price movement.
  const tilt = 1 + bias * (x - 0.5) * 1.5;
  return Math.max(0.05, w * tilt);
}

/**
 * Split the curve into constant-product ranges.
 *
 * Segments are partitioned evenly in sqrt-price space (not linear price),
 * which is what makes each range a proper x*y=k bin.
 */
export function buildSegments(config: LaunchConfig): Segment[] {
  // Enforced rather than merely clamped by the caller so no code path can
  // produce a curve the on-chain program would reject.
  const n = Math.min(
    MAX_SEGMENTS,
    Math.max(MIN_SEGMENTS, Math.floor(config.segments)),
  );
  const p0 = Math.max(config.startPrice, Number.MIN_VALUE);
  const p1 = Math.max(config.endPrice, p0 * (1 + 1e-12));

  const sqrtStart = Math.sqrt(p0);
  const sqrtEnd = Math.sqrt(p1);
  const step = (sqrtEnd - sqrtStart) / n;

  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const w = liquidityWeight(config.profile, t, config.bias);
    weights.push(w);
    weightSum += w;
  }

  // Normalise so the whole curve costs exactly the migration threshold:
  //   total quote = sum(L_i * step) = step * sum(L_i) = threshold
  // Reshaping the profile redistributes *where* the quote is spent without
  // changing the graduation cost.
  const Ltotal = config.migrationQuoteThreshold / Math.max(step, 1e-30);

  const segments: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const lowerSqrt = sqrtStart + step * i;
    const upperSqrt = sqrtStart + step * (i + 1);
    segments.push({
      index: i,
      lowerPrice: lowerSqrt * lowerSqrt,
      upperPrice: upperSqrt * upperSqrt,
      liquidity: (Ltotal * weights[i]) / weightSum,
    });
  }
  return segments;
}

/** Quote tokens collected traversing one full segment. */
export function quoteInSegment(seg: Segment): number {
  return seg.liquidity * (Math.sqrt(seg.upperPrice) - Math.sqrt(seg.lowerPrice));
}

/** Base tokens sold traversing one full segment. */
export function baseInSegment(seg: Segment): number {
  return (
    seg.liquidity * (1 / Math.sqrt(seg.lowerPrice) - 1 / Math.sqrt(seg.upperPrice))
  );
}

/**
 * Migration Quote Threshold = sum over segments of L_i * (sqrt(P_i) - sqrt(P_{i-1}))
 * The pool graduates once quote reserve reaches this value.
 */
export function migrationThreshold(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + quoteInSegment(s), 0);
}

/** Base tokens sold across the whole completed curve. */
export function baseAtGraduation(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + baseInSegment(s), 0);
}

/**
 * Solve for the price reached after `quoteAmount` of buy pressure.
 * Walks segments; within a segment, sqrt price advances linearly with quote.
 */
export function priceAfterQuote(
  segments: Segment[],
  quoteAmount: number,
): { price: number; sqrtPrice: number; exhausted: boolean } {
  let remaining = Math.max(0, quoteAmount);
  let sqrtPrice = Math.sqrt(segments[0]?.lowerPrice ?? 0);

  for (const seg of segments) {
    const capacity = quoteInSegment(seg);
    const lowerSqrt = Math.sqrt(seg.lowerPrice);
    if (remaining <= capacity || capacity <= 0) {
      sqrtPrice = lowerSqrt + (capacity > 0 ? remaining / seg.liquidity : 0);
      return {
        price: sqrtPrice * sqrtPrice,
        sqrtPrice,
        exhausted: remaining >= capacity && capacity > 0,
      };
    }
    remaining -= capacity;
    sqrtPrice = Math.sqrt(seg.upperPrice);
  }
  const last = segments[segments.length - 1];
  const endSqrt = last ? Math.sqrt(last.upperPrice) : sqrtPrice;
  return { price: endSqrt * endSqrt, sqrtPrice: endSqrt, exhausted: true };
}

/**
 * Base tokens received for `quoteAmount` of buy pressure.
 * Base Amount = L * (1/sqrt(P_lower) - 1/sqrt(P_upper))
 */
export function baseForQuote(
  segments: Segment[],
  quoteAmount: number,
): {
  base: number;
  avgPrice: number;
  quoteConsumed: number;
  filled: boolean;
} {
  let remaining = Math.max(0, quoteAmount);
  let consumed = 0;
  let base = 0;

  for (const seg of segments) {
    if (remaining <= 0) break;
    const capacity = quoteInSegment(seg);
    const lowerSqrt = Math.sqrt(seg.lowerPrice);
    const take = Math.min(remaining, capacity);

    const upperSqrt =
      capacity > 0 ? lowerSqrt + take / seg.liquidity : lowerSqrt;
    const upperSqrtCapped = Math.min(upperSqrt, Math.sqrt(seg.upperPrice));
    base +=
      seg.liquidity * (1 / lowerSqrt - 1 / Math.max(upperSqrtCapped, 1e-30));
    consumed += take;
    remaining -= take;
  }

  const avgPrice = base > 0 ? consumed / base : 0;
  return { base, avgPrice, quoteConsumed: consumed, filled: remaining <= 1e-12 };
}

/**
 * Migration quote thresholds Meteora's mainnet keepers actually accept.
 * Source: https://docs.meteora.ag/developer-guides/dbc
 */
export const MIGRATION_THRESHOLDS: Record<QuoteSymbol, number> = {
  SOL: 10,
  USDC: 750,
  TRUMP: 100,
  JUP: 1500,
  USD1: 750,
  MET: 1500,
  JupUSD: 750,
  VIRTUAL: 42000,
};

/** Sampled (quote reserve, price) points for charting the curve. */
export function curvePoints(
  segments: Segment[],
  steps = 160,
): { quote: number; price: number }[] {
  const total = migrationThreshold(segments);
  const out: { quote: number; price: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const q = (total * i) / steps;
    out.push({ quote: q, price: priceAfterQuote(segments, q).price });
  }
  return out;
}

/** Convert a bps fee to the on-chain numerator (denominator 1e9). */
export function feeNumerator(bps: number): number {
  return Math.round((bps / 10_000) * FEE_DENOMINATOR);
}

export interface FeeBreakdown {
  totalFeeNumerator: number;
  totalFeePct: number;
  capped: boolean;
  protocol: number;
  referral: number;
  creator: number;
  partner: number;
}

/**
 * Total Trading Fee = Base Fee + Dynamic Fee, capped at 990,000,000.
 * Protocol Fee = Trading Fee * 20%.
 * Referral Fee = Protocol Fee * 20%.
 * Creator Fee = LP Fee * Creator Trading Fee Percentage.
 */
export function feeBreakdown(
  config: LaunchConfig,
  quoteVolume: number,
  dynamicFeeNumerator = 0,
): FeeBreakdown {
  const base = feeNumerator(config.baseFeeBps);
  const raw = base + (config.dynamicFee ? dynamicFeeNumerator : 0);
  const total = Math.min(raw, MAX_TRADING_FEE);
  const feeAmount = (total / FEE_DENOMINATOR) * quoteVolume;

  const protocol = feeAmount * PROTOCOL_FEE_SHARE;
  const referral = config.referral ? protocol * REFERRAL_FEE_SHARE : 0;
  const lpFee = feeAmount - protocol;
  const creatorShare = clamp(config.creatorShareBps, 0, 10_000) / 10_000;
  const creator = lpFee * creatorShare;
  const partner = lpFee - creator;

  return {
    totalFeeNumerator: total,
    totalFeePct: (total / FEE_DENOMINATOR) * 100,
    capped: raw > MAX_TRADING_FEE,
    protocol,
    referral,
    creator,
    partner,
  };
}

/**
 * Migration Quote Amount = ceil(Threshold * (100 - MigrationFee%) / 100)
 * Migration Fee = Threshold - Migration Quote Amount
 */
export function migrationNumbers(config: LaunchConfig, threshold: number) {
  const pct = clamp(config.migrationFeePct, 0, 100);
  const amount = Math.ceil((threshold * (100 - pct)) / 100);
  const fee = threshold - amount;
  return { migrationQuoteAmount: amount, migrationFee: fee };
}

/**
 * Total Surplus = Quote Reserve - Migration Quote Threshold
 * Partner & Creator Surplus = floor(Total Surplus * 80%)
 * Protocol Surplus = Total Surplus - Partner & Creator Surplus
 */
export function surplusNumbers(quoteReserve: number, threshold: number) {
  const total = Math.max(0, quoteReserve - threshold);
  const shared = Math.floor(total * (1 - PROTOCOL_SURPLUS_SHARE));
  return { totalSurplus: total, partnerAndCreator: shared, protocol: total - shared };
}

/**
 * Protocol Pool Creation Fee = Pool Creation Fee * 10%
 * Partner Pool Creation Fee = Pool Creation Fee - Protocol Pool Creation Fee
 */
export function poolCreationSplit(sol: number) {
  const fee = clamp(sol, MIN_POOL_CREATION_FEE_SOL, MAX_POOL_CREATION_FEE_SOL);
  const protocol = fee * 0.1;
  return { total: fee, protocol, partner: fee - protocol };
}

/**
 * Leftover = Remaining Base Vault - Protocol/Trading Base Fees - Protocol
 * Migration Base Fee. The vault-side fee balances are on-chain state we cannot
 * know offline, so this exposes the raw remainder and flags the distinction.
 */
export function leftover(config: LaunchConfig, segments: Segment[]) {
  const sold = baseAtGraduation(segments);
  const remaining = Math.max(0, config.baseSupply - sold);
  return { sold, remaining, isSimplified: true };
}

/* ------------------------------------------------------------------ */
/* On-chain validation                                                 */
/* ------------------------------------------------------------------ */

export type Severity = "error" | "warning";

export interface ValidationIssue {
  field: keyof LaunchConfig;
  severity: Severity;
  message: string;
}

/**
 * Check a configuration against the constraints the on-chain program enforces.
 * Returns `error` for anything that would make `create_config` fail, and
 * `warning` for configurations that are legal but unlikely to launch well.
 *
 * Constraint sources:
 *   - universal-curve (segment count, price ordering, sqrt price bounds)
 *   - launch-configurations (supply, migration, pool creation fee, decimals)
 *   - DBC fee constants exported by the official SDK
 */
export function validateConfig(config: LaunchConfig): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const error = (field: keyof LaunchConfig, message: string) =>
    out.push({ field, severity: "error", message });
  const warn = (field: keyof LaunchConfig, message: string) =>
    out.push({ field, severity: "warning", message });

  // --- price bounds -------------------------------------------------
  if (!Number.isFinite(config.startPrice) || config.startPrice < MIN_PRICE || config.startPrice > MAX_PRICE) {
    error(
      "startPrice",
      `Start price must be finite and within [${MIN_PRICE.toExponential(2)}, ${MAX_PRICE.toExponential(2)}] — the program stores sqrt price as unsigned 64.64.`,
    );
  }
  if (!Number.isFinite(config.endPrice) || config.endPrice < MIN_PRICE || config.endPrice > MAX_PRICE) {
    error("endPrice", `Migration price must be within [${MIN_PRICE.toExponential(2)}, ${MAX_PRICE.toExponential(2)}].`);
  } else if (config.endPrice <= config.startPrice) {
    error(
      "endPrice",
      "Migration price must be above the start price — prices must increase across curve points.",
    );
  }

  // --- curve shape --------------------------------------------------
  if (!Number.isInteger(config.segments) || config.segments < MIN_SEGMENTS || config.segments > MAX_SEGMENTS) {
    error("segments", `The universal curve accepts 1 to ${MAX_SEGMENTS} segments (up to 16 curve points).`);
  } else if (config.segments === 1) {
    warn(
      "segments",
      "Single-segment curve: legal, but there are no distinct launch phases — early discovery, distribution and migration all share one price behaviour.",
    );
  } else if (config.segments > 10) {
    warn(
      "segments",
      `${config.segments} segments is a lot of phases to communicate. The docs warn that a more complex curve is not automatically a better one.`,
    );
  }
  if (config.profile === "uniform" && config.bias === 0 && config.segments > 1) {
    // buildSegments clamps to MAX_SEGMENTS, so report the effective count.
    const effective = Math.min(config.segments, MAX_SEGMENTS);
    warn(
      "profile",
      `${effective} segments all share the same liquidity, so they behave exactly like a single segment — the split creates no distinct launch phase.`,
    );
  }

  // --- fees ---------------------------------------------------------
  if (!Number.isFinite(config.baseFeeBps) || config.baseFeeBps < MIN_FEE_BPS || config.baseFeeBps > MAX_FEE_BPS) {
    error("baseFeeBps", `Trading fee must be between ${MIN_FEE_BPS} and ${MAX_FEE_BPS} bps (MIN_FEE_BPS / MAX_FEE_BPS).`);
  }
  if (config.creatorShareBps < 0 || config.creatorShareBps > 10_000) {
    error("creatorShareBps", "Creator trading fee percentage must be 0 to 10000 bps — it splits the non-protocol fee between creator and partner.");
  }

  // --- migration ----------------------------------------------------
  if (!Number.isFinite(config.migrationFeePct) || config.migrationFeePct < 0 || config.migrationFeePct > MAX_MIGRATION_FEE_PCT) {
    error("migrationFeePct", `Migration fee percentage must be 0 to ${MAX_MIGRATION_FEE_PCT}%.`);
  }

  // --- pool creation fee -------------------------------------------
  const fee = config.poolCreationFeeSol;
  if (fee < 0 || fee > MAX_POOL_CREATION_FEE_SOL || (fee > 0 && fee < MIN_POOL_CREATION_FEE_SOL)) {
    error(
      "poolCreationFeeSol",
      `Pool creation fee must be 0, or between ${MIN_POOL_CREATION_FEE_SOL} and ${MAX_POOL_CREATION_FEE_SOL} SOL (split 10% protocol / 90% partner).`,
    );
  }

  // --- token --------------------------------------------------------
  if (!Number.isInteger(config.tokenDecimals) || config.tokenDecimals < MIN_TOKEN_DECIMALS || config.tokenDecimals > MAX_TOKEN_DECIMALS) {
    error("tokenDecimals", `Token decimals must be an integer from ${MIN_TOKEN_DECIMALS} to ${MAX_TOKEN_DECIMALS}.`);
  }
  if (!Number.isFinite(config.migrationQuoteThreshold) || config.migrationQuoteThreshold <= 0) {
    error("migrationQuoteThreshold", "Migration quote threshold must be positive — the curve has to be able to reach it.");
  }
  if (!Number.isFinite(config.baseSupply) || config.baseSupply <= 0) {
    error("baseSupply", "Base supply must be positive.");
    return out;
  }

  // --- reachability -------------------------------------------------
  // Only meaningful once the curve itself can be built.
  const blockers = out.filter((i) => i.severity === "error");
  if (blockers.length === 0) {
    const segs = buildSegments(config);
    const sold = baseAtGraduation(segs);
    const threshold = migrationThreshold(segs);

    if (sold > config.baseSupply) {
      error(
        "baseSupply",
        `The curve sells ${sold.toPrecision(6)} base tokens to graduate but only ${config.baseSupply.toPrecision(6)} exist — the launch could never reach its migration threshold.`,
      );
    } else if (sold < config.baseSupply * 0.5) {
      warn(
        "baseSupply",
        `Only ${((sold / config.baseSupply) * 100).toFixed(1)}% of supply is reachable through the curve, so ${((1 - sold / config.baseSupply) * 100).toFixed(1)}% becomes leftover rather than circulating.`,
      );
    }

    if (config.startPrice > 0) {
      const multiple = config.endPrice / config.startPrice;
      if (multiple > 1000) {
        warn(
          "endPrice",
          `A ${multiple.toPrecision(3)}x move to graduation is extreme — most buyers will not hold that far.`,
        );
      }
    }

    // docs: "Migration threshold must be reachable" is enforced by the program
    // deriving sqrt price from threshold + curve; a zero-length curve breaks it.
    if (threshold <= 0) {
      error("migrationQuoteThreshold", "Derived migration threshold is zero — the curve cannot graduate.");
    }
  }

  return out;
}

/** Convenience: true when nothing would be rejected on-chain. */
export function isValidConfig(config: LaunchConfig): boolean {
  return !validateConfig(config).some((i) => i.severity === "error");
}
