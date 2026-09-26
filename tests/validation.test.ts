import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  MIN_FEE_BPS,
  MAX_FEE_BPS,
  MAX_SEGMENTS,
  MIN_PRICE,
  MAX_PRICE,
  validateConfig,
  isValidConfig,
  buildSegments,
  type LaunchConfig,
} from "../lib/dbc/formulas";
import { PRESETS, applyPreset } from "../lib/dbc/presets";

const cfg = (over: Partial<LaunchConfig> = {}): LaunchConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

const errorsFor = (c: LaunchConfig) =>
  validateConfig(c).filter((i) => i.severity === "error");

const hasErrorOn = (c: LaunchConfig, field: keyof LaunchConfig) =>
  errorsFor(c).some((i) => i.field === field);

test("the default configuration is valid on-chain", () => {
  assert.deepEqual(errorsFor(DEFAULT_CONFIG), []);
  assert.equal(isValidConfig(DEFAULT_CONFIG), true);
});

test("every shipped preset passes on-chain validation with zero errors", () => {
  for (const preset of PRESETS) {
    const issues = validateConfig(applyPreset(cfg(), preset));
    const errors = issues.filter((i) => i.severity === "error");
    assert.deepEqual(
      errors,
      [],
      `${preset.id} would be rejected on-chain: ${errors.map((e) => e.message).join(" | ")}`,
    );
    assert.equal(isValidConfig(applyPreset(cfg(), preset)), true);
  }
});

test("rejects more than the universal curve's 16 segments", () => {
  assert.equal(MAX_SEGMENTS, 16);
  assert.ok(hasErrorOn(cfg({ segments: 17 }), "segments"));
  assert.ok(hasErrorOn(cfg({ segments: 20 }), "segments"));
  assert.ok(hasErrorOn(cfg({ segments: 24 }), "segments"));
  assert.ok(hasErrorOn(cfg({ segments: 0 }), "segments"));
  assert.ok(hasErrorOn(cfg({ segments: 2.5 }), "segments"));
  assert.ok(!hasErrorOn(cfg({ segments: 16 }), "segments"));
  assert.ok(!hasErrorOn(cfg({ segments: 1 }), "segments"));
});

test("buildSegments clamps rather than emitting an illegal curve", () => {
  const segs = buildSegments(cfg({ segments: 40 }));
  assert.equal(segs.length, MAX_SEGMENTS, "must clamp to 16");
  const too = buildSegments(cfg({ segments: -5 }));
  assert.equal(too.length, 1, "must clamp to a single segment");
});

test("rejects trading fees outside the SDK's MIN/MAX_FEE_BPS", () => {
  assert.equal(MIN_FEE_BPS, 25);
  assert.equal(MAX_FEE_BPS, 9900);
  assert.ok(hasErrorOn(cfg({ baseFeeBps: 0 }), "baseFeeBps"));
  assert.ok(hasErrorOn(cfg({ baseFeeBps: 10 }), "baseFeeBps"), "10 bps is below the on-chain floor");
  assert.ok(hasErrorOn(cfg({ baseFeeBps: 15 }), "baseFeeBps"));
  assert.ok(hasErrorOn(cfg({ baseFeeBps: 9901 }), "baseFeeBps"));
  assert.ok(!hasErrorOn(cfg({ baseFeeBps: 25 }), "baseFeeBps"));
  assert.ok(!hasErrorOn(cfg({ baseFeeBps: 9900 }), "baseFeeBps"));
});

test("rejects a non-increasing price curve", () => {
  assert.ok(hasErrorOn(cfg({ startPrice: 1, endPrice: 1 }), "endPrice"));
  assert.ok(hasErrorOn(cfg({ startPrice: 2, endPrice: 1 }), "endPrice"));
  assert.ok(!hasErrorOn(cfg({ startPrice: 1, endPrice: 1.0001 }), "endPrice"));
});

test("rejects prices outside the program's sqrt-price bounds", () => {
  assert.ok(hasErrorOn(cfg({ startPrice: 0 }), "startPrice"));
  assert.ok(hasErrorOn(cfg({ startPrice: -1 }), "startPrice"));
  assert.ok(hasErrorOn(cfg({ endPrice: MAX_PRICE * 10 }), "endPrice"));
  assert.ok(!hasErrorOn(cfg({ startPrice: MIN_PRICE * 2 }), "startPrice"));
  assert.ok(!hasErrorOn(cfg({ endPrice: MAX_PRICE * 0.5 }), "endPrice"));
});

test("rejects migration fees above 99%", () => {
  assert.ok(hasErrorOn(cfg({ migrationFeePct: 100 }), "migrationFeePct"));
  assert.ok(hasErrorOn(cfg({ migrationFeePct: -1 }), "migrationFeePct"));
  assert.ok(!hasErrorOn(cfg({ migrationFeePct: 99 }), "migrationFeePct"));
  assert.ok(!hasErrorOn(cfg({ migrationFeePct: 0 }), "migrationFeePct"));
});

test("rejects pool creation fees outside 0.001-100 SOL", () => {
  assert.ok(hasErrorOn(cfg({ poolCreationFeeSol: 0.0001 }), "poolCreationFeeSol"));
  assert.ok(hasErrorOn(cfg({ poolCreationFeeSol: 101 }), "poolCreationFeeSol"));
  assert.ok(!hasErrorOn(cfg({ poolCreationFeeSol: 0 }), "poolCreationFeeSol"), "0 means disabled");
  assert.ok(!hasErrorOn(cfg({ poolCreationFeeSol: 0.001 }), "poolCreationFeeSol"));
  assert.ok(!hasErrorOn(cfg({ poolCreationFeeSol: 100 }), "poolCreationFeeSol"));
});

test("rejects token decimals outside 6-9", () => {
  assert.ok(hasErrorOn(cfg({ tokenDecimals: 5 }), "tokenDecimals"));
  assert.ok(hasErrorOn(cfg({ tokenDecimals: 10 }), "tokenDecimals"));
  assert.ok(!hasErrorOn(cfg({ tokenDecimals: 6 }), "tokenDecimals"));
  assert.ok(!hasErrorOn(cfg({ tokenDecimals: 9 }), "tokenDecimals"));
});

test("rejects a supply too small for the curve to ever graduate", () => {
  // Wide price range + small threshold => curve sells far more than exists.
  const impossible = cfg({
    startPrice: 0.000001,
    endPrice: 0.001, // 1000x
    migrationQuoteThreshold: 750,
    baseSupply: 1_000, // nowhere near enough
  });
  assert.ok(hasErrorOn(impossible, "baseSupply"));
  assert.match(
    errorsFor(impossible).find((i) => i.field === "baseSupply")!.message,
    /never reach its migration threshold/,
  );
});

test("warns when most supply sits outside the curve as leftover", () => {
  const heavy = cfg({ baseSupply: 10_000_000_000_000 });
  const warnings = validateConfig(heavy).filter((i) => i.severity === "warning");
  assert.ok(
    warnings.some((i) => i.field === "baseSupply"),
    "expected a leftover warning",
  );
  assert.equal(isValidConfig(heavy), true, "warnings must not invalidate");
});

test("warns that uniform segments with no bias collapse into one phase", () => {
  const flat = cfg({ profile: "uniform", bias: 0, segments: 10 });
  const warnings = validateConfig(flat).filter((i) => i.severity === "warning");
  assert.ok(warnings.some((i) => i.field === "profile"));
  assert.equal(errorsFor(flat).length, 0, "still legal on-chain");
});

test("warns on a single-segment curve that offers no launch phases", () => {
  const one = cfg({ segments: 1 });
  const warnings = validateConfig(one).filter((i) => i.severity === "warning");
  assert.ok(warnings.some((i) => i.field === "segments"));
  assert.equal(errorsFor(one).length, 0);
});

test("a valid config builds a curve whose graduation math still holds", () => {
  const c = cfg();
  assert.equal(isValidConfig(c), true);
  const segs = buildSegments(c);
  assert.equal(segs.length, 8);
  assert.ok(segs.every((s) => s.liquidity > 0));
});
