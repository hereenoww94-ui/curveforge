"use client";

import { PRESETS, type Preset } from "@/lib/dbc/presets";
import type { LaunchConfig } from "@/lib/dbc/formulas";

interface Props {
  activeId: string | null;
  onApply: (preset: Preset) => void;
}

export default function PresetLibrary({ activeId, onApply }: Props) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>
          Curve preset library
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 0" }}>
          Opinionated configurations for the launch shapes Meteora asked builders to explore —
          equity pairs, novel curve configurations and end-to-end launch flows. Every preset
          carries a written rationale for why it is configured that way.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 12,
        }}
      >
        {PRESETS.map((p) => {
          const on = activeId === p.id;
          return (
            <div
              key={p.id}
              className="panel"
              style={{
                padding: 16,
                display: "grid",
                gap: 10,
                alignContent: "start",
                borderColor: on ? "var(--brand)" : undefined,
                boxShadow: on ? "0 0 0 3px rgba(139,92,246,0.16)" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{p.name}</strong>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: on ? "#c4b5fd" : "var(--muted)" }}
                >
                  {on ? "ACTIVE" : p.id}
                </span>
              </div>

              <div style={{ fontSize: 12, color: "#a5b4fc" }}>{p.tagline}</div>

              <div style={{ display: "grid", gap: 4, fontSize: 11.5, color: "var(--muted)" }}>
                <div>
                  <span style={{ color: "#6b7280" }}>Suits: </span>
                  {p.suits}
                </div>
                <div className="mono" style={{ color: "#6b7280" }}>
                  {p.config.profile} · {p.config.segments} seg · {p.config.baseFeeBps} bps ·{" "}
                  {p.config.quote}
                </div>
              </div>

              <details>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 11.5,
                    color: "#8b8ba6",
                    userSelect: "none",
                  }}
                >
                  Why this configuration
                </summary>
                <p
                  style={{
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "#a1a1bd",
                    margin: "8px 0 0",
                  }}
                >
                  {p.rationale}
                </p>
              </details>

              <button
                type="button"
                className="chip"
                data-on={on}
                style={{ justifySelf: "start", borderRadius: 8, padding: "7px 16px" }}
                onClick={() => onApply(p)}
              >
                {on ? "Applied" : "Load preset"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
