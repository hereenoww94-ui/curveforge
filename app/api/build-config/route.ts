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

    // CurveForge sizes the curve so a full traversal costs exactly the
    // graduation threshold we were asked for. Meteora's SDK re-derives the
    // threshold from `supply - vesting - leftover` plus its own fee/vesting
    // factors, and for a fixed price ladder that derivation is *linear* in the
    // figure we pass: `sdkThreshold(T) = c * T` with `c` a constant set by the
    // prices, weights and token decimals (measured 0.7634 on the default
    // config, 0.7027 on Discovery, 0.7714 on RWA).
    //
    // That makes the obvious iteration `T <- sdkThreshold(T)` useless: its only
    // fixed point is 0. Left running it decays 750 -> 572 -> 437 -> 333 -> ...
    // for ever and always reports "did not converge" — the supply cannot be
    // nudged out of it either, because `leftover = baseSupply - sellable`
    // absorbs the change and `c` never moves.
    //
    // The question a launcher actually has is different: "make the program
    // enforce MY number". So we solve for that directly with the inverse step
    //     T <- target * T / sdkThreshold(T)
    // which lands in 1-2 rounds whenever the relation is linear (residual
    // ~1e-7%) and in a handful more when integer `leftover` quantisation makes
    // it slightly non-linear.
    const targetThreshold = config.migrationQuoteThreshold;
    const MAX_ROUNDS = 12;
    const TOLERANCE_PCT = 0.5;

    const pctOff = (sdk: number) => ((sdk - targetThreshold) / targetThreshold) * 100;

    let cfg = config;
    let result = buildConfigParameters(cfg);
    let rounds = 1;

    while (
      rounds < MAX_ROUNDS &&
      result.ok &&
      result.sdkThreshold !== null &&
      Math.abs(pctOff(result.sdkThreshold)) > TOLERANCE_PCT
    ) {
      const current = cfg.migrationQuoteThreshold;
      const next = (targetThreshold * current) / result.sdkThreshold;
      // A non-finite or non-positive step would make things worse; bail with
      // whatever we have rather than loop on garbage.
      if (!Number.isFinite(next) || next <= 0) break;
      cfg = { ...cfg, migrationQuoteThreshold: next };
      result = buildConfigParameters(cfg);
      rounds += 1;
    }

    // What the on-chain program will enforce, relative to what was requested.
    // This — not `thresholdDeltaPct`, which stays the raw curve-vs-SDK gap and
    // exists to explain *why* the scaling is needed — is the success metric.
    const enforcementDeltaPct = result.sdkThreshold === null ? null : pctOff(result.sdkThreshold);

    return NextResponse.json({
      ...result,
      requestedThreshold: targetThreshold,
      enforcementDeltaPct,
      converged: enforcementDeltaPct !== null && Math.abs(enforcementDeltaPct) <= TOLERANCE_PCT,
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
