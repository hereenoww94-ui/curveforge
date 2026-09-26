"use client";

import {
  buildSegments,
  migrationThreshold,
  baseAtGraduation,
  priceAfterQuote,
  baseForQuote,
  feeBreakdown,
  migrationNumbers,
  surplusNumbers,
  leftover,
  validateConfig,
  type LaunchConfig,
} from "@/lib/dbc/formulas";

interface Props {
  config: LaunchConfig;
  buyAmount: number;
  onBuyAmount: (v: number) => void;
}

/** Adaptive precision so both 0.0000004 and 12,500,000 read cleanly. */
function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toPrecision(digits);
  if (abs >= 1e-4) return n.toFixed(6).replace(/0+$/, "");
  return n.toExponential(3);
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: "#0a0a12",
        border: "1px solid var(--line)",
        display: "grid",
        gap: 3,
      }}
    >
      <span className="label">{label}</span>
      <span className="stat-value mono" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</span>}
    </div>
  );
}

export default function Simulator({ config, buyAmount, onBuyAmount }: Props) {
  const segments = buildSegments(config);
  const threshold = migrationThreshold(segments);
  const sold = baseAtGraduation(segments);
  const issues = validateConfig(config);

  const at = priceAfterQuote(segments, buyAmount);
  const buy = baseForQuote(segments, buyAmount);
  const fees = feeBreakdown(config, buyAmount);
  const migration = migrationNumbers(config, threshold);
  const surplus = surplusNumbers(buyAmount, threshold);
  const left = leftover(config, segments);

  const openPrice = config.startPrice;
  const impact = openPrice > 0 ? ((at.price - openPrice) / openPrice) * 100 : 0;
  const progress = threshold > 0 ? (buyAmount / threshold) * 100 : 0;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ---- what-if ---- */}
      <div className="panel" style={{ padding: 18, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 14 }}>What-if simulator</strong>
          <span className="mono" style={{ fontSize: 12, color: progress > 100 ? "#22d3ee" : "#34d399" }}>
            {progress.toFixed(1)}% of graduation
          </span>
        </div>

        <div className="field">
          <span className="label">
            Buy {fmt(buyAmount, 3)} {config.quote}
          </span>
          <input
            className="slider"
            type="range"
            min={0}
            max={Math.max(threshold * 1.1, 1e-9)}
            step={Math.max(threshold / 500, 1e-12)}
            value={Math.min(buyAmount, Math.max(threshold * 1.1, 1e-9))}
            onChange={(e) => onBuyAmount(Number(e.target.value))}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <Stat
            label="Price reached"
            value={fmt(at.price)}
            sub={`${config.quote} per ${config.baseSymbol}`}
            tone="#34d399"
          />
          <Stat
            label="Price impact"
            value={`${impact >= 0 ? "+" : ""}${fmt(impact, 3)}%`}
            sub="from the open price"
          />
          <Stat
            label="Tokens received"
            value={fmt(buy.base, 3)}
            sub={buy.filled ? "fully filled" : "clipped at graduation"}
            tone={buy.filled ? undefined : "#fbbf24"}
          />
          <Stat
            label="Average price"
            value={fmt(buy.avgPrice)}
            sub={`${fmt(buy.quoteConsumed, 3)} ${config.quote} consumed`}
          />
        </div>
      </div>

      {/* ---- fees ---- */}
      <div className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 14 }}>Fee split</strong>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            {fees.totalFeePct.toFixed(4)}% · numerator {fees.totalFeeNumerator.toLocaleString("en-US")}
            {fees.capped && <span style={{ color: "#fbbf24" }}> · CAPPED</span>}
          </span>
        </div>

        <div style={{ display: "grid", gap: 7, fontSize: 13 }}>
          {[
            ["Trading fee collected", fees.protocol + fees.creator + fees.partner, "#e8e8f2"],
            ["Protocol (20% of fee)", fees.protocol, "#a78bfa"],
            ["Partner / LP remainder", fees.partner, "#22d3ee"],
            ["Creator share", fees.creator, "#34d399"],
            ["Referral (20% of protocol)", fees.referral, "#fbbf24"],
          ].map(([label, value, color]) => (
            <div
              key={label as string}
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <span style={{ color: "var(--muted)" }}>{label as string}</span>
              <span className="mono" style={{ color: color as string }}>
                {fmt(value as number, 4)} {config.quote}
              </span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.5 }}>
          Protocol Fee = Trading Fee × 20%. Referral Fee = Protocol Fee × 20%, so it comes out of
          the protocol&apos;s cut rather than adding to the trader&apos;s cost. Creator Fee = LP fee ×
          creator percentage.
        </div>
      </div>

      {/* ---- migration ---- */}
      <div className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 14 }}>Graduation &amp; migration</strong>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Stat
            label="Migration quote threshold"
            value={`${fmt(threshold, 4)} ${config.quote}`}
            sub="quote reserve at graduation"
            tone="#22d3ee"
          />
          <Stat
            label="Migration price"
            value={fmt(config.endPrice)}
            sub="initialised into the DAMM v2 pool"
            tone="#22d3ee"
          />
          <Stat
            label="Migration quote amount"
            value={fmt(migration.migrationQuoteAmount, 4)}
            sub={`ceil(threshold × ${(100 - config.migrationFeePct).toFixed(1)}%)`}
          />
          <Stat
            label="Creator migration fee"
            value={`${fmt(migration.migrationFee, 4)} ${config.quote}`}
            sub={`${config.migrationFeePct}% of threshold`}
            tone="#34d399"
          />
        </div>

        <div className="hairline" />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Stat
            label="Surplus above threshold"
            value={`${fmt(surplus.totalSurplus, 4)} ${config.quote}`}
            sub="quote reserve beyond what the curve needed"
            tone={surplus.totalSurplus > 0 ? "#22d3ee" : undefined}
          />
          <Stat
            label="Partner + creator (80%)"
            value={fmt(surplus.partnerAndCreator, 4)}
            sub="of the surplus"
          />
          <Stat
            label="Protocol (20%)"
            value={fmt(surplus.protocol, 4)}
            sub="of the surplus"
          />
          <Stat
            label="Base sold / leftover"
            value={`${fmt(left.sold, 3)} / ${fmt(left.remaining, 3)}`}
            sub={`${((left.sold / Math.max(config.baseSupply, 1)) * 100).toFixed(1)}% of supply circulated`}
            tone={left.remaining > 0 ? "#fbbf24" : undefined}
          />
        </div>

        <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.5 }}>
          Migration Quote Amount = ⌈threshold × (100 − fee%) ÷ 100⌉, and the Migration Fee is the
          remainder. Surplus splits 80% to partner and creator, 20% to the protocol. Leftover is
          shown as raw remaining vault balance — the on-chain figure additionally subtracts protocol
          and trading base fees held in separate vaults.
        </div>
      </div>

      {/* ---- validation ---- */}
      <div
        className="panel"
        style={{
          padding: 18,
          display: "grid",
          gap: 10,
          borderColor: errors.length ? "rgba(248,113,113,0.5)" : undefined,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 14 }}>On-chain validation</strong>
          <span
            className="mono"
            style={{ fontSize: 12, color: errors.length ? "#f87171" : "#34d399" }}
          >
            {errors.length ? `${errors.length} error(s)` : "would be accepted"}
            {warnings.length ? ` · ${warnings.length} warning(s)` : ""}
          </span>
        </div>

        {issues.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Every constraint checked — segment count, sqrt-price bounds, fee range, migration fee,
            pool creation fee, decimals and threshold reachability — passes.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 7 }}>
            {issues.map((issue, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  fontSize: 12.5,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: issue.severity === "error" ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.07)",
                  border: `1px solid ${issue.severity === "error" ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.25)"}`,
                }}
              >
                <span
                  className="mono"
                  style={{
                    color: issue.severity === "error" ? "#f87171" : "#fbbf24",
                    minWidth: 62,
                    fontSize: 11,
                  }}
                >
                  {issue.severity.toUpperCase()}
                </span>
                <span>
                  <span className="mono" style={{ color: "#9ca3af", marginRight: 6 }}>
                    {issue.field}
                  </span>
                  {issue.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
