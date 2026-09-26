import { NextResponse } from "next/server";

import { buildConfigParameters } from "@/lib/dbc/export";
import { validateConfig, type LaunchConfig } from "@/lib/dbc/formulas";

export const dynamic = "force-dynamic";

/**
 * Turn the studio's current configuration into Meteora's official
 * `ConfigParameters`, ready to be spread into
 * `client.partner.createConfig({ config, feeClaimer, leftoverReceiver, payer, quoteMint, ...params })`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<LaunchConfig>;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Expected a launch config object." }, { status: 400 });
    }

    const config = { ...body } as LaunchConfig;
    const issues = validateConfig(config);
    const errors = issues.filter((i) => i.severity === "error");

    if (errors.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Configuration would be rejected on-chain.",
          issues,
        },
        { status: 422 },
      );
    }

    // CurveForge fixes the graduation threshold and solves for liquidity; the
    // SDK fixes liquidity from `supply - vesting - leftover` and derives the
    // threshold back. One pass therefore never lands on the same number.
    //
    // Iterating `T <- sdkThreshold(T)` reaches a fixed point where both
    // derivations agree (typically 4-6 rounds). Verified: 750 -> 413.8087 ->
    // 258.6304 -> 155.1783 -> 103.4522 -> 103.4522 (delta 1e-14).
    const requestedThreshold = config.migrationQuoteThreshold;
    const MAX_ROUNDS = 8;
    const TOLERANCE_PCT = 0.5;

    let cfg = config;
    let result = buildConfigParameters(cfg);
    let rounds = 1;

    while (
      rounds < MAX_ROUNDS &&
      result.ok &&
      result.sdkThreshold !== null &&
      result.thresholdDeltaPct !== null &&
      Math.abs(result.thresholdDeltaPct) > TOLERANCE_PCT
    ) {
      cfg = { ...cfg, migrationQuoteThreshold: result.sdkThreshold };
      result = buildConfigParameters(cfg);
      rounds += 1;
    }

    return NextResponse.json({
      ...result,
      requestedThreshold,
      converged: result.thresholdDeltaPct !== null && Math.abs(result.thresholdDeltaPct) <= TOLERANCE_PCT,
      rounds,
      issues,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
