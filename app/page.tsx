"use client";

import { useMemo, useState } from "react";

import ConfigPanel from "@/components/ConfigPanel";
import CurveChart from "@/components/CurveChart";
import PresetLibrary from "@/components/PresetLibrary";
import Simulator from "@/components/Simulator";
import DeployPayload from "@/components/DeployPayload";

import {
  DEFAULT_CONFIG,
  buildSegments,
  migrationThreshold,
  validateConfig,
  type LaunchConfig,
} from "@/lib/dbc/formulas";
import { applyPreset, type Preset } from "@/lib/dbc/presets";

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toPrecision(4);
  if (abs >= 1e-4) return n.toFixed(8).replace(/0+$/, "");
  return n.toExponential(3);
}

export default function Home() {
  const [config, setConfig] = useState<LaunchConfig>(DEFAULT_CONFIG);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [buyAmount, setBuyAmount] = useState(DEFAULT_CONFIG.migrationQuoteThreshold * 0.4);
  const [copied, setCopied] = useState(false);

  const patch = (p: Partial<LaunchConfig>) => {
    setConfig((c) => ({ ...c, ...p }));
    setActivePreset(null); // any edit makes the config custom
  };

  const apply = (preset: Preset) => {
    const next = applyPreset(config, preset);
    setConfig(next);
    setActivePreset(preset.id);
    setBuyAmount(next.migrationQuoteThreshold * 0.4);
  };

  const reset = () => {
    setConfig(DEFAULT_CONFIG);
    setActivePreset(null);
    setBuyAmount(DEFAULT_CONFIG.migrationQuoteThreshold * 0.4);
  };

  const { segments, threshold, points, issues } = useMemo(() => {
    const segs = buildSegments(config);
    const total = migrationThreshold(segs);
    const sample = 160;
    const pts = Array.from({ length: sample + 1 }, (_, i) => {
      const q = (total * i) / sample;
      let remaining = q;
      let sqrtPrice = Math.sqrt(segs[0].lowerPrice);
      for (const s of segs) {
        const cap = s.liquidity * (Math.sqrt(s.upperPrice) - Math.sqrt(s.lowerPrice));
        const lower = Math.sqrt(s.lowerPrice);
        if (remaining <= cap) {
          sqrtPrice = lower + remaining / s.liquidity;
          break;
        }
        remaining -= cap;
        sqrtPrice = Math.sqrt(s.upperPrice);
      }
      return { quote: q, price: sqrtPrice * sqrtPrice };
    });
    return { segments: segs, threshold: total, points: pts, issues: validateConfig(config) };
  }, [config]);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const summary = [
    { label: "Graduation threshold", value: `${fmt(threshold)} ${config.quote}`, tone: "#22d3ee" },
    { label: "Migration price", value: fmt(config.endPrice), tone: "#22d3ee" },
    { label: "Curve segments", value: `${segments.length} / 16` },
    { label: "Trading fee", value: `${config.baseFeeBps} bps` },
    {
      label: "On-chain status",
      value: errorCount ? `${errorCount} error(s)` : "valid",
      tone: errorCount ? "#f87171" : "#34d399",
      sub: warnCount ? `${warnCount} warning(s)` : "no warnings",
    },
  ];

  return (
    <main style={{ maxWidth: 1320, margin: "0 auto", padding: "32px 22px 80px" }}>
      {/* ---------- header ---------- */}
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                aria-hidden
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 4,
                  background: "linear-gradient(135deg,#8b5cf6,#22d3ee)",
                  display: "inline-block",
                }}
              />
              <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>
                CurveForge
              </h1>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 14, margin: "7px 0 0", maxWidth: 640 }}>
              Configure, simulate and ship <strong style={{ color: "#c4b5fd" }}>Meteora Dynamic
              Bonding Curve</strong> launches. Exact on-chain math, liquidity-shaping presets and a
              validator that rejects anything the program would refuse.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <a className="chip" href="https://docs.meteora.ag/core-products/dbc/formulas" target="_blank" rel="noreferrer">
              DBC formulas ↗
            </a>
            <a
              className="chip"
              href="https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/getting-started"
              target="_blank"
              rel="noreferrer"
            >
              TS SDK ↗
            </a>
            <button type="button" className="chip" onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 10,
            marginTop: 20,
          }}
        >
          {summary.map((s) => (
            <div key={s.label} className="panel" style={{ padding: "11px 14px" }}>
              <div className="label">{s.label}</div>
              <div className="stat-value mono" style={{ color: s.tone ?? "var(--text)", fontSize: 18 }}>
                {s.value}
              </div>
              {s.sub && <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      </header>

      {/* ---------- studio ---------- */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(300px, 370px) minmax(0, 1fr)",
          gap: 18,
          alignItems: "start",
        }}
        className="studio"
      >
        <div style={{ position: "sticky", top: 16 }}>
          <ConfigPanel config={config} onChange={patch} issues={issues} />
        </div>

        <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
          <div className="panel" style={{ padding: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
              }}
            >
              <strong style={{ fontSize: 14 }}>
                {config.baseSymbol} bonding curve
              </strong>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                start {fmt(config.startPrice)} → migrate {fmt(config.endPrice)} {config.quote}
              </span>
            </div>
            <CurveChart
              points={points}
              threshold={threshold}
              position={buyAmount}
              height={330}
            />
            <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.5, marginTop: 6 }}>
              Each segment is a constant-product range: <span className="mono">x·y = k</span> with its
              own virtual liquidity. Quote demand advances sqrt price linearly, so the green marker
              shows exactly where your simulated buy lands. The dashed line is the migration
              threshold — past it, surplus splits 80/20 between partner+creator and the protocol.
            </div>
          </div>

          <Simulator config={config} buyAmount={buyAmount} onBuyAmount={setBuyAmount} />

          {/* ---------- export ---------- */}
          <div className="panel" style={{ padding: 18, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong style={{ fontSize: 14 }}>Launch configuration</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="chip" onClick={copy}>
                  {copied ? "Copied ✓" : "Copy JSON"}
                </button>
              </div>
            </div>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                background: "#0a0a12",
                border: "1px solid var(--line)",
                borderRadius: 10,
                fontSize: 11.5,
                lineHeight: 1.6,
                overflowX: "auto",
                color: "#a5b4fc",
              }}
            >
              {JSON.stringify(config, null, 2)}
            </pre>
            <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.5 }}>
              Feed these values to <span className="mono">DynamicBondingCurveClient.pool.createConfig()</span>{" "}
              to deploy the config on-chain. CurveForge never holds keys and never submits
              transactions — it is a design and verification tool.
            </div>
          </div>
        </div>
      </section>

      {/* ---------- presets ---------- */}
      <section style={{ marginTop: 34 }}>
        <PresetLibrary activeId={activePreset} onApply={apply} />
      </section>

      {/* ---------- deploy ---------- */}
      <section style={{ marginTop: 34 }}>
        <DeployPayload config={config} />
      </section>

      <style jsx global>{`
        @media (max-width: 940px) {
          .studio {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .studio > div:first-child {
            position: static !important;
          }
        }
      `}</style>
    </main>
  );
}
