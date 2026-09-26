import { buildConfigParameters } from "../lib/dbc/export";
import type { LaunchConfig } from "../lib/dbc/formulas";

const DEFAULTS = {
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
  baseSymbol: "NEW",
  quote: "USDC",
} as unknown as LaunchConfig;

/** Solve sdk(T) = target using the inverse step T <- target * T / sdk(T). */
function inverse(label: string, cfg: LaunchConfig, target: number, rounds = 12) {
  let c = cfg;
  let result = buildConfigParameters(c);
  const trail: string[] = [];
  let done = false;
  let finalErr: number | null = null;

  for (let i = 1; i <= rounds; i++) {
    if (!result.ok) {
      console.log(`${label}: ERROR ${result.error}`);
      return;
    }
    const enforced = result.sdkThreshold;
    if (enforced === null) {
      console.log(`${label}: sdkThreshold null`);
      return;
    }
    const err = ((enforced - target) / target) * 100;
    finalErr = err;
    trail.push(`r${i}: T=${c.migrationQuoteThreshold.toFixed(4)} sdk=${enforced.toFixed(4)} err=${err.toExponential(2)}%`);
    if (Math.abs(err) <= 0.5) {
      done = true;
      break;
    }
    const T = c.migrationQuoteThreshold;
    const next = (target * T) / enforced;
    if (!Number.isFinite(next) || next <= 0) break;
    c = { ...c, migrationQuoteThreshold: next };
    result = buildConfigParameters(c);
  }

  console.log(
    `${label.padEnd(30)} ${done ? "CONVERGED" : "FAILED   "} ` +
      `inputT=${c.migrationQuoteThreshold.toFixed(6).padStart(14)} ` +
      `sdkEnforces=${result.sdkThreshold?.toFixed(6).padStart(14)} ` +
      `err=${finalErr === null ? "n/a" : finalErr.toExponential(2)}%`,
  );
  if (!done) trail.forEach((t) => console.log(`   ${t}`));
}

inverse("A default target 750", DEFAULTS, 750);
inverse("B discovery target 750", { ...DEFAULTS, profile: "discovery" } as LaunchConfig, 750);
inverse("C rwa target 750", { ...DEFAULTS, profile: "rwa" } as LaunchConfig, 750);
inverse(
  "D sAAPL target 103.45",
  {
    ...DEFAULTS,
    startPrice: 100,
    endPrice: 104,
    segments: 16,
    profile: "rwa",
    baseSupply: 10_000_000,
    migrationQuoteThreshold: 750,
  } as LaunchConfig,
  103.452173,
);
inverse("E default target 1", DEFAULTS, 1);
inverse("F default target 50000", DEFAULTS, 50_000);
inverse("G accumulation target 750", { ...DEFAULTS, profile: "accumulation" } as LaunchConfig, 750);
inverse(
  "H SOL quote target 3",
  { ...DEFAULTS, quote: "SOL", startPrice: 0.0001, endPrice: 0.01, migrationQuoteThreshold: 3, tokenDecimals: 9 } as LaunchConfig,
  3,
);
