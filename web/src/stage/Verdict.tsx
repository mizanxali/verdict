/** The verdict: jurors rise one by one, their votes turn over, then the outcome lands. */
import { useEffect, useRef } from "react";
import type { PlayerView } from "../../../src/shared/types";
import { Portrait } from "../art/Character";
import { designFor } from "../art/cast";
import type { CaseInfo } from "../labels";

type Result = NonNullable<PlayerView["result"]>;

export const OUTCOME: Record<Result["verdict"]["outcome"], { title: string; line: (d: string) => string }> = {
  not_guilty: { title: "Not guilty", line: (d) => `The jury acquits ${d}.` },
  guilty: { title: "Guilty", line: (d) => `The jury convicts ${d}.` },
  hung: { title: "Hung jury", line: (d) => `The jury cannot agree. ${d} leaves without a verdict, for now.` },
};

export function VerdictBoard({
  info,
  result,
  revealed,
  outcomeShown,
  onSkip,
  onJuryRoom,
  onNewTrial,
  jurorIndex,
}: {
  info: CaseInfo;
  result: Result;
  revealed: number;
  outcomeShown: boolean;
  onSkip: () => void;
  onJuryRoom: () => void;
  onNewTrial: () => void;
  jurorIndex: (id: string) => number;
}) {
  const { verdict } = result;
  const shown = verdict.votes.slice(0, revealed);
  const ng = shown.filter((v) => v.vote === "not_guilty").length;
  const g = shown.length - ng;
  const o = OUTCOME[verdict.outcome];
  const roomRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (outcomeShown) roomRef.current?.focus({ preventScroll: true });
  }, [outcomeShown]);

  return (
    <div
      className={`verdict-board${outcomeShown ? " landed" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!outcomeShown) onSkip();
      }}
      onKeyDown={(e) => {
        if (!outcomeShown && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onSkip();
        }
      }}
      role="region"
      aria-label="Verdict"
      tabIndex={outcomeShown ? undefined : 0}
    >
      <div className="vb-head">
        <span className="vb-kicker">{info.title}</span>
        <h2>The jury has reached its verdict</h2>
        <div className="vb-tally" aria-live="polite">
          <span className="ng">
            Not guilty <b>{ng}</b>
          </span>
          <span className="g">
            Guilty <b>{g}</b>
          </span>
        </div>
      </div>
      <ol className="vb-votes">
        {verdict.votes.map((v, i) => {
          const j = info.jurors[jurorIndex(v.jurorId)];
          const on = i < revealed;
          return (
            <li key={v.jurorId} className={`vb-vote${on ? " on" : ""} ${v.vote}`}>
              <Portrait design={designFor(v.jurorId)} seed={v.jurorId} size={84} bg="#2d3f58" />
              <span className="vb-name">{j?.name ?? v.jurorId}</span>
              <span className="vb-card" aria-label={on ? (v.vote === "not_guilty" ? "Not guilty" : "Guilty") : "Not yet revealed"}>
                <span className="vb-card-back">?</span>
                <span className="vb-card-front">{v.vote === "not_guilty" ? "Not guilty" : "Guilty"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {!outcomeShown && <p className="vb-skip">Click or press Space to reveal all</p>}
      {outcomeShown && (
        <div className={`vb-outcome ${verdict.outcome}`}>
          <span className="vb-stamp">{o.title}</span>
          <p>
            {o.line(info.defendantName)} {verdict.votes.filter((v) => v.vote === "not_guilty").length} of {verdict.votes.length} jurors voted not guilty.
          </p>
          <div className="vb-actions">
            <button ref={roomRef} type="button" className="btn primary large" onClick={onJuryRoom}>
              Step inside the jury room
            </button>
            <button type="button" className="btn ghost" onClick={onNewTrial}>
              New trial
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
