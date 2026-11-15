/** All five leans across the trial on one axis, so the big swings stand out. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayerView, RecordEntry } from "../../../src/shared/types";
import { formatLean, JUROR_COLORS, phaseShort, shortNames, speakerName, type CaseInfo } from "../labels";

type Replay = NonNullable<PlayerView["result"]>["replay"];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function LeanChart({
  replay,
  record,
  info,
  selectedEntry,
  selectedJuror,
  onSelectEntry,
}: {
  replay: Replay;
  record: RecordEntry[];
  info: CaseInfo;
  selectedEntry: string | null;
  selectedJuror: string | null;
  onSelectEntry: (id: string) => void;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const short = useMemo(() => shortNames(replay.map((j) => ({ id: j.jurorId, name: j.name }))), [replay]);

  const H = 300;
  const M = { l: 64, r: 96, t: 30, b: 26 };
  const pw = width - M.l - M.r;
  const ph = H - M.t - M.b;
  const N = Math.max(1, record.length);
  const x = (p: number) => M.l + (p / N) * pw;
  const y = (lean: number) => M.t + ((10 - lean) / 20) * ph;

  const indexOf = useMemo(() => new Map(record.map((e, i) => [e.id, i])), [record]);
  const pos = (entryId: string) => (indexOf.get(entryId) ?? N - 1) + 1;

  const series = useMemo(
    () =>
      replay.map((j, ji) => {
        const changes = j.log.map((c) => ({ ...c, p: pos(c.entryId) })).sort((a, b) => a.p - b.p);
        const off = (ji - (replay.length - 1) / 2) * 2; // visual separation of coincident lines only
        let d = `M ${x(0)} ${y(j.startLean) + off}`;
        for (const c of changes) {
          if (c.delta === 0) continue;
          d += ` H ${x(c.p)} V ${y(c.leanAfter) + off}`;
        }
        d += ` H ${x(N)}`;
        const final = changes.length ? changes[changes.length - 1]!.leanAfter : j.startLean;
        return { j, ji, changes, off, d, final, color: JUROR_COLORS[ji % JUROR_COLORS.length]! };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replay, width, record.length],
  );

  const leanAt = (s: (typeof series)[number], p: number) => {
    let lean = s.j.startLean;
    for (const c of s.changes) if (c.p <= p) lean = c.leanAfter;
    return lean;
  };

  // Phase bands along the top.
  const bands: { phase: RecordEntry["phase"]; from: number; to: number }[] = [];
  record.forEach((e, i) => {
    const last = bands[bands.length - 1];
    if (last && last.phase === e.phase) last.to = i + 1;
    else bands.push({ phase: e.phase, from: i, to: i + 1 });
  });

  // Direct labels at the right edge, nudged apart.
  const labels = series
    .map((s) => ({ s, y: y(s.final) + s.off }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!;
    if (labels[i]!.y - prev.y < 14) labels[i]!.y = prev.y + 14;
  }

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const p = Math.round(((e.clientX - r.left) / r.width) * N);
    setHover(Math.max(1, Math.min(N, p)));
  };

  const hoverEntry = hover !== null ? record[hover - 1] : undefined;
  const selP = selectedEntry ? pos(selectedEntry) : null;

  return (
    <div className="lean-chart" ref={wrapRef}>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Juror leanings across the trial. ${series
          .map((s) => `${s.j.name} from ${formatLean(s.j.startLean)} to ${formatLean(s.final)}`)
          .join("; ")}.`}
      >
        {bands.map((b, i) => (
          <g key={i}>
            <rect x={x(b.from)} y={M.t} width={x(b.to) - x(b.from)} height={ph} className={i % 2 ? "band odd" : "band"} />
            {x(b.to) - x(b.from) > 54 && (
              <text x={(x(b.from) + x(b.to)) / 2} y={M.t - 10} className="band-label" textAnchor="middle">
                {phaseShort(b.phase, info)}
              </text>
            )}
          </g>
        ))}

        {[-10, -5, 0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={M.l + pw} y1={y(v)} y2={y(v)} className={v === 0 ? "grid zero" : "grid"} />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end" className="axis-label">
              {formatLean(v)}
            </text>
          </g>
        ))}
        <text x={M.l + 6} y={M.t + 13} className="axis-pole acquit">
          ↑ Toward acquittal
        </text>
        <text x={M.l + 6} y={M.t + ph - 6} className="axis-pole convict">
          ↓ Toward conviction
        </text>

        {selP !== null && <line x1={x(selP)} x2={x(selP)} y1={M.t} y2={M.t + ph} className="sel-line" />}

        {series.map((s) => {
          const dim = selectedJuror && selectedJuror !== s.j.jurorId;
          return (
            <g key={s.j.jurorId} className={dim ? "series dim" : "series"}>
              <path d={s.d} className="series-ring" />
              <path d={s.d} stroke={s.color} className="series-line" />
              <circle cx={x(0)} cy={y(s.j.startLean) + s.off} r={3.5} fill={s.color} className="dot" />
              {s.changes
                .filter((c) => c.delta !== 0)
                .map((c, i) => {
                  const big = Math.abs(c.delta) >= 2;
                  return (
                    <circle
                      key={i}
                      cx={x(c.p)}
                      cy={y(c.leanAfter) + s.off}
                      r={big ? 5.5 : 4}
                      fill={s.color}
                      className={big ? "dot big" : "dot"}
                    />
                  );
                })}
            </g>
          );
        })}

        {labels.map(({ s, y: ly }) => (
          <g key={s.j.jurorId}>
            <line x1={M.l + pw + 2} x2={M.l + pw + 10} y1={ly} y2={ly} stroke={s.color} strokeWidth={2} />
            <text x={M.l + pw + 14} y={ly + 4} className="series-label">
              {short.get(s.j.jurorId)} {formatLean(s.final)}
            </text>
          </g>
        ))}

        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ph} className="crosshair" />}

        <rect
          x={M.l}
          y={M.t}
          width={pw}
          height={ph}
          fill="transparent"
          className="hit"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => hoverEntry && onSelectEntry(hoverEntry.id)}
        />
      </svg>

      {hover !== null && hoverEntry && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(width - 260, Math.max(0, x(hover) + 12)),
            top: M.t,
          }}
        >
          <div className="tip-head">
            {hoverEntry.id} · {speakerName(hoverEntry.speaker, info)}
          </div>
          <div className="tip-text">{hoverEntry.text.slice(0, 120)}{hoverEntry.text.length > 120 ? "…" : ""}</div>
          <ul>
            {series.map((s) => {
              const here = s.changes.filter((c) => c.p === hover && c.delta !== 0);
              const d = here.reduce((n, c) => n + c.delta, 0);
              return (
                <li key={s.j.jurorId}>
                  <span className="swatch" style={{ background: s.color }} />
                  <span className="tip-name">{s.j.name}</span>
                  <span className="tip-lean">{formatLean(leanAt(s, hover))}</span>
                  {d !== 0 && <span className={`tip-delta ${d > 0 ? "up" : "down"}`}>{formatLean(d)}</span>}
                </li>
              );
            })}
          </ul>
          <div className="tip-foot">Click to find it in the transcript</div>
        </div>
      )}

      <ul className="chart-legend">
        {series.map((s) => (
          <li key={s.j.jurorId}>
            <span className="swatch" style={{ background: s.color }} />
            {s.j.name}
          </li>
        ))}
        <li className="legend-note">Larger dots mark swings of 2 or more.</li>
      </ul>
    </div>
  );
}
