"use client";

import type { LaunchConfig, QuoteSymbol, LiquidityProfile, ValidationIssue } from "@/lib/dbc/formulas";
import {
  MIGRATION_THRESHOLDS,
  MIN_FEE_BPS,
  MAX_FEE_BPS,
  MAX_SEGMENTS,
} from "@/lib/dbc/formulas";

interface Props {
  config: LaunchConfig;
  onChange: (patch: Partial<LaunchConfig>) => void;
  issues: ValidationIssue[];
}

const QUOTES: QuoteSymbol[] = [
  "USDC",
  "SOL",
  "JUP",
  "USD1",
  "MET",
  "JupUSD",
  "VIRTUAL",
  "TRUMP",
];

const PROFILES: { id: LiquidityProfile; label: string; hint: string }[] = [
  { id: "uniform", label: "Uniform", hint: "Same price impact everywhere" },
  { id: "discovery", label: "Discovery", hint: "Thin early — price jumps fast" },
  { id: "accumulation", label: "Accumulation", hint: "Deep early — steady climb" },
  { id: "rwa", label: "RWA / Equity", hint: "Deep and even — low slippage" },
];

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span style={{ color: "#f87171", fontSize: 11 }}>{error}</span>
      ) : hint ? (
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{hint}</span>
      ) : null}
    </div>
  );
}

export default function ConfigPanel({ config, onChange, issues }: Props) {
  const err = (f: keyof LaunchConfig) =>
    issues.find((i) => i.field === f && i.severity === "error")?.message;
  const num = (f: keyof LaunchConfig, v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) onChange({ [f]: n } as Partial<LaunchConfig>);
  };

  return (
    <div className="panel" style={{ padding: 18, display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Base token" error={err("baseSymbol")}>
          <input
            className="input"
            value={config.baseSymbol}
            maxLength={12}
            onChange={(e) => onChange({ baseSymbol: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Quote mint" error={err("quote")}>
          <select
            className="select"
            value={config.quote}
            onChange={(e) => {
              const q = e.target.value as QuoteSymbol;
              onChange({ quote: q, migrationQuoteThreshold: MIGRATION_THRESHOLDS[q] });
            }}
          >
            {QUOTES.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Start price" error={err("startPrice")}>
          <input
            className="input"
            type="number"
            step="any"
            value={config.startPrice}
            onChange={(e) => num("startPrice", e.target.value)}
          />
        </Field>
        <Field label="Migration price" error={err("endPrice")}>
          <input
            className="input"
            type="number"
            step="any"
            value={config.endPrice}
            onChange={(e) => num("endPrice", e.target.value)}
          />
        </Field>
      </div>

      <Field
        label={`Graduation threshold (${config.quote})`}
        hint={`Meteora's keeper for ${config.quote} enforces ${MIGRATION_THRESHOLDS[config.quote]}`}
        error={err("migrationQuoteThreshold")}
      >
        <input
          className="input"
          type="number"
          step="any"
          value={config.migrationQuoteThreshold}
          onChange={(e) => num("migrationQuoteThreshold", e.target.value)}
        />
      </Field>

      <Field
        label={`Curve segments — ${config.segments} of ${MAX_SEGMENTS}`}
        error={err("segments")}
        hint="The universal curve accepts up to 16 curve points"
      >
        <input
          className="slider"
          type="range"
          min={1}
          max={MAX_SEGMENTS}
          step={1}
          value={config.segments}
          onChange={(e) => onChange({ segments: Number(e.target.value) })}
        />
      </Field>

      <div className="field">
        <span className="label">Liquidity profile</span>
        <div style={{ display: "grid", gap: 6 }}>
          {PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              data-on={config.profile === p.id}
              style={{ textAlign: "left", borderRadius: 8, padding: "8px 12px" }}
              onClick={() => onChange({ profile: p.id })}
            >
              <strong style={{ color: "inherit" }}>{p.label}</strong>
              <span style={{ display: "block", fontSize: 11, opacity: 0.75 }}>{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <Field
        label={`Liquidity bias — ${config.bias > 0 ? "+" : ""}${config.bias.toFixed(2)}`}
        hint={
          config.bias > 0
            ? "Weighted late → price moves faster early"
            : config.bias < 0
              ? "Weighted early → price climbs gradually"
              : "Neutral"
        }
      >
        <input
          className="slider"
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={config.bias}
          onChange={(e) => onChange({ bias: Number(e.target.value) })}
        />
      </Field>

      <div className="hairline" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Base supply" error={err("baseSupply")}>
          <input
            className="input"
            type="number"
            step="any"
            value={config.baseSupply}
            onChange={(e) => num("baseSupply", e.target.value)}
          />
        </Field>
        <Field label="Decimals" error={err("tokenDecimals")}>
          <select
            className="select"
            value={config.tokenDecimals}
            onChange={(e) => onChange({ tokenDecimals: Number(e.target.value) })}
          >
            {[6, 7, 8, 9].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label={`Trading fee — ${config.baseFeeBps} bps`}
        error={err("baseFeeBps")}
        hint={`Program floor ${MIN_FEE_BPS} bps, cap ${MAX_FEE_BPS} bps`}
      >
        <input
          className="slider"
          type="range"
          min={MIN_FEE_BPS}
          max={MAX_FEE_BPS}
          step={5}
          value={Math.min(Math.max(config.baseFeeBps, MIN_FEE_BPS), MAX_FEE_BPS)}
          onChange={(e) => onChange({ baseFeeBps: Number(e.target.value) })}
        />
      </Field>

      <div className="field">
        <span className="label">Dynamic fee layer</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="chip"
            data-on={!config.dynamicFee}
            onClick={() => onChange({ dynamicFee: false })}
          >
            Fixed
          </button>
          <button
            type="button"
            className="chip"
            data-on={config.dynamicFee}
            onClick={() => onChange({ dynamicFee: true })}
          >
            Volatility-reactive
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Creator share of LP fee" error={err("creatorShareBps")}>
          <input
            className="input"
            type="number"
            min={0}
            max={10000}
            step={500}
            value={config.creatorShareBps}
            onChange={(e) => num("creatorShareBps", e.target.value)}
          />
        </Field>
        <Field label="Migration fee %" error={err("migrationFeePct")}>
          <input
            className="input"
            type="number"
            min={0}
            max={99}
            step={0.5}
            value={config.migrationFeePct}
            onChange={(e) => num("migrationFeePct", e.target.value)}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Pool creation fee (SOL)" error={err("poolCreationFeeSol")}>
          <input
            className="input"
            type="number"
            min={0}
            max={100}
            step={0.001}
            value={config.poolCreationFeeSol}
            onChange={(e) => num("poolCreationFeeSol", e.target.value)}
          />
        </Field>
        <div className="field">
          <span className="label">Referral share</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="chip"
              data-on={!config.referral}
              onClick={() => onChange({ referral: false })}
            >
              Off
            </button>
            <button
              type="button"
              className="chip"
              data-on={config.referral}
              onClick={() => onChange({ referral: true })}
            >
              On
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
