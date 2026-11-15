/** After the verdict: inside the jury room, each juror's mind from first word to final vote. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { LeanChange, PlayerView } from "../../../src/shared/types";
import { Portrait } from "../art/Character";
import { designFor } from "../art/cast";
import { LeanChart } from "../components/LeanChart";
import { formatLean, JUROR_COLORS, shortNames, speakerName, tagLabel, tagPolarity, type CaseInfo } from "../labels";
import { CostChip } from "../stage/Hud";
import { OUTCOME } from "../stage/Verdict";

type Result = NonNullable<PlayerView["result"]>;
type Replay = Result["replay"][number];

function Gauge({ lean, acquitAt, color, ghost }: { lean: number; acquitAt: number; color: string; ghost?: number }) {
  const pct = (v: number) => `${((v + 10) / 20) * 100}%`;
  return (
    <span className="gauge" aria-hidden>
      <span className="gauge-acquit" style={{ left: pct(acquitAt) }} />
      <span className="gauge-zero" style={{ left: pct(0) }} />
      <span className="gauge-line" style={{ left: pct(acquitAt) }} />
      {ghost !== undefined && ghost !== lean && <span className="gauge-ghost" style={{ left: pct(ghost) }} />}
      <span className="gauge-dot" style={{ left: pct(lean), background: color }} />
    </span>
  );
}

function Notes({
  juror,
  color,
  persona,
  vote,
  info,
  record,
  onEntry,
}: {
  juror: Replay;
  color: string;
  persona: string;
  vote: { vote: "not_guilty" | "guilty"; finalLean: number } | undefined;
  info: CaseInfo;
  record: PlayerView["record"];
  onEntry: (id: string) => void;
}) {
  const [quiet, setQuiet] = useState(false);
  const moved = juror.log.filter((c) => c.delta !== 0);
  const rows = quiet ? juror.log : moved;
  const still = juror.log.length - moved.length;
  const entry = (id: string) => record.find((e) => e.id === id);
  let prev = juror.startLean;
  return (
    <section className="jr-notes" style={{ ["--juror" as string]: color }} aria-label={`${juror.name}'s deliberation`}>
      <header className="jr-notes-head">
        <Portrait design={designFor(juror.jurorId)} seed={juror.jurorId} size={92} bg="#efe3c8" mood={vote?.vote === "not_guilty" ? "neutral" : "stern"} />
        <div>
          <h2>{juror.name}</h2>
          <p>{persona}</p>
        </div>
        <dl className="jr-stats">
          <div>
            <dt>Started</dt>
            <dd>{formatLean(juror.startLean)}</dd>
          </div>
          <div>
            <dt>Acquits at</dt>
            <dd>{formatLean(juror.acquitAt)}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{formatLean(vote?.finalLean ?? juror.startLean)}</dd>
          </div>
          <div>
            <dt>Vote</dt>
            <dd className={vote?.vote === "not_guilty" ? "ng" : "g"}>{vote?.vote === "not_guilty" ? "Not guilty" : "Guilty"}</dd>
          </div>
        </dl>
      </header>
      <div className="jr-scale" aria-hidden>
        <span className="jr-scale-track">
          <span className="c">−10 convict</span>
          <span>0</span>
          <span className="a">acquit +10</span>
        </span>
      </div>
      <ol className="jr-timeline">
        <li className="jr-step start">
          <span className="jr-delta">start</span>
          <Gauge lean={juror.startLean} acquitAt={juror.acquitAt} color={color} />
          <p className="jr-reason">Walked in at {formatLean(juror.startLean)}, needing {formatLean(juror.acquitAt)} to acquit.</p>
        </li>
        {rows.map((c: LeanChange, i) => {
          const before = prev;
          prev = c.leanAfter;
          const e = entry(c.entryId);
          return (
            <li key={`${c.entryId}-${i}`} className={`jr-step${c.delta === 0 ? " quiet" : ""}${Math.abs(c.delta) >= 2 ? " big" : ""}`}>
              <span className={`jr-delta ${c.delta > 0 ? "up" : c.delta < 0 ? "down" : ""}`}>{c.delta === 0 ? "±0" : formatLean(c.delta)}</span>
              <Gauge lean={c.leanAfter} acquitAt={juror.acquitAt} color={color} ghost={before} />
              <div className="jr-body">
                <p className="jr-reason">“{c.reason}”</p>
                <div className="jr-meta">
                  <span className="jr-now">now {formatLean(c.leanAfter)}</span>
                  {c.rawDelta !== c.delta && <span className="jr-raw" title="Before credibility scaling">felt {formatLean(c.rawDelta)}</span>}
                  <button type="button" className="jr-link" onClick={() => onEntry(c.entryId)}>
                    {c.entryId}
                    {e ? ` · ${speakerName(e.speaker, info).split(" · ")[0]}` : ""} →
                  </button>
                </div>
                {c.tags.length > 0 && (
                  <ul className="tag-chips">
                    {c.tags.map((t, k) => (
                      <li key={k} className={`tag p${tagPolarity(t)}`}>
                        {tagLabel(t, info)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {still > 0 && (
        <button type="button" className="btn ghost small jr-quiet" onClick={() => setQuiet((q) => !q)}>
          {quiet ? "Hide" : "Show"} {still} {still === 1 ? "exchange" : "exchanges"} that left them unmoved
        </button>
      )}
    </section>
  );
}

export function JuryRoom({
  view,
  onBack,
  onNewTrial,
  onEntry,
}: {
  view: PlayerView;
  onBack: () => void;
  onNewTrial: () => void;
  onEntry: (id: string) => void;
}) {
  const info = view.caseInfo;
  const result = view.result!;
  const { verdict, replay } = result;
  const [jurorId, setJurorId] = useState(replay[0]?.jurorId ?? "");
  const [entryId, setEntryId] = useState<string | null>(null);
  const short = useMemo(() => shortNames(replay.map((j) => ({ id: j.jurorId, name: j.name }))), [replay]);
  const colorOf = (id: string) => JUROR_COLORS[Math.max(0, replay.findIndex((j) => j.jurorId === id)) % JUROR_COLORS.length]!;
  const juror = replay.find((j) => j.jurorId === jurorId) ?? replay[0];
  const o = OUTCOME[verdict.outcome];
  const ng = verdict.votes.filter((v) => v.vote === "not_guilty").length;
  const topRef = useRef<HTMLButtonElement>(null);
  useEffect(() => topRef.current?.focus(), []);

  const turning = useMemo(() => {
    const m = new Map<string, { id: string; delta: number }[]>();
    for (const j of replay)
      for (const c of j.log) {
        if (!c.delta) continue;
        const l = m.get(c.entryId) ?? [];
        l.push({ id: j.jurorId, delta: c.delta });
        m.set(c.entryId, l);
      }
    return [...m.entries()]
      .map(([id, moves]) => ({ id, moves, net: moves.reduce((n, x) => n + x.delta, 0), weight: moves.reduce((n, x) => n + Math.abs(x.delta), 0) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
  }, [replay]);

  const open = (id: string) => {
    setEntryId(id);
    onEntry(id);
  };

  return (
    <div className="jury-room">
      <div className="jr-wall" aria-hidden>
        <div className="jr-window" />
        <div className="jr-clock" />
      </div>
      <header className={`jr-top ${verdict.outcome}`}>
        <div>
          <span className="jr-kicker">Inside the jury room · {info.title}</span>
          <h1>{o.title}</h1>
          <p>
            {o.line(info.defendantName)} {ng} of {verdict.votes.length} voted not guilty.
          </p>
        </div>
        <div className="jr-top-actions">
          <CostChip usage={view.usage} voice={view.voice} final />
          <button ref={topRef} type="button" className="btn ghost" onClick={onBack}>
            Back to the courtroom
          </button>
          <button type="button" className="btn primary" onClick={onNewTrial}>
            New trial
          </button>
        </div>
      </header>

      <div className="jr-table" role="tablist" aria-label="Jurors">
        {replay.map((j) => {
          const v = verdict.votes.find((x) => x.jurorId === j.jurorId);
          const on = j.jurorId === juror?.jurorId;
          return (
            <button
              key={j.jurorId}
              type="button"
              role="tab"
              aria-selected={on}
              className={`jr-seat${on ? " on" : ""}`}
              style={{ ["--juror" as string]: colorOf(j.jurorId) }}
              onClick={() => setJurorId(j.jurorId)}
            >
              <Portrait design={designFor(j.jurorId)} seed={j.jurorId} size={96} mood={v?.vote === "not_guilty" ? "neutral" : "stern"} />
              <span className="jr-seat-name">{j.name}</span>
              <span className={`jr-seat-vote ${v?.vote === "not_guilty" ? "ng" : "g"}`}>{v?.vote === "not_guilty" ? "Not guilty" : "Guilty"}</span>
              <span className="jr-seat-lean">
                {formatLean(j.startLean)} → {formatLean(v?.finalLean ?? j.startLean)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="jr-main">
        {juror && (
          <Notes
            key={juror.jurorId}
            juror={juror}
            color={colorOf(juror.jurorId)}
            persona={info.jurors.find((x) => x.id === juror.jurorId)?.persona ?? ""}
            vote={verdict.votes.find((v) => v.jurorId === juror.jurorId)}
            info={info}
            record={view.record}
            onEntry={open}
          />
        )}
        <aside className="jr-side">
          <section className="jr-board">
            <h3>How the room moved</h3>
            <p className="jr-board-note">Every juror's lean across the trial. Hover a moment; click to read it in the transcript.</p>
            <LeanChart replay={replay} record={view.record} info={info} selectedEntry={entryId} selectedJuror={juror?.jurorId ?? null} onSelectEntry={open} />
          </section>
          {turning.length > 0 && (
            <section className="jr-turning">
              <h3>Turning points</h3>
              <ol>
                {turning.map((t) => {
                  const e = view.record.find((x) => x.id === t.id);
                  return (
                    <li key={t.id}>
                      <button type="button" className="jr-turn" onClick={() => open(t.id)}>
                        <span className={`jr-turn-net ${t.net >= 0 ? "up" : "down"}`}>{formatLean(t.net)}</span>
                        <span className="jr-turn-text">
                          <b>{t.id}</b> {(e?.text ?? "").slice(0, 96)}
                          {(e?.text.length ?? 0) > 96 ? "…" : ""}
                        </span>
                        <span className="jr-turn-who">
                          {t.moves.map((m) => (
                            <span key={m.id} style={{ ["--juror" as string]: colorOf(m.id) }}>
                              {short.get(m.id)} {formatLean(m.delta)}
                            </span>
                          ))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
