"use client";

import { useState } from "react";

import type { LaunchConfig } from "@/lib/dbc/formulas";

interface Props {
  config: LaunchConfig;
}

type Result = {
  ok: boolean;
  payload: unknown;
  simulatorThreshold: number;
  sdkThreshold: number | null;
  /** Raw curve-cost vs SDK-derivation gap. Explains why we scale at all. */
  thresholdDeltaPct: number | null;
  /** What the on-chain program will enforce, relative to what was requested. */
  enforcementDeltaPct?: number | null;
  requestedThreshold?: number;
  converged?: boolean;
  rounds?: number;
  sellableBase: number;
  requiredSupply: number;
  curve: { prices: number[]; liquidityWeights: number[]; sqrtPrices: string[] };
  error: string | null;
  issues?: { field: string; severity: string; message: string }[];
};

function fmt(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toPrecision(digits);
  if (abs >= 1e-4) return n.toFixed(8).replace(/0+$/, "");
  return n.toExponential(3);
}

function metric(label: string, value: string, sub?: string, tone?: string) {
  return (
    <div
      style={{
        padding: "11px 13px",
        borderRadius: 10,
        background: "#0a0a12",
        border: "1px solid var(--line)",
        display: "grid",
        gap: 3,
      }}
    >
      <span className="label">{label}</span>
      <span className="stat-value mono" style={{ fontSize: 17, color: tone ?? "var(--text)" }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</span>}
    </div>
  );
}

export default function DeployPayload({ config }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/build-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setResult((await res.json()) as Result);
    } catch (e) {
      setResult({
        ok: false,
        payload: null,
        simulatorThreshold: 0,
        sdkThreshold: null,
        thresholdDeltaPct: null,
        sellableBase: 0,
        requiredSupply: 0,
        curve: { prices: [], liquidityWeights: [], sqrtPrices: [] },
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result?.payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const enforcementDeltaPct = result?.enforcementDeltaPct ?? null;
  // What the program would have enforced had we built the curve to cost
  // exactly the requested figure — the number the solver exists to avoid.
  const curveCostGapPct = result?.thresholdDeltaPct ?? null;
  const targetThreshold = result?.requestedThreshold ?? config.migrationQuoteThreshold;
  const naiveEnforcement = curveCostGapPct === null ? null : targetThreshold * (1 + curveCostGapPct / 100);
  /** SDK threshold as a percentage of the raw curve cost, i.e. the factor `c`. */
  const sdkFactorPct = curveCostGapPct === null ? null : 100 + curveCostGapPct;

  return (
    <div className="panel" style={{ padding: 18, display: "grid", gap: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong style={{ fontSize: 14 }}>Deploy payload</strong>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
            Runs Meteora&apos;s own <span className="mono">buildCurveWithCustomSqrtPrices()</span>{" "}
            server-side and returns ready-to-use <span className="mono">ConfigParameters</span>.
          </div>
        </div>
        <button
          type="button"
          className="chip"
          data-on={busy}
          style={{ borderRadius: 8, padding: "8px 18px" }}
          onClick={run}
          disabled={busy}
        >
          {busy ? "Building…" : result ? "Rebuild" : "Generate payload"}
        </button>
      </div>

      {result && !result.ok && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.32)",
            fontSize: 12.5,
            color: "#fecaca",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "#f87171" }}>SDK rejected this configuration. </strong>
          {result.error}
          {result.issues && result.issues.length > 0 && (
            <div style={{ marginTop: 6, color: "#fca5a5" }}>
              {result.issues
                .filter((i) => i.severity === "error")
                .map((i, n) => (
                  <div key={n}>
                    <span className="mono">{i.field}</span> — {i.message}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {result?.ok && (
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
              gap: 10,
            }}
          >
            {metric(
              "Requested threshold",
              `${fmt(result.requestedThreshold ?? config.migrationQuoteThreshold)} ${config.quote}`,
              "your graduation target",
              "#a78bfa",
            )}
            {metric(
              "Solved curve input",
              `${fmt(result.simulatorThreshold)} ${config.quote}`,
              "liquidity scale fed to the SDK",
              "#22d3ee",
            )}
            {metric(
              "Program enforces",
              `${fmt(result.sdkThreshold)} ${config.quote}`,
              `${result.rounds ?? 1} round(s) — on-chain value`,
              "#34d399",
            )}
            {metric(
              "Enforcement delta",
              `${
                enforcementDeltaPct !== null
                  ? (enforcementDeltaPct >= 0 ? "+" : "") + enforcementDeltaPct.toExponential(1)
                  : "—"
              }%`,
              result.converged ? "on-chain matches your target" : "outside 0.5% tolerance",
              result.converged ? "#34d399" : "#fbbf24",
            )}
            {metric(
              "Initial supply",
              fmt(result.requiredSupply, 4),
              "sellable × 1.25 (dynamic-supply default)",
              result.requiredSupply > config.baseSupply ? "#f87171" : undefined,
            )}
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(34,211,238,0.06)",
              border: "1px solid rgba(34,211,238,0.22)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "#a5b4fc",
            }}
          >
            <strong style={{ color: "#67e8f9" }}>
              Why the curve input is larger than your target:{" "}
            </strong>
            CurveForge sizes the price ladder so a full traversal costs exactly{" "}
            <span className="mono">{fmt(targetThreshold)}</span> {config.quote}. Meteora&apos;s SDK
            re-derives the threshold from{" "}
            <span className="mono">supply − vesting − leftover</span> plus its own fee and vesting
            factors, and on this ladder it lands at{" "}
            <span className="mono">{fmt(sdkFactorPct)}</span>% of the raw curve cost — so build the
            curve to cost exactly <span className="mono">{fmt(targetThreshold)}</span> and the program
            would graduate early, at <span className="mono">{fmt(naiveEnforcement)}</span>{" "}
            {config.quote}.
            <br />
            Iterating <span className="mono">T ← sdkThreshold(T)</span> cannot repair that: the
            relation is linear, so its only fixed point is <span className="mono">0</span> and the
            sequence decays <span className="mono">T → c·T → c²·T → …</span> forever. The supply
            cannot be nudged out of it either — <span className="mono">leftover = supply − sellable</span>{" "}
            absorbs every change, so any supply yields the same factor. CurveForge instead inverts
            the relation, <span className="mono">T ← target · T / sdkThreshold(T)</span>, which lands
            in {result.rounds ?? 1} round(s) and leaves the program enforcing{" "}
            <span className="mono">{fmt(result.sdkThreshold)}</span> {config.quote} — your number.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="chip" onClick={copy}>
              {copied ? "Copied ✓" : "Copy ConfigParameters"}
            </button>
            <button
              type="button"
              className="chip"
              data-on={showRaw}
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "Hide" : "Show"} raw payload
            </button>
          </div>

          {showRaw && (
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                background: "#0a0a12",
                border: "1px solid var(--line)",
                borderRadius: 10,
                fontSize: 11,
                lineHeight: 1.55,
                overflowX: "auto",
                maxHeight: 420,
                color: "#a5b4fc",
              }}
            >
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          )}

          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#8b8ba6" }}>
              Curve checkpoints sent to the SDK ({result.curve.prices.length} prices,{" "}
              {result.curve.liquidityWeights.length} weights)
            </summary>
            <pre
              className="mono"
              style={{
                padding: 12,
                background: "#0a0a12",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 11,
                marginTop: 8,
                overflowX: "auto",
                color: "#9ca3af",
              }}
            >
              {JSON.stringify(
                {
                  prices: result.curve.prices.map((p) => Number(p.toPrecision(8))),
                  liquidityWeights: result.curve.liquidityWeights.map((w) => Number(w.toPrecision(6))),
                },
                null,
                2,
              )}
            </pre>
          </details>

          <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.55 }}>
            Usage:{" "}
            <span className="mono">
              const tx = await client.partner.createConfig({"{ config, feeClaimer, leftoverReceiver, payer, quoteMint, ...params }"})
            </span>{" "}
            then sign with the payer and the new config keypair.
          </div>
        </div>
      )}

      {!result && !busy && (
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          Nothing generated yet. This calls the official SDK — it will refuse configs that violate
          on-chain rules, which is itself a useful check before you spend a transaction fee.
        </p>
      )}
    </div>
  );
}
