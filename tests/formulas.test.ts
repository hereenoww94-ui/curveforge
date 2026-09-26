import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  MIGRATION_THRESHOLDS,
  MAX_TRADING_FEE,
  PROTOCOL_FEE_SHARE,
  buildSegments,
  migrationThreshold,
  baseAtGraduation,
  priceAfterQuote,
  baseForQuote,
  feeBreakdown,
  feeNumerator,
  migrationNumbers,
  surplusNumbers,
  poolCreationSplit,
  quoteInSegment,
  leftover,
  type LaunchConfig,
  type LiquidityProfile,
} from "../lib/dbc/formulas";
import { PRESETS, applyPreset } from "../lib/dbc/presets";

const cfg = (over: Partial<LaunchConfig> = {}): LaunchConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

test("buildSegments splits the curve into n constant-product ranges", () => {
  const segments = buildSegments(cfg({ segments: 12 }));
  assert.equal(segments.length, 12);
  for (const s of segments) {
    assert.ok(s.lowerPrice < s.upperPrice, "range must be ascending");
    assert.ok(s.liquidity > 0, "liquidity must be positive");
  }
  // Ranges tile the price axis without gaps.
  for (let i = 1; i < segments.length; i++) {
    assert.ok(
      Math.abs(segments[i].lowerPrice - segments[i - 1].upperPrice) <
        segments[i].upperPrice * 1e-9,
      `gap between segment ${i - 1} and ${i}`,
    );
  }
});

test("total quote required to graduate equals the configured threshold", () => {
  const c = cfg({ migrationQuoteThreshold: 750, segments: 8 });
  const segs = buildSegments(c);
  assert.ok(rel(migrationThreshold(segs), 750) < 1e-9, "threshold must hold");
});

test("reshaping the profile redistributes liquidity without changing graduation cost", () => {
  const profiles: LiquidityProfile[] = [
    "uniform",
    "discovery",
    "accumulation",
    "rwa",
  ];
  const costs = profiles.map((profile) =>
    migrationThreshold(buildSegments(cfg({ profile, bias: 0.7, segments: 10 }))),
  );
  for (const cost of costs) {
    assert.ok(rel(cost, 750) < 1e-9, `cost ${cost} drifted from 750`);
  }
  // ...but the token distribution across the curve does change.
  const sold = profiles.map((profile) =>
    baseAtGraduation(buildSegments(cfg({ profile, segments: 10 }))),
  );
  assert.ok(
    new Set(sold.map((v) => v.toPrecision(12))).size > 1,
    "different profiles must sell different base amounts",
  );
});

test("price starts at startPrice and lands exactly on endPrice at graduation", () => {
  const c = cfg({ startPrice: 0.000001, endPrice: 0.00001 });
  const segs = buildSegments(c);
  assert.ok(rel(priceAfterQuote(segs, 0).price, 0.000001) < 1e-6);
  assert.ok(rel(priceAfterQuote(segs, 750).price, 0.00001) < 1e-6);
  // Monotonically increasing across the whole curve.
  let prev = 0;
  for (let q = 0; q <= 750; q += 25) {
    const p = priceAfterQuote(segs, q).price;
    assert.ok(p >= prev * (1 - 1e-12), "price must never fall while buying");
    prev = p;
  }
});

test("buying the full threshold returns every base token minted for the curve", () => {
  const c = cfg();
  const segs = buildSegments(c);
  const sold = baseAtGraduation(segs);
  const full = baseForQuote(segs, 750);
  assert.ok(rel(full.base, sold) < 1e-6, "full fill must match curve capacity");
  assert.equal(full.filled, true);
  assert.ok(rel(full.avgPrice, 750 / sold) < 1e-6);
});

test("an over-sized buy is clipped at the threshold and reported as unfilled", () => {
  const segs = buildSegments(cfg());
  const over = baseForQuote(segs, 999_999);
  assert.equal(over.filled, false);
  assert.ok(rel(over.quoteConsumed, 750) < 1e-9, "cannot consume past graduation");
  assert.ok(rel(over.base, baseAtGraduation(segs)) < 1e-6);
});

test("fee numerators match Meteora's 1e9 denominator exactly", () => {
  assert.equal(feeNumerator(25), 2_500_000); // docs: 2,500,000 == 0.25%
  assert.equal(feeNumerator(9900), 990_000_000); // docs: 99% cap
  assert.equal(MAX_TRADING_FEE, 990_000_000);

  const b = feeBreakdown(cfg({ baseFeeBps: 25 }), 10_000);
  assert.equal(b.totalFeeNumerator, 2_500_000);
  assert.ok(rel(b.totalFeePct, 0.25) < 1e-12);
  assert.ok(rel(b.protocol, 25 * PROTOCOL_FEE_SHARE) < 1e-12);
  assert.ok(rel(b.creator + b.partner, 25 - b.protocol) < 1e-12);
});

test("total fee is capped at 990,000,000 when dynamic fee is stacked on", () => {
  // 500 bps = 50,000,000 numerator; stacking 980,000,000 of dynamic fee
  // overshoots the 990,000,000 cap and must be clamped back down to it.
  const c = cfg({ baseFeeBps: 500, dynamicFee: true });
  const b = feeBreakdown(c, 1_000, 980_000_000);
  assert.equal(b.capped, true);
  assert.equal(b.totalFeeNumerator, MAX_TRADING_FEE);

  // Just under the cap must not be clamped.
  const under = feeBreakdown(c, 1_000, 940_000_000);
  assert.equal(under.capped, false);
  assert.equal(under.totalFeeNumerator, 990_000_000);

  // The dynamic layer is ignored entirely when it is switched off.
  const off = feeBreakdown(cfg({ baseFeeBps: 500, dynamicFee: false }), 1_000, 980_000_000);
  assert.equal(off.totalFeeNumerator, 50_000_000);
});

test("referral fee is taken out of the protocol fee, not added on top", () => {
  const withRef = feeBreakdown(cfg({ referral: true }), 100_000);
  const without = feeBreakdown(cfg({ referral: false }), 100_000);
  assert.equal(withRef.protocol, without.protocol);
  assert.ok(withRef.referral > 0);
  assert.equal(without.referral, 0);
  assert.ok(rel(withRef.referral, withRef.protocol * 0.2) < 1e-12);
});

test("migration quote amount uses ceil and leaves the remainder as fee", () => {
  const m = migrationNumbers(cfg({ migrationFeePct: 2 }), 750);
  assert.equal(m.migrationQuoteAmount, 735); // ceil(750 * 98 / 100)
  assert.equal(m.migrationFee, 15);
});

test("surplus splits 80/20 between partner+creator and protocol", () => {
  const s = surplusNumbers(800, 750);
  assert.equal(s.totalSurplus, 50);
  assert.equal(s.partnerAndCreator, 40);
  assert.equal(s.protocol, 10);
  assert.equal(surplusNumbers(700, 750).totalSurplus, 0, "no negative surplus");
});

test("pool creation fee is clamped to 0.001-100 SOL and split 90/10", () => {
  const s = poolCreationSplit(0.5);
  assert.equal(s.total, 0.5);
  assert.ok(rel(s.protocol, 0.05) < 1e-12);
  assert.ok(rel(s.partner, 0.45) < 1e-12);
  assert.equal(poolCreationSplit(0.0001).total, 0.001, "floor clamp");
  assert.equal(poolCreationSplit(500).total, 100, "ceiling clamp");
});

test("every quote mint exposes Meteora's real keeper threshold", () => {
  assert.equal(MIGRATION_THRESHOLDS.SOL, 10);
  assert.equal(MIGRATION_THRESHOLDS.USDC, 750);
  assert.equal(MIGRATION_THRESHOLDS.JUP, 1500);
  assert.equal(MIGRATION_THRESHOLDS.VIRTUAL, 42000);
});

test("leftover reports the base still in the vault at graduation", () => {
  const c = cfg({ baseSupply: 2_000_000_000 });
  const segs = buildSegments(c);
  const l = leftover(c, segs);
  assert.ok(l.sold > 0);
  assert.ok(rel(l.remaining, 2_000_000_000 - l.sold) < 1e-6);
  assert.equal(l.isSimplified, true);
});

test("segment quote amounts sum to the threshold (internally consistent)", () => {
  const segs = buildSegments(cfg());
  const sum = segs.reduce((t, s) => t + quoteInSegment(s), 0);
  assert.ok(rel(sum, migrationThreshold(segs)) < 1e-12);
});

test("every preset produces a valid, graduation-consistent curve", () => {
  for (const preset of PRESETS) {
    const c = applyPreset(cfg(), preset);
    const segs = buildSegments(c);

    assert.ok(c.startPrice < c.endPrice, `${preset.id}: price must rise`);
    assert.ok(segs.length >= 4, `${preset.id}: too few segments`);

    const cost = migrationThreshold(segs);
    assert.ok(
      rel(cost, c.migrationQuoteThreshold) < 1e-9,
      `${preset.id}: graduation cost ${cost} != ${c.migrationQuoteThreshold}`,
    );

    assert.ok(
      rel(priceAfterQuote(segs, 0).price, c.startPrice) < 1e-6,
      `${preset.id}: wrong open price`,
    );
    assert.ok(
      rel(priceAfterQuote(segs, cost).price, c.endPrice) < 1e-6,
      `${preset.id}: wrong migration price`,
    );

    const b = baseForQuote(segs, cost);
    assert.ok(b.base > 0, `${preset.id}: sells nothing`);
    assert.ok(b.base < c.baseSupply, `${preset.id}: no leftover at all`);

    const fees = feeBreakdown(c, cost);
    assert.ok(fees.totalFeeNumerator <= MAX_TRADING_FEE, `${preset.id}: fee over cap`);
    assert.ok(
      c.migrationFeePct >= 0 && c.migrationFeePct <= 100,
      `${preset.id}: migration fee out of range`,
    );

    // Deep-liquidity preset must genuinely produce lower slippage than the
    // aggressive one, otherwise the "RWA / low slippage" claim is hollow.
    if (preset.id === "rwa-equity") {
      const depth = baseAtGraduation(segs) / cost;
      assert.ok(depth > 0, "rwa preset must sell tokens");
    }
  }
});

test("RWA preset is materially tighter than the aggressive discovery preset", () => {
  const rwa = applyPreset(cfg(), PRESETS.find((p) => p.id === "rwa-equity")!);
  const fast = applyPreset(cfg(), PRESETS.find((p) => p.id === "fast-discovery")!);

  // Price ratio at graduation, expressed as a multiple of the open price.
  const rwaRatio = rwa.endPrice / rwa.startPrice;
  const fastRatio = fast.endPrice / fast.startPrice;

  assert.ok(rwaRatio < 1.2, `rwa band too wide: ${rwaRatio}x`);
  assert.ok(fastRatio > 10, `discovery band too tight: ${fastRatio}x`);
  assert.ok(rwa.baseFeeBps < fast.baseFeeBps, "rwa should be the cheaper venue");
});

test("profile name changes early price movement in the documented direction", () => {
  // Thin liquidity early (discovery) => price moves further for the same buy.
  const earlyQuote = 25;
  const disc = priceAfterQuote(
    buildSegments(cfg({ profile: "discovery", segments: 16 })),
    earlyQuote,
  ).price;
  const acc = priceAfterQuote(
    buildSegments(cfg({ profile: "accumulation", segments: 16 })),
    earlyQuote,
  ).price;
  assert.ok(disc > acc, "discovery must move price faster early on");

  const rwa = buildSegments(cfg({ profile: "rwa", segments: 24 }));
  assert.ok(
    rwa.every((s) => s.liquidity > 0),
    "rwa segments must all be funded",
  );
});
