/** Title card over a quiet courtroom. */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Courtroom, type CourtState } from "../stage/Courtroom";
import { StageFrame } from "../stage/StageFrame";

/** The server plays one case; until a trial exists its title is not known, so name it here. */
const DEFAULT_CASE = "Commonwealth of Aldermere v. Iris Calloway";

const QUIET: CourtState = {
  inSession: true,
  stand: null,
  witnessIds: ["renn", "arden", "calloway"],
  defendantId: "calloway",
  jurorIds: ["osei", "kapoor", "lindqvist", "hale", "ashdown"],
  judgeName: "The Court",
  standName: null,
  speaker: null,
  talker: null,
  up: { player: false, prosecutor: false },
  moods: {},
  poses: {},
  jurorsUp: [],
  startle: 0,
  freeze: false,
  push: false,
};

export function Title({ onStart, onResume, starting, error, lastId }: { onStart: () => void; onResume: (() => void) | null; starting: boolean; error: string | null; lastId: string | null }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState(DEFAULT_CASE);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (!lastId) return;
    api
      .getTrial(lastId)
      .then(({ view }) => setTitle(view.caseInfo.title))
      .catch(() => undefined);
  }, [lastId]);
  return (
    <StageFrame className="title-frame">
      <Courtroom s={QUIET} />
      <div className="title-scrim" />
      <div className="title-card">
        <span className="title-kicker">A courtroom game</span>
        <h1 className="title-name">
          <span>Verdict</span>
        </h1>
        <p className="title-case">{title}</p>
        <p className="title-lede">You are counsel for the defence. Three witnesses, five jurors, one story that does not hold. Find it.</p>
        {error && (
          <p className="title-error" role="alert">
            {error}
          </p>
        )}
        <div className="title-actions">
          <button ref={ref} type="button" className="btn primary large" onClick={onStart} disabled={starting}>
            {starting ? "Opening the file…" : "Take the case"}
          </button>
          {onResume && (
            <button type="button" className="btn ghost" onClick={onResume}>
              Resume last trial
            </button>
          )}
        </div>
      </div>
    </StageFrame>
  );
}
