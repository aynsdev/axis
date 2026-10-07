import { useLayoutEffect, useRef, useState } from 'react';

export interface Bar {
  key: string;
  label: string; // axis label
  title: string; // tooltip heading
  value: number;
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= max / 4)! * pow;
  return Math.ceil(max / step) * step;
}

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 52 };

/** Single-series column chart: recessive grid, 4px rounded caps, hover tooltip. */
export function BarChart({ bars, format, label }: { bars: Bar[]; format: (n: number) => string; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(...bars.map((b) => b.value), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = bars.length ? plotW / bars.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(bars.length / Math.max(1, Math.floor(plotW / 56)));
  const h = hover === null ? null : bars[hover];

  return (
    <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={HEIGHT} role="img" aria-label={label} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-fg-muted text-[11px] tabular-nums">
              {format(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = PAD.left + band * i + band / 2;
          const top = y(b.value);
          const hgt = PAD.top + plotH - top;
          const r = Math.min(4, hgt, barW / 2);
          const x = cx - barW / 2;
          const base = PAD.top + plotH;
          // Rounded top, square baseline.
          const d =
            hgt <= 0
              ? ''
              : `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
          return (
            <g key={b.key}>
              {d && <path d={d} fill={hover === i ? 'var(--color-chart-bar-hover)' : 'var(--color-chart-bar)'} />}
              {i % labelEvery === 0 && (
                <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-fg-muted text-[11px]">
                  {b.label}
                </text>
              )}
              {/* Hit target spans the whole band, larger than the mark. */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-small shadow-[var(--shadow-overlay)]"
          style={{
            left: Math.min(Math.max(PAD.left + band * hover + band / 2, 70), width - 70),
            top: Math.max(0, y(h.value) - 56),
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-fg-muted">{h.title}</div>
          <div className="font-semibold tabular-nums text-fg">{format(h.value)}</div>
        </div>
      )}
    </div>
  );
}
