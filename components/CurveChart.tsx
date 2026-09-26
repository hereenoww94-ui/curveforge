"use client";

/**
 * SVG rendering of the DBC curve: quote reserve (x) against launch price (y).
 * Drawn by hand rather than with a chart library so the graduation threshold,
 * surplus zone and any simulated position can be annotated precisely.
 */

export interface CurvePoint {
  quote: number;
  price: number;
}

interface Props {
  points: CurvePoint[];
  threshold: number;
  /** Simulated buy position, in quote units. null hides the marker. */
  position?: number | null;
  height?: number;
}

const PAD = { top: 18, right: 18, bottom: 34, left: 66 };

function niceTick(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e6) return (v / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + "k";
  if (abs >= 1) return v.toPrecision(3);
  if (abs >= 1e-3) return v.toPrecision(3);
  const exp = Math.floor(Math.log10(abs));
  return (v / Math.pow(10, exp)).toFixed(1) + "e" + exp;
}

export default function CurveChart({
  points,
  threshold,
  position = null,
  height = 320,
}: Props) {
  if (!points.length) return null;

  const width = 760;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const maxQuote = Math.max(threshold, points[points.length - 1].quote, 1e-12);

  // Prices span orders of magnitude, so the y axis is logarithmic.
  const prices = points.map((p) => p.price).filter((p) => p > 0);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const logMin = Math.log10(minP);
  const logMax = Math.log10(maxP);
  const span = Math.max(logMax - logMin, 1e-9);

  const x = (q: number) => PAD.left + (q / maxQuote) * plotW;
  const y = (p: number) =>
    PAD.top + plotH - ((Math.log10(Math.max(p, 1e-30)) - logMin) / span) * plotH;

  const path = points
    .map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.quote).toFixed(2)},${y(pt.price).toFixed(2)}`)
    .join(" ");
  const area = `${path} L${x(points[points.length - 1].quote).toFixed(2)},${(
    PAD.top + plotH
  ).toFixed(2)} L${x(points[0].quote).toFixed(2)},${(PAD.top + plotH).toFixed(2)} Z`;

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const log = logMin + (span * i) / 4;
    return Math.pow(10, log);
  });
  const xTicks = Array.from({ length: 5 }, (_, i) => (maxQuote * i) / 4);

  const posPoint =
    position !== null && position > 0
      ? points.reduce((best, p) =>
          Math.abs(p.quote - position) < Math.abs(best.quote - position) ? p : best,
        )
      : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Dynamic bonding curve: quote reserve versus price"
    >
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="surplusFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.28" />
        </linearGradient>
      </defs>

      {/* grid */}
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(t)}
            y2={y(t)}
            stroke="#1c1c2b"
          />
          <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#7d7d9c">
            {niceTick(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={`x${i}`} x={x(t)} y={height - 12} textAnchor="middle" fontSize="10" fill="#7d7d9c">
          {niceTick(t)}
        </text>
      ))}

      {/* surplus zone beyond the graduation threshold */}
      <rect
        x={x(threshold)}
        y={PAD.top}
        width={Math.max(0, width - PAD.right - x(threshold))}
        height={plotH}
        fill="url(#surplusFill)"
      />

      <path d={area} fill="url(#curveFill)" />
      <path d={path} fill="none" stroke="#a78bfa" strokeWidth="2.4" strokeLinejoin="round" />

      {/* graduation threshold */}
      <line
        x1={x(threshold)}
        x2={x(threshold)}
        y1={PAD.top}
        y2={PAD.top + plotH}
        stroke="#22d3ee"
        strokeWidth="1.4"
        strokeDasharray="5 4"
      />
      <text x={x(threshold) - 6} y={PAD.top + 13} textAnchor="end" fontSize="10" fill="#22d3ee">
        graduates
      </text>

      {/* simulated position */}
      {posPoint && (
        <g>
          <line
            x1={x(posPoint.quote)}
            x2={x(posPoint.quote)}
            y1={y(posPoint.price)}
            y2={PAD.top + plotH}
            stroke="#34d399"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          <circle cx={x(posPoint.quote)} cy={y(posPoint.price)} r="5" fill="#34d399" />
          <circle
            cx={x(posPoint.quote)}
            cy={y(posPoint.price)}
            r="10"
            fill="none"
            stroke="#34d399"
            strokeOpacity="0.4"
          />
        </g>
      )}

      {/* axis labels */}
      <text
        x={PAD.left + plotW / 2}
        y={height - 1}
        textAnchor="middle"
        fontSize="10"
        fill="#7d7d9c"
        letterSpacing="0.08em"
      >
        QUOTE RESERVE (BUY PRESSURE)
      </text>
      <text
        transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize="10"
        fill="#7d7d9c"
        letterSpacing="0.08em"
      >
        PRICE (LOG)
      </text>
    </svg>
  );
}
